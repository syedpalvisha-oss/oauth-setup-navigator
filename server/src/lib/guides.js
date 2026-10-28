import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuideSchema } from '../../schema/guide.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
const DIRS = ['guides', 'generated']; // curated library first: it wins over a generated guide with the same slug

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readGuide(dir, slug) {
  try {
    const parsed = GuideSchema.safeParse(JSON.parse(readFileSync(path.join(DATA_DIR, dir, `${slug}.json`), 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function getGuide(slug) {
  if (!SLUG_RE.test(slug)) return null;
  for (const dir of DIRS) {
    const guide = readGuide(dir, slug);
    if (guide) return guide;
  }
  return null;
}

export function listGuides() {
  const bySlug = new Map();
  for (const dir of DIRS) {
    let files = [];
    try {
      files = readdirSync(path.join(DATA_DIR, dir));
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const slug = f.slice(0, -5);
      if (bySlug.has(slug)) continue;
      const g = readGuide(dir, slug);
      if (g) bySlug.set(slug, { slug, name: g.app.name, tier: g.tier, summary: g.summary, generated_by: g.meta.generated_by });
    }
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function saveGeneratedGuide(slug, guide) {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);
  const dir = path.join(DATA_DIR, 'generated');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${slug}.json`), `${JSON.stringify(guide, null, 2)}\n`);
}
