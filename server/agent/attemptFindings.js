// Turns endpoint-test attempts into blockers: login walls, gated access (paywall / contact sales / partner pages) and dead URLs.
// client/src/lib/attemptFindings.js is a copy of this logic (the page renders findings from existing guides too); keep them in sync.

const PAGE_ACTION = /^GET (developer portal|OAuth app registration page|OAuth docs): (https?:\/\/\S+)$/;

/** @param {{ action: string, result?: string, evidence?: string }[]} attempts */
export function attemptFindings(attempts = []) {
  const out = [];
  const seen = new Set();
  const add = (f) => {
    if (!seen.has(f.issue)) {
      seen.add(f.issue);
      out.push(f);
    }
  };
  for (const a of attempts) {
    const m = PAGE_ACTION.exec(a.action || '');
    if (!m) continue;
    const [, label, url] = m;
    const result = a.result || '';
    if (/^(behind a login|client-side redirect)/.test(result)) {
      add({ kind: 'login', label, url, issue: `The ${label} is behind a login (${url}).`, how_to_resolve: 'Sign in or create a developer account first; the agent could not read this page without one.' });
    } else if (/^(HTTP [45]\d\d|request failed)/.test(result)) {
      add({ kind: 'dead', label, url, issue: `The ${label} URL looks dead (${url}: ${result}).`, how_to_resolve: "Find the current page from the provider's developer docs; the link the agent found no longer works." });
    }
    const gating = /gating phrases: ([^;]+)/.exec(a.evidence || '')?.[1];
    if (gating) {
      add({ kind: 'gated', label, url, issue: `The ${label} mentions gated access (${gating.trim()}).`, how_to_resolve: 'Check whether you need a paid plan, a sales conversation or partner approval before you can register an app.' });
    }
  }
  return out;
}

/** One-line note for the verdict card, or null when the checks found nothing. */
export function verdictNote(findings) {
  if (!findings.length) return null;
  return `Agent check: ${findings.map((f) => f.issue).join(' ')}`;
}
