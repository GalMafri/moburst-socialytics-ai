// @vitest-environment node
// The connector's reads of the calendar, the strategy and the client notes,
// each through the person's own client so RLS answers as them. The calendar
// is for everyone who sees the client; the strategy and the notes are for
// Moburst staff and read as not found for anyone else. Each section of the
// strategy carries the version a save from Claude names.

import { describe, expect, it } from "vitest";
import { scopeOf } from "../../functions/_shared/api/keys";
import { eqs, fakeDb, op } from "../../functions/_shared/db.fake";
import type { Person } from "../../functions/mcp/access";
import { personReads, READ_TOOLS, runRead, sectionVersion, strategySections, type CalendarRow, type PersonReads, type StrategyRows } from "../../functions/mcp/reads";

const BADER = "00000000-0000-4000-8000-000000000001";
const CALM = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-03T02:00:00.000Z"); // Nov 2 in New York

const person = (role: Person["role"], ids = [BADER, CALM]): Person => ({ userId: "00000000-0000-4000-8000-0000000000aa", email: "sinead@moburst.com", oauthClientId: "oc-1", role, scope: scopeOf(ids) });
const STAFF = person("moburst_user");
const CLIENT_USER = person("client", [BADER]);

const POSTS: CalendarRow[] = [
  {
    post_key: "plan:2026-11-04:instagram:1", post_date: "2026-11-04", posting_time: "09:00", platform: "Instagram", format: "reel", pillar: "Know your rights",
    copy: "Hurt in a crash?", hashtags: ["injurylaw"], cta: "Call now", touched_at: null, updated_at: "2026-11-02T10:00:00.123456+00:00",
    reasons: [{ type: "performance", label: "old words", evidence: [{ id: "e1", kind: "own", text: "Our reel on whiplash", platform: "instagram", format: "reel", date: "2026-10-20", metric: "engagement", value: 300, median: 100, multiple: 3, sample: 12 }], fit: "It answers what people ask most." }],
  },
  { post_key: "post:abc", post_date: "2026-11-10", posting_time: null, platform: "LinkedIn", format: null, pillar: null, copy: "", hashtags: null, cta: null, touched_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00+00:00", reasons: [{ type: "idea", label: "Added from the competitor feed" }] },
];

const STRATEGY: StrategyRows = {
  row: {
    written_at: "2026-11-01T08:00:00+00:00",
    sections: { goals: "Grow leads", audience: "Injured drivers", positioning: "Local and fast", "pillar:Know your rights": "Explain rights", "platform:instagram:posting": "Three reels a week", not_now: "TikTok later", avoid: "No fear", measures: "Calls" },
    platforms: [{ platform: "Instagram", key: "instagram", state: "posting", handle: "baderlaw", profile_reason: null, cadence: { per_week: 3, source: "own" }, baseline: null, reason: null, suggested: false }],
    pillars: [{ name: "Know your rights", share: 40 }],
  },
  edits: [{ section_key: "audience", text: "Drivers hurt in Queens", editor_name: "Sinéad Cronin", edited_at: "2026-11-02T09:00:00+00:00", source: "claude" }],
};

function reads(over: Partial<PersonReads> = {}): PersonReads & { windows: string[][] } {
  const windows: string[][] = [];
  return {
    windows,
    client: async (id) => (id === BADER ? { id, name: "Bader Law", timezone: "America/New_York", brand_notes: "Always say attorney." } : id === CALM ? { id, name: "Calm", timezone: "UTC", brand_notes: null } : null),
    calendarPosts: async (id, from, to) => { windows.push([id, from, to]); return id === BADER ? POSTS : []; },
    worked: async (_id, p) => !!p.touched_at,
    strategy: async (id) => (id === BADER ? STRATEGY : { row: null, edits: [] }),
    notes: async (id) => (id !== BADER ? { notes: [], points: [], links: [] } : {
      notes: [
        { id: "n1", note_date: "2026-10-28", date_set_by: "person", title: "Kickoff call", state: "learned", source: "claude", added_by_name: "Sinéad Cronin", created_at: "2026-10-28T12:00:00Z", kind: "typed" },
        { id: "n2", note_date: "2026-10-30", date_set_by: "app", title: "Brand book.pdf", state: "reading", source: "app", added_by_name: null, created_at: "2026-10-30T12:00:00Z", kind: "file" },
      ],
      points: [
        { id: "p1", note_id: "n1", kind: "avoid", text: "Never say \"cheap\"", platform: null, said_on: null, until: null, created_at: "2026-10-28T12:01:00Z", part: 1 },
        { id: "p2", note_id: "n1", kind: "upcoming", text: "Office opens in Queens", platform: "Instagram", said_on: null, until: "2026-12-01", created_at: "2026-10-28T12:01:00Z", part: 1 },
      ],
      links: [],
    }),
    note: async (id) => (id === "n1" ? { id: "n1", client_id: BADER, title: "Kickoff call", text: "Never say cheap.", text_chars: null, note_date: "2026-10-28", source: "claude", added_by_name: "Sinéad Cronin", created_at: "2026-10-28T12:00:00Z", state: "learned", kind: "typed" } : id === "n9" ? { id: "n9", client_id: CALM, title: "x", text: "y", text_chars: null, note_date: "2026-10-01", source: "app", added_by_name: null, created_at: "2026-10-01T00:00:00Z", state: "learned", kind: "typed" } : null),
    ...over,
  };
}
const call = (name: string, args: Record<string, unknown>, who: Person = STAFF, r: PersonReads = reads()) => runRead(name, args, who, r, "req-1", NOW);
const data = (r: Awaited<ReturnType<typeof runRead>>) => (r.ok ? (r.body as { data: any }).data : null);

describe("the read tools", () => {
  it("are the calendar for everyone, and the strategy and notes for staff only, all read-only", () => {
    expect(READ_TOOLS.map((t) => [t.name, t.staffOnly])).toEqual([["socialytics_calendar_posts", false], ["socialytics_strategy_get", true], ["socialytics_client_notes", true]]);
    for (const t of READ_TOOLS) {
      expect(t.annotations, t.name).toEqual({ readOnlyHint: true, openWorldHint: false });
      expect(t.description, t.name).not.toMatch(/—|–| - /);
      expect(t.description.length, t.name).toBeGreaterThan(80);
    }
  });
});

describe("socialytics_calendar_posts", () => {
  it("lists the posts from the client's today to 28 days ahead, worded as the calendar shows them", async () => {
    const r = reads();
    const out = await call("socialytics_calendar_posts", { client_id: BADER }, CLIENT_USER, r);
    expect(r.windows).toEqual([[BADER, "2026-11-02", "2026-11-30"]]);
    expect(data(out)).toEqual({
      from: "2026-11-02", to: "2026-11-30",
      posts: [
        {
          post_key: "plan:2026-11-04:instagram:1", date: "2026-11-04", time: "09:00", platform: "Instagram", format: "reel", pillar: "Know your rights",
          copy: "Hurt in a crash?", hashtags: ["injurylaw"], cta: "Call now", why: "Your instagram reel from Oct 20 got 3x your usual engagement. It answers what people ask most.",
          worked_on: false, updated_at: "2026-11-02T10:00:00.123456+00:00",
        },
        { post_key: "post:abc", date: "2026-11-10", time: null, platform: "LinkedIn", format: null, pillar: null, copy: "", hashtags: [], cta: null, why: "Added from the competitor feed", worked_on: true, updated_at: "2026-11-01T00:00:00+00:00" },
      ],
    });
  });

  it("takes a window of up to 92 days, and refuses dates it cannot read", async () => {
    const r = reads();
    await call("socialytics_calendar_posts", { client_id: BADER, from: "2026-10-01", to: "2026-12-31" }, STAFF, r);
    expect(r.windows[0]).toEqual([BADER, "2026-10-01", "2026-12-31"]);
    expect(await call("socialytics_calendar_posts", { client_id: BADER, from: "2026-10-01", to: "2027-01-05" })).toMatchObject({ ok: false, status: 400, text: "Ask for at most 92 days at a time." });
    expect(await call("socialytics_calendar_posts", { client_id: BADER, from: "Nov 1" })).toMatchObject({ ok: false, status: 400, text: "From and to must be yyyy-mm-dd." });
    expect(await call("socialytics_calendar_posts", { client_id: BADER, from: "2026-11-20", to: "2026-11-01" })).toMatchObject({ ok: false, status: 400, text: "From must be on or before to." });
  });

  it("reads a client outside the person's clients as not found", async () => {
    const r = reads();
    expect(await call("socialytics_calendar_posts", { client_id: CALM }, CLIENT_USER, r)).toEqual({ ok: false, status: 404, code: "not_found", text: "No client with that id among the clients you can see." });
    expect(await call("socialytics_calendar_posts", { client_id: "Bader Law" }, STAFF, r)).toMatchObject({ ok: false, status: 404 });
    expect(r.windows).toEqual([]);
  });
});

describe("socialytics_strategy_get", () => {
  it("gives each section as the Strategy page shows it, a person's version first, with a version to save against", async () => {
    const out = data(await call("socialytics_strategy_get", { client_id: BADER }));
    expect(out.written_at).toBe("2026-11-01T08:00:00+00:00");
    expect(out.sections.map((s: { key: string }) => s.key)).toEqual(["goals", "audience", "positioning", "pillar:Know your rights", "platform:instagram:posting", "not_now", "avoid", "measures"]);
    expect(out.sections[0]).toEqual({ key: "goals", title: "Goals", text: "Grow leads", edited_by: null, edited_at: null, from_claude: false, version: await sectionVersion("Grow leads") });
    expect(out.sections[1]).toEqual({ key: "audience", title: "Audience", text: "Drivers hurt in Queens", edited_by: "Sinéad Cronin", edited_at: "2026-11-02T09:00:00+00:00", from_claude: true, version: await sectionVersion("Drivers hurt in Queens") });
    expect(out.sections.find((s: { key: string }) => s.key === "pillar:Know your rights").title).toBe("Pillar: Know your rights");
    expect(out.sections.find((s: { key: string }) => s.key === "platform:instagram:posting").title).toBe("Instagram, posting now");
    expect(out.platforms).toEqual([{ platform: "Instagram", state: "posting", handle: "baderlaw", posts_per_week: 3, reason: null }]);
  });

  it("says when there is no strategy yet", async () => {
    expect(data(await call("socialytics_strategy_get", { client_id: CALM }))).toEqual({ written_at: null, sections: [], platforms: [] });
  });

  it("is for Moburst staff: anyone else reads it as not found", async () => {
    expect(await call("socialytics_strategy_get", { client_id: BADER }, CLIENT_USER)).toEqual({ ok: false, status: 404, code: "not_found", text: "No client with that id among the clients you can see." });
  });

  it("reads a strategy written as fields by the lines the page shows, the same text the save versions", () => {
    const goals = { items: [{ title: "Grow leads", why: "Calls.", platform: "Instagram", metric: "posts_per_week", direction: "above", baseline: 2, by: "2027-02-01" }] };
    const rows: StrategyRows = {
      row: { written_at: "2026-11-03T08:00:00+00:00", sections: { goals, audience: { who: "Drivers", wants: [], where: [] } }, section_texts: { goals: "- Grow leads (Instagram posts a week: 2 today, above it by 1 Feb 2027). Why: Calls.", audience: "Drivers" }, platforms: [], pillars: [] },
      edits: [{ section_key: "audience", text: "Drivers hurt in Queens", editor_name: "Neria", edited_at: "2026-11-03T09:00:00+00:00", source: "app" }],
    };
    const shown = strategySections(rows);
    expect(shown[0]).toMatchObject({ key: "goals", text: "- Grow leads (Instagram posts a week: 2 today, above it by 1 Feb 2027). Why: Calls.", product: "- Grow leads (Instagram posts a week: 2 today, above it by 1 Feb 2027). Why: Calls." });
    expect(shown[1]).toMatchObject({ key: "audience", text: "Drivers hurt in Queens", product: "Drivers" });
    expect(JSON.stringify(shown)).not.toContain("[object Object]");
  });

  it("makes a version that changes with the text and nothing else", async () => {
    expect(await sectionVersion("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(await sectionVersion("a")).toBe(await sectionVersion("a"));
    expect(await sectionVersion("a")).not.toBe(await sectionVersion("a "));
    expect(strategySections({ row: null, edits: [] })).toEqual([]);
  });
});

describe("socialytics_client_notes", () => {
  it("gives the points the copy follows now and the notes, newest first, from Claude or Socialytics", async () => {
    expect(data(await call("socialytics_client_notes", { client_id: BADER }))).toEqual({
      standing_notes: "Always say attorney.",
      points: [
        { kind: "avoid", text: "Never say \"cheap\"", platform: null, date: "2026-10-28", until: null },
        { kind: "upcoming", text: "Office opens in Queens", platform: "Instagram", date: "2026-10-28", until: "2026-12-01" },
      ],
      notes: [
        { note_id: "n2", title: "Brand book.pdf", date: "2026-10-30", added_by: null, added_on: "2026-10-30T12:00:00Z", from: "Socialytics", state: "Reading" },
        { note_id: "n1", title: "Kickoff call", date: "2026-10-28", added_by: "Sinéad Cronin", added_on: "2026-10-28T12:00:00Z", from: "Claude", state: "2 points learned" },
      ],
    });
  });

  it("gives one note's text with note_id, only for a note of that client", async () => {
    expect(data(await call("socialytics_client_notes", { client_id: BADER, note_id: "n1" }))).toEqual({ note_id: "n1", title: "Kickoff call", date: "2026-10-28", added_by: "Sinéad Cronin", from: "Claude", state: "Learned", text: "Never say cheap." });
    expect(await call("socialytics_client_notes", { client_id: BADER, note_id: "n9" })).toEqual({ ok: false, status: 404, code: "not_found", text: "No note with that id for this client." });
  });

  it("gives the start of a very long note and says how long it is", async () => {
    const long = "x".repeat(95_000);
    const r = reads({ note: async () => ({ id: "n1", client_id: BADER, title: "Big", text: long, text_chars: 400_000, note_date: "2026-10-28", source: "app", added_by_name: null, created_at: "2026-10-28T00:00:00Z", state: "learned", kind: "file" }) });
    const out = data(await call("socialytics_client_notes", { client_id: BADER, note_id: "n1" }, STAFF, r));
    expect(out.text.length).toBe(90_000);
    expect(out.text_chars).toBe(400_000);
  });

  it("is for Moburst staff: anyone else reads it as not found", async () => {
    expect(await call("socialytics_client_notes", { client_id: BADER }, CLIENT_USER)).toMatchObject({ ok: false, status: 404, code: "not_found" });
    expect(await call("socialytics_client_notes", { client_id: BADER, note_id: "n1" }, CLIENT_USER)).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });
});

describe("personReads", () => {
  it("reads through the person's client: the calendar window, the worked check, the strategy, the notes and one note", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "rpc:calendar_post_worked") return { data: true };
      if (c.table === "clients" || c.table === "client_notes" && op(c, "maybeSingle")) return { data: { id: BADER } };
      if (c.table === "content_strategies") return { data: { written_at: "x", sections: {}, platforms: [], pillars: [] } };
      return { data: [] };
    });
    const r = personReads(db);
    await r.client(BADER);
    await r.calendarPosts(BADER, "2026-11-02", "2026-11-30");
    expect(await r.worked(BADER, POSTS[0])).toBe(true);
    await r.strategy(BADER);
    await r.notes(BADER);
    await r.note("00000000-0000-4000-8000-00000000000e");
    expect(await r.note("n1")).toBeNull();
    const byTable = (t: string) => calls.filter((c) => c.table === t);
    expect(eqs(byTable("calendar_posts")[0])).toEqual({ client_id: BADER });
    expect(op(byTable("calendar_posts")[0], "gte")).toEqual(["post_date", "2026-11-02"]);
    expect(op(byTable("calendar_posts")[0], "lte")).toEqual(["post_date", "2026-11-30"]);
    expect(op(byTable("rpc:calendar_post_worked")[0], "rpc")).toEqual([{ p_client: BADER, p_key: POSTS[0].post_key, p_platform: "Instagram", p_copy: "Hurt in a crash?", p_touched: null }]);
    expect(eqs(byTable("content_strategy_edits")[0])).toEqual({ client_id: BADER });
    expect(String(op(byTable("content_strategies")[0], "select")?.[0])).toContain("section_texts");
    expect(byTable("client_notes").length).toBe(2);
    expect(String(op(byTable("client_notes")[0], "select")?.[0])).toContain("source");
  });
});
