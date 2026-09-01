// Video generation via Higgsfield (replaces the Gemini-seed → Veo chain).
//
// Shape of a run:
//   1. Generate a brand-aligned anchor still on Higgsfield's image model,
//      passing the client's design references / brand book as reference URLs.
//      Same rationale as the old Gemini seed: image-to-video from a frame that
//      already encodes the brand beats text-only video every time.
//   2. Submit image-to-video with that still as `image_url`, registering the
//      higgsfield-webhook endpoint so the terminal result reaches us even if
//      this function's inline wait runs out.
//   3. Record a media_jobs row, then poll inline for the fast path. If the
//      video finishes inside the inline budget, respond with the classic
//      {video_url, seed_image_url, seed_used} shape and the frontend persists
//      it exactly as before. If not, respond {job_id, status:"processing"} —
//      the webhook completes the job row and the frontend watches it.
//
// The old function returned a Veo URL with the API key appended as a query
// param, handing every staff browser a usable Gemini key. The Higgsfield CDN
// URLs need no credential, so that leak class dies with this rewrite.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildVideoPrompt } from "../_shared/design-prompts/buildVideoPrompt.ts";
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
  videoModelPath,
} from "../_shared/higgsfield/context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Budgets. The seed is an image job (fast); the video gets what's left of a
// wall-clock envelope the platform will still tolerate. When the inline video
// budget runs out we DON'T fail — we hand back the job id.
const SEED_TIMEOUT_MS = 90_000;
const VIDEO_INLINE_TIMEOUT_MS = 180_000;

function getAspectRatio(platform?: string, format?: string): string {
  const fmt = (format || "").toLowerCase();
  const plat = (platform || "").toLowerCase();

  if (fmt.includes("story") || fmt.includes("reel") || plat === "tiktok") return "9:16";
  if (plat === "linkedin" || fmt.includes("article")) return "16:9";
  if (plat === "youtube") return "16:9";
  return "9:16";
}

/**
 * Extra model parameters for the account's video route, e.g. duration or
 * quality knobs. Higgsfield model schemas are account-specific, so rather than
 * hardcoding a guess, ops can set HIGGSFIELD_VIDEO_PARAMS to a JSON object and
 * it is merged into every video submission.
 */
