// supabase/functions/_shared/design-prompts/headline.ts
//
// The words a design carries: the first clause of the post's copy, short
// enough to set large. Used for the video seed, where the headline has to be
// in the frame before Veo animates it.

const HANGING = new Set([
  "after", "a", "an", "the", "to", "of", "and", "or", "for", "with", "in", "on", "at", "by",
  "your", "our", "that", "when", "if", "before", "is", "are", "was",
]);

/** The headline for a post: first sentence, cut before a list colon or line break, at most `maxWords`. */
export function headlineFrom(copy: string | null | undefined, maxWords = 12): string {
  const clean = String(copy || "").replace(/#[\w]+/g, "").trim();
  if (!clean) return "";
  const first = (clean.split(/(?<=[.!?])\s+|:\s*\n|\n+/)[0] || "").replace(/[.,;:]+$/, "");
  let words = first.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) {
    const clause = first.slice(0, 90).search(/[,;:]|\s(?:because|while|which|so that)\s/);
    words = (clause > 20 ? first.slice(0, clause) : words.slice(0, maxWords).join(" ")).split(/\s+/);
  }
  while (words.length > 3 && HANGING.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ").replace(/[.,;:]+$/, "");
}
