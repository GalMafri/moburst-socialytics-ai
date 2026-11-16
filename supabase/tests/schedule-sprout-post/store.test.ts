// @vitest-environment node
// The claim and lease rules of schedule-sprout-post's row store (store.ts)
// against a table that holds the one-held-row-per-post index
// (20261113100710_scheduled_posts_sending.sql): a send that never asked
// Sprout anything is released once its run is over, one that asked is held
// until a person sends the post again, and only once that run is over.
import { describe, expect, it } from "vitest";
import { sendToSprout, type SendRequest } from "../../functions/schedule-sprout-post/send";
import { sentStore, SUPERSEDED_REASON } from "../../functions/schedule-sprout-post/store";
import { SEND_RUN_LIMIT_MS } from "../../functions/_shared/sprout/sendWindow";
import { sendStateOf } from "../../../src/components/reports/SchedulePostModal";

type Row = Record<string, unknown>;

/** A scheduled_posts table behind the slice of the Supabase client the store uses, with the held-row index. */
function table() {
  const rows: Row[] = [];
  let n = 0;
  let failInsert = false;
  const held = (r: Row) => r.status === "sending" || r.status === "asked" || r.status === "unconfirmed";
  /** The after-update and after-delete triggers of 20261113103300_scheduled_posts_supersedes.sql (their cases run against the real SQL in supabase/tests/migrations): a send that ended without a post id puts the row it superseded back as unconfirmed, unless another send holds the post. */
  const reopenEarlier = (closed: Row) => {
    if (!closed.supersedes || closed.sprout_post_id || closed.failure_reason === SUPERSEDED_REASON) return;
    const e = rows.find((r) => r.id === closed.supersedes);
    if (!e || e.status !== "failed" || e.failure_reason !== SUPERSEDED_REASON || e.sprout_post_id) return;
    if (rows.some((r) => held(r) && r.client_id === e.client_id && r.calendar_post_key === e.calendar_post_key)) return;
    Object.assign(e, { status: "unconfirmed", failure_reason: null });
  };
  const db = {
    /** Make every insert fail with a connection error, as a lost database connection does. */
    failInserts(on = true) { failInsert = on; },
    from(_name: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let mode: "select" | "update" | "delete" | "insert" = "select";
      let patch: Row = {};
      let toInsert: Row = {};
      const run = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          const held = (r: Row) => r.status === "sending" || r.status === "asked" || r.status === "unconfirmed";
          // The one-held-row-per-post index also refuses an update that would make a second row held.
          if (held(patch) && hit.some((h) => rows.some((r) => r !== h && held(r) && r.client_id === h.client_id && r.calendar_post_key === h.calendar_post_key && h.calendar_post_key))) {
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          const was = hit.map((r) => ({ ...r }));
          hit.forEach((r) => Object.assign(r, patch));
          was.forEach((old, i) => { if (old.status !== "failed" && hit[i].status === "failed") reopenEarlier(hit[i]); });
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        if (mode === "delete") {
          const gone = hit.map((r) => ({ ...r }));
          hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
          gone.forEach((r) => { if (r.status !== "failed") reopenEarlier(r); });
          return { data: null, error: null };
        }
        if (mode === "insert") {
          if (failInsert) return { data: null, error: { code: "08006", message: "connection lost" } };
          const held = (r: Row) => r.status === "sending" || r.status === "asked" || r.status === "unconfirmed";
          // The before-insert trigger of 20261113103300_scheduled_posts_supersedes.sql: the row this one supersedes is
          // closed in the same statement, so an insert the index refuses (or that fails any other way) leaves it as it was.
          const earlier = toInsert.supersedes
            ? rows.find((r) => r.id === toInsert.supersedes && r.client_id === toInsert.client_id && r.calendar_post_key === toInsert.calendar_post_key && !r.sprout_post_id && (r.status === "unconfirmed" || r.status === "asked"))
            : undefined;
          const before = earlier ? { ...earlier } : null;
          if (earlier) Object.assign(earlier, { status: "failed", failure_reason: SUPERSEDED_REASON });
          if (held(toInsert) && toInsert.calendar_post_key && rows.some((r) => held(r) && r.client_id === toInsert.client_id && r.calendar_post_key === toInsert.calendar_post_key)) {
            if (earlier && before) Object.assign(earlier, before);
            return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          const row = { id: `row-${++n}`, created_at: new Date().toISOString(), ...toInsert, ...(toInsert.supersedes && !earlier ? { supersedes: null } : {}) };
          rows.push(row);
          return { data: { id: row.id }, error: null };
        }
        return { data: hit, error: null };
      };
      const q = {
        select: () => q,
        update: (p: Row) => { mode = "update"; patch = p; return q; },
        delete: () => { mode = "delete"; return q; },
        insert: (r: Row) => { mode = "insert"; toInsert = r; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
        lt: (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return q; },
        gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
        limit: () => q,
        single: () => q,
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
      };
      return q;
    },
  };
  return { rows, db };
}

const KEY = "post:5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17";
const row = (status = "sending") => ({ client_id: "c1", calendar_post_key: KEY, status, scheduled_time: "2026-11-09T23:45:00Z" });
/** Long enough ago that the send that wrote the row can no longer be running (the function's own time limit). */
const PAST_RUN = () => new Date(Date.now() - SEND_RUN_LIMIT_MS - 60_000).toISOString();
const LONG_AGO = PAST_RUN;

describe("claiming a post's send", () => {
  it("writes a row, and refuses a second while the first is held", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    expect(await s.claim(row())).toEqual({ id: "row-1" });
    expect(await s.claim(row())).toBe("taken");
    expect(rows).toHaveLength(1);
  });

  it("releases a stale row that never asked Sprout, and records why", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "old", created_at: LONG_AGO(), ...row("sending") });
    expect(await s.claim(row())).toEqual({ id: "row-1" });
    expect(rows.find((r) => r.id === "old")).toMatchObject({ status: "failed", failure_reason: expect.any(String) });
  });

  it("keeps a row that is still inside its lease", async () => {
    const { db, rows } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "live", created_at: new Date().toISOString(), ...row("sending") });
    expect(await s.claim(row())).toBe("taken");
  });

  it("never releases a stale row that asked Sprout, however old it is", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "old", created_at: new Date(Date.now() - 30 * 24 * 3_600_000).toISOString(), ...row("asked") });
    expect(await s.claim(row())).toBe("taken");
    expect(rows.find((r) => r.id === "old")).toMatchObject({ status: "asked" });
  });
});

