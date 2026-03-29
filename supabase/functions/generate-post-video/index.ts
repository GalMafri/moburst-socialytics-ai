import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getAspectRatio(platform?: string, format?: string): string {
  const fmt = (format || "").toLowerCase();
  const plat = (platform || "").toLowerCase();

  if (fmt.includes("story") || fmt.includes("reel") || plat === "tiktok") return "9:16";
  if (plat === "linkedin" || fmt.includes("article")) return "16:9";
  if (plat === "youtube") return "16:9";
  return "9:16";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, platform, format, brandIdentity } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .single();
      geminiKey = settings?.value;
    }

    if (!geminiKey) {
      throw new Error("Gemini API key not configured");
    }

    const aspectRatio = getAspectRatio(platform, format);

    // Try Veo long-running operation endpoint
    const veoEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${geminiKey}`;

    const response = await fetch(veoEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio,
          durationSeconds: 8,
          numberOfVideos: 1,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Veo API error:", errorText);

      // Fallback to Gemini Flash with video modality
      const altEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`;

      const altResponse = await fetch(altEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `Generate a short video: ${prompt}` },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["VIDEO"],
          },
        }),
      });

      if (!altResponse.ok) {
        const altError = await altResponse.text();
        throw new Error(`Video generation failed: ${altError}`);
      }

      const altData = await altResponse.json();
      const videoPart = altData.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("video/")
      );

      if (videoPart?.inlineData) {
        const videoDataUrl = `data:${videoPart.inlineData.mimeType};base64,${videoPart.inlineData.data}`;
        return new Response(JSON.stringify({ video_url: videoDataUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error("No video generated from fallback model");
    }

    // Handle long-running operation
    const operationData = await response.json();

    if (operationData.name) {
      const operationName = operationData.name;
      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const pollResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${geminiKey}`
        );
        const pollData = await pollResponse.json();

        if (pollData.done) {
          const videoUri = pollData.response?.generatedSamples?.[0]?.video?.uri;
          if (videoUri) {
            return new Response(JSON.stringify({ video_url: videoUri }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw new Error("Operation completed but no video URL found");
        }
      }

      throw new Error("Video generation timed out");
    }

    const videoUri = operationData.response?.generatedSamples?.[0]?.video?.uri ||
      operationData.generatedSamples?.[0]?.video?.uri;

    if (videoUri) {
      return new Response(JSON.stringify({ video_url: videoUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unexpected response format from Veo API");
  } catch (error: any) {
    console.error("Error generating video:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
