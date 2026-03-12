import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Map platform + format to the best image size for gpt-image-1 */
function getImageSize(platform?: string, format?: string): string {
  if (!platform) return "1024x1024";
  const p = (platform + " " + (format || "")).toLowerCase();
  // Vertical: Stories, Reels, TikTok
  if (p.includes("story") || p.includes("reel") || p.includes("tiktok")) return "1024x1536";
  // Landscape: LinkedIn articles, Facebook link posts
  if (p.includes("linkedin") || p.includes("article")) return "1536x1024";
  // Square: Instagram feed, Facebook, default
  return "1024x1024";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, platform, format, brand_context } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get OpenAI API key from app_settings or env
    let openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!openaiKey) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "openai_api_key")
        .maybeSingle();
      openaiKey = setting?.value;
    }

    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          error: "OpenAI API key not configured. Add OPENAI_API_KEY to your environment or app_settings.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build enhanced prompt with brand context
    let enhancedPrompt = prompt;
    if (brand_context) {
      const parts: string[] = [];
      if (brand_context.primary_color) parts.push(`primary brand color: ${brand_context.primary_color}`);
      if (brand_context.secondary_color) parts.push(`secondary color: ${brand_context.secondary_color}`);
      if (brand_context.accent_color) parts.push(`accent color: ${brand_context.accent_color}`);
      if (brand_context.visual_style) parts.push(`visual style: ${brand_context.visual_style}`);
      if (brand_context.font_family) parts.push(`typography style inspired by: ${brand_context.font_family}`);
      if (brand_context.logo_description) parts.push(`brand mark: ${brand_context.logo_description}`);

      if (parts.length > 0) {
        const brandPrefix = `BRAND GUIDELINES - Use these exact brand colors and style throughout the design: ${parts.join(", ")}. `;
        enhancedPrompt = brandPrefix + prompt;
      }
    }

    const imageSize = getImageSize(platform, format);

    // Call OpenAI GPT Image (gpt-image-1) generation
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: enhancedPrompt.slice(0, 32000),
        n: 1,
        size: imageSize,
        quality: "high",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return new Response(JSON.stringify({ error: `OpenAI API error: ${response.status}`, details: errorBody }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await response.json();
    const imageData = result.data?.[0];

    // gpt-image-1 may return url or b64_json depending on configuration
    const imageUrl = imageData?.url || (imageData?.b64_json ? `data:image/png;base64,${imageData.b64_json}` : null);
    const revisedPrompt = imageData?.revised_prompt;

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "No image data in response" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ image_url: imageUrl, revised_prompt: revisedPrompt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
