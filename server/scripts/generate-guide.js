import '../src/lib/env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGuide, slugify } from '../agent/generateGuide.js';

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const input = args.filter((a) => a !== '--refresh').join(' ');
if (!input) {
  console.error('Usage: npm run generate:guide -- "<app name or website URL>"');
  process.exit(2);
}
if (!process.env.TAVILY_API_KEY || !(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY)) {
  console.error('TAVILY_API_KEY and GROQ_API_KEY (or GEMINI_API_KEY) must be set in the repo-root .env.');
  process.exit(2);
}

try {
  const { guide, warnings, cached, timings, partial, slug } = await generateGuide(input, {
    refresh,
    onProgress: (e) => console.error(`[${e.index}/${e.total}] ${e.stage} - ${e.status}${e.detail ? `: ${e.detail}` : ''}`),
  });
  if (cached) console.error('using existing guide (no model calls); pass --refresh to regenerate');
  const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/generated');
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${slug ?? slugify(guide.app.name)}.json`);
  writeFileSync(file, `${JSON.stringify(guide, null, 2)}\n`);
  if (timings) {
    console.error(`
timing: total ${(timings.total_ms / 1000).toFixed(1)}s (budget ${timings.budget_ms / 1000}s)${partial ? ' PARTIAL' : ''}`);
    for (const st of timings.stages) {
      console.error(`  ${st.stage.padEnd(32)} ${st.status.padEnd(9)} start ${((st.start_ms ?? 0) / 1000).toFixed(1)}s  took ${((st.ms ?? 0) / 1000).toFixed(1)}s  search ${(st.search_ms / 1000).toFixed(1)}s  llm-wait ${(st.llm_wait_ms / 1000).toFixed(1)}s`);
      for (const c of st.calls)
        console.error(`      llm ${c.provider ?? '-'}:${c.model ?? '-'} ${c.cached ? 'cached' : `${(c.ms / 1000).toFixed(1)}s`} in=${c.tokensIn ?? '?'} out=${c.tokensOut ?? '?'} limit=${c.limitTokens ?? '?'} waits=${JSON.stringify(c.waits)}${c.error ? ` ERROR ${c.error}` : ''}`);
    }
  }
  for (const w of warnings) console.error(`warning: ${w}`);
  console.error(`saved ${file}`);
  console.log(JSON.stringify(guide, null, 2));
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
}
