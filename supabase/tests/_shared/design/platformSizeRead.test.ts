// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../../paths.ts";
import {
  EXTRACT_TOOL, MIN_GUIDE_CHARS,
  cheatSizes, decide, extractPrompt, guideParts, guideText, guideUpdated, jsonIn, listedSizes, modelWord, parseExtract, refusedRow, sizesIn,
  type Key, type ReadSize, type SizeRow,
} from "../../../functions/_shared/design/platformSizeRead";

// Reading the sizes guide: its text, its parts, what counts as written on
// the page, and what a row's read changes. The page is a stand-in with the
// guide's structure and its sizes of 17 Nov 2026.

const html = readFileSync(join(functionsDir, "..", "fixtures", "platform-sizes", "guide.html"), "utf8");
const text = guideText(html);
const parts = guideParts(text);

const row = (platform: string, format: SizeRow["format"], width: number, height: number, pending: [number, number] | null = null): SizeRow =>
  ({ platform, format, width, height, pending_width: pending?.[0] ?? null, pending_height: pending?.[1] ?? null });
const cheat = (width: number, height: number): ReadSize => ({ width, height, part: "cheat_sheet" });
const section = (width: number, height: number): ReadSize => ({ width, height, part: "section" });
const KEYS: Key[] = [
  { platform: "facebook", format: "image" }, { platform: "facebook", format: "story" },
  { platform: "instagram", format: "carousel" }, { platform: "instagram", format: "image" }, { platform: "instagram", format: "story" },
  { platform: "linkedin", format: "image" }, { platform: "x", format: "image" },
];

describe("the guide as text", () => {
  it("reads the article only: no script, style, comment, menu or footer", () => {
    expect(text.length).toBeGreaterThan(MIN_GUIDE_CHARS);
    expect(text).not.toContain("1234x5678");
    expect(text).not.toContain("9999");
    expect(text).not.toContain("1111");
    expect(text).not.toContain("stand-in");
    expect(text).not.toContain("dateModified");
  });

  it("marks headings, puts a table row on one line and a list item on its own", () => {
    const lines = text.split("\n");
    expect(lines).toContain("## Social media image sizes cheat sheet");
    expect(lines).toContain("### Instagram Stories image sizes");
    expect(lines).toContain("Platform | Profile image | Cover image | Primary post image");
    expect(lines).toContain("Instagram | 110×110 px | N/A | 1080×1080 px or 1080×1350 px");
    expect(lines).toContain("X (formerly known as Twitter) | 400×400 px | 1500×500 px | 1600×900 px");
    expect(lines).toContain("- Square images: 1080×1080 pixels (1:1 aspect ratio)");
    expect(lines).toContain("- Recommended size for landscape images: 1200×628 pixels (1.9:1 aspect ratio)");
  });

  it("reads the page's own modified date", () => {
    expect(guideUpdated(html)).toBe("2026-11-02");
    expect(guideUpdated("<html></html>")).toBeNull();
  });

  it("reads the whole page when there is no article", () => {
    expect(guideText("<body><h2>Sizes</h2><p>1080&times;1350&nbsp;px &amp; more</p></body>")).toBe("## Sizes\n1080×1350 px & more");
  });
});

describe("the sizes written in a text", () => {
  it("finds each, in the order written, however the sign is typed", () => {
    expect(sizesIn("1080×1080 px or 1080×1350 px")).toEqual([{ width: 1080, height: 1080 }, { width: 1080, height: 1350 }]);
    expect(sizesIn("1080 x 1920 pixels (9:16), 1,080 x 1,350, 1200px X 628px")).toEqual([{ width: 1080, height: 1920 }, { width: 1080, height: 1350 }, { width: 1200, height: 628 }]);
  });

  it("finds none in ratios, file sizes and counts", () => {
    expect(sizesIn("Aspect ratio 9:16 and 4:5 to 1.91:1, 30MB, 20 images, 3,000 characters, 12x faster")).toEqual([]);
  });
});

