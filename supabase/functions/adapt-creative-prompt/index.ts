const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { concept, visual_direction, original_format, target_format, platform } =
      await req.json();

    // If formats match, return as-is
    if (original_format === target_format) {
      return jsonResp({ adapted_prompt: visual_direction });
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

    // Graceful degradation — if no key, return original
    if (!anthropicKey) {
      return jsonResp({ adapted_prompt: visual_direction });
    }

    const systemPrompt = `You are a creative director adapting a social media post concept from one format to another.

Original format: ${original_format}
Target format: ${target_format}
Platform: ${platform || "general"}

Original concept: ${concept}
Original visual direction: ${visual_direction || "Not specified"}

Rewrite ONLY the visual direction/design prompt to work for the target format. Keep the same strategic message and tone, but adapt the visual execution:
- If adapting TO video: describe motion, transitions, pacing, and dynamic elements
- If adapting TO carousel: describe slide-by-slide progression and story arc
- If adapting TO single image: distill into one impactful static frame
- If adapting TO story: describe vertical, ephemeral, swipe-up-friendly framing

Return ONLY the adapted visual direction text, nothing else.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });

    if (!response.ok) {
      // Graceful degradation on API error
      console.error("Anthropic API error:", response.status);
      return jsonResp({ adapted_prompt: visual_direction });
    }

    const result = await response.json();
    const adaptedText =
      result.content?.[0]?.text || visual_direction;

    return jsonResp({ adapted_prompt: adaptedText });
  } catch (err: any) {
    console.error("adapt-creative-prompt error:", err.message);
    // Graceful degradation — never block generation
    return jsonResp({ adapted_prompt: "" });
  }
});
