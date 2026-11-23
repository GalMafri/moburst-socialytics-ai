import { createClient } from "../_shared/supabase.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";
import { BRAND_BOOK_MAX_BYTES, BRAND_BOOK_TYPES } from "../_shared/brand/brandBookLimits.ts";
import { costCtx, hasKey, paid } from "../_shared/paid/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** btoa() on a multi-megabyte string overflows the stack, so encode in chunks. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reads any path out of a storage bucket and spends model credits on it, so
  // it cannot be world-invokable.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { file_path, bucket, client_name, client_id } = await req.json();
    // The client the brand book belongs to, when the page says (a new client has none yet): the model call is charged to it.
    const clientId: string | null = typeof client_id === "string" && client_id ? client_id : null;

    if (!file_path || !bucket) {
      return new Response(JSON.stringify({ error: "file_path and bucket are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const ext = String(file_path).split(".").pop()?.toLowerCase() ?? "";
    const mimeType = BRAND_BOOK_TYPES[ext];
    // A file this function does not read is an answer about the file, not a failure.
    const notRead = (reason: "type" | "too_large") =>
      new Response(JSON.stringify({ brand_identity: null, not_read: reason }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!mimeType) return notRead("type");

    // The bucket is private: every file is read by download with the service
    // role, never by a public address.
    const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(file_path);
    if (downloadError || !fileData) {
      throw new Error("Failed to download file: " + downloadError?.message);
    }
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    if (bytes.byteLength > BRAND_BOOK_MAX_BYTES) return notRead("too_large");
    const dataUrl = `data:${mimeType};base64,${base64(bytes)}`;

    // A PDF goes in as a document; an image as an image.
    const fileContent = mimeType === "application/pdf"
      ? { type: "file", file: { filename: String(file_path).split("/").pop() || "brand-book.pdf", file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl, detail: "high" } };

    if (!(await hasKey("openai"))) {
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
          fileContent,
        ],
      },
    ];

    const openaiResponse = await paid.fetch(costCtx({ clientId, feature: "brand.extract_file", actor: "user" }), "openai", "/v1/chat/completions", {
      method: "POST",
      headers: {
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
