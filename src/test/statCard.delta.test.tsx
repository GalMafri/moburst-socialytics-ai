// One delta for every report figure: a change on a tiny base reads "from 1 to 19", never "+1800%".
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard, describeChange } from "@/components/ui/stat-card";

describe("describeChange", () => {
  it("shows the two values when the previous value is under the floor", () => {
    expect(describeChange({ previous: 1, current: 19, percent: 1800 })).toMatchObject({ text: "from 1 to 19", direction: "up" });
    expect(describeChange({ previous: 3, current: 0, percent: -100 })).toMatchObject({ text: "from 3 to 0", direction: "down" });
  });
  it("shows the two values when the change is above the cap", () => {
    expect(describeChange({ previous: 40, current: 1000, percent: 2400 })?.text).toBe("from 40 to 1,000");
  });
  it("says New when there was nothing before and something now, and nothing when both are zero", () => {
    expect(describeChange({ previous: 0, current: 8, percent: null })).toMatchObject({ text: "New", direction: "up" });
    expect(describeChange({ previous: 0, current: 0, percent: null })).toBeNull();
  });
  it("keeps a percent on a base that is large enough", () => {
    expect(describeChange({ previous: 1000, current: 1250, percent: 25 })).toMatchObject({ text: "+25%", direction: "up" });
    expect(describeChange({ previous: 200, current: 150, percent: -25 })).toMatchObject({ text: "-25%", direction: "down" });
  });
  it("falls back to the percent alone when the values are not known", () => {
    expect(describeChange({ percent: 12 })?.text).toBe("+12%");
    expect(describeChange({})).toBeNull();
  });
});

describe("StatCard delta", () => {
  it("renders 'from 1 to 19', not '+1800%'", () => {
    render(<StatCard label="Shares" value="19" delta={{ percent: 1800, from: 1, to: 19 }} />);
    expect(screen.getByText(/from 1 to 19/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/1800/);
  });
  it("still renders a plain percent for callers that pass only a percent", () => {
    render(<StatCard label="Reach" value="5" delta={{ percent: 12.5 }} />);
    expect(screen.getByText(/\+12\.5%/)).toBeInTheDocument();
  });
  // The change colors come from the palette tokens, never a hex written in the component.
  it.each([
    ["up", { percent: 25, from: 1000, to: 1250 }, "text-success"],
    ["down", { percent: -25, from: 200, to: 150 }, "text-destructive"],
    ["flat", { percent: 0, from: 200, to: 200 }, "text-muted-foreground"],
  ])("colors a %s change with a palette token", (_dir, delta, token) => {
    const { container } = render(<StatCard label="Reach" value="5" delta={delta} />);
    const colored = container.querySelector(`.${token}`);
    expect(colored).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/text-\[#/);
  });
});
