// @vitest-environment node
// The kit's cleaning run through claims of the kit and the video worker's
// hold over one fake job row: a wait (the picture service unavailable, the
// image model busy) costs no try of the kit and no try of the job, a call
// the picture service refused costs a try of the job and none of the kit,
// and no paid edit is ever paid for twice.
import { describe, expect, it } from "vitest";
import { MAX_VIDEO_ATTEMPTS, VIDEO_LIMITS } from "../../../functions/_shared/video/advance";
import { MAX_KIT_TRIES, kitClaimed, kitDoneOf, kitWork } from "../../../functions/_shared/video/kit";
import { type KitCleanDeps, cleanKitStills } from "../../../functions/_shared/video/kitStep";
import { heldWork } from "../../../functions/_shared/canva/hold";
import { ModelBusy } from "../../../functions/_shared/media/modelBusy";
import { PictureError } from "../../../functions/_shared/picture/client";
import { jobRow } from "../canva/jobRow";

const MADE_AT = "2026-11-12T08:00:00.000Z";
// A JPEG's first bytes, with a 540 x 960 frame: all the cleaning reads of a still is its size.
const STILL = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0xc0, 0x02, 0x1c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PICK = ["c1/style/v0-f0.jpg", "c1/style/v0-f1.jpg"];
const unavailable = () => new PictureError("The picture service did not answer: 503.", "transcode", "unavailable");

type Fakes = Omit<KitCleanDeps, "save">;
function fakes(over: Partial<Fakes> = {}) {
  const calls: string[] = [];
  const deps: Fakes = {
    still: async (path) => { calls.push(`still:${path}`); return STILL; },
    editor: async () => async () => { calls.push("edit"); return new Uint8Array([9]); },
    storeEdit: async (path) => { calls.push(`storeEdit:${path}`); },
    transcode: async (edit, jpeg) => { calls.push(`transcode:${edit}:${jpeg}`); return 95; },
    check: async () => ({ writing: false, face: false, where: "" }),
    remove: async (path) => { calls.push(`remove:${path}`); },
    ...over,
  };
  return { calls, deps };
}

/** One claim of the kit by the row's job, as the kit step makes it: its tries counted, then the cleaning held to its end. Returns what the claim did. */
async function claim(r: ReturnType<typeof jobRow>, deps: Fakes): Promise<string> {
  const job = r.read();
  job.state = kitClaimed(job.state, MADE_AT);
  const s = job.state as { kit_pick: string[]; kit_done?: unknown; kit_tries: number; kit_held_at?: number };
  const work = kitWork(s.kit_pick.length, kitDoneOf(s.kit_done), s.kit_tries);
  if (work.kind !== "clean") return work.kind;
  s.kit_held_at = Date.now();
  const save = async () => { if (r.row.status === "running") r.row.state = structuredClone(job.state); };
  await heldWork(r.admin, { ...job, step: "kit" }, () => cleanKitStills({ ...deps, save }, job, s.kit_pick, work.todo), { ...VIDEO_LIMITS, leaseMs: 420_000 });
  return "clean";
}

const edits = (calls: string[]) => calls.filter((c) => c === "edit").length;
const kitJob = () => jobRow({ step: "kit", design_request_id: null, input: { kind: "video", purpose: "style" }, state: { kit_of: MADE_AT, kit_pick: PICK } });

