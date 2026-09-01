import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Map platform + format → Gemini native aspect ratio */
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

    if (!geminiKey) {
      return jsonResp(
        {
          error:
            "Gemini API key not configured. Add GEMINI_API_KEY to your Supabase environment secrets or add a row with key='gemini_api_key' to the app_settings table.",
        },
        400,
      );
    }

    // ── Build the design prompt ──
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

    // ── Fetch design reference images for multimodal input ──
    const contentParts: any[] = [];

    if (resolvedRefs && Array.isArray(resolvedRefs) && resolvedRefs.length > 0) {
      const storageClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      contentParts.push({ text: "Here are existing brand design references. Match their visual style, layout patterns, and color usage:" });

      for (const ref of resolvedRefs.slice(0, 3)) {
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

    // ── Call Gemini 3.1 Flash Image (Nano Banana 2) ──
    const geminiModel = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: contentParts,
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: "2K",
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return jsonResp({ error: `Gemini API error: ${response.status}`, details: errorBody }, 502);
    }

    const result = await response.json();

    // ── Extract image from response ──
    const candidates = result.candidates || [];
    let imageB64: string | null = null;
    let imageMime: string | null = null;
    let textResponse: string | null = null;

    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          imageB64 = part.inlineData.data;
          imageMime = part.inlineData.mimeType || "image/png";
        }
        if (part.text) {
          textResponse = part.text;
        }
      }
    }

    if (!imageB64) {
      return jsonResp(
        {
          error: "No image generated. The model may have refused the prompt or returned text only.",
          details: textResponse || JSON.stringify(result).slice(0, 500),
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

          const retryParts: any[] = [{ text: retryPrompt }];
          const retryResp = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: retryParts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio, imageSize: "2K" },
              },
            }),
          });

          if (retryResp.ok) {
            const retryResult = await retryResp.json();
            for (const candidate of retryResult.candidates || []) {
              for (const part of candidate.content?.parts || []) {
                if (part.inlineData) {
                  imageB64 = part.inlineData.data;
                  imageMime = part.inlineData.mimeType || "image/png";
                  wasRetried = true;
                }
              }
            }
            if (wasRetried) {
              console.log("[generate-post-image] retry produced a new image");
            } else {
              console.warn("[generate-post-image] retry returned no image; keeping original");
            }
          } else {
            const t = await retryResp.text().catch(() => "");
            console.warn("[generate-post-image] retry failed:", retryResp.status, t.slice(0, 200));
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
    });
  } catch (err: any) {
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

