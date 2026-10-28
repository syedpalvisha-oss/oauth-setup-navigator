import dns from 'node:dns/promises';
import net from 'node:net';

const UA = 'OAuthSetupNavigator/0.1 (endpoint probe)';
const TIMEOUT_MS = 15_000;
const MAX_HOPS = 5;
const MAX_BODY_CHARS = 300_000;

const LOGIN_RE = /(log-?in|sign-?in|signin|sso|\/auth\/|accounts\.|\/authenticate|\/session\/new)/i;
const PAYWALL_RE =
  /(contact sales|talk to sales|request access|apply for access|paid plan|upgrade to|enterprise plan|waitlist|partner program|become a partner)/gi;

// ---- SSRF guard: URLs come from model output, so only public http(s) hosts are fetched ----

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`unsupported protocol ${u.protocol}`);
  if (u.port && u.port !== '80' && u.port !== '443') throw new Error(`blocked port ${u.port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('blocked: resolves to a private address');
  return u;
}

/** Fetch following redirects manually so every hop passes the SSRF guard. */
export async function safeFetch(url, { headers = {} } = {}) {
  const redirects = [];
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...headers },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, current).href;
        redirects.push({ status: res.status, location: next });
        current = next;
        continue;
      }
      const body = (await res.text()).slice(0, MAX_BODY_CHARS);
      return { status: res.status, finalUrl: current, redirects, contentType: res.headers.get('content-type') || '', body };
    }
    return { error: `too many redirects (>${MAX_HOPS})`, redirects, finalUrl: current };
  } catch (e) {
    return { error: e.cause?.code || e.message, redirects, finalUrl: current };
  }
}

// ---- helpers ----

export function visibleText(html) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const looksJsRendered = (html, text) =>
  text.length < 400 || (/id=["'](root|__next|app)["']/i.test(html) && text.length < 1500);

function gatingSignals(r, text) {
  const hops = [...r.redirects.map((h) => h.location), r.finalUrl];
  const loginRedirect = hops.slice(1).some((h) => LOGIN_RE.test(h)) || (r.redirects.length > 0 && LOGIN_RE.test(r.finalUrl));
  const passwordField = /type=["']password["']/i.test(r.body || '');
  const paywallHits = [...new Set([...text.matchAll(PAYWALL_RE)].map((m) => m[0].toLowerCase()))].slice(0, 5);
  return { loginRedirect, passwordField, paywallHits };
}

let playwrightState; // 'ok' | 'unavailable'
async function renderWithPlaywright(url) {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: UA });
    await page.route('**/*', async (route) => {
      try {
        await assertPublicUrl(route.request().url());
        await route.continue();
      } catch {
        await route.abort();
      }
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    const text = (await page.evaluate(() => document.body?.innerText || '')).replace(/\s+/g, ' ').trim();
    const hasPassword = (await page.locator('input[type=password]').count()) > 0;
    playwrightState = 'ok';
    return { finalUrl: page.url(), text, hasPassword };
  } catch (e) {
    if (/Executable doesn't exist|Cannot find (module|package)/i.test(e.message)) playwrightState = 'unavailable';
    return { error: e.message.split('\n')[0] };
  } finally {
    await browser?.close().catch(() => {});
  }
}

const snippet = (s, n = 280) => (s.length > n ? `${s.slice(0, n)}…` : s);
const originOf = (u) => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

// ---- individual checks ----

async function pageCheck({ url, label }, record) {
  const r = await safeFetch(url);
  if (r.error) {
    record({ url, action: `GET ${label}: ${url}`, result: `request failed: ${r.error}`, evidence: `redirect chain: ${r.redirects.map((h) => h.status).join('>') || 'none'}` });
    return { label, url, ok: false };
  }
  const text = visibleText(r.body);
  const sig = gatingSignals(r, text);
  let rendered;
  if (r.status < 400 && /html/i.test(r.contentType) && looksJsRendered(r.body, text)) {
    rendered = await renderWithPlaywright(r.finalUrl);
    if (!rendered.error) {
      sig.passwordField ||= rendered.hasPassword;
      sig.paywallHits = [...new Set([...sig.paywallHits, ...[...rendered.text.matchAll(PAYWALL_RE)].map((m) => m[0].toLowerCase())])].slice(0, 5);
      if (LOGIN_RE.test(rendered.finalUrl) && rendered.finalUrl !== r.finalUrl) sig.loginRedirect = true;
      const pathKey = (x) => `${new URL(x).origin}${new URL(x).pathname}`.replace(/\/$/, '');
      if (pathKey(rendered.finalUrl) !== pathKey(r.finalUrl)) sig.clientRedirect = rendered.finalUrl;
    }
  }
  const verdict = sig.loginRedirect || sig.passwordField
    ? 'behind a login'
    : sig.clientRedirect
      ? `client-side redirect to ${sig.clientRedirect} (page is not directly reachable; likely needs sign-in)`
      : r.status >= 400
        ? `HTTP ${r.status}`
        : 'loads without login';
  const evidence = [
    `status ${r.status}`,
    `final ${r.finalUrl}`,
    r.redirects.length ? `redirects ${r.redirects.map((h) => h.status).join('>')}` : null,
    `login-redirect=${sig.loginRedirect} password-field=${sig.passwordField}`,
    sig.paywallHits.length ? `gating phrases: ${sig.paywallHits.join(', ')}` : 'no paywall/contact-sales phrases',
    rendered
      ? rendered.error
        ? `playwright: ${rendered.error}`
        : `playwright rendered (${rendered.finalUrl}): "${snippet(rendered.text, 160)}"`
      : null,
  ]
    .filter(Boolean)
    .join('; ');
  record({ url, action: `GET ${label}: ${url}`, result: verdict, evidence });
  return { label, url, ok: true, status: r.status, ...sig };
}

async function authorizeCheck(authorizeUrl, record) {
  const u = new URL(authorizeUrl);
  u.search = '';
  u.searchParams.set('client_id', 'oauth-setup-navigator-dummy-client');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', 'https://example.com/callback');
  u.searchParams.set('state', 'probe');
  const r = await safeFetch(u.href);
  const base = authorizeUrl.split('?')[0];
  if (r.error) {
    record({ url: base, action: `GET authorize endpoint with dummy client_id: ${base}`, result: `request failed: ${r.error}`, evidence: '' });
    return;
  }
  const text = r.contentType.includes('json') ? r.body : visibleText(r.body);
  const exists = r.status !== 404 && r.status !== 410;
  record({
    url: base,
    action: `GET authorize endpoint with dummy client_id: ${base}`,
    result: exists ? `endpoint responds (HTTP ${r.status})` : `endpoint not found (HTTP ${r.status})`,
    evidence: `final ${r.finalUrl}; redirects ${r.redirects.map((h) => h.status).join('>') || 'none'}; body: "${snippet(text)}"`,
  });
}

async function discoveryCheck(origin, record) {
  const found = [];
  for (const wk of ['openid-configuration', 'oauth-authorization-server']) {
    const url = `${origin}/.well-known/${wk}`;
    const r = await safeFetch(url, { headers: { accept: 'application/json' } });
    if (r.error || r.status !== 200) {
      record({ url, action: `GET ${url}`, result: r.error ? `request failed: ${r.error}` : `not available (HTTP ${r.status})`, evidence: '' });
      continue;
    }
    try {
      const doc = JSON.parse(r.body);
      const scopes = Array.isArray(doc.scopes_supported) ? doc.scopes_supported : [];
      record({
        url,
        action: `GET ${url}`,
        result: 'discovery document found',
        evidence: `issuer=${doc.issuer}; authorization_endpoint=${doc.authorization_endpoint}; token_endpoint=${doc.token_endpoint}; scopes_supported(${scopes.length})=${scopes.slice(0, 40).join(' ') || 'not listed'}`,
      });
      found.push({ url, doc });
    } catch {
      record({ url, action: `GET ${url}`, result: 'HTTP 200 but not valid JSON', evidence: snippet(visibleText(r.body)) });
    }
  }
  return found;
}

/**
 * Stage 6. `endpoints` comes from the research stages (all fields optional).
 * Returns { attempts, summary }. Each attempt also carries `url` for cross-checking claims.
 */
export async function runProbes({ website, endpoints }, onAttempt = () => {}) {
  const attempts = [];
  const record = (a) => {
    const attempt = { ...a, timestamp: new Date().toISOString() };
    attempts.push(attempt);
    onAttempt(attempt);
  };

  const pages = [
    ['developer portal', endpoints.portal_url],
    ['OAuth app registration page', endpoints.registration_url],
    ['OAuth docs', endpoints.docs_url],
  ]
    .filter(([, u]) => typeof u === 'string' && /^https?:\/\//.test(u))
    .filter(([, u], i, all) => all.findIndex(([, v]) => v === u) === i)
    .map(([label, url]) => ({ label, url }));

  const pageResults = [];
  for (const p of pages) pageResults.push(await pageCheck(p, record));

  if (typeof endpoints.authorize_url === 'string' && /^https?:\/\//.test(endpoints.authorize_url)) {
    await authorizeCheck(endpoints.authorize_url, record);
  } else {
    record({ url: website || 'n/a', action: 'Authorize endpoint probe', result: 'skipped: no authorize URL found in docs', evidence: '' });
  }

  const origins = [...new Set([website, endpoints.authorize_url, endpoints.issuer, endpoints.portal_url].map((u) => u && originOf(u)).filter(Boolean))].slice(0, 4);
  const discovery = [];
  for (const o of origins) discovery.push(...(await discoveryCheck(o, record)));

  if (playwrightState === 'unavailable') {
    record({ url: 'n/a', action: 'Playwright rendering', result: 'skipped: Chromium not installed (npx playwright install chromium)', evidence: '' });
  }

  return { attempts, summary: { pageResults, discovery: discovery.map((d) => d.url) } };
}
