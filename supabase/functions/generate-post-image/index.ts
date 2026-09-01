import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";
import {
  HiggsfieldError,
  pollUntilTerminal,
  submit,
} from "../_shared/higgsfield/client.ts";
import {
  imageModelPath,
  imageReferenceModelPath,
  imageResolution,
  resolveContextImageUrls,
  toHiggsfieldAspectRatio,
} from "../_shared/higgsfield/context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Image generation is fast enough to stay synchronous from the caller's point
// of view: submit to Higgsfield, poll, return. Video (a much longer job) uses
// the media_jobs + webhook path instead.
const IMAGE_POLL_TIMEOUT_MS = 120_000;

/** Map platform + format → aspect ratio (unchanged from the Gemini version). */
function getAspectRatio(platform?: string, format?: string): string {
  if (!platform) return "1:1";
  const p = (platform + " " + (format || "")).toLowerCase();
  if (p.includes("story") || p.includes("reel") || p.includes("tiktok")) return "9:16";
  if (p.includes("linkedin") || p.includes("article")) return "16:9";
  if (p.includes("pinterest")) return "2:3";
  return "1:1";
}

/**
 * Ask Claude Haiku vision whether the image is a single composition or a
 * multi-panel layout. Used after generation to detect carousel slide calls
 * that came back as contact sheets. Returns isContactSheet=false on any
 * error (don't block the response).
 */
async function detectContactSheet(
  imageB64: string,
  mimeType: string,
  anthropicKey: string,
): Promise<{ isContactSheet: boolean; reason: string; raw: string }> {
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system:
          "You are a strict visual classifier for social-media graphics. Output JSON only.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: imageB64 },
              },
              {
                type: "text",
                text:
                  `Classify this image:\n\n` +
                  `- "single" = ONE continuous composition filling the entire canvas. Like a magazine cover, an editorial poster, a single product shot, or a single illustration. One headline, one subject, one background.\n` +
                  `- "multi" = Divided into MULTIPLE visually distinct regions, each with its own headline/content/background/border. A contact sheet, storyboard, slide deck preview, comparison grid, or infographic with multiple sub-panels.\n\n` +
                  `If the image has 2+ visually distinct sections that each look like their own separate slide or card, it's "multi".\n\n` +
                  `Output exactly this JSON, nothing else:\n` +
                  `{"layout": "single" | "multi", "reason": "one short sentence"}`,
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return { isContactSheet: false, reason: `validation API error ${resp.status}`, raw: t.slice(0, 200) };
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { isContactSheet: false, reason: "no JSON in validation response", raw: text };

    const parsed = JSON.parse(match[0]);
    return {
      isContactSheet: parsed.layout === "multi",
      reason: parsed.reason || "unknown",
      raw: text,
    };
  } catch (e: any) {
    return { isContactSheet: false, reason: `validation threw: ${e.message}`, raw: "" };
  }
}

/**
 * Build a stripped-down POSITIVE-ONLY retry prompt for when validation
 * detected a contact sheet. No "don't" instructions — just one explicit
 * "render this single subject filling the canvas" directive. LLMs follow
 * positive instructions far more reliably than negative ones.
 */
function buildStrippedRetryPrompt(args: {
  originalBrief: string;
  aspectRatio: string;
  brandSynthesis: any;
}): string {
  // Take just the first non-empty sentence of the brief as the "subject".
  // Multi-concept briefs become collapsed to their first idea — by design.
  const cleanedBrief = args.originalBrief
    .replace(/^Headline:\s*/i, "")
    .replace(/\n+/g, " ")
    .trim();
  const firstSentence =
    cleanedBrief.match(/^[^.!?]+[.!?]/)?.[0]?.trim() ||
    cleanedBrief.slice(0, 240).trim();

  // Brand color hint without hex codes — pulled qualitatively from synthesis.
  const colorHint = (() => {
    const s = args.brandSynthesis || {};
    const fragments: string[] = [];
    if (s.color_usage) fragments.push(s.color_usage);
    if (s.color_palette_qualitative) fragments.push(s.color_palette_qualitative);
    return fragments.join(" ").slice(0, 240) || "use the brand's primary colors";
  })();

  return [
    `# RENDER A SINGLE EDITORIAL POSTER`,
    ``,
    `Render ONE single visual subject filling the entire ${args.aspectRatio} canvas, edge to edge.`,
    `Composition: a single subject dominates the frame, magazine-cover style. ONE headline. ONE supporting visual element. No panel borders, no internal section dividers, no slide labels.`,
    ``,
    `Subject: ${firstSentence}`,
    ``,
    `Color treatment: ${colorHint}. No hex codes or RGB values visible as text.`,
    ``,
    `Think of this output like a standalone Instagram cover or a single magazine cover — NOT a slide deck or contact sheet. The canvas contains exactly ONE composition with ONE focal point.`,
  ].join("\n");
}