describe("the kit's cleaning through an unavailable picture service", () => {
  it("spends no try of the kit or of the job, and pays for each still's edit once", async () => {
    const r = kitJob();
    const down = fakes({ transcode: async () => { throw unavailable(); } });
    // More claims than the kit has tries: with each counted as a try the kit would be stored empty.
    for (let i = 0; i < MAX_KIT_TRIES + 2; i++) {
      expect(await claim(r, down.deps)).toBe("clean");
      expect(r.row).toMatchObject({ status: "running", attempts: 0, error: "The picture service did not answer: 503.", lease_until: null });
      expect(r.row.state.kit_tries).toBe(0);
    }
    expect(edits(down.calls)).toBe(PICK.length);
    expect(r.row.state).toMatchObject({
      kit_spared: true,
      kit_done: {},
      kit_edits: { "0-1": "c1/style/kit-0-edit-1.png", "1-1": "c1/style/kit-1-edit-1.png" },
    });
    expect(r.row.state.kit_held_at).toBeUndefined();

    // The service is back: both stills are finished from their stored edits, and nothing is paid for.
    const up = fakes();
    expect(await claim(r, up.deps)).toBe("clean");
    expect(edits(up.calls)).toBe(0);
    expect(up.calls.filter((c) => c.startsWith("transcode:"))).toEqual([
      "transcode:c1/style/kit-0-edit-1.png:c1/style/kit-0.jpg",
      "transcode:c1/style/kit-1-edit-1.png:c1/style/kit-1.jpg",
    ]);
    expect(r.row.state).toMatchObject({
      kit_tries: 0,
      kit_done: { "0": { path: "c1/style/kit-0.jpg" }, "1": { path: "c1/style/kit-1.jpg" } },
      kit_edits: {},
      picture_ms: { transcode: 95 },
    });
    expect(r.row.state.kit_spared).toBeUndefined();
    expect(r.row.error).toBeNull();
    expect(await claim(r, up.deps)).toBe("store");
  });

  it("spends no try of the kit while the image model is busy", async () => {
    const r = kitJob();
    const busy = fakes({ editor: async () => async () => { throw new ModelBusy("Image model 429"); } });
    for (let i = 0; i < MAX_KIT_TRIES + 2; i++) expect(await claim(r, busy.deps)).toBe("clean");
    expect(r.row).toMatchObject({ status: "running", attempts: 0, error: "Image model 429" });
    expect(r.row.state).toMatchObject({ kit_tries: 0, kit_spared: true });
  });

  it("spares only the claim that waited: a claim after it that finishes nothing is a try", async () => {
    const r = kitJob();
    await claim(r, fakes({ transcode: async () => { throw unavailable(); } }).deps);
    const unread = fakes({ check: async () => { throw new Error("The kit still could not be read: ..."); } });
    await claim(r, unread.deps);
    expect(r.row.state.kit_tries).toBe(0);
    expect(r.row.state.kit_spared).toBeUndefined();
    await claim(r, unread.deps);
    expect(r.row.state.kit_tries).toBe(1);
  });
});

describe("the kit's cleaning through a call the picture service refused", () => {
  const refusal = () => new PictureError("The picture service refused the call (401): Not allowed.", "transcode", "refused");

  it("spends a try of the job, never of the kit, and the job fails after its tries with the service's reason", async () => {
    const r = kitJob();
    const refused = fakes({ transcode: async () => { throw refusal(); } });
    // More claims than the kit has tries: with each counted as a try of the kit, an empty kit would be stored and the client's videos would take the posts route.
    expect(MAX_VIDEO_ATTEMPTS).toBeGreaterThan(MAX_KIT_TRIES);
    for (let i = 1; i < MAX_VIDEO_ATTEMPTS; i++) {
      expect(await claim(r, refused.deps)).toBe("clean");
      expect(r.row).toMatchObject({ status: "running", attempts: i, error: "The picture service refused the call (401): Not allowed.", lease_until: null });
      expect(r.row.state.kit_tries).toBe(0);
    }
    expect(await claim(r, refused.deps)).toBe("clean");
    expect(r.row).toMatchObject({ status: "failed", attempts: MAX_VIDEO_ATTEMPTS, error: "The picture service refused the call (401): Not allowed." });
    // A refusal says nothing about the stills: no kit error, no kit try, and each still's paid edit kept.
    expect(r.row.state).toMatchObject({
      kit_tries: 0,
      kit_done: {},
      kit_edits: { "0-1": "c1/style/kit-0-edit-1.png", "1-1": "c1/style/kit-1-edit-1.png" },
    });
    expect(r.row.state.kit_errors).toBeUndefined();
    expect(r.row.state.kit_held_at).toBeUndefined();
    expect(edits(refused.calls)).toBe(PICK.length);
  });

  it("finishes the stills from their kept edits once the call is let through, with nothing paid for again", async () => {
    const r = kitJob();
    await claim(r, fakes({ transcode: async () => { throw refusal(); } }).deps);
    expect(r.row).toMatchObject({ status: "running", attempts: 1 });
    const up = fakes();
    expect(await claim(r, up.deps)).toBe("clean");
    expect(edits(up.calls)).toBe(0);
    expect(r.row).toMatchObject({ status: "running", attempts: 1, error: null });
    expect(r.row.state).toMatchObject({ kit_tries: 0, kit_done: { "0": { path: "c1/style/kit-0.jpg" }, "1": { path: "c1/style/kit-1.jpg" } } });
  });

  it("is the reason the job keeps when another still only waited", async () => {
    const r = kitJob();
    const mixed = fakes({ transcode: async (edit) => {
      if (edit === "c1/style/kit-0-edit-1.png") throw unavailable();
      throw refusal();
    } });
    await claim(r, mixed.deps);
    expect(r.row).toMatchObject({ status: "running", attempts: 1, error: "The picture service refused the call (401): Not allowed." });
    expect(r.row.state.kit_tries).toBe(0);
    expect(r.row.state.kit_errors).toBeUndefined();
  });
});

