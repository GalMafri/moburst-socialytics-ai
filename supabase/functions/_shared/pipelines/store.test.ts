// @vitest-environment node
// The pipelines' storage against an in-memory database: the read-only client
// a step gets, the payload store and its expiry, shadow outputs per kind, the
// app writers (none yet), starting runs, and the rule that a shadow run never
// writes a table a screen reads.
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../lifecycle/fakeDb";
import type { ScheduledJob } from "../../run-scheduled-jobs/types";
import { REGISTRY } from "./registry";
import { runPipelineJob } from "./runner";
import { shadowLinkedInSource, startReportPipeline } from "./shadow";
import {
  appRunView, expirePayloads, loadShadowPair, makeAppOutput, makePayloadStore, makeRunStore, makeShadowOutput, makeStepLog, makeStepServices,
  PAYLOAD_BUCKET, PAYLOAD_TTL_DAYS, PipelineWriteRefused, readOnlyDb, SHADOW_WRITABLE_TABLES, startPipelineRun,
} from "./store";
import type { PipelineRun } from "./types";

const NOW = new Date("2026-11-07T07:20:00Z");
const run = (over: Partial<PipelineRun> = {}): PipelineRun => ({
  id: "run-1", kind: "social", pipeline: "placeholder_social", mode: "shadow", app_capable: false, client_id: "client-1",
  real_table: "reports", real_id: "report-1", real_ref: null, input: { range: { start: "2026-10-01", end: "2026-10-31" } },
  status: "running", step: "record", steps_done: 0, heartbeat_at: NOW.toISOString(), started_at: NOW.toISOString(),
  finished_at: null, outcome: null, job_id: "job-1", ...over,
});

/** fakeDb with the storage remove the Storage API has. */
function db(tables: Record<string, Array<Record<string, unknown>>> = {}, rpcs: Parameters<typeof fakeDb>[1] = {}): FakeDb & { removed: string[] } {
  const d = fakeDb(tables, rpcs) as FakeDb & { removed: string[] };
  d.removed = [];
  const from = d.storage.from.bind(d.storage);
  d.storage = {
    from(bucket: string) {
      return {
        ...from(bucket),
        async remove(paths: string[]) { for (const p of paths) { d.removed.push(`${bucket}/${p}`); d.uploads.delete(`${bucket}/${p}`); } return { error: null }; },
      };
    },
  };
  return d;
}

describe("readOnlyDb", () => {
  it("reads, and refuses every write, function call and storage use", async () => {
    const d = db({ reports: [{ id: "report-1", status: "running" }] });
    const ro = readOnlyDb(d);
    const { data } = await ro.from("reports").select("*").eq("id", "report-1");
    expect(data).toEqual([{ id: "report-1", status: "running" }]);
    expect(() => ro.from("reports").insert({ id: "x" })).toThrow(PipelineWriteRefused);
    expect(() => ro.from("reports").update({ status: "completed" })).toThrow(PipelineWriteRefused);
    expect(() => ro.from("calendar_posts").upsert({})).toThrow(PipelineWriteRefused);
    expect(() => ro.from("competitive_reports").delete()).toThrow(PipelineWriteRefused);
    expect(() => ro.rpc("anything", {})).toThrow(PipelineWriteRefused);
    expect(() => ro.storage.from("design-references")).toThrow(PipelineWriteRefused);
    expect(d.tables.reports).toEqual([{ id: "report-1", status: "running" }]);
  });
});

