import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RankedBars } from "@/components/ui/bars";
import * as bars from "@/components/ui/bars";
import { compactNumber } from "@/lib/display";

describe("bars", () => {
  it("has no number formatter of its own: the shared one in display.ts reads the values", () => {
    expect("compactNumber" in bars).toBe(false);
    const { container } = render(<RankedBars rows={[{ key: "a", label: "Alpha", name: "Alpha", value: 1969952 }, { key: "b", label: "Beta", name: "Beta", value: 12400 }]} />);
    expect(container.textContent).toContain(compactNumber(1969952));
    expect(container.textContent).toContain("1.97M");
    expect(container.textContent).toContain("12.4K");
  });
});
