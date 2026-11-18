// @vitest-environment node
// The video rows of platform_sizes (18 Nov 2026): the two migrations applied
// twice to PGlite, the video specs guide read from a stand-in page with the
// guide's structure (supabase/fixtures/platform-sizes/video-guide.html), and
// the daily job from end to end. The image rows go on being read from the
// image sizes guide exactly as before; a video size changes only on two
// reads on different days.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../../paths.ts";
import { GUIDE_URL, guideText } from "../../../functions/_shared/design/platformSizeRead";
import { readVideoGuide, refreshPlatformSizes, runPlatformSizes, type SizeDeps } from "../../../functions/_shared/design/platformSizeRefresh";
import { VIDEO_GUIDE_URL, cellSizes, decideVideo, israelDay, videoCell, videoGuideParts, videoTable, type VideoSizeRow } from "../../../functions/_shared/video/videoSizeRead";
import type { ScheduledJob } from "../../../functions/_shared/scheduled-jobs/types";

// Heavy: a database per file. Give the event loop a turn between tests.
afterEach(() => new Promise<void>((r) => setImmediate(r)));

const read = (name: string) => readFileSync(join(functionsDir, "..", name), "utf8");
const base = read("migrations/20261117150000_platform_sizes.sql");
const videos = read("migrations/20261118150000_video_platform_sizes.sql");
const imageGuide = read("fixtures/platform-sizes/guide.html");
const videoGuide = read("fixtures/platform-sizes/video-guide.html");
const text = guideText(videoGuide);
const parts = videoGuideParts(text, [{ platform: "youtube" }]);

const row = (platform: string, format: "video" | "short_video", width: number, height: number, pending: [number, number] | null = null, pendingAt: string | null = null): VideoSizeRow =>
  ({ platform, format, width, height, pending_width: pending?.[0] ?? null, pending_height: pending?.[1] ?? null, pending_at: pendingAt });
const NOW = new Date("2026-11-18T08:00:00Z");

describe("the video guide's table", () => {
  it("is read from the header with a Recommended resolution column", () => {
    const table = videoTable(text);
    expect(table.map((r) => r.label)).toContain("YouTube Shorts");
    expect(table.find((r) => r.label === "YouTube")?.cell).toBe("1920×1080 (up to 7680×4320)");
    expect(parts.known).toBe(true);
    expect(videoTable("## Nothing\nA | B\n1 | 2")).toEqual([]);
  });

  it("gives each row the cell of its platform's organic row: Reels and Shorts for a short video, any other for a video", () => {
    const t = parts.table;
    expect(videoCell({ platform: "youtube", format: "video" }, t)).toBe("1920×1080 (up to 7680×4320)");
    expect(videoCell({ platform: "youtube", format: "short_video" }, t)).toBe("1080×1920");
    expect(videoCell({ platform: "instagram", format: "video" }, t)).toBe("1080×1920");
    expect(videoCell({ platform: "facebook", format: "short_video" }, t)).toBe("1080×1920");
    expect(videoCell({ platform: "tiktok", format: "short_video" }, t)).toBe("1080×1920");
    expect(videoCell({ platform: "x", format: "video" }, t)).toBe("1280×720 or 720×1280");
    expect(videoCell({ platform: "pinterest", format: "video" }, t)).toBeNull();
    expect(cellSizes("1280×720 or 720×1280")).toEqual([{ width: 1280, height: 720 }, { width: 720, height: 1280 }]);
  });
});

describe("what a video row's read changes", () => {
  const decide = (r: VideoSizeRow, now = NOW) => decideVideo(r, parts.table, now);

  it("leaves a size the row's cell still gives, written there or inside its range", () => {
    expect(decide(row("youtube", "video", 1920, 1080)).outcome).toBe("same");
    expect(decide(row("x", "video", 720, 1280)).outcome).toBe("same");
    expect(decide(row("linkedin", "video", 1080, 1920)).outcome).toBe("same");
  });

  it("holds a new size on one read, and writes it only on a read on a later day", () => {
    expect(decide(row("youtube", "video", 1080, 1920))).toMatchObject({ outcome: "held", to: [1920, 1080] });
    // Held this morning: a retry the same day holds it again.
    expect(decide(row("youtube", "video", 1080, 1920, [1920, 1080], "2026-11-18T05:30:00Z")).outcome).toBe("held");
    expect(decide(row("youtube", "video", 1080, 1920, [1920, 1080], "2026-11-17T05:30:00Z"))).toMatchObject({ outcome: "confirmed", to: [1920, 1080] });
    expect(israelDay("2026-11-17T22:30:00Z")).toBe("2026-11-18");
  });

  it("refuses a row the table gives nothing for, or whose first size cannot be made", () => {
    expect(decide(row("pinterest", "video", 1080, 1920))).toMatchObject({ outcome: "refused", reason: "not_read" });
    const odd = [{ label: "LinkedIn", cell: "256×144 to 4096×2304" }];
    expect(decideVideo(row("linkedin", "video", 5000, 900), odd, NOW)).toMatchObject({ outcome: "refused", reason: "edge", to: [256, 144] });
    // A Short's size in the YouTube section never keeps a YouTube video vertical: only its own cell counts.
    expect(decide(row("youtube", "video", 1080, 1920)).outcome).toBe("held");
  });
});

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
  await pg.exec(base);
  await pg.exec(videos);
  // Safe to run twice, in either order with the base file.
  await pg.exec(base);
  await pg.exec(videos);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec("delete from public.platform_size_reads; delete from public.platform_sizes;");
  await pg.exec(base);
  await pg.exec(videos);
});

