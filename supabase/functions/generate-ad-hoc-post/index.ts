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
    const { client_id, platform, topic, creative_type } = await req.json();

    if (!client_id || !platform || !topic) {
      return jsonResp(
        { error: "client_id, platform, and topic are required" },
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

    // Load client context
    const { data: client } = await supabase
      .from("clients")
      .select("name, content_pillars, brand_book_text")
      .eq("id", client_id)
      .maybeSingle();

    // Pillars are objects; interpolated straight into the prompt they read as
    // "[object Object]", so the model was told nothing about them.
    const pillarLines = (Array.isArray(client?.content_pillars) ? client!.content_pillars : [])
      .map((p: any) => (typeof p === "string" ? `- ${p}` : `- ${p?.name}${p?.description ? ` — ${p.description}` : ""}`))
      .filter((line: string) => line.trim() !== "-")
      .join("\n") || "Not specified";

    // How the client writes: the team's preferences, its real social voice, then the brief.
    const voice = await loadClientVoice(supabase, client_id);
    const voiceBlock = voicePromptBlock(voice, { platforms: [String(platform)] });

    // The competitive picture (endorsed gaps, winning patterns, rejected ideas)
    // so a one-off post pulls in the same direction as the monthly plan.
    const competitive = await competitiveBrief(supabase, client_id, platform).catch(() => "");

    const prompt = `You are a social media strategist creating a single post for a brand.

BRAND: ${client?.name || "Unknown"}
PLATFORM: ${platform}
CONTENT PILLARS:
${pillarLines}
BRAND BRIEF: ${client?.brand_book_text?.slice(0, 500) || "Not available"}

${voiceBlock}
${competitive ? `\n${competitive}\nWhere the request allows, make the post act on an endorsed gap and say which one in "pillar" or "concept".\n` : ""}
CREATIVE TYPE: ${creative_type || "AI decides based on topic and platform"}

USER REQUEST: ${topic}

Generate a complete post recommendation. Return ONLY this JSON:
{
  "platform": "${platform}",
  "format": "the creative format (Image/Carousel/Video/Reel/Story)",
  "pillar": "which content pillar this aligns with",
  "hook": "attention-grabbing opening line",
  "concept": "3-5 sentence concept with visual description",
  "visual_direction": "detailed design/visual prompt for image or video generation",
  "caption_angle": "the full post caption text",
  "CTA": "specific call to action",
  "hashtags": "relevant hashtags"
}`;

    const result = await anthropicMessages({
      apiKey: anthropicKey,
      body: { model: COPY_MODEL, max_tokens: 2500, messages: [{ role: "user", content: prompt }] },
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
      return jsonResp({ error: "Failed to parse post from AI response" }, 500);
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
