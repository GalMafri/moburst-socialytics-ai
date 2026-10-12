// The video spec the engine writes (engine/design_engine/video/spec.py): everything measured or chosen by code.
// No prompt text, no model wording: fonts are files, the logo is the client's file, colours are observed pairs.

export interface Card {
  headline: string;
  subline?: string | null;
  // seconds this card holds the screen
  seconds: number;
  // ink and ground as observed pairs from the brand profile
  ink: string;
  ground: string;
  // frame fractions of the headline block (the family's slot at this size)
  slot: { x: number; y: number; w: number; h: number };
  headlinePx: number;
  sublinePx?: number;
  align: "left" | "center";
}

export interface Caption {
  text: string;
  start: number; // seconds
  end: number;
}

export interface VideoSpec {
  width: number;
  height: number;
  fps: number;
  fonts: { headline: string; subline: string }; // absolute file paths (served through staticFile by the renderer's public dir symlink)
  logo: { path: string; box: { x: number; y: number; w: number; h: number } };
  broll?: { path: string; darken?: number } | null; // a text-free clip, cover-fit; darkened under the cards
  plate?: { path: string; darken?: number } | null; // a still plate in the brand's look under the cards, in slow motion
  endCard?: { seconds: number; ground: string; logoBox: { x: number; y: number; w: number; h: number } } | null; // the closing card: the mark alone
  cards: Card[];
  captions?: Caption[];
  captionStyle?: { ink: string; ground: string; px: number; bottomInset: number }; // inside the platform's safe zone
}
