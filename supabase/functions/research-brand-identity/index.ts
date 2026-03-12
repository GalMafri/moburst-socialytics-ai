import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,text/css,*/*",
};

// Generic / non-brand colors to filter out
const GENERIC_HEX = new Set([
  "#fff", "#ffffff", "#000", "#000000", "#333", "#333333",
  "#666", "#666666", "#999", "#999999", "#ccc", "#cccccc",
  "#ddd", "#dddddd", "#eee", "#eeeeee", "#f5f5f5", "#fafafa",
  "#f8f8f8", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373",
  "#525252", "#404040", "#262626", "#171717", "#0a0a0a",
  "#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af",
  "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827",
  "#0000ff", "#ff0000", "#00ff00", "#transparent",
]);

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

    // Normalize URL
    let normalizedUrl = website_url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const baseUrl = new URL(normalizedUrl).origin;

    // 1. Fetch the website HTML
    let html: string;
    try {
      const siteResponse = await fetch(normalizedUrl, {
        headers: FETCH_HEADERS,
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

    // 2. Fetch external stylesheets (up to 5, concurrently)
    const cssLinkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
    const cssUrls: string[] = [];
    let linkMatch;
    while ((linkMatch = cssLinkRegex.exec(html)) !== null && cssUrls.length < 5) {
      let href = linkMatch[1];
      if (href.startsWith("//")) href = "https:" + href;
      else if (href.startsWith("/")) href = baseUrl + href;
      else if (!href.startsWith("http")) href = baseUrl + "/" + href;
      cssUrls.push(href);
    }

    const externalCss = await Promise.all(
      cssUrls.map(async (url) => {
        try {
          const resp = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
          if (!resp.ok) return "";
          const text = await resp.text();
          return text.slice(0, 50000); // cap per file
        } catch {
          return "";
        }
      })
    );
    const allCss = externalCss.join("\n");

    // 3. Extract brand signals from HTML + external CSS
    const signals = extractBrandSignals(html, allCss, baseUrl);

    // 4. Get OpenAI API key
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

    // 5. Use GPT-4o to analyze extracted signals
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
            content: `You are a senior brand identity analyst specializing in extracting precise brand colors from websites. Your task is to identify the ACTUAL brand colors used in a company's visual identity — NOT generic UI colors.

RULES:
- Primary color = the dominant brand color used in the logo, buttons, headers, and CTAs
- Secondary color = the second most prominent brand color, often used for backgrounds, accents, or secondary buttons
- Accent color = a complementary or highlight color used sparingly for emphasis
- NEVER return generic grays (#333, #666, #999), pure black (#000), or pure white (#fff) as brand colors
- NEVER return Tailwind/Bootstrap default colors unless they ARE the actual brand colors
- Look at CSS custom properties (--primary, --brand-*, --accent) as the strongest signals
- Look at button backgrounds, link colors, header backgrounds, and gradient colors
- Font family should be the primary display/heading font, not system fallbacks

Return ONLY valid JSON:
{
  "primary_color": "#hex",
  "secondary_color": "#hex",
  "accent_color": "#hex",
  "font_family": "Primary Font Name",
  "visual_style": "brief 5-10 word style description (e.g. 'Clean modern minimalist with warm earth tones')",
  "logo_description": "brief description of the brand mark/logo style"
}`
          },
          {
            role: "user",
            content: `Analyze the brand identity for "${client_name || "this company"}" from their website (${normalizedUrl}).

=== CSS CUSTOM PROPERTIES (strongest brand signals) ===
${signals.cssVars || "none found"}

=== BUTTON & CTA COLORS ===
${signals.buttonColors || "none found"}

=== LINK & ACCENT COLORS ===
${signals.linkColors || "none found"}

=== GRADIENT COLORS ===
${signals.gradients || "none found"}

=== ALL UNIQUE BRAND-CANDIDATE COLORS (non-generic) ===
${signals.brandCandidateColors || "none found"}

=== META THEME COLOR ===
${signals.themeColor || "not found"}

=== FONT REFERENCES ===
${signals.fonts || "not found"}

=== PAGE META ===
Title: ${signals.pageTitle || "not found"}
Description: ${signals.metaDescription || "not found"}
Favicon: ${signals.logoUrl || "not found"}
OG Image: ${signals.ogImage || "not found"}`
          }
        ],
        temperature: 0.2,
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

    // 6. Parse the JSON response
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

/** Check if a hex color is generic (grayscale, pure black/white, common defaults) */
function isGenericColor(hex: string): boolean {
  const h = hex.toLowerCase().replace(/\s/g, "");
  if (GENERIC_HEX.has(h)) return true;
  // Expand 3-char hex to 6-char
  let full = h;
  if (/^#[0-9a-f]{3}$/i.test(h)) {
    full = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (GENERIC_HEX.has(full)) return true;
  // Check if grayscale (r ≈ g ≈ b)
  const match = full.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (match) {
    const r = parseInt(match[1], 16);
    const g = parseInt(match[2], 16);
    const b = parseInt(match[3], 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 15) return true; // near-grayscale
  }
  return false;
}

/** Extract brand-relevant signals from HTML + external CSS */
function extractBrandSignals(html: string, externalCss: string, baseUrl: string) {
  const combined = html + "\n" + externalCss;

  // --- CSS Custom Properties (strongest brand signal) ---
  const cssVarRegex = /--[\w-]*(color|brand|primary|secondary|accent|theme|main|cta|btn|link|highlight|heading)[\w-]*\s*:\s*([^;}\n]+)/gi;
  const cssVars: string[] = [];
  let varMatch;
  while ((varMatch = cssVarRegex.exec(combined)) !== null && cssVars.length < 30) {
    cssVars.push(`${varMatch[0].trim()}`);
  }

  // --- Button / CTA colors ---
  const buttonColorRegex = /(?:\.btn|\.button|\.cta|button|\.primary-btn|\.hero-btn|a\.btn)[^{}]*\{[^}]*(?:background(?:-color)?\s*:\s*([^;}\n]+)|color\s*:\s*([^;}\n]+))/gi;
  const buttonColors: string[] = [];
  let btnMatch;
  while ((btnMatch = buttonColorRegex.exec(combined)) !== null && buttonColors.length < 15) {
    const val = (btnMatch[1] || btnMatch[2] || "").trim();
    if (val && val !== "inherit" && val !== "transparent" && val !== "currentColor") {
      buttonColors.push(val);
    }
  }

  // --- Link colors ---
  const linkColorRegex = /(?:^|\s)a(?:\s|,|\{|:)[^{}]*\{[^}]*color\s*:\s*([^;}\n]+)/gim;
  const linkColors: string[] = [];
  let linkMatch;
  while ((linkMatch = linkColorRegex.exec(combined)) !== null && linkColors.length < 10) {
    const val = linkMatch[1].trim();
    if (val && val !== "inherit" && val !== "transparent" && val !== "currentColor") {
      linkColors.push(val);
    }
  }

  // --- Gradients ---
  const gradientMatches = combined.match(/(?:linear|radial)-gradient\([^)]+\)/gi) || [];

  // --- All hex colors, filtered to non-generic ---
  const allHex = combined.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const hexCounts = new Map<string, number>();
  for (const h of allHex) {
    const lower = h.toLowerCase();
    if (!isGenericColor(lower)) {
      hexCounts.set(lower, (hexCounts.get(lower) || 0) + 1);
    }
  }
  // Sort by frequency — most used colors are more likely brand colors
  const sortedHex = [...hexCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([color, count]) => `${color} (used ${count}x)`);

  // --- Meta theme-color ---
  const themeColorMatch = html.match(
    /<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i
  );

  // --- Font references ---
  const googleFontMatch = combined.match(/fonts\.googleapis\.com\/css2?\?family=([^"'&\s)]+)/gi) || [];
  const fontFaceMatches = combined.match(/font-family\s*:\s*["']?([^;}"'\n,]+)/gi) || [];
  const cleanedFonts = fontFaceMatches
    .map((f) => f.replace(/font-family\s*:\s*/i, "").replace(/["']/g, "").trim())
    .filter((f) => !/(sans-serif|serif|monospace|system-ui|inherit|initial|-apple-system|BlinkMacSystemFont|Segoe UI|Arial|Helvetica|Times)/i.test(f));
  const uniqueFonts = [...new Set([
    ...googleFontMatch.map((f) => decodeURIComponent(f.replace(/.*family=/, "").replace(/[+:].*/g, " ").trim())),
    ...cleanedFonts.slice(0, 10),
  ])];

  // --- Favicon ---
  const faviconMatch = html.match(
    /<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i
  );
  let faviconUrl = faviconMatch?.[1] || null;
  if (faviconUrl && !faviconUrl.startsWith("http")) {
    faviconUrl = faviconUrl.startsWith("/") ? baseUrl + faviconUrl : baseUrl + "/" + faviconUrl;
  }

  // --- OG image ---
  const ogImageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  );

  // --- Page title ---
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  // --- Meta description ---
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
  );

  return {
    cssVars: cssVars.join("\n").slice(0, 2000) || null,
    buttonColors: buttonColors.join(", ").slice(0, 500) || null,
    linkColors: linkColors.join(", ").slice(0, 300) || null,
    gradients: gradientMatches.slice(0, 5).join("\n").slice(0, 500) || null,
    brandCandidateColors: sortedHex.join(", ").slice(0, 1000) || null,
    themeColor: themeColorMatch?.[1] || null,
    fonts: uniqueFonts.join(", ").slice(0, 500) || null,
    logoUrl: faviconUrl,
    ogImage: ogImageMatch?.[1] || null,
    pageTitle: titleMatch?.[1]?.trim() || null,
    metaDescription: descMatch?.[1] || null,
  };
}