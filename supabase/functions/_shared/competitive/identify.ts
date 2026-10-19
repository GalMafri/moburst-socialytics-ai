// supabase/functions/_shared/competitive/identify.ts
//
// AI competitor identification: the client's profile and homepage text in,
// 8 to 12 likely direct competitors out, each with a rationale and a
// similarity score, saved as a new draft competitor set. Moved out of the
// identify-competitors function on 19 Oct 2026 so the client lifecycle's
// competitors step runs the same identification on the server. One Anthropic
// call (a second only when the first reply was cut off), plus free checks of
// each proposed website.

import { anthropicMessages } from "../anthropic.ts";
import { validateCompetitorWebsites } from "./validateCompetitorWebsites.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const IDENTIFY_COLUMNS = "id, name, website_url, geo, language, social_keywords, content_pillars, brief_text, brand_notes, competitor_seed_notes";

export class IdentifyError extends Error {
  constructor(public code: "too_few" | "model", message: string, public rejected: Array<{ name: string; website_url: string; reason: string }> = []) {
    super(message);
  }
}

export interface ProposedCompetitor {
  name: string;
  website_url: string;
  rationale: string;
  similarity_score: number;
}

/** Homepage text for grounding; best effort, empty on failure. */
export async function fetchSiteText(websiteUrl: string): Promise<string> {
  try {
    let url = websiteUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const resp = await fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return "";
    const html = await resp.text();
    return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
  } catch {
    return "";
  }
}

export async function proposeCompetitors(args: { anthropicKey: string; client: Record<string, unknown>; siteText: string }): Promise<ProposedCompetitor[]> {
  const c = args.client as {
    name: string; website_url?: string; geo?: string; language?: string; social_keywords?: string[];
    content_pillars?: Array<{ name?: string; description?: string }> | null; brief_text?: string; brand_notes?: string; competitor_seed_notes?: string;
  };
  const pillars = (c.content_pillars || []).map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean).join(", ");
  const profile = [
    `Company: ${c.name}`,
    c.website_url ? `Website: ${c.website_url}` : "",
    c.geo ? `Markets: ${c.geo}` : "",
    c.language ? `Languages: ${c.language}` : "",
    c.social_keywords?.length ? `Keywords: ${c.social_keywords.join(", ")}` : "",
    pillars ? `Content pillars: ${pillars}` : "",
    c.brief_text ? `Brief: ${String(c.brief_text).slice(0, 1500)}` : "",
    c.competitor_seed_notes ? `Account team's competitor notes (weigh these heavily): ${String(c.competitor_seed_notes).slice(0, 1000)}` : "",
    args.siteText ? `\nHomepage text:\n${args.siteText}` : "",
  ].filter(Boolean).join("\n");

  // JSON prefill: the reply starts as the object we want. Parsing re-attaches
  // the prefix; every text block is read (a Claude 5 reply can lead with a
  // non-text block).
  const PREFILL = '{"competitors":[';
  const callModel = (maxTokens: number) => anthropicMessages({
    apiKey: args.anthropicKey,
    onDropped: (param) => console.log(`identify-competitors: model refused "${param}", retried without it`),
    body: {
      model: "claude-sonnet-5",
      max_tokens: maxTokens,
      temperature: 0,
      system:
        "You are a competitive intelligence analyst for a social media marketing agency. " +
        "You identify DIRECT competitors: companies a customer would genuinely consider instead, " +
        "in the same market and rough size class, not aspirational giants, not tangential brands. " +
        "Prefer competitors with an actual social media presence, since the analysis is about social. " +
        "Output strict JSON only.",
      messages: [
        {
          role: "user",
          content:
            `Identify 8-12 direct competitors for this company:\n\n${profile}\n\n` +
            `Output exactly this JSON shape, nothing else:\n` +
            `{"competitors":[{"name":"...","website_url":"https://...","rationale":"one sentence on why this is a direct competitor","similarity_score":0.0}]}\n\n` +
            `similarity_score is 0..1: how substitutable this competitor is for the client in a customer's eyes. ` +
            `Sort by similarity_score descending. Real independent companies only; do not list a product division separately from its parent company. Use the official company website, never invent a domain. Return fewer candidates if necessary; if you are not confident a company exists, leave it out.`,
        },
        { role: "assistant", content: PREFILL },
      ],
    },
  });
  const extract = (raw: string): { competitors?: ProposedCompetitor[] } | null => {
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    for (const cand of [PREFILL + cleaned, cleaned]) {
      const start = cand.indexOf("{");
      const end = cand.lastIndexOf("}");
      if (start === -1 || end <= start) continue;
      try { return JSON.parse(cand.slice(start, end + 1)); } catch { /* the next candidate */ }
    }
    return null;
  };
  let { text, stopReason } = await callModel(3000);
  let parsed = extract(text);
  if (!parsed && stopReason === "max_tokens") {
    ({ text, stopReason } = await callModel(6000));
    parsed = extract(text);
  }
  if (!parsed) throw new IdentifyError("model", `Model reply was not JSON (stop_reason=${stopReason || "?"}). First 200 chars: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  const list = (parsed.competitors || []).filter((x) => x?.name).map((x) => ({
    name: String(x.name).slice(0, 200),
    website_url: String(x.website_url || "").slice(0, 500),
    rationale: String(x.rationale || "").slice(0, 500),
    similarity_score: Math.max(0, Math.min(1, Number(x.similarity_score) || 0)),
  }));
  if (list.length === 0) throw new IdentifyError("model", "Model proposed no competitors");
  return list.slice(0, 12);
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Identify and save a new draft set. Fewer than three proposals with a
 * website that answers leaves no draft (IdentifyError too_few).
 */
// deno-lint-ignore no-explicit-any
export async function identifyCompetitors(db: Db, client: Record<string, any>, anthropicKey: string, opts: { generatedBy?: string | null } = {}) {
  const siteText = client.website_url ? await fetchSiteText(client.website_url) : "";
  const suggestions = await proposeCompetitors({ anthropicKey, client, siteText });
  const { verified: proposed, rejected } = await validateCompetitorWebsites(suggestions, client.website_url);
  if (proposed.length < 3) {
    throw new IdentifyError("too_few", `Only ${proposed.length} proposed company websites could be checked. No new draft was created.`, rejected);
  }
  // A new draft every run: history stays; the screens work on the newest set.
  const { data: set, error: setErr } = await db.from("competitor_sets")
    .insert({ client_id: client.id, status: "draft", ...(opts.generatedBy !== undefined ? { generated_by: opts.generatedBy } : {}) })
    .select("id").single();
  if (setErr) throw new Error(`competitor_sets insert: ${setErr.message}`);
  const rows = proposed.map((p) => ({ set_id: set.id, client_id: client.id, name: p.name, website_url: p.website_url || null, rationale: p.rationale, similarity_score: p.similarity_score, source: "ai" }));
  const { data: inserted, error: compErr } = await db.from("competitors").insert(rows).select("*");
  if (compErr) throw new Error(`competitors insert: ${compErr.message}`);
  return { set_id: String(set.id), competitors: inserted ?? [], rejected };
}
