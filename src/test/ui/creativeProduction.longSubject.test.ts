// P13: frameIndexFor matches a design to its frame by angle.endsWith(subject.slice(0, 80)), which misses every subject over 80 characters.
import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { frameIndexFor, type ProductionPlan } from "@/lib/creativeProduction";

describe("P13 frameIndexFor", () => {
  it("finds the frame of a single design whose subject is longer than 80 characters", () => {
    const subject = (s: string) => `${s} on a walnut desk beside a closed laptop, lit by warm late-afternoon window light`;
    const plan = { frames: [{ subject: subject("A brass scale") }, { subject: subject("A leather case file") }] } as unknown as ProductionPlan;
    const row = { variant_angle: `Reference creative 11111111-1111-1111-1111-111111111111: ${plan.frames[1].subject}` };
    expect(frameIndexFor(plan, row, 0)).toBe(1);
  });
});
