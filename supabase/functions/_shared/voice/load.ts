// supabase/functions/_shared/voice/load.ts
//
// Reading and updating how a client writes (voice.ts holds the rules). Every
// function that writes a client's copy builds its prompt from
// loadClientVoice, so none of them can skip the team's preferences or the
// client's real voice (src/test/copyWritersUseVoice.test.ts checks this).

import { anthropicMessages } from "../anthropic.ts";
import { consolidatePrompt, mergePrompt, parseConsolidation, parseMergeOps, parseVoiceProfile, voiceProfilePrompt, type ClientVoice, type MemorySignal, type Preference, type SocialVoice } from "./voice.ts";
import { bestExamples, rhythmFromPosts, scoreOwnPosts, type OwnPost } from "../calendar/evidence.ts";

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

async function mustWrite(p: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
}

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
  const confirm = async (p: Preference) => {
    await mustWrite(admin.from("brand_voice_learnings").update({ times_confirmed: p.times_confirmed + 1, last_confirmed_at: now, updated_at: now }).eq("id", p.id).eq("status", "active"), "Could not confirm a preference");
  };
  // Only one active preference may say a thing; the same wording again is a confirmation.
  const sameAs = (type: string, description: string) => current.find((p) => p.pattern_type === type && p.pattern_description.trim().toLowerCase() === description.trim().toLowerCase());
  for (const op of ops) {
    if (op.op === "confirm") {
      await confirm(current.find((p) => p.id === op.id)!);
      continue;
    }
    const existing = sameAs(op.pattern_type, op.description);
    let keptId: string;
    if (existing && existing.id !== (op.op === "replace" ? op.id : "")) {
      await confirm(existing);
      keptId = existing.id;
    } else if (existing) {
      // Replaced by its own wording: nothing changes but the confirmation.
      await confirm(existing);
      continue;
    } else {
      const { data: added, error } = await admin.from("brand_voice_learnings")
        .insert({ client_id: clientId, pattern_type: op.pattern_type, pattern_description: op.description, source, evidence, last_confirmed_at: now })
        .select("id").single();
      if (error) throw new Error(`Could not save a preference: ${error.message}`);
      keptId = added.id;
    }
    if (op.op === "replace") {
      await mustWrite(admin.from("brand_voice_learnings").update({ status: "replaced", replaced_by: keptId, updated_at: now }).eq("id", op.id).eq("status", "active"), "Could not retire a preference");
    }
  }
  return { ops: ops.length };
}

/**
 * Merge the client's active preferences into a shorter list. The monthly
 * voice job runs it for every client whose list has grown past eight
 * (calendar/runWeek.ts keepMemoryShort).
 */
export async function consolidateMemory(admin: Db, clientId: string): Promise<{ before: number; after: number }> {
  const current = (await activePreferences(admin, clientId)).sort((a, b) => a.last_confirmed_at.localeCompare(b.last_confirmed_at));
  if (current.length < 2) return { before: current.length, after: current.length };
  const { data: client } = await admin.from("clients").select("name").eq("id", clientId).maybeSingle();
  const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MEMORY_MODEL, max_tokens: 3000, messages: [{ role: "user", content: consolidatePrompt(String(client?.name ?? "the client"), current) }] } });
  const merged = parseConsolidation(result.text, current.map((p) => p.id));
  if (!merged.length) throw new Error("The memory merge returned nothing usable; nothing was changed.");
  const byId = new Map(current.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  const ids = current.map((p) => p.id);
  // Retire the old list first, so a merged preference may reuse an old one's wording.
  await mustWrite(admin.from("brand_voice_learnings").update({ status: "replaced", updated_at: now }).in("id", ids), "Could not retire the old preferences");
  try {
    for (const m of merged) {
      const sources = m.from.map((id) => byId.get(id)!).filter(Boolean);
      const latest = sources.map((x) => x.last_confirmed_at).sort().slice(-1)[0] ?? now;
      const { data: added, error } = await admin.from("brand_voice_learnings").insert({
        client_id: clientId, pattern_type: m.pattern_type, pattern_description: m.description, source: "copy_edit",
        times_confirmed: sources.reduce((n, x) => n + Math.max(1, x.times_confirmed), 0), last_confirmed_at: latest,
        evidence: `Merged from ${sources.length} earlier preference${sources.length === 1 ? "" : "s"}.`,
      }).select("id").single();
      if (error) throw new Error(`Could not save a merged preference: ${error.message}`);
      await mustWrite(admin.from("brand_voice_learnings").update({ replaced_by: added.id }).in("id", sources.map((x) => x.id)), "Could not link a merged preference");
    }
  } catch (e) {
    // Put the old list back rather than leave a half-merged one; the merged rows written so far are retired.
    await admin.from("brand_voice_learnings").update({ status: "replaced" }).eq("client_id", clientId).eq("status", "active").not("id", "in", `(${ids.join(",")})`);
    await admin.from("brand_voice_learnings").update({ status: "active", replaced_by: null }).in("id", ids);
    throw e;
  }
  return { before: current.length, after: merged.length };
}

/**
 * Learn how the client writes on each platform from the posts it published
 * in the last 90 days, and keep its best ones as examples.
 */
export async function buildVoiceProfile(admin: Db, clientId: string, posts: OwnPost[], now = new Date()): Promise<SocialVoice> {
  const { data: client } = await admin.from("clients").select("name, timezone").eq("id", clientId).maybeSingle();
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
    rhythm: rhythmFromPosts(posts, now, String(client?.timezone || "UTC")).map(({ platform, perWeek, average }) => ({ platform, perWeek, average })),
  };
  const { error } = await admin.from("clients").update({ social_voice: voice }).eq("id", clientId);
  if (error) throw new Error(`Could not save the voice profile: ${error.message}`);
  return voice;
}
