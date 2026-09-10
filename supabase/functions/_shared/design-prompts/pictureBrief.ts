// supabase/functions/_shared/design-prompts/pictureBrief.ts
//
// The brief with the words taken out.
//
// When the app types the headline afterwards, any wording left in the brief
// is wording the image model renders: a brief that says
// `Headline: "Five Assumptions"` comes back with those letters painted on,
// and the typed headline then lands on top of them. So before a picture-only
// generation, every instruction that names copy is removed.

/** Labels that introduce copy rather than describe a picture. */
const COPY_LABEL = /^\s*(head-?line|sub-?head(line)?|title|caption|copy|text|cta|call[- ]to[- ]action|body|label|overlay|kicker|tagline)\s*[:\-–]\s*/i;

/**
 * The brief as a description of a picture only.
 *
 * Drops label lines ("Headline: …"), inline label clauses, quoted phrases,
 * and the sentences whose whole point was to place words on the canvas.
 */
export function pictureBrief(text: string): string {
  const kept: string[] = [];
  for (const rawLine of String(text || "").split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (COPY_LABEL.test(line)) continue;
    const sentences = line
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        // "Headline 'X' in heavy sans, lower-left." — the sentence exists to
        // set type, so it goes with the type.
        if (/\b(head-?line|sub-?head(line)?|caption|cta|call[- ]to[- ]action|tagline|kicker|type|typeset|lettering|word(s|ing)?|text)\b/i.test(sentence)) {
          return !/\b(no|without|never|free of)\b/i.test(sentence) ? false : true;
        }
        return true;
      })
      .map((sentence) =>
        sentence
          .replace(COPY_LABEL, "")
          // A quoted phrase in a picture brief is copy to render.
          .replace(/["“”'‘’]{1}[^"“”]{2,80}["“”'‘’]{1}/g, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
      )
      .filter(Boolean);
    if (sentences.length) kept.push(sentences.join(" "));
  }
  return kept.join("\n").trim();
}
