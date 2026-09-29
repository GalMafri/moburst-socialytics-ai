/** Short source-artwork cards must carry content, not an unfulfilled list teaser. */
export function sourceSequenceIssue(slides: unknown, count: number): string | null {
  if (!Array.isArray(slides) || slides.length !== count) return 'Return exactly the requested number of cards.';
  const headlines = slides.map(s => typeof s?.headline === 'string' ? s.headline.trim() : '');
  if (headlines.some(h => !h || h.length > 120 || h.split(/\s+/).length > 14) || new Set(headlines.map(h=>h.toLowerCase())).size !== count) return 'Use distinct, concise, complete headlines.';
  const teaser = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:practical\s+|simple\s+|key\s+)?(?:checks|tips|steps|ways)\b|\b(?:here['’]s what|here is what|these checks|these steps|we (?:cover|share|break down))\b/i;
  if (headlines.some(h => teaser.test(h) || /#[\p{L}\p{N}_]+/u.test(h))) return 'Remove list teasers, promised checks or steps, and hashtags. State the actual supported insight in each card. Do not invent missing details.';
  return null;
}
