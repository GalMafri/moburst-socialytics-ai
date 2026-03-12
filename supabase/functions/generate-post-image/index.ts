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
 * Build a design prompt that prioritizes creative direction over restrictions.
 * The prompt leads with WHAT to create, then adds brand context and constraints.
 */
function buildDesignPrompt(
  basePrompt: string,
  platform?: string,
  format?: string,
  aspect?: { ratio: string; orientation: string },
  brand?: any,
): string {
  const sections: string[] = [];

  // ── 1. LEAD with the creative direction (MOST IMPORTANT) ──
  sections.push(`Generate a professional social media graphic based on this creative direction:

${basePrompt}

This must be a COMPLETE, ready-to-post social media image — NOT an abstract background or placeholder.
If the direction mentions photos of people, create realistic photographic content.
If the direction mentions text/headlines/copy overlays, include that exact text beautifully typeset in the image.
The image should look like it was designed by a professional social media designer using tools like Canva or Adobe.`);

  // ── 2. Image format ──
  sections.push(`FORMAT: ${aspect?.ratio || "1:1"} ${aspect?.orientation || "square"} image.
Keep all important elements within safe margins (15% from edges). Clean, balanced composition.`);

  // ── 3. Platform context (brief) ──
  const p = (platform || "").toLowerCase();
  if (p.includes("instagram") || p.includes("tiktok")) {
    sections.push(`PLATFORM: ${platform} ${format || ""} — mobile-first, bold, scroll-stopping. High contrast.`);
  } else if (p.includes("linkedin")) {
    sections.push(`PLATFORM: LinkedIn — professional, polished, corporate-friendly.`);
  } else if (p.includes("facebook")) {
    sections.push(`PLATFORM: Facebook — shareable, attention-grabbing.`);
  } else if (p.includes("youtube")) {
    sections.push(`PLATFORM: YouTube — bold, cinematic, high impact.`);
  }

  // ── 4. Brand colors — guide, not restrict ──
  if (brand) {
    const colorLines: string[] = [];
    if (brand.primary_color) colorLines.push(`Primary: ${brand.primary_color}`);
    if (brand.secondary_color) colorLines.push(`Secondary: ${brand.secondary_color}`);
    if (brand.accent_color) colorLines.push(`Accent: ${brand.accent_color}`);

    if (colorLines.length > 0) {
      sections.push(`BRAND COLORS — use these as the dominant palette:
${colorLines.join(", ")}
Incorporate these colors naturally into backgrounds, overlays, text, and design elements. White and dark neutrals are OK for contrast.`);
    }

    const styleParts: string[] = [];
    if (brand.visual_style) styleParts.push(brand.visual_style);
    if (brand.tone_of_voice) styleParts.push(`Tone: ${brand.tone_of_voice}`);
    if (brand.font_family) styleParts.push(`Typography: ${brand.font_family}`);

    if (styleParts.length > 0) {
      sections.push(`BRAND STYLE: ${styleParts.join(". ")}`);
    }
  }

  // ── 5. Constraints (short, at the end) ──
  sections.push(`IMPORTANT CONSTRAINTS:
- Do NOT include any company logos, brand wordmarks, or watermarks — the client adds those later
- Do NOT invent company names or brand text — only use text from the creative direction above
- Produce a polished, editorial-quality graphic — not stock photography, not abstract art, not clip art`);

  return sections.join("\n\n");
}
