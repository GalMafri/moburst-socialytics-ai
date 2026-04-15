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

    // Load voice learnings (non-blocking — table may not exist yet)
    let voiceLearningsText = "";
    try {
      const { data: voiceLearnings } = await supabase
        .from("brand_voice_learnings")
        .select("pattern_type, pattern_description, confidence")
        .eq("client_id", client_id)
        .order("confidence", { ascending: false })
        .limit(10);

      voiceLearningsText =
        voiceLearnings && voiceLearnings.length > 0
          ? voiceLearnings
              .map(
                (v: any) =>
                  `- ${v.pattern_type}: ${v.pattern_description} (confidence: ${v.confidence})`,
              )
              .join("\n")
          : "";
    } catch (e) {
      console.error("Voice learnings query failed (table may not exist):", e);
    }

    const prompt = `Rewrite this social media post copy with a fresh take. Keep the same strategic angle and concept, but create completely new wording.

PLATFORM: ${platform || "general"}
CONTENT PILLAR: ${pillar || "general"}
CONCEPT: ${effectiveConcept}
CURRENT COPY (rewrite this): ${current_copy}
CURRENT CTA: ${current_cta || ""}

${voiceLearningsText ? `VOICE PREFERENCES:\n${voiceLearningsText}` : ""}

Return ONLY this JSON:
{
  "caption_angle": "the new post caption",
  "CTA": "new call to action",
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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
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
