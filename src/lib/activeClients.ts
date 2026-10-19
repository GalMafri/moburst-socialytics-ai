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

/** The active clients, by name, with the columns asked for. Row access still follows RLS. */
export async function fetchActiveClients<T = { id: string; name: string }>(columns = "id, name", ids?: string[]): Promise<T[]> {
  let query = supabase.from("clients").select(columns).is("archived_at", null).order("name");
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
