import { describe, it, expect } from "vitest";
import { advanceJob, initialSteps, type JobRecord } from "../../_shared/api/jobs";
import type { CallResult } from "../../_shared/invoke";
import { CLIENT, COMPETITIVE_REPORT, DESIGN_SYSTEM, REPORT, SPROUT_PROFILE } from "../fixtures";
import { emptyTables, makeFakeDemoDb, type FakeTables } from "./fake-db";
import { DEMO_STEPS, refreshOutputs, slugify, type DemoCtx } from "./steps";

const ok = (data: unknown, status = 200): CallResult => ({ ok: true, status, data, text: JSON.stringify(data) });
const fail = (status: number, data: unknown): CallResult => ({ ok: false, status, data, text: JSON.stringify(data) });
const BRAND = { primary_color: "#112233", secondary_color: "#ffffff", accent_color: "#ffcc00", font_family: "Inter", visual_style: "clean", tone_of_voice: "warm", logo_description: "wordmark" };
const MARKDOWN = "[My Wishlist](https://x.com/#w) 0\n\n# Brooklinen bedding made well\n\n" + "The internet's favorite sheets, made in family-owned mills and backed by a warranty.\n\n".repeat(3);

interface Harness { t: FakeTables; ctx: DemoCtx; calls: Array<{ name: string; body: Record<string, unknown>; actAs: string | null }>; callbacks: unknown[]; job: JobRecord; clock: Date }

