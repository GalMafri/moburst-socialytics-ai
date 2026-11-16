/**
 * The one definition of an active client: one that is not archived. Every
 * client list reads it, so a picker, an index page and the dashboard count
 * the same clients. Archived clients appear only where a screen explicitly
 * shows the archive (the dashboard's archive view).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** True for a client that is not archived. */
export function isActiveClient(row: { archived_at?: string | null } | null | undefined): boolean {
  return !!row && !row.archived_at;
}

/**
 * The client's logo surface: the stored logo copy and the background its
 * designs put the logo on. Every read of clients for display carries it, so
 * every screen that draws a client's logo draws it on the same surface.
 */
export const LOGO_SURFACE_SELECT = "design_brand_settings(logo_path, background)";

/** The active clients, by name, with the columns asked for and the logo surface. Row access still follows RLS. */
export async function fetchActiveClients<T = { id: string; name: string }>(columns = "id, name", ids?: string[]): Promise<T[]> {
  let query = supabase.from("clients").select(`${columns}, ${LOGO_SURFACE_SELECT}`).is("archived_at", null).order("name");
  if (ids) {
    if (!ids.length) return [];
    query = query.in("id", ids);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as T[];
}

/** The active clients as a query hook. `ids` narrows to clients the viewer belongs to. */
export function useActiveClients<T = { id: string; name: string }>(columns = "id, name", opts: { ids?: string[]; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["active-clients", columns, opts.ids ?? null],
    queryFn: () => fetchActiveClients<T>(columns, opts.ids),
    enabled: opts.enabled ?? true,
  });
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * The clients a client user works with, the one rule the dashboard, the
 * Calendar tab and the Analytics tab share. A gOS session is already scoped
 * to its company's clients by row access, so it has every client it can see.
 * Any other client user has the clients that carry its company's name, or,
 * when none does, the clients it can see. One client opens straight away,
 * several are offered in a chooser, none shows the empty state.
 */
export function viewerClients<T extends { hub_company_name?: string | null }>(list: T[] | undefined, who: { company?: string | null; isGosSession?: boolean }): T[] {
  const all = list ?? [];
  if (who.isGosSession) return all;
  const company = norm(who.company);
  const matched = company ? all.filter((c) => norm(c.hub_company_name) === company) : [];
  return matched.length ? matched : all;
}
