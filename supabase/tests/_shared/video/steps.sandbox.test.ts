// @vitest-environment node
// The video steps that run a script in the hosted sandbox (steps.ts:
// transcribe, assemble, style_cut and their waits), over a fake sandbox, a
// fake job row (canva/jobRow.ts) and the worker's own pass (advance.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) } }; });
vi.mock("https://deno.land/std@0.168.0/encoding/base64.ts", () => ({ decode: () => new Uint8Array(), encode: () => "" }));

const sandbox = vi.hoisted(() => ({
  ended: new Set<string>(),
  checked: [] as string[],
  started: 0,
  startDown: 0,
  answer: { state: "finished", reply: "COMPOSED 500000 8.0 1" } as Record<string, unknown>,
}));
vi.mock("../../../functions/_shared/video/sandbox.ts", async () => {
  const { ModelBusy } = await import("../../../functions/_shared/media/modelBusy");
  return {
    startScript: vi.fn(async () => {
      if (sandbox.startDown > 0) { sandbox.startDown--; throw new ModelBusy("Hosted sandbox POST /v1/sessions 529: overloaded"); }
      return `sess-${++sandbox.started}`;
    }),
    // A deleted session is not found (the hosted API answers 404 for it).
    checkScript: vi.fn(async (id: string) => {
      sandbox.checked.push(id);
      if (sandbox.ended.has(id)) throw new Error(`Hosted sandbox GET /v1/sessions/${id} 404: not found`);
      return sandbox.answer;
    }),
    endScript: vi.fn(async (id: string) => { sandbox.ended.add(id); }),
  };
});
const vision = vi.hoisted(() => ({ fail: 0 }));
vi.mock("../../../functions/_shared/anthropic.ts", () => ({
  anthropicMessages: vi.fn(async () => {
    if (vision.fail > 0) { vision.fail--; throw new Error("Anthropic API error 529: overloaded"); }
    return { text: '{"writing":[]}', stopReason: "end_turn", raw: null };
  }),
  anthropicFetch: vi.fn(),
}));

import { runVideoStep, type VideoJob } from "../../../functions/_shared/video/steps";
import { advanceVideoJob } from "../../../functions/_shared/video/advance";
import { jobRow } from "../canva/jobRow";

const NOW = Date.parse("2026-11-20T10:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sandbox.ended.clear(); sandbox.checked.length = 0; sandbox.started = 0; sandbox.startDown = 0;
  sandbox.answer = { state: "finished", reply: "COMPOSED 500000 8.0 1" };
  vision.fail = 0;
});
afterEach(() => { vi.useRealTimers(); });

const stills = [0, 1, 2, 3].map((i) => `c1/canva-finish/job-1/still-${i}.jpg`);
const bucket = (download: () => Promise<{ data: Blob | null; error: { message: string } | null }>) => ({
  download,
  createSignedUploadUrl: async () => ({ data: { signedUrl: "https://example.test/upload" }, error: null }),
  getPublicUrl: () => ({ data: { publicUrl: "https://example.test/public" } }),
});
const stillBytes = async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null });

async function passes(r: ReturnType<typeof jobRow>, admin: unknown, n: number, gapMs = 31_000) {
  for (let pass = 0; pass < n && r.row.status === "running"; pass++) {
    await advanceVideoJob(admin, r.read() as VideoJob & { attempts: number }, (job) => runVideoStep(admin, job), () => true);
    vi.setSystemTime(Date.now() + gapMs);
  }
}