describe("sending again a post whose send was never confirmed", () => {
  it("closes the one asked row the person saw, and sends; a second press with the same row finds the new send held", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "old", created_at: PAST_RUN(), ...row("asked") });
    expect(await s.claim(row(), { supersede: "old" })).toEqual({ id: "row-1" });
    expect(rows.find((r) => r.id === "old")).toMatchObject({ status: "failed", failure_reason: expect.any(String) });
    expect(await s.claim(row(), { supersede: "old" })).toBe("taken");
  });

  it("leaves an asked row alone while the send that wrote it can still be running", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "live", created_at: new Date().toISOString(), ...row("asked") });
    expect(await s.claim(row(), { supersede: "live" })).toBe("taken");
    expect(rows.find((r) => r.id === "live")).toMatchObject({ status: "asked" });
    expect(rows).toHaveLength(1);
  });

  it("closes a row whose send ended without Sprout's answer at once, since that send writes nothing more", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    expect(await s.claim(row(), { supersede: "ended" })).toEqual({ id: "row-1" });
    expect(rows.find((r) => r.id === "ended")).toMatchObject({ status: "failed", failure_reason: expect.any(String) });
  });

  it("leaves an asked row that has a post id, and any other row, alone", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "known", created_at: PAST_RUN(), sprout_post_id: "77", ...row("asked") });
    expect(await s.claim(row(), { supersede: "known" })).toBe("taken");
    expect(await s.claim(row(), { supersede: "someone-else" })).toBe("taken");
    expect(rows.find((r) => r.id === "known")).toMatchObject({ status: "asked" });
  });
});

