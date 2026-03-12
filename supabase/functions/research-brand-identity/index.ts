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

    const debug: string[] = [];

    // ── 1. Fetch the website HTML ──
    let html: string;
    try {
      const resp = await fetch(normalizedUrl, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
        redirect: "follow",
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      html = await resp.text();
      debug.push(`Fetched HTML directly (${html.length} chars)`);
    } catch (fetchErr: any) {
      debug.push(`Direct fetch failed: ${fetchErr.message}`);
      const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
      if (!firecrawlKey) {
        return jsonResponse(
          { error: `Failed to fetch website: ${fetchErr.message}. Firecrawl fallback not configured.` },
          400,
        );
      }
      try {
        const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: normalizedUrl, formats: ["html"], waitFor: 5000 }),
        });
        if (!fcResp.ok) throw new Error(`Firecrawl ${fcResp.status}`);
        const fcData = await fcResp.json();
        html = fcData.data?.html || fcData.html || "";
        if (!html) throw new Error("Firecrawl returned empty HTML");
        debug.push(`Fetched via Firecrawl (${html.length} chars)`);
      } catch (fcErr: any) {
        return jsonResponse({ error: `Failed to fetch website: ${fcErr.message}` }, 400);
      }
    }

    // ── 2. Extract structured color data (EXACT sources) ──
    const structuredColors = extractStructuredColors(html, baseUrl, debug);

    // ── 2b. Fetch external SVG logos and extract colors from source ──
    const svgLogoUrls = extractSvgLogoUrls(html, baseUrl);
    const svgColors = await fetchSvgColors(svgLogoUrls, debug);

    // ── 3. Fetch external CSS for more signals ──
    const cssText = await fetchExternalCss(html, baseUrl);
    const cssStructured = extractCssStructuredColors(cssText, debug);

    // Merge structured colors: SVG fills > inline SVG > CSS vars > meta tags > CSS rules
    const mergedColors = [...svgColors, ...structuredColors, ...cssStructured];

    // Deduplicate by hex
    const seenHex = new Set<string>();
    const finalStructured: StructuredColor[] = [];
    for (const c of mergedColors) {
      if (!seenHex.has(c.hex)) {
        seenHex.add(c.hex);
        finalStructured.push(c);
      }
    }

    // ── 4. Extract image URLs for GPT-4o qualitative analysis ──
    const imageUrls = extractImageUrls(html, baseUrl);
    debug.push(`Found ${imageUrls.length} image URL(s): ${imageUrls.map((i) => i.label).join(", ") || "none"}`);

    // ── 5. Fetch raster images for Vision (skip SVGs — we already parsed those) ──
    const visionImages = await fetchRasterImagesAsBase64(imageUrls, debug);

    // ── 6. Extract text signals ──
    const textSignals = extractTextSignals(html, cssText);

    // ── 7. Get OpenAI API key ──
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
      return jsonResponse({ error: "OpenAI API key not configured." }, 400);
    }

    // ── 8. Build GPT prompt — adaptive based on available data ──
    const hasStructured = finalStructured.length > 0;
    const hasHighConfidence = finalStructured.some((c) => c.confidence === "high");
    const hasImages = visionImages.length > 0;
    const hasAnyData = hasStructured || hasImages || textSignals.themeColor || textSignals.pageTitle;

    const structuredColorSummary = hasStructured
      ? finalStructured.map((c) => `${c.hex} — source: ${c.source} (confidence: ${c.confidence})`).join("\n")
      : "None found";

    // Build color instructions based on what data is available
    let colorInstructions: string;
    if (hasHighConfidence) {
      colorInstructions = `High-confidence colors were extracted from the site's source code (SVG logos, CSS variables, meta tags).
These are EXACT hex values — use them as your primary source for primary_color, secondary_color, and accent_color.
Pick from the structured color list below. Only deviate if an image clearly contradicts the code data.`;
    } else if (hasStructured) {
      colorInstructions = `Some colors were found in the site's CSS/meta data (medium confidence).
Use these as strong hints for the brand colors. Pick the most likely brand colors from the list below.`;
    } else if (hasImages) {
      colorInstructions = `No colors were found in the source code, but images are available.
Analyze the images to identify the brand's primary, secondary, and accent colors.
Look at logo colors, header colors, and prominent UI elements in the images.`;
    } else {
      colorInstructions = `Limited data is available. Make your BEST GUESS based on the company name, page title, and meta description.
Choose plausible, professional brand colors. Avoid generic choices.
This is a best-effort analysis — the user will review and correct the results.`;
    }

    const messages: any[] = [
      {
        role: "system",
        content: `You are a brand identity analyst. Analyze the provided data and return a brand identity profile.

COLOR SELECTION GUIDANCE:
${colorInstructions}

FIELD DEFINITIONS:
- primary_color: the brand's main/dominant color (hex)
- secondary_color: supporting brand color (hex)
- accent_color: highlight/emphasis color (hex)
- font_family: the brand's primary typeface
- visual_style: 5-15 word description of the design aesthetic
- logo_description: brief description of the logo/brand mark
- tone_of_voice: 3-8 word description of brand communication style
- design_elements: key visual patterns (gradients, shapes, textures, etc.)
- background_style: preferred background approach for social media

MANDATORY RULES:
- You MUST always return valid JSON — never refuse or explain why you can't.
- You MUST fill in ALL fields with your best assessment, even if data is limited.
- For colors, ALWAYS return hex codes (e.g. "#2563eb"), never "unknown" or empty strings.
- Avoid generic greys (#666, #999) and pure black/white as brand colors.
- If unsure about a text field, provide a reasonable default based on the company name and industry.

Return ONLY a JSON object with this exact structure (no markdown, no explanation, no preamble):
{"primary_color":"#hex","secondary_color":"#hex","accent_color":"#hex","font_family":"Font Name","visual_style":"description","logo_description":"description","tone_of_voice":"description","design_elements":"description","background_style":"description"}`,
      },
      {
        role: "user",
        content: [] as any[],
      },
    ];

    // Text prompt with all available data
    const dataAvailability = [
      hasStructured ? `${finalStructured.length} colors from source code` : null,
      hasImages ? `${visionImages.length} image(s)` : null,
      textSignals.pageTitle ? "page title" : null,
      textSignals.metaDescription ? "meta description" : null,
      textSignals.themeColor ? "theme-color meta" : null,
      textSignals.fonts ? "font references" : null,
    ]
      .filter(Boolean)
      .join(", ");

    messages[1].content.push({
      type: "text",
      text: `Brand identity analysis for "${client_name || "this company"}" — ${normalizedUrl}

Available data: ${dataAvailability || "minimal (company name and URL only)"}

=== STRUCTURED COLORS FROM SOURCE CODE ===
${structuredColorSummary}

=== FONT REFERENCES ===
${textSignals.fonts || "none found"}

=== PAGE META ===
Title: ${textSignals.pageTitle || "not found"}
Description: ${textSignals.metaDescription || "not found"}
Theme color: ${textSignals.themeColor || "not found"}

Return the JSON brand identity object now.`,
    });

    // Add raster images
    for (const img of visionImages) {
      messages[1].content.push({
        type: "image_url",
        image_url: { url: img.dataUrl, detail: "high" },
      });
      messages[1].content.push({
        type: "text",
        text: `[Image: ${img.label}]`,
      });
    }

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages,
        temperature: 0.1,
        max_tokens: 800,
      }),
    });

    if (!gptResponse.ok) {
      const errorBody = await gptResponse.text().catch(() => "");
      return jsonResponse({ error: `OpenAI API error: ${gptResponse.status}`, details: errorBody }, 502);
    }

    const gptResult = await gptResponse.json();
    const content = gptResult.choices?.[0]?.message?.content || "";

    // ── 9. Parse JSON response — with fallback ──
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    let brandIdentity;

    if (jsonMatch) {
      try {
        brandIdentity = JSON.parse(jsonMatch[0]);
      } catch {
        // JSON parsing failed — fall through to fallback
        debug.push("GPT returned invalid JSON, using fallback");
      }
    } else {
      debug.push("GPT refused to return JSON, using fallback from structured data");
    }

    // Fallback: build identity from whatever structured data we have
    if (!brandIdentity) {
      const colors = finalStructured.map((c) => c.hex);
      brandIdentity = {
        primary_color: colors[0] || textSignals.themeColor || "#2563eb",
        secondary_color: colors[1] || "#1e40af",
        accent_color: colors[2] || "#f59e0b",
        font_family: textSignals.fonts?.split(",")[0]?.trim() || "Sans-serif",
        visual_style: "Modern, professional web design",
        logo_description: "Could not be determined — add manually",
        tone_of_voice: "Professional, informative",
        design_elements: "Clean layouts, standard web design patterns",
        background_style: "Clean white or light backgrounds",
      };
      debug.push(`Fallback identity built with ${colors.length} structured color(s)`);
    }

    return jsonResponse({
      brand_identity: brandIdentity,
      _debug: {
        structured_colors_found: finalStructured.length,
        structured_colors: finalStructured.slice(0, 10),
        images_found: imageUrls.length,
        raster_images_sent: visionImages.length,
        log: debug,
      },
    });
  } catch (err: any) {
    return jsonResponse({ error: err.message }, 500);
  }
});

