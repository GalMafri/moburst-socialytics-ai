// @vitest-environment node
// The connector's five saves, with a fake service writer and the person's
// own answers faked: each writes its row as the person with source claude
// and names what it wrote for the audit row, never the text. Each is
// refused, in one plain sentence, for a client user, for staff without
// access, for a wrong client_name, for a target of another client, for a
// stale based_on, for empty strategy text, for a deck saved before its file
// arrived, for a link that is not https, and for the 201st save for a
// client in a day. Nothing here deletes.

import { describe, expect, it } from "vitest";
import { scopeOf } from "../_shared/api/keys";
import { eqs, fakeDb, op } from "../_shared/db.fake";
import type { CopyPost, CopyWrites, IterationRow } from "../_shared/calendar/saveCopy";
import type { NoteWrites, StoredNote, TypedNoteRow } from "../_shared/notes/add";
import type { Person } from "./access";
import { sectionVersion, type StrategyRows } from "./reads";
import { deckIdForLink, makeServiceWriter, runWrite, WRITE_TOOLS, WRITES_PER_CLIENT_PER_DAY, type DeckRow, type ServiceWriter, type WriteDeps } from "./writes";

const BADER = "00000000-0000-4000-8000-000000000001";
const CALM = "00000000-0000-4000-8000-000000000002";
const SINEAD = "00000000-0000-4000-8000-0000000000aa";
const REPORT = "00000000-0000-4000-8000-00000000000d";
const COMPETITIVE = "00000000-0000-4000-8000-00000000000c";
const CALM_REPORT = "00000000-0000-4000-8000-00000000000f";
const KEY = "plan:2026-11-09:instagram:1";
const AT = "2026-11-03T10:15:42.123456+00:00";
const NOW = new Date("2026-11-03T12:00:00.000Z");
const SIGNED = "https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/upload/sign/report-decks";

const person = (role: Person["role"]): Person => ({ userId: SINEAD, email: "sinead@moburst.com", oauthClientId: "oc-1", role, scope: scopeOf([BADER, CALM]) });
const STAFF = person("moburst_user");

const STRATEGY: StrategyRows = {
  row: { written_at: "2026-11-01T00:00:00Z", sections: { goals: "Grow leads", audience: "Injured drivers", positioning: "Local", avoid: "Fear", measures: "Calls" }, platforms: [], pillars: [] },
  edits: [{ section_key: "audience", text: "Drivers hurt in Queens", editor_name: "Neria", edited_at: "2026-11-02T00:00:00Z", source: "app" }],
};

interface World {
  notes: Array<TypedNoteRow & { created_at: string }>;
  iterations: IterationRow[];
  posts: Map<string, CopyPost>;
  sections: Array<[string, string, string, string]>;
  learned: unknown[];
  decks: Map<string, DeckRow & { created_at: string }>;
  files: Set<string>;
  signed: string[];
  writes: number;
  calls: string[];
}

