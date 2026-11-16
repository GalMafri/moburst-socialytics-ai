// The client's competitors as the strategy is written against them: the
// newest competitor set that has been confirmed, and its selected companies.
// The strategy writer (publicRead.ts) and the Strategy page's edit sheet both
// read the set here, so the rule lives in one place.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client, typed loosely like the writer's other helpers
type Db = any;

/** The statuses of a competitor set the strategy reads from. */
export const READABLE_SET_STATUSES = ["confirmed", "analyzing", "complete", "failed"] as const;

/** The client's newest readable competitor set: { data: { id } | null, error }. */
export function latestCompetitorSet(db: Db, clientId: string) {
  return db.from("competitor_sets").select("id").eq("client_id", clientId).in("status", [...READABLE_SET_STATUSES])
    .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
}

/** The companies selected in a competitor set, with the columns asked for. */
export function selectedCompetitors(db: Db, setId: string, columns: string) {
  return db.from("competitors").select(columns).eq("set_id", setId).eq("is_selected", true);
}