function harness(over: { input?: Record<string, unknown>; tables?: Partial<FakeTables>; call?: (name: string, body: Record<string, unknown>, h: Harness) => CallResult | Promise<CallResult> | undefined; callbackUrl?: string | null; keyId?: string | null } = {}): Harness {
  const t = emptyTables(over.tables);
  const calls: Harness["calls"] = [];
  const callbacks: unknown[] = [];
  const clock = new Date("2026-10-01T12:00:00.000Z");
  const h: Harness = { t, calls, callbacks, clock, ctx: null as never, job: null as never };
  const defaultCall = (name: string, body: Record<string, unknown>): CallResult => {
    if (name === "research-brand-identity") return ok({ brand_identity: BRAND });
    if (name === "firecrawl-scrape") return ok({ success: true, data: { markdown: MARKDOWN, metadata: { title: "Brooklinen" } } });
    if (name === "derive-content-pillars") return ok({ pillars: [{ name: "Sleep better", description: "d" }, { name: "Home comfort", description: "d" }], keywords: ["bedding", "sheets"], source: "brief", derived_at: clock.toISOString() });
    if (name === "identify-competitors") {
      const set = t.sets.find((s) => s.client_id === body.client_id && s.status === "draft") ?? (() => { const s = { id: "set-ai", client_id: body.client_id as string, status: "draft", notes: null, source: "ai", rivaliq_landscape_id: null, confirmed_at: null, created_at: clock.toISOString(), demo_job_id: null }; t.sets.push(s); return s; })();
      const names = ["Parachute", "Boll & Branch", "Casper", "Buffy", "NoSite"];
      for (const [i, n] of names.entries()) t.competitors.push({ id: `comp-${n}`, set_id: set.id, client_id: set.client_id, name: n, website_url: n === "NoSite" ? null : `https://${n.toLowerCase().replace(/[^a-z]/g, "")}.com`, rationale: "r", similarity_score: 0.9 - i * 0.1, source: "ai", is_selected: false, selected_rank: null, profile_detection: null, created_at: clock.toISOString() });
      return ok({ set_id: set.id, competitors: [] });
    }
    if (name === "detect-competitor-handles") {
      for (const c of t.competitors.filter((c) => c.set_id === body.set_id)) {
        if (c.name === "Buffy") continue; // nothing found
        t.handles.push({ id: `h-${c.id}`, competitor_id: c.id, client_id: c.client_id, platform: "instagram", handle: c.name.toLowerCase(), profile_url: null, is_active: true, followers: null, detection_confidence: c.name === "Casper" ? 0.5 : 0.95, source: "auto", detected_at: clock.toISOString() });
      }
      return ok({ results: [] });
    }
    if (name === "confirm-competitor-set") { const s = t.sets.find((x) => x.id === body.set_id)!; s.status = "confirmed"; s.confirmed_at = clock.toISOString(); return ok({ ok: true, set_id: body.set_id }); }
    if (name === "setup-rivaliq-landscape") {
      if (body.mode === "preview") return ok({ plan: {}, fingerprint: "fp", job: null });
      const s = t.sets.find((x) => x.id === body.set_id)!; s.rivaliq_landscape_id = "L9"; return ok({ job: { phase: "complete" } });
    }
    if (name === "run-report") {
      const id = body.kind === "competitive" ? "crep-new" : "rep-new";
      if (body.kind === "competitive") t.competitiveReports.push({ ...COMPETITIVE_REPORT, id, client_id: body.client_id as string, status: "running", report_data: {}, created_at: clock.toISOString(), demo_job_id: null });
      else t.reports.push({ ...REPORT, id, client_id: body.client_id as string, status: "running", report_data: {}, created_at: clock.toISOString(), demo_job_id: null });
      return ok({ report_id: id, kind: body.kind, range: { start: "2026-09-01", end: "2026-09-30" }, created_at: clock.toISOString() });
    }
    if (name === "generate-ad-hoc-post") return ok({ post: { platform: body.platform, format: "Image", pillar: "Sleep better", hook: "Sleep on it.", concept: "c", visual_direction: "Bed in morning light", caption_angle: "Sleep on it. Better sheets, better mornings.", CTA: "Shop now", hashtags: "#sleep #bedding" } });
    if (name === "generate-post-image") return ok({ image_url: "data:image/png;base64,AAAA" });
    if (name === "upload-generated-media") return ok({ url: "https://x.supabase.co/storage/v1/object/public/generated-media/c/demo.png" });
    if (name === "sprout-analytics") return ok({ client: { id: body.client_id, name: "x" }, range: { start: body.start, end: body.end, days: 30 }, profiles: [{ id: "123", name: "p", network: "instagram" }], totals: { impressions: 5 }, previous_totals: {}, changes: {}, daily: [], by_profile: [], top_posts: [] });
    if (name === "synthesize-design-language") { const c = t.clients.find((x) => x.id === body.client_id)!; c.harvested_design_references = [{ path: "a" }, { path: "b" }, { path: "c" }]; return ok({}); }
    if (name === "build-design-system") {
      if (body.action === "build") { const d = { ...DESIGN_SYSTEM, id: "ds-new", client_id: body.client_id as string, version: 1, status: "draft", approved_at: null }; t.designSystems.push(d); return ok({ system: { id: "ds-new", version: 1 } }); }
      const d = t.designSystems.find((x) => x.id === body.id)!; d.status = "approved"; d.approved_at = clock.toISOString(); return ok({ system: d });
    }
    return fail(404, { error: `no fake for ${name}` });
  };
  h.ctx = {
    db: makeFakeDemoDb(t),
    call: async (name, body, actAs) => { const b = body as Record<string, unknown>; calls.push({ name, body: b, actAs }); return (over.call && (await over.call(name, b, h))) ?? defaultCall(name, b); },
    keyHashFor: async () => "hash",
    deliverOnce: async (url, payload) => { callbacks.push({ url, payload }); return { status: 200, error: null }; },
    now: () => clock, tool: "socialytics",
  };
  h.job = {
    id: "job-1", tool: "socialytics", key_id: over.keyId === undefined ? "k-1" : over.keyId, status: "queued", steps: initialSteps(DEMO_STEPS), outputs: null, gaps: [], client_id: null, run_ids: [], next_check_at: null, started_at: null, completed_at: null, error: null,
    input: { client_name: "Brooklinen", website: "brooklinen.com", ...(over.input ?? {}) }, requester: { email: "lital@moburst.com" }, callback_url: over.callbackUrl === undefined ? "https://moburst.ai/hook" : over.callbackUrl, callback_status: null,
  };
  return h;
}
/** Run one step and record it on the job the way the engine does (status, data, patch), so the next step sees its effects. */
async function runStep(h: Harness, name: string) {
  const r = await DEMO_STEPS.find((s) => s.name === name)!.run(h.job, h.ctx);
  const rec = h.job.steps.find((x) => x.name === name)!;
  rec.data = { ...(rec.data ?? {}), ...(r.data ?? {}) };
  rec.status = r.status === "waiting" ? "running" : r.status;
  if (r.status !== "waiting" && r.patch) Object.assign(h.job, r.patch);
  return r;
}
const advance = (h: Harness, budgetMs = 60_000) => advanceJob(h.job, DEMO_STEPS, h.ctx, { budgetMs, now: h.ctx.now, save: async () => {} });
async function upTo(h: Harness, name: string) {
  for (const s of DEMO_STEPS) {
    if (s.name === name) break;
    const r = await runStep(h, s.name);
    if (r.status !== "waiting" && r.gaps) h.job.gaps = [...h.job.gaps, ...r.gaps];
  }
}
/** A client an earlier demo job created: the only kind of existing client a demo may reuse. */
const bader = (over: Partial<typeof CLIENT> = {}) => ({ ...CLIENT, company_slug: "demo-bader-law", demo_job_id: "job-0", brand_identity: null, content_pillars: null, social_keywords: null, brief_text: null, harvested_design_references: null, design_references: null, ...over });

