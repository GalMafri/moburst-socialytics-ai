// One display layer (self-serve design, 19 Oct 2026, section 5): a screen
// never prints a stored value raw. Every status, platform, date, role and
// event reaches the page through src/lib/display.ts. This scans the screens'
// source, like copyWritersUseVoice.test.ts, and fails the build when one
// prints a raw report status, a raw platform key, an ISO date, a bare
// browser date, or one of the developer strings that used to reach a screen.
// It also fails the build when any screen reports a failure (rule 7 below).
// What a person reads is scanned in the screens and in src/lib and src/hooks,
// which hold the sentences the screens print. The last block reads the text
// itself, parsed from the source: dashes, British spelling, Title Case labels,
// vendor names on client screens, and the failure wording the older rules
// missed.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");

/** The UI primitives, which print what they are given. Every screen, and every module that writes a screen's words, is guarded. */
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
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

const screens = [...files(join(SRC, "pages")), ...files(join(SRC, "components")), ...files(join(SRC, "lib")), ...files(join(SRC, "hooks"))]
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

// ── What a person reads ────────────────────────────────────────────────────
// The text itself, read from the parsed source (src/test/guardSource.ts): JSX
// text and the strings in code, never a comment, an import path, a console
// call or a class name. Each rule is proved both ways below: a sample it must
// catch and a sample it must leave alone. A rule that finds real text in the
// app is answered by writing the text again, never by an exception here.

import { britishSpelling } from "../../supabase/functions/_shared/reports/reportText";
import { clientReachable, isProse, readable, staffOnlyDeclarations, type Piece } from "./guardSource";

/** A piece of readable text with the file it is in and whether only staff reach it. */
type Reading = Piece & { file: string; staff: boolean };

/** Text that is a markup or style document (the PDF export's page), not words a person reads one by one. */
const isMarkup = (text: string) => /^\s*<[!a-zA-Z]/.test(text) && /<\/|\/>/.test(text);

const readableText = (text: string) => text.split("\u0000").join("{}");

/** The one place a rule may name a vendor without a staff gate: a page that is that vendor's own connection screen. */
const OWN_PAGE_OF: Record<string, string[]> = {
  // Supabase Auth's consent step for the Claude connector: it is Claude's own sign-in page.
  "pages/OAuthConsent.tsx": ["Claude"],
};

const VENDORS = /\b(?:OpenAI|Anthropic|Claude|Sonnet|Opus|Haiku|Gemini|GPT|Higgsfield|Apify|RivalIQ|Supabase|Sprout|Lovable|Vercel|Snowflake|n8n)\b/g;

/** Places, products and names that are capitalized in every sentence. */
const PROPER_PAIRS = /\b(?:Google (?:Slides|Drive|Docs|Sheets|Business Profile|Analytics)|Meta Business Suite|Business Suite|Sprout Social|Acme Corp|(?:Instagram|Facebook) (?:Reels|Stories)|United (?:States|Kingdom|Arab Emirates)|Latin America|South (?:Korea|Africa)|North Africa|Middle East|New Zealand|Saudi Arabia|Hong Kong|Costa Rica|Puerto Rico|Sri Lanka)\b/g;
const PROPER_WORDS = new Set(["Moburst", "Socialytics", "Instagram", "Facebook", "Google", "Meta", "Pinterest", "Threads", "Twitter", "Sprout", "Claude", "Higgsfield", "Apify", "Supabase", "Hub", "Slack", "Canva", "Figma"]);

/** Two capitalized words in a row where sentence case has one: "Save And Apply", "Brand Book". */
function titleCase(text: string): string | null {
  const t = readableText(text).replace(PROPER_PAIRS, " ");
  for (const m of t.matchAll(/(?<![\p{L}\p{N}'])\p{Lu}\p{Ll}+ (\p{Lu}\p{Ll}+)(?![\p{L}\p{N}'])/gu)) {
    if (!PROPER_WORDS.has(m[1])) return m[0];
  }
  return null;
}

