import { describe, expect, it } from "vitest";
import { fakeDb } from "../lifecycle/fakeDb";
import { type DesignRequest, type Settings, BUCKET, startOption } from "./jobs";
import { designPrompt, type GenerateInput } from "./brief";
import { STORY_PAGE, storyLogoPlacement } from "../design/story";

// Starting a post's design: the job a request hands the design worker.

/** A PNG's first 24 bytes: its signature and its IHDR width and height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(bytes.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return bytes;
}

const settings: Settings = {
  client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.323, top: 0.048 }, background: "#0B0E1A", reference_paths: ["c1/a.jpg", "c1/b.jpg", "c1/c.jpg"],
};
const request = (over: Partial<DesignRequest> = {}): DesignRequest => ({
  id: "req-1", client_id: "c1", report_id: null, calendar_post_key: "post:1", platform: "Instagram", format: "Single image", post_copy: "Captains pay last.",
  requested_by: "person-1", status: "preparing", kind: "single", options_wanted: 1, candidates_started: 0,
  briefs: [{ headline: ["Captains pay last"], picture: "a hockey bench at dawn", refs: ["c1/b.jpg"] }], ...over,
});

async function started(req: DesignRequest) {
  const db = fakeDb({ canva_finish_jobs: [] });
  db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
  await startOption(db, req, settings, "Pay The Pyper", 0, 0);
  expect(db.tables.canva_finish_jobs).toHaveLength(1);
  return db.tables.canva_finish_jobs[0];
}

describe("startOption", () => {
  it("draws a feed still on the default 4:5 page at the client's own logo spot", async () => {
    const job = await started(request());
    expect(job.input.placement).toEqual(settings.placement);
    expect(job.input.generate.size).toBeUndefined();
    expect(job.input.generate.surface).toBeUndefined();
  });

  it("draws a Story on its 9:16 page, as a Story, with the logo moved into the safe band", async () => {
    for (const platform of ["Instagram", "Facebook"]) {
      const job = await started(request({ format: "Story", platform }));
      expect(job.input.generate.size).toEqual(STORY_PAGE);
      expect(job.input.generate.surface).toBe("story");
      expect(job.input.placement).toEqual(storyLogoPlacement(settings.placement, 701, 251));
      expect(job.input.placement.top).toBe(0.14);
      const prompt = designPrompt(job.input.generate as GenerateInput, job.input.copy, job.input.generate.refs.length);
      expect(prompt).toContain("Story (9:16)");
      expect(prompt).not.toContain("4:5");
    }
  });

  it("hands the note a design was asked with to the job, so the image model sees it and a retry keeps it", async () => {
    const note = "Show the rink at night, no people";
    for (const req of [request({ note }), request({ note, format: "Story" }), request({ note, kind: "carousel", briefs: [{ headline: ["A"], picture: "p", slides: [{ headline: ["A"], picture: "p1" }, { headline: ["B"], picture: "p2" }] }] })]) {
      const db = fakeDb({ canva_finish_jobs: [] });
      db.uploads.set(`${BUCKET}/${settings.logo_path}`, pngHeader(701, 251));
      await startOption(db, req, settings, "Pay The Pyper", 0, 0);
      for (const job of db.tables.canva_finish_jobs) {
        expect(job.input.generate.note).toBe(note);
        expect(designPrompt(job.input.generate as GenerateInput, job.input.copy, job.input.generate.refs.length)).toContain(`"${note}"`);
      }
    }
    expect((await started(request())).input.generate.note).toBeUndefined();
  });

  it("keeps a post called Story on another network the way it was made before", async () => {
    const job = await started(request({ format: "Story", platform: "LinkedIn" }));
    expect(job.input.generate.surface).toBeUndefined();
    expect(job.input.placement).toEqual(settings.placement);
  });
});
