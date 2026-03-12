import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { website_url, client_name } = await req.json();

    if (!website_url) {
      return new Response(
        JSON.stringify({ error: "website_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch the website HTML
    let html: string;
    try {
      const siteResponse = await fetch(website_url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Socialytics-BrandResearch/1.0)" },
        redirect: "follow",
      });
      if (!siteResponse.ok) {
        throw new Error(`HTTP ${siteResponse.status}`);
      }
      html = await siteResponse.text();
    } catch (fetchErr: any) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch website: ${fetchErr.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Extract brand signals from HTML
    const signals = extractBrandSignals(html);

    // 3. Get OpenAI API key
    let openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "openai_api_key")
        .maybeSingle();
      openaiKey = setting?.value;
    }

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured. Add OPENAI_API_KEY to your environment or app_settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Use GPT-4o to analyze extracted signals and identify brand identity
    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a brand identity analyst. Given extracted website data, identify the brand's visual identity. Return ONLY valid JSON with this exact structure:
{
  "primary_color": "#hex",
  "secondary_color": "#hex",
  "accent_color": "#hex",
  "font_family": "font name(s)",
  "visual_style": "brief 5-10 word style description",
  "logo_description": "brief description of the logo/brand mark"
}
All color fields MUST be valid hex codes (e.g. #FF5733). Use your best judgment when data is ambiguous. Prioritize the most prominent/branded colors, not generic grays or whites.`
          },
          {
            role: "user",
            content: `Analyze the brand identity for "${client_name || "this company"}" from their website (${website_url}).

Extracted CSS colors and variables:
${signals.cssColors}

Meta theme color: ${signals.themeColor || "not found"}
Font references: ${signals.fonts}
Favicon/logo URL: ${signals.logoUrl || "not found"}
OG image: ${signals.ogImage || "not found"}
Page title: ${signals.pageTitle || "not found"}
Meta description: ${signals.metaDescription || "not found"}`
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!gptResponse.ok) {
      const errorBody = await gptResponse.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `OpenAI API error: ${gptResponse.status}`, details: errorBody }),
        { status: gptResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gptResult = await gptResponse.json();
    const content = gptResult.choices?.[0]?.message?.content || "";

    // 5. Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({ error: "Could not parse brand identity from AI response", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let brandIdentity;
    try {
      brandIdentity = JSON.parse(jsonMatch[0]);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in AI response", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ brand_identity: brandIdentity }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/** Extract brand-relevant signals from raw HTML */
function extractBrandSignals(html: string) {
  const cssVarMatches =
    html.match(/--[\w-]*(color|brand|primary|secondary|accent|theme|main)[\w-]*\s*:\s*[^;]+/gi) || [];
  const hexColors = html.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const rgbColors = html.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi) || [];
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i
  );
  const googleFontMatch =
    html.match(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi) || [];
  const fontFamilyMatches = html.match(/font-family\s*:\s*([^;}"]+)/gi) || [];
  const faviconMatch = html.match(
    /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i
  );
  const ogImageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  );
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
  );

  const uniqueHex = [...new Set(hexColors)].slice(0, 20);
  const uniqueRgb = [...new Set(rgbColors)].slice(0, 10);

  return {
    cssColors: [
      ...cssVarMatches.slice(0, 15),
      ...uniqueHex.map((c) => `hex: ${c}`),
      ...uniqueRgb.map((c) => `rgb: ${c}`),
    ]
      .join("\n")
      .slice(0, 2000),
    themeColor: themeColorMatch?.[1] || null,
    fonts: [
      ...googleFontMatch.map((f) => f.replace(/.*family=/, "")),
      ...fontFamilyMatches.slice(0, 5),
    ]
      .join(", ")
      .slice(0, 500),
    logoUrl: faviconMatch?.[1] || null,
    ogImage: ogImageMatch?.[1] || null,
    pageTitle: titleMatch?.[1]?.trim() || null,
    metaDescription: descMatch?.[1] || null,
  };
}
