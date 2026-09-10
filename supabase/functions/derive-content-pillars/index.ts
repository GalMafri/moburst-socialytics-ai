// supabase/functions/derive-content-pillars/index.ts
//
// The client's content pillars, read rather than typed.
//
// Onboarding asked whoever set the client up to invent four pillars from
// nothing, and most clients were left on the default list. Two better
// sources already exist: a client with a social presence has been posting
// pillars for months, and a client without one usually arrives with a
// strategy deck. This reads whichever is there and proposes pillars the
// person can edit — nothing is written that they cannot change.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You are a social strategist naming a brand's content pillars.

A content pillar is a recurring theme the brand posts about, in the brand's own words — not a marketing-textbook category. "Case results" and "Storm season prep" are pillars; "Engagement" and "Brand awareness" are not.

Rules:
- 4 to 6 pillars. Fewer if the evidence only supports fewer.
- Each name is 1 to 4 words, in the brand's language.
- Each description is ONE sentence of at most 140 characters, saying what a post in this pillar actually contains.
- Each rationale is one short clause naming the evidence: the strategy document's own wording, or what the brand's posts keep doing.
- Never invent a pillar the evidence does not support. If the evidence is thin, return fewer pillars and say so in the notes.
- Do not propose a pillar that is really a format ("Reels", "Carousels") or a metric.

Return ONLY this JSON, no preamble:
{"pillars":[{"name":"...","description":"...","rationale":"..."}],"keywords":["..."],"notes":"one sentence on what this was read from and anything thin about it"}
"keywords" is up to 10 search or hashtag terms the brand's audience would use, taken from the same evidence. Omit it as [] if the evidence gives none.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { client_id } = await req.json();
    if (!client_id) return json({ error: "client_id is required" }, 400);

    const { asCaller } = await requireStaff(req, { writeClientId: client_id });
    void asCaller;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, name, brief_text, brand_notes, website_url, social_keywords, competitor_seed_notes, strategy_doc_file_path, primary_platforms")
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);

    let apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const { data: s } = await supabase.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
      apiKey = s?.value;
    }
    if (!apiKey) return json({ error: "Anthropic is not configured on this environment." }, 500);

    const content: any[] = [];
    const sources: string[] = [];

    // 1. The strategy document, when one was uploaded. This is the default
    //    source for a client with no posting history yet.
    if (client.strategy_doc_file_path) {
      try {
        const { data: file } = await supabase.storage.from("brand-books").download(client.strategy_doc_file_path);
        if (file) {
          const ab = await file.arrayBuffer();
          if (ab.byteLength <= 4 * 1024 * 1024) {
            const bytes = new Uint8Array(ab);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const b64 = btoa(bin);
            const ext = client.strategy_doc_file_path.split(".").pop()?.toLowerCase();
            if (ext === "pdf") {
              content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
              sources.push("strategy_doc");
            } else if (ext === "txt" || ext === "md") {
              content.push({ type: "text", text: `Strategy document:\n${new TextDecoder().decode(bytes).slice(0, 40000)}` });
              sources.push("strategy_doc");
            }
          } else {
            console.warn("[derive-pillars] strategy doc over 4MB, skipped");
          }
        }
      } catch (e) {
        console.warn("[derive-pillars] strategy doc unreadable:", e);
      }
    }

    // 2. What the client has actually been posting. Read from the reports the
    //    app already holds rather than calling Sprout again: the monthly
    //    report's top posts are the same data, already fetched and paid for.
    const { data: reports } = await supabase
      .from("reports")
      .select("report_data")
      .eq("client_id", client_id)
      .order("created_at", { ascending: false })
      .limit(3);
    const posts: string[] = [];
    for (const r of reports || []) {
      const top = (r as any)?.report_data?.sprout_performance?.top_posts;
      for (const p of Array.isArray(top) ? top : []) {
        const text = String(p?.text || p?.content || "").replace(/\s+/g, " ").trim();
        if (text) posts.push(`[${p?.platform || p?.network_type || "post"}] ${text.slice(0, 300)}`);
      }
    }
    if (posts.length > 0) {
      content.push({ type: "text", text: `The client's own recent posts (${posts.length}):\n${posts.slice(0, 60).join("\n")}` });
      sources.push("social_posts");
    }

    // 3. Whatever was written down about the brand.
    const written = [
      client.brief_text ? `Brief:\n${String(client.brief_text).slice(0, 12000)}` : "",
      client.brand_notes ? `Brand notes:\n${String(client.brand_notes).slice(0, 4000)}` : "",
      client.competitor_seed_notes ? `Competitor notes:\n${String(client.competitor_seed_notes).slice(0, 2000)}` : "",
      Array.isArray(client.social_keywords) && client.social_keywords.length
        ? `Keywords already on file: ${client.social_keywords.join(", ")}`
        : "",
    ].filter(Boolean).join("\n\n");
    if (written) {
      content.push({ type: "text", text: written });
      sources.push("brief");
    }

    if (sources.length === 0) {
      return json({
        error: `Nothing to read for ${client.name}. Upload a social strategy, add a brief, or run a monthly report first.`,
      }, 422);
    }

    content.unshift({
      type: "text",
      text:
        `Name the content pillars for "${client.name}"` +
        (client.website_url ? ` (${client.website_url})` : "") +
        (Array.isArray(client.primary_platforms) && client.primary_platforms.length
          ? `, who publish on ${client.primary_platforms.join(", ")}`
          : "") +
        ". Read the evidence below.",
    });

    const { text } = await anthropicMessages({
      apiKey,
      body: {
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: "user", content }],
      },
      onDropped: (p) => console.log(`[derive-pillars] dropped rejected parameter: ${p}`),
    });

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "The model returned no JSON." }, 502);
    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return json({ error: "The model's JSON could not be read." }, 502);
    }

    const clamp = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    const pillars = (Array.isArray(parsed.pillars) ? parsed.pillars : [])
      .map((p: any) => ({
        name: clamp(p?.name, 60),
        description: clamp(p?.description, 200),
        rationale: clamp(p?.rationale, 200),
      }))
      .filter((p: any) => p.name)
      .slice(0, 6);
    if (pillars.length === 0) return json({ error: "No pillars could be read from the evidence." }, 422);

    const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
      .map((k: unknown) => clamp(k, 40))
      .filter(Boolean)
      .slice(0, 10);

    // The primary source is the strongest evidence present, and it is what
    // the card reports back to the person reviewing the pillars.
    const primary = sources.includes("strategy_doc") ? "strategy_doc" : sources.includes("social_posts") ? "social_posts" : "brief";
    const { error: saveErr } = await supabase
      .from("clients")
      .update({
        content_pillars: pillars.map((p: any) => ({ name: p.name, description: p.description })),
        pillars_derived_at: new Date().toISOString(),
        pillars_source: primary,
      })
      .eq("id", client_id);
    if (saveErr) throw new Error(saveErr.message);

    return json({
      pillars,
      keywords,
      notes: clamp(parsed.notes, 300),
      sources,
      source: primary,
      derived_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[derive-content-pillars]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
