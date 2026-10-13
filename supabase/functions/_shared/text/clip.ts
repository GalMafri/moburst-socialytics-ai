/**
 * Shorten text to at most `max` characters without splitting a character.
 *
 * String.slice counts UTF-16 units, so it can cut an emoji in half. The half
 * left behind is not valid text, and the database rejects any row carrying
 * it ("Empty or invalid json"): drafting from a competitor post failed this
 * way whenever an emoji sat at the cut (13 Oct).
 */
export function clipText(text: unknown, max: number): string {
  const chars = Array.from(String(text ?? ""));
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("");
}
