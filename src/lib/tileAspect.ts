/**
 * The box a generated variant is shown in.
 *
 * A clip or design is rendered at the ratio its platform wants, and the tile
 * has to agree with it. Tiles used to be a fixed portrait box with the media
 * cropped to fill, which quietly cut the headline off a 16:9 LinkedIn clip:
 * the file was right and the thumbnail was a lie. Pair this with
 * object-contain so nothing is ever cut, whatever the box turns out to be.
 */
export function tileAspectFor(input: { format?: string | null; platform?: string | null } | null | undefined): string {
  const s = `${input?.format || ""} ${input?.platform || ""}`;
  if (/reel|stor|short|tiktok/i.test(s)) return "aspect-[9/16]";
  if (/landscape|horizontal|16:9|youtube|banner|article/i.test(s)) return "aspect-video";
  return "aspect-square";
}
