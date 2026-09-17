// The retry correction, in one place.
//
// This logic used to exist twice: once in validateImage.ts for the edge
// functions and once in src/lib/designGuard.ts for the browser, with a comment
// on each saying it was "kept in step" with the other. It was not. The edge
// copy had been taught that a large single letter used as a watermark counts as
// a logo, which is exactly what question 2 of the validator asks about, and
// that garbled text is best fixed by using fewer, larger words. The browser
// copy still said neither. So a design generated through the browser path could
// fail review for a decorative letterform and then be retried with a correction
// that never mentioned it, which is the one thing the retry exists to do.
//
// Two copies of a prompt cannot be kept in step by asking people to remember.
// Both sides import this now. It is deliberately free of any Deno or browser
// API so it can be bundled either way.

export interface DesignVerdict {
  has_hex_codes?: boolean;
  has_logo?: boolean;
  has_garbled_text?: boolean;
  /** Any readable word at all. A failure only when the design was asked for text-free. */
  has_text?: boolean;
  /** Breaks the brand's own rules, or shows fake interface chrome. */
  off_brand?: boolean;
  /** The brand rules the server reviewed against, echoed back for the retry prompt. */
  avoid?: string | null;
  /** True when no check ran: no key, an API error, or an unparseable reply. */
  skipped?: boolean;
}

export const CLEAN_VERDICT: DesignVerdict = {
  has_hex_codes: false,
  has_logo: false,
  has_garbled_text: false,
  has_text: false,
  off_brand: false,
};

/**
 * Anything worth regenerating for.
 *
 * A skipped check is not a clean bill of health, but it is not evidence of a
 * problem either, so it must never trigger a paid regeneration.
 */
export function verdictIsDirty(
  v: DesignVerdict | null | undefined,
  opts: { expectNoText?: boolean } = {},
): boolean {
  if (!v || v.skipped) return false;
  return Boolean(
    v.off_brand || v.has_logo || v.has_garbled_text || v.has_hex_codes || (opts.expectNoText && v.has_text),
  );
}

/**
 * The correction appended to a retry prompt. Naming the specific failure works
 * far better than repeating the original constraint, which the model already
 * ignored once.
 *
 * `avoid` may arrive on the verdict itself (the browser reads it off the
 * response) or as an option (the edge functions pass it in), so both are
 * accepted and the explicit option wins.
 */
export function correctionFor(
  v: DesignVerdict,
  opts: { expectNoText?: boolean; avoid?: string | null } = {},
): string {
  const avoid = opts.avoid ?? v.avoid ?? null;
  const notes: string[] = [];

  if (v.off_brand) {
    notes.push(
      "The previous attempt broke the brand's own rules, drew interface furniture, left a blank placeholder rectangle, or tiled several photographs. " +
        "Draw NO search bars, input fields, empty button shapes, phone or app frames, tab bars or blank rectangles, and use exactly ONE photograph: " +
        "the area kept for type is a flat field of the brand's colour and nothing else. " +
        (avoid
          ? `And obey these rules exactly: ${avoid.slice(0, 600)}`
          : "Re-stage the subject inside the brand's own layout, palette and photographic treatment."),
    );
  }
  if (opts.expectNoText && v.has_text) {
    notes.push(
      "The previous attempt contained readable words, on a document, a sign, a screen or a prop. " +
        "This image must contain NO lettering of any kind, anywhere, at any size: papers are blank or out of focus, " +
        "screens are dark or abstract, signage is absent. The words are added afterwards by the app.",
    );
  }
  if (v.has_logo) {
    notes.push(
      "The previous attempt rendered a logo, wordmark, brand insignia or a large decorative letterform. Render NO logo, " +
        "no wordmark, no monogram, no badge and no single letter or initial used as a background or watermark. " +
        "Leave the area where a logo would sit visually clear and uncluttered, because the real logo is composited in afterwards.",
    );
  }
  if (v.has_garbled_text) {
    notes.push(
      "The previous attempt contained malformed text: doubled, smeared or overlapping letters, or a word cut off. " +
        "Use fewer words, at most 6 per line and 12 in total, set larger, each spelled exactly as in the brief, " +
        "with clear space around every line. Never invent lettering.",
    );
  }
  if (v.has_hex_codes) {
    notes.push(
      "The previous attempt showed colour codes as readable text. Never render hex codes, RGB " +
        "values or any technical colour notation: colour is applied visually only.",
    );
  }

  if (notes.length === 0) return "";
  return `\n\nCRITICAL CORRECTIONS, the previous attempt failed review:\n- ${notes.join("\n- ")}`;
}
