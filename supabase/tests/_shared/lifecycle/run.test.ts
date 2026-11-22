import { afterEach, describe, expect, it } from "vitest";
import { nextLookAt, runLifecycle, runLifecycleStep, runStepNow } from "../../../functions/_shared/lifecycle/run";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import { rowAfter } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
const originalAccess = STEPS.access;
afterEach(() => {
  Object.assign(deps, original);
  STEPS.access = originalAccess;
});

const NOW = new Date("2026-10-19T10:00:00Z");
const base = { id: "c1", name: "Pay The Pyper", website_url: null, archived_at: null, demo_job_id: null, field_sources: {}, company_slug: null };
const db = (client: Record<string, unknown> = {}) =>
  fakeDb({ clients: [{ ...base, ...client }], client_lifecycle_steps: [], scheduled_jobs: [], competitor_sets: [], sprout_profiles: [], sprout_profile_removals: [] }, { lifecycle_write_client: writeClientRpc });

describe("runLifecycle", () => {
  it("leaves a demo copy to its demo job", async () => {
    const d = db({ demo_job_id: "job-1" });
    expect(await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW)).toMatchObject({ status: "skipped" });
    expect(d.tables.scheduled_jobs).toEqual([]);
  });
  // Copy sources, 17 Nov 2026 (invented brand): an archived client is never looked at, so none of its accounts is ever sorted out.
  it("never runs for an archived client: no look, no step by its job, no step asked for now, and its accounts stay as they are", async () => {
    const d = db({ name: "Harbor Wax", archived_at: "2026-10-01T00:00:00Z" });
    // Two differently named accounts on one network, as an archived client can have.
    d.tables.sprout_profiles.push(
      { client_id: "c1", sprout_profile_id: 20, profile_name: "Harbor Wax", native_name: "harborwax", network_type: "facebook", is_active: true, assigned_at: "2026-09-01T00:00:00Z", parked_at: null, parked_reason: null },
      { client_id: "c1", sprout_profile_id: 21, profile_name: "Lakeside Skin Studio", native_name: "lakesideskin", network_type: "facebook", is_active: true, assigned_at: "2026-09-01T00:00:00Z", parked_at: null, parked_reason: null },
    );
    const before = JSON.stringify(d.tables.sprout_profiles);
    let ran = 0;
    const real = STEPS.accounts.run;
    STEPS.accounts.run = async (...args) => { ran += 1; return real(...args); };
    try {
      expect(await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW)).toEqual({ status: "skipped", reason: "The client is archived." });
      expect(await runLifecycleStep(d, { id: "j2", client_id: "c1", payload: { step: "accounts", force: true } }, NOW)).toEqual({ status: "skipped", reason: "The client is archived." });
      expect(await runStepNow(d, "c1", "accounts", NOW)).toMatchObject({ ran: false });
    } finally { STEPS.accounts.run = real; }
    expect(ran).toBe(0);
    expect(JSON.stringify(d.tables.sprout_profiles)).toBe(before);
    expect(d.tables.scheduled_jobs).toEqual([]);
    expect(d.tables.client_lifecycle_steps).toEqual([]);
  });
  it("queues the steps whose inputs exist, claimed so a second look queues nothing", async () => {
    const d = db();
    const first = await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW);
    // A client with a name and no website: its accounts (by Sprout's brand name) and its slug.
    expect(first.result).toEqual({ queued: ["accounts (new)", "access (new)"] });
    expect(d.tables.scheduled_jobs).toMatchObject([{ kind: "lifecycle_step", payload: { step: "accounts", force: false, why: "new" } }, { kind: "lifecycle_step", payload: { step: "access" } }]);
    expect((await runLifecycle(d, { id: "j2", client_id: "c1", payload: null }, NOW)).result).toEqual({ queued: [] });
  });
});