function world(over: { staff?: boolean; canWrite?: string[]; writes?: number; strategy?: StrategyRows } = {}): { deps: WriteDeps; w: World } {
  const w: World = { notes: [], iterations: [], posts: new Map([[`${BADER}|${KEY}`, { copy: "Hurt in a crash? Call us.", hashtags: ["injurylaw"], cta: "Call now", platform: "Instagram", updated_at: AT }]]), sections: [], learned: [], decks: new Map(), files: new Set(), signed: [], writes: over.writes ?? 0, calls: [] };
  const stored = (n: TypedNoteRow & { created_at: string }): StoredNote => ({ id: n.id, title: n.title, note_date: n.note_date, added_by_name: n.added_by_name, created_at: n.created_at, source: n.source });
  const notes: NoteWrites = {
    client: async (id) => (id === BADER || id === CALM ? { id, timezone: "America/New_York" } : null),
    authorName: async () => "Sinéad Cronin",
    sameText: async (c, h) => { const n = w.notes.find((x) => x.client_id === c && x.text_hash === h); return n ? stored(n) : null; },
    insert: async (row) => { const n = { ...row, created_at: NOW.toISOString() }; w.notes.push(n); return { added: true, note: stored(n) }; },
    queueRead: async () => {},
  };
  const copy: CopyWrites = {
    post: async (c, k) => w.posts.get(`${c}|${k}`) ?? null,
    lastVersion: async () => 1,
    insertIteration: async (row) => { w.iterations.push(row); },
    updatePost: async (c, k, fields, since) => {
      const p = w.posts.get(`${c}|${k}`);
      if (!p || (since && since !== p.updated_at)) return null;
      w.posts.set(`${c}|${k}`, { ...p, copy: String(fields.copy), updated_at: "2026-11-03T12:00:00.000001+00:00" });
      return "2026-11-03T12:00:00.000001+00:00";
    },
  };
  const writer: ServiceWriter = {
    client: async (id) => (id === BADER ? { id, name: "Bader Law" } : id === CALM ? { id, name: "Calm" } : null),
    writesSince: async (_c, since) => { w.calls.push(`since ${since.toISOString()}`); return w.writes; },
    notes, copy,
    learn: async (c, s) => { w.learned.push([c, s]); },
    strategy: async (c) => (c === BADER ? over.strategy ?? STRATEGY : { row: null, edits: [] }),
    saveSection: async (u, c, k, t) => { w.sections.push([u, c, k, t]); },
    report: async (id) => (id === REPORT ? { id, client_id: BADER, kind: "social" } : id === COMPETITIVE ? { id, client_id: BADER, kind: "competitive" } : id === CALM_REPORT ? { id, client_id: CALM, kind: "social" } : null),
    signUpload: async (path) => { w.signed.push(path); return `${SIGNED}/${path}?token=t0k3n`; },
    deckFile: async (folder, deckId) => [...w.files].find((f) => f.startsWith(`${folder}/${deckId}.`))?.slice(folder.length + 1) ?? null,
    deck: async (id) => w.decks.get(id) ?? null,
    saveDeck: async (row) => {
      const was = w.decks.get(row.id);
      if (was) return { added: false, deck: was };
      const d = { ...row, created_at: NOW.toISOString() };
      w.decks.set(row.id, d);
      return { added: true, deck: d };
    },
  };
  const can = new Set(over.canWrite ?? [BADER]);
  const deps: WriteDeps = {
    person: { isStaff: async () => over.staff ?? true, canWrite: async (id) => can.has(id) },
    writer, now: () => NOW,
  };
  return { deps, w };
}
const save = (name: string, args: Record<string, unknown>, deps: WriteDeps, who: Person = STAFF) => runWrite(name, args, who, deps, "req-1");
const bader = { client_id: BADER, client_name: "bader law" };
const body = (r: Awaited<ReturnType<typeof runWrite>>) => (r.ok ? (r.body as Record<string, any>) : null);
/** One plain sentence: no line breaks, no JSON, ends with a period. */
const plain = (r: Awaited<ReturnType<typeof runWrite>>) => {
  expect(r.ok).toBe(false);
  expect(r.text).toMatch(/^[A-Z][^\n{}]*\.$/);
  return r.text;
};

describe("the write tools", () => {
  it("are the five saves, with the hints Claude asks for approval by, and none deletes", () => {
    expect(WRITE_TOOLS.map((t) => [t.name, t.annotations])).toEqual([
      ["socialytics_note_save", { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
      ["socialytics_post_copy_save", { readOnlyHint: false, destructiveHint: true, openWorldHint: false }],
      ["socialytics_strategy_section_save", { readOnlyHint: false, destructiveHint: true, openWorldHint: false }],
      ["socialytics_report_deck_upload", { readOnlyHint: false, destructiveHint: false, openWorldHint: false }],
      ["socialytics_report_deck_save", { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }],
    ]);
    for (const t of WRITE_TOOLS) {
      expect(Object.keys(t.inputSchema.shape).slice(0, 2), t.name).toEqual(["client_id", "client_name"]);
      expect(t.description, t.name).not.toMatch(/—|–| - |\bdelete\b|\bremove\b/i);
      expect(t.description, t.name).toContain("Moburst staff");
    }
  });
});

describe("socialytics_note_save", () => {
  it("adds a note as the person, from Claude, and names it for the audit row", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_note_save", { ...bader, text: "Never say \"cheap\".", title: "Call with Jo", date: "2026-10-28" }, deps);
    expect(r).toMatchObject({ ok: true, target: w.notes[0].id });
    expect(w.notes[0]).toMatchObject({ client_id: BADER, title: "Call with Jo", note_date: "2026-10-28", date_set_by: "person", added_by: SINEAD, added_by_name: "Sinéad Cronin", source: "claude" });
    expect(body(r)).toMatchObject({ status: "saved", note_id: w.notes[0].id, date: "2026-10-28" });
    expect(r.ok && r.target).not.toContain("cheap");
  });

  it("keeps the same text once, and says who saved it and when", async () => {
    const { deps, w } = world();
    await save("socialytics_note_save", { ...bader, text: "Launch on Dec 1." }, deps);
    const again = await save("socialytics_note_save", { ...bader, text: "  Launch on Dec 1.  " }, deps);
    expect(w.notes).toHaveLength(1);
    expect(again.ok && again.target).toBeUndefined();
    expect(body(again)).toMatchObject({ status: "already_saved", note_id: w.notes[0].id, message: "Already saved on Nov 3, 2026 by Sinéad Cronin." });
  });
});

