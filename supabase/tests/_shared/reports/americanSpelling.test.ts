// The deterministic word map that puts stored report text in American spelling
// (reportText.ts americanSpelling): every form the British check flags maps to
// a form it passes, and nothing else in the text moves.
import { describe, expect, it } from "vitest";
import { americanSpelling, britishSpelling, exemptPattern, SPELLING_FAMILIES } from "../../../functions/_shared/reports/reportText";

const every = (): string[] => {
  const f = SPELLING_FAMILIES;
  return [
    ...f.our.roots.flatMap((r) => ["", ...f.our.endings].map((e) => r + e)),
    ...f.ise.roots.flatMap((r) => f.ise.endings.map((e) => r + e)),
    ...f.yse.roots.flatMap((r) => f.yse.endings.map((e) => r + e)),
    ...f.ll.roots.flatMap((r) => f.ll.endings.map((e) => `${r}l${e}`)),
    ...f.words,
  ];
};

describe("americanSpelling", () => {
  it("maps every British form the check flags to one the check passes", () => {
    const words = every();
    expect(words.length).toBeGreaterThan(500);
    for (const word of words) {
      expect(britishSpelling(word), word).toBe(word);
      const fixed = americanSpelling(word);
      expect(fixed, word).not.toBe(word);
      expect(britishSpelling(fixed), `${word} -> ${fixed}`).toBeNull();
    }
  });

  it("writes the American word, keeping its case", () => {
    const cases: Array<[string, string]> = [
      ["behaviour", "behavior"], ["Behavioural", "Behavioral"], ["favourite", "favorite"], ["COLOUR", "COLOR"],
      ["optimise", "optimize"], ["Organisational", "Organizational"], ["recognisable", "recognizable"], ["emphasise", "emphasize"],
      ["analysed", "analyzed"], ["centre", "center"], ["centred", "centered"], ["centring", "centering"], ["theatres", "theaters"],
      ["travelled", "traveled"], ["modeller", "modeler"], ["labelling", "labeling"], ["instalment", "installment"], ["enrolment", "enrollment"],
      ["fulfils", "fulfills"], ["enrol", "enroll"], ["programmes", "programs"], ["judgement", "judgment"], ["licence", "license"],
      ["practising", "practicing"], ["sceptical", "skeptical"], ["manoeuvres", "maneuvers"], ["jewellery", "jewelry"], ["ageing", "aging"],
      ["enquiries", "inquiries"], ["counsellors", "counselors"], ["cheques", "checks"], ["artefacts", "artifacts"], ["whilst", "while"],
    ];
    for (const [from, to] of cases) expect(americanSpelling(from), from).toBe(to);
  });

  it("changes only the flagged words: quoted text, names, the input's own phrases and American words stay as written", () => {
    expect(americanSpelling("Reach held: behaviour and colour posts optimised well.")).toBe("Reach held: behavior and color posts optimized well.");
    expect(americanSpelling('The "Our colour range" post was installed, enrolled and cancelled in analyses.')).toBe('The "Our colour range" post was installed, enrolled and cancelled in analyses.');
    const exempt = exemptPattern(["Colour Pop"], ["Human Behaviour Insights"]);
    expect(americanSpelling("Colour Pop's Human Behaviour Insights pillar led; behaviour shifted.", exempt)).toBe("Colour Pop's Human Behaviour Insights pillar led; behavior shifted.");
    expect(americanSpelling("All American already.")).toBe("All American already.");
  });
});

describe("britishSpelling: prefixes, -hood and proper nouns", () => {
  it("flags prefixed and -hood forms and writes them the American way", () => {
    const cases: Array<[string, string]> = [
      ["neighbourhood", "neighborhood"], ["neighbourhoods", "neighborhoods"], ["unfavourable", "unfavorable"], ["misbehaviour", "misbehavior"],
      ["reorganise", "reorganize"], ["unauthorised", "unauthorized"], ["disorganised", "disorganized"], ["Dishonoured", "Dishonored"],
      ["overoptimised", "overoptimized"], ["underutilised", "underutilized"], ["decentralised", "decentralized"], ["reanalysed", "reanalyzed"],
    ];
    for (const [from, to] of cases) {
      expect(britishSpelling(`It was ${from}.`), from).toBe(from);
      expect(americanSpelling(from), from).toBe(to);
      expect(britishSpelling(to), to).toBeNull();
    }
    for (const word of ["neighborhood", "unfavorable", "reorganized", "unauthorized", "disorganized", "underutilized", "deodorant", "reinstalled", "reenrolled", "unfulfilled", "realise".replace("s", "z")]) {
      expect(britishSpelling(word), word).toBeNull();
    }
  });

  it("passes Theatre or Centre as part of a name, and flags them in running text", () => {
    expect(britishSpelling("The show at the Majestic Theatre sold out.")).toBeNull();
    expect(britishSpelling("Fans met at Rogers Centre.")).toBeNull();
    expect(americanSpelling("Fans met at Rogers Centre in the city centre.")).toBe("Fans met at Rogers Centre in the city center.");
    expect(britishSpelling("The theatre posts won.")).toBe("theatre");
    expect(britishSpelling("The Theatre posts won.")).toBe("Theatre");
    expect(britishSpelling("Theatre posts won.")).toBe("Theatre");
  });
});

describe("britishSpelling: links, handles and hashtags", () => {
  it("leaves a link, an @handle and a #hashtag as written, in the check and in the word map", () => {
    const text = "See https://example.co.uk/colour-guide and www.shop.co.uk/organise, tag @colourpop_uk and #ColourDrop.";
    expect(britishSpelling(text)).toBeNull();
    expect(americanSpelling(text)).toBe(text);
    // The model's own word next to them is still its spelling.
    expect(americanSpelling(`${text} The colour posts won.`)).toBe(`${text} The color posts won.`);
  });
});

describe("britishSpelling: an input written mostly in British English", () => {
  it("checks a long analysis against a large British input in time linear in the text", () => {
    const words = ["colour", "behaviour", "organise", "optimised", "favourite", "travelled", "recognisable", "centre"];
    // 500 captions, each with several British words: thousands of exempt phrases.
    const captions = Array.from({ length: 500 }, (_, i) => `Caption ${i}: our ${words[i % 8]} drop ${i} and the ${words[(i + 3) % 8]} story ${i}, ${words[(i + 5) % 8]} wins ${i}.`);
    const exempt = exemptPattern(["Colour Pop"], captions);
    const analysis = Array.from({ length: 80 }, (_, i) => `Insight ${i}: our ${words[i % 8]} drop ${i} led, and the brand's own color story grew ${i}%.`);
    const started = performance.now();
    const flagged = analysis.map((t) => britishSpelling(t, exempt));
    const elapsed = performance.now() - started;
    // Every analysis sentence repeats an input phrase ("our colour drop 0"), so nothing is the model's spelling.
    expect(flagged.filter(Boolean)).toEqual([]);
    expect(britishSpelling("Its colour matters.", exempt)).toBe("colour");
    expect(elapsed).toBeLessThan(500);
  });
});
