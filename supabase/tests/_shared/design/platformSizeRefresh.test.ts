// @vitest-environment node
// The weekly platform_sizes job from end to end, with nothing live: the
// guide is a stand-in page (supabase/fixtures/platform-sizes/guide.html),
// the model is a function the test gives, and the database is the real
// migration on PGlite, so what a read changes is what the job's own SQL
// write changes. One bad read never changes a design's size.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { functionsDir } from "../../paths.ts";
import { GUIDE_URL, EXTRACT_TOOL } from "../../../functions/_shared/design/platformSizeRead";
import { SIZES_MODEL, extractAnswer, extractRequest, liveSizeDeps, platformSizesDryRun, refreshPlatformSizes, runPlatformSizes, type SizeDeps } from "../../../functions/_shared/design/platformSizeRefresh";
import type { ScheduledJob } from "../../../functions/_shared/scheduled-jobs/types";

const migration = readFileSync(join(functionsDir, "..", "migrations", "20261117150000_platform_sizes.sql"), "utf8");
const guide = readFileSync(join(functionsDir, "..", "fixtures", "platform-sizes", "guide.html"), "utf8");
const SETUP = `
create role anon; create role authenticated; create role service_role;
create function public.is_oauth_session() returns boolean language sql stable as 'select false';
create function public.is_moburst_staff() returns boolean language sql stable as 'select true';
create table public.design_requests (id uuid primary key default gen_random_uuid());
create table public.canva_finish_jobs (id uuid primary key default gen_random_uuid(), design_request_id uuid, option_index integer, slide_index integer, status text not null default 'queued', input jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, dedupe_key text not null unique, priority smallint not null default 50, status text not null default 'queued', available_at timestamptz not null default now(), finished_at timestamptz);
create schema cron;
create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
`;

let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(SETUP);
  await pg.exec(migration);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec("delete from public.platform_size_reads; delete from public.platform_sizes; delete from public.platform_size_outcomes;");
  await pg.exec(migration);
});

