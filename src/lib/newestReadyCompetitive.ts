import { newestReadyReport } from "../../supabase/functions/_shared/competitive/reportEvidence";

type Page<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

/** A few rows at a time: a report's data is large, and the newest ready one is usually among the first. */
export const READY_PAGE_SIZE = 3;

/**
 * The newest ready competitive report of a client, read page by page, newest
 * first, until one is found or the rows run out. A reader gets exactly the
 * rows it needs: the held ones that sit in front of the ready report, and that
 * report, instead of a fixed window that a run of held reports could fill.
 * `seen` says whether the client has any complete row at all.
 *
 *   fetchNewestReadyCompetitive((from, to) => supabase.from("competitive_reports")
 *     .select("id, created_at, report_data").eq("client_id", id).eq("status", "complete")
 *     .order("created_at", { ascending: false }).order("id").range(from, to))
 */
export async function fetchNewestReadyCompetitive<T extends { report_data?: unknown }>(
  page: (from: number, to: number) => Page<T>,
  size: number = READY_PAGE_SIZE,
): Promise<{ row: T | null; seen: boolean }> {
  let seen = false;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length) seen = true;
    const row = newestReadyReport(rows);
    if (row) return { row, seen };
    if (rows.length < size) return { row: null, seen };
  }
}
