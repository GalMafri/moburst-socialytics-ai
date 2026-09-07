// Reject or archive a generated design, and learn from the rejection.
//
// Rejecting hides the variant and asks a small model to turn the reason and
// the note into one or two short "avoid"/"prefer" statements about this
// client's designs. generate-post-image and generate-post-video read those
// back into every later prompt, so a rejection changes the next result rather
// than just disappearing. Archiving hides without teaching — for a design that
// is fine but not wanted. Staff only, like approval.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** The reasons the panel offers, with the words the learner should hear. */
const REASONS: Record<string, string> = {
  off_brand_colours: "the colours were off-brand",
  wrong_style: "the visual style or layout did not fit the brand",
  text_errors: "the rendered text was wrong, garbled or too much",
  logo_or_mark: "it showed a logo, monogram or brand mark it should not have",
  not_relevant: "the image did not fit the post's message",
  other: "the reviewer rejected it",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { iteration_id, verdict, reason, note } = await req.json();
    if (!iteration_id || !["rejected", "archived"].includes(verdict)) {
      return jsonResp({ error: "iteration_id and a verdict of rejected or archived are required" }, 400);
    }

    // Staff first, before any lookup: an unauthenticated caller must not learn
    // whether an id exists. The per-client write check follows once the row
    // says which client this is.
    const { userId, asCaller } = await requireStaff(req);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: it, error: itErr } = await supabase
      .from("post_iterations")
      .select("id, client_id, platform, format, post_copy, visual_direction, variant_angle")
      .eq("id", iteration_id)
      .maybeSingle();
    if (itErr) throw new Error(itErr.message);
    if (!it) return jsonResp({ error: "Design not found" }, 404);

    const { data: canWrite, error: writeErr } = await asCaller.rpc("can_write_client", { _client_id: it.client_id });
    if (writeErr) throw new Error(`Access check failed: ${writeErr.message}`);
    if (!canWrite) return jsonResp({ error: "You do not have access to this client." }, 403);

    const now = new Date().toISOString();
    const patch = verdict === "archived"
      ? { archived_at: now }
      : { rejected_at: now, rejection_reason: String(reason || "other").slice(0, 60), rejection_note: note ? String(note).slice(0, 500) : null };
    const { error: upErr } = await supabase.from("post_iterations").update(patch).eq("id", iteration_id);
    if (upErr) throw new Error(upErr.message);

    let learnings: Array<{ pattern_type: string; pattern_description: string }> = [];
    if (verdict === "rejected") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      const why = REASONS[String(reason)] || REASONS.other;
      if (apiKey) {
        try {
          const { text } = await anthropicMessages({
            apiKey,
            body: {
              model: "claude-haiku-4-5-20251001",
              max_tokens: 400,
              system:
                "You turn one design rejection into durable guidance for future designs for the same client. " +
                "Write 1 or 2 rules. Each rule is one sentence of at most 140 characters, concrete enough to act on when composing the next image, and general enough to apply beyond this one post. " +
                "Never mention the specific post's copy. Output strict JSON: {\"rules\":[{\"type\":\"avoid\"|\"prefer\",\"text\":\"...\"}]}",
              messages: [{
                role: "user",
                content:
                  `A reviewer rejected a generated ${it.format || "post"} design for ${it.platform || "social"} because ${why}.` +
                  (note ? ` Their note: "${String(note).slice(0, 400)}".` : "") +
                  (it.visual_direction ? ` The brief's visual direction was: "${String(it.visual_direction).slice(0, 300)}".` : "") +
                  (it.variant_angle ? ` The variant angle was: "${String(it.variant_angle).slice(0, 200)}".` : "") +
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
          console.log("record-design-feedback: learning extraction skipped:", String(e));
        }
      }
      // With no model answer the reason itself is still worth remembering.
      if (learnings.length === 0) {
        learnings = [{ pattern_type: "avoid", pattern_description: `Avoid designs where ${why}.` }];
      }
      const rows = learnings.map((l) => ({
        client_id: it.client_id,
        pattern_type: l.pattern_type,
        pattern_description: l.pattern_description,
        confidence: 0.6,
        source_iteration_id: it.id,
        reason: String(reason || "other"),
        created_by: userId || null,
      }));
      const { error: lErr } = await supabase.from("design_learnings").insert(rows);
      if (lErr) console.log("record-design-feedback: could not store learnings:", lErr.message);
    }

    return jsonResp({ ok: true, verdict, learnings });
  } catch (err: unknown) {
    if (err instanceof AuthzError) return jsonResp({ error: err.message }, err.status);
    return jsonResp({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