describe("payload store", () => {
  it("keeps large data in the private bucket, indexed with an expiry, and reads it back", async () => {
    const d = db();
    const store = makePayloadStore(d, "run-1", { now: () => NOW });
    const dataset = Array.from({ length: 500 }, (_, i) => ({ id: i, caption: `post ${i}` }));
    const saved = await store.put("apify.tiktok", dataset);
    expect(saved.bytes).toBe(JSON.stringify(dataset).length);
    expect(d.uploads.has(`${PAYLOAD_BUCKET}/runs/run-1/apify.tiktok.json`)).toBe(true);
    expect(d.tables.pipeline_payloads).toEqual([expect.objectContaining({
      run_id: "run-1", key: "apify.tiktok", storage_path: "runs/run-1/apify.tiktok.json",
      expires_at: new Date(NOW.getTime() + PAYLOAD_TTL_DAYS * 86_400_000).toISOString(),
    })]);
    expect(await store.get("apify.tiktok")).toEqual(dataset);
    expect(await store.get("missing")).toBeNull();
    // Writing the same key again replaces it.
    await store.put("apify.tiktok", [1]);
    expect(d.tables.pipeline_payloads).toHaveLength(1);
    expect(await store.get("apify.tiktok")).toEqual([1]);
  });

  it("refuses a key that is not a plain name", async () => {
    const store = makePayloadStore(db(), "run-1");
    await expect(store.put("../reports", 1)).rejects.toThrow("not a plain name");
  });

  it("removes expired payloads, files first, and leaves the rest", async () => {
    const d = db({
      pipeline_payloads: [
        { run_id: "r1", key: "old", storage_path: "runs/r1/old.json", bytes: 1, expires_at: "2026-11-01T00:00:00.000Z" },
        { run_id: "r2", key: "new", storage_path: "runs/r2/new.json", bytes: 1, expires_at: "2026-12-01T00:00:00.000Z" },
      ],
    });
    expect(await expirePayloads(d, NOW)).toBe(1);
    expect(d.removed).toEqual([`${PAYLOAD_BUCKET}/runs/r1/old.json`]);
    expect(d.tables.pipeline_payloads.map((r) => r.key)).toEqual(["new"]);
    expect(await expirePayloads(d, NOW)).toBe(0);
  });
});

describe("outputs", () => {
  it("writes a social shadow next to the report it shadows", async () => {
    const d = db();
    await makeShadowOutput(d, run(), makePayloadStore(d, "run-1")).write("report", { metrics: { impressions: 1 } });
    expect(d.tables.shadow_social_reports).toEqual([expect.objectContaining({
      run_id: "run-1", client_id: "client-1", real_report_id: "report-1", date_range_start: "2026-10-01", date_range_end: "2026-10-31",
      report_data: { metrics: { impressions: 1 } },
    })]);
  });

  it("writes a competitive shadow with its set, and another target to the payload store", async () => {
    const d = db();
    const r = run({ kind: "competitive", real_table: "competitive_reports", input: { range: { start: "2026-10-01", end: "2026-10-31" }, set_id: "set-1" } });
    const out = makeShadowOutput(d, r, makePayloadStore(d, r.id));
    await out.write("report", { ai_analysis: {} });
    await out.write("snapshot", { posts: [] });
    expect(d.tables.shadow_competitive_reports).toEqual([expect.objectContaining({ set_id: "set-1", real_report_id: "report-1" })]);
    expect(d.tables.pipeline_payloads).toEqual([expect.objectContaining({ key: "output.snapshot" })]);
    expect(d.tables.competitive_reports).toBeUndefined();
    expect(d.tables.rivaliq_snapshots).toBeUndefined();
  });

  it("writes a LinkedIn source shadow with its sources and period", async () => {
    const d = db();
    const sources = [{ company_id: "1", name: "Moburst", profile_url: "https://www.linkedin.com/company/moburst" }];
    const r = run({ kind: "linkedin_source", real_table: "rivaliq_snapshots", real_id: null, real_ref: { endpoint: "feed" }, input: { sources, period: { start: "2026-10-29", end: "2026-11-04" } } });
    await makeShadowOutput(d, r, makePayloadStore(d, r.id)).write("report", { socialPosts: [], additional_metrics: {} });
    expect(d.tables.shadow_linkedin_sources).toEqual([expect.objectContaining({
      run_id: "run-1", real_ref: { endpoint: "feed" }, period_start: "2026-10-29", period_end: "2026-11-04", sources, result: { socialPosts: [], additional_metrics: {} },
    })]);
  });

  it("has no writer for a real report yet, so an app run cannot write one", async () => {
    const d = db();
    await expect(makeAppOutput(d, run({ mode: "app" })).write("report", {})).rejects.toThrow("No writer for the social report");
    const seen: unknown[] = [];
    await makeAppOutput(d, run({ mode: "app" }), { social: { report: async (_db, _r, data) => { seen.push(data); } }, competitive: {}, linkedin_source: {} }).write("report", { ok: 1 });
    expect(seen).toEqual([{ ok: 1 }]);
  });

  it("gives a step a read-only database and the output of its mode", async () => {
    const d = db();
    const services = makeStepServices(d, () => undefined);
    const shadow = services(run(), REGISTRY.all()[0]);
    expect(() => shadow.db.from("reports").insert({})).toThrow(PipelineWriteRefused);
    await shadow.output.write("report", { x: 1 });
    expect(d.tables.shadow_social_reports).toHaveLength(1);
    const app = services(run({ mode: "app" }), REGISTRY.all()[0]);
    await expect(app.output.write("report", {})).rejects.toThrow("No writer");
  });
});

