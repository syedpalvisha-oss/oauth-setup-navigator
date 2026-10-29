import { Router } from 'express';
import { generateGuide, lookupGuide } from '../../agent/generateGuide.js';
import { saveGeneratedGuide } from '../lib/guides.js';
import { rateLimit } from '../lib/rateLimit.js';
import { llmConfigured } from '../lib/llm.js';
import { tavilyConfigured } from '../lib/tavily.js';
import { FRIENDLY_FAILURE, validateQuery } from '../lib/validateQuery.js';

const router = Router();

/**
 * What the browser may see of a progress event. Provider, model and API error text stays in the server log: only the stage
 * and its status go out, plus the one reason users are told about ("nothing to test").
 */
function publicProgress(e) {
  if (e.status === 'info') return null;
  let detail = '';
  if (e.status === 'failed') detail = e.detail === 'skipped: nothing to test' ? e.detail : String(e.detail).startsWith('skipped') ? 'skipped' : 'failed';
  return { stage: e.stage, index: e.index, total: e.total, status: e.status, detail, at: e.at };
}

router.post('/generate', rateLimit({ max: 5, windowMs: 10 * 60_000 }), async (req, res) => {
  const checked = validateQuery(req.body?.query);
  if (!checked.ok) return res.status(400).json({ error: checked.error });
  const query = checked.query;

  // Existing guides come back as plain JSON without touching any model.
  let existing;
  try {
    existing = await lookupGuide(query);
  } catch (e) {
    console.error(`lookup failed for "${query}": ${e.message}`);
    return res.status(400).json({ error: validateQuery('').error });
  }
  if (existing) return res.json({ slug: existing.slug, cached: true, guide: existing.guide });

  if (!tavilyConfigured() || !llmConfigured()) {
    console.error('generation refused: missing TAVILY_API_KEY and/or GROQ_API_KEY/GEMINI_API_KEY');
    return res.status(503).json({ error: FRIENDLY_FAILURE });
  }

  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // The run continues (and saves) even if the client disconnects, so the work is never wasted.
    const onProgress = (e) => {
      const p = publicProgress(e);
      if (p) send('progress', p);
    };
    const result = await generateGuide(query, { refresh: true, onProgress });
    const skipped = (result.timings?.stages || []).filter((s) => s.status === 'skipped').map((s) => s.stage);
    if (skipped.length) result.guide.meta.skipped_stages = skipped;
    saveGeneratedGuide(result.slug, result.guide);
    for (const w of result.warnings || []) console.warn(`  warning: ${w}`);
    if (result.timings) {
      const t = result.timings;
      console.log(`generated "${result.slug}" in ${(t.total_ms / 1000).toFixed(1)}s`);
      for (const st of t.stages) {
        const calls = st.calls.map((c) => `${c.model ?? '-'} in=${c.tokensIn ?? '?'} out=${c.tokensOut ?? '?'} waits=${JSON.stringify(c.waits)}${c.failures?.length ? ` failures=${JSON.stringify(c.failures).slice(0, 200)}` : ''}${c.error ? ` ERROR ${c.error}` : ''}`);
        console.log(`  ${st.stage.padEnd(32)} ${st.status.padEnd(9)} ${((st.ms ?? 0) / 1000).toFixed(1)}s llm-wait ${(st.llm_wait_ms / 1000).toFixed(1)}s ${calls.join(' ; ')}`);
      }
    }
    send('result', { slug: result.slug, cached: false, partial: Boolean(result.partial) });
  } catch (e) {
    // Stage 7 (or anything else) failed: nothing was saved, because saving only happens after a successful run.
    console.error(`generation failed for "${query}": ${e.message}`);
    send('error', { error: FRIENDLY_FAILURE });
  }
  res.end();
});

export default router;