describe("a new send that superseded an unconfirmed row", () => {
  it("puts the earlier row back as unconfirmed when the new send settles as failed, so the post keeps reading as unconfirmed", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    const claimed = await s.claim(row(), { supersede: "ended" });
    expect(claimed).toEqual({ id: "row-1" });
    expect(rows.find((r) => r.id === "ended")).toMatchObject({ status: "failed" });
    expect(await s.settle("row-1", { status: "failed", failure_reason: "Sprout did not make the post: 400 no" }, "sending")).toBe(true);
    expect(rows.find((r) => r.id === "row-1")).toMatchObject({ status: "failed" });
    const earlier = rows.find((r) => r.id === "ended") as { id: string; created_at: string; status: string; failure_reason?: unknown };
    expect(earlier.status).toBe("unconfirmed");
    expect(earlier.failure_reason ?? null).toBeNull();
    expect(sendStateOf(earlier as never)).toBe("unconfirmed");
  });

  it("does the same for an asked row whose run was over", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "old", created_at: PAST_RUN(), ...row("asked") });
    await s.claim(row(), { supersede: "old" });
    await s.settle("row-1", { status: "failed", failure_reason: "x" }, "sending");
    expect(rows.find((r) => r.id === "old")).toMatchObject({ status: "unconfirmed" });
  });

  it("leaves the earlier row closed when the new send is sent, or is unconfirmed itself", async () => {
    const sent = table();
    const a = sentStore(sent.db, { waits: [] });
    sent.rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    await a.claim(row(), { supersede: "ended" });
    await a.settle("row-1", { sprout_post_id: "9", status: "scheduled" }, "sending");
    expect(sent.rows.find((r) => r.id === "ended")).toMatchObject({ status: "failed" });

    const lost = table();
    const b = sentStore(lost.db, { waits: [] });
    lost.rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    await b.claim(row(), { supersede: "ended" });
    await b.settle("row-1", { status: "unconfirmed" }, "sending");
    expect(lost.rows.find((r) => r.id === "ended")).toMatchObject({ status: "failed" });
  });

  it("leaves other rows alone when a send that superseded nothing settles as failed", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "closed", created_at: PAST_RUN(), ...row("failed") });
    await s.claim(row(), {});
    await s.settle("row-1", { status: "failed", failure_reason: "x" }, "sending");
    expect(rows.find((r) => r.id === "closed")).toMatchObject({ status: "failed" });
  });

  it("through the handler: a refusal by Sprout leaves the post unconfirmed, and a made post leaves it sent", async () => {
    g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s" } as Record<string, string>)[k] } };
    try {
      const t = table();
      t.rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
      const refusing = (async (url: string) => {
        if (url.includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "t" }));
        if (url.endsWith("/metadata/customer")) return new Response(JSON.stringify({ data: [{ customer_profile_id: 5719052, groups: [1] }] }));
        return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
      }) as unknown as typeof fetch;
      expect(await sendToSprout({ ...request, supersede: "ended" }, sentStore(t.db, { waits: [] }), { fetchImpl: refusing, waits: [0] })).toMatchObject({ status: 500, body: { code: "post_not_made" } });
      expect(t.rows.find((r) => r.id === "ended")).toMatchObject({ status: "unconfirmed" });
      expect(t.rows.filter((r) => r.id !== "ended")).toEqual([expect.objectContaining({ status: "failed" })]);
      expect(sendStateOf(t.rows.find((r) => r.id === "ended") as never)).toBe("unconfirmed");
    } finally {
      delete g.Deno;
    }
  });

  const request: SendRequest = {
    clientId: "c1", reportId: null, calendarPostKey: KEY,
    profile: { rowId: "sp", sproutProfileId: 5719052, networkType: "linkedin_company" },
    platform: "LinkedIn", text: "A post.", mediaUrls: [], scheduledTime: "2099-11-09T23:45:00.000Z", customerId: "1676448", createdBy: null,
  };
  const g = globalThis as { Deno?: unknown };
});

