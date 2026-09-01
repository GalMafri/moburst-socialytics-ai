// Step 3 of the competitive pipeline: AI competitor identification.
//
// Reads the client's profile (name, site, keywords, pillars, geo, brief, the
// account team's competitor_seed_notes), grabs the client's homepage text for
// grounding, and asks Claude for 8-12 likely competitors with a rationale and
// a similarity score each. Writes a NEW competitor_sets row in status 'draft'
// plus its competitors rows, and returns them.
//
// The output is deliberately a DRAFT: step 5 is a human review gate
// (CompetitorReview page) where staff swap/add/remove before selecting the
// top 3. Nothing downstream consumes an unconfirmed set.
//
// Handle detection is a separate function (detect-competitor-handles) so this
// call stays fast and so re-detection doesn't require re-identification.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Fetch homepage text for grounding; best-effort, empty string on failure. */
async function fetchSiteText(websiteUrl: string): Promise<string> {
  try {
    let url = websiteUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    // Crude but adequate text extraction — the LLM only needs the gist.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch {
    return "";
  }
}

interface ProposedCompetitor {
  name: string;
  website_url: string;
  rationale: string;
  similarity_score: number;
}

async function proposeCompetitors(args: {
  anthropicKey: string;
  client: Record<string, unknown>;
  siteText: string;
}): Promise<ProposedCompetitor[]> {
  const c = args.client as {
    name: string;
    website_url?: string;
    geo?: string;
    language?: string;
    social_keywords?: string[];
    content_pillars?: Array<{ name?: string; description?: string }> | null;
    brief_text?: string;
    brand_notes?: string;
    competitor_seed_notes?: string;
  };

  const pillars = (c.content_pillars || [])
    .map((p) => (typeof p === "string" ? p : p?.name))
    .filter(Boolean)
    .join(", ");

  const profile = [
    `Company: ${c.name}`,
    c.website_url ? `Website: ${c.website_url}` : "",
    c.geo ? `Markets: ${c.geo}` : "",
    c.language ? `Languages: ${c.language}` : "",
    c.social_keywords?.length ? `Keywords: ${c.social_keywords.join(", ")}` : "",
    pillars ? `Content pillars: ${pillars}` : "",
    c.brief_text ? `Brief: ${String(c.brief_text).slice(0, 1500)}` : "",
    c.competitor_seed_notes
      ? `Account team's competitor notes (weigh these heavily): ${String(c.competitor_seed_notes).slice(0, 1000)}`
      : "",
    args.siteText ? `\nHomepage text:\n${args.siteText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system:
        "You are a competitive intelligence analyst for a social media marketing agency. " +
        "You identify DIRECT competitors: companies a customer would genuinely consider instead, " +
        "in the same market and rough size class — not aspirational giants, not tangential brands. " +
        "Prefer competitors with an actual social media presence, since the analysis is about social. " +
        "Output strict JSON only.",
      messages: [
        {
          role: "user",
          content:
            `Identify 8-12 direct competitors for this company:\n\n${profile}\n\n` +
            `Output exactly this JSON shape, nothing else:\n` +
            `{"competitors":[{"name":"...","website_url":"https://...","rationale":"one sentence on why this is a direct competitor","similarity_score":0.0}]}\n\n` +
            `similarity_score is 0..1 — how substitutable this competitor is for the client in a customer's eyes. ` +
            `Sort by similarity_score descending. Real companies only; if you are not confident a company exists, leave it out.`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Anthropic API error ${resp.status}: ${t.slice(0, 200)}`);
  }

  const data = await resp.json();
  const text: string = data.content?.[0]?.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in model response");

  const parsed = JSON.parse(match[0]) as { competitors?: ProposedCompetitor[] };
  const list = (parsed.competitors || [])
    .filter((x) => x?.name)
    .map((x) => ({
      name: String(x.name).slice(0, 200),
      website_url: String(x.website_url || "").slice(0, 500),
      rationale: String(x.rationale || "").slice(0, 500),
      similarity_score: Math.max(0, Math.min(1, Number(x.similarity_score) || 0)),
    }));

  if (list.length === 0) throw new Error("Model proposed no competitors");
  return list.slice(0, 12);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) return jsonResp({ error: "client_id is required" }, 400);

    // Caller must be staff with write access to this client.
    await requireStaff(req, { writeClientId: client_id });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select(
        "id, name, website_url, geo, language, social_keywords, content_pillars, brief_text, brand_notes, competitor_seed_notes",
      )
      .eq("id", client_id)
      .maybeSingle();
    if (clientErr || !client) return jsonResp({ error: "Client not found" }, 404);

    let anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      const { data: s } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "anthropic_api_key")
        .maybeSingle();
      anthropicKey = s?.value;
    }
    if (!anthropicKey) return jsonResp({ error: "Anthropic API key not configured." }, 400);

    const siteText = client.website_url ? await fetchSiteText(client.website_url) : "";

    const proposed = await proposeCompetitors({ anthropicKey, client, siteText });

    // New draft set every run — history stays; the UI works on the newest set.
    const { data: set, error: setErr } = await supabase
      .from("competitor_sets")
      .insert({ client_id, status: "draft" })
      .select("id")
      .single();
    if (setErr) throw new Error(`competitor_sets insert: ${setErr.message}`);

    const rows = proposed.map((p) => ({
      set_id: set.id,
      client_id,
      name: p.name,
      website_url: p.website_url || null,
      rationale: p.rationale,
      similarity_score: p.similarity_score,
      source: "ai",
    }));
    const { data: inserted, error: compErr } = await supabase
      .from("competitors")
      .insert(rows)
      .select("*");
    if (compErr) throw new Error(`competitors insert: ${compErr.message}`);

    return jsonResp({ set_id: set.id, competitors: inserted });
  } catch (err: unknown) {
    if (err instanceof AuthzError) {
      return jsonResp({ error: err.message }, err.status);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[identify-competitors]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
