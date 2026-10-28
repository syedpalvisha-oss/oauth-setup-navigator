import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeValidateGuide } from '../schema/guide.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/guides');
let failed = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  let json;
  try {
    json = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  } catch (e) {
    console.error(`FAIL ${file}: invalid JSON (${e.message})`);
    failed++;
    continue;
  }
  const result = safeValidateGuide(json);
  if (result.success) {
    const counts = json.claims_evidence.reduce((a, c) => ((a[c.confidence] = (a[c.confidence] || 0) + 1), a), {});
    console.log(`ok   ${file}  tier=${json.tier}  generated_by=${json.meta.generated_by}  claims=${JSON.stringify(counts)}`);
  } else {
    failed++;
    console.error(`FAIL ${file}`);
    for (const i of result.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  }
}

process.exit(failed ? 1 : 0);