function extraVideoParams(): Record<string, unknown> {
  const raw = Deno.env.get("HIGGSFIELD_VIDEO_PARAMS");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    console.warn("[generate-post-video] HIGGSFIELD_VIDEO_PARAMS is not valid JSON; ignoring");
    return {};
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
      client_context,
      post,
      variant_angle,
      post_iteration_id, // optional link for the job row
    } = await req.json();

    const resolvedBrand = client_context?.brand_identity ?? brandIdentity ?? null;
    const resolvedRefs = client_context?.design_references ?? [];
    const resolvedBrandBookPath = client_context?.brand_book_file_path ?? null;
    const resolvedSynthesis = client_context?.design_style_synthesis ?? null;
    const clientId: string | null = client_context?.client_id ?? null;

    console.log("[generate-post-video] context received:", {
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
      has_client_id: !!clientId,
    });

    if (!prompt) {
      return jsonResp({ error: "prompt is required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const aspectRatio = toHiggsfieldAspectRatio(getAspectRatio(platform, format));

    // ── Resolve brand visual context to reference URLs ──
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
        "[generate-post-video] PDF-only brand book and no design_style_synthesis — " +
          "seed will be less brand-aligned. Run synthesize-design-language for this client.",
      );
    }

    // ── Step 1: brand-aligned anchor still ──
    // Failure here falls back to text-only video, preserving the old
    // safety-net semantics (seed_used=false tells the UI which path ran).
    let seedCdnUrl: string | null = null;
    try {
      const seedPrompt = buildImagePrompt({
        basePrompt:
          prompt +
          "\n\nThis still will be used as the OPENING FRAME of a short social-media video — " +
          "compose for motion. Place the subject so it can move or transform without falling off frame.",
        platform,
        format,
        brandIdentity: resolvedBrand,
        synthesis: resolvedSynthesis,
        post,
        variantAngle: variant_angle || undefined,
      });

      // Same route split as generate-post-image: one style reference → the
      // /reference route; none → plain /standard.
      const useReference = resolved.referenceUrls.length > 0;
      const seedBody: Record<string, unknown> = useReference
        ? {
            prompt: seedPrompt,
            image_reference_url: resolved.referenceUrls[0],
            aspect_ratio: aspectRatio,
            resolution: imageResolution(),
            style_strength: 0.8,
          }
        : {
            prompt: seedPrompt,
            aspect_ratio: aspectRatio,
            resolution: imageResolution(),
          };

      console.log("[generate-post-video] generating brand-aligned seed image…");
      const seedSubmission = await submit(
        useReference ? imageReferenceModelPath() : imageModelPath(),
        seedBody,
      );
      const seedResult = await pollUntilTerminal(seedSubmission.status_url, {
        timeoutMs: SEED_TIMEOUT_MS,
      });
      seedCdnUrl = seedResult.images?.[0]?.url ?? null;
      if (seedCdnUrl) {
        console.log("[generate-post-video] seed image ready — video will animate from it");
      }
    } catch (e) {
      console.warn(
        "[generate-post-video] seed generation failed:",
        e instanceof Error ? e.message : e,
      );
    }

    // DoP is image-to-video ONLY (image_url is required by its schema), so a
    // missing seed is a hard stop, not a degraded mode. The old Veo path could
    // fall back to text-only; the equivalent here would silently switch model
    // families, which is a worse surprise than a clear error.
    if (!seedCdnUrl) {
      throw new HiggsfieldError(
        "generation_failed",
        "Could not generate the brand-aligned anchor frame, and the video model requires one. Try again, or simplify the brief.",
      );
    }

    // ── Step 2: build the motion prompt and submit the video ──
    const enhancedPrompt = buildVideoPrompt({
      sceneDescription: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      post,
      variantAngle: variant_angle || null,
      hasSeedImage: !!seedCdnUrl,
    });

    // DoP schema: {prompt, image_url} required; no aspect_ratio field (the
    // clip follows the seed frame's ratio, which we already generated to the
    // platform's ratio). extraVideoParams stays last so env can add motions
    // or swap in another route's fields.
    const videoBody: Record<string, unknown> = {
      prompt: enhancedPrompt,
      image_url: seedCdnUrl,
      ...extraVideoParams(),
    };

    // Register the webhook when configured, so the terminal state reaches the
    // media_jobs row even after this function stops waiting.
    const webhookSecret = Deno.env.get("HIGGSFIELD_WEBHOOK_SECRET");
    const webhookUrl = webhookSecret
      ? `${supabaseUrl}/functions/v1/higgsfield-webhook?t=${webhookSecret}`
      : undefined;
    if (!webhookUrl) {
      console.warn(
        "[generate-post-video] HIGGSFIELD_WEBHOOK_SECRET not set — async completion disabled, inline wait only",
      );
    }

    const submission = await submit(videoModelPath(), videoBody, { webhookUrl });
    console.log("[generate-post-video] video request:", submission.request_id);

    // ── Step 3: job row (needs a client_id; legacy callers without one just
    // don't get async recovery) ──
    let jobId: string | null = null;
    if (clientId) {
      const { data: jobRow, error: jobErr } = await supabase
        .from("media_jobs")
        .insert({
          client_id: clientId,
          post_iteration_id: post_iteration_id || null,
          kind: "video",
          provider: "higgsfield",
          request_id: submission.request_id,
          model_path: videoModelPath(),
          status: "submitted",
          input: {
            prompt: enhancedPrompt.slice(0, 4000),
            aspect_ratio: aspectRatio,
            seed_used: !!seedCdnUrl,
            platform,
            format,
          },
          seed_image_url: seedCdnUrl,
        })
        .select("id")
        .single();
      if (jobErr) {
        console.warn("[generate-post-video] media_jobs insert failed:", jobErr.message);
      } else {
        jobId = jobRow.id;
      }
    }

    // ── Step 4: inline wait for the fast path ──
    try {
      const result = await pollUntilTerminal(submission.status_url, {
        timeoutMs: VIDEO_INLINE_TIMEOUT_MS,
      });
      const videoUrl = result.video?.url;
      if (!videoUrl) {
        throw new HiggsfieldError(
          "upstream_error",
          "Completed without a video URL: " + JSON.stringify(result).slice(0, 300),
          { requestId: result.request_id },
        );
      }

      // The webhook will also stamp the job row and copy media; that's fine —
      // its update is idempotent and the frontend persists this URL itself via
      // upload-generated-media, exactly as it did with Veo.
      return jsonResp({
        video_url: videoUrl,
        seed_image_url: seedCdnUrl,
        seed_used: !!seedCdnUrl,
        job_id: jobId,
      });
    } catch (e) {
      if (e instanceof HiggsfieldError && e.code === "timeout" && jobId) {
        // Not a failure: the job continues server-side and the webhook will
        // finish it. Hand the frontend the job to watch.
        console.log("[generate-post-video] inline budget exhausted — continuing async as job", jobId);
        return jsonResp(
          {
            job_id: jobId,
            status: "processing",
            seed_image_url: seedCdnUrl,
            seed_used: !!seedCdnUrl,
          },
          202,
        );
      }
      // Real failure — stamp the job row so nothing dangles as "submitted".
      if (jobId) {
        const msg = e instanceof Error ? e.message : String(e);
        await supabase
          .from("media_jobs")
          .update({
            status: e instanceof HiggsfieldError && e.code === "moderated" ? "nsfw" : "failed",
            error: msg.slice(0, 500),
          })
          .eq("id", jobId)
          .not("status", "in", '("completed","failed","nsfw","canceled","timed_out")');
      }
      throw e;
    }
  } catch (error: any) {
    if (error instanceof HiggsfieldError) {
      console.error("[generate-post-video] higgsfield error:", error.code, error.message);
      const status =
        error.code === "concurrency_exhausted" ? 429 :
        (error.code === "insufficient_credits" ? 402 :
        error.code === "moderated" ? 422 :
        error.code === "timeout" ? 504 : 502);
      return jsonResp({ error: error.userMessage, code: error.code, detail: error.message.slice(0, 400) }, status);
    }
    console.error("Error generating video:", error);
    return jsonResp({ error: error.message }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
