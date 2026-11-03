// supabase/functions/_shared/strategy/deckLayout.ts
//
// The geometry of the strategy deck's template, in points on the Moburst deck
// design system's 720 x 405 canvas. assets/strategy-deck/build_template.py
// draws the template from the same numbers (assets/strategy-deck/layout.json;
// deck.test.ts proves the two are the same), and deck.ts measures each field
// against them, so a card's text is chosen to fit the card it lands in.
//
// From the design system's measured geometry: the content width (x 36.7 to
// 683.3), the header (18pt title at y 25.71, 10pt intro at y 71.74), the card
// gutter of its 5-up rows (pitch 131.14 less width 120.7), the 11pt Medium
// label on 15pt leading and the 10pt Light body on 13.5pt leading, and the
// process chips (120.5 x 55.6, pitch 147). Card rows of 1 to 5 are centred on
// x 360, as the system asks of a row without centre art.

export const DECK_LAYOUT = {
  canvas: { w: 720, h: 405 },
  content: { x: 36.7, w: 646.6 },
  gutter: 10.44,
  inset: 13,
  label: { dy: 18.7, size: 11, leading: 15, lines: 2, weight: "Medium" },
  rule: { dy: 54.7 },
  body: { dy: 66, size: 10, leading: 13.5, weight: "Light", foot: 14 },
  cards: { y: 100, h: 268 },
  chartCards: { y: 178, h: 190, chart: { x: 36.7, y: 92, w: 646.6, h: 78 } },
  start: { rows: { x: 36.7, y: 100, w: 290, lines: 15 }, chart: { x: 340, y: 96, w: 343.3, h: 246 }, footer: { y: 356 } },
  flow: { chip: { w: 120.5, h: 55.6, x: 79.2, pitch: 147, y: 104, textY: 20.6 }, body: { y: 176, lines: 13 } },
  cover: { logo: { x: 560, y: 80, w: 120, h: 64 } },
  maxCards: 5,
} as const;

/** The width of each card in a row of n. */
export const cardWidth = (n: number) => (DECK_LAYOUT.content.w - (n - 1) * DECK_LAYOUT.gutter) / n;
/** The width a card's text has. */
export const cardTextWidth = (n: number) => cardWidth(n) - 2 * DECK_LAYOUT.inset;
/** The body lines a card holds before its foot. */
export const bodyLines = (cardH: number) => Math.floor((cardH - DECK_LAYOUT.body.dy - DECK_LAYOUT.body.foot) / DECK_LAYOUT.body.leading);