describe("a new send that made nothing in Sprout puts the earlier unconfirmed row back, whichever way it ends", () => {
  const earlier = (rows: Row[]) => rows.find((r) => r.id === "ended") as { status: string; failure_reason?: unknown };

  it("when the send cannot be started and its row is dropped", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    const claimed = await s.claim(row(), { supersede: "ended" });
    expect(claimed).toEqual({ id: "row-1" });
    expect(earlier(rows).status).toBe("failed");
    await s.drop("row-1");
    expect(rows.map((r) => r.id)).toEqual(["ended"]);
    expect(earlier(rows).status).toBe("unconfirmed");
    expect(earlier(rows).failure_reason ?? null).toBeNull();
  });

  it("when a later press closes the stuck new send as one that did not start, and the post is not sent again without the warning", async () => {
    const { rows, db } = table();
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    const s = sentStore(db, { waits: [] });
    expect(await s.claim(row(), { supersede: "ended" })).toEqual({ id: "row-1" });
    (rows.find((r) => r.id === "row-1") as Row).created_at = PAST_RUN();
    // The run died before it settled or dropped its row. The next press closes the stuck row, and the post reads unconfirmed again.
    expect(await sentStore(db, { waits: [] }).claim(row())).toBe("taken");
    expect(rows.find((r) => r.id === "row-1")).toMatchObject({ status: "failed", failure_reason: "The send did not start." });
    expect(earlier(rows).status).toBe("unconfirmed");
  });

  it("when the new row cannot be written at all", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    db.failInserts();
    expect(await s.claim(row(), { supersede: "ended" })).toBeNull();
    expect(earlier(rows).status).toBe("unconfirmed");
  });

  it("when another press with the same row won the post, and the winner fails later in a different run", async () => {
    const { rows, db } = table();
    rows.push({ id: "ended", created_at: new Date().toISOString(), ...row("unconfirmed") });
    const first = sentStore(db, { waits: [] });
    const second = sentStore(db, { waits: [] });
    expect(await first.claim(row(), { supersede: "ended" })).toEqual({ id: "row-1" });
    expect(await second.claim(row(), { supersede: "ended" })).toBe("taken");
    expect(earlier(rows).status).toBe("failed");
    // The row says which row it superseded, so a run that never saw the claim puts the earlier row back.
    const later = sentStore(db, { waits: [] });
    expect(await later.settle("row-1", { status: "failed", failure_reason: "x" }, "sending")).toBe(true);
    expect(earlier(rows).status).toBe("unconfirmed");
  });

  it("and writes no link on a send that superseded nothing", async () => {
    const { rows, db } = table();
    rows.push({ id: "known", created_at: new Date().toISOString(), ...row("asked"), sprout_post_id: "p1" });
    const s = sentStore(db, { waits: [] });
    expect(await s.claim(row(), { supersede: "known" })).toBe("taken");
    rows.length = 0;
    expect(await s.claim(row(), { supersede: "nothing" })).toEqual({ id: "row-1" });
    expect(rows[0].supersedes ?? null).toBeNull();
  });
});

describe("a row's last write", () => {
  it("never reopens a row that was closed while its send was out", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "closed", created_at: PAST_RUN(), failure_reason: "Sprout never confirmed the post, and it was sent again.", ...row("failed") });
    expect(await s.settle("closed", { sprout_post_id: "9", status: "scheduled" }, "asked")).toBe(false);
    expect(rows.find((r) => r.id === "closed")).toMatchObject({ status: "failed" });
    expect(rows.find((r) => r.id === "closed")).not.toHaveProperty("sprout_post_id");
  });

  it("writes a row that is still in the state the send left it in", async () => {
    const { rows, db } = table();
    const s = sentStore(db, { waits: [] });
    rows.push({ id: "out", created_at: new Date().toISOString(), ...row("asked") });
    expect(await s.settle("out", { sprout_post_id: "9", status: "scheduled" }, "asked")).toBe(true);
    expect(rows.find((r) => r.id === "out")).toMatchObject({ status: "scheduled", sprout_post_id: "9" });
  });
});

