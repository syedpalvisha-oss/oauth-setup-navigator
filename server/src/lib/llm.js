import { GoogleGenAI } from '@google/genai';
import { diskGet, diskSet } from './diskCache.js';

// Provider abstraction: Groq is primary, Gemini (no grounding) is the fallback.
export const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// Cheaper/faster model for extraction stages; each Groq model has its own TPM bucket, so this also spreads load.
export const GROQ_FAST_MODEL = process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export const groqConfigured = () => Boolean(process.env.GROQ_API_KEY);
export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
export const llmConfigured = () => groqConfigured() || geminiConfigured();

const CALL_TIMEOUT_MS = 60_000; // per provider call
const GEMINI_TIMEOUT_MS = 20_000; // hard cap: Gemini is a fallback only and its free tier can stall far longer than that
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DeadlineError extends Error {}

// ~4 chars/token matches what Groq reports for this English-heavy prompt text (3.5 over-reserved and queued parallel stages).
const estTokens = (text) => Math.ceil(String(text).length / 4);

// ---------- per-model TPM budget (sliding 60s window) ----------
// Groq's free tier is ~8k tokens/minute per model. Reserving budget up front means we wait only as long as needed
// instead of sending a call that 429s and then backing off for 15-90s. The limit is corrected from response headers.

const tpmLimits = new Map(); // model -> tokens per minute
const tpmWindow = new Map(); // model -> [{ at, tokens }]
const tpmLimitFor = (model) => tpmLimits.get(model) ?? (Number(process.env.GROQ_TPM) || 8000);

/** Reserve `tokens` of the model's minute budget, waiting if needed. Returns { entry, waitedMs }. */
async function reserveTokens(model, tokens, deadline) {
  const limit = tpmLimitFor(model);
  const win = tpmWindow.get(model) ?? [];
  tpmWindow.set(model, win);
  let waitedMs = 0;
  for (;;) {
    const now = Date.now();
    while (win.length && now - win[0].at >= 60_000) win.shift();
    const used = win.reduce((a, e) => a + e.tokens, 0);
    if (used + tokens <= limit) break;
    // wait until enough old entries expire
    let freed = 0;
    let until = now + 1000;
    for (const e of win) {
      freed += e.tokens;
      until = e.at + 60_000;
      if (used - freed + tokens <= limit) break;
    }
    const wait = Math.max(until - now, 250) + 100;
    if (deadline && now + wait > deadline) throw new DeadlineError(`TPM budget for ${model} would need a ${Math.round(wait / 1000)}s wait past the deadline`);
    // Sleep in short steps and re-check: reservations are corrected to actual usage when other calls finish,
    // which can free budget long before the pessimistic wait computed above would end.
    const step = Math.min(wait, 1000);
    await sleep(step);
    waitedMs += step;
  }
  const entry = { at: Date.now(), tokens };
  win.push(entry);
  return { entry, waitedMs };
}

class ProviderError extends Error {
  constructor(message, { status, retryAfterMs, unconfigured } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.unconfigured = unconfigured;
  }
  get rateLimited() {
    return this.status === 429 || this.status === 413 || this.status === 503;
  }
}

// ---------- Groq (OpenAI-compatible, JSON mode) ----------