// Copy sources, 17 Nov 2026: the voice check and the calendar check are steps like any other, queued only when due.
describe("the voice and the calendar check in a look", () => {
  const BUILT = "2026-11-01T08:00:00.000Z";
  const STARS = "Dana Reed ★★★★★";
  const done = (step: string, inputs_key: string, result: Record<string, unknown> = {}) => ({ client_id: "c1", step, inputs_key, status: "done", attempts: 0, attempted_at: NOW.toISOString(), done_at: NOW.toISOString(), next_attempt_at: null, result, error: null });
  const look = async (d: ReturnType<typeof db>) => ((await runLifecycle(d, { id: "j", client_id: "c1", payload: null }, NOW)).result as { queued: string[] }).queued;
  const step = (d: ReturnType<typeof db>, name: string) => d.tables.client_lifecycle_steps.find((r) => r.step === name)!;
  const run = (d: ReturnType<typeof db>, name: string) => runLifecycleStep(d, { id: `j-${name}`, client_id: "c1", payload: { step: name } }, NOW);
  const about = (queued: string[], name: string) => queued.filter((q) => q.startsWith(`${name} (`));
  /** A client with a voice, whose accounts step last ran before the one-account rule. */
  const world = (social_voice: Record<string, unknown>) => {
    const d = db({ name: "Harbor Wax", voice_built_at: social_voice.built_at, social_voice, company_slug: "harbor-wax", timezone: "UTC" });
    d.tables.sprout_profiles.push({ client_id: "c1", sprout_profile_id: 20, profile_name: "Harbor Wax", native_name: "harborwax", network_type: "facebook", native_link: "", is_active: true });
    d.tables.client_lifecycle_steps.push(done("accounts", "name:harbor wax|site:|links:811c9dc5|removed:811c9dc5"), done("access", "name:Harbor Wax"));
    Object.assign(d.tables, { client_public_profiles: [], calendar_plans: [], calendar_posts: [], post_iterations: [] });
    return d;
  };
  const plain = { built_at: BUILT, post_count: 9, platforms: { Facebook: { summary: "Warm.", phrases: ["thank you"] } }, examples: {} };

  it("queues neither for a client with no voice yet", async () => {
    expect(await look(db())).toEqual(["accounts (new)", "access (new)"]);
  });

  it("checks a voice with nothing to fix without a model call or a new date, and still checks the calendar", async () => {
    const d = world(plain);
    deps.listCustomerProfiles = async () => [{ id: "99", name: STARS, native_name: "dana-reed", network_type: "linkedin", native_link: "", status: "active" }];
    // The accounts step last ran before the rule: it is due, and the voice waits for it.
    const first = await look(d);
    expect(about(first, "accounts")).toEqual(["accounts (inputs_changed)"]);
    expect([...about(first, "voice"), ...about(first, "calendar_recheck")]).toEqual([]);
    await run(d, "accounts");
    expect(step(d, "accounts")).toMatchObject({ status: "done", result: { display_names: [{ name: STARS, plain: "Dana Reed" }], own: [], own_open: [], own_dropped_at: null } });

    // The voice is looked at: it holds no listed name and no account was parked, so it conforms.
    const second = await look(d);
    expect(about(second, "voice")).toEqual(["voice (new)"]);
    expect(about(second, "calendar_recheck")).toEqual([]);
    await run(d, "voice");
    expect(step(d, "voice")).toMatchObject({ status: "done", result: { conforms: true, built_at: BUILT } });
    expect(d.tables.scheduled_jobs.filter((j) => j.kind === "voice_profile")).toEqual([]);
    expect(d.tables.clients[0]).toMatchObject({ voice_built_at: BUILT, social_voice: plain });

    // The calendar is checked all the same, once.
    const third = await look(d);
    expect(about(third, "calendar_recheck")).toEqual(["calendar_recheck (new)"]);
    expect(about(third, "voice")).toEqual([]);
    await run(d, "calendar_recheck");
    expect(step(d, "calendar_recheck")).toMatchObject({ status: "done", inputs_key: `rules:1|voice:${BUILT}|own:`, result: { renamed: 0, asked: [], kept: 0 } });
    const fourth = await look(d);
    expect([...about(fourth, "voice"), ...about(fourth, "calendar_recheck")]).toEqual([]);
  });

  it("builds a voice that holds a listed name again, and checks the calendar only once the new voice is there", async () => {
    const d = world({ ...plain, overall: { summary: `Thanks ${STARS} often.`, phrases: [STARS] } });
    deps.listCustomerProfiles = async () => [{ id: "99", name: STARS, native_name: "dana-reed", network_type: "linkedin", native_link: "", status: "active" }];
    await look(d);
    await run(d, "accounts");
    await look(d);
    await run(d, "voice");
    // Waiting for its rebuild, looked at again hourly, so a rebuild that failed is seen (QA 22 Nov 2026, P39-04).
    expect(step(d, "voice")).toMatchObject({ status: "waiting", result: { conforms: false, why: ["names"], waiting_for: "in_progress" } });
    const job = d.tables.scheduled_jobs.find((j) => j.kind === "voice_profile")!;
    expect(job).toMatchObject({ client_id: "c1", priority: 39 });
    // The job is on its way: the calendar check waits for it.
    job.status = "running";
    expect(about(await look(d), "calendar_recheck")).toEqual([]);

    // The profile is built, plain: the calendar check is due, and the voice is looked at once more and found to conform.
    job.status = "done";
    const rebuilt = "2026-11-17T10:05:00.000Z";
    Object.assign(d.tables.clients[0], { voice_built_at: rebuilt, social_voice: { ...plain, built_at: rebuilt, rule: 1 } });
    const after = await look(d);
    expect(about(after, "calendar_recheck")).toEqual(["calendar_recheck (new)"]);
    expect(about(after, "voice")).toEqual(["voice (inputs_changed)"]);
    await run(d, "voice");
    await run(d, "calendar_recheck");
    expect(step(d, "voice")).toMatchObject({ status: "done", result: { conforms: true, built_at: rebuilt } });
    expect(d.tables.scheduled_jobs.filter((j) => j.kind === "voice_profile")).toHaveLength(1);
    const settledNow = await look(d);
    expect([...about(settledNow, "voice"), ...about(settledNow, "calendar_recheck")]).toEqual([]);
  });
});

