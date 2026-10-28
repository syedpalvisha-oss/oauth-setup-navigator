import { Router } from 'express';
import { generateGuide, lookupGuide } from '../../agent/generateGuide.js';
import { saveGeneratedGuide } from '../lib/guides.js';
import { rateLimit } from '../lib/rateLimit.js';
import { llmConfigured } from '../lib/llm.js';
import { tavilyConfigured } from '../lib/tavily.js';

const router = Router();
const MAX_QUERY_CHARS = 200;

router.post('/generate', rateLimit({ max: 5, windowMs: 10 * 60_000 }), async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query || query.length > MAX_QUERY_CHARS) {
    return res.status(400).json({ error: `"query" must be a non-empty string of at most ${MAX_QUERY_CHARS} characters (an app name or website URL)` });
  }

  // Existing guides come back as plain JSON without touching any model.
  let existing;
  try {
    existing = await lookupGuide(query);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (existing) return res.json({ slug: existing.slug, cached: true, guide: existing.guide });

  if (!tavilyConfigured() || !llmConfigured()) return res.status(503).json({ error: 'Generation is not configured on this server (missing TAVILY_API_KEY and/or GROQ_API_KEY/GEMINI_API_KEY)' });

  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // The run continues (and saves) even if the client disconnects, so the work is never wasted.
    const result = await generateGuide(query, { refresh: true, onProgress: (e) => send('progress', e) });
    saveGeneratedGuide(result.slug, result.guide);
    send('result', { slug: result.slug, cached: false, partial: Boolean(result.partial), warnings: result.warnings, guide: result.guide });
  } catch (e) {
    send('error', { error: e.message.split('\n')[0] });
  }
  res.end();
});

export default router;
