/**
 * Edit one suggested test on a competitive report, by hand or by rewriting it
 * from the team's feedback (Lital, 13 Oct: "implement feedback and edit the
 * suggested tests, not just thumbs up and down"). A rewrite comes back into
 * the fields for review; nothing is saved until Save. The edit is shown in
 * place of the report's wording everywhere, and the next monthly report and
 * content briefs read the edited version.
 */

import { useState } from "react";
import { Loader2, Pencil, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUGGESTION_LIMITS, type SuggestionEdit } from "../../../supabase/functions/_shared/competitive/suggestionEdits";

type Fields = { gap: string; why_it_matters: string; suggested_play: string };

export function SuggestionEditor({ reportId, originalGap, shown, edited, onSave, onReset }: {
  reportId: string;
  /** The report's own wording, which keys the edit. */
  originalGap: string;
  /** The suggestion as it is shown now (with any earlier edit). */
  shown: Fields;
  edited: boolean;
  /** Writes the edit to the suggestion's row; the write repeats safely, so one that does not get through is sent again. */
  onSave: (edit: SuggestionEdit, feedback: string | null) => Promise<void>;
  /** Takes the edit off the suggestion's row; repeats safely too. */
  onReset: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(shown);
  const [feedback, setFeedback] = useState("");
  const [usedFeedback, setUsedFeedback] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [saving, setSaving] = useState(false);
  /** What has not gone through yet; the fields keep what the person has. */
  const [pending, setPending] = useState<"rewrite" | "save" | "reset" | null>(null);

  const start = () => { setFields(shown); setFeedback(""); setUsedFeedback(null); setPending(null); setOpen(true); };
  const set = (k: keyof Fields) => (v: string) => setFields((f) => ({ ...f, [k]: v }));
  /** The suggestion and the proposed test both need text; Save waits for them. */
  const complete = !!fields.gap.trim() && !!fields.suggested_play.trim();

  // A write the editor was handed, as a reply sendQuietly can send again.
  const asReply = (write: () => Promise<void>) => () => write().then(() => ({ error: null }), (error: unknown) => ({ error }));

  const rewrite = async () => {
    // The button waits for feedback.
    if (!feedback.trim()) return;
    setRewriting(true);
    setPending(null);
    // A new rewrite each time, so it is sent again only when it never reached the server.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("revise-suggestion", {
      body: { report_id: reportId, original_gap: originalGap, current: fields, feedback: feedback.trim() },
    }));
    setRewriting(false);
    if (error || !data?.revision) {
      console.warn("[suggestion rewrite] not rewritten yet", error ?? data?.error);
      setPending("rewrite");
      return;
    }
    setFields(data.revision);
    setUsedFeedback(feedback.trim());
    toast.success("Rewritten from your feedback. Review it, then save.");
  };

  const save = async () => {
    if (!complete) return;
    setSaving(true);
    setPending(null);
    const { error } = await sendQuietly(asReply(() => onSave({ gap: fields.gap.trim(), why_it_matters: fields.why_it_matters.trim(), suggested_play: fields.suggested_play.trim() }, usedFeedback)), { again: writeResendable });
    setSaving(false);
    if (error) {
      console.warn("[suggestion edit] not saved yet", error);
      setPending("save");
      return;
    }
    toast.success("Suggestion updated", { description: "It is shown this way everywhere, and the team's preferences are updated from it." });
    setOpen(false);
  };

  const reset = async () => {
    setSaving(true);
    setPending(null);
    const { error } = await sendQuietly(asReply(onReset), { again: writeResendable });
    setSaving(false);
    if (error) {
      console.warn("[suggestion edit] not undone yet", error);
      setPending("reset");
      return;
    }
    toast.success("Back to the report's wording");
    setOpen(false);
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={start}>
        <Pencil className="h-4 w-4 mr-1.5" /> Edit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !rewriting && !saving && setOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="t-h3">Edit this suggested test</DialogTitle>
            <DialogDescription>
              Change it by hand, or tell it what to change and rewrite it from the report's figures. The edited version is what the client sees, and what the next monthly report and the weekly calendar plans work from.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="glass-inner p-inner space-y-2">
              <Label htmlFor="suggestion-feedback">Feedback to apply</Label>
              <Textarea
                id="suggestion-feedback"
                rows={3}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="For example: focus on LinkedIn only, and make the target a posting cadence we can hold"
              />
              <Button size="sm" variant="outline" onClick={rewrite} disabled={rewriting || saving || !feedback.trim()}>
                {rewriting ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {rewriting ? "Rewriting…" : "Rewrite with this feedback"}
              </Button>
              {pending === "rewrite" && <p role="status" className="t-secondary">Not rewritten yet. Your feedback and the fields below are kept as they are.</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="suggestion-gap">Suggestion</Label>
              <Input id="suggestion-gap" value={fields.gap} maxLength={SUGGESTION_LIMITS.gap} onChange={(e) => set("gap")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suggestion-why">Why it matters</Label>
              <Textarea id="suggestion-why" rows={3} value={fields.why_it_matters} maxLength={SUGGESTION_LIMITS.why_it_matters} onChange={(e) => set("why_it_matters")(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suggestion-play">Proposed test</Label>
              <Textarea id="suggestion-play" rows={3} value={fields.suggested_play} maxLength={SUGGESTION_LIMITS.suggested_play} onChange={(e) => set("suggested_play")(e.target.value)} />
            </div>
            {!complete && <p className="t-secondary">Save needs text in both the suggestion and the proposed test.</p>}
            {pending === "save" && <p role="status" className="t-secondary">Not saved yet. Your edit is kept here.</p>}
            {pending === "reset" && <p role="status" className="t-secondary">Still showing your edited wording. The report's wording is not back yet.</p>}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {edited ? (
              <Button variant="ghost" onClick={reset} disabled={saving || rewriting}>
                <RotateCcw /> Back to the report's wording
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving || rewriting}>Cancel</Button>
              <Button onClick={save} disabled={saving || rewriting || !complete}>
                {saving && <Loader2 className="animate-spin" />} Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