describe("refusals every save shares", () => {
  const anySave = { ...bader, text: "x" };

  it("refuses a client user, and staff without access to the client, and writes nothing", async () => {
    const { deps, w } = world();
    expect(plain(await save("socialytics_note_save", anySave, deps, person("client")))).toBe("Saving to Socialytics from Claude is for Moburst staff.");
    const { deps: notStaff } = world({ staff: false });
    expect(plain(await save("socialytics_note_save", anySave, notStaff))).toBe("Saving to Socialytics from Claude is for Moburst staff.");
    const { deps: noAccess } = world({ canWrite: [] });
    expect(plain(await save("socialytics_note_save", anySave, noAccess))).toBe("No client with that id among the clients you can see.");
    expect(plain(await save("socialytics_note_save", { ...anySave, client_id: "Bader Law" }, deps))).toBe("No client with that id among the clients you can see.");
    expect(w.notes).toEqual([]);
  });

  it("refuses a client_name that is not the id's client", async () => {
    const { deps, w } = world({ canWrite: [BADER, CALM] });
    expect(plain(await save("socialytics_note_save", { ...anySave, client_id: CALM, client_name: "Bader Law" }, deps))).toBe("That client id is not Bader Law's. Find the client's id with socialytics_clients_list and save again.");
    expect(w.notes).toEqual([]);
  });

  it("refuses the 201st save for a client in a day, counted over the last 24 hours", async () => {
    const { deps, w } = world({ writes: WRITES_PER_CLIENT_PER_DAY });
    expect(WRITES_PER_CLIENT_PER_DAY).toBe(200);
    expect(plain(await save("socialytics_note_save", anySave, deps))).toBe("Bader Law has had 200 saves from Claude in the last 24 hours. Try again tomorrow.");
    expect(w.calls).toEqual(["since 2026-11-02T12:00:00.000Z"]);
    expect(w.notes).toEqual([]);
    const { deps: ok } = world({ writes: WRITES_PER_CLIENT_PER_DAY - 1 });
    expect((await save("socialytics_note_save", anySave, ok)).ok).toBe(true);
  });
});