describe("assemble_wait after the join finished", () => {
  it("a still that could not be read once does not lose the finished video", async () => {
    // QA 22 Nov 2026 (P54-01): the session was deleted before the stills were read, so every later pass asked the deleted session and spent the job's tries.
    const r = jobRow({
      step: "assemble_wait",
      state: { compose_session: "sess-1", compose_checked_at: NOW - 60_000, still_paths: stills, video_path: "c1/canva-finish/job-1/video-a.mp4", footage_path: "c1/canva-finish/job-1/clip.mp4" },
      input: { brand_name: "Acme", copy: ["Hi"], show_logo: false },
    });
    let reads = 0;
    const admin = { ...r.admin, storage: { from: () => bucket(async () => (++reads === 1 ? { data: null, error: { message: "timeout" } } : stillBytes())) } };
    await passes(r, admin, 5);
    expect(sandbox.checked.filter((id) => id === "sess-1").length).toBe(1);
    expect(r.row).toMatchObject({ status: "done", output_path: "c1/canva-finish/job-1/video-a.mp4" });
    expect(r.row.state).toMatchObject({ video_seconds: 8 });
  });

  it("the stills' check with the vision model overloaded is waited out, never a spent try", async () => {
    const r = jobRow({
      step: "assemble_wait",
      state: { compose_session: "sess-1", compose_checked_at: NOW - 60_000, still_paths: stills, video_path: "c1/canva-finish/job-1/video-a.mp4", footage_path: "c1/canva-finish/job-1/clip.mp4" },
      input: { brand_name: "Acme", copy: ["Hi"], show_logo: false },
    });
    vision.fail = 5;
    const admin = { ...r.admin, storage: { from: () => bucket(stillBytes) } };
    await passes(r, admin, 7);
    expect(r.row).toMatchObject({ status: "done", attempts: 0 });
    expect(sandbox.checked).toEqual(["sess-1"]);
  });
});

describe("assemble with the sandbox briefly down", () => {
  it("an outage of three passes after the clip is paid for does not end the video, and spends none of its joins", async () => {
    // QA 22 Nov 2026 (P54-02): each outage pass spent a try and one of the three joins.
    sandbox.startDown = 3;
    sandbox.answer = { state: "running" };
    const r = jobRow({
      step: "assemble",
      state: { footage_path: "c1/canva-finish/job-1/clip.mp4" },
      input: { brand_name: "Acme", copy: [], show_logo: false, logo_size: [400, 200], logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.2, top: 0.05 } },
    });
    const admin = { ...r.admin, storage: { from: () => bucket(stillBytes) } };
    await passes(r, admin, 4, 60_000);
    expect(r.row).toMatchObject({ status: "running", step: "assemble_wait", attempts: 0 });
    expect(r.row.state).toMatchObject({ composes: 1, compose_session: "sess-1" });
  });
});

describe("a script that never finishes", () => {
  it("assemble_wait gives up on a join still running after its time and joins again", async () => {
    // QA 22 Nov 2026 (P53-04): the *_wait steps had no time limit of their own.
    sandbox.answer = { state: "running" };
    const r = jobRow({
      step: "assemble",
      state: { footage_path: "c1/canva-finish/job-1/clip.mp4" },
      input: { brand_name: "Acme", copy: [], show_logo: false, logo_size: [400, 200], logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.2, top: 0.05 } },
    });
    const admin = { ...r.admin, storage: { from: () => bucket(stillBytes) } };
    await passes(r, admin, 1);
    expect(r.row.state).toMatchObject({ compose_session: "sess-1", composes: 1 });
    await passes(r, admin, 5, 10 * 60_000);
    expect(r.row.state).toMatchObject({ composes: 2, compose_session: "sess-2" });
    expect(sandbox.ended.has("sess-1")).toBe(true);
    expect((r.row.state as { compose_errors?: string[] }).compose_errors?.[0]).toMatch(/did not finish/);
  });

  it("a join started before the limit was kept is timed from its first check", async () => {
    sandbox.answer = { state: "running" };
    const r = jobRow({
      step: "assemble_wait",
      state: { compose_session: "sess-old", compose_checked_at: NOW - 60_000, composes: 1, still_paths: stills, video_path: "v.mp4", footage_path: "clip.mp4" },
      input: { brand_name: "Acme", copy: [], show_logo: false },
    });
    const admin = { ...r.admin, storage: { from: () => bucket(stillBytes) } };
    await passes(r, admin, 2, 20 * 60_000);
    expect(r.row.state).toMatchObject({ compose_session: "sess-old" });
    await passes(r, admin, 1, 20 * 60_000);
    expect(sandbox.ended.has("sess-old")).toBe(true);
  });
});
