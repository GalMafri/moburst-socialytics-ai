// supabase/functions/_shared/design-prompts/feedback.ts
//
// A design someone turned down, or deleted. Turning one down with a reason
// hides it and turns the reason (and any note) into one or two short "avoid"
// or "prefer" rules for this client's next designs (design_learnings), which
// every design step reads back. Deleting hides it without teaching anything.
// Used by record-design-feedback (staff, older generators) and design-request
// (the client's own users and staff, design options).

import { anthropicMessages } from "../anthropic.ts";

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

export type Learning = { pattern_type: string; pattern_description: string };

export async function recordFeedback(admin: any, it: FeedbackRow, verdict: "rejected" | "archived", reason: string | undefined, note: string | undefined, userId: string | null): Promise<Learning[]> {
  const now = new Date().toISOString();
  const patch = verdict === "archived"
    ? { archived_at: now, is_selected: false }
    : { rejected_at: now, is_selected: false, rejection_reason: String(reason || "other").slice(0, 60), rejection_note: note ? String(note).slice(0, 500) : null };
  const { error: upErr } = await admin.from("post_iterations").update(patch).eq("id", it.id);
  if (upErr) throw new Error(upErr.message);
  if (verdict !== "rejected") return [];

  let learnings: Learning[] = [];
  const why = REASONS[String(reason)] || REASONS.other;
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (apiKey) {
    try {
      const { text } = await anthropicMessages({
        apiKey,
        body: {
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system:
            "You turn one design rejection into durable guidance for future designs for the same client. " +
            "Write 1 or 2 rules. Each rule is one sentence of at most 140 characters, concrete enough to act on when composing the next design, and general enough to apply beyond this one post. " +
            "Never mention the specific post's copy. Output strict JSON: {\"rules\":[{\"type\":\"avoid\"|\"prefer\",\"text\":\"...\"}]}",
          messages: [{
            role: "user",
            content:
              `A reviewer rejected a ${it.format || "post"} design for ${it.platform || "social"} because ${why}.` +
              (note ? ` Their note: "${String(note).slice(0, 400)}".` : "") +
              (it.concept ? ` The design's picture was: "${String(it.concept).slice(0, 300)}".` : "") +
              (it.visual_direction ? ` The brief's visual direction was: "${String(it.visual_direction).slice(0, 300)}".` : "") +
              `\n\nReply with the JSON only.`,
          }],
        },
      });
      const start = text.indexOf("{"), end = text.lastIndexOf("}");
      const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
      learnings = (parsed?.rules || [])
        .filter((r: any) => r && (r.type === "avoid" || r.type === "prefer") && typeof r.text === "string" && r.text.trim())
        .slice(0, 2)
        .map((r: any) => ({ pattern_type: r.type, pattern_description: String(r.text).trim().slice(0, 200) }));
    } catch (e) {
      console.log("design feedback: learning extraction skipped:", String(e));
    }
  }
  // With no model answer the reason itself is still worth remembering.
  if (!learnings.length) learnings = [{ pattern_type: "avoid", pattern_description: `Avoid designs where ${why}.` }];
  const rows = learnings.map((l) => ({
    client_id: it.client_id,
    pattern_type: l.pattern_type,
    pattern_description: l.pattern_description,
    confidence: 0.6,
    source_iteration_id: it.id,
    reason: String(reason || "other"),
    created_by: userId,
  }));
  const { error: lErr } = await admin.from("design_learnings").insert(rows);
  if (lErr) console.log("design feedback: could not store learnings:", lErr.message);
  return learnings;
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