describe("socialytics_post_copy_save", () => {
  const args = { ...bader, post_key: KEY, copy: "Hurt in a crash? We answer 24/7.", based_on: AT };

  it("saves the copy as the calendar's Save does, from Claude, and the edit teaches the memory", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_post_copy_save", { ...args, hashtags: ["injurylaw", "queens"] }, deps);
    expect(r).toMatchObject({ ok: true, target: KEY });
    expect(body(r)).toMatchObject({ status: "saved", post_key: KEY, updated_at: "2026-11-03T12:00:00.000001+00:00" });
    expect(w.iterations[0]).toMatchObject({ client_id: BADER, calendar_post_key: KEY, source: "claude", created_by: SINEAD, post_copy: args.copy, hashtags: ["injurylaw", "queens"] });
    await new Promise((r2) => setTimeout(r2, 0));
    expect(w.learned).toEqual([[BADER, { kind: "copy_edit", before: "Hurt in a crash? Call us.", after: args.copy, platform: "Instagram" }]]);
  });

  it("refuses a stale based_on and gives the copy as it is now", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_post_copy_save", { ...args, based_on: "2026-11-01T00:00:00Z" }, deps);
    expect(r.ok).toBe(false);
    const [sentence, current] = r.text.split("\n");
    expect(sentence).toBe("This post changed in Socialytics after you read it. Show the person the copy below and ask again.");
    expect(JSON.parse(current)).toEqual({ current: { post_key: KEY, copy: "Hurt in a crash? Call us.", hashtags: ["injurylaw"], cta: "Call now", updated_at: AT } });
    expect(w.iterations).toEqual([]);
  });

  it("refuses a post of another client, as not found", async () => {
    const { deps, w } = world({ canWrite: [BADER, CALM] });
    expect(plain(await save("socialytics_post_copy_save", { ...args, client_id: CALM, client_name: "Calm" }, deps))).toBe("No post with that key in this client's calendar.");
    expect(w.iterations).toEqual([]);
  });

  it("changes nothing when the copy is already the post's, and names no target", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_post_copy_save", { ...args, copy: "Hurt in a crash? Call us." }, deps);
    expect(r.ok && r.target).toBeUndefined();
    expect(body(r)).toMatchObject({ status: "unchanged", message: "This copy is already on the post. Nothing changed." });
    expect(w.iterations).toEqual([]);
  });
});

describe("socialytics_strategy_section_save", () => {
  it("saves the person's version of a section from Claude, against the version read", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_strategy_section_save", { ...bader, section_key: "goals", text: " Grow leads in Queens ", based_on: await sectionVersion("Grow leads") }, deps);
    expect(r).toMatchObject({ ok: true, target: "goals" });
    expect(w.sections).toEqual([[SINEAD, BADER, "goals", "Grow leads in Queens"]]);
    expect(body(r)).toMatchObject({ status: "saved", section_key: "goals", version: await sectionVersion("Grow leads in Queens") });
  });

  it("refuses a stale version and gives the section as it is now", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_strategy_section_save", { ...bader, section_key: "audience", text: "Everyone", based_on: await sectionVersion("Injured drivers") }, deps);
    const [sentence, current] = r.text.split("\n");
    expect(sentence).toBe("This section changed in Socialytics after you read it. Show the person the text below and ask again.");
    expect(JSON.parse(current)).toEqual({ current: { section_key: "audience", text: "Drivers hurt in Queens", version: await sectionVersion("Drivers hurt in Queens") } });
    expect(w.sections).toEqual([]);
  });

  it("refuses empty text, an unknown section, a client with no strategy, and handing a section back", async () => {
    const { deps, w } = world({ canWrite: [BADER, CALM] });
    const v = await sectionVersion("Drivers hurt in Queens");
    expect(plain(await save("socialytics_strategy_section_save", { ...bader, section_key: "goals", text: "  ", based_on: v }, deps))).toBe("A section can't be saved empty. To go back to Socialytics' own version, use the Strategy page.");
    expect(plain(await save("socialytics_strategy_section_save", { ...bader, section_key: "pillar:Fun", text: "x", based_on: v }, deps))).toBe("No section with that key in this client's strategy.");
    expect(plain(await save("socialytics_strategy_section_save", { client_id: CALM, client_name: "Calm", section_key: "goals", text: "x", based_on: v }, deps))).toBe("This client has no strategy yet.");
    expect(plain(await save("socialytics_strategy_section_save", { ...bader, section_key: "audience", text: "Injured drivers", based_on: v }, deps))).toBe("That is Socialytics' own version of this section. To go back to it, use the Strategy page.");
    expect(w.sections).toEqual([]);
  });

  it("changes nothing when the text is what the section says", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_strategy_section_save", { ...bader, section_key: "audience", text: "Drivers hurt in Queens", based_on: "anything" }, deps);
    expect(body(r)).toMatchObject({ status: "unchanged" });
    expect(r.ok && r.target).toBeUndefined();
    expect(w.sections).toEqual([]);
  });
});

