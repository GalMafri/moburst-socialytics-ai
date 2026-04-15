const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_data, media_type } = await req.json();

    if (!image_data) {
      return jsonResp({ error: "image_data is required" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      // Graceful degradation — skip validation when key is not configured
      return jsonResp({ has_hex_codes: false, skipped: true });
    }

    // Extract base64 data and mime type from data URL or raw base64
    let base64Data: string;
    let mimeType: string;

    if (image_data.startsWith("data:")) {
      const match = image_data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return jsonResp({ error: "Invalid data URL format" }, 400);
      }
      mimeType = match[1];
      base64Data = match[2];
    } else {
      base64Data = image_data;
      mimeType = media_type || "image/png";
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: "Does this image contain any visible hex color codes (like #FF5733), RGB values, or technical color notation rendered as readable text? Answer ONLY 'YES' or 'NO'.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error("Anthropic API error:", response.status, errorBody);
      // Fail open — don't block generation if validation fails
      return jsonResp({ has_hex_codes: false, skipped: true });
    }

    const result = await response.json();
    const answer = (result.content?.[0]?.text || "").trim().toUpperCase();
    const hasHex = answer === "YES";

    return jsonResp({ has_hex_codes: hasHex });
  } catch (err: any) {
    console.error("validate-design-output error:", err.message);
    // Fail open on unexpected errors
    return jsonResp({ has_hex_codes: false, skipped: true });
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