/**
 * Run one Higgsfield image generation and download the first output.
 * Higgsfield CDN URLs expire after ~7 days, so the bytes come back to us and
 * the response stays a data URL, exactly like the Gemini version — the
 * frontend then persists via upload-generated-media as before.
 */
async function generateImage(args: {
  prompt: string;
  aspectRatio: string;
  referenceUrls: string[];
}): Promise<{ base64: string; mimeType: string }> {
  // Soul splits by input shape (see context.ts): a style reference means the
  // /reference route with ONE image_reference_url; otherwise plain /standard.
  // The first resolved URL is the primary design reference by construction.
  const ratio = toHiggsfieldAspectRatio(args.aspectRatio);
  const useReference = args.referenceUrls.length > 0;
  const modelPath = useReference ? imageReferenceModelPath() : imageModelPath();
  const body: Record<string, unknown> = useReference
    ? {
        prompt: args.prompt,
        image_reference_url: args.referenceUrls[0],
        aspect_ratio: ratio,
        resolution: imageResolution(),
        style_strength: 0.8,
      }
    : {
        prompt: args.prompt,
        aspect_ratio: ratio,
        resolution: imageResolution(),
      };

  const submission = await submit(modelPath, body);
  console.log("[generate-post-image] higgsfield request:", submission.request_id);

  const result = await pollUntilTerminal(submission.status_url, {
    timeoutMs: IMAGE_POLL_TIMEOUT_MS,
  });

  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) {
    throw new HiggsfieldError(
      "upstream_error",
      "Completed without an image URL: " + JSON.stringify(result).slice(0, 300),
      { requestId: result.request_id },
    );
  }

  const dl = await fetch(imageUrl);
  if (!dl.ok) {
    throw new HiggsfieldError(
      "upstream_error",
      `Could not download generated image (${dl.status})`,
      { requestId: result.request_id },
    );
  }
  const mimeType = dl.headers.get("content-type") || "image/jpeg";
  const buf = new Uint8Array(await dl.arrayBuffer());
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return { base64: btoa(binary), mimeType };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      prompt,
      platform,
      format,
      brand_context,                  // legacy
      design_references,              // legacy
      brand_book_file_path,           // legacy
      client_context,                 // new — full structured context
      post,                           // new — post-level brief
      slide_context,                  // new — { index, total } for carousels
      variant_angle,                  // new — creative angle override (Phase 6)
    } = await req.json();

    // Backward compat: resolve from client_context if present, else legacy fields.
    const resolvedBrand = client_context?.brand_identity ?? brand_context ?? null;
    const resolvedRefs: string[] = client_context?.design_references ?? design_references ?? [];
    const resolvedBrandBookPath: string | null =
      client_context?.brand_book_file_path ?? brand_book_file_path ?? null;
    const resolvedSynthesis = client_context?.design_style_synthesis ?? null;
    const resolvedPillars = client_context?.content_pillars ?? [];
    const resolvedBriefText: string | null = client_context?.brief_text ?? null;
    const resolvedBrandNotes: string | null = client_context?.brand_notes ?? null;
    const resolvedLanguages: string[] = client_context?.languages ?? [];
    const resolvedGeo: string[] = client_context?.geo ?? [];

    console.log("[generate-post-image] context received:", {
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
      pillar_count: resolvedPillars.length,
      has_brief: !!resolvedBriefText,
    });

    if (!prompt) {
      return jsonResp({ error: "prompt is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Build the design prompt (same builder as before) ──
    const aspectRatio = getAspectRatio(platform, format);
    const designPrompt = buildImagePrompt({
      basePrompt: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      pillars: resolvedPillars,
      briefText: resolvedBriefText,
      brandNotes: resolvedBrandNotes,
      languages: resolvedLanguages,
      geo: resolvedGeo,
      post,
      slideContext: slide_context,
      variantAngle: variant_angle || null,
    });

    console.log("[generate-post-image] prompt (first 2000 chars):", designPrompt.slice(0, 2000));
    console.log("[generate-post-image] prompt total length:", designPrompt.length);

    // ── Resolve visual references to signed URLs Higgsfield can fetch ──
    // Replaces the inline-base64 multimodal parts of the Gemini path. A PDF
    // brand book cannot cross (Higgsfield accepts images only); its influence
    // arrives via design_style_synthesis inside the prompt.
    const resolved = await resolveContextImageUrls(
      {
        design_references: resolvedRefs,
        brand_book_file_path: resolvedBrandBookPath,
        design_style_synthesis: resolvedSynthesis,
      },
      supabase,
    );
    if (resolved.brandGroundingMissing) {
      console.warn(
        "[generate-post-image] brand book is PDF-only and no design_style_synthesis exists — " +
          "output will be less brand-aligned. Run synthesize-design-language for this client.",
      );
    }

    // ── Generate ──
    let { base64: imageB64, mimeType: imageMime } = await generateImage({
      prompt: designPrompt,
      aspectRatio,
      referenceUrls: resolved.referenceUrls,
    });

    // ── Carousel single-slide validation + retry ──
    //
    // When this call is for ONE slide of an N-slide carousel and the brief is
    // rich enough to describe multiple concepts, image models sometimes compose
    // a contact sheet anyway. Verify the output via Claude vision and, if it's
    // a contact sheet, retry once with a stripped-down positive-only prompt.
    let wasRetried = false;
    let validationLayout: "single" | "multi" | "skipped" = "skipped";
    let validationReason = "";

    if (slide_context && imageB64 && imageMime) {
      // Need an Anthropic key for validation. Try env first, then app_settings.
      let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicKey) {
        const { data: s } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "anthropic_api_key")
          .maybeSingle();
        anthropicKey = s?.value;
      }

      if (anthropicKey) {
        const validation = await detectContactSheet(imageB64, imageMime, anthropicKey);
        validationLayout = validation.isContactSheet ? "multi" : "single";
        validationReason = validation.reason;
        console.log(
          `[generate-post-image] carousel slide validation: layout=${validationLayout} reason="${validationReason}"`,
        );

        if (validation.isContactSheet) {
          console.warn("[generate-post-image] contact sheet detected — retrying with stripped prompt");
          const retryPrompt = buildStrippedRetryPrompt({
            originalBrief: prompt,
            aspectRatio,
            brandSynthesis: resolvedSynthesis,
          });
          console.log("[generate-post-image] retry prompt (first 600 chars):", retryPrompt.slice(0, 600));

          try {
            // Retry drops the reference images too — matching the old stripped
            // retry, which sent a bare prompt to maximize the odds of a single
            // clean composition.
            const retry = await generateImage({
              prompt: retryPrompt,
              aspectRatio,
              referenceUrls: [],
            });
            imageB64 = retry.base64;
            imageMime = retry.mimeType;
            wasRetried = true;
            console.log("[generate-post-image] retry produced a new image");
          } catch (e) {
            console.warn("[generate-post-image] retry failed; keeping original:", e);
          }
        }
      } else {
        console.log("[generate-post-image] no Anthropic key — skipping carousel validation");
      }
    }

    const imageUrl = `data:${imageMime};base64,${imageB64}`;

    return jsonResp({
      image_url: imageUrl,
      // Higgsfield does not return a revised prompt the way Gemini's text part
      // did; keep the field for contract stability.
      revised_prompt: null,
      // Diagnostics so the frontend can show "this slide was auto-fixed" etc.
      was_retried: wasRetried,
      validation_layout: validationLayout,
      validation_reason: validationReason,
    });
  } catch (err: any) {
    if (err instanceof HiggsfieldError) {
      console.error("[generate-post-image] higgsfield error:", err.code, err.message);
      const status =
        err.code === "concurrency_exhausted" ? 429 :
        err.code === "moderated" ? 422 :
        err.code === "timeout" ? 504 : 502;
      return jsonResp({ error: err.userMessage, code: err.code, detail: err.message.slice(0, 400) }, status);
    }
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