describe("the parts of the guide", () => {
  it("finds each platform's cell in the cheat sheet's primary post image column", () => {
    expect(parts.cheat.get("instagram")).toBe("1080×1080 px or 1080×1350 px");
    expect(parts.cheat.get("facebook")).toBe("1080×1350 px");
    expect(parts.cheat.get("x")).toBe("1600×900 px");
    expect(parts.cheat.get("linkedin")).toBe("1200×627 px");
    expect(parts.cheat.has("platform")).toBe(false);
  });

  it("finds each platform's own section, from its heading to the next of the same level", () => {
    const fb = parts.section.get("facebook")!;
    expect(fb.startsWith("## Facebook image sizes")).toBe(true);
    expect(fb).toContain("1440×1800");
    expect(fb).not.toContain("Instagram");
    expect(parts.section.get("x")).toContain("8192×8129");
    expect(parts.section.get("linkedin")).toContain("1200×628");
  });

  it("finds no cheat sheet where the page has none, and still finds the sections", () => {
    const bare = guideParts(guideText(html.replace("sizes cheat sheet</h2>", "sizes overview</h2>")));
    expect(bare.cheat.size).toBe(0);
    expect(bare.section.has("instagram")).toBe(true);
  });
});

describe("what the model is asked and what its answer must be", () => {
  it("asks for exactly the table's rows, states the reading rule and carries the page", () => {
    const p = extractPrompt(KEYS, text);
    for (const k of KEYS) expect(p).toContain(`- platform "${k.platform}", format "${k.format}"`);
    expect(p).toContain('"Primary post image" cell');
    expect(p).toContain("Leave out everything else: ads");
    expect(p).toContain("Instagram | 110×110 px | N/A | 1080×1080 px or 1080×1350 px");
    expect(EXTRACT_TOOL.input_schema.properties.rows.items.properties.sizes.items.required).toEqual(["width", "height", "part"]);
  });

  it("keeps the rows asked for, the first answer for each, and only sizes that are two whole numbers with a known part", () => {
    const read = parseExtract({ rows: [
      { platform: "Instagram", format: "image", sizes: [cheat(1080, 1080), { width: "1080", height: 1350, part: "section" }, { width: 1080, height: 1350, part: "ads" }, section(1080, 1350), null] },
      { platform: "instagram", format: "image", sizes: [cheat(1, 1)] },
      { platform: "X (formerly known as Twitter)", format: "image", sizes: [cheat(1600, 900)] },
      { platform: "pinterest", format: "image", sizes: [cheat(1000, 1500)] },
      { platform: "facebook", format: "poster", sizes: [] },
      { platform: "linkedin", format: "image", sizes: "1200x1200" },
      "nonsense",
    ] }, KEYS)!;
    expect([...read.keys()].sort()).toEqual(["instagram/image", "x/image"]);
    expect(read.get("instagram/image")).toEqual([cheat(1080, 1080), section(1080, 1350)]);
    expect(read.get("x/image")).toEqual([cheat(1600, 900)]);
  });

  it("is no answer at all when it is not the structure", () => {
    for (const bad of [null, undefined, "text", 5, {}, { rows: "none" }, []]) expect(parseExtract(bad, KEYS)).toBeNull();
    expect(parseExtract({ rows: [] }, KEYS)?.size).toBe(0);
  });

  it("reads a JSON answer written as text", () => {
    expect(jsonIn('Here it is:\n{"rows":[]}\nDone.')).toEqual({ rows: [] });
    expect(jsonIn("no json")).toBeNull();
    expect(jsonIn("{broken")).toBeNull();
  });
});

