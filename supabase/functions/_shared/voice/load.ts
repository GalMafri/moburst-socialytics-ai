// supabase/functions/_shared/voice/load.ts
//
// Reading and updating how a client writes (voice.ts holds the rules). Every
// function that writes a client's copy builds its prompt from
// loadClientVoice, so none of them can skip what the client told the team,
// the team's preferences or the client's real voice
// (src/test/copyWritersUseVoice.test.ts checks this).

import { anthropicMessages } from "../anthropic.ts";
import { consolidatePrompt, mergePrompt, parseConsolidation, parseMergeOps, parseOverallVoice, parseVoiceProfile, voicePlatforms, voiceProfilePrompt, voiceSample, type ClientVoice, type LearnedChange, type MemorySignal, type Preference, type SocialVoice } from "./voice.ts";
import { bestExamples, rhythmFromPosts, scoreOwnPosts, type OwnPost } from "../calendar/evidence.ts";
import { pointsInUse, readNoteRows, standingNotes, todayIn } from "../notes/notes.ts";

/** The model every piece of client copy is written with. */
export const COPY_MODEL = "claude-opus-5-5";
/** The model that keeps the preference memory merged. */
export const MEMORY_MODEL = "claude-sonnet-5-5";

// deno-lint-ignore no-explicit-any
type Db = any;

const PREFERENCE_COLUMNS = "id, pattern_type, pattern_description, times_confirmed, source, last_confirmed_at, platform";

export async function activePreferences(admin: Db, clientId: string): Promise<Preference[]> {
  const { data, error } = await admin.from("brand_voice_learnings").select(PREFERENCE_COLUMNS)
    .eq("client_id", clientId).eq("status", "active")
    .order("times_confirmed", { ascending: false }).order("last_confirmed_at", { ascending: false }).limit(40);
  if (error) throw new Error(`Could not read the client's preferences: ${error.message}`);
  return (data ?? []) as Preference[];
}

/**
 * How the client writes: what it told the team (its notes' points in use,
 * worked out against the client's own day, and the brief's brand notes as
 * the team's standing notes), the team's preferences, its real voice and the
 * brief's tone. A read that fails throws, so no copy is written without them.
 */
export async function loadClientVoice(admin: Db, clientId: string, now = new Date()): Promise<ClientVoice> {
  const [{ data: client, error }, preferences, rows] = await Promise.all([
    admin.from("clients").select("name, brand_identity, social_voice, brand_notes, timezone").eq("id", clientId).maybeSingle(),
    activePreferences(admin, clientId),
    readNoteRows(admin, clientId),
  ]);
  if (error || !client) throw new Error("Could not read the client.");
  const social = client.social_voice && typeof client.social_voice === "object" && client.social_voice.platforms ? client.social_voice as SocialVoice : null;
  const today = todayIn(String(client.timezone || "UTC"), now);
  return {
    brand: String(client.name ?? ""), preferences, social, briefTone: client.brand_identity?.tone_of_voice ? String(client.brand_identity.tone_of_voice) : null,
    notes: { points: pointsInUse(rows.notes, rows.points, rows.links, today), standing: standingNotes(client.brand_notes), today },
  };
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
 * Learn from one signal (a copy edit, a Revise note or a rewrite note):
 * confirm, replace or add preferences so the list stays short and current.
 * Answers what changed, so a rewrite note can show what was learned and take
 * it back (undoLearning).
 */
export async function learnFromSignal(admin: Db, clientId: string, signal: MemorySignal): Promise<{ ops: number; changes: LearnedChange[] }> {
  if (signal.kind === "copy_edit" && signal.before.trim() === signal.after.trim()) return { ops: 0, changes: [] };
  const [{ data: client }, current] = await Promise.all([
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    activePreferences(admin, clientId),
  ]);
  const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MEMORY_MODEL, max_tokens: 1200, messages: [{ role: "user", content: mergePrompt(String(client?.name ?? "the client"), current, signal) }] } });
  const ops = parseMergeOps(result.text, current.map((p) => p.id));
  const source = signal.kind === "copy_edit" ? "copy_edit" : signal.kind;
  const evidence = signal.kind === "copy_edit" ? excerpt(`${signal.before} => ${signal.after}`) : excerpt(signal.note);
  const now = new Date().toISOString();
  const changes: LearnedChange[] = [];
  const confirm = async (p: Preference) => {
    await mustWrite(admin.from("brand_voice_learnings").update({ times_confirmed: p.times_confirmed + 1, last_confirmed_at: now, updated_at: now }).eq("id", p.id).eq("status", "active"), "Could not confirm a preference");
  };
  const confirmed = (p: Preference): LearnedChange => ({ op: "confirm", id: p.id, description: p.pattern_description, platform: p.platform ?? null });
  // Only one active preference may say a thing for a platform (or for all); the same wording again is a confirmation.
  const sameAs = (type: string, description: string, platform: string | null) => current.find((p) => p.pattern_type === type && (p.platform ?? null) === platform && p.pattern_description.trim().toLowerCase() === description.trim().toLowerCase());
  for (const op of ops) {
    if (op.op === "confirm") {
      const p = current.find((x) => x.id === op.id)!;
      await confirm(p);
      changes.push(confirmed(p));
      continue;
    }
    const existing = sameAs(op.pattern_type, op.description, op.platform);
    let kept: { id: string; description: string; platform: string | null; added: boolean };
    if (existing && existing.id !== (op.op === "replace" ? op.id : "")) {
      await confirm(existing);
      kept = { id: existing.id, description: existing.pattern_description, platform: existing.platform ?? null, added: false };
      if (op.op === "add") {
        changes.push(confirmed(existing));
        continue;
      }
    } else if (existing) {
      // Replaced by its own wording: nothing changes but the confirmation.
      await confirm(existing);
      changes.push(confirmed(existing));
      continue;
    } else {
      const { data: added, error } = await admin.from("brand_voice_learnings")
        .insert({ client_id: clientId, pattern_type: op.pattern_type, pattern_description: op.description, platform: op.platform, source, evidence, status: "active", last_confirmed_at: now })
        .select("id").single();
      if (error) throw new Error(`Could not save a preference: ${error.message}`);
      kept = { id: added.id, description: op.description, platform: op.platform, added: true };
      if (op.op === "add") {
        changes.push({ op: "add", id: kept.id, description: kept.description, platform: kept.platform });
        continue;
      }
    }
    // A replacement: the preference it replaces is retired, kept for Undo.
    const old = current.find((p) => p.id === op.id)!;
    await mustWrite(admin.from("brand_voice_learnings").update({ status: "replaced", replaced_by: kept.id, updated_at: now }).eq("id", op.id).eq("status", "active"), "Could not retire a preference");
    changes.push({ op: "replace", id: kept.id, description: kept.description, platform: kept.platform, added: kept.added, replaced: { id: old.id, description: old.pattern_description } });
  }
  return { ops: ops.length, changes };
}

