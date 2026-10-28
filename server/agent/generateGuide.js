import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { complete, DeadlineError, GROQ_FAST_MODEL, GROQ_MODEL } from '../src/lib/llm.js';
import { tavilySearch } from '../src/lib/tavily.js';
import { cache } from '../src/lib/cache.js';
import { GuideSchema } from '../schema/guide.js';
import { runProbes } from './probes.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');


export const STAGES = [
  'Finding developer portal',
  'Reading OAuth setup docs',
  'Checking approval process',
  'Looking for real-world friction',
  'Checking Composio managed auth',
  'Testing endpoints',
  'Writing guide',
];

const AGENT_RULES = `You are a research agent that produces OAuth app setup guides for developers.

Rules:
- Every claim must be a complete, checkable statement of fact (a sentence with a subject and a predicate), never a topic label or a note about missing information such as "app review process details and unknown timelines".
- Every claim needs a confidence tag: "sourced" only with an official URL (the provider's own docs/help/portal pages) whose page text you actually saw AND a "supporting_quote": a short verbatim excerpt (under 300 characters, copied exactly, no ellipses) from that page that directly states the claim. If you cannot quote such a passage, the claim is "unverified". "agent_checked" only when one of the numbered endpoint-test attempts supports it; otherwise "unverified". Never use "tested" (that is reserved for humans who did the setup).
- Forum posts, blog posts, GitHub issues and Stack Overflow answers are NOT official: anything resting only on them is "unverified".
- Keep setup time and approval wait separate. If you cannot find a figure, use null and write "unknown" in the notes. Never guess a number.
- If there is no public self-serve registration, set tier "partner_gated" and say who to contact.
- Explicitly check for sensitive/restricted scopes and for testing-mode (unverified app / development mode) limits such as user caps and token expiry.
- When different products of the same provider have different access levels, use product_tiers. The top-level tier is the one most agent builders would hit; explain why in the summary.
- Never invent URLs. Only cite URLs that appeared in your search results or the probe attempts.`;


// Wall-clock budget for one run. Research stages must finish by RESEARCH_BUDGET_MS so stage 7 always has time;
// a stage that cannot finish is skipped and its claims end up "unverified" (partial guide) instead of the run hanging.
const TOTAL_BUDGET_MS = Number(process.env.GUIDE_BUDGET_MS) || 170_000;
const RESEARCH_BUDGET_MS = Number(process.env.GUIDE_RESEARCH_BUDGET_MS) || 100_000;

const noop = () => {};

// ---------- helpers ----------

function parseTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Input must be an app name or website URL');
  const asUrl = /^https?:\/\//i.test(raw) ? raw : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(raw) ? `https://${raw}` : null;
  if (asUrl) {
    const host = new URL(asUrl).hostname.replace(/^www\./, '');
    return { query: raw, website: new URL(asUrl).origin, name: host.split('.')[0] };
  }
  return { query: raw, website: null, name: raw };
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export { slugify };


function extractJson(text) {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model output contained no JSON object');
  return JSON.parse(stripped.slice(start, end + 1));
}

const normUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return null;
  }
};


// ---------- research (Tavily search -> LLM) ----------

// Groq's free tier allows ~8k tokens/minute per model, and five stages share the fast model's bucket,
// so each stage gets a small context (~1k tokens) and a short answer.
const MAX_CONTEXT_CHARS = 3500; // total search context passed to the model per stage
const PER_RESULT_CHARS = 900; // spread the context over several results rather than one long page
const STAGE_MAX_TOKENS = 1200;

