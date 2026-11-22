// @vitest-environment node
// P32-1 (QA 22 Nov 2026): a carousel whose one hard slide has used its 3 designs never moves again.
// Slide A (index 1) waits in generate for a design a sibling may leave (slideAllowance "wait").
// Slide B (index 2) passed its checks and waits in verify for the cover's logo decision.
// The cover passed its checks and waits for every sibling to be ready, A included.
// Each "wait" spends no try, so the request only ends at the 90-minute sweep with nothing.
import { describe, expect, it } from "vitest";
import { type AgreeDeps, type SiblingRow, agreeOnLogo } from "../../../functions/_shared/design/carouselLogo";
import { MAX_GENERATIONS, slideAllowance } from "../../../functions/_shared/design/modelSteps";

const COVER = "c1/canva-finish/cover/design-1.png";
const RECT = { x: 100, y: 100, width: 400, height: 130 };
const INKS = { stored: [[11, 14, 26]] };
const never = () => { throw new Error("not called"); };

describe("P32 carousel wait cycle", () => {
  it("some slide of the option makes progress within a few passes", async () => {
    const coverState: Record<string, unknown> = { design_path: COVER, generations: 1, logo_inks: INKS, logo_ground: [240, 240, 240], checks_passed: "f0.png", logo_place: { at: RECT, kept: "same" } };
    const bState: Record<string, unknown> = { cover_path: COVER, generations: 1, logo_inks: INKS, logo_ground: [240, 240, 240], checks_passed: "f2.png", logo_place: { at: RECT, kept: "same" } };
    const aState: Record<string, unknown> = { cover_path: COVER, generations: MAX_GENERATIONS };
    const rows = (): (SiblingRow & { id: string })[] => [
      { id: "A", status: "running", step: "generate", state: aState },
      { id: "B", status: "running", step: "verify", state: bState },
    ];
    const deps = (): AgreeDeps => ({ measure: never, stamp: never, clearAt: never, save: async () => {}, siblings: async () => rows(), cover: async () => ({ status: "running", state: coverState }) });
    const seen: string[] = [];
    for (let pass = 0; pass < 10; pass++) {
      const c = await agreeOnLogo({ slide_index: 0, slide_count: 3, state: coverState }, () => [], deps());
      const b = await agreeOnLogo({ slide_index: 2, slide_count: 3, state: bState }, () => [], deps());
      const a = slideAllowance({ id: "A", state: aState }, rows());
      seen.push(`${c}/${b}/${a}`);
    }
    // At least one of the three moves on: the hard slide may use a design the finished slide left.
    expect(seen.some((s) => s !== "wait/wait/wait")).toBe(true);
    expect(slideAllowance({ id: "A", state: aState }, rows())).toBe("more");
  });
});