describe("step order", () => {
  it("is the documented one", () => {
    expect(DEMO_STEPS.map((s) => s.name)).toEqual(["resolve_client", "brand_identity", "site_brief", "pillars", "design", "competitors", "tracking", "run_social", "run_competitive", "wait_reports", "post", "analytics", "collect", "callback"]);
  });
  it("slugifies names the way the hub does", () => {
    expect(slugify("Bader & Law, LLC")).toBe("bader-and-law-llc");
    expect(slugify("Éclair")).toBe("eclair");
  });
});

describe("resolve_client", () => {
  it("creates the client with a slug, the owner from the requester email, the defaults and the job flag", async () => {
    const h = harness({ tables: { profiles: [{ user_id: "u-lital", email: "lital@moburst.com" }] } });
    const r = await runStep(h, "resolve_client");
    expect(r).toMatchObject({ status: "done", outcome: "created", data: { company_slug: "demo-brooklinen", acted_as: "u-lital" } });
    expect(h.t.clients[0].company_slug).toBe("demo-brooklinen");
    expect(h.t.clients[0]).toMatchObject({ name: "Brooklinen", website_url: "https://brooklinen.com", created_by: "u-lital", primary_platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn"], geo: "US", media_backend: "gemini", demo_job_id: "job-1" });
  });
  it("never reuses a production client, even one with the same website and name", async () => {
    const prod = bader({ id: "c-prod", name: "Brooklinen", website_url: "https://www.brooklinen.com/", company_slug: "brooklinen", created_by: "u-creator", brief_text: "Production brief.", demo_job_id: null });
    const h = harness({ tables: { clients: [prod], profiles: [{ user_id: "u-lital", email: "lital@moburst.com" }] } });
    expect(await runStep(h, "resolve_client")).toMatchObject({ status: "done", outcome: "created", data: { company_slug: "demo-brooklinen", acted_as: "u-lital" } });
    expect(h.t.clients).toHaveLength(2);
    expect(h.t.clients[0]).toEqual(prod);
    expect(h.t.clients[1]).toMatchObject({ company_slug: "demo-brooklinen", demo_job_id: "job-1", brief_text: null });
  });
  it("reuses a demo client from an earlier job, matched by website host, and acts for its creator", async () => {
    const h = harness({ tables: { clients: [bader({ id: "c-x", name: "Brooklinen Inc", website_url: "https://www.brooklinen.com/", company_slug: "demo-brooklinen", created_by: "u-creator", demo_job_id: "job-0" })] } });
    expect(await runStep(h, "resolve_client")).toMatchObject({ status: "done", outcome: "reused", data: { client_id: "c-x", company_slug: "demo-brooklinen", matched_by: "website_or_name", acted_as: "u-creator" } });
    expect(h.t.clients).toHaveLength(1);
  });
  it("adds a suffix when the demo slug is taken", async () => {
    const h = harness({ tables: { clients: [bader({ id: "c-x", name: "Other", website_url: "https://other.com", company_slug: "demo-brooklinen" })] } });
    expect((await runStep(h, "resolve_client")).data?.company_slug).toBe("demo-brooklinen-2");
  });
  it("refuses, before writing, a client outside a scoped key's companies", async () => {
    const scoped = { id: "k-1", company_slugs: ["bader-law"], client_ids: null };
    const h = harness({ tables: { keys: [scoped] } });
    expect(await runStep(h, "resolve_client")).toMatchObject({ status: "failed", fatal: true, reason: "out_of_scope" });
    expect(h.t.clients).toHaveLength(0);
    const reuse = harness({ input: { client_name: "Calm", website: "calm.com" }, tables: { keys: [scoped], clients: [bader({ id: "c-calm", name: "Calm", website_url: "https://calm.com", company_slug: "demo-calm", demo_job_id: "job-0" })] } });
    expect(await runStep(reuse, "resolve_client")).toMatchObject({ status: "failed", fatal: true, reason: "out_of_scope" });
    const allowed = harness({ input: { client_name: "Bader Law", website: "baderlaw.com" }, tables: { keys: [scoped] } });
    expect(await runStep(allowed, "resolve_client")).toMatchObject({ status: "done", outcome: "created", data: { company_slug: "demo-bader-law" } });
    const again = harness({ input: { client_name: "Bader Law", website: "baderlaw.com" }, tables: { keys: [scoped], clients: allowed.t.clients } });
    again.job.id = "job-2";
    expect(await runStep(again, "resolve_client")).toMatchObject({ status: "done", outcome: "reused", data: { company_slug: "demo-bader-law" } });
  });
});

describe("brand, brief and pillars", () => {
  it("research, scrape and derive as the acted-for user, writing only where empty", async () => {
    const h = harness({ tables: { profiles: [{ user_id: "u-lital", email: "lital@moburst.com" }] } });
    await upTo(h, "design");
    const c = h.t.clients[0];
    expect(c.brand_identity).toEqual(BRAND);
    expect(c.brief_text).toMatch(/^Drafted from the website on 2026-10-01:\n\nBrooklinen bedding made well\nThe internet's favorite sheets/);
    expect(c.brief_text).not.toContain("Wishlist");
    expect(c.content_pillars).toHaveLength(2);
    expect(c.social_keywords).toEqual(["bedding", "sheets"]);
    expect(c.pillars_source).toBe("brief");
    expect(h.calls.every((x) => x.actAs === "u-lital")).toBe(true);
    expect(h.calls.map((x) => x.name)).toEqual(["research-brand-identity", "firecrawl-scrape", "derive-content-pillars"]);
    expect(h.calls[0].body).toEqual({ website_url: "https://brooklinen.com", client_name: "Brooklinen" });
  });
  it("skips what the client already has", async () => {
    const h = harness({ tables: { clients: [bader({ brand_identity: BRAND, brief_text: "B".repeat(100), content_pillars: [{ name: "x" }], social_keywords: ["k"], website_url: "https://brooklinen.com" })] } });
    await runStep(h, "resolve_client");
    expect((await runStep(h, "brand_identity")).reason).toBe("brand_exists");
    expect((await runStep(h, "site_brief")).reason).toBe("brief_exists");
    expect((await runStep(h, "pillars")).reason).toBe("pillars_exist");
    expect(h.calls).toHaveLength(0);
  });
  it("records gaps when the site is unreadable or the pillars have no evidence", async () => {
    const h = harness({ call: (name) => (name === "firecrawl-scrape" ? fail(500, { success: false, error: "Firecrawl timeout" }) : name === "derive-content-pillars" ? fail(422, { error: "Nothing to read for Brooklinen." }) : undefined) });
    await runStep(h, "resolve_client");
    await runStep(h, "brand_identity");
    expect(await runStep(h, "site_brief")).toMatchObject({ status: "failed", reason: "scrape_failed", gaps: [{ code: "brief_missing" }] });
    expect(await runStep(h, "pillars")).toMatchObject({ status: "failed", reason: "no_evidence", message: "Nothing to read for Brooklinen.", gaps: [{ code: "pillars_missing" }] });
    expect(h.t.clients[0].brief_text).toBeNull();
  });
});

describe("design", () => {
  it("skips with a gap when the brand has no Sprout profile and no references", async () => {
    const h = harness();
    await upTo(h, "design");
    expect(await runStep(h, "design")).toMatchObject({ status: "skipped", reason: "no_references", gaps: [{ code: "design_system_missing" }] });
    expect(h.calls.some((c) => c.name.includes("design"))).toBe(false);
  });
  it("never builds or approves a design system for a client that existed before the demo", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], sproutProfiles: [{ ...SPROUT_PROFILE, client_id: "c-bader" }] } });
    await runStep(h, "resolve_client");
    expect(await runStep(h, "design")).toMatchObject({ status: "skipped", reason: "existing_client", gaps: [{ code: "design_system_missing" }] });
    expect(h.calls.some((c) => c.name.includes("design"))).toBe(false);
  });
  it("discovers references from the brand's profiles, builds and approves a system for a client it created", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com", demo_job_id: "job-1" })], sproutProfiles: [{ ...SPROUT_PROFILE, client_id: "c-bader" }] } });
    await runStep(h, "resolve_client");
    expect(await runStep(h, "design")).toMatchObject({ status: "done", outcome: "approved", data: { system_id: "ds-new", version: 1, references: 3 } });
    expect(h.calls.map((c) => [c.name, c.body.action ?? c.body.discover])).toEqual([["synthesize-design-language", true], ["build-design-system", "build"], ["build-design-system", "approve"]]);
    expect(h.t.designSystems[0].status).toBe("approved");
  });
  it("skips when an approved system exists and records a gap when the build fails", async () => {
    const existing = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], designSystems: [{ ...DESIGN_SYSTEM, client_id: "c-bader" }] } });
    await runStep(existing, "resolve_client");
    expect((await runStep(existing, "design")).reason).toBe("design_exists");
    const broken = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com", demo_job_id: "job-1", harvested_design_references: [{ path: "a" }, { path: "b" }, { path: "c" }] })] }, call: (name, body) => (name === "build-design-system" && body.action === "build" ? fail(422, { error: "The design service is unavailable." }) : undefined) });
    await runStep(broken, "resolve_client");
    expect(await runStep(broken, "design")).toMatchObject({ status: "failed", reason: "build_failed", gaps: [{ code: "design_system_missing" }] });
  });
});

