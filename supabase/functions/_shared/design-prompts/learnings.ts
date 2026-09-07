// supabase/functions/_shared/design-prompts/learnings.ts
//
// What this client's reviewers have rejected before, as rules for the next
// design. Written by record-design-feedback, read by every generator.

export interface DesignLearnings { avoid: string[]; prefer: string[] }

export async function loadDesignLearnings(
  supabase: { from: (t: string) => any },
  clientId: string | null | undefined,
  limit = 8,
): Promise<DesignLearnings | null> {
  if (!clientId) return null;
  try {
    const { data } = await supabase
      .from("design_learnings")
      .select("pattern_type, pattern_description, confidence")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows: Array<{ pattern_type: string; pattern_description: string }> = data || [];
    if (rows.length === 0) return null;
    const dedupe = (xs: string[]) => Array.from(new Set(xs.map((s) => s.trim()).filter(Boolean)));
    return {
      avoid: dedupe(rows.filter((r) => r.pattern_type === "avoid").map((r) => r.pattern_description)),
      prefer: dedupe(rows.filter((r) => r.pattern_type === "prefer").map((r) => r.pattern_description)),
    };
  } catch {
    return null;
  }
}