/** Run 1-3 Tavily queries (concurrently), record result URLs as "seen", and format them as numbered sources. */
async function gatherSources({ queries, includeDomains, seenUrls, rawByUrl, onSearch, deadline, onTiming }) {
  const byUrl = new Map();
  const t0 = Date.now();
  queries.forEach((q) => onSearch(q));
  const batches = await Promise.all(queries.map((q) => tavilySearch(q, { includeDomains, deadline })));
  onTiming({ search_ms: Date.now() - t0, queries: queries.length });
  for (const results of batches) {
    for (const r of results) {
      seenUrls.add(r.url);
      const key = normUrl(r.url);
      if (key && !rawByUrl.has(key)) rawByUrl.set(key, { url: r.url, content: r.content });
      if (!byUrl.has(r.url)) byUrl.set(r.url, r);
    }
  }
  let used = 0;
  const blocks = [];
  for (const [i, r] of [...byUrl.values()].entries()) {
    const room = MAX_CONTEXT_CHARS - used;
    if (room < 300) break;
    const body = r.content.slice(0, Math.min(r.content.length, room, PER_RESULT_CHARS));
    used += body.length;
    blocks.push(`[${i + 1}] ${r.url}\nTitle: ${r.title}\n${body}`);
  }
  return blocks.join('\n\n') || '(no search results)';
}

/**
 * One research stage: targeted Tavily searches, then one JSON-mode model call over the results.
 * Returns the parsed JSON object; provider usage is reported through onModel.
 */
async function research({ queries, includeDomains, prompt, seenUrls, rawByUrl, onSearch, onModel, onLog, onTiming, deadline, label, model = GROQ_FAST_MODEL }) {
  const sources = await gatherSources({ queries, includeDomains, seenUrls, rawByUrl, onSearch, deadline, onTiming });
  const user = `${prompt}

Answer ONLY from the search results below; if they do not say, use null / "unknown". Keep every string under 200 characters and every list to at most 5 items. Return one JSON object and nothing else.

== Search results ==
${sources}`;
  const out = await complete({
    system: AGENT_RULES, messages: [{ role: 'user', content: user }], maxTokens: STAGE_MAX_TOKENS,
    model, altGroq: true, expectedOut: 400, deadline, label, onLog, onProvider: onModel,
  });
  return extractJson(out.text);
}

const asNotes = (o) => JSON.stringify(o);
const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
// ---------- validation ----------

/** Integrity checks beyond the Zod schema. Returns human-readable issues. */
const MAX_QUOTE_CHARS = 300;
const MIN_QUOTE_CHARS = 20; // shorter strings match almost any page, so they prove nothing

