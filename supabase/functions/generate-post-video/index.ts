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

// Try multiple Veo model names in order of preference
const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3-generate-preview",
  "veo-2.0-generate-001",
];

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

    // Try each Veo model until one works
    let operationName: string | null = null;
    let lastError = "";

    for (const model of VEO_MODELS) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

      console.log(`Trying Veo model: ${model}`);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            aspectRatio,
            durationSeconds: 8,
            resolution: "720p",
            personGeneration: "allow_all",
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.name) {
          operationName = data.name;
          console.log(`Veo operation started with model ${model}: ${operationName}`);
          break;
        }
      } else {
        lastError = await response.text();
        console.error(`Veo model ${model} failed: ${lastError}`);
      }
    }

    if (!operationName) {
      throw new Error(
        `Video generation failed. None of the Veo models are available for your API key. ` +
        `Make sure your Gemini API key has access to Veo video generation models. ` +
        `You can check availability at https://aistudio.google.com/models/veo-3. ` +
        `Last error: ${lastError.slice(0, 200)}`
      );
    }

    // Poll for completion (Veo is async — takes 30-120 seconds)
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes at 2-second intervals

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      attempts++;

      const pollResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
        {
          headers: { "x-goog-api-key": geminiKey },
        }
      );

      if (!pollResponse.ok) {
        console.error(`Poll failed (attempt ${attempts}): ${pollResponse.status}`);
        continue;
      }

      const pollData = await pollResponse.json();

      if (pollData.done) {
        // Extract video URI from response
        const videoUri =
          pollData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
          pollData.response?.generatedSamples?.[0]?.video?.uri;

        if (videoUri) {
          // The video URI requires the API key to access
          const authenticatedUrl = videoUri.includes("?")
            ? `${videoUri}&key=${geminiKey}`
            : `${videoUri}?key=${geminiKey}`;

          return new Response(
            JSON.stringify({ video_url: authenticatedUrl }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check for errors in the completed operation
        if (pollData.error) {
          throw new Error(`Video generation error: ${JSON.stringify(pollData.error)}`);
        }

        throw new Error(
          "Operation completed but no video URL found in response: " +
          JSON.stringify(pollData.response || pollData).slice(0, 300)
        );
      }

      console.log(`Polling attempt ${attempts}/${maxAttempts}...`);
    }

    throw new Error("Video generation timed out after 3 minutes. Please try again.");
  } catch (error: any) {
    console.error("Error generating video:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