type Size = { platform: string; format: string; width: number; height: number };
const sizes = async () => (await pg.query<Size>("select platform, format, width, height from public.platform_sizes order by platform, format")).rows;

describe("the migration", () => {
  it("seeds the video sizes beside the image sizes, and removes nothing", async () => {
    const all = await sizes();
    const at = (p: string, f: string) => all.find((r) => r.platform === p && r.format === f);
    expect(at("youtube", "video")).toMatchObject({ width: 1920, height: 1080 });
    expect(at("youtube", "short_video")).toMatchObject({ width: 1080, height: 1920 });
    for (const p of ["tiktok", "instagram", "facebook"]) for (const f of ["video", "short_video"]) expect(at(p, f)).toMatchObject({ width: 1080, height: 1920 });
    expect(at("x", "video")).toMatchObject({ width: 720, height: 1280 });
    expect(at("linkedin", "video")).toMatchObject({ width: 1080, height: 1920 });
    expect(at("x", "image")).toMatchObject({ width: 1600, height: 900 });
    expect(all).toHaveLength(17);
  });

  it("never puts a seed over a size read since, and keeps every format on a second run", async () => {
    await pg.exec("update public.platform_sizes set width = 1280, height = 720 where platform = 'youtube' and format = 'video'");
    await pg.exec(videos);
    await pg.exec(base);
    expect((await sizes()).find((r) => r.platform === "youtube" && r.format === "video")).toMatchObject({ width: 1280, height: 720 });
    await expect(pg.exec("insert into public.platform_sizes (platform, format, width, height) values ('youtube', 'story', 1080, 1920)")).resolves.toBeDefined();
    await expect(pg.exec("insert into public.platform_sizes (platform, format, width, height) values ('youtube', 'long', 1080, 1920)")).rejects.toThrow(/platform_sizes_format/);
  });
});

/** The two calls the job makes, on PGlite (as platformSizeRefresh.test.ts). */
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

/** The image guide's model answers "same" for every image row (it reads the stand-in's own sizes). */
const sameAnswer = async () => ({ rows: [] });
const deps = (video: { status?: number; html?: string } = {}): SizeDeps => ({
  fetchGuide: async (url) => (url === VIDEO_GUIDE_URL ? { status: video.status ?? 200, html: video.html ?? videoGuide } : { status: 200, html: imageGuide }),
  extract: sameAnswer,
});
const job = { id: "j", kind: "platform_sizes" } as unknown as ScheduledJob;

describe("the daily job with video rows", () => {
  it("reads the video guide as a run of its own and changes nothing that stands", async () => {
    const run = await refreshPlatformSizes(db, deps());
    expect(run.video?.ok).toBe(true);
    expect(run.video?.source).toBe(VIDEO_GUIDE_URL);
    expect(run.video?.rows.every((r) => r.outcome === "same")).toBe(true);
    expect(run.rows.every((r) => !String(r.format).includes("video"))).toBe(true);
    const recorded = (await pg.query<{ source: string; ok: boolean }>("select source, ok from public.platform_size_reads order by read_at, id")).rows;
    expect(recorded.map((r) => r.source).sort()).toEqual([GUIDE_URL, VIDEO_GUIDE_URL].sort());
  });

  it("holds a new video size and writes it on a later day's read, never on the same day's", async () => {
    await pg.exec("update public.platform_sizes set width = 1080, height = 1920 where platform = 'youtube' and format = 'video'");
    await refreshPlatformSizes(db, deps());
    const held = (await pg.query<{ width: number; pending_width: number }>("select width, pending_width from public.platform_sizes where platform = 'youtube' and format = 'video'")).rows[0];
    expect(held).toEqual({ width: 1080, pending_width: 1920 });
    // A retry the same day: still held.
    await refreshPlatformSizes(db, deps());
    expect((await sizes()).find((r) => r.platform === "youtube" && r.format === "video")).toMatchObject({ width: 1080, height: 1920 });
    // The next day's read confirms it.
    await pg.exec("update public.platform_sizes set pending_at = now() - interval '1 day' where platform = 'youtube' and format = 'video'");
    await refreshPlatformSizes(db, deps());
    expect((await sizes()).find((r) => r.platform === "youtube" && r.format === "video")).toMatchObject({ width: 1920, height: 1080 });
  });

  it("never fails the job when the video read cannot be recorded: the image read stands and nothing is retried", async () => {
    let calls = 0;
    const failing = { ...db, rpc: async (name: string, args: { p_read: unknown }) => (++calls === 2 ? { data: null, error: { message: "connection reset" } } : db.rpc(name, args)) };
    const out = await runPlatformSizes(failing, job, deps());
    expect(out.status).toBe("done");
    expect(out.reason).toMatch(/video specs guide could not be read \(.*connection reset\)/);
    const recorded = (await pg.query<{ source: string }>("select source from public.platform_size_reads")).rows.map((r) => r.source);
    expect(recorded).toEqual([GUIDE_URL]);
  });

  it("never fails the job or changes a size when the video guide cannot be read", async () => {
    const before = await sizes();
    const out = await runPlatformSizes(db, job, deps({ status: 503 }));
    expect(out.status).toBe("done");
    expect(out.reason).toMatch(/video specs guide could not be read/);
    expect(await sizes()).toEqual(before);
    const notGuide = await readVideoGuide([row("youtube", "video", 1920, 1080)], deps({ html: imageGuide }));
    expect(notGuide).toMatchObject({ ok: false, rows: [] });
  });
});
