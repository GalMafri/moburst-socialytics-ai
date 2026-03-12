import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { website_url, client_name } = await req.json();

    if (!website_url) {
      return jsonResponse({ error: "website_url is required" }, 400);
    }

    // Normalize URL
    let normalizedUrl = website_url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    const baseUrl = new URL(normalizedUrl).origin;

    // ── 1. Fetch the website HTML ──
    let html: string;
    try {
      const resp = await fetch(normalizedUrl, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
        redirect: "follow",
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
    } catch (fetchErr: any) {
      return jsonResponse({ error: `Failed to fetch website: ${fetchErr.message}` }, 400);
    }

    // ── 2. Extract image URLs (logo, OG image, apple-touch-icon) ──
    const imageUrls = extractImageUrls(html, baseUrl);

    // ── 3. Fetch external CSS (up to 4 files) for font/color signals ──
    const cssText = await fetchExternalCss(html, baseUrl);
    const signals = extractTextSignals(html, cssText);

    // ── 4. Fetch images as base64 for GPT-4o Vision ──
    const visionImages = await fetchImagesAsBase64(imageUrls);

    // ── 5. Get OpenAI API key ──
    let openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "openai_api_key")
        .maybeSingle();
      openaiKey = setting?.value;
    }
    if (!openaiKey) {
      return jsonResponse({ error: "OpenAI API key not configured." }, 400);
    }

    // ── 6. Call GPT-4o Vision with images + text signals ──
    const messages: any[] = [
      {
        role: "system",
        content: `You are an elite brand identity analyst. You will receive images from a brand's website (logo, OG image, icons) along with CSS/meta data. Your job is to extract the PRECISE brand identity.

CRITICAL RULES:
- Colors MUST be exact hex codes from the actual brand assets — look at the logo and images carefully
- Primary color = the single most dominant color in the logo/brand mark
- Secondary color = the second brand color visible in the logo, website header, or CTA buttons
- Accent color = highlight/complementary color used for emphasis
- NEVER guess generic colors. If you can see the logo, extract colors FROM the logo pixels
- For tone_of_voice, analyze the meta description, page title, and visual feel
- For design_elements, describe the actual visual patterns you see (gradients, shapes, photo style, etc.)

Return ONLY valid JSON with this exact structure:
{
  "primary_color": "#hex",
  "secondary_color": "#hex",
  "accent_color": "#hex",
  "font_family": "Primary Brand Font Name",
  "visual_style": "5-15 word description of overall design aesthetic",
  "logo_description": "brief description of the logo/brand mark you can see",
  "tone_of_voice": "3-8 word description of the brand's communication style (e.g. 'Warm, approachable, health-conscious')",
  "design_elements": "key visual patterns: gradients, shapes, photography style, textures, etc.",
  "background_style": "preferred background approach (e.g. 'soft gradients', 'solid colors', 'lifestyle photography', 'clean white')"
}`,
      },
      {
        role: "user",
        content: [] as any[],
      },
    ];

    // Add text prompt
    messages[1].content.push({
      type: "text",
      text: `Analyze the brand identity for "${client_name || "this company"}" — website: ${normalizedUrl}

=== CSS CUSTOM PROPERTIES ===
${signals.cssVars || "none found"}

=== PROMINENT COLORS FROM CSS (non-generic, by frequency) ===
${signals.topColors || "none found"}

=== FONT REFERENCES ===
${signals.fonts || "none found"}

=== META ===
Title: ${signals.pageTitle || "not found"}
Description: ${signals.metaDescription || "not found"}
Theme color: ${signals.themeColor || "not found"}

Look at the attached images carefully to identify the EXACT brand colors from the logo and visual assets.`,
    });

    // Add images
    for (const img of visionImages) {
      messages[1].content.push({
        type: "image_url",
        image_url: { url: img.dataUrl, detail: "high" },
      });
      messages[1].content.push({
        type: "text",
        text: `[Above image: ${img.label}]`,
      });
    }

    if (visionImages.length === 0) {
      messages[1].content.push({
        type: "text",
        text: "[No images could be fetched — rely on CSS data and page meta to infer brand colors]",
      });
    }

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        temperature: 0.15,
        max_tokens: 600,
      }),
    });

    if (!gptResponse.ok) {
      const errorBody = await gptResponse.text().catch(() => "");
      return jsonResponse({ error: `OpenAI API error: ${gptResponse.status}`, details: errorBody }, 502);
    }

    const gptResult = await gptResponse.json();
    const content = gptResult.choices?.[0]?.message?.content || "";

    // ── 7. Parse JSON response ──
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return jsonResponse({ error: "Could not parse brand identity from AI response", raw: content }, 500);
    }

    let brandIdentity;
    try {
      brandIdentity = JSON.parse(jsonMatch[0]);
    } catch {
      return jsonResponse({ error: "Invalid JSON in AI response", raw: content }, 500);
    }

    return jsonResponse({ brand_identity: brandIdentity });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
});