/**
 * Take back what a rewrite note taught (its Undo): a preference it added is
 * removed, and one it replaced is active again, so the list is as it was
 * before the note. A confirmation is left as it is: it added nothing. Only
 * what a rewrite note wrote for this client is touched, and a replaced
 * preference returns only while the note's preference still stands in its
 * place. Answers how many changes were taken back.
 */
export async function undoLearning(admin: Db, clientId: string, changes: LearnedChange[]): Promise<number> {
  const now = new Date().toISOString();
  const removeAdded = async (id: string) => {
    const { data, error } = await admin.from("brand_voice_learnings").delete()
      .eq("id", id).eq("client_id", clientId).eq("source", "rewrite_note").eq("status", "active").select("id");
    if (error) throw new Error(`Could not take back a preference: ${error.message}`);
    return (data ?? []).length > 0;
  };
  let undone = 0;
  for (const c of changes.slice(0, 3)) {
    if (c.op === "add") {
      if (await removeAdded(String(c.id))) undone++;
    } else if (c.op === "replace") {
      const { data, error } = await admin.from("brand_voice_learnings").update({ status: "active", replaced_by: null, updated_at: now })
        .eq("id", String(c.replaced?.id)).eq("client_id", clientId).eq("replaced_by", String(c.id)).eq("status", "replaced").select("id");
      if (error) throw new Error(`Could not bring back a preference: ${error.message}`);
      if (!(data ?? []).length) continue;
      if (c.added) await removeAdded(String(c.id));
      undone++;
    }
  }
  return undone;
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
      // One platform's preference stays that platform's only when every one it came from was.
      const platforms = new Set(sources.map((x) => x.platform ?? null));
      const platform = platforms.size === 1 ? [...platforms][0] : null;
      const { data: added, error } = await admin.from("brand_voice_learnings").insert({
        client_id: clientId, pattern_type: m.pattern_type, pattern_description: m.description, platform, source: "copy_edit",
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
 * Learn how the client writes from the organic posts it published in the
 * last 90 days: a voice for each platform with 5 posts, and in the same call
 * the brand's overall voice from all its platforms, for the platforms with
 * fewer (recorded as thin, with their own posts as examples). Its best posts
 * are kept as examples.
 */
export async function buildVoiceProfile(admin: Db, clientId: string, posts: OwnPost[], now = new Date()): Promise<SocialVoice> {
  const { data: client } = await admin.from("clients").select("name, timezone").eq("id", clientId).maybeSingle();
  const sample = voiceSample(posts);
  const { own, thin } = voicePlatforms(sample);
  let profile: SocialVoice["platforms"] = {};
  let overall: SocialVoice["overall"] | null = null;
  if (Object.keys(sample).length) {
    const byPlatform = Object.fromEntries(Object.entries(sample).map(([p, xs]) => [p, xs.map(({ text, date, format }) => ({ text, date, format }))]));
    const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 6000, messages: [{ role: "user", content: voiceProfilePrompt(String(client?.name ?? "the client"), byPlatform, own) }] } });
    profile = parseVoiceProfile(result.text, own);
    overall = parseOverallVoice(result.text);
    if (!overall || (own.length && !Object.keys(profile).length)) throw new Error("The voice profile reply could not be read.");
  }
  const examples = bestExamples(scoreOwnPosts(posts, now, { top: 30 }).top);
  // A platform with too few posts for a voice of its own keeps its own newest posts as examples.
  for (const p of Object.keys(thin)) {
    if (!examples[p]?.length) examples[p] = sample[p].slice(0, 3).map((x) => ({ text: excerpt(x.text, 600), date: x.date, link: x.link, format: x.format }));
  }
  const voice: SocialVoice = {
    built_at: now.toISOString(),
    post_count: posts.filter((p) => !p.boosted && String(p.text || "").trim().length >= 20).length,
    platforms: profile,
    examples,
    rhythm: rhythmFromPosts(posts, now, String(client?.timezone || "UTC")).map(({ platform, perWeek, average }) => ({ platform, perWeek, average })),
    ...(overall ? { overall } : {}),
    ...(Object.keys(thin).length ? { thin } : {}),
  };
  const { error } = await admin.from("clients").update({ social_voice: voice }).eq("id", clientId);
  if (error) throw new Error(`Could not save the voice profile: ${error.message}`);
  return voice;
}
