// A competitive run's status in words comes from competitiveRunStatus in
// src/lib/display.ts, which takes the whole row and works out held itself.

/**
 * A RivalIQ landscape name for staff screens. Landscapes the app creates are
 * named "Socialytics - <client> - <set id>"; the id means nothing to a reader.
 */
export function landscapeLabel(name: string | null | undefined): string {
  const raw = String(name ?? "").trim();
  return raw.replace(/^Socialytics - /, "").replace(/ - [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "").trim() || raw;
}
