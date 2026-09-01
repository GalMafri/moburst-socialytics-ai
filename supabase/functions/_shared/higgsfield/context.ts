// Bridges Socialytics client context to Higgsfield model input.
//
// The Gemini path attached design references and the brand book as inline
// base64 multimodal parts. Higgsfield instead takes reference images as
// PUBLIC HTTPS URLS (`reference_image_urls` on Soul-style models, `image_url`
// for image-to-video), so the equivalent move is to mint short-lived signed
// URLs from the same Supabase buckets and hand those over.
//
// The one thing that CANNOT cross this bridge is a PDF brand book: Higgsfield
// accepts only jpeg/jpg/png/webp/gif image inputs. A PDF's influence must
// arrive through the text prompt instead, via design_style_synthesis, which
// buildImagePrompt() already embeds. synthesize-design-language exists to
// produce exactly that synthesis, so clients with a PDF-only brand book and no
// synthesis row lose brand grounding — the caller surfaces that as a warning.

export const MAX_REFERENCE_IMAGES = 3; // same cap the Gemini path used
const SIGNED_URL_TTL_SECONDS = 60 * 60; // Higgsfield fetches immediately; 1h is generous

/** Extensions Higgsfield will accept as image input. */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function extensionOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

export function isHiggsfieldImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

/** The slice of ClientContext this module cares about. */
export interface MediaContextInput {
  design_references?: string[] | null; // storage paths in design-references bucket
  brand_book_file_path?: string | null; // storage path in brand-books bucket
  design_style_synthesis?: unknown | null;
}

export interface ResolvedContextImages {
  /** Public HTTPS URLs, ordered: design references first, then brand book. */
  referenceUrls: string[];
  /** True when a brand book exists but could not be passed as an image (PDF). */
  brandBookSkipped: boolean;
  /**
   * True when the brand book was skipped AND there is no design_style_synthesis
   * to carry its influence through the prompt — the caller should log this
   * loudly, because output will be less brand-aligned.
   */
  brandGroundingMissing: boolean;
}

/** Minimal structural type for the Supabase storage client we use. */
interface StorageSigner {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Resolve the client's visual context into Higgsfield-consumable image URLs.
 *
 * Signing failures on individual files are logged and skipped rather than
 * failing the generation — matching the Gemini path, which also soldiered on
 * when a reference download failed.
 */
export async function resolveContextImageUrls(
  ctx: MediaContextInput | null | undefined,
  supabase: StorageSigner,
): Promise<ResolvedContextImages> {
  const referenceUrls: string[] = [];
  let brandBookSkipped = false;

  const refs = (ctx?.design_references ?? []).filter(Boolean);
  for (const ref of refs.slice(0, MAX_REFERENCE_IMAGES)) {
    if (!isHiggsfieldImagePath(ref)) {
      console.warn("[higgsfield/context] skipping non-image design reference:", ref);
      continue;
    }
    try {
      const { data, error } = await supabase.storage
        .from("design-references")
        .createSignedUrl(ref, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) {
        console.warn("[higgsfield/context] could not sign design reference:", ref, error?.message);
        continue;
      }
      referenceUrls.push(data.signedUrl);
    } catch (e) {
      console.warn("[higgsfield/context] signing threw for reference:", ref, e);
    }
  }

  const bookPath = ctx?.brand_book_file_path ?? null;
  if (bookPath) {
    if (isHiggsfieldImagePath(bookPath)) {
      try {
        const { data, error } = await supabase.storage
          .from("brand-books")
          .createSignedUrl(bookPath, SIGNED_URL_TTL_SECONDS);
        if (!error && data?.signedUrl) {
          referenceUrls.push(data.signedUrl);
        } else {
          console.warn("[higgsfield/context] could not sign brand book:", bookPath, error?.message);
          brandBookSkipped = true;
        }
      } catch (e) {
        console.warn("[higgsfield/context] signing threw for brand book:", bookPath, e);
        brandBookSkipped = true;
      }
    } else {
      // Almost always a PDF. Its influence must come through the prompt.
      brandBookSkipped = true;
    }
  }

  const brandGroundingMissing = brandBookSkipped && !ctx?.design_style_synthesis;

  return { referenceUrls, brandBookSkipped, brandGroundingMissing };
}

// ── Model routes ────────────────────────────────────────────────────────────
//
// Higgsfield model endpoints are account-specific ("Use the generation
// endpoint available to your account"), so the defaults below are overridable
// via env without a code change. Soul is the documented image default; the
// video route must be confirmed against the account's enabled models.

export function imageModelPath(): string {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("HIGGSFIELD_IMAGE_MODEL_PATH") || "/higgsfield-ai/soul/v2/standard";
}

export function videoModelPath(): string {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("HIGGSFIELD_VIDEO_MODEL_PATH") || "/higgsfield-ai/dop/v2/standard";
}

/**
 * Map the app's platform/format-derived aspect ratio (computed by the existing
 * getAspectRatio helpers) to the string Higgsfield expects. Higgsfield accepts
 * "W:H" strings, so this is a pass-through with a whitelist to catch garbage.
 */
const KNOWN_RATIOS = new Set(["1:1", "9:16", "16:9", "2:3", "3:2", "4:5", "5:4", "3:4", "4:3"]);

export function toHiggsfieldAspectRatio(ratio: string): string {
  return KNOWN_RATIOS.has(ratio) ? ratio : "1:1";
}
