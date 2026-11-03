// supabase/functions/_shared/design-prompts/feedback.ts
//
// What a client's design memory learns (design_learnings, read back by every
// design step):
//   - a design someone turned down with Not right: it is hidden, and its
//     reason (with the note, where the note says something lasting) becomes
//     one or two short "avoid" or "prefer" rules. Deleting a design hides it
//     without teaching anything;
//   - a note left on Regenerate (notes on regenerate, Lital 3 Nov 2026): the
//     note is used for that design either way, and becomes a rule only when
//     it says something lasting about the brand's designs, never when it is
//     about this one post. Its rules are marked source "regenerate_note".
// Each answers the rules it wrote, with their ids, so the post can show what
// was learned with Undo (design-request undo_note). Used by
// record-design-feedback (staff, older generators) and design-request (the
// client's own users and staff, design options).

import { anthropicMessages } from "../anthropic.ts";

/** The small model that turns feedback into rules (the one call Not right already made). */
const LEARNER_MODEL = "claude-haiku-4-5-20251001";

/** The reasons offered, with the words the learner hears. */
export const REASONS: Record<string, string> = {
  off_brand_colours: "the colors were off-brand",
  wrong_style: "the visual style or layout did not fit the brand",
  text_errors: "the text on it was wrong, garbled or too much",
  logo_or_mark: "it showed a logo, monogram or brand mark it should not have",
  not_relevant: "the image did not fit the post's message",
  repetitive: "it looked too much like the brand's other designs",
  other: "the reviewer turned it down",
};

export interface FeedbackRow {
  id: string;
  client_id: string;
  platform?: string | null;
  format?: string | null;
  visual_direction?: string | null;
  variant_angle?: string | null;
  concept?: string | null;
}

/** A rule the memory wrote; id once it is stored. */
export type Learning = { id?: string; pattern_type: string; pattern_description: string };

const RULE_FORMAT = "Each rule is one sentence of at most 140 characters, concrete enough to act on when composing the next design. " +
  "Never mention the specific post's copy. Output strict JSON: {\"rules\":[{\"type\":\"avoid\"|\"prefer\",\"text\":\"...\"}]}";

/** The rules in the learner's reply, or null when the reply is not the JSON asked for. */
function parseRules(text: string): Learning[] | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: { rules?: unknown };
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!Array.isArray(parsed?.rules)) return null;
  return (parsed.rules as Array<{ type?: unknown; text?: unknown }>)
    .filter((r) => r && (r.type === "avoid" || r.type === "prefer") && typeof r.text === "string" && r.text.trim())
    .slice(0, 2)
    .map((r) => ({ pattern_type: String(r.type), pattern_description: String(r.text).trim().slice(0, 200) }));
}

/** Ask the learner; null when there is no key, the call fails or the reply cannot be read. */
async function ask(system: string, content: string): Promise<Learning[] | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  try {
    const { text } = await anthropicMessages({ apiKey, body: { model: LEARNER_MODEL, max_tokens: 400, system, messages: [{ role: "user", content }] } });
    return parseRules(text);
  } catch (e) {
    console.log("design memory: learning skipped:", String(e));
    return null;
  }
}

/** Store rules for the client, answering them with their ids (none when the insert did not go through). */
// deno-lint-ignore no-explicit-any
async function store(admin: any, rows: Array<Record<string, unknown>>): Promise<Learning[]> {
  if (!rows.length) return [];
  const { data, error } = await admin.from("design_learnings").insert(rows).select("id, pattern_type, pattern_description");
  if (error) {
    console.log("design memory: could not store rules:", error.message);
    return [];
  }
  return (data ?? []).map((r: Learning) => ({ id: r.id, pattern_type: r.pattern_type, pattern_description: r.pattern_description }));
}

const excerpt = (s: string | null | undefined, n = 300) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : null);