describe("competitors and tracking", () => {
  it("keeps the set a draft when fewer than three proposals have a website and a verified profile", async () => {
    const h = harness();
    await upTo(h, "competitors");
    // Casper's handle is low confidence, Buffy has none, NoSite has no website: only Parachute and Boll & Branch qualify.
    const r = await runStep(h, "competitors");
    expect(r).toMatchObject({ status: "done", outcome: "draft_only", data: { source: "identified", candidates: 5, placeable: ["Parachute", "Boll & Branch"] }, gaps: [{ code: "competitors_unconfirmed" }] });
    expect((r.data?.unplaced as Array<{ name: string; reason: string }>).map((u) => `${u.name}:${u.reason}`).sort()).toEqual(["Buffy:no_profile_found", "Casper:no_verified_profile", "NoSite:no_website"]);
    expect(h.t.sets[0].status).toBe("draft");
    expect(h.t.sets[0].demo_job_id).toBe("job-1");
    expect(h.calls.filter((c) => c.name === "confirm-competitor-set")).toHaveLength(0);
    h.job.steps.find((s) => s.name === "competitors")!.data = r.data;
    expect(await runStep(h, "tracking")).toMatchObject({ status: "skipped", reason: "connected_only" });
    expect(await runStep(h, "run_competitive")).toMatchObject({ status: "skipped", reason: "connected_only" });
  });
  it("selects the three closest verified competitors, confirms the set, and leaves tracking to the connected product", async () => {
    const h = harness({ call: (name, body, hh) => {
      if (name !== "detect-competitor-handles") return undefined;
      for (const c of hh.t.competitors.filter((c) => c.set_id === body.set_id)) hh.t.handles.push({ id: `h-${c.id}`, competitor_id: c.id, client_id: c.client_id, platform: "instagram", handle: c.name.toLowerCase(), profile_url: null, is_active: true, followers: null, detection_confidence: 0.95, source: "auto", detected_at: hh.clock.toISOString() });
      return ok({ results: [] });
    } });
    await upTo(h, "competitors");
    const r = await runStep(h, "competitors");
    expect(r).toMatchObject({ status: "done", outcome: "3_selected", data: { selected: ["Parachute", "Boll & Branch", "Casper"], unplaced: [{ name: "NoSite", reason: "no_website" }] } });
    expect(r.gaps).toEqual([{ step: "competitors", code: "competitor_unplaced", message: "NoSite was proposed but not selected: no website." }]);
    expect(h.t.competitors.filter((c) => c.is_selected).map((c) => [c.name, c.selected_rank])).toEqual([["Parachute", 1], ["Boll & Branch", 2], ["Casper", 3]]);
    expect(h.t.sets[0].status).toBe("confirmed");
    h.job.steps.find((s) => s.name === "competitors")!.data = r.data;
    // Tracking and the competitive report need a RivalIQ seat; a demo shows them on the connected showcase workspace instead.
    const t = await runStep(h, "tracking");
    expect(t).toMatchObject({ status: "skipped", reason: "connected_only", gaps: [{ step: "tracking", code: "connected_only" }] });
    expect((t.gaps as Array<{ message: string }>)[0].message).toMatch(/connected showcase workspace/);
    expect(h.calls.filter((c) => c.name === "setup-rivaliq-landscape")).toHaveLength(0);
    expect(h.t.sets[0].rivaliq_landscape_id).toBeNull();
    expect(await runStep(h, "run_competitive")).toMatchObject({ status: "skipped", reason: "connected_only" });
    expect(h.calls.filter((c) => c.name === "run-report")).toHaveLength(0);
  });
  it("uses the competitors named in the request and re-runs safely", async () => {
    const h = harness({ input: { competitors: [{ name: "Parachute", website: "parachutehome.com" }, { name: "Buffy", website: "buffy.co" }, { name: "Quince", website: "quince.com" }] }, call: (name, body, hh) => {
      if (name !== "detect-competitor-handles") return undefined;
      for (const c of hh.t.competitors.filter((c) => c.set_id === body.set_id)) hh.t.handles.push({ id: `h-${c.id}`, competitor_id: c.id, client_id: c.client_id, platform: "instagram", handle: c.name.toLowerCase(), profile_url: null, is_active: true, followers: null, detection_confidence: 0.9, source: "auto", detected_at: hh.clock.toISOString() });
      return ok({ results: [] });
    } });
    await upTo(h, "competitors");
    const r = await runStep(h, "competitors");
    expect(r).toMatchObject({ status: "done", outcome: "3_selected", data: { source: "request", selected: ["Parachute", "Buffy", "Quince"] } });
    expect(h.calls.some((c) => c.name === "identify-competitors")).toBe(false);
    expect(h.t.sets[0]).toMatchObject({ source: "manual", demo_job_id: "job-1", status: "confirmed" });
    expect(await runStep(h, "competitors")).toMatchObject({ status: "done", outcome: "already_confirmed" });
  });
  it("skips the competitor step when the demo client already has a confirmed set, and still never tracks", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com", company_slug: "demo-brooklinen", demo_job_id: "job-0" })], sets: [{ id: "set-old", client_id: "c-bader", status: "confirmed", notes: null, source: "ai", rivaliq_landscape_id: null, confirmed_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z", demo_job_id: "job-0" }] } });
    expect(await runStep(h, "resolve_client")).toMatchObject({ outcome: "reused" });
    const r = await runStep(h, "competitors");
    expect(r).toMatchObject({ status: "skipped", reason: "set_exists", data: { set_id: "set-old" } });
    h.job.steps.find((s) => s.name === "competitors")!.data = r.data;
    expect(await runStep(h, "tracking")).toMatchObject({ status: "skipped", reason: "connected_only" });
    expect(h.calls.filter((c) => c.name === "setup-rivaliq-landscape")).toHaveLength(0);
  });
});



