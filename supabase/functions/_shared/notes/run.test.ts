// The notes_read job (client notes design, sections 3 and 9): it reads a
// client's waiting notes one at a time, one part per run, keeps what each
// taught, and once nothing is waiting asks for one rewrite of each planned
// week the new Avoid and Do points have not reached yet.

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ anthropic: vi.fn() }));
vi.mock("../anthropic.ts", () => ({ anthropicMessages: m.anthropic }));

import { fakeDb, type FakeDb } from "../lifecycle/fakeDb";
import { runNotesRead, type NotesJob } from "./run";
import type { Parsers } from "./read";
import { MEMORY_MODEL } from "../voice/load";

vi.stubGlobal("Deno", { env: { get: (name: string) => (name === "ANTHROPIC_API_KEY" ? "test" : undefined) } });
afterEach(() => vi.clearAllMocks());
afterAll(() => vi.unstubAllGlobals());

const NOW = new Date("2026-11-02T15:00:00Z");
const CLIENT = { id: "c1", name: "Bader Law", timezone: "America/New_York", primary_platforms: ["Instagram", "LinkedIn"] };
const job = (over: Partial<NotesJob> = {}): NotesJob => ({ id: "j1", kind: "notes_read", client_id: "c1", attempts: 1, max_attempts: 3, ...over });
const reply = (body: unknown, usage = { input_tokens: 1200, output_tokens: 300 }) => ({ text: typeof body === "string" ? body : JSON.stringify(body), stopReason: "end_turn", raw: { usage } });

const noteRow = (over: Record<string, unknown>) => ({
  client_id: "c1", kind: "typed", title: "Call", file_path: null, file_type: null, text: null, text_chars: null, parts_done: 0,
  note_date: "2026-11-02", date_set_by: "app", state: "reading", input_tokens: 0, output_tokens: 0, created_at: "2026-11-02T14:00:00Z", read_at: null, ...over,
});
const pointRow = (over: Record<string, unknown>) => ({
  client_id: "c1", kind: "avoid", text: "A rule.", platform: null, said_on: null, until: null, part: 1, removed_at: null, created_at: "2026-10-01T00:00:00Z", ...over,
});

const noParsers: Parsers = {
  docxText: async () => { throw new Error("not used"); },
  xlsxSheets: async () => { throw new Error("not used"); },
  pdfText: async () => { throw new Error("not used"); },
};
const deps = (parsers: Parsers = noParsers) => ({ parsers: vi.fn(async () => parsers) });

/** A client with one earlier note: "old" in use, and "z", which "old" outdated. */
function db(tables: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  return fakeDb({
    clients: [CLIENT],
    client_notes: [noteRow({ id: "n0", text: "Earlier call.", state: "learned", parts_done: 1, note_date: "2026-10-01", created_at: "2026-10-01T00:00:00Z" })],
    client_note_points: [pointRow({ id: "old", note_id: "n0", text: `Never say "cheap".` }), pointRow({ id: "z", note_id: "n0", kind: "do", text: "Say cheap.", created_at: "2026-09-01T00:00:00Z" })],
    client_note_links: [{ client_id: "c1", point_id: "old", other_id: "z", relation: "conflict", created_at: "2026-10-01T00:00:00Z" }],
    calendar_plans: [],
    ...tables,
  }, {
    calendar_request_revision: () => ({}),
  });
}
const notesOf = (d: FakeDb, noteId: string) => d.tables.client_note_points.filter((p) => p.note_id === noteId);
const note = (d: FakeDb, id: string) => d.tables.client_notes.find((n) => n.id === id)!;

