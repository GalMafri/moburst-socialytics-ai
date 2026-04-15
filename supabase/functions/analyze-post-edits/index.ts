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
    const { client_id, original_copy, edited_copy, original_cta, edited_cta, original_hashtags, edited_hashtags } = await req.json();

    if (!client_id || !original_copy || !edited_copy) {
      return jsonResp({ error: "client_id, original_copy, and edited_copy are required" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResp({ error: "ANTHROPIC_API_KEY not configured" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Ask Claude to analyze the diff
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
        messages: [
          {
            role: "user",
            content: `Analyze these edits a client made to AI-generated social media copy. Extract voice/style preferences.

ORIGINAL AI COPY:
${original_copy}
${original_cta ? `\nORIGINAL CTA: ${original_cta}` : ""}
${original_hashtags ? `\nORIGINAL HASHTAGS: ${original_hashtags}` : ""}

EDITED BY CLIENT:
${edited_copy}
${edited_cta ? `\nEDITED CTA: ${edited_cta}` : ""}
${edited_hashtags ? `\nEDITED HASHTAGS: ${edited_hashtags}` : ""}

Return a JSON array of patterns you observe. Each pattern:
{
  "pattern_type": "tone" | "length" | "emoji_usage" | "cta_style" | "hashtag_preference" | "vocabulary" | "structure",
  "pattern_description": "concise description of the preference, e.g. 'Prefers casual conversational tone over formal'"
}

Only include clear, confident patterns. If the edit is trivial (typo fix, minor rewording), return an empty array [].
Return ONLY the JSON array, no other text.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("Claude API call failed");
    }

    const result = await response.json();
    const patternsText = result.content?.[0]?.text?.trim() || "[]";

    let patterns: Array<{ pattern_type: string; pattern_description: string }>;
    try {
      patterns = JSON.parse(patternsText);
    } catch {
      // Try to extract JSON from markdown code blocks
      const match = patternsText.match(/```(?:json)?\s*([\s\S]*?)```/);
      patterns = match ? JSON.parse(match[1]) : [];
    }

    if (!Array.isArray(patterns)) {
      patterns = [];
    }

    // Upsert patterns into brand_voice_learnings
    for (const pattern of patterns) {
      if (!pattern.pattern_type || !pattern.pattern_description) continue;

      const { data: existing } = await supabase
        .from("brand_voice_learnings")
        .select("id, confidence, source_iterations")
        .eq("client_id", client_id)
        .eq("pattern_type", pattern.pattern_type)
        .eq("pattern_description", pattern.pattern_description)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("brand_voice_learnings")
          .update({
            confidence: Math.min(1, existing.confidence + 0.1),
            source_iterations: existing.source_iterations + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabase.from("brand_voice_learnings").insert({
          client_id,
          pattern_type: pattern.pattern_type,
          pattern_description: pattern.pattern_description,
          confidence: 0.5,
          source_iterations: 1,
        });
      }
    }

    return jsonResp({ patterns_extracted: patterns.length, patterns });
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
