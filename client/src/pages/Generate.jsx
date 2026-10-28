import { useCallback, useEffect, useRef, useState } from 'react';
import { generate } from '../lib/api.js';
import { Link, navigate } from '../lib/router.jsx';

const STAGES = [
  'Finding developer portal',
  'Reading OAuth setup docs',
  'Checking approval process',
  'Looking for real-world friction',
  'Checking Composio managed auth',
  'Testing endpoints',
  'Writing guide',
];

const fmt = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
const ICON = { done: '✓', skipped: '–', failed: '!', running: '', pending: '' };
const LABEL = { done: 'Done', skipped: 'Skipped', failed: 'Failed', running: 'Running', pending: 'Waiting' };

export default function Generate({ query }) {
  const [stages, setStages] = useState(() => STAGES.map(() => ({ status: 'pending', startedAt: null, ms: null, note: '' })));
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(Date.now());
  const runId = useRef(0);

  const run = useCallback(() => {
    const id = ++runId.current;
    startRef.current = Date.now();
    setError(null);
    setStages(STAGES.map(() => ({ status: 'pending', startedAt: null, ms: null, note: '' })));

    const onEvent = (e) => {
      if (id !== runId.current) return;
      setStages((prev) =>
        prev.map((s, i) => {
          if (i !== e.index - 1) return s;
          if (e.status === 'started') return { ...s, status: 'running', startedAt: Date.now() };
          if (e.status === 'completed') return { ...s, status: 'done', ms: Date.now() - (s.startedAt ?? startRef.current) };
          if (e.status === 'failed') {
            const skipped = String(e.detail).startsWith('skipped');
            return { ...s, status: skipped ? 'skipped' : 'failed', ms: Date.now() - (s.startedAt ?? startRef.current), note: e.detail };
          }
          return s;
        }),
      );
    };

    generate(query, { onEvent })
      .then(({ slug }) => {
        if (id === runId.current && window.location.pathname === '/generate') navigate(`/guide/${slug}`, { replace: true });
      })
      .catch((e) => {
        if (id === runId.current) setError(e.message);
      });
  }, [query]);

  // StrictMode re-runs effects in dev; the ref makes sure one query starts exactly one (quota-costing) generation.
  const startedFor = useRef(null);
  useEffect(() => {
    if (startedFor.current === query) return;
    startedFor.current = query;
    run();
  }, [query, run]);
  useEffect(() => {
    if (error) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [error]);

  const elapsed = now - startRef.current;

  return (
    <div className="wrap">
      <Link to="/" className="crumb">← All guides</Link>
      <h1 style={{ fontSize: 'clamp(1.5rem,4vw,2rem)' }}>Researching “{query}”</h1>
      <p className="sub">
        No guide exists yet, so an agent is building one live. On free-tier models this takes about 1-2 minutes. {!error && <span className="mono">Elapsed {fmt(elapsed)}</span>}
      </p>

      <div className="stages" aria-live="polite">
        {stages.map((s, i) => {
          const live = s.status === 'running' ? now - s.startedAt : s.ms;
          return (
            <div className="stage" key={STAGES[i]}>
              <span className={`ico ${s.status}`} aria-hidden="true">{ICON[s.status]}</span>
              <div className="grow">
                <div>{STAGES[i]}</div>
                {s.status === 'skipped' && <div className="small sub">Skipped, so claims that depend on it stay unverified.</div>}
                {s.status === 'failed' && <div className="small" style={{ color: 'var(--red)' }}>{s.note}</div>}
              </div>
              <span className="st">{LABEL[s.status]}{live != null && s.status !== 'pending' ? ` · ${fmt(live)}` : ''}</span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="error" role="alert">
          <strong>Generation failed.</strong> {error}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={run}>Retry</button>
            <Link to="/" className="btn">Back to guides</Link>
          </div>
        </div>
      )}
    </div>
  );
}