// ────────────────── Helpers ──────────────────

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface StructuredColor {
  hex: string;
  source: string;
  confidence: "high" | "medium" | "low";
}

// ── Extract EXACT colors from structured sources in HTML ──
function extractStructuredColors(html: string, baseUrl: string, debug: string[]): StructuredColor[] {
  const colors: StructuredColor[] = [];
  const seen = new Set<string>();

  const addColor = (hex: string, source: string, confidence: "high" | "medium" | "low") => {
    const normalized = normalizeHex(hex);
    if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      colors.push({ hex: normalized, source, confidence });
    }
  };

  // 1. SVG logos embedded in HTML — extract fill/stroke colors (HIGHEST confidence)
  const svgBlocks = html.match(/<svg[\s\S]*?<\/svg>/gi) || [];
  debug.push(`Found ${svgBlocks.length} inline SVG(s)`);
  for (const svg of svgBlocks.slice(0, 5)) {
    // Check if this SVG is likely a logo (in header/nav, or has logo-related attributes)
    const isLikelyLogo = /logo|brand|icon/i.test(svg) || html.indexOf(svg) < html.length * 0.3; // in the top 30% of the page

    if (!isLikelyLogo && svgBlocks.length > 2) continue;

    // Extract fill colors
    const fills = svg.match(/fill=["']([^"']+)["']/gi) || [];
    for (const f of fills) {
      const val = f.match(/fill=["']([^"']+)["']/i)?.[1];
      if (val && val !== "none" && val !== "currentColor" && val !== "inherit") {
        addColor(val, "SVG logo fill", "high");
      }
    }
    // Extract stroke colors
    const strokes = svg.match(/stroke=["']([^"']+)["']/gi) || [];
    for (const s of strokes) {
      const val = s.match(/stroke=["']([^"']+)["']/i)?.[1];
      if (val && val !== "none" && val !== "currentColor" && val !== "inherit") {
        addColor(val, "SVG logo stroke", "high");
      }
    }
    // Extract colors from inline style in SVG
    const svgStyles = svg.match(/style=["'][^"']*(?:fill|stroke|color)\s*:\s*([^;"']+)/gi) || [];
    for (const s of svgStyles) {
      const colorMatch = s.match(/(?:fill|stroke|color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/i);
      if (colorMatch) addColor(colorMatch[1], "SVG inline style", "high");
    }
  }

  // 2. Meta theme-color (HIGH confidence)
  const themeColor = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (themeColor) {
    addColor(themeColor, "meta theme-color", "high");
  }

  // Also check MS application tile color
  const msColor = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (msColor) addColor(msColor, "msapplication-TileColor", "high");

  // 4. CSS custom properties with brand-related names (HIGH confidence)
  const cssVarRegex = /--[\w-]*(brand|primary|secondary|accent|main|cta|theme)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  let vm;
  while ((vm = cssVarRegex.exec(html)) !== null) {
    addColor(vm[2], `CSS var: ${vm[0].split(":")[0].trim()}`, "high");
  }

  // 5. Inline styles on header/nav/button elements (MEDIUM confidence)
  const headerStyles =
    html.match(
      /<(?:header|nav|a|button)[^>]*style=["'][^"']*(?:background-color|background|color)\s*:\s*(#[0-9a-fA-F]{3,8})/gi,
    ) || [];
  for (const s of headerStyles.slice(0, 10)) {
    const hex = s.match(/(#[0-9a-fA-F]{3,8})/)?.[1];
    if (hex) addColor(hex, "header/nav/button inline style", "medium");
  }

  return colors;
}

/** Extract external SVG logo URLs from HTML */
function extractSvgLogoUrls(html: string, baseUrl: string): string[] {
  const urls: string[] = [];
  // img tags with logo + .svg
  const logoSvgs = html.match(/<img[^>]*src=["']([^"']*\.svg[^"']*)["'][^>]*/gi) || [];
  for (const tag of logoSvgs) {
    if (/logo|brand|icon/i.test(tag)) {
      const src = tag.match(/src=["']([^"']+)["']/)?.[1];
      if (src) urls.push(resolveUrl(src, baseUrl));
    }
  }
  // Header/nav SVG images
  const headerSvg = html.match(/<(?:header|nav)[^>]*>[\s\S]{0,3000}<img[^>]*src=["']([^"']+\.svg[^"']*)["']/i);
  if (headerSvg) {
    const url = resolveUrl(headerSvg[1], baseUrl);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls.slice(0, 3);
}

/** Fetch external SVG files and extract colors from their source */
async function fetchSvgColors(svgUrls: string[], debug: string[]): Promise<StructuredColor[]> {
  const colors: StructuredColor[] = [];
  const seen = new Set<string>();

  for (const url of svgUrls) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
      if (!resp.ok) {
        debug.push(`SVG fetch failed (${resp.status}): ${url}`);
        continue;
      }
      const svgText = await resp.text();
      if (svgText.length > 100000 || !svgText.includes("<svg")) {
        debug.push(`SVG invalid or too large: ${url}`);
        continue;
      }

      debug.push(`Fetched SVG (${svgText.length} chars): ${url}`);

      // Extract fills
      const fills = svgText.match(/fill=["']([^"']+)["']/gi) || [];
      for (const f of fills) {
        const val = f.match(/fill=["']([^"']+)["']/i)?.[1];
        if (val && val !== "none" && val !== "currentColor" && val !== "inherit" && val !== "transparent") {
          const normalized = normalizeHex(val);
          if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
            seen.add(normalized);
            colors.push({ hex: normalized, source: `External SVG fill (${url.split("/").pop()})`, confidence: "high" });
          }
        }
      }

      // Extract strokes
      const strokes = svgText.match(/stroke=["']([^"']+)["']/gi) || [];
      for (const s of strokes) {
        const val = s.match(/stroke=["']([^"']+)["']/i)?.[1];
        if (val && val !== "none" && val !== "currentColor" && val !== "inherit" && val !== "transparent") {
          const normalized = normalizeHex(val);
          if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
            seen.add(normalized);
            colors.push({
              hex: normalized,
              source: `External SVG stroke (${url.split("/").pop()})`,
              confidence: "high",
            });
          }
        }
      }

      // Extract colors from style blocks inside SVG
      const styleBlocks = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
      for (const block of styleBlocks) {
        const hexes = block.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        for (const hex of hexes) {
          const normalized = normalizeHex(hex);
          if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
            seen.add(normalized);
            colors.push({ hex: normalized, source: "SVG internal stylesheet", confidence: "high" });
          }
        }
      }
    } catch (err: any) {
      debug.push(`SVG fetch error: ${url} — ${err.message}`);
    }
  }

  return colors;
}

