import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_path, bucket, client_name } = await req.json();

    if (!file_path || !bucket) {
      return new Response(JSON.stringify({ error: "file_path and bucket are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const ext = file_path.split(".").pop()?.toLowerCase();
    let mimeType = "image/png";
    if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "pdf") mimeType = "application/pdf";

    // Get a public URL instead of downloading the file into memory
    // This avoids the memory limit issue with large files
    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(file_path);
    const publicUrl = urlData?.publicUrl;

    if (!publicUrl) {
      throw new Error("Failed to get public URL for file");
    }

    // For images, use the URL directly with OpenAI Vision (no download needed)
    // For PDFs, we need to download but use efficient base64 encoding
    let imageContent: any;

    if (mimeType === "application/pdf" || !publicUrl) {
      // Download and convert to base64 using Deno's efficient encoder
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucket)
        .download(file_path);

      if (downloadError || !fileData) {
        throw new Error("Failed to download file: " + downloadError?.message);
      }

      // Check file size — reject files over 4MB to stay within compute limits
      const arrayBuffer = await fileData.arrayBuffer();
      if (arrayBuffer.byteLength > 4 * 1024 * 1024) {
        throw new Error("File too large for processing. Please upload a file under 4MB, or use a PNG/JPG image instead of PDF.");
      }

      // Use Deno's native base64 encoder (much more memory-efficient)
      const base64 = base64Encode(arrayBuffer);

      imageContent = {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
          detail: "low",
        },
      };
    } else {
      // For images, pass the public URL directly — OpenAI fetches it
      imageContent = {
        type: "image_url",
        image_url: {
          url: publicUrl,
          detail: "high",
        },
      };
    }

    let openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "openai_api_key")
        .single();
      openaiKey = settings?.value;
    }

    if (!openaiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const systemPrompt = `You are a brand identity analyst. Analyze the provided brand book/style guide document and extract the brand's visual identity.

Return a JSON object with exactly these fields:
- primary_color: main brand color as hex (e.g., "#1A73E8")
- secondary_color: secondary brand color as hex
- accent_color: accent/highlight color as hex
- font_family: primary font family name
- visual_style: 5-15 word description of overall visual style
- logo_description: brief description of the logo
- tone_of_voice: 3-8 word description of brand tone
- design_elements: key visual patterns or elements
- background_style: preferred background approach

MANDATORY RULES:
1. All colors MUST be valid 7-character hex codes starting with #
2. Return ONLY the JSON object, no additional text
3. If a field cannot be determined, provide your best educated guess based on the overall brand aesthetic
4. font_family must be a real font name`;

    const userMessage = `Analyze this brand book${client_name ? ` for "${client_name}"` : ""} and extract the brand identity. Return only the JSON object.`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          imageContent,
        ],
      },
    ];

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages,
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content || "";

    let brandIdentity;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      brandIdentity = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      brandIdentity = null;
    }

    if (!brandIdentity) {
      throw new Error("Failed to parse brand identity from AI response");
    }

    return new Response(JSON.stringify({ brand_identity: brandIdentity }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
