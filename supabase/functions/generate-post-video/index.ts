import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildVideoPrompt } from "../_shared/design-prompts/buildVideoPrompt.ts";
import { videoAspectRatio } from "../_shared/design-prompts/aspect.ts";
import { brandFootingAdvice, footingOf, resolveBrandContext } from "../_shared/design-prompts/resolveBrand.ts";
import { correctionFor, validateDesignImage, verdictIsDirty } from "../_shared/design-prompts/validateImage.ts";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";
import { loadDesignLearnings, type DesignLearnings } from "../_shared/design-prompts/learnings.ts";
import { headlineFrom } from "../_shared/design-prompts/headline.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { mediaBackendFor } from "../_shared/higgsfield/backend.ts";
import { HiggsfieldError } from "../_shared/higgsfield/generate.ts";
import { renderImageWithHiggsfield } from "../_shared/higgsfield/renderImage.ts";
import { startVideoWithHiggsfield } from "../_shared/higgsfield/renderVideo.ts";
import { resolveContextImageUrls } from "../_shared/higgsfield/context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};



// Try multiple Veo model names in order of preference
// Verified live 2026-09-06 against models.list: these are the video models the
// key can reach. veo-3-generate-preview and veo-2.0-generate-001 were also in
// this list and no longer exist, so every run ended on their 404.
const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
];

// Most to least permissive. "allow_all" is deliberately absent: the API answers
// "allow_all for personGeneration is currently not supported" (verified live
// 2026-09-06), and it being hardcoded is what silently broke video generation.
const PERSON_GENERATION = ["allow_adult", "dont_allow"];

/**
 * Generate a brand-aligned anchor still via Gemini 3.1 Flash Image, using
 * the FULL multimodal context (design references + brand book + brief).
 * Veo's `image` field on a `predictLongRunning` instance uses this still
 * as the starting frame / style anchor for the video — without it, Veo
 * gets only a text prompt and produces generic results.
 *
 * Returns null if any step fails — caller falls back to text-only Veo,
 * which preserves the previous behavior as a safety net.
 */
