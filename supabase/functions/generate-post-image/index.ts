import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Map platform + format → Gemini native aspect ratio */
function getAspectRatio(platform?: string, format?: string): string {
  if (!platform) return "1:1";
  const p = (platform + " " + (format || "")).toLowerCase();
  if (p.includes("story") || p.includes("reel") || p.includes("tiktok")) return "9:16";
  if (p.includes("linkedin") || p.includes("article")) return "16:9";
  if (p.includes("pinterest")) return "2:3";
  return "1:1";
}

function getOrientationLabel(ratio: string): string {
  if (ratio === "9:16" || ratio === "2:3") return "vertical/portrait";
  if (ratio === "16:9") return "horizontal/landscape";
  return "square";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, platform, format, brand_context } = await req.json();

    if (!prompt) {
      return jsonResp({ error: "prompt is required" }, 400);
    }

    // ── Get Gemini API key (try env, then app_settings) ──
    let geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");

    if (!geminiKey) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      // Try gemini key first, then google key
      for (const keyName of ["gemini_api_key", "google_ai_api_key"]) {
        const { data: setting } = await supabase.from("app_settings").select("value").eq("key", keyName).maybeSingle();
        if (setting?.value) {
          geminiKey = setting.value;
          break;
        }
      }
    }

    if (!geminiKey) {
      return jsonResp(
        {
          error:
            "Gemini API key not configured. Add GEMINI_API_KEY to your Supabase environment secrets or add a row with key='gemini_api_key' to the app_settings table.",
        },
        400,
      );
    }

    // ── Build the design prompt ──
    const aspectRatio = getAspectRatio(platform, format);
    const orientation = getOrientationLabel(aspectRatio);
    const designPrompt = buildDesignPrompt(
      prompt,
      platform,
      format,
      { ratio: aspectRatio, orientation },
      brand_context,
    );

    // ── Call Gemini 3.1 Flash Image (Nano Banana 2) ──
    const geminiModel = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: designPrompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: "2K",
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return jsonResp({ error: `Gemini API error: ${response.status}`, details: errorBody }, 502);
    }

    const result = await response.json();

    // ── Extract image from response ──
    const candidates = result.candidates || [];
    let imageB64: string | null = null;
    let imageMime: string | null = null;
    let textResponse: string | null = null;

    for (const candidate of candidates) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          imageB64 = part.inlineData.data;
          imageMime = part.inlineData.mimeType || "image/png";
        }
        if (part.text) {
          textResponse = part.text;
        }
      }
    }

    if (!imageB64) {
      return jsonResp(
        {
          error: "No image generated. The model may have refused the prompt or returned text only.",
          details: textResponse || JSON.stringify(result).slice(0, 500),
        },
        500,
      );
    }

    const imageUrl = `data:${imageMime};base64,${imageB64}`;

    return jsonResp({ image_url: imageUrl, revised_prompt: textResponse });
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

/**
 * Build a strict, no-hallucination design prompt.
 * Key principle: use brand colors as a palette, NEVER generate logos or brand text.
 */
function buildDesignPrompt(
  basePrompt: string,
  platform?: string,
  format?: string,
  aspect?: { ratio: string; orientation: string },
  brand?: any,
): string {
  const sections: string[] = [];

  // ── 1. Strict rules — prevent hallucination ──
  sections.push(`STRICT RULES (MUST follow):
- DO NOT generate any logos, brand marks, wordmarks, monograms, or brand names anywhere in the image
- DO NOT invent or hallucinate any company name, product name, or brand text
- DO NOT include any text that looks like a logo or brand identity
- If the design includes text, only use the exact headline/copy provided in the content direction below
- This is a BACKGROUND/VISUAL ASSET for a social media post — the client will overlay their own logo and branding afterwards
- Focus on creating a beautiful, on-brand visual composition using ONLY the color palette provided`);

  // ── 2. Image format ──
  sections.push(`IMAGE FORMAT:
- Aspect ratio: ${aspect?.ratio || "1:1"} (${aspect?.orientation || "square"})
- All elements must be fully contained within the frame with generous safe margins
- Leave at least 15% padding from all edges — nothing should be cut off
- Clean, balanced composition with clear visual hierarchy`);

  // ── 3. Brand color palette (exact hex values only) ──
  if (brand) {
    const colorLines: string[] = [];
    if (brand.primary_color)
      colorLines.push(`PRIMARY: ${brand.primary_color} — use as the dominant color (30-40% of the design)`);
    if (brand.secondary_color)
      colorLines.push(`SECONDARY: ${brand.secondary_color} — use for backgrounds or large areas (20-30%)`);
    if (brand.accent_color)
      colorLines.push(`ACCENT: ${brand.accent_color} — use sparingly for highlights and emphasis (10-15%)`);

    if (colorLines.length > 0) {
      sections.push(`COLOR PALETTE (use ONLY these exact brand colors + white/near-black for contrast):
${colorLines.join("\n")}
- You may also use white (#FFFFFF), off-white (#F5F5F5), and near-black (#1A1A1A) as neutral support colors
- DO NOT use any other colors outside this palette`);
    }

    // Style direction
    const styleParts: string[] = [];
    if (brand.visual_style) styleParts.push(`Visual style: ${brand.visual_style}`);
    if (brand.tone_of_voice) styleParts.push(`Mood/tone: ${brand.tone_of_voice}`);
    if (brand.design_elements) styleParts.push(`Design elements: ${brand.design_elements}`);
    if (brand.background_style) styleParts.push(`Background approach: ${brand.background_style}`);
    if (brand.font_family) styleParts.push(`If text is needed, use a style similar to: ${brand.font_family}`);

    if (styleParts.length > 0) {
      sections.push(`BRAND STYLE DIRECTION:
${styleParts.join("\n")}`);
    }
  }

  // ── 4. Platform guidance ──
  const p = (platform || "").toLowerCase();
  if (p.includes("instagram") || p.includes("tiktok")) {
    sections.push(`PLATFORM CONTEXT: ${platform} ${format || ""}
- Design for mobile-first viewing — bold, thumb-stopping visual
- High contrast between foreground and background elements`);
  } else if (p.includes("linkedin")) {
    sections.push(`PLATFORM CONTEXT: LinkedIn
- Professional, polished, corporate-friendly aesthetic`);
  } else if (p.includes("facebook")) {
    sections.push(`PLATFORM CONTEXT: Facebook
- Shareable, attention-grabbing, clear visual`);
  } else if (p.includes("youtube")) {
    sections.push(`PLATFORM CONTEXT: YouTube
- Bold, cinematic feel, high visual impact`);
  }

  // ── 5. Quality ──
  sections.push(`DESIGN QUALITY:
- Professional social media graphic quality — polished, modern, editorial
- Strong visual hierarchy and intentional use of space
- The output should look like it was created by a professional graphic designer
- Avoid generic stock imagery aesthetics — be specific and intentional with every element`);

  // ── 6. The actual creative direction ──
  sections.push(`CREATIVE DIRECTION:\n${basePrompt}`);

  return sections.join("\n\n");
}
