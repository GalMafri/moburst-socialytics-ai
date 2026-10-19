// One display layer (self-serve design, 19 Oct 2026, section 5): a screen
// never prints a stored value raw. Every status, platform, date, role and
// event reaches the page through src/lib/display.ts. This scans the screens'
// source, like copyWritersUseVoice.test.ts, and fails the build when one
// prints a raw report status, a raw platform key, an ISO date, a bare
// browser date, or one of the developer strings that used to reach a screen.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");

/**
 * Screens another stage of the 19 Oct build owns while it is being rebuilt
 * (the calendar, client setup and onboarding, the RivalIQ setup dialog), and
 * the UI primitives, which print what they are given. Remove an entry once
 * that stage lands, so the guard covers it too.
 */
const OWNED_ELSEWHERE = [
  "pages/ClientCalendar.tsx",
  "pages/ClientSetup.tsx",
  "pages/DevCalendarPreview.tsx",
  "components/calendar/",
  "components/onboarding/",
  "components/competitive/RivalIqSetup.tsx",
  "components/ui/",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const screens = [...files(join(SRC, "pages")), ...files(join(SRC, "components"))]
  .map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))
  .filter((f) => !OWNED_ELSEWHERE.some((owned) => f.path.startsWith(owned)));

// A JSX expression that prints a field as it is stored: `{row.status}`. Not an
// attribute (`status={row.status}`) and not inside a template (`${row.status}`).
const printed = (fields: string) => new RegExp(String.raw`(?<![=\w$])\{\s*[\w?.!]+\.(?:${fields})\s*\}`, "g");

const RULES: Array<[string, RegExp]> = [
  ["a raw report status", printed("status")],
  ["a raw platform key", printed("platform|network|network_type|channel")],
  ["an ISO date", printed("date_range_start|date_range_end|start|end|window_start|window_end|posted_at|published_at|created_at|fetched_at|as_of|audience_as_of|next_run_at|last_run_at|confirmed_at")],
  // A stored timestamp cut to its date and printed as text.
  ["an ISO date", />\s*\{[^{}<>]*\.slice\(0,\s*10\)\s*\}/g],
  // A date in whatever format the viewer's browser picks ("10/7/2026").
  ["a date in the browser's own format", /new Date\([^()]*(?:\([^()]*\))?[^()]*\)\.toLocale(?:Date|Time)?String\(\)|\.toLocale(?:Date|Time)String\(\)/g],
  ["developer text", /SPROUT_SOCIAL_ACCESS_TOKEN|No Hub token in session|DB update failed|could not parse JSON|Check workflow logs|n8n execution logs|Analysis failed on the server|Server error \$\{/g],
];

describe("screens print stored values through the display layer", () => {
  it("scans the screens it guards", () => {
    expect(screens.length).toBeGreaterThan(40);
    for (const path of ["pages/ReportView.tsx", "pages/AllReports.tsx", "pages/Usage.tsx", "components/HubCompanySync.tsx", "pages/CompetitiveReportView.tsx"]) {
      expect(screens.map((f) => f.path)).toContain(path);
    }
  });

  it("catches what it guards against, and leaves attributes and templates alone", () => {
    const caught = (text: string) => RULES.some(([, rule]) => { rule.lastIndex = 0; const hit = rule.test(text); rule.lastIndex = 0; return hit; });
    for (const bad of ["<Badge>{r.status}</Badge>", "<span>{p.platform}</span>", "<td>{r.date_range_start} to {r.date_range_end}</td>", "{new Date(r.created_at).toLocaleDateString()}", "<p>{report.created_at.slice(0, 10)}</p>", "backend secret (SPROUT_SOCIAL_ACCESS_TOKEN)"]) {
      expect(caught(bad), bad).toBe(true);
    }
    for (const fine of ["<Badge status={r.status} />", "key={`${p.network}-${i}`}", "{formatRange({ start: r.date_range_start, end: r.date_range_end })}", "{Number(n).toLocaleString()}"]) {
      expect(caught(fine), fine).toBe(false);
    }
  });

  for (const [what, rule] of RULES) {
    it(`prints no ${what}`, () => {
      const hits = screens.flatMap((f) => [...f.text.matchAll(rule)].map((m) => `${f.path}:${f.text.slice(0, m.index).split("\n").length}: ${m[0]}`));
      expect(hits).toEqual([]);
    });
  }

  it("names roles, people's states and events on the usage pages", () => {
    const usage = screens.find((f) => f.path === "pages/Usage.tsx")!.text;
    expect(usage).toContain("roleName(");
    expect(usage).toContain("usageStateName(");
    expect(usage).not.toMatch(/\{u\.(role|state)\}/);
    expect(usage).not.toMatch(/not tracked, so a user/);
    const sections = screens.find((f) => f.path === "components/usage/UsageSections.tsx")!.text;
    expect(sections).not.toMatch(/(?<![=\w$])\{r\.event\}/);
    const detail = screens.find((f) => f.path === "components/usage/UserDetail.tsx")!.text;
    expect(detail).not.toMatch(/(?<![=\w$])\{r\.(kind|detail)\}/);
  });

  it("reads statuses from the one helper, which works out held from the whole row", () => {
    for (const f of screens) {
      expect(f.text, f.path).not.toMatch(/competitiveStatusBadge|from "@\/lib\/reportNotices"/);
    }
  });
});