async function generateSeedImage(args: {
  geminiKey: string;
  supabase: any;
  basePrompt: string;
  platform?: string;
  format?: string;
  brandIdentity: any;
  synthesis: any;
  designReferences: string[];
  brandBookPath: string | null;
  post: any;
  variantAngle: string | null;
  aspectRatio: string;
  learnings?: DesignLearnings | null;
  /**
   * The words the frame carries. A video cannot have its headline typed on
   * afterwards the way a still can (Veo animates whatever the seed shows), so
   * the seed is a finished post: the headline set in the brand's headline
   * zone, spelled exactly, and nothing else written anywhere.
   */
  headline?: string | null;
  /**
   * An alternative renderer for the finished seed prompt. Higgsfield takes
   * references as signed urls of its own, so the inline-base64 assembly
   * below belongs to Gemini alone, and a provider that returns a job id
   * needs to hand that back so a clip can start from it.
   */
  renderWith?: (prompt: string) => Promise<{ base64: string; mimeType: string; jobId?: string | null } | null>;
}): Promise<{ base64: string; mimeType: string; jobId?: string | null } | null> {
  try {
    const headline = (args.headline || "").trim();
    const seedPrompt = buildImagePrompt({
      noText: !headline,
      basePrompt:
        args.basePrompt +
        "\n\nThis still will be used as the OPENING FRAME of a short social-media video — " +
        "compose for motion. Place the subject so it can move or transform without falling off frame. " +
        "It is a frame in the brand's own visual system for this platform: photographic where the brand uses " +
        "photography, a solid brand-colour field where the brand uses one, the brand's photo treatment either way. " +
        "Not a stock scene, not a title card: depict the subject inside the brand's layout." +
        (headline
          ? ` The frame is a FINISHED post: the headline is set in the brand's headline zone, in the brand's typographic treatment, ` +
            `large and fully legible, and reads exactly: "${headline}". Every letter spelled as written, no line broken mid-word, ` +
            `no other words, labels, captions or lettering anywhere else in the frame. Where the brand uses a text card, the card holds this headline and is not left empty.`
          : " Render no words anywhere in it."),
      platform: args.platform,
      format: args.format,
      brandIdentity: args.brandIdentity,
      synthesis: args.synthesis,
      post: args.post,
      variantAngle: args.variantAngle || undefined,
      learnings: args.learnings || null,
    });

    if (args.renderWith) return await args.renderWith(seedPrompt);

    const contentParts: any[] = [];

    // Attach design references as inline multimodal parts (same approach as
    // generate-post-image). Cap at 3 to keep payload sane.
    if (args.designReferences && args.designReferences.length > 0) {
      contentParts.push({
        text:
          "Existing brand design references — match their visual style, palette, " +
          "composition, and typography:",
      });
      for (const ref of args.designReferences.slice(0, 3)) {
        try {
          const { data: fileData } = await args.supabase.storage
            .from("design-references")
            .download(ref);
          if (fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) binary += String.fromCharCode(uint8Array[i]);
            const base64 = btoa(binary);
            const ext = ref.split(".").pop()?.toLowerCase();
            const mimeType = ext === "png" ? "image/png" : "image/jpeg";
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          }
        } catch (e) {
          console.warn("[generate-post-video] seed: ref download failed:", ref, e);
        }
      }
    }

    // Attach brand book if present and under 4MB.
    if (args.brandBookPath) {
      try {
        const { data: fileData } = await args.supabase.storage
          .from("brand-books")
          .download(args.brandBookPath);
        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          if (arrayBuffer.byteLength <= 4 * 1024 * 1024) {
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) binary += String.fromCharCode(uint8Array[i]);
            const base64 = btoa(binary);
            const ext = args.brandBookPath.split(".").pop()?.toLowerCase();
            const mimeType =
              ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
            contentParts.push({
              text: "Canonical brand book — defer to it on color, typography, and identity:",
            });
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          }
        }
      } catch (e) {
        console.warn("[generate-post-video] seed: brand book download failed:", e);
      }
    }

    contentParts.push({ text: seedPrompt });

    const apiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${args.geminiKey}`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: contentParts }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: args.aspectRatio, imageSize: "2K" },
        },
      }),
    });

    if (!response.ok) {
      const t = await response.text().catch(() => "");
      console.warn("[generate-post-video] seed: Gemini Flash Image error:", response.status, t.slice(0, 200));
      return null;
    }

    const result = await response.json();
    for (const candidate of result.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData?.data) {
          return {
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png",
          };
        }
      }
    }
    console.warn("[generate-post-video] seed: no inlineData in Gemini response");
    return null;
  } catch (e) {
    console.warn("[generate-post-video] seed generation threw:", e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // verify_jwt is off for this function, so nothing checks the caller
    // unless it does. It spends a Gemini key or the team's Higgsfield
    // credits on every call.
    const caller = await requireStaff(req);

    const {
      prompt,
      platform,
      format,
      brandIdentity,
      client_context,
      client_id,
      client_name,
      post,
      variant_angle,
    } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Same guarantee the still generator makes: resolve the brand from the
    // caller, fall back to the client row, and refuse rather than animate
    // generic stock footage for a client with nothing to design from.
    const brand = await resolveBrandContext({
      supabase,
      clientId: client_id,
      clientContext: client_context,
      legacy: { brandIdentity },
    });
    const footing = footingOf(brand);
    const resolvedBrand = brand.brandIdentity;
    const resolvedRefs = brand.designReferences;
    const resolvedBrandBookPath = brand.brandBookPath;
    const resolvedSynthesis = brand.synthesis;

    console.log("[generate-post-video] brand resolved:", {
      source: brand.source,
      footing: footing.strong ? "strong" : footing.weak ? "weak" : "none",
      gaps: footing.reasons,
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
    });

    // Thin brand material is reported, not fatal — see generate-post-image.
    const brandAdvice = brandFootingAdvice(footing, client_name);

    let geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .single();
      geminiKey = settings?.value;
    }

    // Which provider renders this, read from the clients row rather than the
    // body: a body-chosen provider would let any caller spend the team's
    // Higgsfield credits on any client.
    const backend = await mediaBackendFor(supabase, client_id || client_context?.client_id);
    console.log("[generate-post-video] backend:", backend);

    if (!geminiKey && backend === "gemini") {
      throw new Error("Gemini API key not configured");
    }

    const aspectRatio = videoAspectRatio(platform, format);

    // ── Step 1: Generate a brand-aligned anchor still via Gemini 3.1 Flash Image.
    // This still becomes Veo's `image` seed — without it, Veo only has the text
    // prompt and produces generic "AI-flavored" footage with no brand alignment.
    // With it, Veo animates from a frame that already encodes the brand's
    // palette, composition, typography, and design references.
    // The seed carries the post's headline so Veo animates a finished post,
    // not an empty layout waiting for words that will never come.
    const headline = headlineFrom(post?.copy || post?.hook || "");
    console.log("[generate-post-video] generating brand-aligned seed image…", { headline });

    // On the Higgsfield path the still is rendered by the same model the
    // design button uses, so the clip animates type that is actually legible.
    // Its job id comes back with it: Higgsfield takes one as the clip's start
    // frame directly, with no second upload.
    const higgsfieldSeed =
      backend === "higgsfield"
        ? async (seedPrompt: string) => {
            const { referenceUrls } = await resolveContextImageUrls(
              {
                design_references: resolvedRefs,
                brand_book_file_path: resolvedBrandBookPath,
                design_style_synthesis: resolvedSynthesis,
              },
              supabase,
            );
            // Budgeted, not open-ended. This runs at most twice (the seed
            // review can ask for one regeneration) and the clip submission
            // follows, all inside the 150 seconds the platform allows. A
            // measured run with one regeneration came in at 110s, so the
            // ceiling here is what keeps the worst case inside it.
            const still = await renderImageWithHiggsfield({
              supabase,
              prompt: seedPrompt,
              aspectRatio,
              referenceUrls,
              budgetMs: 55_000,
            });
            return { base64: still.imageB64, mimeType: still.imageMime, jobId: still.jobId };
          }
        : undefined;

    let seedImage = await generateSeedImage({
      geminiKey,
      supabase,
      renderWith: higgsfieldSeed,
      basePrompt: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      designReferences: resolvedRefs,
      brandBookPath: resolvedBrandBookPath,
      post,
      variantAngle: variant_angle || null,
      aspectRatio,
      learnings: await loadDesignLearnings(supabase, client_id || client_context?.client_id),
      headline,
    });
    if (seedImage) {
      console.log("[generate-post-video] seed image ready — Veo will animate from brand-aligned frame");
      // Veo treats the seed as visual ground truth, so an invented wordmark or
      // broken lettering on the anchor frame is carried through every frame of
      // the clip. Checking costs a couple of seconds against a Veo call that
      // costs minutes and real money, so it is worth one regeneration.
      const avoid = typeof resolvedSynthesis?.anti_patterns === "string" && resolvedSynthesis.anti_patterns.trim() ? resolvedSynthesis.anti_patterns.trim() : null;
      const verdict = await validateDesignImage(`data:${seedImage.mimeType};base64,${seedImage.base64}`, { avoid });
      if (verdictIsDirty(verdict, { expectNoText: !headline })) {
        console.warn("[generate-post-video] seed failed review, regenerating once:", verdict);
        const retry = await generateSeedImage({
          geminiKey,
          supabase,
          renderWith: higgsfieldSeed,
          basePrompt: prompt + correctionFor(verdict, { expectNoText: !headline, avoid }),
          headline,
          platform,
          format,
          brandIdentity: resolvedBrand,
          synthesis: resolvedSynthesis,
          designReferences: resolvedRefs,
          brandBookPath: resolvedBrandBookPath,
          post,
          variantAngle: variant_angle || null,
          aspectRatio,
        });
        if (retry) {
          seedImage = retry;
          console.log("[generate-post-video] seed regenerated after review");
        }
      }
    } else {
      console.warn(
        "[generate-post-video] seed image generation failed — falling back to text-only Veo. Output will be less brand-aligned.",
      );
    }

    // ── Step 2: Build the Veo prompt. When a seed image is present, the prompt
    // describes the MOTION the video should add to the still. Without one, it
    // describes the full scene.
    const enhancedPrompt = buildVideoPrompt({
      sceneDescription: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      post,
      variantAngle: variant_angle || null,
      hasSeedImage: !!seedImage,
      seedHasText: !!seedImage && !!headline,
    });

    // ── Higgsfield: submit and hand back a job.
    //
    // Measured on the team's account, a five-second clip takes about fourteen
    // minutes. Supabase kills this request at 150 seconds, so waiting here
    // would guarantee a spent generation that nobody can collect. The row is
    // written first, so a clip is never running with no record of it.
    if (backend === "higgsfield") {
      const seedPreview = seedImage ? `data:${seedImage.mimeType};base64,${seedImage.base64}` : null;
      const started = await startVideoWithHiggsfield({
        supabase,
        prompt: enhancedPrompt,
        aspectRatio,
        startImageId: seedImage?.jobId || null,
        seconds: 5,
      });

      const { data: jobRow, error: jobErr } = await supabase
        .from("media_jobs")
        .insert({
          client_id: client_id || client_context?.client_id || null,
          kind: "video",
          provider: "higgsfield",
          request_id: started.jobId,
          model_path: started.model,
          status: "submitted",
          // created_by defaults to auth.uid(), which is NULL under the
          // service role this function uses.
          created_by: caller.userId,
          input: { prompt: enhancedPrompt, aspect: started.aspect, seconds: 5, headline },
        })
        .select("id")
        .single();
      if (jobErr) {
        // The clip is already running and already charged. Say so rather
        // than pretending nothing happened.
        console.error("[generate-post-video] clip started but the job row failed:", jobErr.message);
        throw new Error(
          `The clip started but could not be recorded, so it cannot be collected (${jobErr.message}). Higgsfield job ${started.jobId}.`,
        );
      }

      return new Response(
        JSON.stringify({
          job_id: jobRow.id,
          status: "running",
          seed_image_url: seedPreview,
          seed_used: !!seedImage,
          brand_footing: footing.strong ? "strong" : footing.weak ? "weak" : "none",
          brand_advice: brandAdvice,
          rendered_by: "higgsfield",
          model: started.model,
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Try each Veo model until one works. Every failure is kept: the loop used
    // to overwrite a single lastError, so a real failure on the first model was
    // replaced by the last model's "not found" and the true cause was invisible.
    let operationName: string | null = null;
    const modelErrors: Array<{ model: string; status: number; error: string }> = [];

    for (const model of VEO_MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

      console.log(`Trying Veo model: ${model}`);

      const instance: any = { prompt: enhancedPrompt };
      if (seedImage) {
        // Image-to-video conditioning. Veo uses this as the starting frame
        // AND the style anchor for the generated clip.
        instance.image = {
          bytesBase64Encoded: seedImage.base64,
          mimeType: seedImage.mimeType,
        };
      }

      // personGeneration is the parameter most likely to be tightened by Google
      // without notice — "allow_all" was accepted for months and then was not,
      // which is what broke video generation. Try the permissive value we are
      // entitled to, and step down once if the API rejects it rather than
      // failing the whole run over one parameter.
      let started = false;
      for (const personGeneration of PERSON_GENERATION) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey,
          },
          body: JSON.stringify({
            instances: [instance],
            parameters: {
              aspectRatio,
              durationSeconds: 8,
              resolution: "720p",
              personGeneration,
            },
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.name) {
            operationName = data.name;
            console.log(`Veo operation started with ${model} (personGeneration=${personGeneration}): ${operationName}`);
            started = true;
            break;
          }
          modelErrors.push({ model: `${model}/${personGeneration}`, status: 200, error: "no operation name in response" });
          continue;
        }

        const body = await response.text().catch(() => "");
        modelErrors.push({ model: `${model}/${personGeneration}`, status: response.status, error: body.slice(0, 400) });
        console.error(`Veo ${model} (personGeneration=${personGeneration}) failed (${response.status}): ${body.slice(0, 400)}`);
        // Only a personGeneration complaint is worth stepping down for; any
        // other failure is about this model and the next value will not help.
        if (!/persongeneration/i.test(body)) break;
      }
      if (started) break;
    }

    if (!operationName) {
      const detail = modelErrors
        .map((e) => `${e.model} → ${e.status}: ${e.error.replace(/\s+/g, " ").slice(0, 200)}`)
        .join(" | ");
      console.error("[generate-post-video] every Veo model failed:", JSON.stringify(modelErrors));
      throw new Error(
        `Video generation failed — no Veo model accepted the request ` +
        `(seed image ${seedImage ? "was" : "was NOT"} attached). ${detail}`,
      );
    }

    // Poll for completion (Veo is async — takes 30-120 seconds)
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes at 2-second intervals

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      attempts++;

      const pollResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
        {
          headers: { "x-goog-api-key": geminiKey },
        }
      );

      if (!pollResponse.ok) {
        console.error(`Poll failed (attempt ${attempts}): ${pollResponse.status}`);
        continue;
      }

      const pollData = await pollResponse.json();

      if (pollData.done) {
        // Extract video URI from response
        const videoUri =
          pollData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
          pollData.response?.generatedSamples?.[0]?.video?.uri;

        if (videoUri) {
          // The video URI requires the API key to access
          const authenticatedUrl = videoUri.includes("?")
            ? `${videoUri}&key=${geminiKey}`
            : `${videoUri}?key=${geminiKey}`;

          // Return diagnostic info too: whether the seed image was generated
          // and a data-URL preview of it. If the user reports the video looks
          // off-brand, comparing the seed image tells us whether the issue
          // is upstream (seed was generic) or downstream (Veo ignored a good
          // seed). Without this we have no visibility into the chain.
          const seedPreview = seedImage
            ? `data:${seedImage.mimeType};base64,${seedImage.base64}`
            : null;

          return new Response(
            JSON.stringify({
              video_url: authenticatedUrl,
              seed_image_url: seedPreview,
              seed_used: !!seedImage,
              brand_footing: footing.strong ? "strong" : footing.weak ? "weak" : "none",
              brand_advice: brandAdvice,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check for errors in the completed operation
        if (pollData.error) {
          throw new Error(`Video generation error: ${JSON.stringify(pollData.error)}`);
        }

        throw new Error(
          "Operation completed but no video URL found in response: " +
          JSON.stringify(pollData.response || pollData).slice(0, 300)
        );
      }

      console.log(`Polling attempt ${attempts}/${maxAttempts}...`);
    }

    throw new Error("Video generation timed out after 3 minutes. Please try again.");
  } catch (error: any) {
    console.error("Error generating video:", error);
    const status = error instanceof AuthzError ? error.status : error instanceof HiggsfieldError ? 502 : 500;
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
