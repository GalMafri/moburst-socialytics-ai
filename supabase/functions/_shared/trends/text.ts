// Text that goes to Claude must be well-formed: the Messages and Batches APIs
// refuse a request whose JSON holds half of an emoji (a lone UTF-16
// surrogate). Found in the 1 Nov 2026 trial, where a post cut at 500
// characters split one.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The text without any half of an emoji, cut to at most n characters without splitting one. */
export function clip(text: string, n: number): string {
  const whole = String(text ?? "").replace(LONE_SURROGATE, "");
  if (whole.length <= n) return whole;
  return whole.slice(0, n).replace(LONE_SURROGATE, "");
}
