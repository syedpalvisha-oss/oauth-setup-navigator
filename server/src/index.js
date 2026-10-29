import './lib/env.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import guidesRouter from './routes/guides.js';
import generateRouter from './routes/generate.js';
import { cache } from './lib/cache.js';
import { groqConfigured } from './lib/llm.js';
import { tavilyConfigured } from './lib/tavily.js';

const app = express();
// Behind a hosting proxy (Render) every request arrives from the proxy's address, so the per-IP rate limit needs the real client IP
// from X-Forwarded-For. TRUST_PROXY is the number of proxy hops; it defaults to 1 in production and 0 locally.
const hops = Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : 0));
if (hops > 0) app.set('trust proxy', hops);

app.use(cors());
app.use(express.json());

app.use('/api', healthRouter);
app.use('/api', guidesRouter);
app.use('/api', generateRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production the built React app is served from this same process.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  // Client-side routes (/guide/:slug, /generate) fall back to the app shell.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Server listening on port ${port} (cache: ${cache.backend}, client: ${existsSync(clientDist) ? 'served' : 'not built'})`);
  const missing = [!tavilyConfigured() && 'TAVILY_API_KEY', !groqConfigured() && 'GROQ_API_KEY'].filter(Boolean);
  if (missing.length) console.warn(`Missing ${missing.join(', ')}: browsing the guide library works, but generating new guides is disabled.`);
});