/** Whitespace/case-insensitive comparison form (also folds smart quotes and dashes). */
const normText = (s) =>
  String(s)
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const UNCERTAIN_WORDING = /\b(unknown|unclear|unspecified|undocumented|not (?:stated|specified|documented|disclosed|published|available))\b/i;
const PREDICATE =
  /\b(is|are|was|were|be|been|can|cannot|can't|must|may|might|should|will|does|do|has|have|had|requires?|required|needs?|needed|allows?|allowed|limited|limits?|expires?|expired|supports?|supported|returns?|returned|includes?|included|provides?|enforces?|restricts?|restricted|uses?|offers?|takes?|lasts?|ends?|only|caps?|capped|applies|apply|triggers?|means|states?|says?|lists?|permits?|prohibits?|blocks?)\b/i;

/** Why a "claim" is not a checkable statement of fact (a topic label, or a note about missing information), else null. */
function nonClaimReason(claim) {
  const text = String(claim).trim();
  if (UNCERTAIN_WORDING.test(text)) return 'describes missing/unknown information rather than stating a fact';
  if (text.split(/\s+/).length < 5 || !PREDICATE.test(text)) return 'is a topic label, not a statement that a page can support';
  return null;
}

/** Integrity checks beyond the Zod schema. Returns human-readable issues. */
function confidenceIssues(guide, { seenUrls, attempts, rawByUrl }) {
  const seen = new Set([...seenUrls].map(normUrl).filter(Boolean));
  const probed = new Set(attempts.map((a) => normUrl(a.url)).filter(Boolean));
  const issues = [];

  const quoteProblem = (quote, n, source_url) => {
    if (!quote || !quote.trim()) return 'sourced claims need a supporting_quote (verbatim excerpt from the source page)';
    if (quote.length > MAX_QUOTE_CHARS) return `supporting_quote is ${quote.length} chars; keep it under ${MAX_QUOTE_CHARS}`;
    if (quote.trim().length < MIN_QUOTE_CHARS) return `supporting_quote is too short to be evidence (min ${MIN_QUOTE_CHARS} chars)`;
    const page = rawByUrl.get(n);
    if (!page) return `no cached page content for ${source_url}, so supporting_quote cannot be verified`;
    if (!normText(page.content).includes(normText(quote))) return `supporting_quote does not appear in the cached content of ${source_url}`;
    return null;
  };

  // claimText is null for non-claim objects (composio_managed_auth), which have no sentence to test.
  const check = (label, { confidence, source_url, supporting_quote }, claimText, setDown) => {
    const n = source_url && normUrl(source_url);
    const flag = (msg) => issues.push({ label, msg, setDown });
    if (confidence === 'tested') flag(`"tested" is not allowed for agent output`);
    else if (confidence === 'sourced' && n && !seen.has(n) && !probed.has(n))
      flag(`source_url ${source_url} was never seen in search results or probes`);
    else if (confidence === 'sourced' && n) {
      const nonClaim = claimText != null && nonClaimReason(claimText);
      const bad = nonClaim ? `claim ${nonClaim}` : quoteProblem(supporting_quote, n, source_url);
      if (bad) flag(bad);
    } else if (confidence === 'agent_checked' && !(n && probed.has(n)))
      flag(`agent_checked needs a source_url matching a probed URL (${source_url ?? 'null'} does not)`);
  };
  const downgrade = (o) => () => {
    o.confidence = 'unverified';
    o.supporting_quote = null;
  };
  guide.claims_evidence?.forEach((c, i) =>
    check(`claims_evidence[${i}] "${String(c.claim).slice(0, 60)}"`, c, c.claim, downgrade(c)),
  );
  const cm = guide.composio_managed_auth;
  if (cm) check('composio_managed_auth', cm, null, downgrade(cm));
  return issues;
}

const zodIssues = (err) => err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);


// ---------- main ----------

const guideCacheKey = (slug) => `guide:${slug}`;

