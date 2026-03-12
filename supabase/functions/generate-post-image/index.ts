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
  if (p.includes("story") || p.includes("reel") || p.includes("tiktok")) return "1024x1536";
  if (p.includes("linkedin") || p.includes("article")) return "1536x1024";
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

    // Get OpenAI API key
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
      return new Response(JSON.stringify({ error: "OpenAI API key not configured." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build the complete design prompt
    const imageSize = getImageSize(platform, format);
    const enhancedPrompt = buildDesignPrompt(prompt, platform, format, imageSize, brand_context);

    // Call OpenAI GPT Image (gpt-image-1)
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

/**
 * Build a comprehensive design prompt that produces on-brand, well-composed images.
 * Solves: cut-off elements, uninspired designs, off-brand colors.
 */
function buildDesignPrompt(
  basePrompt: string,
  platform?: string,
  format?: string,
  imageSize?: string,
  brand?: any,
): string {
  const sections: string[] = [];

  // ── 1. Composition & framing rules (fixes cut-off issue) ──
  sections.push(`IMAGE COMPOSITION RULES:
- All elements must be fully contained within the frame with generous safe margins (at least 10% padding from all edges)
- NEVER cut off text, objects, people, or any visual element at the edges
- Use clean, balanced composition with clear visual hierarchy
- The image should work as a standalone social media post — no bleed, no cropping needed
- Leave breathing room around all elements`);

  // ── 2. Platform-specific guidance ──
  const p = (platform || "").toLowerCase();
  const f = (format || "").toLowerCase();
  if (p.includes("instagram") || p.includes("tiktok")) {
    sections.push(`PLATFORM: ${platform} ${format || ""}
- Design for mobile-first viewing (thumb-stopping visual)
- Bold, high-contrast visuals that stand out in a feed
- If vertical format, stack elements vertically with the hook/headline at the top third`);
  } else if (p.includes("linkedin")) {
    sections.push(`PLATFORM: LinkedIn
- Professional, polished aesthetic
- Clean layout with sophisticated color usage
- Corporate-friendly but still visually engaging`);
  } else if (p.includes("facebook")) {
    sections.push(`PLATFORM: Facebook
- Shareable, scroll-stopping design
- Clear visual with easy-to-read text if any`);
  }

  // ── 3. Brand identity (the core of on-brand design) ──
  if (brand) {
    const brandParts: string[] = [];

    if (brand.primary_color)
      brandParts.push(`Primary brand color: ${brand.primary_color} — use this as the DOMINANT color in the design`);
    if (brand.secondary_color)
      brandParts.push(
        `Secondary brand color: ${brand.secondary_color} — use for supporting elements, backgrounds, or accents`,
      );
    if (brand.accent_color)
      brandParts.push(`Accent color: ${brand.accent_color} — use sparingly for highlights, CTAs, or emphasis`);
    if (brand.font_family)
      brandParts.push(`Typography style: inspired by ${brand.font_family} — match this typographic feel`);
    if (brand.visual_style) brandParts.push(`Overall visual style: ${brand.visual_style}`);
    if (brand.tone_of_voice)
      brandParts.push(`Brand tone: ${brand.tone_of_voice} — the visual mood should reflect this`);
    if (brand.design_elements) brandParts.push(`Design patterns to incorporate: ${brand.design_elements}`);
    if (brand.background_style) brandParts.push(`Background approach: ${brand.background_style}`);
    if (brand.logo_description)
      brandParts.push(
        `Brand mark reference: ${brand.logo_description} (do NOT include the actual logo, but match its design language)`,
      );

    if (brandParts.length > 0) {
      sections.push(`BRAND IDENTITY — The design MUST feel like it belongs to this brand:
${brandParts.join("\n")}`);
    }
  }

  // ── 4. Design quality directives ──
  sections.push(`DESIGN QUALITY:
- Create a polished, professional social media graphic — not a stock photo
- Use intentional color blocking and visual hierarchy
- If the concept involves text/headlines, make them bold, readable, and well-positioned
- The overall feel should be that of a professionally designed social media post by a top creative agency
- Avoid generic clip-art aesthetics — aim for modern, editorial-quality design`);

  // ── 5. The actual content prompt ──
  sections.push(`CONTENT DIRECTION:\n${basePrompt}`);

  return sections.join("\n\n");
}
