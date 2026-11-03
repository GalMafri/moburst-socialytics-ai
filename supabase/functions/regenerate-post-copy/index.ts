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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { competitiveBrief } from "../_shared/competitive/brief.ts";
import { AuthzError } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { COPY_MODEL, loadClientVoice } from "../_shared/voice/load.ts";
import { voicePromptBlock } from "../_shared/voice/voice.ts";
import { isStoryPost } from "../_shared/design/story.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";
import { rewritePrompt } from "./prompt.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { client_id, platform, concept, pillar, current_copy, current_cta, format } = body ?? {};

    const effectiveConcept = concept || current_copy || "";
    if (!client_id || !effectiveConcept) {
      return jsonResp(
        { error: "client_id and either concept or current_copy are required" },
        400,
      );
    }
    // Before anything is read or spent.
    await requireMember(req, String(client_id));

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResp({ error: "ANTHROPIC_API_KEY not configured" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // How the client writes: the team's preferences, its real social voice, then the brief.
    const voice = await loadClientVoice(supabase, client_id);
    const voiceBlock = voicePromptBlock(voice, { platforms: platform ? [String(platform)] : undefined });

    const competitive = await competitiveBrief(supabase, client_id, platform).catch(() => "");
    const story = isStoryPost({ format: format ?? null, platform: platform ?? null });
    const prompt = rewritePrompt({
      platform: platform ? String(platform) : null, format: format ? String(format) : null, pillar: pillar ? String(pillar) : null,
      concept: String(effectiveConcept), currentCopy: String(current_copy ?? ""), currentCta: current_cta ? String(current_cta) : null,
      competitive, voiceBlock, note: cleanNote(body?.note),
    });

    const result = await anthropicMessages({
      apiKey: anthropicKey,
      body: { model: COPY_MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] },
    });
    const postText = result.text.trim();

    // The JSON object in the reply, wherever it sits.
    let post;
    try {
      const start = postText.indexOf("{");
      const end = postText.lastIndexOf("}");
      post = start >= 0 && end > start ? JSON.parse(postText.slice(start, end + 1)) : null;
    } catch {
      post = null;
    }

    if (!post || typeof post.caption_angle !== "string" || !post.caption_angle.trim()) {
      return jsonResp({ error: "Failed to parse copy from AI response" }, 500);
    }
    // A Story has no hashtags.
    if (story) post.hashtags = "";

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