describe("the sizes listed for a row", () => {
  it("are the cheat sheet cell's own sizes first, in the cell's order, whatever the model said, then the section's", () => {
    // The model lists them the other way round, and one cell size not at all; the cell decides.
    const listed = listedSizes({ platform: "instagram", format: "image" }, [section(1080, 1350), cheat(1080, 1350), section(1080, 1080)], parts);
    expect(listed).toEqual([cheat(1080, 1080), cheat(1080, 1350)]);
    expect(listedSizes({ platform: "linkedin", format: "image" }, [section(1200, 1200), section(1200, 628)], parts)).toEqual([cheat(1200, 627), section(1200, 1200), section(1200, 628)]);
    expect(cheatSizes({ platform: "x", format: "image" }, parts)).toEqual([cheat(1600, 900)]);
  });

  it("leave out a size the model names that is not written where it says", () => {
    // 1440x1800 is in Facebook's section, not in its cheat sheet cell; 1080x1440 is nowhere.
    expect(listedSizes({ platform: "facebook", format: "image" }, [cheat(1440, 1800), cheat(1080, 1440), section(1080, 1440)], parts)).toEqual([cheat(1080, 1350)]);
    // Another platform's size is not this platform's.
    expect(listedSizes({ platform: "x", format: "image" }, [cheat(1200, 627), section(1200, 1200)], parts)).toEqual([cheat(1600, 900)]);
  });

  it("never read a Story from the cheat sheet", () => {
    expect(cheatSizes({ platform: "instagram", format: "story" }, parts)).toEqual([]);
    expect(listedSizes({ platform: "instagram", format: "story" }, [cheat(1080, 1350), section(1080, 1920)], parts)).toEqual([section(1080, 1920)]);
  });
});

