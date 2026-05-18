import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildImagePrompt } from "../_shared/design-prompts/buildImagePrompt.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      prompt,
      platform,
      format,
      brand_context,                  // legacy
      design_references,              // legacy
      brand_book_file_path,           // legacy
      client_context,                 // new — full structured context
      post,                           // new — post-level brief
      slide_context,                  // new — { index, total } for carousels
    } = await req.json();

    // Backward compat: resolve from client_context if present, else legacy fields.
    const resolvedBrand = client_context?.brand_identity ?? brand_context ?? null;
    const resolvedRefs: string[] = client_context?.design_references ?? design_references ?? [];
    const resolvedBrandBookPath: string | null =
      client_context?.brand_book_file_path ?? brand_book_file_path ?? null;
    const resolvedSynthesis = client_context?.design_style_synthesis ?? null;
    const resolvedPillars = client_context?.content_pillars ?? [];
    const resolvedBriefText: string | null = client_context?.brief_text ?? null;
    const resolvedBrandNotes: string | null = client_context?.brand_notes ?? null;
    const resolvedLanguages: string[] = client_context?.languages ?? [];
    const resolvedGeo: string[] = client_context?.geo ?? [];

    console.log("[generate-post-image] context received:", {
      has_brand: !!resolvedBrand,
      ref_count: resolvedRefs.length,
      has_brand_book: !!resolvedBrandBookPath,
      has_synthesis: !!resolvedSynthesis,
      pillar_count: resolvedPillars.length,
      has_brief: !!resolvedBriefText,
    });

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
    const designPrompt = buildImagePrompt({
      basePrompt: prompt,
      platform,
      format,
      brandIdentity: resolvedBrand,
      synthesis: resolvedSynthesis,
      pillars: resolvedPillars,
      briefText: resolvedBriefText,
      brandNotes: resolvedBrandNotes,
      languages: resolvedLanguages,
      geo: resolvedGeo,
      post,
      slideContext: slide_context,
    });

    // ── Fetch design reference images for multimodal input ──
    const contentParts: any[] = [];

    if (resolvedRefs && Array.isArray(resolvedRefs) && resolvedRefs.length > 0) {
      const storageClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

      contentParts.push({ text: "Here are existing brand design references. Match their visual style, layout patterns, and color usage:" });

      for (const ref of resolvedRefs.slice(0, 3)) {
        try {
          const { data: fileData } = await storageClient.storage.from("design-references").download(ref);
          if (fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const ext = ref.split(".").pop()?.toLowerCase();
            const mimeType = ext === "png" ? "image/png" : "image/jpeg";
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          }
        } catch (e) {
          console.error("Failed to fetch design reference:", ref, e);
        }
      }

      contentParts.push({ text: "Now create a new design based on this brief:" });
    }

    // Attach the brand book file as an inline part. Gemini 3.1 supports inline PDF/PNG/JPG.
    if (resolvedBrandBookPath) {
      try {
        const storageClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: fileData } = await storageClient.storage
          .from("brand-books")
          .download(resolvedBrandBookPath);

        if (fileData) {
          const arrayBuffer = await fileData.arrayBuffer();
          if (arrayBuffer.byteLength <= 4 * 1024 * 1024) {
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < uint8Array.length; i++) {
              binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const ext = resolvedBrandBookPath.split(".").pop()?.toLowerCase();
            const mimeType =
              ext === "pdf"
                ? "application/pdf"
                : ext === "png"
                ? "image/png"
                : "image/jpeg";
            contentParts.push({
              text: "Canonical brand book — defer to it on color, typography, and overall identity:",
            });
            contentParts.push({ inlineData: { mimeType, data: base64 } });
          } else {
            console.warn("[generate-post-image] brand book exceeds 4MB, skipping");
          }
        }
      } catch (e) {
        console.error("[generate-post-image] brand book attach failed:", e);
      }
    }

    // Add the main design prompt
    contentParts.push({ text: designPrompt });

    // ── Call Gemini 3.1 Flash Image (Nano Banana 2) ──
    const geminiModel = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: contentParts,
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

