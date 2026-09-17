// supabase/functions/_shared/design-prompts/validateImage.ts

// DesignVerdict, CLEAN_VERDICT, verdictIsDirty and correctionFor moved to
// ./correction.ts so the browser and the edge functions share one copy
// instead of two that drifted. Re-exported here so every existing import
// of this module keeps working.
export type { DesignVerdict } from "./correction.ts";
export { CLEAN_VERDICT, correctionFor, verdictIsDirty } from "./correction.ts";
import type { DesignVerdict } from "./correction.ts";
import { CLEAN_VERDICT } from "./correction.ts";

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
  opts: { apiKey?: string | null; mediaType?: string; avoid?: string | null } = {},
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
        max_tokens: 24,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: parts.mimeType, data: parts.base64 } },
              { type: "text", text: questionFor(opts.avoid) },
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
      off_brand: words[4] === "YES",
    };
  } catch (err) {
    console.error("validateDesignImage threw:", err);
    return { ...CLEAN_VERDICT, skipped: true };
  }
}

/** Anything worth regenerating for. */

/**
 * The correction appended to a retry prompt. Naming the specific failure works
 * far better than repeating the original constraint, which the model already
 * ignored once.
 */
