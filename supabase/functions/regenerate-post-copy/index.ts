const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { competitiveBrief } from "../_shared/competitive/brief.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { COPY_MODEL, loadClientVoice } from "../_shared/voice/load.ts";
import { voicePromptBlock } from "../_shared/voice/voice.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reads a client's brand context and spends model credits on our key, so it
  // cannot be world-invokable.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { client_id, platform, concept, pillar, current_copy, current_cta } =
      await req.json();

    const effectiveConcept = concept || current_copy || "";
    if (!client_id || !effectiveConcept) {
      return jsonResp(
        { error: "client_id and either concept or current_copy are required" },
        400,
      );
    }

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
    const prompt = `Rewrite this social media post copy with a fresh take. Keep the same strategic angle and concept, but create completely new wording.

PLATFORM: ${platform || "general"}
${competitive ? `\n${competitive}\n` : ""}
CONTENT PILLAR: ${pillar || "general"}
CONCEPT: ${effectiveConcept}
CURRENT COPY (rewrite this): ${current_copy}
CURRENT CTA: ${current_cta || ""}

${voiceBlock}

Return ONLY this JSON:
{
  "caption_angle": "the new post caption",
  "CTA": "new call to action",
  "hashtags": "relevant hashtags"
}`;

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

    if (!post) {
      return jsonResp({ error: "Failed to parse copy from AI response" }, 500);
    }

    return jsonResp({ post });
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
