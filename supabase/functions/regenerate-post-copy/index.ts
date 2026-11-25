const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};

// A post's copy written again on Regenerate, optionally with a note the
// person left (notes on regenerate, Lital 3 Nov 2026). The client's own users
// may ask for it as well as staff (her decision 1): it reads the client's
// brand context and spends model credits on our key, so the caller must be a
// member of the client or staff with write access to it. Saving the rewrite,
// and learning from its note, is calendar-posts' save_copy.

import { createClient } from "../_shared/supabase.ts";
import { competitiveBrief } from "../_shared/competitive/brief.ts";
import { AuthzError } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { costCtx, hasKey } from "../_shared/paid/index.ts";
import { answerText, PERSON_WAIT_MS, roomFor } from "../_shared/anthropicReply.ts";
import { COPY_MODEL, loadClientVoice } from "../_shared/voice/load.ts";
import { voicePromptBlock } from "../_shared/voice/voice.ts";
import { isStoryPost } from "../_shared/design/story.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";
import { rewritePrompt } from "./prompt.ts";
import { hashtagList } from "../_shared/text/hashtags.ts";
import { strategyOnlyRefusal } from "../_shared/sprout/strategyOnly.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id, platform, concept, pillar, current_copy, current_cta, format } = body ?? {};
    // "visual": a new visual idea for the post, its copy kept (Social AI sync, 18 Nov 2026).
    const mode = body?.mode === "visual" ? "visual" : "copy";
    const currentVisual = typeof body?.current_visual === "string" ? body.current_visual.trim().slice(0, 1000) : "";

    const effectiveConcept = concept || current_copy || "";
    if (!client_id || !effectiveConcept) {
      return jsonResp(
        { error: "client_id and either concept or current_copy are required" },
        400,
      );
    }
    // Before anything is read or spent.
    const userId = await requireMember(req, String(client_id));

    if (!(await hasKey("anthropic"))) {
      return jsonResp({ error: "ANTHROPIC_API_KEY not configured" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // A strategy-only client (no active account in Sprout) has no calendar: no copy is written again and nothing is spent.
    const closed = await strategyOnlyRefusal(supabase, String(client_id));
    if (closed) return jsonResp({ error: closed }, 409);

    // How the client writes: the team's preferences, its real social voice, then the brief.
    const voice = await loadClientVoice(supabase, client_id);
    const voiceBlock = voicePromptBlock(voice, { platforms: platform ? [String(platform)] : undefined });

    const competitive = await competitiveBrief(supabase, client_id, platform).catch(() => "");
    const story = isStoryPost({ format: format ?? null, platform: platform ?? null });
    const prompt = rewritePrompt({
      platform: platform ? String(platform) : null, format: format ? String(format) : null, pillar: pillar ? String(pillar) : null,
      concept: String(effectiveConcept), currentCopy: String(current_copy ?? ""), currentCta: current_cta ? String(current_cta) : null,
      competitive, voiceBlock, note: cleanNote(body?.note), currentVisual: currentVisual || null, mode,
    });

    const result = await anthropicMessages({
      cost: costCtx({ clientId: String(client_id), feature: "post.copy_regenerate", actor: "user", userId }),
      body: { model: COPY_MODEL, max_tokens: roomFor(2000), messages: [{ role: "user", content: prompt }] },
      waitMs: PERSON_WAIT_MS,
    });
    // A reply that was cut off, declined or too long in coming holds no copy: it ends as a reply that cannot be parsed does.
    const postText = answerText(result).trim();

    // The JSON object in the reply, wherever it sits.
    let post;
    try {
      const start = postText.indexOf("{");
      const end = postText.lastIndexOf("}");
      post = start >= 0 && end > start ? JSON.parse(postText.slice(start, end + 1)) : null;
    } catch {
      post = null;
    }

    const visualOf = (p: { visual_direction?: unknown } | null) => (typeof p?.visual_direction === "string" ? p.visual_direction.trim() : "");
    if (mode === "visual") {
      // Only the visual is answered: the copy on the post stays as it is.
      const visual = visualOf(post);
      if (!visual) return jsonResp({ error: "Failed to parse a visual from AI response" }, 500);
      return jsonResp({ post: { visual_direction: visual } });
    }
    if (!post || typeof post.caption_angle !== "string" || !post.caption_angle.trim()) {
      return jsonResp({ error: "Failed to parse copy from AI response" }, 500);
    }
    // A new visual comes with the new copy; an answer without one leaves the post's own.
    if (visualOf(post)) post.visual_direction = visualOf(post);
    else delete post.visual_direction;
    // Hashtags answer as a list, the shape every calendar post holds; the
    // prompt asks the model for one string (QA 22 Nov 2026). A Story has none.
    // When the model gave none, the answer leaves them out, so the post keeps
    // its own and a save never clears them.
    const tags = hashtagList(post.hashtags);
    if (story) post.hashtags = [];
    else if (tags.length) post.hashtags = tags;
    else delete post.hashtags;

    return jsonResp({ post });
  } catch (err: any) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
