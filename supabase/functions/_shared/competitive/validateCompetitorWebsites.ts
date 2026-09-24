/** Check AI-proposed sites before they become selectable draft companies.
 * Reachability is not proof of competitor relevance; the selection remains a draft.
 */
export async function validateCompetitorWebsites<T extends { name: string; website_url: string }>(
  candidates: T[], clientWebsite?: string, fetcher: typeof fetch = fetch,
) {
  const host = (value: string) => new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
  let clientHost = ''; try { if (clientWebsite) clientHost = host(clientWebsite); } catch { /* optional client site */ }
  const results: Array<{ candidate: T; reason?: string }> = new Array(candidates.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (next < candidates.length) {
      const index = next++, candidate = candidates[index];
      try {
        if (!candidate.website_url) throw new Error('No company website supplied.');
        const url = new URL(/^https?:\/\//i.test(candidate.website_url) ? candidate.website_url : `https://${candidate.website_url}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid company website.');
        if (host(url.href) === clientHost) throw new Error('This is the client website, not a separate competitor.');
        const response = await fetcher(url.href, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
        if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
        const html = await response.text();
        if (html.trim().length < 100 || !/<(?:html|head|body|title|a)\b/i.test(html)) throw new Error('Website did not return a readable company page.');
        const finalUrl = response.url || url.href;
        if (host(finalUrl) === clientHost) throw new Error('Website redirects to the client.');
        results[index] = { candidate: { ...candidate, website_url: finalUrl } };
      } catch (error) {
        results[index] = { candidate, reason: error instanceof TypeError || (error as Error)?.name === 'TimeoutError' ? 'Website could not be reached. Verify its address before adding this company.' : (error as Error)?.message || 'Website could not be checked.' };
      }
    }
  }));
  const seen = new Set<string>();
  const verified: T[] = [], rejected: Array<{ name: string; website_url: string; reason: string }> = [];
  for (const result of results) {
    const domain = result.reason ? '' : host(result.candidate.website_url);
    if (!result.reason && seen.has(domain)) result.reason = 'Another suggestion uses the same company website.';
    if (result.reason) rejected.push({ name: result.candidate.name, website_url: result.candidate.website_url, reason: result.reason });
    else { seen.add(domain); verified.push(result.candidate); }
  }
  return { verified, rejected };
}