/** The failure wording the older rules missed. A true state ("Not saved yet.", "This send did not go through.") is not a failure report. */
const FAILURE_WORDS = /\bcould(?: not|n't|n’t)\b|\bunable to\b|\bwent wrong\b|\bfail(?:ed|s|ure|ing)?\b/i;

/** How the product plans and writes posts inside. A client is told what the post is, not when or how it is made. */
const HOW_IT_WORKS = /planned on the Monday before|written the Monday before|written shortly before its date/i;

const TEXT_RULES: Array<{ what: string; find: (text: string) => string | null }> = [
  { what: "a dash used as punctuation", find: (t) => /[–—]|\S - \S/.exec(readableText(t))?.[0] ?? null },
  // Text the product writes is American English. reportText.ts is the one word list; "cancelled" and "grey" are accepted there as model output, and not on a screen.
  { what: "a British spelling", find: (t) => britishSpelling(readableText(t)) ?? /\bcancell(?:ed|ing|ation)\b|\bgrey\b/i.exec(t)?.[0] ?? null },
  { what: "Title Case where the app writes sentence case", find: titleCase },
  { what: "failure wording", find: (t) => FAILURE_WORDS.exec(readableText(t))?.[0] ?? null },
  { what: "an explanation of when posts are written", find: (t) => HOW_IT_WORKS.exec(readableText(t))?.[0] ?? null },
];

/** Where a vendor's name is for the team and not for a client: the text sits behind a staff gate, in a staff-only file, or in a declaration only staff-gated code uses. */
function vendorHits(r: Reading): string[] {
  if (r.staff || isMarkup(r.text)) return [];
  const allowed = OWN_PAGE_OF[r.file] ?? [];
  return [...readableText(r.text).matchAll(VENDORS)].map((m) => m[0]).filter((name) => !allowed.includes(name));
}

const GUARDED = /^(?:pages|components|lib|hooks)\//;
function readings(): Reading[] {
  const reach = clientReachable();
  const staffDecls = staffOnlyDeclarations(reach);
  return screens
    .filter((f) => GUARDED.test(f.path))
    .flatMap((f) => readable(f.path, f.text).filter(isProse).map((p) => ({ ...p, file: f.path, staff: !reach.has(f.path) || p.staffGated || (!!p.decl && staffDecls.has(`${f.path}#${p.decl}`)) })));
}

/** The readable text of a source sample, as the guard reads the app. */
const readSample = (source: string, path = "components/Sample.tsx") => readable(path, source).filter(isProse);
const caughtIn = (source: string, rule: (typeof TEXT_RULES)[number]) => readSample(source).some((p) => !isMarkup(p.text) && rule.find(p.text));

describe("what a person reads", () => {
  const all = readings();

  it("reads the screens and the modules that write their words", () => {
    expect(all.length).toBeGreaterThan(1000);
    for (const dir of ["pages/", "components/", "lib/", "hooks/"]) expect(all.some((r) => r.file.startsWith(dir)), dir).toBe(true);
    expect(all.some((r) => r.file.startsWith("components/ui/"))).toBe(false);
  });

  it("leaves out comments, imports, console calls, class names and keys", () => {
    const sample = [
      'import { x } from "@/lib/a — b";',
      '// a comment with a dash — and Could Not words that failed',
      "const A = () => {",
      '  console.warn("could not load — failed", 1);',
      '  return <p className="text-grey-500 bg-red-500" key="Save And Apply" data-note="it failed">Saved</p>;',
      "};",
    ].join("\n");
    expect(readSample(sample).map((p) => p.text)).toEqual(["Saved"]);
  });

  describe("dashes, spelling, capitals and failure wording", () => {
    const SAMPLES: Record<string, { caught: string[]; fine: string[] }> = {
      "a dash used as punctuation": {
        caught: ["<p>Saved — done</p>", '<p>{"Oct 12–18"}</p>', 'const a = "Posts - this week";', "const a = `${n} posts – ${m}`;"],
        fine: ["<p>Oct 12 to 18</p>", '<p title="data-driven">Sent 2019-2024</p>', "<p>Not saved yet.</p>", "// a dash — in a comment"],
      },
      "a British spelling": {
        caught: ["<p>Cancelled</p>", '<Button label="Pick a colour" />', "<p>A grey card</p>", "<p>Organise your week</p>", "const a = `Behaviour on ${d}`;"],
        fine: ["<p>Canceled</p>", '<Button label="Pick a color" />', "<p>A gray card</p>", "<p>Organize your week</p>", '<p>The "colour" brand word, quoted</p>'],
      },
      "Title Case where the app writes sentence case": {
        caught: ["<Button>Save And Apply</Button>", '<Label>Brand Book or style guide</Label>', '<StatCard label="Video Views" />', 'const t = "Open Settings";'],
        fine: ["<Button>Save and apply</Button>", "<Label>Brand book or style guide</Label>", "<p>Open Google Slides</p>", "<p>Sent to Instagram Stories. Open Slack.</p>", "<p>Open Socialytics from the Moburst portal.</p>", "<p>Matched to the United States</p>"],
      },
      "failure wording": {
        caught: ["<p>Upload failed</p>", '<p>We could not sign you in</p>', 'const m = "Something went wrong";', "<p>Unable to load</p>", "<p>We couldn't confirm the key</p>"],
        fine: ["<p>Not saved yet.</p>", "<p>Not sent to Sprout yet.</p>", "<p>This send did not go through.</p>", 'const status = "failed";', 'console.error("Could not load", e);'],
      },
      "an explanation of when posts are written": {
        caught: ["<p>Posts are planned on the Monday before their week.</p>", "<p>This post is written the Monday before it goes out.</p>", "<p>This post is written shortly before its date.</p>", 'const a = "Written Shortly Before Its Date";'],
        fine: ["<p>This post has no copy yet. Its design can be made once it does.</p>", "<p>No posts planned for this week.</p>", "<p>Scheduled for the Monday after the report.</p>"],
      },
    };
    for (const rule of TEXT_RULES) {
      it(`catches and leaves alone: ${rule.what}`, () => {
        for (const bad of SAMPLES[rule.what].caught) expect(caughtIn(bad, rule), bad).toBe(true);
        for (const fine of SAMPLES[rule.what].fine) expect(caughtIn(fine, rule), fine).toBe(false);
      });
      it(`the screens and their modules show no ${rule.what}`, () => {
        const hits = all.filter((r) => !isMarkup(r.text)).flatMap((r) => { const h = rule.find(r.text); return h ? [`${r.file}:${r.line}: ${h}`] : []; });
        expect(hits).toEqual([]);
      });
    }
  });

  describe("vendor and model names", () => {
    it("know which text only staff reach", () => {
      const gated = (source: string) => readSample(source).map((p) => p.staffGated);
      expect(gated("const A = () => <>{isMoburstStaff && <p>Send to Sprout</p>}</>;")).toEqual([true]);
      expect(gated("const A = () => <>{isClient ? <p>Sent for scheduling</p> : <p>Sent to Sprout</p>}</>;")).toEqual([false, true]);
      expect(gated("const A = () => <>{!isClient && <p>Sprout profile</p>}</>;")).toEqual([true]);
      expect(gated("const A = () => <StaffOnlyRoute><p>RivalIQ tracking</p></StaffOnlyRoute>;")).toEqual([true]);
      expect(gated("const f = (isStaff: boolean) => (isStaff ? 'Draft in Sprout' : 'Sent for scheduling');")).toEqual([true, false]);
      expect(gated("const vendor = (a: string, b: string) => (isMoburstStaff ? a : b);\nconst x = vendor('RivalIQ had', 'The source had');")).toEqual([true, false]);
      expect(gated("const A = () => <p>Send to Sprout</p>;")).toEqual([false]);
      expect(gated("const A = () => <>{isClient && <p>Sprout</p>}</>;")).toEqual([false]);
    });

    it("work out from the routes and the gates which files a client can reach", () => {
      const reach = clientReachable();
      for (const f of ["pages/ReportView.tsx", "pages/Analytics.tsx", "pages/CompetitiveReportView.tsx", "pages/OAuthConsent.tsx", "components/reports/calendar/PostPanel.tsx"]) expect(reach.has(f), f).toBe(true);
      for (const f of ["pages/ClientSetup.tsx", "pages/Settings.tsx", "pages/CompetitorReview.tsx", "pages/CompetitiveRun.tsx", "pages/ApiKeys.tsx", "pages/Usage.tsx", "components/settings/HiggsfieldConnection.tsx", "components/onboarding/ClaudeProject.tsx"]) expect(reach.has(f), f).toBe(false);
    });

    it("name a vendor on no screen a client can reach", () => {
      const sample = (file: string, text: string, staff = false) => vendorHits({ ...readSample(text)[0], file, staff });
      expect(sample("components/Sample.tsx", "<p>Send to Sprout</p>")).toEqual(["Sprout"]);
      expect(sample("components/Sample.tsx", "<p>Written by Claude</p>")).toEqual(["Claude"]);
      expect(sample("components/Sample.tsx", "<p>RivalIQ and Higgsfield</p>")).toEqual(["RivalIQ", "Higgsfield"]);
      expect(sample("components/Sample.tsx", "<p>Send to Sprout</p>", true)).toEqual([]);
      expect(sample("components/Sample.tsx", "<p>Sent for scheduling</p>")).toEqual([]);
      expect(sample("pages/OAuthConsent.tsx", "<p>Connect Claude</p>")).toEqual([]);
      expect(sample("pages/OAuthConsent.tsx", "<p>Powered by Sprout</p>")).toEqual(["Sprout"]);
      expect(sample("components/Sample.tsx", "<style>.a { color: red; }</style><p>Sprout</p><div>Sprout</div>")).toEqual([]);
    });

    it("are named on no screen a client can reach", () => {
      const hits = all.flatMap((r) => vendorHits(r).map((name) => `${r.file}:${r.line}: ${name}`));
      expect(hits).toEqual([]);
    });
  });
});
