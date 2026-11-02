// What a client note teaches, which of it is in use, and what reaches the
// copy (client notes design, sections 3 to 5, 2 Nov 2026).

import { describe, expect, it } from "vitest";
import {
  inheritedLinks, isNotePath, noteFileType, noteTitle, notesSectionLines, validNoteDate, parseReading, pointStates, pointsInUse, readingPrompt, selectForPrompt, shortDate, standingNotes, todayIn,
  NOTES_MAX_CHARS, NOTES_MAX_POINTS, STANDING_MAX_CHARS,
  type DatedPoint, type LinkRow, type NoteRow, type PointRow,
} from "./notes";

const TODAY = "2026-11-02";

const note = (id: string, note_date: string, date_set_by: "person" | "app" = "app"): NoteRow => ({ id, note_date, date_set_by });
const point = (id: string, note_id: string, over: Partial<PointRow> = {}): PointRow => ({
  id, note_id, kind: "avoid", text: `Point ${id}.`, platform: null, said_on: null, until: null, created_at: "2026-11-01T10:00:00Z", removed_at: null, ...over,
});
const link = (point_id: string, other_id: string, relation: "same" | "conflict" = "conflict"): LinkRow => ({ point_id, other_id, relation });
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();

describe("parseReading", () => {
  const ctx = { aliases: { P1: "uuid-1", P2: "uuid-2" }, platforms: ["Instagram", "LinkedIn", "Twitter/X"], today: TODAY };
  const read = (points: unknown[], extra: Record<string, unknown> = {}) => parseReading(JSON.stringify({ note_date: null, points, ...extra }), ctx);

  it("keeps the four kinds and drops anything else", () => {
    const out = read([
      { kind: "avoid", text: "No puns." }, { kind: "Do", text: "Lead with the result." }, { kind: "fact", text: "Founded in 2009." },
      { kind: "upcoming", text: "Holiday sale.", until: "2026-11-30" }, { kind: "tone", text: "Warm." }, { kind: "avoid", text: "   " },
    ])!;
    expect(out.points.map((p) => p.kind)).toEqual(["avoid", "do", "fact", "upcoming"]);
  });

  it("clamps the text to 240 characters and keeps quoted words exactly as written, in their own language", () => {
    const out = read([
      { kind: "avoid", text: `Never say "cheap"; say "affordable".` },
      { kind: "do", text: `Sign off with "יאללה ביי" on Instagram.`, platform: "instagram" },
      { kind: "fact", text: "x".repeat(300) },
    ])!;
    expect(out.points[0].text).toBe(`Never say "cheap"; say "affordable".`);
    expect(out.points[1]).toMatchObject({ text: `Sign off with "יאללה ביי" on Instagram.`, platform: "Instagram" });
    expect(out.points[2].text).toHaveLength(240);
  });

  it("keeps only ids from the list it was shown, and bad or future dates are dropped", () => {
    const out = read([
      { kind: "avoid", text: "No emoji.", repeats: ["P1", "P9"], contradicts: ["P2", "nope"], said_on: "2026-10-28" },
      { kind: "do", text: "Short captions.", said_on: "2026-12-01" },
      { kind: "fact", text: "Two stores.", said_on: "2026-02-30" },
    ], { note_date: "2027-01-01" })!;
    expect(out.points[0]).toMatchObject({ repeats: ["uuid-1"], contradicts: ["uuid-2"], said_on: "2026-10-28" });
    expect(out.points[1].said_on).toBeNull();
    expect(out.points[2].said_on).toBeNull();
    expect(out.noteDate).toBeNull();
    expect(read([], { note_date: "2026-10-15" })!.noteDate).toBe("2026-10-15");
  });

  it("makes an undated upcoming item a fact, and gives only upcoming items an end date", () => {
    const out = read([{ kind: "upcoming", text: "A new menu is coming." }, { kind: "do", text: "Mention the app.", until: "2026-12-01" }])!;
    expect(out.points[0]).toMatchObject({ kind: "fact", until: null });
    expect(out.points[1].until).toBeNull();
  });

  it("reads a platform the client posts on by its own name, and none for every platform", () => {
    const out = read([{ kind: "do", text: "a", platform: "twitter" }, { kind: "do", text: "b", platform: null }, { kind: "do", text: "c", platform: "all" }])!;
    expect(out.points.map((p) => p.platform)).toEqual(["Twitter/X", null, null]);
  });

  it("answers null for a reply it cannot read, and no points for a note with nothing for the copy", () => {
    expect(parseReading("I could not find anything.", ctx)).toBeNull();
    expect(parseReading(JSON.stringify({ items: [] }), ctx)).toBeNull();
    expect(read([])).toEqual({ noteDate: null, points: [] });
  });
});