describe("reports", () => {
  it("starts the social report for a brand without a Sprout profile and records that it carries no performance section", async () => {
    const h = harness();
    await upTo(h, "run_social");
    const r = await runStep(h, "run_social");
    expect(r).toMatchObject({ status: "done", outcome: "started", gaps: [{ code: "performance_data_unavailable" }] });
    expect(h.calls.at(-1)!.body).toEqual({ client_id: h.job.client_id, kind: "social" });
  });
  it("starts the social report, flags it with the job, and waits until it lands", async () => {
    const h = harness();
    await upTo(h, "run_social");
    h.t.sproutProfiles.push({ ...SPROUT_PROFILE, client_id: h.job.client_id! });
    const r = await runStep(h, "run_social");
    expect(r).toMatchObject({ status: "done", outcome: "started", data: { report_id: "rep-new" }, patch: { run_ids: ["rep-new"] } });
    expect(h.calls.at(-1)!.body).toEqual({ client_id: h.job.client_id, kind: "social" });
    expect(h.t.reports.find((x) => x.id === "rep-new")!.demo_job_id).toBe("job-1");
    Object.assign(h.job, r.patch);
    expect(await runStep(h, "wait_reports")).toMatchObject({ status: "waiting", data: { reports: { "rep-new": "running" } } });
    h.t.reports.find((x) => x.id === "rep-new")!.status = "completed";
    expect(await runStep(h, "wait_reports")).toMatchObject({ status: "done", outcome: "all_completed" });
  });
  it("does not run again when a report completed in the last week, unless force_run", async () => {
    const fresh = { ...REPORT, id: "rep-fresh", client_id: "c-bader", status: "completed", created_at: "2026-09-29T00:00:00.000Z" };
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], reports: [fresh], sproutProfiles: [SPROUT_PROFILE] } });
    await runStep(h, "resolve_client");
    expect(await runStep(h, "run_social")).toMatchObject({ status: "skipped", reason: "fresh_report_exists", patch: { run_ids: ["rep-fresh"] } });
    const forced = harness({ input: { force_run: true }, tables: { clients: [bader({ website_url: "https://brooklinen.com" })], reports: [fresh], sproutProfiles: [SPROUT_PROFILE] } });
    await runStep(forced, "resolve_client");
    expect((await runStep(forced, "run_social")).outcome).toBe("started");
  });
  it("times out a report after 100 minutes and records a failed one", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], reports: [{ ...REPORT, id: "r-slow", client_id: "c-bader", status: "running", created_at: "2026-10-01T10:00:00.000Z" }, { ...REPORT, id: "r-bad", client_id: "c-bader", status: "failed", report_data: { error: "n8n stopped" }, created_at: "2026-10-01T11:00:00.000Z" }] } });
    h.job.run_ids = ["r-slow", "r-bad"];
    const r = await runStep(h, "wait_reports");
    expect(r).toMatchObject({ status: "failed", reason: "run_timeout", data: { reports: { "r-slow": "timed_out", "r-bad": "failed" } } });
    expect(r.gaps?.map((g) => g.code)).toEqual(["report_failed", "report_timeout"]);
    expect(r.gaps?.[0].message).toBe("The social report ended with an error: n8n stopped");
  });
});

