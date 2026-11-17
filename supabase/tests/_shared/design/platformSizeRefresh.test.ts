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
import { SIZES_MODEL, liveSizeDeps, platformSizesDryRun, refreshPlatformSizes, runPlatformSizes, type SizeDeps } from "../../../functions/_shared/design/platformSizeRefresh";
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

  it("changes a size at once when the guide's size moved a little", async () => {
    // The guide now says 1080x1440 for Facebook, everywhere it said 1080x1350 or 1440x1800.
    const html = guide.replace("<td>1080&#215;1350 px</td>", "<td>1080&#215;1440 px</td>").replace("1440&#215;1800", "1080&#215;1440");
    const answer = faithful();
    answer.rows[0].sizes = [c(1080, 1440), s(1080, 1080), s(1080, 1440)];
    const run = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(run.changed).toBe(1);
    expect(await sizeOf("facebook", "image")).toEqual([1080, 1440]);
    expect((await sizes()).filter((r) => r.source === "guide").map((r) => `${r.platform}/${r.format}`)).toEqual(["facebook/image"]);
    expect((await reads())[0].rows.find((r) => r.platform === "facebook" && r.format === "image")).toMatchObject({ outcome: "changed", from: [1080, 1350], to: [1080, 1440] });
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
    const second = await refreshPlatformSizes(db, deps({ html, answer }));
    expect(second.changed).toBe(1);
    expect(await sizeOf("x", "image")).toEqual([1200, 1200]);
    expect((await sizes()).find((r) => r.platform === "x")).toMatchObject({ pending_width: null, source: "guide" });
    expect((await reads()).map((r) => r.rows.find((x) => x.platform === "x")!.outcome)).toEqual(["held", "confirmed"]);
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

  it("fetch the guide with a plain GET and ask the planning model through the tool", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("api.anthropic.com")) {
        return new Response(JSON.stringify({ content: [{ type: "text", text: "Reading." }, { type: "tool_use", name: EXTRACT_TOOL.name, input: faithful() }], stop_reason: "tool_use" }), { status: 200 });
      }
      return new Response(guide, { status: 200 });
    }));
    const live = liveSizeDeps((name) => (name === "ANTHROPIC_API_KEY" ? "test-key" : undefined));
    const page = await live.fetchGuide(GUIDE_URL);
    expect(page.status).toBe(200);
    expect(calls[0].url).toBe(GUIDE_URL);
    expect(calls[0].init?.method ?? "GET").toBe("GET");
    expect(await live.extract("the instruction")).toEqual(faithful());
    const body = JSON.parse(String(calls[1].init?.body));
    expect(calls[1].url).toBe("https://api.anthropic.com/v1/messages");
    expect(body.model).toBe(SIZES_MODEL);
    expect(SIZES_MODEL).toBe("claude-opus-5-5");
    expect(body.tools).toEqual([EXTRACT_TOOL]);
    expect(body.tool_choice).toEqual({ type: "tool", name: EXTRACT_TOOL.name });
    expect(body.messages).toEqual([{ role: "user", content: "the instruction" }]);
  });

  it("read an answer written as JSON text, and fail without a key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: `{"rows":[]}` }] }), { status: 200 })));
    expect(await liveSizeDeps(() => "k").extract("x")).toEqual({ rows: [] });
    await expect(liveSizeDeps(() => undefined).extract("x")).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
  });
});
