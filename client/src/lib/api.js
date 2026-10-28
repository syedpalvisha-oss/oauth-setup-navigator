export async function fetchGuides() {
  const res = await fetch('/api/guides');
  if (!res.ok) throw new Error(`Could not load guides (HTTP ${res.status})`);
  return res.json();
}

export async function fetchGuide(slug) {
  const res = await fetch(`/api/guides/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load guide (HTTP ${res.status})`);
  return res.json();
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Match a search query (app name or URL) to an already-listed guide, so no generation is needed. */
export function findGuide(guides, query) {
  let q = query.trim();
  try {
    if (/^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+/.test(q)) q = new URL(/^https?:/i.test(q) ? q : `https://${q}`).hostname.replace(/^www\./, '').split('.')[0];
  } catch {
    /* keep the raw query */
  }
  const n = norm(q);
  if (!n) return null;
  return guides.find((g) => norm(g.slug) === n) || guides.find((g) => norm(g.name).startsWith(n) || norm(g.slug).startsWith(n)) || null;
}

/**
 * POST /api/generate. An existing guide comes back as JSON; otherwise the response is an SSE stream.
 * Resolves with { slug } once done. `onEvent(event, data)` receives every 'progress' event.
 */
export async function generate(query, { onEvent, signal }) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal,
  });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (HTTP ${res.status})`);
  }
  if (type.includes('application/json')) {
    const body = await res.json();
    return { slug: body.slug, partial: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const dataLine = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === 'progress') onEvent(data);
      else if (event === 'result') result = data;
      else if (event === 'error') throw new Error(data.error || 'Generation failed');
    }
  }
  if (!result) throw new Error('The connection closed before the guide was finished.');
  return { slug: result.slug, partial: Boolean(result.partial) };
}