describe("post and analytics", () => {
  it("takes the first calendar post of the completed report, renders it and stores the image", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], reports: [{ ...REPORT, id: "rep-done", client_id: "c-bader", demo_job_id: "job-1" }] } });
    await runStep(h, "resolve_client");
    h.job.run_ids = ["rep-done"];
    const r = await runStep(h, "post");
    expect(r).toMatchObject({ status: "done", outcome: "generated", data: { source: "calendar", platform: "Instagram", media_url: expect.stringContaining("generated-media") } });
    expect(h.t.posts[0]).toMatchObject({ report_id: "rep-done", post_copy: "Know your rights after a crash.", source: "calendar", demo_job_id: "job-1", media_urls: [expect.stringContaining("demo.png")], created_by: "u1" });
    expect(h.calls.map((c) => c.name)).toEqual(["generate-post-image", "upload-generated-media"]);
    // The upload function adds the extension itself; a name with one came back as ".png.png" live.
    expect(h.calls[1].body).toMatchObject({ media_type: "image", file_name: "demo-job-1" });
    expect(h.calls[0].body).toMatchObject({ client_id: "c-bader", platform: "Instagram", prompt: "Lawyer at desk" });
    expect(await runStep(h, "post")).toMatchObject({ status: "done", outcome: "already_generated" });
  });
  it("writes an ad-hoc post from the pillars when there is no report, and keeps the copy when the image fails", async () => {
    const h = harness({ call: (name) => (name === "generate-post-image" ? fail(400, { error: "Gemini API key not configured." }) : undefined) });
    await upTo(h, "post");
    const r = await runStep(h, "post");
    expect(r).toMatchObject({ status: "done", outcome: "copy_only", data: { source: "ad_hoc" }, gaps: [{ code: "post_image_missing" }] });
    const adhoc = h.calls.find((c) => c.name === "generate-ad-hoc-post")!;
    expect(adhoc.body).toEqual({ client_id: h.job.client_id, platform: "Instagram", topic: "Sleep better", creative_type: "Image" });
    expect(h.t.posts[0]).toMatchObject({ post_copy: "Sleep on it. Better sheets, better mornings.", hashtags: ["#sleep", "#bedding"], cta: "Shop now", media_urls: [] });
    // A re-run finishes the image without writing a second post.
    const again = await runStep(h, "post");
    expect(again.outcome).toBe("copy_only");
    expect(h.t.posts).toHaveLength(1);
  });
  it("fetches analytics for the last 30 days when the client has Sprout profiles, else records the gap", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], sproutProfiles: [{ ...SPROUT_PROFILE, client_id: "c-bader" }] } });
    await runStep(h, "resolve_client");
    const r = await runStep(h, "analytics");
    expect(r).toMatchObject({ status: "done", outcome: "fetched", data: { range: { start: "2026-09-02", end: "2026-10-01" }, profiles: 1, totals: { impressions: 5 } } });
    expect(JSON.stringify(r.data)).not.toContain('"123"');
    const none = harness();
    await runStep(none, "resolve_client");
    expect(await runStep(none, "analytics")).toMatchObject({ status: "skipped", reason: "no_sprout_profiles", gaps: [{ code: "analytics_unavailable" }] });
  });
});

