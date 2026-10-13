/**
 * What a competitive report's status is called on screen.
 *
 * The badge used to print the database value ("complete", "running",
 * "failed"), which is a column, not a sentence, and clients saw it on every
 * report they opened. Every competitive screen names a status through this.
 */
export type StatusBadge = {
  label: string;
  variant: "default" | "secondary" | "destructive";
};

export function competitiveStatusBadge(status: string | null | undefined, opts: { held?: boolean } = {}): StatusBadge {
  if (status === "running") return { label: "In progress", variant: "secondary" };
  // A run that finished but did not pass the source checks is being held
  // back, whatever its stored status says.
  if (opts.held) return { label: "Awaiting review", variant: "secondary" };
  if (status === "complete") return { label: "Ready", variant: "default" };
  if (status === "failed") return { label: "Did not finish", variant: "destructive" };
  return { label: "Not available", variant: "secondary" };
}

/**
 * A RivalIQ landscape name for staff screens. Landscapes the app creates are
 * named "Socialytics - <client> - <set id>"; the id means nothing to a reader.
 */
export function landscapeLabel(name: string | null | undefined): string {
  const raw = String(name ?? "").trim();
  return raw.replace(/^Socialytics - /, "").replace(/ - [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "").trim() || raw;
}
