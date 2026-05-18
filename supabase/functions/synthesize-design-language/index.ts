import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You are a senior brand designer doing a forensic style analysis. You are writing a BINDING STYLE RULEBOOK — not a description, not a vibes check. A generative image model will follow these rules verbatim to produce new work for this brand. If the rules are soft, the output will be generic. If the rules are sharp and opinionated, the output will look like the brand.

You receive a set of reference images and (optionally) a brand book document from a single client. Your job is to extract the visible patterns and codify them as imperative rules.

OUTPUT FORMAT: A single JSON object with these fields, all strings (2-5 sentences each):

{
  "composition_patterns": "...",
  "typography_treatment": "...",
  "imagery_style": "...",
  "color_usage": "...",
  "surface_and_texture": "...",
  "logo_and_marks_treatment": "...",
  "mood_and_voice_visual": "...",
  "anti_patterns": "...",
  "platform_adaptations": "..."
}

WRITING STYLE — CRITICAL:
- Use imperative voice. "Place the subject..." not "Often places the subject...". You are writing rules, not observations.
- Be quantitative when possible: "Type occupies 30-40% of the composition" beats "Type is prominent". "Subject fills 70% of vertical height" beats "Subject is large".
- Be specific about typography: "Sans-serif geometric headline (Söhne, Inter, or close) at weight 600-700, all caps, kerning -2%" beats "Bold modern type".
- Describe colors qualitatively only — never use hex codes, RGB values, or any technical color notation. Example: "Warm coral as the dominant accent in 25-30% of the composition, against a deep navy ground" (good); "#FF5733 accent on #1A2B3C" (forbidden).
- anti_patterns lists 3-5 things to NEVER do, written as direct prohibitions. Examples: "Never use gradients", "Never center the subject", "Never render the logo at >12% of the canvas". Be opinionated — this is where the brand says no.
- platform_adaptations describes concretely how the style shifts per platform. For each of Instagram (feed + reel), LinkedIn, TikTok, give one short rule about what changes (composition, type weight, color emphasis).
- logo_and_marks_treatment is the highest-leverage field for stopping AI slop. Describe exactly when and how the logo appears (size as % of canvas, placement quadrant, color treatment, in which post types), or state "The logo does not appear in any in-feed social post — only in profile artwork" if that's the observed pattern.
- mood_and_voice_visual should name 2-3 concrete adjectives followed by what they look like in execution: "Confident — high-contrast type set against generous whitespace, no decoration".

FORMAT:
- Return ONLY the JSON object. No preamble. No markdown code fence. No commentary.
- Every field is mandatory. If a category truly isn't visible in the refs, write a defensible default in the same imperative voice rather than skipping or writing "varies".`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: "client_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Resolve Anthropic key (env or app_settings)
    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const { data: setting } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "anthropic_api_key")
        .maybeSingle();
      anthropicKey = setting?.value;
    }
    if (!anthropicKey) return json({ error: "Anthropic key not configured" }, 400);

    // Load the client
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("name, design_references, brand_book_file_path")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "client not found" }, 404);

    const designRefs: string[] = Array.isArray(client.design_references)
      ? (client.design_references as string[])
      : [];
    const brandBookPath: string | null = (client as any).brand_book_file_path || null;

    if (designRefs.length === 0 && !brandBookPath) {
      return json({ error: "No design references or brand book uploaded" }, 400);
    }

    // Build the Claude vision request — up to 8 refs + brand book
    const content: any[] = [
      {
        type: "text",
        text: `Analyze these brand references for "${client.name}" and produce the JSON design-language descriptor.`,
      },
    ];

    let sourceCount = 0;

    for (const refPath of designRefs.slice(0, 8)) {
      try {
        const { data: file } = await supabase.storage.from("design-references").download(refPath);
        if (!file) continue;
        const ab = await file.arrayBuffer();
        if (ab.byteLength > 4 * 1024 * 1024) continue;
        const bytes = new Uint8Array(ab);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const ext = refPath.split(".").pop()?.toLowerCase();
        const mt = ext === "png" ? "image/png" : "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
        sourceCount++;
      } catch (e) {
        console.warn("[synthesize] skipping ref", refPath, e);
      }
    }

    if (brandBookPath) {
      try {
        const { data: file } = await supabase.storage.from("brand-books").download(brandBookPath);
        if (file) {
          const ab = await file.arrayBuffer();
          if (ab.byteLength <= 4 * 1024 * 1024) {
            const bytes = new Uint8Array(ab);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const b64 = btoa(bin);
            const ext = brandBookPath.split(".").pop()?.toLowerCase();
            const mt =
              ext === "pdf"
                ? "application/pdf"
                : ext === "png"
                ? "image/png"
                : "image/jpeg";
            if (mt === "application/pdf") {
              content.push({ type: "document", source: { type: "base64", media_type: mt, data: b64 } });
            } else {
              content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64 } });
            }
            sourceCount++;
          }
        }
      } catch (e) {
        console.warn("[synthesize] skipping brand book", e);
      }
    }

    if (sourceCount === 0) {
      return json({ error: "Could not load any references" }, 500);
    }

    console.log("[synthesize] calling Claude with", sourceCount, "sources");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[synthesize] Anthropic error:", resp.status, body);
      return json({ error: "synthesis failed", details: body }, 502);
    }

    const result = await resp.json();
    const text = result.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ error: "could not parse JSON from Claude output" }, 500);

    let synthesis: any;
    try {
      synthesis = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return json({ error: "JSON parse error", details: String(e) }, 500);
    }

    synthesis.synthesized_at = new Date().toISOString();
    synthesis.source_count = sourceCount;

    // Persist
    const { error: updateErr } = await supabase
      .from("clients")
      .update({ design_style_synthesis: synthesis } as any)
      .eq("id", client_id);

    if (updateErr) return json({ error: "DB update failed", details: updateErr.message }, 500);

    return json({ design_style_synthesis: synthesis });
  } catch (e: any) {
    console.error("[synthesize] unexpected error:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});
