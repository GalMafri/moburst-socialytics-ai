import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildVideoPrompt } from "../_shared/design-prompts/buildVideoPrompt.ts";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getAspectRatio(platform?: string, format?: string): string {
  const fmt = (format || "").toLowerCase();
  const plat = (platform || "").toLowerCase();

  if (fmt.includes("story") || fmt.includes("reel") || plat === "tiktok") return "9:16";
  if (plat === "linkedin" || fmt.includes("article")) return "16:9";
  if (plat === "youtube") return "16:9";
  return "9:16";
}

// Try multiple Veo model names in order of preference
const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3-generate-preview",
  "veo-2.0-generate-001",
];

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
  pillars: Array<{ name: string; description: string }>;
  briefText: string | null;
  brandNotes: string | null;
  languages: string[];
  geo: string[];
  post: any;
  variantAngle: string | null;
  aspectRatio: string;
}): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // The seed call now mirrors a working generate-post-image call: same
    // builder, same context fields, NO motion-framing wrapper. The previous
    // appendix ("This still will be used as the OPENING FRAME ... compose for
    // motion") was the only divergence from the working image path. Veo
    // controls motion via its own prompt; the seed just needs to be brand-
    // aligned, exactly like a regular brand image.
    const seedPrompt = buildImagePrompt({
      basePrompt: args.basePrompt,
      platform: args.platform,
      format: args.format,
      brandIdentity: args.brandIdentity,
      synthesis: args.synthesis,
      pillars: args.pillars,
      briefText: args.briefText,
      brandNotes: args.brandNotes,
      languages: args.languages,
      geo: args.geo,
      post: args.post,
      variantAngle: args.variantAngle || undefined,
    });

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
    const {
      prompt,
      platform,
      format,
      brandIdentity,
      brand_context,          // legacy — top-level brand object
      design_references,      // legacy — top-level array of storage paths
      brand_book_file_path,   // legacy — top-level brand book path
      client_context,
      post,
      variant_angle,
    } = await req.json();

    // Resolve from client_context first, fall back to legacy top-level fields.
    // generate-post-image already has this fallback chain; without it here,
    // callers that hadn't migrated to client_context produced un-anchored
    // seeds → text-only Veo → generic stock footage.
    const resolvedBrand = client_context?.brand_identity ?? brandIdentity ?? brand_context ?? null;
    const resolvedRefs: string[] = client_context?.design_references ?? design_references ?? [];
    const resolvedBrandBookPath: string | null =
      client_context?.brand_book_file_path ?? brand_book_file_path ?? null;
    const resolvedSynthesis = client_context?.design_style_synthesis ?? null;
    // Same extended context the image function uses — without these the seed
    // prompt is materially weaker than a regular brand image prompt.
    const resolvedPillars = client_context?.content_pillars ?? [];
    const resolvedBriefText: string | null = client_context?.brief_text ?? null;
    const resolvedBrandNotes: string | null = client_context?.brand_notes ?? null;
    const resolvedLanguages: string[] = client_context?.languages ?? [];
    const resolvedGeo: string[] = client_context?.geo ?? [];

    console.log("[generate-post-video] context received:", {
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
      pillar_count: resolvedPillars.length,
      has_brief: !!resolvedBriefText,
      has_brand_notes: !!resolvedBrandNotes,
      lang_count: resolvedLanguages.length,
      using_legacy_fallback:
        !client_context && (!!brand_context || (design_references?.length ?? 0) > 0),
    });

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .single();
      geminiKey = settings?.value;
    }

    if (!geminiKey) {
      throw new Error("Gemini API key not configured");
    }

    const aspectRatio = getAspectRatio(platform, format);

    // ── Step 1: Generate a brand-aligned anchor still via Gemini 3.1 Flash Image.
    // This still becomes Veo's `image` seed — without it, Veo only has the text
    // prompt and produces generic "AI-flavored" footage with no brand alignment.
    // With it, Veo animates from a frame that already encodes the brand's
    // palette, composition, typography, and design references.
    console.log("[generate-post-video] generating brand-aligned seed image…");
    const seedImage = await generateSeedImage({
      geminiKey,
      supabase,
      basePrompt: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      designReferences: resolvedRefs,
      brandBookPath: resolvedBrandBookPath,
      pillars: resolvedPillars,
      briefText: resolvedBriefText,
      brandNotes: resolvedBrandNotes,
      languages: resolvedLanguages,
      geo: resolvedGeo,
      post,
      variantAngle: variant_angle || null,
      aspectRatio,
    });
    if (seedImage) {
      console.log("[generate-post-video] seed image ready — Veo will animate from brand-aligned frame");
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
    });

    // Try each Veo model until one works
    let operationName: string | null = null;
    let lastError = "";

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
            personGeneration: "allow_all",
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.name) {
          operationName = data.name;
          console.log(`Veo operation started with model ${model}: ${operationName}`);
          break;
        }
      } else {
        lastError = await response.text();
        console.error(`Veo model ${model} failed: ${lastError}`);
      }
    }

    if (!operationName) {
      throw new Error(
        `Video generation failed. None of the Veo models are available for your API key. ` +
        `Make sure your Gemini API key has access to Veo video generation models. ` +
        `You can check availability at https://aistudio.google.com/models/veo-3. ` +
        `Last error: ${lastError.slice(0, 200)}`
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
