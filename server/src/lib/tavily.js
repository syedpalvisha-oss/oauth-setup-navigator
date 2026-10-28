import { diskGet, diskSet } from './diskCache.js';

export const tavilyConfigured = () => Boolean(process.env.TAVILY_API_KEY);

const RAW_CHARS = 900; // per-result cap on raw page content passed to the model
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one Tavily search. Returns [{ url, title, content }] where content is the trimmed raw page text
 * (falling back to Tavily's snippet).
 */
export async function tavilySearch(query, { includeDomains, maxResults = 5, deadline } = {}) {
  if (!tavilyConfigured()) throw new Error('TAVILY_API_KEY is not set');
  const cacheKey = `tavily:${JSON.stringify([query, includeDomains || null, maxResults, RAW_CHARS])}`;
  const hit = diskGet(cacheKey);
  if (hit) return hit;

  const body = {
    query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_raw_content: 'text',
    ...(includeDomains ? { include_domains: includeDomains } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deadline ? Math.max(3_000, Math.min(60_000, deadline - Date.now())) : 60_000),
    });
    if (res.ok) {
      const json = await res.json();
      const results = (json.results || [])
        .filter((r) => r.url)
        .map((r) => ({
          url: r.url,
          title: r.title || '',
          content: String(r.raw_content || r.content || '').replace(/\s+/g, ' ').trim().slice(0, RAW_CHARS),
        }));
      diskSet(cacheKey, results);
      return results;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new Error(`Tavily search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}
