/**
 * Reads every row of a query. The database answers at most 1,000 rows to one
 * request, so a read that must see them all asks page by page until a page
 * comes back short. The query needs a stable order (a unique column last) so
 * no row moves between pages.
 *
 *   const rows = await readAll((from, to) => supabase.from("t").select("a, b").order("id").range(from, to));
 */
export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;

export async function readAll<T>(page: (from: number, to: number) => Page<T>, size: number = PAGE_SIZE): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}
