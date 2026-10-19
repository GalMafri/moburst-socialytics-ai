// supabase/functions/_shared/competitive/confirmSet.ts
//
// Confirm a draft competitor set: exactly three selected, ranked 1, 2 and 3,
// then the set becomes 'confirmed' with who confirmed it (null when the
// client lifecycle confirmed it as the system). RivalIQ tracks companies by
// website, so the lifecycle confirms its pick without social handles; the
// Competitors screen's confirm keeps its own handle rule on top of this
// (confirm-competitor-set).

// deno-lint-ignore no-explicit-any
type Db = any;

export class ConfirmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface SelectedCompetitor {
  id: string;
  name: string;
  selected_rank: number | null;
}

/** The set's selection, checked: exactly three, ranked 1, 2 and 3. */
export async function checkedSelection(db: Db, setId: string): Promise<SelectedCompetitor[]> {
  const { data: selected, error } = await db.from("competitors").select("id, name, selected_rank").eq("set_id", setId).eq("is_selected", true).order("selected_rank", { ascending: true });
  if (error) throw new Error(error.message);
  if (!selected || selected.length !== 3) throw new ConfirmError(422, `Exactly 3 competitors must be selected (found ${selected?.length ?? 0}).`);
  const ranks = selected.map((s: SelectedCompetitor) => s.selected_rank).sort();
  if (JSON.stringify(ranks) !== JSON.stringify([1, 2, 3])) throw new ConfirmError(422, "Selected competitors must be ranked 1, 2 and 3.");
  return selected;
}

/** Flip a draft to confirmed. Guarded on 'draft', so a concurrent confirm does nothing. */
export async function confirmDraftSet(db: Db, setId: string, opts: { confirmedBy: string | null; notes?: string | null }): Promise<{ confirmed: boolean; selected: SelectedCompetitor[] }> {
  const { data: set, error: setErr } = await db.from("competitor_sets").select("id, client_id, status").eq("id", setId).maybeSingle();
  if (setErr || !set) throw new ConfirmError(404, "Set not found");
  if (set.status !== "draft") throw new ConfirmError(409, `Set is '${set.status}', only a draft can be confirmed.`);
  const selected = await checkedSelection(db, setId);
  const { data, error } = await db.from("competitor_sets")
    .update({ status: "confirmed", confirmed_by: opts.confirmedBy, confirmed_at: new Date().toISOString(), ...(typeof opts.notes === "string" ? { notes: opts.notes.slice(0, 2000) } : {}) })
    .eq("id", setId).eq("status", "draft").select("id");
  if (error) throw new Error(error.message);
  return { confirmed: (data ?? []).length > 0, selected };
}