// ────────────────────── Helpers ──────────────────────

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Extract logo, OG image, apple-touch-icon, and favicon URLs from HTML */
function extractImageUrls(html: string, baseUrl: string): { url: string; label: string }[] {
  const results: { url: string; label: string }[] = [];

  // Look for logo in common patterns: img with "logo" in src, alt, or class
  const logoImgMatch =
    html.match(/<img[^>]*(?:class=["'][^"']*logo[^"']*["']|alt=["'][^"']*logo[^"']*["'])[^>]*src=["']([^"']+)["']/i) ||
    html.match(/<img[^>]*src=["']([^"']*logo[^"']+)["']/i);
  if (logoImgMatch) {
    results.push({ url: resolveUrl(logoImgMatch[1], baseUrl), label: "Logo image from page" });
  }

  // SVG logo in header/nav
  const headerLogoSvg = html.match(/<(?:header|nav)[^>]*>[\s\S]{0,3000}<img[^>]*src=["']([^"']+\.svg[^"']*)["']/i);
  if (headerLogoSvg) {
    const svgUrl = resolveUrl(headerLogoSvg[1], baseUrl);
    if (!results.some((r) => r.url === svgUrl)) {
      results.push({ url: svgUrl, label: "Header/nav logo SVG" });
    }
  }

  // Apple touch icon (usually high-res logo)
  const appleTouchMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
  if (appleTouchMatch) results.push({ url: resolveUrl(appleTouchMatch[1], baseUrl), label: "Apple touch icon (brand logo)" });

  // Favicon
  const faviconMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
  if (faviconMatch) results.push({ url: resolveUrl(faviconMatch[1], baseUrl), label: "Favicon" });

  // OG image
  const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) results.push({ url: resolveUrl(ogMatch[1], baseUrl), label: "OG image (social share preview)" });

  // Twitter card image
  const twitterMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
  if (twitterMatch && twitterMatch[1] !== ogMatch?.[1]) {
    results.push({ url: resolveUrl(twitterMatch[1], baseUrl), label: "Twitter card image" });
  }

  return results.slice(0, 5);
}

function resolveUrl(href: string, baseUrl: string): string {
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return baseUrl + href;
  if (href.startsWith("http")) return href;
  return baseUrl + "/" + href;
}

/** Fetch up to 4 external CSS files and return combined text */
async function fetchExternalCss(html: string, baseUrl: string): Promise<string> {
  const cssLinkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi;
  const urls: string[] = [];
  let m;
  while ((m = cssLinkRegex.exec(html)) !== null && urls.length < 4) {
    urls.push(resolveUrl(m[1], baseUrl));
  }
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
        if (!resp.ok) return "";
        return (await resp.text()).slice(0, 40000);
      } catch {
        return "";
      }
    }),
  );
  return results.join("\n");
}

/** Fetch images and convert to base64 data URLs for GPT-4o Vision */
async function fetchImagesAsBase64(images: { url: string; label: string }[]): Promise<{ dataUrl: string; label: string }[]> {
  const results: { dataUrl: string; label: string }[] = [];

  for (const img of images) {
    if (results.length >= 3) break;
    try {
      const resp = await fetch(img.url, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
      if (!resp.ok) continue;

      const contentType = resp.headers.get("content-type") || "image/png";

      // Handle SVGs
      if (contentType.includes("svg")) {
        const svgText = await resp.text();
        if (svgText.length > 50000) continue;
        const b64 = btoa(unescape(encodeURIComponent(svgText)));
        results.push({ dataUrl: `data:image/svg+xml;base64,${b64}`, label: img.label });
        continue;
      }

      // Raster images
      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > 5_000_000 || buffer.byteLength < 100) continue;

      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      const mime = contentType.split(";")[0].trim();
      results.push({ dataUrl: `data:${mime};base64,${b64}`, label: img.label });
    } catch {
      // skip
    }
  }
  return results;
}

/** Extract text-based signals from HTML + CSS */
function extractTextSignals(html: string, css: string) {
  const combined = html + "\n" + css;

  // CSS custom properties
  const cssVarRegex = /--[\w-]*(color|brand|primary|secondary|accent|theme|main|cta|btn|highlight)[\w-]*\s*:\s*([^;}\n]+)/gi;
  const cssVars: string[] = [];
  let vm;
  while ((vm = cssVarRegex.exec(combined)) !== null && cssVars.length < 25) {
    cssVars.push(vm[0].trim());
  }

  // Non-generic hex colors by frequency
  const allHex = combined.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const counts = new Map<string, number>();
  for (const h of allHex) {
    const lower = h.toLowerCase();
    if (!isGenericColor(lower)) {
      counts.set(lower, (counts.get(lower) || 0) + 1);
    }
  }
  const topColors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([c, n]) => `${c} (${n}x)`);

  // Fonts
  const googleFonts = combined.match(/fonts\.googleapis\.com\/css2?\?family=([^"'&\s)]+)/gi) || [];
  const fontFamilies = combined.match(/font-family\s*:\s*["']?([^;}"'\n,]+)/gi) || [];
  const cleaned = fontFamilies
    .map((f) => f.replace(/font-family\s*:\s*/i, "").replace(/["']/g, "").trim())
    .filter((f) => !/(sans-serif|serif|monospace|system-ui|inherit|initial|-apple|BlinkMac|Segoe|Arial|Helvetica|Times|Roboto\s*,)/i.test(f));
  const uniqueFonts = [
    ...new Set([
      ...googleFonts.map((f) => decodeURIComponent(f.replace(/.*family=/, "").replace(/[+:].*/g, " ").trim())),
      ...cleaned.slice(0, 8),
    ]),
  ];

  const themeColor = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
  const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;

  return {
    cssVars: cssVars.join("\n").slice(0, 1500) || null,
    topColors: topColors.join(", ").slice(0, 800) || null,
    fonts: uniqueFonts.join(", ").slice(0, 400) || null,
    themeColor,
    pageTitle,
    metaDescription: metaDesc,
  };
}

const GENERIC_HEX = new Set([
  "#fff", "#ffffff", "#000", "#000000", "#333", "#333333",
  "#666", "#666666", "#999", "#999999", "#ccc", "#cccccc",
  "#ddd", "#dddddd", "#eee", "#eeeeee", "#f5f5f5", "#fafafa",
  "#f8f8f8", "#e5e5e5", "#d4d4d4", "#a3a3a3", "#737373",
  "#525252", "#404040", "#262626", "#171717", "#0a0a0a",
  "#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af",
  "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827",
]);

function isGenericColor(hex: string): boolean {
  const h = hex.toLowerCase().replace(/\s/g, "");
  if (GENERIC_HEX.has(h)) return true;
  let full = h;
  if (/^#[0-9a-f]{3}$/i.test(h)) full = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (GENERIC_HEX.has(full)) return true;
  const match = full.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (match) {
    const [r, g, b] = [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
    if (Math.max(r, g, b) - Math.min(r, g, b) < 15) return true;
  }
  return false;
}