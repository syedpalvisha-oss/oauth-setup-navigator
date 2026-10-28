import { Router } from 'express';
import { cache } from '../lib/cache.js';
import { groqConfigured, geminiConfigured } from '../lib/llm.js';
import { tavilyConfigured } from '../lib/tavily.js';

const router = Router();

router.get('/health', (_req, res) => {
  const flag = (ok) => (ok ? 'configured' : 'missing-key');
  res.json({
    status: 'ok',
    cache: cache.backend,
    tavily: flag(tavilyConfigured()),
    groq: flag(groqConfigured()),
    gemini: flag(geminiConfigured()),
    time: new Date().toISOString(),
  });
});

export default router;
