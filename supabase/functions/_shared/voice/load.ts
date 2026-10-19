// supabase/functions/_shared/voice/load.ts
//
// Reading and updating how a client writes (voice.ts holds the rules). Every
// function that writes a client's copy builds its prompt from
// loadClientVoice, so none of them can skip the team's preferences or the
// client's real voice (src/test/copyWritersUseVoice.test.ts checks this).

import { anthropicMessages } from "../anthropic.ts";
import { consolidatePrompt, mergePrompt, parseConsolidation, parseMergeOps, parseVoiceProfile, voiceProfilePrompt, type ClientVoice, type MemorySignal, type Preference, type SocialVoice } from "./voice.ts";
import { bestExamples, scoreOwnPosts, type OwnPost } from "../calendar/evidence.ts";

/** The model every piece of client copy is written with. */
export const COPY_MODEL = "claude-opus-5-5";
/** The model that keeps the preference memory merged. */
export const MEMORY_MODEL = "claude-sonnet-5-5";

// deno-lint-ignore no-explicit-any
type Db = any;

const PREFERENCE_COLUMNS = "id, pattern_type, pattern_description, times_confirmed, source, last_confirmed_at";

export async function activePreferences(admin: Db, clientId: string): Promise<Preference[]> {
  const { data, error } = await admin.from("brand_voice_learnings").select(PREFERENCE_COLUMNS)
    .eq("client_id", clientId).eq("status", "active")
    .order("times_confirmed", { ascending: false }).order("last_confirmed_at", { ascending: false }).limit(40);
  if (error) throw new Error(`Could not read the client's preferences: ${error.message}`);
  return (data ?? []) as Preference[];
}

export async function loadClientVoice(admin: Db, clientId: string): Promise<ClientVoice> {
  const [{ data: client, error }, preferences] = await Promise.all([
    admin.from("clients").select("name, brand_identity, social_voice").eq("id", clientId).maybeSingle(),
    activePreferences(admin, clientId),
  ]);
  if (error || !client) throw new Error("Could not read the client.");
  const social = client.social_voice && typeof client.social_voice === "object" && client.social_voice.platforms ? client.social_voice as SocialVoice : null;
  return { brand: String(client.name ?? ""), preferences, social, briefTone: client.brand_identity?.tone_of_voice ? String(client.brand_identity.tone_of_voice) : null };
}

function apiKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return key;
}

const excerpt = (s: string, n = 300) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Learn from one signal (a copy edit or a Revise note): confirm, replace or
 * add preferences so the list stays short and current.
 */
export async function learnFromSignal(admin: Db, clientId: string, signal: MemorySignal): Promise<{ ops: number }> {
  if (signal.kind === "copy_edit" && signal.before.trim() === signal.after.trim()) return { ops: 0 };
  const [{ data: client }, current] = await Promise.all([
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    activePreferences(admin, clientId),
  ]);
  const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MEMORY_MODEL, max_tokens: 1200, messages: [{ role: "user", content: mergePrompt(String(client?.name ?? "the client"), current, signal) }] } });
  const ops = parseMergeOps(result.text, current.map((p) => p.id));
  const source = signal.kind === "revise_note" ? "revise_note" : "copy_edit";
  const evidence = signal.kind === "revise_note" ? excerpt(signal.note) : excerpt(`${signal.before} => ${signal.after}`);
  const now = new Date().toISOString();
  for (const op of ops) {
    if (op.op === "confirm") {
      const was = current.find((p) => p.id === op.id)!;
      await admin.from("brand_voice_learnings").update({ times_confirmed: was.times_confirmed + 1, last_confirmed_at: now, updated_at: now }).eq("id", op.id).eq("status", "active");
    } else {
      const { data: added, error } = await admin.from("brand_voice_learnings")
        .insert({ client_id: clientId, pattern_type: op.pattern_type, pattern_description: op.description, source, evidence, last_confirmed_at: now })
        .select("id").single();
      if (error) throw new Error(`Could not save a preference: ${error.message}`);
      if (op.op === "replace") {
        await admin.from("brand_voice_learnings").update({ status: "replaced", replaced_by: added.id, updated_at: now }).eq("id", op.id).eq("status", "active");
      }
    }
  }
  return { ops: ops.length };
}