describe("what a row's read changes", () => {
  it("nothing, for each size the table starts with, on the guide as it is", () => {
    const reads: Array<[SizeRow, ReadSize[]]> = [
      [row("instagram", "image", 1080, 1350), [cheat(1080, 1080), cheat(1080, 1350), section(1080, 1080), section(1080, 1350)]],
      [row("instagram", "carousel", 1080, 1350), [cheat(1080, 1080), cheat(1080, 1350), section(1080, 1080), section(1080, 1350)]],
      [row("instagram", "story", 1080, 1920), [section(1080, 1920)]],
      [row("facebook", "image", 1080, 1350), [cheat(1080, 1350), section(1080, 1080), section(1440, 1800)]],
      [row("facebook", "story", 1080, 1920), [section(1080, 1920)]],
      [row("linkedin", "image", 1200, 1200), [cheat(1200, 627), section(1200, 1200), section(1200, 628)]],
      [row("x", "image", 1600, 900), [cheat(1600, 900)]],
    ];
    for (const [r, read] of reads) expect(decide(r, read, parts)).toMatchObject({ outcome: "same", from: [r.width, r.height] });
  });

  it("the size, at once, when the first listed size is near the one in use", () => {
    // The guide's Facebook cell says 1080x1350; a table that held 1080x1440 moves to it.
    const out = decide(row("facebook", "image", 1080, 1440), [cheat(1080, 1350), section(1080, 1080)], parts);
    expect(out).toMatchObject({ outcome: "changed", from: [1080, 1440], to: [1080, 1350] });
  });

  it("the cheat sheet's size, not the section's, when both differ from the size in use", () => {
    const out = decide(row("linkedin", "image", 1200, 1080), [section(1200, 1200), section(1200, 628), cheat(1200, 627)], parts);
    expect(out).toMatchObject({ to: [1200, 627], listed: [[1200, 627, "cheat_sheet"], [1200, 1200, "section"], [1200, 628, "section"]] });
  });

  it("a pending size, when the first listed size is far from the one in use, and the size only on the second read", () => {
    const first = decide(row("x", "image", 1200, 1200), [cheat(1600, 900)], parts);
    expect(first).toMatchObject({ outcome: "held", from: [1200, 1200], to: [1600, 900] });
    const second = decide(row("x", "image", 1200, 1200, [1600, 900]), [cheat(1600, 900)], parts);
    expect(second).toMatchObject({ outcome: "confirmed", to: [1600, 900] });
    // Another pending size is not a confirmation.
    expect(decide(row("x", "image", 1200, 1200, [1080, 1080]), [cheat(1600, 900)], parts).outcome).toBe("held");
  });

  it("nothing, whatever the model answered, while the page itself still writes the size in use", () => {
    // In the cheat sheet cell.
    expect(decide(row("x", "image", 1600, 900), undefined, parts)).toMatchObject({ outcome: "same" });
    expect(decide(row("instagram", "image", 1080, 1350), [], parts)).toMatchObject({ outcome: "same" });
    expect(decide(row("instagram", "image", 1080, 1350), [cheat(1080, 1440), section(1080, 1440)], parts)).toMatchObject({ outcome: "same" });
    // In the platform's own section only: LinkedIn's cheat sheet cell says 1200x627, its section 1200x1200.
    expect(decide(row("linkedin", "image", 1200, 1200), undefined, parts)).toMatchObject({ outcome: "same" });
    expect(decide(row("linkedin", "image", 1200, 1200), [cheat(1200, 627)], parts)).toMatchObject({ outcome: "same" });
    expect(decide(row("linkedin", "image", 1200, 1200, [1200, 627]), [cheat(1200, 627), section(1200, 628)], parts)).toMatchObject({ outcome: "same" });
    expect(decide(row("instagram", "story", 1080, 1920), [], parts)).toMatchObject({ outcome: "same" });
    // However the page types the sign.
    const typed = guideParts(text.replace("1200×1200 pixels", "1200 x 1200 pixels"));
    expect(decide(row("linkedin", "image", 1200, 1200), [cheat(1200, 627)], typed)).toMatchObject({ outcome: "same" });
    // Another platform's section does not keep it.
    expect(decide(row("x", "image", 1200, 1200), [cheat(1600, 900)], parts)).toMatchObject({ outcome: "held" });
  });

  it("nothing, when the size in use is no longer on the page and the model gave nothing for the row or nothing that is on the page", () => {
    expect(decide(row("linkedin", "image", 1200, 1080), undefined, parts)).toMatchObject({ outcome: "refused", reason: "not_read", listed: [[1200, 627, "cheat_sheet"]] });
    expect(decide(row("linkedin", "image", 1200, 1080), [], parts)).toMatchObject({ outcome: "refused", reason: "not_read" });
    expect(decide(row("instagram", "story", 1152, 2048), undefined, parts)).toMatchObject({ outcome: "refused", reason: "not_read" });
    expect(decide(row("instagram", "story", 1152, 2048), [cheat(1080, 1350), section(1234, 987)], parts)).toMatchObject({ outcome: "refused", reason: "not_on_page", read: [[1080, 1350, "cheat_sheet"], [1234, 987, "section"]] });
  });

  it("nothing, when the first listed size is one the image model refused and has not drawn since", () => {
    const at = (drawn: string | null, confirmed: string | null) => modelWord([{ platform: "x", format: "image", width: 1600, height: 900, drawn_at: drawn, refusal_confirmed_at: confirmed }]);
    const x = row("x", "image", 1500, 844);
    expect(decide(x, [cheat(1600, 900)], parts, at(null, "2026-11-20T10:00:00Z"))).toMatchObject({ outcome: "refused", reason: "model_refused", to: [1600, 900] });
    expect(decide(x, [cheat(1600, 900)], parts, at("2026-11-19T10:00:00Z", "2026-11-20T10:00:00Z"))).toMatchObject({ outcome: "refused", reason: "model_refused" });
    // Drawn since the refusal, or refused with no confirmation: drawable.
    expect(decide(x, [cheat(1600, 900)], parts, at("2026-11-21T10:00:00Z", "2026-11-20T10:00:00Z")).outcome).toBe("changed");
    expect(decide(x, [cheat(1600, 900)], parts, at(null, null)).outcome).toBe("changed");
  });

  it("a row no request reads is read again when the guide still lists its size, and changes when the guide lists another", () => {
    const off = { ...row("x", "image", 1600, 900), usable: false };
    expect(decide(off, [cheat(1600, 900)], parts)).toMatchObject({ outcome: "retried", from: [1600, 900] });
    expect(decide(off, undefined, parts)).toMatchObject({ outcome: "retried" });
    expect(decide({ ...row("linkedin", "image", 1200, 1200), usable: false }, [cheat(1200, 627)], parts)).toMatchObject({ outcome: "retried" });
    // The guide lists another size and no longer this one: the usual outcomes.
    expect(decide({ ...row("x", "image", 1500, 844), usable: false }, [cheat(1600, 900)], parts)).toMatchObject({ outcome: "changed", to: [1600, 900] });
    // A row in use is the same as ever.
    expect(decide({ ...row("x", "image", 1600, 900), usable: true }, [cheat(1600, 900)], parts)).toMatchObject({ outcome: "same" });
  });

  it("the size before it, or no size at all, for a row whose size in use the image model refuses", () => {
    const word = modelWord([
      { platform: "linkedin", format: "image", width: 1200, height: 628, drawn_at: null, refusal_confirmed_at: "2026-11-20T10:00:00Z" },
      { platform: "linkedin", format: "image", width: 1200, height: 1200, drawn_at: "2026-11-18T10:00:00Z", refusal_confirmed_at: null },
      { platform: "x", format: "image", width: 1600, height: 900, drawn_at: null, refusal_confirmed_at: "2026-11-20T10:00:00Z" },
    ]);
    // LinkedIn was 1200x1200, which the model drew, before the guide moved it to 1200x628.
    expect(refusedRow({ ...row("linkedin", "image", 1200, 628), previous_width: 1200, previous_height: 1200 }, word)).toMatchObject({ outcome: "reverted", reason: "model_refused", from: [1200, 628], to: [1200, 1200] });
    // X never had another size: none.
    expect(refusedRow(row("x", "image", 1600, 900), word)).toMatchObject({ outcome: "unusable", reason: "model_refused", from: [1600, 900] });
    // A size before it that was never drawn is not gone back to.
    expect(refusedRow({ ...row("x", "image", 1600, 900), previous_width: 1200, previous_height: 675 }, word)).toMatchObject({ outcome: "unusable" });
    // A row that is not refused, and one already off with nothing to go back to, are left to the guide.
    expect(refusedRow(row("instagram", "image", 1080, 1350), word)).toBeNull();
    expect(refusedRow({ ...row("x", "image", 1600, 900), usable: false }, word)).toBeNull();
    // A row already off still goes back to a drawn size before it.
    expect(refusedRow({ ...row("linkedin", "image", 1200, 628), previous_width: 1200, previous_height: 1200, usable: false }, word)).toMatchObject({ outcome: "reverted", to: [1200, 1200] });
  });

  it("nothing, when the first listed size fails a check, even with a good size after it", () => {
    // X's section holds only a maximum resolution; with no cheat sheet, a model that gave it is refused on the edge bound.
    const noSheet = guideParts(guideText(html.replace("sizes cheat sheet</h2>", "sizes overview</h2>")));
    expect(decide(row("x", "image", 1200, 675), [section(8192, 8129)], noSheet)).toMatchObject({ outcome: "refused", reason: "edge" });
    // A Story that is not 9:16.
    expect(decide(row("instagram", "story", 1152, 2048, null), [section(1080, 1610)], parts)).toMatchObject({ outcome: "refused", reason: "shape" });
    // The profile picture first, a real post size second: still refused.
    expect(decide(row("facebook", "image", 1200, 1200), [section(320, 320), section(1080, 1080)], noSheet)).toMatchObject({ outcome: "refused", reason: "edge", to: [320, 320] });
  });
});