describe("reading a note", () => {
  it("writes the points, their links and the tokens, and marks the note learned", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", text: "Call notes: they still hate the word cheap. The office opens Nov 15." }));
    m.anthropic.mockResolvedValue(reply({ note_date: null, points: [
      { kind: "avoid", text: `Never say "cheap".`, repeats: ["P1"] },
      { kind: "upcoming", text: "The new office opens.", until: "2026-11-15", platform: "instagram" },
    ] }));
    const out = await runNotesRead(d, job(), deps(), NOW);

    const call = m.anthropic.mock.calls[0][0];
    expect(call.body.model).toBe(MEMORY_MODEL);
    const prompt = call.body.messages[0].content as string;
    expect(prompt).toContain(`[P1] avoid, 2026-10-01: Never say "cheap".`);
    expect(prompt).not.toContain("Say cheap.");
    expect(prompt).toContain("Call notes: they still hate the word cheap.");
    expect(prompt).toContain("Instagram, LinkedIn");

    const points = notesOf(d, "n1");
    expect(points).toEqual([
      expect.objectContaining({ client_id: "c1", kind: "avoid", text: `Never say "cheap".`, part: 1, platform: null }),
      expect.objectContaining({ kind: "upcoming", until: "2026-11-15", platform: "Instagram" }),
    ]);
    // The repeat links to the point it repeats and takes over that point's link to z.
    const repeat = points[0].id;
    expect(d.tables.client_note_links.filter((l) => l.point_id === repeat)).toEqual([
      expect.objectContaining({ client_id: "c1", other_id: "old", relation: "same" }),
      expect.objectContaining({ client_id: "c1", other_id: "z", relation: "conflict" }),
    ]);
    expect(note(d, "n1")).toMatchObject({ state: "learned", parts_done: 1, input_tokens: 1200, output_tokens: 300, read_at: NOW.toISOString() });
    // More may be waiting: the job runs again now, its tries counted afresh.
    expect(out).toMatchObject({ status: "queued", available_at: NOW.toISOString(), resetAttempts: true });
  });

  it("takes the note's date from its text, unless a person set one", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", text: "Meeting of Oct 20." }), noteRow({ id: "n2", text: "Meeting of Oct 21.", date_set_by: "person", note_date: "2026-10-25", created_at: "2026-11-02T14:30:00Z" }));
    m.anthropic.mockResolvedValueOnce(reply({ note_date: "2026-10-20", points: [{ kind: "do", text: "Lead with results." }] }))
      .mockResolvedValueOnce(reply({ note_date: "2026-10-21", points: [{ kind: "do", text: "Short lines." }] }));
    await runNotesRead(d, job(), deps(), NOW);
    await runNotesRead(d, job(), deps(), NOW);
    expect(note(d, "n1")).toMatchObject({ note_date: "2026-10-20", date_set_by: "app" });
    expect(note(d, "n2")).toMatchObject({ note_date: "2026-10-25", date_set_by: "person" });
  });

  it("leaves the note Reading after a reply it cannot read, keeps the tokens, and tries again later", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", text: "Call notes." }));
    m.anthropic.mockResolvedValue(reply("I could not find anything useful."));
    for (const [attempts, minutes] of [[1, 10], [2, 60], [3, 360]]) {
      const out = await runNotesRead(d, job({ attempts }), deps(), NOW);
      expect(out).toMatchObject({ status: "queued", available_at: new Date(NOW.getTime() + minutes * 60_000).toISOString() });
      expect(out.reason).toMatch(/could not be read/);
    }
    expect(note(d, "n1")).toMatchObject({ state: "reading", parts_done: 0, input_tokens: 3600, output_tokens: 900 });
    expect(notesOf(d, "n1")).toEqual([]);
  });

  it("marks a note with nothing for the copy, and a model that does not answer leaves it Reading", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", text: "Invoice for October." }));
    m.anthropic.mockRejectedValueOnce(new Error("Anthropic API error 529: overloaded"));
    expect(await runNotesRead(d, job(), deps(), NOW)).toMatchObject({ status: "queued", reason: "Anthropic API error 529: overloaded" });
    expect(note(d, "n1").state).toBe("reading");
    m.anthropic.mockResolvedValue(reply({ note_date: null, points: [] }));
    await runNotesRead(d, job(), deps(), NOW);
    expect(note(d, "n1")).toMatchObject({ state: "nothing", parts_done: 1 });
  });

  it("reads long text one part per run, the next run sees the earlier part, and a stopped part is read again from a clean slate", async () => {
    const d = db();
    const text = Array.from({ length: 130 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(198)}`.trim()).join("\n\n");
    d.tables.client_notes.push(noteRow({ id: "n1", text, parts_done: 1 }));
    // Part 1's point, and a point a run that stopped wrote for part 2.
    d.tables.client_note_points.push(pointRow({ id: "p1", note_id: "n1", text: "From part one.", part: 1, created_at: "2026-11-02T14:10:00Z" }), pointRow({ id: "left", note_id: "n1", text: "Left over.", part: 2, created_at: "2026-11-02T14:20:00Z" }));
    m.anthropic.mockResolvedValue(reply({ note_date: null, points: [{ kind: "fact", text: "From part two." }] }));
    await runNotesRead(d, job(), deps(), NOW);
    const prompt = m.anthropic.mock.calls[0][0].body.messages[0].content as string;
    expect(prompt).toContain("part 2 of 3");
    expect(prompt).toContain("From part one.");
    expect(prompt).not.toContain("Left over.");
    expect(notesOf(d, "n1").map((p) => p.text)).toEqual(["From part one.", "From part two."]);
    expect(note(d, "n1")).toMatchObject({ state: "reading", parts_done: 2 });
  });

  it("reads a file note's text with no model call for the text, and keeps it on the note", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", kind: "file", title: "call.txt", file_path: "c1/1700000000000-42.txt", file_type: "txt" }));
    d.uploads.set("client-notes/c1/1700000000000-42.txt", "They asked for shorter captions.");
    m.anthropic.mockResolvedValue(reply({ note_date: null, points: [{ kind: "do", text: "Short captions." }] }));
    const d1 = deps();
    await runNotesRead(d, job(), d1, NOW);
    expect(d1.parsers).not.toHaveBeenCalled();
    expect(note(d, "n1")).toMatchObject({ text: "They asked for shorter captions.", state: "learned" });
    expect(m.anthropic.mock.calls[0][0].body.messages[0].content).toContain("They asked for shorter captions.");
  });

  it("hands a scan to the reading call as the document itself", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", kind: "file", title: "scan.pdf", file_path: "c1/1-2.pdf", file_type: "pdf" }));
    d.uploads.set("client-notes/c1/1-2.pdf", "%PDF-1.4 scanned");
    m.anthropic.mockResolvedValue(reply({ note_date: null, points: [{ kind: "avoid", text: "No slang." }] }));
    const d1 = deps({ ...noParsers, pdfText: async () => ({ pages: 1, text: "" }) });
    await runNotesRead(d, job(), d1, NOW);
    expect(d1.parsers).toHaveBeenCalledTimes(1);
    const content = m.anthropic.mock.calls[0][0].body.messages[0].content as Array<Record<string, any>>;
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(atob(content[0].source.data)).toBe("%PDF-1.4 scanned");
    expect(content[1].text).toContain("The note is the attached document.");
    expect(note(d, "n1")).toMatchObject({ state: "learned", text: null });
  });

  it("finds nothing in a file no parser can open, with no model call", async () => {
    const d = db();
    d.tables.client_notes.push(noteRow({ id: "n1", kind: "file", title: "broken.docx", file_path: "c1/1-3.docx", file_type: "docx" }));
    d.uploads.set("client-notes/c1/1-3.docx", "not a zip");
    await runNotesRead(d, job(), deps({ ...noParsers, docxText: async () => { throw new Error("Corrupted zip"); } }), NOW);
    expect(m.anthropic).not.toHaveBeenCalled();
    expect(note(d, "n1")).toMatchObject({ state: "nothing" });
  });
});

describe("once nothing is waiting", () => {
  const plan = (id: string, week_start: string, ready_at: string, over: Record<string, unknown> = {}) =>
    ({ id, client_id: "c1", week_start, status: "ready", ready_at, pending_revision: null, revisions: [], ...over });
  // A rule read today: "new" outdates "old".
  const rules = (kind = "avoid") => ({
    client_notes: [
      noteRow({ id: "n0", state: "learned", parts_done: 1, note_date: "2026-10-01", text: "Old.", created_at: "2026-10-01T00:00:00Z" }),
      noteRow({ id: "n1", state: "learned", parts_done: 1, text: "New.", created_at: "2026-11-02T14:00:00Z" }),
    ],
    client_note_points: [pointRow({ id: "new", note_id: "n1", kind, created_at: "2026-11-02T14:05:00Z" })],
    client_note_links: [],
  });

  it("asks for one rewrite of each planned week ahead that was planned before the new Avoid or Do points", async () => {
    const d = db({
      ...rules("avoid"),
      calendar_plans: [
        // Today is Monday Nov 2 in New York: last week is over.
        plan("over", "2026-10-26", "2026-10-20T07:00:00Z"),
        plan("this-week", "2026-11-02", "2026-10-27T07:00:00Z"),
        plan("next-week", "2026-11-09", "2026-10-28T07:00:00Z"),
        plan("planned-after", "2026-11-16", "2026-11-02T14:30:00Z"),
        plan("person-waiting", "2026-11-23", "2026-10-30T07:00:00Z", { pending_revision: { note: "Less formal", by: "u1", at: "2026-11-01T09:00:00Z", scope: "untouched" } }),
        plan("revised-since", "2026-11-30", "2026-10-30T07:00:00Z", { revisions: [{ note: "x", by: "u1", at: "2026-11-02T14:10:00Z", scope: "untouched", done_at: "2026-11-02T14:12:00Z" }] }),
        plan("filled-only", "2026-12-07", "2026-10-30T07:00:00Z", { revisions: [{ note: "Write the posts that have no copy yet.", by: null, at: "2026-11-02T14:10:00Z", scope: "empty" }] }),
      ],
    });
    const out = await runNotesRead(d, job(), deps(), NOW);
    expect(m.anthropic).not.toHaveBeenCalled();
    const asked = d.rpcCalls.filter((c) => c.name === "calendar_request_revision");
    expect(asked.map((c) => c.args.p_plan)).toEqual(["this-week", "next-week", "filled-only"]);
    for (const c of asked) expect(c.args).toEqual({ p_plan: c.args.p_plan, p_note: "Follow what Bader Law told the team in its newest notes.", p_user: null, p_scope: "untouched" });
    expect(out).toMatchObject({ status: "done", result: { rewrites: ["2026-11-02", "2026-11-09", "2026-12-07"] } });
  });

  it("asks for nothing when the new points are facts alone", async () => {
    const d = db({ ...rules("fact"), calendar_plans: [plan("next-week", "2026-11-02", "2026-10-27T07:00:00Z")] });
    expect(await runNotesRead(d, job(), deps(), NOW)).toMatchObject({ status: "done" });
    expect(d.rpcCalls.filter((c) => c.name === "calendar_request_revision")).toEqual([]);
  });

  it("asks nothing again once the week was rewritten after the points", async () => {
    const d = db({ ...rules("do"), calendar_plans: [plan("next-week", "2026-11-02", "2026-10-27T07:00:00Z")] });
    d.tables.calendar_plans[0].revisions = [{ note: "Follow what Bader Law told the team in its newest notes.", by: null, at: "2026-11-02T14:06:00.123456+00:00", scope: "untouched" }];
    await runNotesRead(d, job(), deps(), NOW);
    expect(d.rpcCalls.filter((c) => c.name === "calendar_request_revision")).toEqual([]);
  });

  it("skips a week the database will not revise now, and still finishes", async () => {
    const d = fakeDb({ ...db({ ...rules("avoid"), calendar_plans: [plan("a", "2026-11-02", "2026-10-27T07:00:00Z"), plan("b", "2026-11-09", "2026-10-28T07:00:00Z")] }).tables }, {
      calendar_request_revision: (args) => { if (args.p_plan === "a") throw new Error("This week is already being revised."); return {}; },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runNotesRead(d, job(), deps(), NOW)).toMatchObject({ status: "done", result: { rewrites: ["2026-11-09"] } });
    warn.mockRestore();
  });
});