/** Merge preferences that were learned one by one and never merged (the list before 19 Oct 2026). */
export async function consolidateMemory(admin: Db, clientId: string): Promise<{ before: number; after: number }> {
  const current = (await activePreferences(admin, clientId)).sort((a, b) => a.last_confirmed_at.localeCompare(b.last_confirmed_at));
  if (current.length < 2) return { before: current.length, after: current.length };
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MEMORY_MODEL, max_tokens: 3000, messages: [{ role: "user", content: consolidatePrompt(String(client?.name ?? "the client"), current) }] } });
  const merged = parseConsolidation(result.text, current.map((p) => p.id));
  if (!merged.length) throw new Error("The memory merge returned nothing usable; nothing was changed.");
  const byId = new Map(current.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  const kept = new Set<string>();
  for (const m of merged) {
    const sources = m.from.map((id) => byId.get(id)!).filter(Boolean);
    const latest = sources.map((s) => s.last_confirmed_at).sort().slice(-1)[0] ?? now;
    const { data: added, error } = await admin.from("brand_voice_learnings").insert({
      client_id: clientId, pattern_type: m.pattern_type, pattern_description: m.description, source: "copy_edit",
      times_confirmed: sources.reduce((n, s) => n + Math.max(1, s.times_confirmed), 0), last_confirmed_at: latest,
      evidence: `Merged from ${sources.length} earlier preference${sources.length === 1 ? "" : "s"}.`,
    }).select("id").single();
    if (error) throw new Error(`Could not save a merged preference: ${error.message}`);
    for (const s of sources) {
      kept.add(s.id);
      await admin.from("brand_voice_learnings").update({ status: "replaced", replaced_by: added.id, updated_at: now }).eq("id", s.id);
    }
  }
  // What the merge left out lost to a newer, contradicting preference.
  const dropped = current.filter((p) => !kept.has(p.id)).map((p) => p.id);
  if (dropped.length) await admin.from("brand_voice_learnings").update({ status: "replaced", updated_at: now }).in("id", dropped);
  return { before: current.length, after: merged.length };
}

/**
 * Learn how the client writes on each platform from the posts it published
 * in the last 90 days, and keep its best ones as examples.
 */
export async function buildVoiceProfile(admin: Db, clientId: string, posts: OwnPost[], now = new Date()): Promise<SocialVoice> {
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  const withText = posts.filter((p) => String(p.text || "").trim().length >= 20);
  const byPlatform: Record<string, Array<{ text: string; date: string; format: string }>> = {};
  for (const p of [...withText].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) {
    const list = (byPlatform[p.platform] ??= []);
    if (list.length < 25) list.push({ text: p.text, date: p.publishedAt.slice(0, 10), format: p.format });
  }
  const platforms = Object.keys(byPlatform);
  let profile: SocialVoice["platforms"] = {};
  if (platforms.length) {
    const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 6000, messages: [{ role: "user", content: voiceProfilePrompt(String(client?.name ?? "the client"), byPlatform) }] } });
    profile = parseVoiceProfile(result.text, platforms);
    if (!Object.keys(profile).length) throw new Error("The voice profile reply could not be read.");
  }
  const voice: SocialVoice = {
    built_at: now.toISOString(),
    post_count: withText.length,
    platforms: profile,
    examples: bestExamples(scoreOwnPosts(posts, now, { top: 30 }).top),
  };
  const { error } = await admin.from("clients").update({ social_voice: voice }).eq("id", clientId);
  if (error) throw new Error(`Could not save the voice profile: ${error.message}`);
  return voice;
}
