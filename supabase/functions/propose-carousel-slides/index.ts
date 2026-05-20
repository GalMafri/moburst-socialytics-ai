// supabase/functions/propose-carousel-slides/index.ts
//
// Decomposes a single carousel brief into N per-slide briefs so each slide
// can be generated as its OWN standalone image. Without this, every slide
// call would use the same "5-slide carousel" brief and Gemini would happily
// return a 6-panel contact sheet for each call.
//
// Input:  { brief, total, platform, format, post_copy?, design_language? }
// Output: { slides: [{ index, role, headline, content_brief }, ...] }

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

const SYSTEM_PROMPT = `You are a senior social media art director planning a carousel post. The user gives you a single brief that describes the whole carousel concept. Your job is to break it into N focused per-slide briefs that each describe ONE standalone slide.

## CRITICAL RULES

1. **ONE concept per slide.** Each content_brief describes a single visual idea — not a list of capabilities, not a multi-point breakdown, not a comparison table. If the input brief says "show the 4 pillars of AI", split those 4 pillars across 4 separate slides; each slide gets ONE pillar.

2. **No bullet lists, no "and X and Y and Z" structures inside content_brief.** A content_brief should read like an art director's direction for ONE image to ONE designer. If you find yourself writing "show A, B, and C" — STOP. Pick one. Move the others to other slides.

3. **Each content_brief MUST stand alone.** Pretend the other slides do not exist. Never say "as mentioned on slide 2", "leads to the next slide", "swipe to see more", "continues from above", or any cross-reference.

4. **Slide 1 is the COVER / hook** — a single strong visual idea + headline. Like a magazine cover. No "1 of N" labels, no preview of upcoming slides.

5. **Slides 2..(N-1) are INTERIOR slides** — each one is ONE clear point, idea, or step. Same brand system as the cover.

6. **Slide N can be a CTA / takeaway** if the brief suggests one — otherwise treat it as another interior slide.

7. **Do not write "Slide X:" prefixes inside content_brief** — the index is a separate field.

8. **2-4 sentences max per content_brief.** Describe subject, composition, headline, key visual element. NO list of multiple concepts.

9. **Describe colors qualitatively** (e.g. "warm coral accent on a deep navy ground"). NEVER use hex codes, RGB values, or technical color notation — they render as visible text in the image.

## EXAMPLES

### BAD (multi-concept — Gemini will render as a contact sheet)
\`\`\`
{ "index": 1, "headline": "AI Capabilities", "content_brief": "Show the four AI capabilities side by side: Creative Ideation, Data Processing, Decision Making, and Strategy. Each capability gets its own panel with an icon and one-line description." }
\`\`\`
Why bad: Tells Gemini to render four panels in one image. That is the bug we are preventing.

### GOOD (single concept)
\`\`\`
{ "index": 1, "headline": "Creative Ideation", "content_brief": "A close-up of layered translucent shapes converging into a single bold form — a visual metaphor for ideas synthesizing into a creative direction. Generous whitespace, the brand's coral accent glowing through the layers. Headline 'Creative Ideation' in heavy sans, lower-left." }
\`\`\`

### BAD (lists "X, Y, and Z")
\`\`\`
{ "content_brief": "Illustrate strategy, partnership, and execution as three interconnected nodes, with a header reading 'Building the AI Partnership' and small captions for each." }
\`\`\`

### GOOD (picks ONE node; sibling slides cover the others)
\`\`\`
{ "content_brief": "A single interlocked geometric form, half human silhouette half abstract data-shape — a metaphor for partnership. Headline 'Partnership' in heavy sans. Brand-coral edge glow, deep navy ground." }
\`\`\`

## OUTPUT FORMAT

Return ONLY this JSON object — no preamble, no markdown code fence:

{
  "slides": [
    { "index": 0, "role": "cover", "headline": "...", "content_brief": "..." },
    { "index": 1, "role": "interior", "headline": "...", "content_brief": "..." },
    ...
    { "index": N-1, "role": "interior" | "cta", "headline": "...", "content_brief": "..." }
  ]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { brief, total, platform, format, post_copy, design_language } = await req.json();
    if (!brief) return json({ error: "brief required" }, 400);
    const slideCount = Math.max(2, Math.min(10, Number(total) || 5));

    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: s } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "anthropic_api_key")
        .maybeSingle();
      anthropicKey = s?.value;
    }
    if (!anthropicKey) return json({ error: "no anthropic key" }, 400);

    const userMessage = `Carousel brief:
${brief}

${post_copy ? `Full post copy (for tone reference):\n${post_copy.slice(0, 600)}\n\n` : ""}Platform: ${platform || "general"}
Format: ${format || "Carousel"}
Total slides: ${slideCount}
${
  design_language
    ? `\nClient brand design language (for consistency, JSON):\n${JSON.stringify(design_language).slice(0, 1500)}`
    : ""
}

Decompose into exactly ${slideCount} per-slide briefs. Slide 0 = cover, slides 1..${slideCount - 2} = interior, slide ${slideCount - 1} can be cover/interior/CTA depending on the brief.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("[propose-carousel-slides] Anthropic error:", resp.status, t);
      return json({ error: "Anthropic error", details: t }, 502);
    }
    const r = await resp.json();
    const text = r.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "no JSON in response", text }, 500);
    let parsed: any;
    try {
      parsed = JSON.parse(m[0]);
    } catch (e) {
      return json({ error: "JSON parse error", details: String(e) }, 500);
    }
    if (!Array.isArray(parsed.slides) || parsed.slides.length === 0) {
      return json({ error: "no slides", parsed }, 500);
    }

    return json({ slides: parsed.slides });
  } catch (e: any) {
    console.error("[propose-carousel-slides] unexpected:", e);
    return json({ error: e.message || String(e) }, 500);
  }
});