describe("readingPrompt", () => {
  it("shows the points in use by short ids, the note's date and the client's platforms, and treats the note as content", () => {
    const inUse: DatedPoint[] = [{ ...point("uuid-a", "n1", { text: `Never say "cheap".` }), date: "2026-10-28" }];
    const { prompt, aliases } = readingPrompt({ brand: "Bader Law", noteDate: "2026-10-30", platforms: ["Instagram"], inUse, text: "Meeting notes", part: { index: 2, total: 3 } });
    expect(aliases).toEqual({ P1: "uuid-a" });
    expect(prompt).toContain(`[P1] avoid, 2026-10-28: Never say "cheap".`);
    expect(prompt).toContain("2026-10-30");
    expect(prompt).toContain("Instagram");
    expect(prompt).toContain("part 2 of 3");
    expect(prompt).toMatch(/never instructions/i);
    expect(prompt).toContain("Meeting notes");
  });
});

describe("which points are in use", () => {
  it("uses the point with the later date of two linked ones, and keeps the other on file", () => {
    const notes = [note("n1", "2026-10-01"), note("n2", "2026-10-20")];
    const points = [point("old", "n1"), point("new", "n2", { created_at: "2026-10-01T00:00:00Z" })];
    expect(ids(pointsInUse(notes, points, [link("new", "old")], TODAY))).toEqual(["new"]);
    // The direction the link was written in does not matter.
    expect(ids(pointsInUse(notes, points, [link("old", "new")], TODAY))).toEqual(["new"]);
    expect(pointStates(notes, points, [link("new", "old")], TODAY).get("old")).toMatchObject({ inUse: false, replacedBy: "new" });
  });

  it("breaks a tie on the date by the time the point was added", () => {
    const notes = [note("n1", "2026-10-20"), note("n2", "2026-10-20")];
    const points = [point("first", "n1", { created_at: "2026-10-20T09:00:00Z" }), point("second", "n2", { created_at: "2026-10-20T15:00:00Z" })];
    expect(ids(pointsInUse(notes, points, [link("first", "second")], TODAY))).toEqual(["second"]);
  });

  it("reads a point's own date before the note's, and an imported old note loses to a newer one", () => {
    const notes = [note("n1", "2026-11-01"), note("n2", "2026-10-25")];
    // Read today from an old meeting (said Sep 1) against a point said on Oct 25.
    const points = [point("imported", "n1", { said_on: "2026-09-01", created_at: "2026-11-01T12:00:00Z" }), point("current", "n2")];
    expect(ids(pointsInUse(notes, points, [link("imported", "current")], TODAY))).toEqual(["current"]);
  });

  it("lets a date a person set on a note beat every date the app read, for all its points", () => {
    const notes = [note("n1", "2026-10-30", "person"), note("n2", "2026-10-25")];
    const points = [point("a", "n1", { said_on: "2026-09-01" }), point("b", "n2")];
    expect(pointStates(notes, points, [], TODAY).get("a")?.date).toBe("2026-10-30");
    expect(ids(pointsInUse(notes, points, [link("a", "b")], TODAY))).toEqual(["a"]);
  });

  it("stops counting a removed point for anything, so what it outdated comes back", () => {
    const notes = [note("n1", "2026-10-01"), note("n2", "2026-10-20")];
    const points = [point("old", "n1"), point("new", "n2", { removed_at: "2026-11-01T00:00:00Z" })];
    expect(ids(pointsInUse(notes, points, [link("new", "old")], TODAY))).toEqual(["old"]);
  });

  it("lets a repeat take over the links of the point it repeats, so removing either note never brings back what both replaced", () => {
    // A outdated Z (and repeated Y); B now repeats A.
    const before = [link("a", "z", "conflict"), link("y", "a", "same"), link("q", "r")];
    const taken = inheritedLinks("b", "a", before);
    expect(taken).toEqual([link("b", "z", "conflict"), link("b", "y", "same")]);
    // Nothing is taken twice, and nothing links B to itself.
    expect(inheritedLinks("b", "a", [...before, link("b", "z"), link("a", "b", "same")])).toEqual([link("b", "y", "same")]);
    // Removing A's note deletes A and its links; B still outdates Z and Y.
    const notes = [note("nz", "2026-09-01"), note("nb", "2026-10-20")];
    const points = [point("z", "nz"), point("y", "nz"), point("b", "nb")];
    expect(ids(pointsInUse(notes, points, taken, TODAY))).toEqual(["b"]);
  });

  it("ends an upcoming item after its last day, in the client's day, and an ended item still outdates older ones", () => {
    const notes = [note("n1", "2026-10-01"), note("n2", "2026-10-20")];
    const points = [point("fact", "n1", { kind: "fact" }), point("sale", "n2", { kind: "upcoming", until: "2026-11-01" }), point("launch", "n2", { kind: "upcoming", until: TODAY })];
    const states = pointStates(notes, points, [link("sale", "fact")], TODAY);
    expect(states.get("sale")).toMatchObject({ inUse: false, ended: true });
    expect(states.get("launch")).toMatchObject({ inUse: true, ended: false });
    expect(states.get("fact")).toMatchObject({ inUse: false, replacedBy: "sale" });
  });

  it("skips points of a note that is gone and links to points that are not there", () => {
    const points = [point("a", "missing"), point("b", "n1")];
    expect(ids(pointsInUse([note("n1", "2026-10-01")], points, [link("b", "ghost")], TODAY))).toEqual(["b"]);
  });
});