describe("the whole job", () => {
  it("runs end to end for a brand with no Sprout profile, collects the outputs and delivers the callback", async () => {
    const h = harness({ call: (name, body, hh) => {
      if (name === "run-report") { const id = body.kind === "competitive" ? "crep-new" : "rep-new"; const row = body.kind === "competitive" ? { ...COMPETITIVE_REPORT, id, client_id: body.client_id as string, status: "complete", created_at: hh.clock.toISOString(), demo_job_id: null } : { ...REPORT, id, client_id: body.client_id as string, status: "completed", created_at: hh.clock.toISOString(), demo_job_id: null }; (body.kind === "competitive" ? hh.t.competitiveReports : hh.t.reports).push(row as never); return ok({ report_id: id, kind: body.kind }); }
      if (name === "detect-competitor-handles") { for (const c of hh.t.competitors.filter((c) => c.set_id === body.set_id)) hh.t.handles.push({ id: `h-${c.id}`, competitor_id: c.id, client_id: c.client_id, platform: "instagram", handle: c.name, profile_url: null, is_active: true, followers: null, detection_confidence: 0.95, source: "auto", detected_at: hh.clock.toISOString() }); return ok({ results: [] }); }
      return undefined;
    } });
    const r = await advance(h);
    expect(r.stopped).toBe("finished");
    expect(h.job.status).toBe("completed");
    expect(h.job.steps.map((s) => `${s.name}:${s.status}:${s.outcome ?? s.reason}`)).toEqual([
      "resolve_client:done:created", "brand_identity:done:researched", "site_brief:done:drafted", "pillars:done:derived", "design:skipped:no_references", "competitors:done:3_selected", "tracking:skipped:connected_only",
      "run_social:done:started", "run_competitive:skipped:connected_only", "wait_reports:done:all_completed", "post:done:generated", "analytics:skipped:no_sprout_profiles", "collect:done:collected", "callback:done:delivered",
    ]);
    const out = h.job.outputs as Record<string, Record<string, unknown>>;
    expect(out.client).toMatchObject({ name: "Brooklinen", pillars: [{ name: "Sleep better" }, { name: "Home comfort" }] });
    expect(out.competitors).toMatchObject({ set_status: "confirmed", tracked: false, selected: [{ name: "Parachute" }, { name: "Boll & Branch" }, { name: "Casper" }] });
    expect((out.reports as unknown as unknown[]).length).toBe(1);
    expect(out.social_report).toMatchObject({ id: "rep-new", status: "completed" });
    expect(out.competitive_report).toBeNull();
    expect(out.post).toMatchObject({ copy: "Know your rights after a crash.", source: "calendar", media_urls: [expect.stringContaining("demo.png")] });
    expect(out.design).toEqual({ status: "none", version: null, previews: [] });
    expect(out.analytics).toBeNull();
    expect(h.job.gaps.map((g) => g.code).sort()).toEqual(["analytics_unavailable", "competitor_unplaced", "connected_only", "design_system_missing", "performance_data_unavailable"]);
    expect(h.callbacks).toHaveLength(1);
    expect((h.callbacks[0] as { payload: { status: string; job_id: string } }).payload).toMatchObject({ job_id: "job-1", status: "completed" });
    expect(JSON.stringify(out)).not.toMatch(/L9|123456/);
  });
  it("ends failed when the key may not touch the client, writing nothing", async () => {
    const h = harness({ tables: { keys: [{ id: "k-1", company_slugs: ["bader-law"], client_ids: null }] } });
    const r = await advance(h);
    expect(r.stopped).toBe("finished");
    expect(h.job.status).toBe("failed");
    expect(h.job.error).toMatch(/may not work/);
    expect(h.t.clients).toHaveLength(0);
    expect(h.job.steps.filter((s) => s.status === "skipped" && s.reason === "job_failed")).toHaveLength(12);
    expect(h.callbacks).toHaveLength(1);
    expect((h.callbacks[0] as { payload: { status: string } }).payload.status).toBe("failed");
  });
});

describe("refreshOutputs", () => {
  it("folds in a report that landed after the job closed, once", async () => {
    const h = harness({ tables: { clients: [bader({ website_url: "https://brooklinen.com" })], reports: [{ ...REPORT, id: "rep-late", client_id: "c-bader", status: "running", report_data: {}, demo_job_id: "job-1" }] } });
    await runStep(h, "resolve_client");
    h.job.run_ids = ["rep-late"];
    h.job.status = "partial";
    h.job.outputs = { reports: [{ id: "rep-late", status: "running" }] };
    expect(await refreshOutputs(h.job, h.ctx)).toBe(false);
    Object.assign(h.t.reports[0], { status: "completed", report_data: REPORT.report_data });
    expect(await refreshOutputs(h.job, h.ctx)).toBe(true);
    expect((h.job.outputs as { social_report: { status: string } }).social_report.status).toBe("completed");
    expect(await refreshOutputs(h.job, h.ctx)).toBe(false);
  });
});
