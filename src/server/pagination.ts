/**
 * Supabase's API returns at most the project's "max rows" per request (1,000
 * by default), and says nothing when a result is cut short. Every read that can
 * grow with a company's history goes through fetchAllRows, which asks for one
 * page at a time until a short page comes back.
 *
 * Each page is one Worker subrequest, so a query must have a stable order
 * (for example .order('id')) or rows can repeat or go missing between pages.
 */
export const PAGE_SIZE = 1_000;

interface QueryPage<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QueryPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}
