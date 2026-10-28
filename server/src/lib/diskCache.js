import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/.cache');

const fileFor = (key) => path.join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 40)}.json`);

/** Persistent cache for search results and model answers, so reruns never repeat a limited call. */
export function diskGet(key, ttlMs = 7 * 24 * 3600 * 1000) {
  try {
    const entry = JSON.parse(readFileSync(fileFor(key), 'utf8'));
    return Date.now() - entry.at < ttlMs ? entry.value : null;
  } catch {
    return null;
  }
}

export function diskSet(key, value) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fileFor(key), JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* caching is best-effort */
  }
}
