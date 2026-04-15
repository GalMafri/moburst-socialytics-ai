const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
      .select("name, brand_identity, content_pillars, brand_book_text")
      .eq("id", client_id)
      .maybeSingle();

    const brandIdentity =
      typeof client?.brand_identity === "object" ? client.brand_identity : {};

    // Load voice learnings (non-blocking — table may not exist yet)
    let voiceLearningsText = "No voice learnings yet.";
    try {
      const { data: voiceLearnings } = await supabase
        .from("brand_voice_learnings")
        .select("pattern_type, pattern_description, confidence")
        .eq("client_id", client_id)
        .order("confidence", { ascending: false })
        .limit(10);

      if (voiceLearnings && voiceLearnings.length > 0) {
        voiceLearningsText = voiceLearnings
          .map(
            (v: any) =>
              `- ${v.pattern_type}: ${v.pattern_description} (confidence: ${v.confidence})`,
          )
          .join("\n");
      }
    } catch (e) {
      console.error("Voice learnings query failed (table may not exist):", e);
    }

    const prompt = `You are a social media strategist creating a single post for a brand.

BRAND: ${client?.name || "Unknown"}
PLATFORM: ${platform}
CONTENT PILLARS: ${client?.content_pillars || "Not specified"}
BRAND BRIEF: ${client?.brand_book_text?.slice(0, 500) || "Not available"}
BRAND VOICE: ${brandIdentity?.tone_of_voice || "Professional"}

LEARNED VOICE PREFERENCES:
${voiceLearningsText}

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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Claude API error ${response.status}: ${errBody.slice(0, 200)}`);
    }

    const result = await response.json();
    const postText = result.content?.[0]?.text?.trim() || "";

    let post;
    try {
      post = JSON.parse(postText);
    } catch {
      const jsonMatch = postText.match(/```(?:json)?\s*([\s\S]*?)```/);
      post = jsonMatch ? JSON.parse(jsonMatch[1]) : null;
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