describe("a send after an earlier one whose outcome is unknown", () => {
  const request: SendRequest = {
    clientId: "c1", reportId: null, calendarPostKey: KEY,
    profile: { rowId: "sp", sproutProfileId: 5719052, networkType: "linkedin_company" },
    platform: "LinkedIn", text: "A post.", mediaUrls: [], scheduledTime: "2099-11-09T23:45:00.000Z", customerId: "1676448", createdBy: null,
  };
  const g = globalThis as { Deno?: unknown };
  function sproutFetch() {
    const posts: unknown[] = [];
    const fetchImpl = (async (url: string) => {
      if (url.includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "t" }));
      if (url.endsWith("/metadata/customer")) return new Response(JSON.stringify({ data: [{ customer_profile_id: 5719052, groups: [1] }] }));
      posts.push(url);
      return new Response(JSON.stringify({ data: [{ customer_profile_id: "5719052", internal: { publishing: { publishing_post_id: 9 } } }] }));
    }) as unknown as typeof fetch;
    return { posts, fetchImpl };
  }

  it("does not make a second draft for a stale asked row, and makes one for a stale row that was never asked", async () => {
    g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s" } as Record<string, string>)[k] } };
    try {
      const asked = table();
      asked.rows.push({ id: "old", created_at: LONG_AGO(), ...row("asked") });
      const one = sproutFetch();
      expect(await sendToSprout(request, sentStore(asked.db, { waits: [] }), { fetchImpl: one.fetchImpl, waits: [0] })).toMatchObject({ status: 409, body: { code: "send_in_progress" } });
      expect(one.posts).toEqual([]);

      const unasked = table();
      unasked.rows.push({ id: "old", created_at: LONG_AGO(), ...row("sending") });
      const two = sproutFetch();
      expect(await sendToSprout(request, sentStore(unasked.db, { waits: [] }), { fetchImpl: two.fetchImpl, waits: [0] })).toMatchObject({ status: 200, body: { success: true } });
      expect(two.posts).toHaveLength(1);
    } finally {
      delete g.Deno;
    }
  });

  it("sends nothing when the person sends again an asked row whose send can still be running", async () => {
    g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s" } as Record<string, string>)[k] } };
    try {
      const t = table();
      t.rows.push({ id: "live", created_at: new Date().toISOString(), ...row("asked") });
      const sprout = sproutFetch();
      expect(await sendToSprout({ ...request, supersede: "live" }, sentStore(t.db, { waits: [] }), { fetchImpl: sprout.fetchImpl, waits: [0] })).toMatchObject({ status: 409, body: { code: "send_in_progress" } });
      expect(sprout.posts).toEqual([]);
      expect(t.rows).toEqual([expect.objectContaining({ id: "live", status: "asked" })]);
    } finally {
      delete g.Deno;
    }
  });

  it("leaves a row closed while Sprout was making the post closed, and says the send was not recorded", async () => {
    g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s" } as Record<string, string>)[k] } };
    try {
      const t = table();
      const posts: unknown[] = [];
      const fetchImpl = (async (url: string) => {
        if (url.includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "t" }));
        if (url.endsWith("/metadata/customer")) return new Response(JSON.stringify({ data: [{ customer_profile_id: 5719052, groups: [1] }] }));
        posts.push(url);
        // Another press closed this send's row while Sprout was answering.
        t.rows.forEach((r) => { if (r.status === "asked") Object.assign(r, { status: "failed", failure_reason: "Sprout never confirmed the post, and it was sent again." }); });
        return new Response(JSON.stringify({ data: [{ customer_profile_id: "5719052", internal: { publishing: { publishing_post_id: 9 } } }] }));
      }) as unknown as typeof fetch;
      const reply = await sendToSprout(request, sentStore(t.db, { waits: [] }), { fetchImpl, waits: [0] });
      expect(posts).toHaveLength(1);
      expect(reply).toMatchObject({ status: 200, body: { recorded: false } });
      expect(t.rows).toEqual([expect.objectContaining({ status: "failed" })]);
    } finally {
      delete g.Deno;
    }
  });

  it("reads a send whose Sprout call ended without an answer as unconfirmed at once, and a press with supersede makes exactly one new draft", async () => {
    g.Deno = { env: { get: (k: string) => ({ SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "s" } as Record<string, string>)[k] } };
    try {
      const t = table();
      const lost = sproutFetch();
      const losing = (async (url: string, init: RequestInit) => {
        if (url.endsWith("/publishing/posts")) throw new TypeError("connection reset");
        return lost.fetchImpl(url, init);
      }) as unknown as typeof fetch;
      expect(await sendToSprout(request, sentStore(t.db, { waits: [] }), { fetchImpl: losing, waits: [0] })).toMatchObject({ status: 500, body: { code: "post_not_confirmed" } });
      expect(t.rows).toEqual([expect.objectContaining({ status: "unconfirmed" })]);
      const first = t.rows[0] as { id: string; created_at: string; status: string };
      expect(sendStateOf(first)).toBe("unconfirmed");

      const again = sproutFetch();
      expect(await sendToSprout({ ...request, supersede: first.id }, sentStore(t.db, { waits: [] }), { fetchImpl: again.fetchImpl, waits: [0] })).toMatchObject({ status: 200, body: { success: true, recorded: true } });
      expect(again.posts).toHaveLength(1);
      expect(t.rows.find((r) => r.id === first.id)).toMatchObject({ status: "failed" });
      expect(t.rows.filter((r) => r.status === "scheduled")).toHaveLength(1);
    } finally {
      delete g.Deno;
    }
  });
});