describe("socialytics_report_deck_upload", () => {
  it("signs one upload for one path under the client and its report, and returns the command for the file", async () => {
    const { deps, w } = world();
    const r = await save("socialytics_report_deck_upload", { ...bader, report_id: REPORT, file_name: "/mnt/outputs/Bader Law October.pptx" }, deps);
    const b = body(r)!;
    expect(b.deck_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r).toMatchObject({ ok: true, target: b.deck_id });
    expect(w.signed).toEqual([`${BADER}/${REPORT}/${b.deck_id}.pptx`]);
    expect(b.upload_command).toBe(`curl -sS -f -X PUT -H 'Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation' --data-binary @'/mnt/outputs/Bader Law October.pptx' '${SIGNED}/${BADER}/${REPORT}/${b.deck_id}.pptx?token=t0k3n'`);
    expect(b.expires_in_hours).toBe(2);
  });

  it("quotes a file name with a quote in it, and takes a PDF", async () => {
    const { deps } = world();
    const b = body(await save("socialytics_report_deck_upload", { ...bader, report_id: COMPETITIVE, file_name: "Jo's deck.PDF" }, deps))!;
    expect(b.upload_command).toContain(`-H 'Content-Type: application/pdf' --data-binary @'Jo'\\''s deck.PDF'`);
  });

  it("refuses another file type and a report of another client", async () => {
    const { deps, w } = world();
    expect(plain(await save("socialytics_report_deck_upload", { ...bader, report_id: REPORT, file_name: "deck.key" }, deps))).toBe("Only a .pptx or .pdf file can be attached.");
    expect(plain(await save("socialytics_report_deck_upload", { ...bader, report_id: CALM_REPORT, file_name: "deck.pptx" }, deps))).toBe("No report with that id for this client.");
    expect(w.signed).toEqual([]);
  });
});

describe("socialytics_report_deck_save", () => {
  it("records an uploaded deck on its report once its file has arrived, as the person, from Claude", async () => {
    const { deps, w } = world();
    const deck = "11111111-1111-4111-8111-111111111111";
    expect(plain(await save("socialytics_report_deck_save", { ...bader, report_id: REPORT, title: "October deck", deck_id: deck }, deps))).toBe("The deck's file has not arrived yet. Run the upload command, then save again.");
    expect(w.decks.size).toBe(0);
    w.files.add(`${BADER}/${REPORT}/${deck}.pptx`);
    const r = await save("socialytics_report_deck_save", { ...bader, report_id: REPORT, title: " October deck ", deck_id: deck }, deps);
    expect(r).toMatchObject({ ok: true, target: deck });
    expect(w.decks.get(deck)).toMatchObject({
      id: deck, client_id: BADER, report_id: REPORT, competitive_report_id: null, title: "October deck", kind: "pptx", file_path: `${BADER}/${REPORT}/${deck}.pptx`, link: null,
      source: "claude", added_by: SINEAD, added_by_name: "Sinéad Cronin",
    });
    const again = await save("socialytics_report_deck_save", { ...bader, report_id: REPORT, title: "October deck", deck_id: deck }, deps);
    expect(body(again)).toMatchObject({ status: "already_saved", message: "Already saved on Nov 3, 2026 by Sinéad Cronin." });
    expect(w.decks.size).toBe(1);
  });

  it("records a Google Slides link on a competitive report, once per report and link", async () => {
    const { deps, w } = world();
    const link = "https://docs.google.com/presentation/d/abc/edit";
    const r = await save("socialytics_report_deck_save", { ...bader, report_id: COMPETITIVE, title: "Q3 field", link }, deps);
    const id = await deckIdForLink(COMPETITIVE, link);
    expect(r).toMatchObject({ ok: true, target: id });
    expect(w.decks.get(id)).toMatchObject({ client_id: BADER, report_id: null, competitive_report_id: COMPETITIVE, kind: "link", link, file_path: null });
    await save("socialytics_report_deck_save", { ...bader, report_id: COMPETITIVE, title: "Q3 field", link }, deps);
    expect(w.decks.size).toBe(1);
    expect(await deckIdForLink(REPORT, link)).not.toBe(id);
  });

  it("refuses a link that is not https, both a deck and a link, neither, an empty title and another client's report", async () => {
    const { deps, w } = world();
    const deck = "11111111-1111-4111-8111-111111111111";
    for (const [args, says] of [
      [{ report_id: REPORT, title: "t", link: "http://docs.google.com/x" }, "The link must be an https address."],
      [{ report_id: REPORT, title: "t", link: "javascript:alert(1)" }, "The link must be an https address."],
      [{ report_id: REPORT, title: "t", link: "https://x.com", deck_id: deck }, "Give either deck_id or link, not both."],
      [{ report_id: REPORT, title: "t" }, "Give the deck_id from the upload, or a link."],
      [{ report_id: REPORT, title: "  ", link: "https://x.com" }, "The deck needs a title."],
      [{ report_id: CALM_REPORT, title: "t", link: "https://x.com" }, "No report with that id for this client."],
      [{ report_id: REPORT, title: "t", deck_id: "not-an-id" }, "No deck with that id."],
    ] as const) expect(plain(await save("socialytics_report_deck_save", { ...bader, ...args }, deps)), JSON.stringify(args)).toBe(says);
    expect(w.decks.size).toBe(0);
  });
});