describe("the kit's cleaning with errors about its stills", () => {
  it("keeps the error as a try of the kit, never of the job, and stores the kit once its tries are spent", async () => {
    const r = kitJob();
    const unread = fakes({ check: async () => { throw new Error("The kit still could not be read: ..."); } });
    const did: string[] = [];
    for (let i = 0; i < MAX_KIT_TRIES + 1; i++) did.push(await claim(r, unread.deps));
    expect(did).toEqual(["clean", "clean", "clean", "spent"]);
    expect(r.row).toMatchObject({ status: "running", attempts: 0 });
    expect(r.row.state.kit_errors).toHaveLength(3);
    // The edits were kept all along: each still was paid for once.
    expect(edits(unread.calls)).toBe(PICK.length);
  });

  it("forgets an edit the picture service could not work with, so the kit's next try pays for that round again", async () => {
    const r = kitJob();
    const bad = fakes({ transcode: async (edit) => {
      if (edit === "c1/style/kit-0-edit-1.png") throw new PictureError("The picture could not be decoded.", "transcode", "unusable");
      return 95;
    } });
    await claim(r, bad.deps);
    expect(r.row.state.kit_edits).toEqual({});
    expect(r.row.state.kit_done).toEqual({ "1": { path: "c1/style/kit-1.jpg" } });
    expect(r.row.state.kit_errors).toEqual(["The picture could not be decoded."]);

    const up = fakes();
    await claim(r, up.deps);
    expect(edits(up.calls)).toBe(1);
    expect(r.row.state.kit_done).toEqual({ "0": { path: "c1/style/kit-0.jpg" }, "1": { path: "c1/style/kit-1.jpg" } });
  });

  it("cleans a still once more when writing is left, drops one that shows a face, and removes what is not kept", async () => {
    const r = kitJob();
    let checks = 0;
    const f = fakes({ check: async (path) => {
      if (path === "c1/style/kit-1.jpg") return { writing: false, face: true, where: "a face" };
      return { writing: ++checks === 1, face: false, where: "a caption" };
    } });
    await claim(r, f.deps);
    expect(r.row.state.kit_done).toEqual({ "0": { path: "c1/style/kit-0.jpg" }, "1": { dropped: true } });
    expect(edits(f.calls)).toBe(3);
    expect(f.calls).toContain("storeEdit:c1/style/kit-0-edit-2.png");
    expect(f.calls).toContain("remove:c1/style/kit-1.jpg");
    expect(r.row.state.kit_edits).toEqual({});
  });
});