async function callGroq({ system, messages, maxTokens, model = GROQ_MODEL, deadline }) {
  if (!groqConfigured()) throw new ProviderError('GROQ_API_KEY is not set', { unconfigured: true });
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      ...(model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(deadline ? Math.max(5_000, Math.min(CALL_TIMEOUT_MS, deadline - Date.now())) : CALL_TIMEOUT_MS),
  });
  const limitTokens = Number(res.headers.get('x-ratelimit-limit-tokens')) || null;
  if (limitTokens) tpmLimits.set(model, limitTokens);
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ProviderError(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`, {
      status: res.status,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    });
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new ProviderError('Groq returned an empty response');
  return {
    text,
    model,
    tokensIn: json.usage?.prompt_tokens ?? null,
    tokensOut: json.usage?.completion_tokens ?? null,
    limitTokens,
    remainingTokens: Number(res.headers.get('x-ratelimit-remaining-tokens')) || null,
  };
}

// ---------- Gemini (no grounding), throttled for the free tier ----------

const GEMINI_RPM = Number(process.env.GEMINI_RPM) || 4; // free tier is 5 RPM; keep a call of headroom
const geminiCalls = [];

async function geminiThrottle(deadline) {
  for (;;) {
    const now = Date.now();
    while (geminiCalls.length && now - geminiCalls[0] >= 60_000) geminiCalls.shift();
    if (geminiCalls.length < GEMINI_RPM) break;
    const wait = 60_000 - (now - geminiCalls[0]) + 250;
    if (deadline && now + wait > deadline) throw new DeadlineError(`Gemini RPM throttle would need a ${Math.round(wait / 1000)}s wait past the deadline`);
    await sleep(wait);
  }
  geminiCalls.push(Date.now());
}

let gemini;
async function callGemini({ system, messages, maxTokens, deadline }) {
  if (!geminiConfigured()) throw new ProviderError('GEMINI_API_KEY is not set', { unconfigured: true });
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  await geminiThrottle(deadline);
  try {
    const call = gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      config: { systemInstruction: system, responseMimeType: 'application/json', maxOutputTokens: maxTokens, abortSignal: AbortSignal.timeout(deadline ? Math.max(3_000, Math.min(GEMINI_TIMEOUT_MS, deadline - Date.now())) : GEMINI_TIMEOUT_MS) },
    });
    // The SDK can ignore abortSignal while retrying a 429, so the cap is enforced here as well.
    let timer;
    const response = await Promise.race([call, new Promise((_, rej) => { timer = setTimeout(() => rej(new ProviderError('Gemini timed out', { status: 504 })), GEMINI_TIMEOUT_MS + 2_000); })]).finally(() => clearTimeout(timer));
    const text = (response.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (!text) throw new ProviderError('Gemini returned an empty response');
    return { text, model: GEMINI_MODEL };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const hinted = /retryDelay"?:?\s*"?(\d+(?:\.\d+)?)s/i.exec(String(e.message));
    throw new ProviderError(`Gemini ${e.status ?? ''}: ${String(e.message).slice(0, 300)}`, {
      status: e.status,
      retryAfterMs: hinted ? Number(hinted[1]) * 1000 : undefined,
    });
  }
}

const PROVIDERS = [
  { name: 'groq', call: callGroq },
  { name: 'gemini', call: callGemini },
];

const MAX_ROUNDS = 3;
const EXPECTED_OUTPUT_TOKENS = 1500;

/**
 * JSON-mode completion. Tries Groq first (`model` selects which Groq model); falls back to Gemini only when Groq
 * errors or is rate limited. Answers are cached on disk by request, so an identical call never reaches a model twice.
 *
 * `deadline` (epoch ms) bounds every wait: if a rate-limit wait would pass it, a DeadlineError is thrown instead.
 * `onLog` receives one entry per call: { label, provider, model, ms, tokensIn, tokensOut, waitMs, waits, cached, ... }.
 * @returns {{ text: string, provider: string, model: string, cached?: boolean }}
 */
export async function complete({ system, messages, maxTokens = 4096, onProvider = () => {}, model = GROQ_MODEL, deadline, label = '', onLog = () => {}, expectedOut = EXPECTED_OUTPUT_TOKENS, providers = ['groq', 'gemini'], altGroq = false }) {
  const started = Date.now();
  // Fallback chain. With altGroq, a failing Groq model (tool_use_failed, 5xx, ...) is retried on the other Groq model before Gemini.
  const otherGroq = model === GROQ_MODEL ? GROQ_FAST_MODEL : GROQ_MODEL;
  // Gemini is optional: without a key it is left out of the chain entirely (no failed attempt, no wait, no message).
  const steps = providers
    .filter((n) => n !== 'gemini' || geminiConfigured())
    .flatMap((n) => {
      const p = PROVIDERS.find((x) => x.name === n);
      return n === 'groq' && altGroq ? [{ p, model }, { p, model: otherGroq }] : [{ p, model }];
    });
  const log = { label, waits: [], waitMs: 0, failures: [] };
  const finish = (extra) => onLog({ ...log, ...extra, ms: Date.now() - started });

  const cacheKey = `llm:${JSON.stringify([system, messages, maxTokens, model, GEMINI_MODEL])}`; // altGroq is deliberately not keyed: it only changes the fallback chain;
  const hit = process.env.GUIDE_NO_LLM_CACHE ? null : diskGet(cacheKey);
  if (hit) {
    onProvider({ ...hit, cached: true });
    finish({ provider: hit.provider, model: hit.model, cached: true });
    return { ...hit, cached: true };
  }

  const inputTokens = estTokens(system) + messages.reduce((a, m) => a + estTokens(m.content), 0);
  const failures = log.failures;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      failures.length = 0;
      let retryable = false;
      let waitMs = 0;
      for (const { p, model: m } of steps) {
        let reservation;
        try {
          if (p.name === 'groq') {
            if (!groqConfigured()) throw new ProviderError('GROQ_API_KEY is not set', { unconfigured: true });
            // Groq charges actual usage, not max_tokens (verified with a probe), so reserve input + a modest output guess.
            const want = Math.min(inputTokens + Math.min(maxTokens, expectedOut), tpmLimitFor(m));
            reservation = await reserveTokens(m, want, deadline);
            if (reservation.waitedMs) {
              log.waits.push({ reason: `${m} TPM budget`, ms: reservation.waitedMs });
              log.waitMs += reservation.waitedMs;
            }
          }
          const out = await p.call({ system, messages, maxTokens, model: m, deadline });
          // Replace the up-front estimate with what Groq actually counted.
          if (reservation && out.tokensIn != null) reservation.entry.tokens = out.tokensIn + (out.tokensOut ?? 0);
          const result = { text: out.text, provider: p.name, model: out.model };
          diskSet(cacheKey, result);
          onProvider(result);
          finish({ provider: p.name, model: out.model, tokensIn: out.tokensIn ?? null, tokensOut: out.tokensOut ?? null, limitTokens: out.limitTokens ?? null, remainingTokens: out.remainingTokens ?? null });
          return result;
        } catch (e) {
          if (e instanceof DeadlineError) throw e;
          // A call that failed for a reason other than rate limiting (e.g. tool_use_failed) used no budget: give the reservation back.
          if (reservation && !e.rateLimited) {
            const w = tpmWindow.get(m);
            const i = w ? w.indexOf(reservation.entry) : -1;
            if (i >= 0) w.splice(i, 1);
          }
          failures.push(`${p.name}${p.name === 'groq' ? `(${m})` : ''}: ${e.message}`);
          if (e.unconfigured) continue;
          if (e.rateLimited) retryable = true;
          waitMs = Math.max(waitMs, e.retryAfterMs ?? 0);
        }
      }
      // Back off and retry the chain only if some provider was rate limited; other errors are final.
      if (!retryable) break;
      const wait = Math.min(Math.max(waitMs, 15_000 * 2 ** round), 90_000);
      if (deadline && Date.now() + wait > deadline) throw new DeadlineError(`rate-limit backoff of ${Math.round(wait / 1000)}s would pass the deadline (${failures.join(' | ').slice(0, 400)})`);
      log.waits.push({ reason: 'rate-limit backoff', ms: wait });
      log.waitMs += wait;
      await sleep(wait);
    }
    throw new Error(`All LLM providers failed:\n- ${failures.join('\n- ')}`);
  } catch (e) {
    finish({ error: e.message.split('\n')[0].slice(0, 200) });
    throw e;
  }
}
