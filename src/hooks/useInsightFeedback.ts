// Thumbs up / thumbs down on competitive gap suggestions, per client.
//
// A thumbs-down hides the suggestion immediately and is sent to the
// competitive workflow as a suppressed insight so it is never proposed again.
// A thumbs-up marks it endorsed: the monthly report synthesis receives it as a
// must-address gap so the content calendar, copy and posting times reflect it.
// Rows live in competitive_insight_feedback, one per (client, insight key).

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import type { CompetitiveLearning, SuggestionEdit } from "../../supabase/functions/_shared/competitive/suggestionEdits";

export type Verdict = "up" | "down";

export type InsightFeedbackRow = {
  id: string;
  client_id: string;
  insight_key: string;
  platform: string | null;
  gap_text: string | null;
  /** Null when the row only carries an edit. */
  verdict: Verdict | null;
  /** Staff edit of the suggestion, shown instead of the original. */
  edited?: SuggestionEdit | null;
  edit_feedback?: string | null;
  report_id: string | null;
  user_id: string | null;
  created_at?: string;
};

/** Stable key for a suggestion: the gap text, lower-cased and slugged. */
export function insightKey(text: string | null | undefined): string {
  const slug = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "untitled";
}

/** Split gaps by verdict; hidden gaps are the thumbs-down ones. */
export function partitionGaps<T extends { gap?: string }>(gaps: T[], rows: InsightFeedbackRow[]) {
  const byKey = new Map(rows.map((r) => [r.insight_key, r.verdict]));
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const g of gaps || []) {
    const v = byKey.get(insightKey(g.gap));
    (v === "down" ? hidden : visible).push(g);
  }
  visible.sort((a, b) => Number(byKey.get(insightKey(b.gap)) === "up") - Number(byKey.get(insightKey(a.gap)) === "up"));
  return { visible, hidden };
}