/** The two calls the job makes, on PGlite. */
const db = {
  from: (table: string) => ({
    select: (columns: string) => {
      const q = {
        order: () => q,
        then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => pg.query(`select ${columns} from public.${table} order by platform, format`).then((r) => ok({ data: r.rows, error: null }), no),
      };
      return q;
    },
  }),
  rpc: async (name: string, args: { p_read: unknown }) => {
    try {
      const r = await pg.query<{ out: unknown }>(`select public.${name}($1::jsonb) as out`, [JSON.stringify(args.p_read)]);
      return { data: r.rows[0].out, error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  },
};

type Row = { platform: string; format: string; width: number; height: number; source: string; pending_width: number | null; pending_height: number | null; checked: boolean };
const sizes = async () => (await pg.query<Row>("select platform, format, width, height, source, pending_width, pending_height, checked_at is not null as checked from public.platform_sizes order by platform, format")).rows;
const sizeOf = async (platform: string, format: string) => { const r = (await sizes()).find((x) => x.platform === platform && x.format === format)!; return [r.width, r.height]; };
const reads = async () => (await pg.query<{ ok: boolean; error: string | null; source: string; source_updated: string | null; rows: Array<{ platform: string; format: string; outcome: string; reason?: string }> }>("select ok, error, source, source_updated, rows from public.platform_size_reads order by read_at, id")).rows;

/** The next day: every held size was held the day before (a held size is confirmed only by a read on a later day). */
const nextDay = () => pg.exec("update public.platform_sizes set pending_at = pending_at - interval '1 day' where pending_at is not null");
const c = (width: number, height: number) => ({ width, height, part: "cheat_sheet" });
const s = (width: number, height: number) => ({ width, height, part: "section" });
/** What a model that follows the reading rule answers for the stand-in page. */
const faithful = () => ({ rows: [
  { platform: "facebook", format: "image", sizes: [c(1080, 1350), s(1080, 1080), s(1440, 1800)] },
  { platform: "facebook", format: "story", sizes: [s(1080, 1920)] },
  { platform: "instagram", format: "carousel", sizes: [c(1080, 1080), c(1080, 1350), s(1080, 1080), s(1080, 1350)] },
  { platform: "instagram", format: "image", sizes: [c(1080, 1080), c(1080, 1350), s(1080, 1080), s(1080, 1350)] },
  { platform: "instagram", format: "story", sizes: [s(1080, 1920)] },
  { platform: "linkedin", format: "image", sizes: [c(1200, 627), s(1200, 1200), s(1200, 628)] },
  { platform: "x", format: "image", sizes: [c(1600, 900)] },
] });
const deps = (over: Partial<SizeDeps> & { html?: string; answer?: unknown } = {}): SizeDeps => ({
  fetchGuide: async () => ({ status: 200, html: over.html ?? guide }),
  extract: async () => over.answer ?? faithful(),
  ...over,
});
const job = { id: "job-1", kind: "platform_sizes", attempts: 1 } as unknown as ScheduledJob;

describe("the weekly read of the sizes guide", () => {
  it("leaves every size the table starts with as it is, on the guide as it is, and records the run", async () => {
    const before = await sizes();
    const prompts: string[] = [];
    const out = await runPlatformSizes(db, job, deps({ extract: async (p) => { prompts.push(p); return faithful(); } }));
    expect(out.status).toBe("done");
    expect(out.reason).toBe("Read the sizes guide: 7 sizes, 7 as they were, 0 changed, 0 held for a second read, 0 refused, 0 taken back, 0 tried again.");
    expect((await sizes()).map(({ checked: _c, ...r }) => r)).toEqual(before.map(({ checked: _c, ...r }) => r));
    expect((await sizes()).every((r) => r.checked)).toBe(true);
    const log = await reads();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ ok: true, error: null, source: GUIDE_URL, source_updated: "2026-11-02" });
    expect(log[0].rows.map((r) => r.outcome)).toEqual(Array(7).fill("same"));
    // The model was asked for the table's rows and nothing else.
    expect(prompts).toHaveLength(1);
    expect(prompts[0].match(/^- platform "/gm)).toHaveLength(7);
  });

  it("changes a size that moved a little only when two runs in a row read it", async () => {
    // The guide now says 1080x1440 for Facebook, everywhere it said 1080x1350 or 1440x1800.
    const html = guide.replace("<td>1080&#215;1350 px</td>", "<td>1080&#215;1440 px</td>").replace("1440&#215;1800", "1080&#215;1440");
    const answer = faithful();
    answer.rows[0].sizes = [c(1080, 1440), s(1080, 1080), s(1080, 1440)];
    const first = await runPlatformSizes(db, job, deps({ html, answer }));
    expect(first.reason).toBe("Read the sizes guide: 7 sizes, 6 as they were, 0 changed, 1 held for a second read, 0 refused, 0 taken back, 0 tried again.");
    expect(await sizeOf("facebook", "image")).toEqual([1080, 1350]);
    expect((await sizes()).find((r) => r.platform === "facebook" && r.format === "image")).toMatchObject({ source: "seed", pending_width: 1080, pending_height: 1440 });
    await nextDay();
    const second = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(second.changed).toBe(1);
    expect(await sizeOf("facebook", "image")).toEqual([1080, 1440]);
    expect((await sizes()).filter((r) => r.source === "guide").map((r) => `${r.platform}/${r.format}`)).toEqual(["facebook/image"]);
    expect((await reads()).map((r) => r.rows.find((x) => x.platform === "facebook" && x.format === "image"))).toMatchObject([{ outcome: "held", from: [1080, 1350], to: [1080, 1440] }, { outcome: "confirmed", from: [1080, 1350], to: [1080, 1440] }]);
  });

  it("never writes a size a section mentions for something else on the read that picked it", async () => {
    // The cheat sheet stops listing X's 1600x900, X's section mentions a 1200x675 link card, and the model picks it.
    const html = guide.replace("<td>1600&#215;900 px</td>", "<td>N/A</td>").replace(/(<h2[^>]*>X [^<]*<\/h2>)/, "$1<p>Link cards are shown at 1200&#215;675 pixels.</p>");
    expect(html).toContain("Link cards are shown at 1200&#215;675 pixels.");
    const answer = faithful();
    answer.rows[6].sizes = [s(1200, 675)];
    const run = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(run.changed).toBe(0);
    expect(run.rows.find((r) => r.platform === "x")).toMatchObject({ outcome: "held", from: [1600, 900], to: [1200, 675] });
    expect(await sizeOf("x", "image")).toEqual([1600, 900]);
    // The next read reads the row another way: the held size is gone and X is as it was.
    await refreshPlatformSizes(db, deps());
    expect((await sizes()).find((r) => r.platform === "x")).toMatchObject({ width: 1600, height: 900, source: "seed", pending_width: null, pending_height: null });
  });

  it("changes a size that moved far only when two runs in a row read it", async () => {
    // The guide now says square for X.
    const html = guide.replace("<td>1600&#215;900 px</td>", "<td>1200&#215;1200 px</td>");
    const answer = faithful();
    answer.rows[6].sizes = [c(1200, 1200)];
    const first = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(first.changed).toBe(0);
    expect(await sizeOf("x", "image")).toEqual([1600, 900]);
    expect((await sizes()).find((r) => r.platform === "x")).toMatchObject({ pending_width: 1200, pending_height: 1200 });
    await nextDay();
    const second = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(second.changed).toBe(1);
    expect(await sizeOf("x", "image")).toEqual([1200, 1200]);
    expect((await sizes()).find((r) => r.platform === "x")).toMatchObject({ pending_width: null, source: "guide" });
    expect((await reads()).map((r) => r.rows.find((x) => x.platform === "x")!.outcome)).toEqual(["held", "confirmed"]);
  });

  it("never confirms a size on the day it was held: a retry the same day holds it again (18 Nov 2026)", async () => {
    const html = guide.replace("<td>1600&#215;900 px</td>", "<td>1200&#215;1200 px</td>");
    const answer = faithful();
    answer.rows[6].sizes = [c(1200, 1200)];
    await refreshPlatformSizes(db, deps({ html, answer }));
    const retry = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(retry.changed).toBe(0);
    expect(retry.rows.find((r) => r.platform === "x")).toMatchObject({ outcome: "held", to: [1200, 1200] });
    expect(await sizeOf("x", "image")).toEqual([1600, 900]);
    await nextDay();
    expect((await refreshPlatformSizes(db, deps({ html, answer }))).changed).toBe(1);
    expect(await sizeOf("x", "image")).toEqual([1200, 1200]);
  });

  it("drops a far size read once when the next run reads the size in use again", async () => {
    const html = guide.replace("<td>1600&#215;900 px</td>", "<td>1200&#215;1200 px</td>");
    const answer = faithful();
    answer.rows[6].sizes = [c(1200, 1200)];
    await refreshPlatformSizes(db, deps({ html, answer }));
    await refreshPlatformSizes(db, deps());
    expect((await sizes()).find((r) => r.platform === "x")).toMatchObject({ width: 1600, height: 900, pending_width: null, pending_height: null });
    // Read once more, it is held again, not confirmed.
    await refreshPlatformSizes(db, deps({ html, answer }));
    expect(await sizeOf("x", "image")).toEqual([1600, 900]);
  });

  it("changes nothing for a size the model names that the page does not hold", async () => {
    const answer = faithful();
    answer.rows[3].sizes = [c(1080, 1440), s(1080, 1440)];
    answer.rows[1].sizes = [s(1080, 1350)];
    const before = await sizes();
    const run = await refreshPlatformSizes(db, deps({ answer }));
    // Instagram's cheat sheet cell still names the size in use, so it stays whatever the model said.
    expect(run.rows.find((r) => r.platform === "instagram" && r.format === "image")).toMatchObject({ outcome: "same", read: [[1080, 1440, "cheat_sheet"], [1080, 1440, "section"]] });
    // Facebook's Stories part still writes 1080x1920, so a wrong size from the model changes nothing there either.
    expect(run.rows.find((r) => r.platform === "facebook" && r.format === "story")).toMatchObject({ outcome: "same" });
    expect((await sizes()).map((r) => [r.width, r.height, r.pending_width])).toEqual(before.map((r) => [r.width, r.height, r.pending_width]));
    expect(run.rows.filter((r) => r.outcome === "same")).toHaveLength(7);
  });

  it("keeps LinkedIn's square while the page's own section still writes it, whatever the model left out", async () => {
    // The cheat sheet says 1200x627 for LinkedIn. A model that returns only that, or nothing, changes nothing.
    for (const sizes of [[c(1200, 627)], [c(1200, 627), s(1200, 628)], []]) {
      const answer = faithful();
      answer.rows[5].sizes = sizes;
      const run = await refreshPlatformSizes(db, deps({ answer }));
      expect(run.rows.find((r) => r.platform === "linkedin")).toMatchObject({ outcome: "same" });
    }
    const answer = faithful();
    answer.rows.splice(5, 1);
    await refreshPlatformSizes(db, deps({ answer }));
    expect((await sizes()).find((r) => r.platform === "linkedin")).toMatchObject({ width: 1200, height: 1200, pending_width: null });
  });

  it("refuses a row the model left out when its size is no longer on the page, and reads the rest", async () => {
    // The guide's Stories part for Facebook now says another size; the model gives nothing for that row.
    const html = guide.replace("Recommended image size: 1080&#215;1920 pixels", "Recommended image size: 1080&#215;1900 pixels");
    const answer = faithful();
    answer.rows.splice(1, 1);
    const run = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(run.rows.find((r) => r.platform === "facebook" && r.format === "story")).toMatchObject({ outcome: "refused", reason: "not_read" });
    expect(await sizeOf("facebook", "story")).toEqual([1080, 1920]);
    expect(run.rows.filter((r) => r.outcome === "same")).toHaveLength(6);
  });
});

describe("a size the image model refuses", () => {
  const note = (platform: string, width: number, height: number, outcome: string) => pg.query("select public.note_platform_size_outcome($1, 'image', $2, $3, $4, 'Image model 400')", [platform, width, height, outcome]);
  const usable = async (platform: string) => (await pg.query<{ usable: boolean }>("select usable from public.platform_sizes where platform = $1 and format = 'image'", [platform])).rows[0].usable;
  const confirmed = async (platform: string) => (await pg.query<{ c: boolean }>("select refusal_confirmed_at is not null as c from public.platform_size_outcomes where platform = $1", [platform])).rows.map((r) => r.c);
  const requestReads = async (platform: string) => {
    const { readUploadSize } = await import("../../../functions/_shared/design/platformSizeDb");
    const rows = (await pg.query("select platform, format, width, height, usable from public.platform_sizes")).rows as Array<{ platform: string; format: string }>;
    const table = { from: () => ({ select: () => ({ eq: (_c: string, p: string) => ({ in: (_f: string, formats: string[]) => Promise.resolve({ data: rows.filter((r) => r.platform === p && formats.includes(r.format)), error: null }) }) }) }) };
    return readUploadSize(table, { platform, format: "image" });
  };

  it("is read by no request from the refusal on, and is tried again after the next run that reads the guide", async () => {
    await note("x", 1600, 900, "refusal_confirmed");
    // At once: a new request for X reads no size and is designed on the 4:5 page. Other platforms are untouched.
    expect(await usable("x")).toBe(false);
    expect(await requestReads("Twitter/X")).toBeNull();
    expect(await requestReads("LinkedIn")).toEqual({ platform: "linkedin", format: "image", width: 1200, height: 1200 });
    // A run that cannot read the guide leaves it off.
    await expect(runPlatformSizes(db, job, deps({ fetchGuide: async () => ({ status: 503, html: "" }) }))).rejects.toThrow("The guide answered 503.");
    expect(await usable("x")).toBe(false);
    // The next run that reads the guide still finds 1600x900 listed: the row is read again, and the refusal no longer counts.
    const out = await runPlatformSizes(db, job, deps());
    expect(out.reason).toBe("Read the sizes guide: 7 sizes, 6 as they were, 0 changed, 0 held for a second read, 0 refused, 0 taken back, 1 tried again.");
    expect(await usable("x")).toBe(true);
    expect(await confirmed("x")).toEqual([false]);
    expect(await requestReads("Twitter/X")).toEqual({ platform: "x", format: "image", width: 1600, height: 900 });
    // Refused again by the next design: off again, until the next weekly run. One refused design a week at most.
    await note("x", 1600, 900, "refusal_confirmed");
    expect(await usable("x")).toBe(false);
    const again = await refreshPlatformSizes(db, deps());
    expect(again.rows.find((r) => r.platform === "x")).toMatchObject({ outcome: "retried" });
    // With no new refusal, the following run leaves it on.
    const quiet = await refreshPlatformSizes(db, deps());
    expect(quiet.rows.map((r) => r.outcome)).toEqual(Array(7).fill("same"));
    expect(await usable("x")).toBe(true);
  });

  it("goes back to the size before it, which the model drew, and the guide's refused size is not taken again", async () => {
    // LinkedIn was 1200x1200 (drawn), then the table moved to 1200x628, which the model refuses.
    await note("linkedin", 1200, 1200, "drawn");
    await pg.exec("update public.platform_sizes set width = 1200, height = 628, previous_width = 1200, previous_height = 1200, source = 'guide' where platform = 'linkedin'");
    await note("linkedin", 1200, 628, "refusal_confirmed");
    expect(await usable("linkedin")).toBe(false);
    // The guide now lists only 1200x628 for LinkedIn.
    const html = guide.replace("<td>1200&#215;627 px</td>", "<td>1200&#215;628 px</td>").replace("Recommended size for square images: 1200&#215;1200 pixels", "Square images are no longer recommended");
    const answer = faithful();
    answer.rows[5].sizes = [c(1200, 628), s(1200, 628)];
    // Whether or not the guide can be read.
    await expect(runPlatformSizes(db, job, deps({ fetchGuide: async () => ({ status: 503, html: "" }) }))).rejects.toThrow("The guide answered 503.");
    expect(await sizeOf("linkedin", "image")).toEqual([1200, 1200]);
    expect(await usable("linkedin")).toBe(true);
    const next = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(next.rows.find((r) => r.platform === "linkedin")).toMatchObject({ outcome: "refused", reason: "model_refused", to: [1200, 628] });
    expect(await sizeOf("linkedin", "image")).toEqual([1200, 1200]);
  });

  it("is read again when the model drew it after the refusal", async () => {
    await note("x", 1600, 900, "refusal_confirmed");
    await new Promise((r) => setTimeout(r, 5));
    // A design that was already on its way drew the size.
    await note("x", 1600, 900, "drawn");
    const run = await refreshPlatformSizes(db, deps());
    expect(run.rows.find((r) => r.platform === "x")).toMatchObject({ outcome: "retried" });
    expect(await usable("x")).toBe(true);
  });
});

describe("a read that fails as a whole", () => {
  const failed: Array<[string, Partial<SizeDeps> & { html?: string; answer?: unknown }, RegExp]> = [
    ["the guide cannot be reached", { fetchGuide: async () => { throw new Error("connection reset"); } }, /^The guide could not be fetched: connection reset/],
    ["the guide answers an error", { fetchGuide: async () => ({ status: 503, html: "<html>Service unavailable</html>" }) }, /^The guide answered 503\.$/],
    ["the page is a block page", { html: "<html><body><article><h1>Just a moment</h1><p>Checking your browser.</p></article></body></html>" }, /^The page is not the sizes guide/],
    ["the page is long and holds no size", { html: `<article><h2>Instagram news</h2>${"<p>Nothing about pixels here at all.</p>".repeat(200)}</article>` }, /^The page is not the sizes guide/],
    ["the page holds sizes for no platform the table has", { html: `<article><h2>Pinterest image sizes</h2>${"<p>Pins are 1000&#215;1500 pixels.</p>".repeat(100)}</article>` }, /^The page is not the sizes guide/],
    ["the model cannot be reached", { extract: async () => { throw new Error("Anthropic API error 529"); } }, /^The sizes could not be read from the guide: Anthropic API error 529/],
    ["the model's answer is not the structure", { answer: "I could not find any sizes." }, /^The answer about the guide was not in the form asked for\.$/],
  ];

  for (const [name, over, reason] of failed) {
    it(`changes nothing and says why when ${name}`, async () => {
      // A far size read last week is waiting: a failed run neither confirms nor clears it.
      await pg.exec("update public.platform_sizes set pending_width = 1200, pending_height = 1200, pending_at = now() where platform = 'x'");
      const before = await sizes();
      await expect(runPlatformSizes(db, job, deps(over))).rejects.toThrow(reason);
      expect(await sizes()).toEqual(before);
      const log = await reads();
      expect(log).toHaveLength(1);
      expect(log[0].ok).toBe(false);
      expect(log[0].error).toMatch(reason);
      expect(log[0].rows).toEqual([]);
    });
  }

  it("never calls the model for a page that is not the guide", async () => {
    const extract = vi.fn(async () => faithful());
    await expect(runPlatformSizes(db, job, deps({ html: "<html><body>Access denied</body></html>", extract }))).rejects.toThrow(/not the sizes guide/);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe("a look before the first run", () => {
  it("says what the job would do and writes nothing", async () => {
    const before = await sizes();
    const run = await platformSizesDryRun(db, deps());
    expect(run.ok).toBe(true);
    expect(run.rows.map((r) => r.outcome)).toEqual(Array(7).fill("same"));
    expect(await sizes()).toEqual(before);
    expect(await reads()).toHaveLength(0);
  });
});

describe("the live services", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  // The paying desk reads the key (the function's own secret here); the model call goes to the stubbed fetch.
  beforeEach(() => { vi.stubGlobal("Deno", { env: { get: env } }); });

  const env = (name: string) => (name === "ANTHROPIC_API_KEY" ? "test-key" : undefined);
  const FORCED_REFUSED = { type: "error", error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } };
  /**
   * The guide's site and the model's API, standing in. The API answers as the
   * planning model does: a request that forces a tool (tool_choice of type
   * "tool" or "any") is a 400 with the API's own words; any other request
   * gets `reply`. Every request made is kept.
   */
  const services = (reply: unknown, html = guide) => {
    const calls: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes("api.anthropic.com")) {
        calls.push({ url: String(url), init });
        return new Response(html, { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(url), init, body });
      const choice = (body.tool_choice as { type?: string } | undefined)?.type;
      if (choice === "tool" || choice === "any") return new Response(JSON.stringify(FORCED_REFUSED), { status: 400 });
      return new Response(JSON.stringify(reply), { status: 200 });
    }));
    return calls;
  };
  const called = (input: unknown) => ({ content: [{ type: "thinking", thinking: "" }, { type: "tool_use", name: EXTRACT_TOOL.name, input }], stop_reason: "tool_use" });
  const written = (text: string) => ({ content: [{ type: "thinking", thinking: "" }, { type: "text", text }], stop_reason: "end_turn" });

  it("fetch the guide with a plain GET and ask the planning model to call the tool, never forcing it", async () => {
    const calls = services(called(faithful()));
    const live = liveSizeDeps(env);
    const page = await live.fetchGuide(GUIDE_URL);
    expect(page.status).toBe(200);
    expect(calls[0].url).toBe(GUIDE_URL);
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(await live.extract("the instruction")).toEqual(faithful());
    const body = calls[1].body!;
    expect(calls[1].url).toBe("https://api.anthropic.com/v1/messages");
    expect(body).toEqual(extractRequest("the instruction"));
    expect(body.model).toBe(SIZES_MODEL);
    expect(SIZES_MODEL).toBe("claude-opus-5-5");
    // This model answers a forced tool choice with a 400: the model chooses, and the tool is strict.
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.tools).toEqual([EXTRACT_TOOL]);
    expect(EXTRACT_TOOL.strict).toBe(true);
    // Thinking counts toward the limit, so it is far above the answer's own length.
    expect(body.max_tokens).toBeGreaterThanOrEqual(8000);
    expect(body.messages).toEqual([{ role: "user", content: "the instruction" }]);
    // Nothing this model refuses outright: a forced tool, thinking switched off or budgeted, sampling settings, a prefilled answer.
    for (const refused of ["thinking", "temperature", "top_p", "top_k"]) expect(body).not.toHaveProperty(refused);
  });

  it("the whole job reads the guide against an API that refuses a forced tool, as the planning model does", async () => {
    const before = await sizes();
    const calls = services(called(faithful()));
    const out = await runPlatformSizes(db, job, liveSizeDeps(env));
    expect(out.status).toBe("done");
    expect(out.reason).toContain("7 sizes, 7 as they were, 0 changed");
    expect((await sizes()).map(({ checked: _c, ...r }) => r)).toEqual(before.map(({ checked: _c, ...r }) => r));
    expect((await reads())[0]).toMatchObject({ ok: true, error: null });
    // One request to the model, accepted as sent: no retry, nothing dropped.
    const asked = calls.filter((c) => c.body);
    expect(asked).toHaveLength(1);
    expect(asked[0].body!.tool_choice).toEqual({ type: "auto" });
    // The instruction itself asks for the call, since nothing else makes the model call it.
    const prompt = String((asked[0].body!.messages as Array<{ content: string }>)[0].content);
    expect(prompt).toContain(`Answer by calling the ${EXTRACT_TOOL.name} tool exactly once, with every row.`);
    expect(prompt.match(/^- platform "/gm)).toHaveLength(7);
  });

  it("read an answer written as JSON text, and fail without a key", async () => {
    services(written(`Here are the sizes.\n${JSON.stringify(faithful())}`));
    expect(await liveSizeDeps(env).extract("x")).toEqual(faithful());
    const out = await runPlatformSizes(db, job, liveSizeDeps(env));
    expect(out.status).toBe("done");
    expect((await reads())[0].rows.map((r) => r.outcome)).toEqual(Array(7).fill("same"));
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    await expect(liveSizeDeps(() => undefined).extract("x")).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
  });

  it("a size the answer names is written only when the page holds it and two reads gave it, through the tool as through text", async () => {
    // Facebook's size moved a little on the page. The answer says so, and also gives X a size the page does not hold.
    const html = guide.replace("<td>1080&#215;1350 px</td>", "<td>1080&#215;1440 px</td>").replace("1440&#215;1800", "1080&#215;1440");
    const answer = faithful();
    answer.rows[0].sizes = [c(1080, 1440), s(1080, 1080), s(1080, 1440)];
    answer.rows[6].sizes = [c(1200, 1200), s(1200, 1200)];
    for (const reply of [called(answer), written(JSON.stringify(answer))]) {
      await pg.exec("delete from public.platform_size_reads; delete from public.platform_sizes;");
      await pg.exec(migration);
      const before = await sizes();
      services(reply, html);
      // The first read writes no size: Facebook's waits, X's is not on the page.
      expect((await runPlatformSizes(db, job, liveSizeDeps(env))).status).toBe("done");
      expect((await sizes()).map((r) => [r.width, r.height, r.source])).toEqual(before.map((r) => [r.width, r.height, r.source]));
      expect((await sizes()).filter((r) => r.pending_width !== null).map((r) => [r.platform, r.format, r.pending_width, r.pending_height])).toEqual([["facebook", "image", 1080, 1440]]);
      // The next day's read gives the same: Facebook's is written, and nothing else.
      await nextDay();
      expect((await runPlatformSizes(db, job, liveSizeDeps(env))).status).toBe("done");
      expect(await sizeOf("facebook", "image")).toEqual([1080, 1440]);
      expect(await sizeOf("x", "image")).toEqual([1600, 900]);
      expect((await sizes()).filter((r) => r.source === "guide").map((r) => `${r.platform}/${r.format}`)).toEqual(["facebook/image"]);
      expect((await sizes()).every((r) => r.pending_width === null)).toBe(true);
    }
  });

  const unreadable: Array<[string, unknown, RegExp]> = [
    ["the tool is called with rows that are not a list", called({ rows: JSON.stringify(faithful().rows) }), /^The answer about the guide was not in the form asked for\.$/],
    ["the tool is called with nothing", called({}), /^The answer about the guide was not in the form asked for\.$/],
    ["the model answers in words", written("I could not find a cheat sheet on this page."), /^The answer about the guide was not in the form asked for\.$/],
    ["the model writes JSON that is not the structure", written(`{"sizes":[{"width":1200,"height":1200}]}`), /^The answer about the guide was not in the form asked for\.$/],
    // A reply that ended on a refusal, with nothing in it or with a whole answer in hand, is no answer.
    ["the model declines", { content: [], stop_reason: "refusal" }, /^The sizes could not be read from the guide: The model declined to read the guide\./],
    ["the model declines after part of an answer", { ...called({ rows: [{ platform: "x", format: "image", sizes: [c(1200, 1200)] }] }), stop_reason: "refusal" }, /^The sizes could not be read from the guide: The model declined to read the guide\./],
    // Cut off at the token limit with a whole, well-formed part of the answer in hand: X far from its size, which a read would hold.
    ["the answer is cut off, whatever part of it arrived", { ...called({ rows: [{ platform: "x", format: "image", sizes: [c(1200, 1200)] }] }), stop_reason: "max_tokens" }, /^The sizes could not be read from the guide: The answer was cut off before it ended\./],
  ];
  for (const [name, reply, reason] of unreadable) {
    it(`write no size and record why when ${name}`, async () => {
      // X's size is gone from the page and a far size read last week is waiting: nothing of either moves.
      await pg.exec("update public.platform_sizes set pending_width = 1200, pending_height = 1200, pending_at = now() where platform = 'x'");
      const before = await sizes();
      services(reply, guide.replace("<td>1600&#215;900 px</td>", "<td>1200&#215;1200 px</td>"));
      await expect(runPlatformSizes(db, job, liveSizeDeps(env))).rejects.toThrow(reason);
      expect(await sizes()).toEqual(before);
      const log = await reads();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ ok: false, rows: [] });
      expect(log[0].error).toMatch(reason);
    });
  }

  it("say what the model answered out of its reply", () => {
    const result = (raw: { content: Array<Record<string, unknown>>; stop_reason: string }) => ({ raw, stopReason: raw.stop_reason, text: raw.content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n") });
    expect(extractAnswer(result(called({ rows: [] })))).toEqual({ rows: [] });
    // The tool's input is the answer even with words around it; another tool's input is not.
    expect(extractAnswer(result({ content: [{ type: "text", text: `{"rows":[1]}` }, { type: "tool_use", name: EXTRACT_TOOL.name, input: { rows: [] } }], stop_reason: "tool_use" }))).toEqual({ rows: [] });
    expect(extractAnswer(result({ content: [{ type: "tool_use", name: "another_tool", input: { rows: [] } }], stop_reason: "tool_use" }))).toBeNull();
    expect(extractAnswer(result(written("no sizes")))).toBeNull();
    expect(() => extractAnswer(result({ ...written(`{"rows":[]}`), stop_reason: "max_tokens" }))).toThrow("cut off");
    expect(() => extractAnswer(result({ ...called(faithful()), stop_reason: "refusal" }))).toThrow("declined");
    expect(() => extractAnswer(result({ ...written(JSON.stringify(faithful())), stop_reason: "refusal" }))).toThrow("declined");
  });
});