describe("makeServiceWriter", () => {
  it("counts a client's connector writes from the audit rows, saves a section through strategy_section_save_as and signs one upload path", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "api_requests") return { count: 7 };
      if (c.table === "clients") return { data: { id: BADER, name: "Bader Law" } };
      if (c.table === "reports") return { data: null };
      if (c.table === "competitive_reports") return { data: { id: COMPETITIVE, client_id: BADER } };
      if (c.table === "report_decks" && op(c, "upsert")) return { data: [] };
      if (c.table === "report_decks") return { data: { id: "d1", created_at: "x" } };
      return { data: null };
    });
    const storage: string[] = [];
    const withStorage = {
      ...db,
      storage: {
        from: (bucket: string) => ({
          createSignedUploadUrl: async (path: string) => { storage.push(`${bucket}:sign:${path}`); return { data: { signedUrl: `${SIGNED}/${path}?token=x`, token: "x", path }, error: null }; },
          list: async (folder: string, opts: { search: string }) => { storage.push(`${bucket}:list:${folder}:${opts.search}`); return { data: [{ name: `${opts.search}.pdf` }, { name: "other.pptx" }], error: null }; },
        }),
      },
    };
    const writer = makeServiceWriter(withStorage);
    expect(await writer.writesSince(BADER, new Date("2026-11-02T12:00:00Z"))).toBe(7);
    const count = calls.find((c) => c.table === "api_requests")!;
    expect(eqs(count)).toEqual({ client_id: BADER, method: "MCP" });
    expect(op(count, "not")).toEqual(["target", "is", null]);
    expect(op(count, "gte")).toEqual(["created_at", "2026-11-02T12:00:00.000Z"]);
    expect(op(count, "select")).toEqual(["id", { count: "exact", head: true }]);
    await writer.saveSection(SINEAD, BADER, "goals", "Grow");
    expect(op(calls.find((c) => c.table === "rpc:strategy_section_save_as")!, "rpc")).toEqual([{ p_user: SINEAD, p_client: BADER, p_key: "goals", p_text: "Grow", p_source: "claude" }]);
    expect(await writer.report(COMPETITIVE)).toEqual({ id: COMPETITIVE, client_id: BADER, kind: "competitive" });
    expect(await writer.signUpload(`${BADER}/${REPORT}/d.pptx`)).toBe(`${SIGNED}/${BADER}/${REPORT}/d.pptx?token=x`);
    expect(await writer.deckFile(`${BADER}/${REPORT}`, "d1")).toBe("d1.pdf");
    expect(storage).toEqual([`report-decks:sign:${BADER}/${REPORT}/d.pptx`, `report-decks:list:${BADER}/${REPORT}:d1`]);
    const saved = await writer.saveDeck({ id: "d1" } as DeckRow);
    expect(saved).toEqual({ added: false, deck: { id: "d1", created_at: "x" } });
    expect(op(calls.find((c) => c.table === "report_decks" && !!op(c, "upsert"))!, "upsert")).toEqual([{ id: "d1" }, { onConflict: "id", ignoreDuplicates: true }]);
    // Nothing the writer does deletes.
    expect(calls.some((c) => c.ops.some(([n]) => n === "delete"))).toBe(false);
  });
});