describe("runLifecycleStep", () => {
  it("stores the outcome and looks at the client again at once, so the steps after it start", async () => {
    const d = db();
    await runLifecycleStep(d, { id: "j", client_id: "c1", payload: { step: "access" } }, NOW);
    expect(d.tables.client_lifecycle_steps).toMatchObject([{ step: "access", status: "done", result: { slug: "pay-the-pyper" } }]);
    expect(d.tables.clients[0].company_slug).toBe("pay-the-pyper");
    expect(d.tables.scheduled_jobs).toMatchObject([{ kind: "lifecycle", client_id: "c1" }]);
  });
  it("looks again after a step that finishes in the same minute as a look that already ran", async () => {
    // Yangra, 3 Nov: brand_read finished 9 seconds after the look that left brief_pillars waiting for it.
    const d = db();
    const minute = new Date().toISOString().slice(0, 16);
    d.tables.scheduled_jobs.push({ kind: "lifecycle", client_id: "c1", dedupe_key: `lifecycle:c1:${minute}`, available_at: new Date().toISOString(), status: "done" });
    await runLifecycleStep(d, { id: "j", client_id: "c1", payload: { step: "access" } }, NOW);
    expect(d.tables.scheduled_jobs.filter((j) => j.kind === "lifecycle").map((j) => j.status)).toEqual(["done", "queued"]);
  });
  it("looks again when a wait or a retry is due, not before", () => {
    const at = new Date("2026-10-19T10:00:00Z");
    const waiting = rowAfter(null, { client_id: "c1", step: "tracking", inputs_key: "k" }, { status: "waiting", reason: "in_progress", recheckMinutes: 5 }, at);
    expect(nextLookAt(waiting, { status: "waiting", reason: "in_progress", recheckMinutes: 5 }, at)?.toISOString()).toBe("2026-10-19T10:05:00.000Z");
    const forInput = rowAfter(null, { client_id: "c1", step: "tracking", inputs_key: "k" }, { status: "waiting", reason: "selection" }, at);
    expect(nextLookAt(forInput, { status: "waiting", reason: "selection" }, at)).toBeNull();
  });
});

describe("runStepNow", () => {
  it("runs a due step in the request, then answers from what it stored", async () => {
    const d = db({ demo_job_id: "job-1" });
    const first = await runStepNow(d, "c1", "access", NOW);
    expect(first).toMatchObject({ status: "done", ran: true, result: { slug: "pay-the-pyper" } });
    // A demo copy's runs never queue looks: its job drives it.
    expect(d.tables.scheduled_jobs).toEqual([]);
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "done", ran: false });
  });
  it("carries on with work it started without waiting for the recheck time", async () => {
    const d = db({ demo_job_id: "job-1" });
    let runs = 0;
    STEPS.access = { ...originalAccess, async run() { runs++; return runs === 1 ? { status: "waiting", reason: "in_progress", recheckMinutes: 60, result: { phase: 1 } } : { status: "done", result: { phase: 2 } }; } };
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "waiting", waiting_for: "in_progress" });
    expect(await runStepNow(d, "c1", "access", NOW)).toMatchObject({ status: "done", result: { phase: 2 } });
    expect(runs).toBe(2);
  });
  it("answers 'no_input' for a step whose input does not exist", async () => {
    expect(await runStepNow(db(), "c1", "brand_read", NOW)).toMatchObject({ status: "no_input", ran: false });
  });
});
