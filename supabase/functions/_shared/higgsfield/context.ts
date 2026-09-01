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

export const MAX_REFERENCE_IMAGES = 4; // nano-banana takes up to 8 input images; 3 refs + brand book
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

/**
 * Appended to every prompt sent to a Higgsfield image route.
 *
 * WHY: the playbook's platform language ("cover slide in feed") can be read
 * as a scene to depict rather than constraints to follow — Soul did exactly
 * that, twice, rendering fake app chrome around the artwork (2026-09-01).
 * nano-banana interprets instructions correctly, but the guard stays: it is
 * cheap insurance against the same failure class on any model.
 */
export const CANVAS_ONLY_GUARD =
  "\n\n# FINAL RENDERING RULE\n" +
  "Render ONLY the post artwork itself: one full-bleed graphic that fills the entire canvas edge to edge. " +
  "The canvas IS the artwork.\n" +
  "Never render any of these: a phone frame or device mockup, an app window or browser window, " +
  "social-media interface elements (like/comment/share icons, follower counts, usernames, avatars, " +
  "status bars, navigation bars, captions below the image), watermarks, or any interface text.\n" +
  "Platform notes above describe where the artwork will be POSTED so you can design appropriately — " +
  "they are context, not something to depict.";

// ── Model routes ────────────────────────────────────────────────────────────
//
// Routes come from Higgsfield's published OpenAPI spec, corrected by live 422
// probing where the two disagree (they do; see git history for the list).
//
// IMAGE MODEL CHOICE — the build-review decision of 2026-09-01. Soul is
// Higgsfield's photorealism model; fed an 8k-character design-system brief it
// twice depicted the brief itself as a fake app interface. Our workload is
// graphic design (typography, panels, brand systems), and the right tool in
// Higgsfield's catalog is /nano-banana — the Gemini-class image model the
// prompt builder was originally tuned for, now routed and billed through
// Higgsfield. It also restores multi-reference conditioning (input_images up
// to 8, vs Soul's single reference) and native 4:5.
//   /nano-banana                 {prompt, aspect_ratio (incl 4:5, auto),
//                                 input_images[{type:"image_url",image_url}], output_format}
// DoP (video) is image-to-video only:
//   /higgsfield-ai/dop/standard  {prompt, image_url (REQUIRED), motions?, end_image_url?}
// Env overrides remain for account-specific swaps.

export function imageModelPath(): string {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  // Popcorn is the default because it lives in the /higgsfield-ai/* namespace
  // this account provably has (Soul and DoP both work), takes up to 8 plain
  // reference URLs, and is Higgsfield's ad/product-consistency model. Flip to
  // /nano-banana via the env override once it is enabled on the account —
  // it answered 404 model_not_found on 2026-09-01.
  return env?.get("HIGGSFIELD_IMAGE_MODEL_PATH") || "/higgsfield-ai/popcorn/auto";
}

export function videoModelPath(): string {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return env?.get("HIGGSFIELD_VIDEO_MODEL_PATH") || "/higgsfield-ai/dop/standard";
}

// ── Model adapter ────────────────────────────────────────────────────────────
//
// Every image model family speaks a slightly different dialect (typed
// input_images vs plain image_urls vs a single image_reference_url; different
// aspect enums; different quality knobs). This adapter is the ONE place that
// knows the dialects, so trying a different model is an env flip
// (HIGGSFIELD_IMAGE_MODEL_PATH), never a code change. Enums verified against
// the OpenAPI spec and corrected by live 422s where they disagreed.

const RATIOS: Record<string, Set<string>> = {
  nano: new Set(["auto", "1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9"]),
  popcorn: new Set(["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"]),
  soul: new Set(["9:16", "16:9", "4:3", "3:4", "1:1", "2:3", "3:2"]),
  reve: new Set(["1:1", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16"]),
};

function fitRatio(ratio: string, allowed: Set<string>): string {
  if (allowed.has(ratio)) return ratio;
  if (ratio === "4:5" && allowed.has("3:4")) return "3:4"; // nearest portrait
  if (ratio === "5:4" && allowed.has("4:3")) return "4:3";
  return "1:1";
}

/** Back-compat helper (tests, older call sites): maps against the widest enum. */
export function toHiggsfieldAspectRatio(ratio: string): string {
  return fitRatio(ratio, RATIOS.nano);
}

/** Build nano-banana's typed input_images array from resolved reference URLs. */
export function toInputImages(urls: string[]): Array<{ type: "image_url"; image_url: string }> {
  return urls.slice(0, 8).map((u) => ({ type: "image_url" as const, image_url: u }));
}

export interface ImageRequestArgs {
  prompt: string;
  aspectRatio: string;
  referenceUrls: string[];
}

/**
 * Build the {path, body} for an image generation against whatever model the
 * env selects. Reve is special-cased by reference count: /reve/remix demands
 * 2-4 image_urls, so one reference is doubled and zero references falls back
 * to /reve/text-to-image.
 */
export function buildImageRequest(
  modelPath: string,
  args: ImageRequestArgs,
): { path: string; body: Record<string, unknown> } {
  const refs = args.referenceUrls.slice(0, 8);

  if (modelPath.includes("nano-banana")) {
    const body: Record<string, unknown> = {
      prompt: args.prompt,
      aspect_ratio: fitRatio(args.aspectRatio, RATIOS.nano),
      output_format: "png",
    };
    if (refs.length > 0) body.input_images = toInputImages(refs);
    return { path: modelPath, body };
  }

  if (modelPath.includes("popcorn")) {
    const body: Record<string, unknown> = {
      prompt: args.prompt,
      aspect_ratio: fitRatio(args.aspectRatio, RATIOS.popcorn),
      resolution: "1600p",
    };
    if (refs.length > 0) body.image_urls = refs;
    return { path: modelPath, body };
  }

  if (modelPath.includes("reve")) {
    if (refs.length >= 1) {
      const imageUrls = refs.length === 1 ? [refs[0], refs[0]] : refs.slice(0, 4);
      return {
        path: "/reve/remix",
        body: {
          prompt: args.prompt,
          image_urls: imageUrls,
          aspect_ratio: fitRatio(args.aspectRatio, RATIOS.reve),
        },
      };
    }
    return {
      path: "/reve/text-to-image",
      body: { prompt: args.prompt },
    };
  }

  if (modelPath.includes("soul")) {
    if (refs.length > 0) {
      return {
        path: "/higgsfield-ai/soul/reference",
        body: {
          prompt: args.prompt,
          image_reference_url: refs[0],
          aspect_ratio: fitRatio(args.aspectRatio, RATIOS.soul),
          resolution: "1080p",
          style_strength: 1.0,
          enhance_prompt: false,
        },
      };
    }
    return {
      path: modelPath,
      body: {
        prompt: args.prompt,
        aspect_ratio: fitRatio(args.aspectRatio, RATIOS.soul),
        resolution: "1080p",
      },
    };
  }

  // Unknown family: send the universally-supported minimum.
  return {
    path: modelPath,
    body: { prompt: args.prompt, aspect_ratio: fitRatio(args.aspectRatio, RATIOS.soul) },
  };
}
