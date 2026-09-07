// supabase/functions/_shared/design-prompts/validateImage.ts

export interface DesignVerdict {
  has_hex_codes: boolean;
  has_logo: boolean;
  has_garbled_text: boolean;
  /** Any readable word or lettering at all — signage, documents, labels, props. Counts as a failure only when the design was asked for text-free. */
  has_text: boolean;
  /** True when no check ran (no key, API error, unparseable reply). */
  skipped?: boolean;
}

export const CLEAN_VERDICT: DesignVerdict = {
  has_hex_codes: false,
  has_logo: false,
  has_garbled_text: false,
  has_text: false,
};

const QUESTION =
  "You are checking a generated social media graphic before it reaches a client.\n" +
  "Answer four questions about what is actually visible in the image.\n" +
  "1. HEX: does it show hex colour codes (like #FF5733), RGB values, or any technical colour notation as readable text?\n" +
  "2. LOGO: does it show a company logo, wordmark, monogram, badge or brand insignia — including a large single letter, initial or monogram used as a background, watermark or decorative element? Count any invented or fake-looking brand mark. Do NOT count plain body or headline text that is simply words.\n" +
  "3. GARBLED: is any visible text misspelled, malformed, nonsensical or made of broken letterforms — including letters that are doubled, smeared, overlapping, bleeding into each other, or a word cut off at the edge of the canvas or of its own line?\n" +
  "4. TEXT: is there ANY readable word, letter or number anywhere — a headline, a caption, a label on a prop, lettering on a document, a sign, a screen, a phone key? Count it even if it is small, partial or in the background.\n" +
  "Reply with exactly four words separated by single spaces, each YES or NO, in the order HEX LOGO GARBLED TEXT. No other text.";

/** Split a data URL or raw base64 into the parts the Anthropic API wants. */
export function splitImageData(imageData: string, fallbackMime = "image/png"): { base64: string; mimeType: string } | null {
  if (!imageData) return null;
  if (imageData.startsWith("data:")) {
    const m = imageData.match(/^data:([^;]+);base64,(.+)$/);
    return m ? { mimeType: m[1], base64: m[2] } : null;
  }
  return { base64: imageData, mimeType: fallbackMime };
}

/**
 * Ask a small vision model what is actually on the generated image.
 *
 * The prompts forbid logos and colour codes, but a diffusion model will still
 * put an invented wordmark in the corner often enough to matter — and an
 * invented mark on a client's post is worse than no mark. Every check fails
 * OPEN: a validator problem must never block a good design.
 */
export async function validateDesignImage(
  imageData: string,
  opts: { apiKey?: string | null; mediaType?: string } = {},
): Promise<DesignVerdict> {
  const apiKey = opts.apiKey ?? Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { ...CLEAN_VERDICT, skipped: true };

  const parts = splitImageData(imageData, opts.mediaType || "image/png");
  if (!parts) return { ...CLEAN_VERDICT, skipped: true };

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: parts.mimeType, data: parts.base64 } },
              { type: "text", text: QUESTION },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("validateDesignImage: Anthropic error", response.status, (await response.text().catch(() => "")).slice(0, 200));
      return { ...CLEAN_VERDICT, skipped: true };
    }

    const result = await response.json();
    const answer = String(result.content?.[0]?.text || "").trim().toUpperCase();
    const words = answer.split(/[^A-Z]+/).filter((w: string) => w === "YES" || w === "NO");
    if (words.length < 3) {
      console.warn("validateDesignImage: unparseable verdict:", answer.slice(0, 40));
      return { ...CLEAN_VERDICT, skipped: true };
    }
    return {
      has_hex_codes: words[0] === "YES",
      has_logo: words[1] === "YES",
      has_garbled_text: words[2] === "YES",
      has_text: words[3] === "YES",
    };
  } catch (err) {
    console.error("validateDesignImage threw:", err);
    return { ...CLEAN_VERDICT, skipped: true };
  }
}

/** Anything worth regenerating for. */
export function verdictIsDirty(v: DesignVerdict | null | undefined, opts: { expectNoText?: boolean } = {}): boolean {
  if (!v || v.skipped) return false;
  return v.has_hex_codes || v.has_logo || v.has_garbled_text || (!!opts.expectNoText && !!v.has_text);
}

/**
 * The correction appended to a retry prompt. Naming the specific failure works
 * far better than repeating the original constraint, which the model already
 * ignored once.
 */
export function correctionFor(v: DesignVerdict, opts: { expectNoText?: boolean } = {}): string {
  const notes: string[] = [];
  if (opts.expectNoText && v.has_text) {
    notes.push(
      "The previous attempt contained readable words — on a document, a sign, a screen or a prop. " +
        "This image must contain NO lettering of any kind, anywhere, at any size: papers are blank or out of focus, " +
        "screens are dark or abstract, signage is absent. The words are added afterwards by the app.",
    );
  }
  if (v.has_logo) {
    notes.push(
      "The previous attempt rendered a logo, wordmark, brand insignia or a large decorative letterform. Render NO logo, " +
        "no wordmark, no monogram, no badge and no single letter or initial used as a background or watermark. " +
        "Leave the area where a logo would sit visually clear and uncluttered — the real logo is composited in afterwards.",
    );
  }
  if (v.has_garbled_text) {
    notes.push(
      "The previous attempt contained malformed text: doubled, smeared or overlapping letters, or a word cut off. " +
        "Use fewer words — at most 6 per line, 12 in total — set larger, each spelled exactly as in the brief, " +
        "with clear space around every line. Never invent lettering.",
    );
  }
  if (v.has_hex_codes) {
    notes.push(
      "The previous attempt showed colour codes as readable text. Never render hex codes, RGB " +
        "values or any technical colour notation — colour is applied visually only.",
    );
  }
  if (notes.length === 0) return "";
  return `\n\nCRITICAL CORRECTIONS — the previous attempt failed review:\n- ${notes.join("\n- ")}`;
}
