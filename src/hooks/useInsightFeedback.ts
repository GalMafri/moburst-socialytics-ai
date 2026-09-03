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

export type Verdict = "up" | "down";

export type InsightFeedbackRow = {
  id: string;
  client_id: string;
  insight_key: string;
  platform: string | null;
  gap_text: string | null;
  verdict: Verdict;
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
      if (existing && existing.verdict === args.verdict) {
        const { error } = await supabase.from("competitive_insight_feedback").delete().eq("id", existing.id);
        if (error) throw error;
      } else {
        // user_id is filled by the column default (auth.uid()): the app's
        // user object carries the hub id, which is not the Supabase UUID.
        const { error } = await supabase.from("competitive_insight_feedback").upsert(
          {
            client_id: clientId,
            insight_key: key,
            platform: args.platform ?? null,
            gap_text: args.gapText,
            verdict: args.verdict,
            report_id: args.reportId ?? null,
          },
          { onConflict: "client_id,insight_key" },
        );
        if (error) throw error;
      }
      await qc.invalidateQueries({ queryKey: ["insight-feedback", clientId] });
    },
    [byKey, clientId, qc],
  );

  const suppressedTexts = useMemo(() => rows.filter((r) => r.verdict === "down").map((r) => r.gap_text || r.insight_key), [rows]);
  const endorsedTexts = useMemo(() => rows.filter((r) => r.verdict === "up").map((r) => r.gap_text || r.insight_key), [rows]);

  return { rows, verdictFor, vote, suppressedTexts, endorsedTexts, isLoading: query.isLoading };
}
