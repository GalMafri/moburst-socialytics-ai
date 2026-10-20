// @vitest-environment node
// The real-versus-shadow comparison, on fixture reports shaped like the
// stored report_data: exact number differences, text side by side, and what
// only one side has.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareResults, flatten, formatComparison } from "./compare";

const fixture = (name: string) => JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", name), "utf8"));
const socialReal = fixture("social-real.json");
const socialShadow = fixture("social-shadow.json");
const competitiveReal = fixture("competitive-real.json");
const competitiveShadow = fixture("competitive-shadow.json");

const SOCIAL = { ignore: ["generated_at"], keyBy: { "sprout_performance.top_posts": "post_id" } };

describe("compareResults on a social report and its shadow", () => {
  const c = compareResults(socialReal, socialShadow, SOCIAL);

  it("lists every number that differs, exactly, with how much", () => {
    expect(c.numbers.compared).toBe(11);
    expect(c.numbers.differences).toEqual([
      { path: "metrics_summary.reactions_change", real: 0.3, shadow: 0.30000000000000004, delta: 0.30000000000000004 - 0.3 },
      { path: "sprout_performance.overall_totals.engagement_rate", real: 0.012, shadow: 0.0121, delta: 0.0121 - 0.012 },
      { path: "sprout_performance.overall_totals.engagements", real: 1440, shadow: 1452, delta: 12 },
    ]);
  });

  it("matches posts by id, whatever order each engine listed them in", () => {
    expect(c.numbers.differences.some((d) => d.path.includes("top_posts"))).toBe(false);
    expect(c.onlyReal).toEqual(expect.arrayContaining(["sprout_performance.top_posts.post_id=p-2.impressions", "sprout_performance.top_posts.post_id=p-2.text"]));
    expect(c.onlyShadow).toEqual(expect.arrayContaining(["sprout_performance.top_posts.post_id=p-4.engagements"]));
  });

  it("puts text side by side and marks which differ", () => {
    const summary = c.text.find((t) => t.path === "ai_analysis.sprout_performance_analysis.month_over_month_summary");
    expect(summary).toEqual({
      path: "ai_analysis.sprout_performance_analysis.month_over_month_summary",
      real: "Reach fell by a fifth while engagement held.", shadow: "Reach dropped about 20% and engagement stayed level.", same: false,
    });
    expect(c.text.find((t) => t.path === "client_name")).toMatchObject({ same: true });
    expect(c.text.filter((t) => !t.same).map((t) => t.path)).toEqual(["ai_analysis.sprout_performance_analysis.month_over_month_summary"]);
  });

  it("reports a number one side stored as text, and what only one side has", () => {
    expect(c.typeMismatches).toEqual([{ path: "data_counts.sprout_top_posts", real: 3, shadow: "3" }]);
    expect(c.onlyReal).toEqual(expect.arrayContaining(["gamma_url", "warnings"]));
    expect(c.onlyShadow).toEqual(expect.arrayContaining(["deck.url", "warnings.0"]));
  });

  it("leaves out ignored paths", () => {
    expect([...c.onlyReal, ...c.onlyShadow, ...c.text.map((t) => t.path)]).not.toContain("generated_at");
  });

  it("formats the comparison as plain lines", () => {
    const text = formatComparison(c);
    expect(text).toContain("Numbers: 11 compared, 3 different.");
    expect(text).toContain("sprout_performance.overall_totals.engagements: real 1440, shadow 1452 (+12)");
    expect(text).toContain("Text: ");
    expect(text).toContain("    real:   Reach fell by a fifth while engagement held.");
    expect(text).toContain("Only in the shadow: ");
  });
});

describe("compareResults on a competitive analysis and its shadow", () => {
  it("finds no difference when the companies only come in another order", () => {
    const c = compareResults(competitiveReal, competitiveShadow, { keyBy: { "aggregates.companies": "company_id" } });
    expect(c.numbers.differences).toEqual([]);
    // period.days, two totals, two figures for each of two companies, the client score.
    expect(c.numbers.compared).toBe(8);
    expect(c.text.every((t) => t.same)).toBe(true);
    expect(c.onlyReal).toEqual([]);
    expect(c.onlyShadow).toEqual([]);
    expect(c.typeMismatches).toEqual([]);
  });

  it("compares by position when no key is given, which pairs the wrong companies", () => {
    const c = compareResults(competitiveReal, competitiveShadow);
    expect(c.numbers.differences.map((d) => d.path)).toEqual([
      "aggregates.companies.0.engagement_rate_avg", "aggregates.companies.0.post_count",
      "aggregates.companies.1.engagement_rate_avg", "aggregates.companies.1.post_count",
    ]);
  });
});

describe("flatten", () => {
  it("keeps empty lists and objects, and the * pattern matches one segment", () => {
    const flat = flatten({ a: [], b: {}, c: [{ x: 1, at: "t" }], d: null }, { ignore: ["c.*.at"] });
    expect([...flat.entries()]).toEqual([["a", { empty: "[]" }], ["b", { empty: "{}" }], ["c.0.x", 1], ["d", null]]);
  });

  it("reports differing true/false and empty values", () => {
    const c = compareResults({ ok: true, list: [] }, { ok: false, list: {} });
    expect(c.otherDifferences).toEqual([
      { path: "list", real: { empty: "[]" }, shadow: { empty: "{}" } },
      { path: "ok", real: true, shadow: false },
    ]);
  });
});
