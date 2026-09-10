// supabase/functions/propose-design-angles/index.ts
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

const SYSTEM_PROMPT = `You are a creative director proposing angle variants for one social media design brief.

You receive the brief (post idea + visual direction + platform) and, when the client has one, their design language. Propose 6 distinct angles the same brief could be executed through, each producing a meaningfully different picture.

An angle varies the SUBJECT and its STAGING, never the brand:
- which moment, object or detail carries the idea (the wrecked door, the unopened envelope, the attorney's hands)
- distance and framing (macro detail vs wide context), stillness vs motion, daylight vs night
- documentary scene vs cutout portrait vs symbolic object, where the design language allows each
- quiet and sparse vs dense and urgent

An angle never:
- asks for words, captions, labels, numbered points, text blocks or "type-led" treatments: the picture is generated without any lettering and the app sets the headline afterwards, so every angle describes imagery only
- changes the layout, palette, typography, surface or photographic treatment the design language prescribes, or introduces gradients, glows, shadows, new colours or effects the language does not use
- depicts anything the design language's anti-patterns forbid (if it forbids smiling professionals in offices, no angle stages one)
- proposes a grid, collage, storyboard or multi-panel composition

OUTPUT: Return ONLY a JSON object of this shape, no preamble:
{
  "angles": [
    { "label": "Wrecked-door detail", "instruction": "Fill the photographic zone with a macro of a crumpled car door at dusk, desaturated, the rest of the canvas left as the brand's flat ground." },
    ...6 entries total
  ]
}

The "instruction" field is 1-2 sentences an image model can act on, naming subject, framing and mood only. Be specific. Avoid generic words like "modern" or "professional."`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { brief, platform, format, design_language } = await req.json();
    if (!brief) return json({ error: "brief required" }, 400);

    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: s } = await supabase.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
      anthropicKey = s?.value;
    }
    if (!anthropicKey) return json({ error: "no anthropic key" }, 400);

    const userMessage = `Brief: ${brief}
Platform: ${platform || "general"}
Format: ${format || "general"}
${design_language ? `Design language context: ${JSON.stringify(design_language).slice(0, 1500)}` : ""}
${design_language?.anti_patterns ? `\nNEVER (this brand's own rules; no angle may stage any of these): ${String(design_language.anti_patterns).slice(0, 800)}` : ""}

Generate 6 distinct angles. Every angle stays inside the brand's imagery rules above.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: "Anthropic error", details: t }, 502);
    }
    const r = await resp.json();
    const text = r.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "no JSON in response", text }, 500);
    let parsed: any;
    try { parsed = JSON.parse(m[0]); } catch (e) { return json({ error: "JSON parse error" }, 500); }
    if (!Array.isArray(parsed.angles) || parsed.angles.length === 0) return json({ error: "no angles" }, 500);
    return json({ angles: parsed.angles });
  } catch (e: any) {
    return json({ error: e.message || String(e) }, 500);
  }
});