export function useInsightFeedback(clientId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["insight-feedback", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("competitive_insight_feedback").select("*").eq("client_id", clientId!);
      if (error) throw error;
      return (data || []) as InsightFeedbackRow[];
    },
    enabled: !!clientId,
    staleTime: 30 * 1000,
  });

  const rows = query.data || [];
  const byKey = useMemo(() => new Map(rows.map((r) => [r.insight_key, r])), [rows]);

  const verdictFor = useCallback((gapText: string | null | undefined): Verdict | null => byKey.get(insightKey(gapText))?.verdict ?? null, [byKey]);

  /** Record a verdict. Voting the same way twice removes the verdict. */
  const vote = useCallback(
    async (args: { gapText: string; platform?: string | null; verdict: Verdict; reportId?: string | null }) => {
      if (!clientId) return;
      const key = insightKey(args.gapText);
      const existing = byKey.get(key);
      // Every write here repeats safely, so each is sent again quietly; the page then shows what is stored.
      try {
      if (existing && existing.verdict === args.verdict) {
        // An edited suggestion keeps its edit when the verdict is taken back.
        const { error } = existing.edited
          ? await sendQuietly(() => supabase.from("competitive_insight_feedback").update({ verdict: null }).eq("id", existing.id), { again: writeResendable })
          : await sendQuietly(() => supabase.from("competitive_insight_feedback").delete().eq("id", existing.id), { again: writeResendable });
        if (error) throw error;
      } else {
        // The column default (auth.uid()) fills user_id on INSERT only, so a
        // flipped verdict used to keep the first voter's name and timestamp.
        // Written explicitly from the session so the row says who decided.
        const { data: auth } = await supabase.auth.getUser();
        const { error } = await sendQuietly(() => supabase.from("competitive_insight_feedback").upsert(
          {
            client_id: clientId,
            insight_key: key,
            platform: args.platform ?? null,
            gap_text: args.gapText,
            verdict: args.verdict,
            report_id: args.reportId ?? null,
            ...(auth?.user?.id ? { user_id: auth.user.id, created_at: new Date().toISOString() } : {}),
          },
          { onConflict: "client_id,insight_key" },
        ), { again: writeResendable });
        if (error) throw error;
      }
      } finally {
        await qc.invalidateQueries({ queryKey: ["insight-feedback", clientId] });
      }
    },
    [byKey, clientId, qc],
  );

  /** The staff edit of a suggestion, looked up by its original text. */
  const editFor = useCallback((gapText: string | null | undefined): SuggestionEdit | null => (byKey.get(insightKey(gapText))?.edited as SuggestionEdit | null | undefined) ?? null, [byKey]);

  /** Save an edit (by hand, or a rewrite from feedback) on the suggestion's row, keyed by its original text, and learn from it. */
  const saveEdit = useCallback(
    async (args: { gapText: string; platform?: string | null; reportId?: string | null; edit: SuggestionEdit; feedback?: string | null; before?: SuggestionEdit }): Promise<CompetitiveLearning[]> => {
      if (!clientId) return [];
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("competitive_insight_feedback").upsert(
        {
          client_id: clientId,
          insight_key: insightKey(args.gapText),
          gap_text: args.gapText,
          platform: args.platform ?? null,
          report_id: args.reportId ?? null,
          edited: { gap: args.edit.gap ?? null, why_it_matters: args.edit.why_it_matters ?? null, suggested_play: args.edit.suggested_play ?? null },
          edit_feedback: args.feedback?.trim() || null,
          edited_at: new Date().toISOString(),
          edited_by: auth?.user?.id ?? null,
        },
        { onConflict: "client_id,insight_key" },
      );
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["insight-feedback", clientId] });
      // What the edit teaches about this client's suggestions is kept as a
      // standing preference. The edit is saved either way.
      let learned: CompetitiveLearning[] = [];
      if (args.reportId && args.before) {
        const { data } = await supabase.functions.invoke("revise-suggestion", {
          body: { action: "learn", report_id: args.reportId, insight_key: insightKey(args.gapText), original: args.before, edited: args.edit, feedback: args.feedback ?? "" },
        }).catch(() => ({ data: null }));
        learned = Array.isArray(data?.learned) ? data.learned : [];
        if (learned.length) await qc.invalidateQueries({ queryKey: ["competitive-learnings", clientId] });
      }
      return learned;
    },
    [clientId, qc],
  );

  /** Go back to the report's own wording. */
  const resetEdit = useCallback(
    async (gapText: string) => {
      const existing = byKey.get(insightKey(gapText));
      if (!existing) return;
      const { error } = existing.verdict
        ? await supabase.from("competitive_insight_feedback").update({ edited: null, edit_feedback: null, edited_at: null, edited_by: null }).eq("id", existing.id)
        : await supabase.from("competitive_insight_feedback").delete().eq("id", existing.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["insight-feedback", clientId] });
    },
    [byKey, clientId, qc],
  );

  const suppressedTexts = useMemo(() => rows.filter((r) => r.verdict === "down").map((r) => r.gap_text || r.insight_key), [rows]);
  const endorsedTexts = useMemo(() => rows.filter((r) => r.verdict === "up").map((r) => r.edited?.gap || r.gap_text || r.insight_key), [rows]);

  return { rows, verdictFor, vote, editFor, saveEdit, resetEdit, suppressedTexts, endorsedTexts, isLoading: query.isLoading };
}

export type LearningRow = CompetitiveLearning & { id: string; created_at: string };

/** The standing preferences the team's edits taught for one client (staff only). */
export function useCompetitiveLearnings(clientId: string | undefined, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["competitive-learnings", clientId],
    queryFn: async () => {
      // competitive_learnings is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("competitive_learnings" as never) as any)
        .select("id, kind, text, created_at").eq("client_id", clientId!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as LearningRow[];
    },
    enabled: !!clientId && enabled,
  });
  const remove = useCallback(async (id: string) => {
    // Sent again quietly; the list then shows what is stored either way.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sendQuietly(() => (supabase.from("competitive_learnings" as never) as any).delete().eq("id", id), { again: writeResendable });
    await qc.invalidateQueries({ queryKey: ["competitive-learnings", clientId] });
  }, [clientId, qc]);
  return { learnings: query.data || [], remove };
}
