// One display layer (self-serve design, 19 Oct 2026, section 5): a screen
// never prints a stored value raw. Every status, platform, date, role and
// event reaches the page through src/lib/display.ts. This scans the screens'
// source, like copyWritersUseVoice.test.ts, and fails the build when one
// prints a raw report status, a raw platform key, an ISO date, a bare
// browser date, or one of the developer strings that used to reach a screen.
// It also fails the build when any screen reports a failure (rule 7 below).

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");

/** The UI primitives, which print what they are given. Every screen is guarded. */
const OWNED_ELSEWHERE = [
  "components/ui/",
];

/**
 * Nothing fails visibly, on any screen (self-serve design, rule 7, 19 Oct
 * 2026: "i don't want you building anything that will fail and flag the user
 * it failed"). A person's own request that does not get through is sent
 * again quietly (src/lib/quietSend.ts) and the screen shows the true state;
 * a read that did not answer keeps loading and tries again (LoadRetry). No
 * screen reports a failure with an error toast, a destructive toast, an
 * alert, or failure copy in anything a person reads. Comments and console
 * calls are for the team and are not scanned.
 */
const FAILURE_RULES: Array<[string, RegExp]> = [
  ["an error toast", /\b(?:sonnerToast|toast)\.(?:error|warning)\(/g],
  // The toast's object may hold one level of braces (a template's ${...}).
  ["a destructive toast", /toast\(\{(?:[^{}]|\{[^{}]*\})*variant:\s*["']destructive["']/g],
  ["an alert", /role=["']alert["']/g],
  ["failure copy", /did not load|Could not load|Try again|Refresh the page|Not available/g],
];

/**
 * The source with its comments and console calls blanked out, kept the same
 * length and lines so a hit still points at its line. What is left is code,
 * JSX text and string literals: what can reach a person.
 */
function shown(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  const out = text
    // Block and JSX comments. Not a glob such as accept="image/*".
    .replace(/(?<![\w"'`/*])\/\*[\s\S]*?\*\//g, blank)
    // Line comments. Not the "//" of a URL (after a colon) or of a quoted "//".
    .replace(/(^|[^:"'`\w/])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
  // console.x( ... ) up to its matching parenthesis, stepping over quoted text.
  const chars = out.split("");
  for (const m of out.matchAll(/\bconsole\.\w+\(/g)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    let quote: string | null = null;
    for (; i < out.length && depth > 0; i++) {
      const c = out[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(") depth++;
      else if (c === ")") depth--;
    }
    for (let j = m.index!; j < i; j++) if (chars[j] !== "\n") chars[j] = " ";
  }
  return chars.join("");
}

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
  // Work the product does on its own is never handed to a person (rules 2 and 3).
  ["a setup instruction", /Connect RivalIQ tracking|Connect tracking|Needs tracking|needs tracking:|Remember to hit Save|Confirm design settings|No profile connected for|Set up RivalIQ tracking|Failed to save edit/g],
];

describe("screens print stored values through the display layer", () => {
  it("scans the screens it guards", () => {
    expect(screens.length).toBeGreaterThan(40);
    for (const path of ["pages/ReportView.tsx", "pages/AllReports.tsx", "pages/Usage.tsx", "components/HubCompanySync.tsx", "pages/CompetitiveReportView.tsx", "pages/ClientSetup.tsx", "components/onboarding/DesignSettingsCard.tsx"]) {
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

  describe("nothing fails visibly on any screen", () => {
    const guarded = screens.map((f) => ({ path: f.path, text: shown(f.text) }));
    it("catches what it guards against, and leaves comments and console calls alone", () => {
      const caught = (text: string) => FAILURE_RULES.some(([, rule]) => { rule.lastIndex = 0; const hit = rule.test(shown(text)); rule.lastIndex = 0; return hit; });
      for (const bad of [
        'toast.error("Upload failed")',
        'sonnerToast.error(`Failed to save`)',
        'toast({ title: "Import failed", description: e.message, variant: "destructive" })',
        'toast({ title: `Not saved: ${name}`, variant: "destructive" })',
        '<p role="alert">x</p>',
        '<p>The report did not load.</p>',
        'description: "Nothing changed. Try again in a minute."',
        '<EmptyState title="Could not load the feed" />',
        '"Refresh the page to see its latest status."',
        '<Badge>Not available</Badge>',
        // Neither a URL nor a file glob hides what follows it.
        '<a href="https://example.test/a">Open</a><p>Try again</p>',
        '<input accept="image/*" />\n<p>Try again</p>\n{/* a note */}',
      ]) expect(caught(bad), bad).toBe(true);
      for (const fine of [
        'toast.success("Saved")',
        '<p role="status">Not saved yet.</p>',
        '<Button variant="destructive">',
        'console.warn("[feed] did not load", e)',
        'console.error(`Could not load ${what}`, (e as Error).message, { why: "Try again" })',
        '// Try again quietly; the screen never says it failed',
        '{/* Refresh the page is never asked of anyone */}',
        '/* Could not load: LoadRetry keeps loading */',
      ]) expect(caught(fine), fine).toBe(false);
    });
    it("blanks comments and console calls without moving a line", () => {
      const text = 'a // Try again\nconsole.warn("x\n(y")\n<p>z</p>';
      expect(shown(text).split("\n").length).toBe(text.split("\n").length);
      expect(shown(text).length).toBe(text.length);
      expect(shown(text)).toContain("<p>z</p>");
    });
    for (const [what, rule] of FAILURE_RULES) {
      it(`shows no ${what}`, () => {
        const hits = guarded.flatMap((f) => [...f.text.matchAll(rule)].map((m) => `${f.path}:${f.text.slice(0, m.index).split("\n").length}: ${m[0]}`));
        expect(hits).toEqual([]);
      });
    }
  });

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