describe("starting runs", () => {
  const placeholder = REGISTRY.get("placeholder_social")!;
  it("starts a report's shadow once per report, with the request n8n got", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const d = db({}, { report_pipeline_start: (args) => { calls.push(args); return { run_id: "run-1", started: calls.length === 1 }; } });
    const a = { mode: "shadow" as const, kind: "social" as const, pipeline: placeholder, clientId: "client-1", reportId: "report-1", range: { start: "2026-10-01", end: "2026-10-31" }, request: { report_id: "report-1" } };
    expect(await startReportPipeline(d, a)).toEqual({ run_id: "run-1", started: true });
    expect(calls[0]).toMatchObject({
      p_kind: "social", p_mode: "shadow", p_pipeline: "placeholder_social", p_app_capable: false, p_client: "client-1",
      p_real_table: "reports", p_real_id: "report-1", p_first_step: "record", p_dedupe: "shadow:social:report-1",
      p_input: { range: { start: "2026-10-01", end: "2026-10-31" }, request: { report_id: "report-1" } },
    });
  });

  it("refuses to start a placeholder in app mode", async () => {
    const d = db({}, { report_pipeline_start: () => ({ run_id: "x", started: true }) });
    await expect(startPipelineRun(d, { mode: "app", pipeline: placeholder, clientId: "c", realTable: "reports", realId: "r", input: {}, dedupe: "d" })).rejects.toThrow("does not run in app mode");
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("starts the LinkedIn source shadow only on shadow, keeps what n8n answered, and never throws", async () => {
    const sources = [{ company_id: "1", name: "Moburst", profile_url: "https://www.linkedin.com/company/moburst" }];
    const period = { start: "2026-10-29", end: "2026-11-04" };
    const real = { socialPosts: [{ postLink: "https://www.linkedin.com/posts/1" }], additional_metrics: {} };
    const pipeline = REGISTRY.get("placeholder_linkedin_source")!;

    const off = db({}, { report_pipeline_start: () => ({ run_id: "run-9", started: true }) });
    expect(await shadowLinkedInSource(off, { engine: "n8n" }, { clientId: "client-1", sources, period, real })).toBeNull();
    expect(off.rpcCalls).toHaveLength(0);
    expect(off.uploads.size).toBe(0);

    const on = db({}, { report_pipeline_start: () => ({ run_id: "run-9", started: true }) });
    expect(await shadowLinkedInSource(on, { engine: "shadow", pipeline }, { clientId: "client-1", sources, period, real, now: () => NOW })).toBe("run-9");
    expect(on.rpcCalls[0].args).toMatchObject({ p_kind: "linkedin_source", p_mode: "shadow", p_real_table: "rivaliq_snapshots", p_real_id: null, p_input: { sources, period } });
    expect(await makePayloadStore(on, "run-9").get("real.output")).toEqual(real);

    const broken = db({}, { report_pipeline_start: () => { throw new Error("function missing"); } });
    expect(await shadowLinkedInSource(broken, { engine: "shadow", pipeline }, { clientId: "client-1", sources, period, real })).toBeNull();
    expect(await shadowLinkedInSource(on, { engine: "shadow", pipeline }, { clientId: "client-1", sources: [], period, real })).toBeNull();
  });
});

describe("a shadow run end to end on the real storage", () => {
  it("runs the placeholder and writes nothing but pipeline and shadow tables", async () => {
    const d = db({
      report_pipeline_runs: [run()],
      reports: [{ id: "report-1", status: "running", report_data: {} }],
      competitive_reports: [], rivaliq_snapshots: [], calendar_posts: [], calendar_plans: [],
    });
    const before = JSON.stringify({ reports: d.tables.reports, competitive_reports: d.tables.competitive_reports, rivaliq_snapshots: d.tables.rivaliq_snapshots, calendar_posts: d.tables.calendar_posts, calendar_plans: d.tables.calendar_plans });
    const job = {
      id: "job-1", kind: "report_pipeline", client_id: "client-1", schedule_id: null, occurrence: null, priority: 60, stagger_seconds: 0,
      status: "running", phase: null, report_id: null, attempts: 1, max_attempts: 5, available_at: NOW.toISOString(), lease_until: null,
      reason: null, result: null, payload: { run_id: "run-1", pipeline: "placeholder_social", step: "record", state: {} },
      created_at: NOW.toISOString(), started_at: NOW.toISOString(), finished_at: null,
    } as ScheduledJob;
    const outcome = await runPipelineJob(job, { now: () => NOW, registry: REGISTRY, runs: makeRunStore(d), log: makeStepLog(d), services: makeStepServices(d, () => undefined) });
    expect(outcome.status).toBe("done");
    expect(d.tables.report_pipeline_runs[0]).toMatchObject({ status: "done" });
    expect(d.tables.report_pipeline_steps).toEqual([expect.objectContaining({ run_id: "run-1", step: "record", outcome: "done" })]);
    expect(d.tables.shadow_social_reports[0].report_data).toMatchObject({ placeholder: true, real_id: "report-1" });
    const after = JSON.stringify({ reports: d.tables.reports, competitive_reports: d.tables.competitive_reports, rivaliq_snapshots: d.tables.rivaliq_snapshots, calendar_posts: d.tables.calendar_posts, calendar_plans: d.tables.calendar_plans });
    expect(after).toBe(before);
    const touched = Object.keys(d.tables).filter((t) => !["reports", "competitive_reports", "rivaliq_snapshots", "calendar_posts", "calendar_plans"].includes(t));
    expect(touched.every((t) => SHADOW_WRITABLE_TABLES.includes(t))).toBe(true);
  });
});

describe("reading runs back", () => {
  it("shows the dispatch an app run's heartbeat", async () => {
    const d = db({ report_pipeline_runs: [run({ mode: "app", status: "running", heartbeat_at: "2026-11-07T09:00:00.000Z" }), run({ id: "run-0", mode: "shadow" })] });
    expect(await appRunView(d, "report-1")).toMatchObject({ status: "running", heartbeat_at: "2026-11-07T09:00:00.000Z" });
    expect(await appRunView(d, "report-x")).toBeNull();
  });

  it("loads a shadow and the real result it shadows, for comparing", async () => {
    const d = db({
      report_pipeline_runs: [run(), run({ id: "run-2", kind: "linkedin_source", real_table: "rivaliq_snapshots", real_id: null })],
      reports: [{ id: "report-1", report_data: { metrics: { impressions: 10 } } }],
      shadow_social_reports: [{ run_id: "run-1", report_data: { metrics: { impressions: 11 } } }],
      shadow_linkedin_sources: [{ run_id: "run-2", result: { socialPosts: [] } }],
    });
    expect(await loadShadowPair(d, "run-1")).toMatchObject({ real: { metrics: { impressions: 10 } }, shadow: { metrics: { impressions: 11 } } });
    await makePayloadStore(d, "run-2").put("real.output", { socialPosts: [{ id: 1 }] });
    expect(await loadShadowPair(d, "run-2")).toMatchObject({ real: { socialPosts: [{ id: 1 }] }, shadow: { socialPosts: [] } });
    expect(await loadShadowPair(d, "missing")).toBeNull();
  });
});

