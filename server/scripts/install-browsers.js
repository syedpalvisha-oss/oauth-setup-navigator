// Build step: download Chromium for the endpoint tests' JS-rendered pages.
// It must never fail the deploy: without Chromium the probes fall back to plain fetches (see agent/probes.js).
import { spawnSync } from 'node:child_process';

if (process.env.PLAYWRIGHT_DISABLED === '1') {
  console.log('PLAYWRIGHT_DISABLED=1: skipping Chromium download (endpoint tests will use plain fetches).');
  process.exit(0);
}

// Install inside node_modules so the browser is still there at runtime (probes.js sets the same value).
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0' };
const res = spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: new URL('..', import.meta.url), env, stdio: 'inherit', shell: true });
if (res.status !== 0) console.warn('Chromium install failed; continuing. Endpoint tests will fall back to plain fetches.');