// deno-lint-ignore no-explicit-any
export async function recordFeedback(admin: any, it: FeedbackRow, verdict: "rejected" | "archived", reason: string | undefined, note: string | undefined, userId: string | null): Promise<Learning[]> {
  const now = new Date().toISOString();
  const patch = verdict === "archived"
    ? { archived_at: now, is_selected: false }
    : { rejected_at: now, is_selected: false, rejection_reason: String(reason || "other").slice(0, 60), rejection_note: note ? String(note).slice(0, 500) : null };
  const { error: upErr } = await admin.from("post_iterations").update(patch).eq("id", it.id);
  if (upErr) throw new Error(upErr.message);
  if (verdict !== "rejected") return [];

  const why = REASONS[String(reason)] || REASONS.other;
  let learnings = await ask(
    "You turn one design rejection into durable guidance for future designs for the same client. " +
      "Write 1 or 2 rules from the reason, general enough to apply beyond this one post. " +
      "Use the note only where it says something lasting about the brand's designs; a part about this one post gives no rule. " +
      RULE_FORMAT,
    `A reviewer rejected a ${it.format || "post"} design for ${it.platform || "social"} because ${why}.` +
      (note ? ` Their note: "${String(note).slice(0, 400)}".` : "") +
      (it.concept ? ` The design's picture was: "${String(it.concept).slice(0, 300)}".` : "") +
      (it.visual_direction ? ` The brief's visual direction was: "${String(it.visual_direction).slice(0, 300)}".` : "") +
      `\n\nReply with the JSON only.`,
  );
  // With no model answer the reason itself is still worth remembering.
  if (!learnings?.length) learnings = [{ pattern_type: "avoid", pattern_description: `Avoid designs where ${why}.` }];
  return await store(admin, learnings.map((l) => ({
    client_id: it.client_id,
    pattern_type: l.pattern_type,
    pattern_description: l.pattern_description,
    confidence: 0.6,
    source_iteration_id: it.id,
    reason: String(reason || "other"),
    source: "feedback",
    evidence: excerpt(note),
    created_by: userId,
  })));
}

/**
 * A note left on a design's Regenerate: the rules it taught the brand's
 * design memory, [] when it is about this one post, or null when the learning
 * did not finish (nothing is written then, and the post shows no learned line).
 */
// deno-lint-ignore no-explicit-any
export async function learnFromNote(admin: any, n: { clientId: string; platform?: string | null; format?: string | null; note: string; userId: string | null }): Promise<Learning[] | null> {
  const note = excerpt(n.note, 500);
  if (!note) return [];
  const learnings = await ask(
    "You decide whether a note someone left when asking for a new design says something lasting about the same client's designs. " +
      "When the note is about this one post (its topic, its words, its picture, its date), write no rule. " +
      "When it says how the brand's designs should look or what they should never show, write 1 or 2 rules, general enough to apply beyond this one post. " +
      RULE_FORMAT + " With no rule, reply {\"rules\":[]}.",
    `Someone asked for a new ${n.format || "post"} design for ${n.platform || "social"} with this note: "${note}".\n\nReply with the JSON only.`,
  );
  if (!learnings) return null;
  return await store(admin, learnings.map((l) => ({
    client_id: n.clientId,
    pattern_type: l.pattern_type,
    pattern_description: l.pattern_description,
    confidence: 0.6,
    source_iteration_id: null,
    reason: null,
    source: "regenerate_note",
    evidence: excerpt(note),
    created_by: n.userId,
  })));
}

/** The client's rules from earlier feedback, as lines for a design brief. */
export function learningLines(l: { avoid: string[]; prefer: string[] } | null): string {
  if (!l || (!l.avoid.length && !l.prefer.length)) return "";
  return [
    "What reviewers asked for on this brand's earlier designs:",
    ...l.prefer.map((t) => `- ${t}`),
    ...l.avoid.map((t) => `- ${t}`),
  ].join("\n");
}
