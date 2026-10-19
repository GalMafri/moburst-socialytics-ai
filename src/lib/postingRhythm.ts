// The posts-per-week setting on clients.posting_rhythm (weekly calendar, 19 Oct 2026).

/** The setting as stored on clients.posting_rhythm: numbers only, null when nothing overrides. */
export function rhythmSetting(value: Record<string, string>): Record<string, number> | null {
  const entries = Object.entries(value).filter(([, v]) => v !== "" && Number.isFinite(Number(v))).map(([k, v]) => [k, Math.max(0, Math.min(7, Number(v)))] as const);
  return entries.length ? Object.fromEntries(entries) : null;
}
