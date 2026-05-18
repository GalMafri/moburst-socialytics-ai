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

const SYSTEM_PROMPT = `You are a creative director generating angle variants for a single social media design brief.

You receive a brief (the post idea + visual direction + platform). Your job is to propose 6 distinct creative angles that the same brief could be executed through. Each angle should produce a meaningfully different design — not just a different seed.

Examples of good angle dimensions:
- Type-led vs photo-led vs illustration-led
- Asymmetric vs centered composition
- Day-mood vs night-mood
- Quiet/restrained vs loud/expressive
- Editorial-photographic vs graphic-poster
- Macro/close vs wide/contextual
- Bold-color-blocks vs subtle-gradient ground

OUTPUT: Return ONLY a JSON object of this shape, no preamble:
{
  "angles": [
    { "label": "Type-led", "instruction": "Treat the headline as the hero…" },
    ...6 entries total
  ]
}

The "instruction" field is 1-2 sentences that an image-gen model can act on. Be specific. Avoid generic words like "modern" or "professional."`;

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

Generate 6 distinct angles.`;

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