// ── Extract colors from external CSS files ──
function extractCssStructuredColors(cssText: string, debug: string[]): StructuredColor[] {
  const colors: StructuredColor[] = [];
  const seen = new Set<string>();

  // CSS custom properties with brand-related names
  const cssVarRegex =
    /--[\w-]*(brand|primary|secondary|accent|main|cta|theme|highlight)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
  let m;
  while ((m = cssVarRegex.exec(cssText)) !== null) {
    const normalized = normalizeHex(m[2]);
    if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      colors.push({ hex: normalized, source: `CSS var: ${m[0].split(":")[0].trim()}`, confidence: "high" });
    }
  }

  // Colors in button/CTA/header rules (MEDIUM confidence)
  const ctaRules = cssText.match(/(?:\.btn|\.button|\.cta|\.header|\.nav|\.primary|\.brand)[\w-]*\s*\{[^}]*\}/gi) || [];
  for (const rule of ctaRules.slice(0, 15)) {
    const hexes = rule.match(/(#[0-9a-fA-F]{3,8})\b/g) || [];
    for (const hex of hexes) {
      const normalized = normalizeHex(hex);
      if (normalized && !isGenericColor(normalized) && !seen.has(normalized)) {
        seen.add(normalized);
        colors.push({ hex: normalized, source: "CSS button/CTA/header rule", confidence: "medium" });
      }
    }
  }

  debug.push(`Extracted ${colors.length} color(s) from external CSS`);
  return colors;
}

/** Extract image URLs for GPT-4o Vision (raster only) */
function extractImageUrls(html: string, baseUrl: string): { url: string; label: string; isSvg: boolean }[] {
  const results: { url: string; label: string; isSvg: boolean }[] = [];

  // Logo images (any format)
  const logoImgMatch =
    html.match(/<img[^>]*(?:class=["'][^"']*logo[^"']*["']|alt=["'][^"']*logo[^"']*["'])[^>]*src=["']([^"']+)["']/i) ||
    html.match(/<img[^>]*src=["']([^"']*logo[^"']+)["']/i);
  if (logoImgMatch) {
    const url = resolveUrl(logoImgMatch[1], baseUrl);
    const isSvg = /\.svg/i.test(url);
    results.push({ url, label: "Logo image", isSvg });
  }

  // Apple touch icon
  const appleTouchMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
  if (appleTouchMatch) {
    results.push({ url: resolveUrl(appleTouchMatch[1], baseUrl), label: "Apple touch icon", isSvg: false });
  }

  // OG image
  const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) {
    results.push({ url: resolveUrl(ogMatch[1], baseUrl), label: "OG social share image", isSvg: false });
  }

  // Favicon (non-SVG)
  const faviconMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
  if (faviconMatch && !/\.svg/i.test(faviconMatch[1])) {
    results.push({ url: resolveUrl(faviconMatch[1], baseUrl), label: "Favicon", isSvg: false });
  }

  return results.slice(0, 5);
}

/** Fetch only RASTER images as base64 for GPT-4o Vision (skip SVGs) */
async function fetchRasterImagesAsBase64(
  images: { url: string; label: string; isSvg: boolean }[],
  debug: string[],
): Promise<{ dataUrl: string; label: string }[]> {
  const results: { dataUrl: string; label: string }[] = [];

  for (const img of images) {
    if (results.length >= 3) break;
    if (img.isSvg) {
      debug.push(`Skipping SVG for Vision (parsed colors from source instead): ${img.label}`);
      continue;
    }

    try {
      const resp = await fetch(img.url, {
        headers: { "User-Agent": BROWSER_UA },
        redirect: "follow",
      });
      if (!resp.ok) {
        debug.push(`Image fetch failed (${resp.status}): ${img.label} — ${img.url}`);
        continue;
      }

      const contentType = resp.headers.get("content-type") || "";

      // Skip if server returned SVG despite non-SVG URL
      if (contentType.includes("svg")) {
        debug.push(`Skipped SVG content-type: ${img.label}`);
        continue;
      }

      const buffer = await resp.arrayBuffer();
      if (buffer.byteLength > 5_000_000) {
        debug.push(`Image too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB): ${img.label}`);
        continue;
      }
      if (buffer.byteLength < 100) {
        debug.push(`Image too small (${buffer.byteLength}B): ${img.label}`);
        continue;
      }

      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      const mime = contentType.split(";")[0].trim() || "image/png";
      results.push({ dataUrl: `data:${mime};base64,${b64}`, label: img.label });
      debug.push(`Fetched raster image (${(buffer.byteLength / 1024).toFixed(0)}KB): ${img.label}`);
    } catch (err: any) {
      debug.push(`Image fetch error: ${img.label} — ${err.message}`);
    }
  }

  return results;
}

function resolveUrl(href: string, baseUrl: string): string {
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return baseUrl + href;
  if (href.startsWith("http")) return href;
  return baseUrl + "/" + href;
}

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

/** Extract non-color text signals from HTML + CSS */
function extractTextSignals(html: string, css: string) {
  const combined = html + "\n" + css;

  // Fonts
  const googleFonts = combined.match(/fonts\.googleapis\.com\/css2?\?family=([^"'&\s)]+)/gi) || [];
  const fontFamilies = combined.match(/font-family\s*:\s*["']?([^;}"'\n,]+)/gi) || [];
  const cleaned = fontFamilies
    .map((f) =>
      f
        .replace(/font-family\s*:\s*/i, "")
        .replace(/["']/g, "")
        .trim(),
    )
    .filter(
      (f) =>
        !/(sans-serif|serif|monospace|system-ui|inherit|initial|-apple|BlinkMac|Segoe|Arial|Helvetica|Times|Roboto\s*,)/i.test(
          f,
        ),
    );
  const uniqueFonts = [
    ...new Set([
      ...googleFonts.map((f) =>
        decodeURIComponent(
          f
            .replace(/.*family=/, "")
            .replace(/[+:].*/g, " ")
            .trim(),
        ),
      ),
      ...cleaned.slice(0, 8),
    ]),
  ];

  const themeColor = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;
  const pageTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;
  const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || null;

  return {
    fonts: uniqueFonts.join(", ").slice(0, 400) || null,
    themeColor,
    pageTitle,
    metaDescription: metaDesc,
  };
}

/** Normalize any hex to lowercase 6-digit format */
function normalizeHex(input: string): string | null {
  let hex = input.trim().toLowerCase();

  // Handle rgb() format
  const rgbMatch = hex.match(/rgb[a]?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  if (!hex.startsWith("#")) return null;

  // Expand 3-digit hex
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }

  // Strip alpha from 8-digit hex
  if (/^#[0-9a-f]{8}$/i.test(hex)) {
    hex = hex.slice(0, 7);
  }

  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return null;
}

const GENERIC_HEX = new Set([
  "#ffffff",
  "#000000",
  "#333333",
  "#666666",
  "#999999",
  "#cccccc",
  "#dddddd",
  "#eeeeee",
  "#f5f5f5",
  "#fafafa",
  "#f8f8f8",
  "#e5e5e5",
  "#d4d4d4",
  "#a3a3a3",
  "#737373",
  "#525252",
  "#404040",
  "#262626",
  "#171717",
  "#0a0a0a",
  "#f9fafb",
  "#f3f4f6",
  "#e5e7eb",
  "#d1d5db",
  "#9ca3af",
  "#6b7280",
  "#4b5563",
  "#374151",
  "#1f2937",
  "#111827",
  "#f0f0f0",
  "#e0e0e0",
  "#d0d0d0",
  "#c0c0c0",
  "#b0b0b0",
  "#a0a0a0",
  "#808080",
  "#606060",
  "#303030",
  "#202020",
  "#101010",
]);

function isGenericColor(hex: string): boolean {
  const h = hex.toLowerCase();
  if (GENERIC_HEX.has(h)) return true;

  const match = h.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (match) {
    const [r, g, b] = [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
    // Grey: all channels within 20 of each other
    if (Math.max(r, g, b) - Math.min(r, g, b) < 20) return true;
  }
  return false;
}