/** A guide that already exists (cache, curated, or previously generated) is returned without touching any model. */
async function findExistingGuide(slug) {
  const candidates = [];
  const cached = await cache.get(guideCacheKey(slug)).catch(() => null);
  if (cached) candidates.push(typeof cached === 'string' ? JSON.parse(cached) : cached);
  for (const dir of ['guides', 'generated']) {
    try {
      candidates.push(JSON.parse(readFileSync(path.join(DATA_DIR, dir, `${slug}.json`), 'utf8')));
    } catch {
      /* not there */
    }
  }
  for (const c of candidates) {
    const parsed = GuideSchema.safeParse(c);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * @param {string} input app name or website URL
 * @param {{ onProgress?: (e: object) => void, refresh?: boolean }} [opts]
 * @returns {{ guide, warnings: string[], cached?: boolean }}
 */
export async function generateGuide(input, { onProgress = noop, refresh = false } = {}) {
  const target = parseTarget(input);
  const total = STAGES.length;
  const emit = (index, status, detail = '') => {
    try {
      onProgress({ stage: STAGES[index], index: index + 1, total, status, detail, at: new Date().toISOString() });
    } catch {
      /* progress listeners must not break the run */
    }
  };

  if (!refresh) {
    const existing = await findExistingGuide(slugify(target.name));
    if (existing) return { guide: existing, warnings: [], cached: true };
  }

  const startedAt = Date.now();
  const researchDeadline = startedAt + RESEARCH_BUDGET_MS;
  const deadline = startedAt + TOTAL_BUDGET_MS;
  const seenUrls = new Set();
  const rawByUrl = new Map(); // normUrl -> { url, content }: cached page text, the only thing a supporting_quote may be checked against
  const modelsUsed = new Set();
  const subject = target.website ? `${target.name} (${target.website})` : target.name;
  const notes = {};
  const warnings = [];
  const name = target.name;
  const stageLog = STAGES.map((stage) => ({ stage, status: 'pending', start_ms: null, ms: null, search_ms: 0, llm_wait_ms: 0, calls: [] }));
  const sinceStart = () => Date.now() - startedAt;

  /**
   * Runs one stage and records its timing. With `soft`, a stage that cannot finish before its deadline is skipped
   * (returns `fallback`, adds a warning) so the run still produces a guide, with that stage's claims unverified.
   */
  const runStage = async (index, fn, { soft = false, fallback = null } = {}) => {
    const rec = stageLog[index];
    rec.start_ms = sinceStart();
    rec.status = 'running';
    emit(index, 'started');
    try {
      const out = await fn(
        (q) => emit(index, 'info', `searching: ${q}`),
        (r) => {
          modelsUsed.add(`${r.provider}:${r.model}`);
          emit(index, 'info', `answered by ${r.provider}:${r.model}${r.cached ? ' (cached)' : ''}`);
        },
        (entry) => {
          rec.calls.push(entry);
          rec.llm_wait_ms += entry.waitMs || 0;
        },
        (t) => {
          rec.search_ms = Math.max(rec.search_ms, t.search_ms);
        },
      );
      rec.status = 'completed';
      rec.ms = sinceStart() - rec.start_ms;
      emit(index, 'completed');
      return out;
    } catch (e) {
      rec.ms = sinceStart() - rec.start_ms;
      // Research stages are skipped on any error (every Groq model and Gemini already failed), not only on a missed deadline.
      if (soft) {
        rec.status = 'skipped';
        warnings.push(`stage "${STAGES[index]}" skipped: ${e.message}. Claims depending on it are unverified.`);
        emit(index, 'failed', `skipped: ${e.message}`);
        return fallback ?? { unavailable: e.message };
      }
      rec.status = 'failed';
      emit(index, 'failed', e.message);
      throw e;
    }
  };

  const stage = (index, args) =>
    runStage(
      index,
      (onSearch, onModel, onLog, onTiming) =>
        research({ seenUrls, rawByUrl, onSearch, onModel, onLog, onTiming, deadline: researchDeadline, label: STAGES[index], ...args }),
      { soft: true },
    );

  // Stages 1-5 are independent (each only needs the app name), so they run together. Each Groq model has its own
  // TPM bucket and llm.js queues calls against it, so running them concurrently does not cause 429s.
  // They are split across both Groq models (1,3,4,5 on 20b; 2 on 120b) so no single bucket carries all five.

  // 1. Developer portal
  const pPortal = stage(0, {
    model: GROQ_FAST_MODEL,
    queries: [`${name} developer portal register OAuth app`, `${name} API developer console create new app`],
    prompt: `Find the official developer portal and the OAuth app registration page for: ${subject}.
Give the official docs domain, the developer portal URL, the page where a developer registers/creates an OAuth app, and whether registration appears to need a login, a paid plan, or contacting sales. Only report URLs that appear in the search results.
JSON shape: {"official_domain": string|null, "portal_url": string|null, "registration_url": string|null, "docs_url": string|null, "registration_gating": string|null, "summary": string}`,
  });

  // 2. OAuth docs
  const pDocs = stage(1, {
    model: GROQ_MODEL,
    queries: [`${name} OAuth 2.0 authorization endpoint token endpoint redirect URI docs`, `${name} OAuth scopes sensitive restricted testing mode development limits`],
    prompt: `For ${subject}, read the official OAuth setup docs.
Report: the registration steps; redirect URI rules (https required? localhost? wildcards? limits); the exact authorize and token endpoint URLs; the scope list with any scopes the docs mark sensitive/restricted/requiring review; and any testing-mode / development-mode limits (user caps, token expiry). Cite official URLs.
JSON shape: {"authorize_url": string|null, "token_url": string|null, "issuer": string|null, "docs_url": string|null, "summary": string}`,
  });

  // 3. Approval process
  const pApproval = stage(2, {
    model: GROQ_FAST_MODEL,
    queries: [`${name} OAuth app review verification approval process`, `${name} app marketplace publish approval how long review takes`],
    prompt: `For ${subject}, research the approval process for OAuth apps: app review, app/brand verification, security assessments, partner programs or access requests, and the wait times. Report setup time and approval wait SEPARATELY, only with a figure if an official page states it; say "unknown" otherwise. Also state which scopes or products need review and what testing-mode limits exist. Cite official URLs.
JSON shape: {"summary": string, "setup_time": string, "approval_wait": string, "sources": string[]}`,
  });

  // 4. Real-world friction
  const pFriction = stage(3, {
    model: GROQ_FAST_MODEL,
    queries: [`${name} OAuth app rejected approval problems stackoverflow reddit`, `${name} OAuth invalid redirect_uri invalid scope error github issue`],
    prompt: `For ${subject}, look for real-world friction setting up and getting OAuth apps approved: forum threads, GitHub issues, Stack Overflow questions, rejection reasons and gotchas. Summarize the recurring problems and how people resolved them. These are anecdotal, so say where each came from and treat them as unverified unless an official page confirms them.
JSON shape: {"summary": string, "issues": [{"problem": string, "resolution": string|null, "source": string}]}`,
  });

  // 5. Composio
  const pComposio = stage(4, {
    model: GROQ_FAST_MODEL,
    includeDomains: ['docs.composio.dev', 'composio.dev'],
    queries: [`Composio ${name} toolkit managed auth OAuth`],
    prompt: `Check whether Composio offers managed auth (Composio-managed OAuth credentials) for ${subject}, using the toolkits listed at docs.composio.dev. If yes, a developer can start with it and needs their own OAuth app only for production branding, custom scopes or rate limits. If no, they need their own app from day one. If you cannot determine it, say so.
JSON shape: {"available": true|false|null, "notes": string, "source_url": string|null}`,
  });

  // 6. Endpoint tests (no LLM). Needs the endpoints from stages 1-2 only, so it overlaps with stages 3-5.
  const pProbe = Promise.all([pPortal, pDocs]).then(([portal, docs]) => {
    const endpoints = { ...portal, ...docs };
    endpoints.docs_url = docs.docs_url || portal.docs_url;
    return runStage(
      5,
      async () => {
        const timer = new Promise((_, reject) =>
          setTimeout(() => reject(new DeadlineError('endpoint tests passed the research deadline')), Math.max(0, researchDeadline - Date.now())).unref(),
        );
        const result = await Promise.race([
          runProbes({ website: target.website || endpoints.portal_url, endpoints }, (a) => emit(5, 'info', `${a.action} -> ${a.result}`)),
          timer,
        ]);
        for (const a of result.attempts) if (a.url) seenUrls.add(a.url);
        return result;
      },
      { soft: true, fallback: { attempts: [] } },
    );
  });

  const [portal, docs, approval, friction, composio, probeResult] = await Promise.all([pPortal, pDocs, pApproval, pFriction, pComposio, pProbe]);
  notes.portal = asNotes(portal);
  notes.docs = asNotes(docs);
  notes.approval = asNotes(approval);
  notes.friction = asNotes(friction);
  notes.composio = asNotes(composio);
  const attempts = probeResult.attempts;
  const publicAttempts = attempts.map(({ url, ...rest }) => rest);

  // 7. Write guide (the larger model; its own TPM bucket, so the research above never eats its budget)
  const result = await runStage(6, (_onSearch, onModel, onLog) =>
    writeGuide({ subject, target, notes, composio, attempts, publicAttempts, seenUrls, rawByUrl, modelsUsed, onModel, onLog, deadline }),
  );
  const slug = slugify(target.name); // keyed by what the user asked for, not by whatever name the model gave the app
  await cache.set(guideCacheKey(slug), JSON.stringify(result.guide)).catch(() => {});
  const timings = { total_ms: sinceStart(), budget_ms: TOTAL_BUDGET_MS, stages: stageLog };
  return { ...result, slug, warnings: [...warnings, ...result.warnings], partial: stageLog.some((s) => s.status === 'skipped'), timings };
}

// Stage 7 runs on the large model, whose free-tier budget is ~8k tokens/minute INCLUDING the answer (~2-3k for a guide).
// So the prompt must stay around 4-5k tokens: excerpts only for URLs the research stages actually cited, capped per URL.
const EXCERPT_BUDGET = 6000; // chars of page text handed to stage 7
const EXCERPT_PER_URL = 1500;
const MAX_URL_LIST = 40;
const FRICTION_ISSUES_KEPT = 4;
const UNOFFICIAL_HOST = /(^|\.)(stackoverflow|stackexchange|reddit|medium|quora|dev)\.(com|to)$/i;

const urlsIn = (text) => String(text).match(/https?:\/\/[^\s"',)\]\\]+/g) || [];

/**
 * Cached page text for the URLs the research notes cite. Forums and blogs are skipped (they cannot back a "sourced"
 * claim). Returns { text, urls } where urls are the cited URLs, used to shrink the allowed-URL list too.
 */
function citedSources(notes, attempts, rawByUrl) {
  const cited = new Map(); // normUrl -> url
  for (const u of [...urlsIn(Object.values(notes).join('\n')), ...attempts.map((a) => a.url).filter(Boolean)]) {
    const n = normUrl(u);
    if (n && !cited.has(n)) cited.set(n, u);
  }
  let room = EXCERPT_BUDGET;
  const blocks = [];
  for (const n of cited.keys()) {
    const page = rawByUrl.get(n);
    if (!page || !page.content || room < 200) continue;
    let host = '';
    try {
      host = new URL(page.url).hostname;
    } catch {
      continue;
    }
    if (UNOFFICIAL_HOST.test(host)) continue;
    const body = page.content.slice(0, Math.min(EXCERPT_PER_URL, room));
    room -= body.length;
    blocks.push(`URL: ${page.url}\n${body}`);
  }
  return { text: blocks.join('\n\n') || '(no page text available)', urls: [...cited.values()].slice(0, MAX_URL_LIST) };
}

/** Friction issues are anecdotal and always "unverified", so stage 7 only needs the top few. */
function slimFriction(friction) {
  if (!friction || !Array.isArray(friction.issues)) return friction;
  return { ...friction, issues: friction.issues.slice(0, FRICTION_ISSUES_KEPT) };
}

async function writeGuide({ subject, target, notes, composio, attempts, publicAttempts, seenUrls, rawByUrl, modelsUsed, onModel, onLog, deadline }) {
  const today = new Date().toISOString();
  const jsonSchema = z.toJSONSchema(GuideSchema, { unrepresentable: 'any' });

  const numberedAttempts = attempts.map((a, i) => ({ attempt: i + 1, url: a.url, action: a.action, result: a.result, evidence: String(a.evidence ?? '').slice(0, 160) }));
  const sources = citedSources(notes, attempts, rawByUrl);
  const prompt = `Write the OAuth setup guide for ${subject} as ONE JSON object matching this JSON Schema. Return only JSON, no prose, no code fences.

JSON Schema:
${JSON.stringify(jsonSchema)}

Instructions:
- Omit "agent_attempts" and "meta"; the system fills them in.
- "agent_checked" claims: set source_url to the exact URL that attempt probed and mention "attempt #N" in the claim text.
- "composio_managed_auth": use the Composio findings below; confidence "sourced" only if its source_url is an official docs.composio.dev page you saw and you can add a verbatim "supporting_quote" from it, else "unverified".
- Every "claims_evidence" entry with confidence "sourced" MUST include "supporting_quote": a verbatim excerpt (under 300 characters, copied exactly from the matching page text in "Source page excerpts" below, no ellipses or paraphrase) taken from the page at that entry's source_url, directly stating the claim. No fitting quote from that URL means "unverified" with supporting_quote null.
- Each claim must be a full sentence stating one checkable fact. Do not write process descriptions or notes about missing information (e.g. "app review process details and unknown timelines"); put unknowns in the notes fields instead.
- A research section marked {"unavailable": ...} was skipped for time: do not rely on it, and mark anything that would depend on it "unverified".
- app.website must be the provider's official site URL${target.website ? ` (${target.website})` : ''}.
- Today is ${today}.

== Research: developer portal ==
${notes.portal}

== Research: OAuth docs ==
${notes.docs}

== Research: approval process ==
${notes.approval}

== Research: real-world friction (anecdotal => unverified) ==
${JSON.stringify(slimFriction(safeParse(notes.friction)))}

== Research: Composio ==
${notes.composio}

== Endpoint test attempts (stage 6) ==
${JSON.stringify(numberedAttempts)}

== Source page excerpts (supporting_quote must be copied verbatim from the page at the claim's source_url) ==
${sources.text}

== URLs you may cite ==
${sources.urls.join('\n')}`;

  const messages = [{ role: 'user', content: prompt }];
  const warnings = [];

  const ask = async () => {
    const out = await complete({ system: AGENT_RULES, messages, maxTokens: 6000, onProvider: onModel, model: GROQ_MODEL, expectedOut: 2500, providers: ['gemini', 'groq'], deadline, label: 'Writing guide', onLog });
    return out.text;
  };

  const finalize = (raw) => {
    const obj = extractJson(raw);
    obj.agent_attempts = publicAttempts;
    obj.meta = { generated_by: 'agent', generated_at: today, last_checked: today, models_used: [...modelsUsed] };
    if (obj.composio_managed_auth == null && composio) {
      obj.composio_managed_auth = { available: composio.available ?? null, notes: composio.notes || 'unknown', confidence: 'unverified', source_url: composio.source_url || null };
    }
    return obj;
  };

  let raw = await ask();
  for (let attemptNo = 0; ; attemptNo++) {
    const lastChance = attemptNo === 1;
    let problems = [];
    let candidate = null; // schema-valid guide that only has confidence problems
    let issues = [];
    try {
      const parsed = GuideSchema.safeParse(finalize(raw));
      if (!parsed.success) problems = zodIssues(parsed.error);
      else {
        issues = confidenceIssues(parsed.data, { seenUrls, attempts, rawByUrl });
        if (!issues.length) return { guide: parsed.data, warnings };
        candidate = parsed.data;
        problems = issues.map((i) => `${i.label}: ${i.msg}`);
      }
    } catch (e) {
      problems = [`output was not valid JSON: ${e.message}`];
    }

    // Retry only when the output is unusable (bad JSON / schema). Confidence problems are fixed deterministically by
    // downgrading below: a retry replays the whole conversation (~7k tokens), which cannot fit a ~8k tokens/minute
    // budget without a ~60s wait.
    if (!lastChance && !candidate) {
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: `Your JSON failed validation. Fix every problem and return the full corrected JSON object only:\n- ${problems.join('\n- ')}` });
      try {
        raw = await ask();
        continue;
      } catch (e) {
        if (!(e instanceof DeadlineError)) throw e;
        warnings.push(`no time to retry stage 7 (${e.message})`);
      }
    }

    // Out of retries or time: downgrade offending claims rather than fail the whole guide.
    if (candidate) {
      for (const i of issues) {
        i.setDown();
        warnings.push(`${i.label}: ${i.msg} (downgraded to unverified)`);
      }
      const recheck = GuideSchema.safeParse(candidate);
      if (recheck.success) return { guide: recheck.data, warnings };
      problems = zodIssues(recheck.error);
    }
    const err = new Error(`Guide failed validation${lastChance ? ' after retry' : ' (no time to retry)'}:\n- ${problems.join('\n- ')}`);
    err.problems = problems;
    throw err;
  }
}