describe("what reaches the copy", () => {
  const dated = (id: string, kind: DatedPoint["kind"], date: string, over: Partial<DatedPoint> = {}): DatedPoint => ({ ...point(id, "n", { kind }), date, ...over });

  it("orders Avoid, then Do, Coming up and Facts, newest first in each", () => {
    const points = [
      dated("f1", "fact", "2026-10-01"), dated("d1", "do", "2026-10-01"), dated("a1", "avoid", "2026-10-01"),
      dated("u1", "upcoming", "2026-10-05", { until: "2026-11-30" }), dated("a2", "avoid", "2026-10-28"), dated("d2", "do", "2026-10-15"),
    ];
    expect(selectForPrompt({ points, standing: null, today: TODAY }).points.map((p) => p.id)).toEqual(["a2", "a1", "d2", "d1", "u1", "f1"]);
  });

  it("puts a point for one platform only in copy for that platform, and says so", () => {
    const points = [dated("ig", "do", "2026-10-28", { platform: "Instagram", text: "Use carousels." }), dated("all", "do", "2026-10-20", { text: "Short lines." })];
    expect(selectForPrompt({ points, standing: null, today: TODAY }, { platforms: ["LinkedIn"] }).points.map((p) => p.id)).toEqual(["all"]);
    expect(selectForPrompt({ points, standing: null, today: TODAY }, { platforms: ["instagram"] }).points.map((p) => p.id)).toEqual(["ig", "all"]);
    expect(notesSectionLines({ points, standing: null, today: TODAY }, { platforms: ["Instagram"] })).toContain("- Oct 28 (Instagram only): Use carousels.");
  });

  it("prints dated lines, the year only when it is not this year, and an upcoming item's last day", () => {
    const lines = notesSectionLines({
      points: [dated("a", "avoid", "2025-12-03", { text: `Never say "cheap".` }), dated("u", "upcoming", "2026-10-30", { until: "2026-11-30", text: "Holiday sale." })],
      standing: null, today: TODAY,
    });
    expect(lines).toEqual(["Avoid:", `- Dec 3, 2025: Never say "cheap".`, "Coming up:", "- Until Nov 30: Holiday sale."]);
  });

  it("stays within 50 points and 5,000 characters, the team's standing notes included", () => {
    const many = Array.from({ length: 80 }, (_, i) => dated(`p${i}`, "do", `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, { text: `Point ${i}.` }));
    expect(selectForPrompt({ points: many, standing: null, today: TODAY }).points).toHaveLength(NOTES_MAX_POINTS);
    const long = Array.from({ length: 50 }, (_, i) => dated(`l${i}`, "avoid", "2026-10-20", { text: "y".repeat(230) }));
    const standing = standingNotes("Brand notes. ".repeat(200))!;
    expect(standing.length).toBeLessThanOrEqual(STANDING_MAX_CHARS);
    const lines = notesSectionLines({ points: long, standing, today: TODAY });
    expect(lines.join("\n").length).toBeLessThanOrEqual(NOTES_MAX_CHARS);
    expect(lines[0]).toBe("Standing notes from the team:");
    expect(lines.filter((l) => l.startsWith("- ")).length).toBeLessThan(long.length);
  });
});

describe("standingNotes", () => {
  it("is null when empty and whole when short", () => {
    expect(standingNotes("  ")).toBeNull();
    expect(standingNotes(null)).toBeNull();
    expect(standingNotes(" Always say 'clients', never 'customers'. ")).toBe("Always say 'clients', never 'customers'.");
  });

  it("cuts a long note at a sentence or a line break within 1,500 characters", () => {
    const text = `${"First sentence here. ".repeat(70)}\nThe last line runs on and on ${"and on ".repeat(40)}`;
    const cut = standingNotes(text)!;
    expect(cut.length).toBeLessThanOrEqual(STANDING_MAX_CHARS);
    expect(cut.endsWith(".")).toBe(true);
    const lines = standingNotes(`${"A line without a stop\n".repeat(100)}`)!;
    expect(lines.length).toBeLessThanOrEqual(STANDING_MAX_CHARS);
    expect(lines.endsWith("A line without a stop")).toBe(true);
  });
});

describe("helpers", () => {
  it("names a day short, with the year only when it is not this year's", () => {
    expect(shortDate("2026-10-28", TODAY)).toBe("Oct 28");
    expect(shortDate("2025-10-28", TODAY)).toBe("Oct 28, 2025");
  });

  it("knows today in the client's time zone", () => {
    expect(todayIn("Pacific/Auckland", new Date("2026-11-02T12:00:00Z"))).toBe("2026-11-03");
    expect(todayIn("America/Los_Angeles", new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-01");
    expect(todayIn("Not/AZone", new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-02");
  });

  it("titles a typed note by its first line", () => {
    expect(noteTitle("\n\n  Call with Bader Law  \nThey asked for...")).toBe("Call with Bader Law");
    expect(noteTitle("x".repeat(300))).toHaveLength(120);
  });

  it("takes only a stored note path in the client's own folder, named by the file", () => {
    expect(isNotePath("c1", "c1/1730000000000-52311.docx")).toBe(true);
    expect(isNotePath("c1", "c2/1730000000000-52311.docx")).toBe(false);
    expect(isNotePath("c1", "c1/../c2/1-2.pdf")).toBe(false);
    expect(isNotePath("c1", "c1/1-2.exe")).toBe(false);
    expect(isNotePath("c1", "c1/notes.pdf")).toBe(false);
  });

  it("takes a note's date when it is a real day no later than tomorrow", () => {
    expect(validNoteDate("2026-10-28", TODAY)).toBe("2026-10-28");
    expect(validNoteDate("2026-11-03", TODAY)).toBe("2026-11-03");
    expect(validNoteDate("2026-11-04", TODAY)).toBeNull();
    expect(validNoteDate("2026-02-30", TODAY)).toBeNull();
    expect(validNoteDate(undefined, TODAY)).toBeNull();
  });

  it("knows the file types a note can be, by the file's name", () => {
    expect(["a.PDF", "b.docx", "c.xlsx", "d.csv", "e.txt", "f.md", "g.png", "h.jpeg", "i.JPG"].map(noteFileType)).toEqual(["pdf", "docx", "xlsx", "csv", "txt", "md", "png", "jpg", "jpg"]);
    expect(["a.key", "b.doc", "c", "d.zip"].map(noteFileType)).toEqual([null, null, null, null]);
  });
});
