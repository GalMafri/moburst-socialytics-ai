import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureTable, MetricsCard } from "@/components/usage/UsageSections";
import { NO_DATA } from "@/lib/display";

describe("the Usage tables' empty value", () => {
  it("is the app's one word, never a dash, for a row with no median", () => {
    const { container } = render(<FeatureTable rows={[{ event: "report_run", users: 2, uses: 5, failures: 0, median_ms: null }]} windowDays={90} />);
    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[—–]/);
  });

  it("is the same word for a metric with no value", () => {
    const { container } = render(<MetricsCard title="Session quality" rows={[{ metric: "median session minutes", value: null, sample: 0 }]} windowDays={90} />);
    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[—–]/);
  });
});
