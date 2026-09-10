import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";
import { loadDesignLearnings } from "../_shared/design-prompts/learnings.ts";
import { imageAspectRatio } from "../_shared/design-prompts/aspect.ts";
import { brandFootingAdvice, footingOf, resolveBrandContext } from "../_shared/design-prompts/resolveBrand.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { mediaBackendFor } from "../_shared/higgsfield/backend.ts";
import { renderImageWithHiggsfield } from "../_shared/higgsfield/renderImage.ts";
import { HiggsfieldError } from "../_shared/higgsfield/generate.ts";
import { resolveContextImageUrls } from "../_shared/higgsfield/context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Map platform + format → Gemini native aspect ratio */


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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // This function runs with verify_jwt = false, so nothing checks the caller
    // unless it does so itself. It spends money on every call — a Gemini key,
    // or the team's Higgsfield credits — so it checks.
    await requireStaff(req);

    const {
      prompt,
      platform,
      format,
      brand_context,                  // legacy
      design_references,              // legacy
      brand_book_file_path,           // legacy
      client_context,                 // new — full structured context
      client_id,                      // new — lets the function read the brand itself
      client_name,
      post,                           // new — post-level brief
      slide_context,                  // new — { index, total } for carousels
      variant_angle,                  // new — creative angle override (Phase 6)
      render_text,                    // false → imagery only; the app types the words on top
    } = await req.json();

    if (!prompt) {
      return jsonResp({ error: "prompt is required" }, 400);
    }

    // Resolve the brand from the caller, falling back to the client row. A call
    // that arrives without context used to generate a perfectly generic image
    // and say nothing about it.
    const brandDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const brand = await resolveBrandContext({
      supabase: brandDb,
      clientId: client_id,
      clientContext: client_context,
      legacy: {
        brandIdentity: brand_context,
        designReferences: design_references,
        brandBookPath: brand_book_file_path,
      },
    });
    const footing = footingOf(brand);

    const resolvedBrand = brand.brandIdentity;
    const resolvedRefs: string[] = brand.designReferences;
    const resolvedBrandBookPath: string | null = brand.brandBookPath;
    const resolvedSynthesis = brand.synthesis;
    const resolvedPillars = brand.pillars;
    const resolvedBriefText: string | null = brand.briefText;
    const resolvedBrandNotes: string | null = brand.brandNotes;
    const resolvedLanguages: string[] = brand.languages;
    const resolvedGeo: string[] = brand.geo;

    console.log("[generate-post-image] brand resolved:", {
      source: brand.source,
      footing: footing.strong ? "strong" : footing.weak ? "weak" : "none",
      gaps: footing.reasons,
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
      pillar_count: resolvedPillars.length,
      has_brief: !!resolvedBriefText,
    });

    // Thin or missing brand material does not stop the run — a draft beats a
    // refusal — but the caller is told so nobody mistakes generic art for
    // on-brand work, and is pointed at the fix.
    const brandAdvice = brandFootingAdvice(footing, client_name);

    // Which provider renders this. Read from the clients row, never from the
    // body: this endpoint spends the team's Higgsfield credits.
    const backend = await mediaBackendFor(brandDb, client_id || client_context?.client_id);
    console.log("[generate-post-image] backend:", backend);

    // ── Get Gemini API key (try env, then app_settings) ──
    let geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");

    if (!geminiKey) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // Try gemini key first, then google key
      for (const keyName of ["gemini_api_key", "google_ai_api_key"]) {
        const { data: setting } = await supabase.from("app_settings").select("value").eq("key", keyName).maybeSingle();
        if (setting?.value) {
          geminiKey = setting.value;
          break;
        }
      }
    }

    if (!geminiKey && backend === "gemini") {
      return jsonResp(
        {
          error:
            "Gemini API key not configured. Add GEMINI_API_KEY to your Supabase environment secrets or add a row with key='gemini_api_key' to the app_settings table.",
        },
        400,
      );
    }

    // ── Build the design prompt ──
    const aspectRatio = imageAspectRatio(platform, format);
    // Rules learned from this client's rejected designs, if any.
    const learnings = await loadDesignLearnings(brandDb, client_id || client_context?.client_id);
    const designPrompt = buildImagePrompt({
      basePrompt: prompt,
      noText: render_text === false,
      learnings,
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

    // ── Fetch design reference images for multimodal input ──
    const contentParts: any[] = [];

    if (resolvedRefs && Array.isArray(resolvedRefs) && resolvedRefs.length > 0) {
      const storageClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      contentParts.push({
        text:
          "These are the client's own published designs. Match their visual SYSTEM exactly — the same layout zones, " +
          "the same colour fields in the same proportions, the same photographic treatment, the same placement of type — " +
          "so the new image looks like the same designer made it. Do not copy their photographs or their words; " +
          "do reproduce their system. Ignore any logo, monogram, watermark or lockup you see in them: this image has none.",
      });

      for (const ref of resolvedRefs.slice(0, 4)) {
        try {
          const { data: fileData } = await storageClient.storage.from("design-references").download(ref);
          if (fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const ext = ref.split(".").pop()?.toLowerCase();
            const mimeType = ext === "png" ? "image/png" : "image/jpeg";
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          }
        } catch (e) {
          console.error("Failed to fetch design reference:", ref, e);
        }
      }

      contentParts.push({ text: "Now create a new design based on this brief:" });
    }

    // Attach the brand book file as an inline part. Gemini 3.1 supports inline PDF/PNG/JPG.
    if (resolvedBrandBookPath) {
      try {
        const storageClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: fileData } = await storageClient.storage
          .from("brand-books")
          .download(resolvedBrandBookPath);

        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          if (arrayBuffer.byteLength <= 4 * 1024 * 1024) {
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const ext = resolvedBrandBookPath.split(".").pop()?.toLowerCase();
            const mimeType =
              ext === "pdf"
                ? "application/pdf"
                : ext === "png"
                ? "image/png"
                : "image/jpeg";
            contentParts.push({
              text: "Canonical brand book — defer to it on color, typography, and overall identity:",
            });
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          } else {
            console.warn("[generate-post-image] brand book exceeds 4MB, skipping");
          }
        }
      } catch (e) {
        console.error("[generate-post-image] brand book attach failed:", e);
      }
    }

    // Add the main design prompt
    contentParts.push({ text: designPrompt });

    // ── Render the image ──
    //
    // Two providers, one output shape: base64 bytes and a mime type. Nothing
    // below this block knows or cares which one ran.
    const geminiModel = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    let imageB64: string | null = null;
    let imageMime: string | null = null;
    let textResponse: string | null = null;
    let renderedModel: string | null = null;

    /** One Gemini call. Returns the LAST inline image across all candidates. */
    async function callGemini(parts: any[]): Promise<{ b64: string | null; mime: string | null; text: string | null; raw: any }> {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: aspectRatio, imageSize: "2K" },
          },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw new Error(`Gemini API error: ${response.status} ${errorBody.slice(0, 300)}`);
      }
      const raw = await response.json();
      let b64: string | null = null;
      let mime: string | null = null;
      let text: string | null = null;
      for (const candidate of raw.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData) {
            b64 = part.inlineData.data;
            mime = part.inlineData.mimeType || "image/png";
          }
          if (part.text) text = part.text;
        }
      }
      return { b64, mime, text, raw };
    }

    /**
     * A second attempt from a stripped prompt, with no references attached.
     * Used by the carousel contact-sheet retry, which must not silently stay
     * on Gemini when the client is on the other backend.
     */
    async function renderFromPromptAlone(promptText: string): Promise<{ b64: string; mime: string } | null> {
      if (backend === "higgsfield") {
        const again = await renderImageWithHiggsfield({
          supabase: brandDb,
          prompt: promptText,
          aspectRatio,
          referenceUrls: [],
          budgetMs: 60_000,
        });
        return { b64: again.imageB64, mime: again.imageMime };
      }
      const out = await callGemini([{ text: promptText }]);
      return out.b64 && out.mime ? { b64: out.b64, mime: out.mime } : null;
    }

    let rawResult: any = null;
    if (backend === "higgsfield") {
      // Higgsfield takes references as signed https urls rather than inline
      // bytes, so the contentParts assembled above are not used on this path.
      const { referenceUrls, brandGroundingMissing } = await resolveContextImageUrls(
        {
          design_references: resolvedRefs,
          brand_book_file_path: resolvedBrandBookPath,
          design_style_synthesis: resolvedSynthesis,
        },
        brandDb,
      );
      if (brandGroundingMissing) {
        console.warn("[generate-post-image] brand book cannot cross to Higgsfield and there is no synthesis to stand in");
      }
      const rendered = await renderImageWithHiggsfield({
        supabase: brandDb,
        prompt: designPrompt,
        aspectRatio,
        referenceUrls,
      });
      imageB64 = rendered.imageB64;
      imageMime = rendered.imageMime;
      textResponse = rendered.textResponse;
      renderedModel = rendered.model;
      console.log("[generate-post-image] higgsfield rendered with", renderedModel, "credits before:", rendered.creditsBefore);
    } else {
      const out = await callGemini(contentParts);
      imageB64 = out.b64;
      imageMime = out.mime;
      textResponse = out.text;
      renderedModel = geminiModel;
      rawResult = out.raw;
    }

    if (!imageB64) {
      return jsonResp(
        {
          error: "No image generated. The model may have refused the prompt or returned text only.",
          details: textResponse || JSON.stringify(rawResult).slice(0, 500),
        },
        500,
      );
    }

    // ── Carousel single-slide validation + retry ──
    //
    // When this call is for ONE slide of an N-slide carousel and the brief is
    // rich enough to describe multiple concepts, Gemini sometimes composes a
    // contact sheet anyway. The previous "DO NOT" instructions weren't strong
    // enough — so now we VERIFY the output via Claude vision and, if it's a
    // contact sheet, retry once with a stripped-down positive-only prompt that
    // says "render ONE subject filling the canvas" without any multi-section
    // brief content.
    let wasRetried = false;
    let validationLayout: "single" | "multi" | "skipped" = "skipped";
    let validationReason = "";

    if (slide_context && imageB64 && imageMime) {
      // Need an Anthropic key for validation. Try env first, then app_settings.
      let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropicKey) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data: s } = await sb
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
            const again = await renderFromPromptAlone(retryPrompt);
            if (again) {
              imageB64 = again.b64;
              imageMime = again.mime;
              wasRetried = true;
              console.log("[generate-post-image] retry produced a new image");
            } else {
              console.warn("[generate-post-image] retry returned no image; keeping original");
            }
          } catch (e) {
            // The first image is imperfect, not unusable. Keep it.
            console.warn("[generate-post-image] retry failed; keeping original:", e instanceof Error ? e.message : e);
          }
        }
      } else {
        console.log("[generate-post-image] no Anthropic key — skipping carousel validation");
      }
    }

    const imageUrl = `data:${imageMime};base64,${imageB64}`;

    return jsonResp({
      image_url: imageUrl,
      revised_prompt: textResponse,
      // Diagnostics so the frontend can show "this slide was auto-fixed" etc.
      was_retried: wasRetried,
      validation_layout: validationLayout,
      validation_reason: validationReason,
      brand_footing: footing.strong ? "strong" : footing.weak ? "weak" : "none",
      brand_advice: brandAdvice,
      rendered_by: backend,
      model: renderedModel,
    });
  } catch (err: any) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    if (err instanceof HiggsfieldError) return jsonResp({ error: err.message }, 502);
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

