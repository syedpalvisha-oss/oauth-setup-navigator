import { useEffect, useState } from 'react';
import { fetchGuide } from '../lib/api.js';
import { ConfidencePill, Legend, TierBadge, VerifiedTag } from '../lib/guideUi.jsx';
import { attemptFindings, verdictNote } from '../lib/attemptFindings.js';
import { Link } from '../lib/router.jsx';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function setupTime(minutes) {
  if (minutes == null) return null;
  if (minutes >= 120) return `~${Math.round(minutes / 60)} hours`;
  return `~${plural(minutes, 'minute')}`;
}

/** Headline for the approval wait. A label (placeholder/unpublished wait) wins over any numeric range. */
function approvalWait(w) {
  if (w.label) return w.label;
  const { min_days: lo, max_days: hi } = w;
  if (lo == null && hi == null) return null;
  if (lo === 0 && hi === 0) return 'None';
  if (lo === hi) return plural(lo, 'day');
  if (lo == null) return `up to ${plural(hi, 'day')}`;
  if (hi == null) return `${plural(lo, 'day')}+`;
  return `${lo}-${plural(hi, 'day')}`;
}

function Metric({ label, value, note, confidence = 'unverified', long = false }) {
  return (
    <div className="metric">
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <div className="label">{label}</div>
        <ConfidencePill level={confidence} />
      </div>
      <div className={`value${value ? '' : ' unknown'}${long ? ' long' : ''}`}>{value ?? 'Unknown'}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      window.prompt('Copy this link', window.location.href);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return <button className="btn" onClick={copy}>{copied ? '✓ Link copied' : 'Copy share link'}</button>;
}

const storageKey = (slug) => `oauth-nav:checks:${slug}`;

/** Checked prerequisites/steps, persisted per guide. Storage can be unavailable (private mode, quota), so every access is guarded. */
function useChecks(slug) {
  const [checks, setChecks] = useState({ p: {}, s: {} });
  useEffect(() => {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey(slug)) || 'null');
    } catch {
      /* unreadable or unavailable: start empty */
    }
    setChecks({ p: saved?.p ?? {}, s: saved?.s ?? {} });
  }, [slug]);
  const toggle = (kind, key) =>
    setChecks((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], [key]: !prev[kind][key] } };
      try {
        localStorage.setItem(storageKey(slug), JSON.stringify(next));
      } catch {
        /* the tick still works for this visit, it just will not persist */
      }
      return next;
    });
  return [checks, toggle];
}

function CheckBox({ checked, onChange, label, required }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`box${required ? ' req' : ''}${checked ? ' checked' : ''}`} onClick={onChange}>
      {checked ? '✓' : ''}
    </button>
  );
}

function nextStep(g, steps, checks) {
  const pre = g.prerequisites.find((p) => p.required && !checks.p[p.item]);
  if (pre) return { text: `Confirm prerequisite: ${pre.item}`, url: null };
  const step = steps.find((x) => !checks.s[x.order]);
  if (step) return { text: `Step ${step.order}: ${step.title}`, url: step.url };
  return null;
}

function StartHere({ g, steps, blockers, checks }) {
  const first = steps[0];
  const blocker = blockers[0];
  const next = nextStep(g, steps, checks);
  return (
    <section className="card start" aria-label="Start here">
      <h2>Start here</h2>
      <div className="start-grid">
        <div>
          <div className="label">First action</div>
          {first ? (
            <>
              <div className="item-title">{first.title}</div>
              {first.url && <div className="claim-link"><a href={first.url} target="_blank" rel="noreferrer">{first.url}</a></div>}
            </>
          ) : <div className="sub">No steps listed.</div>}
        </div>
        <div>
          <div className="label">Main blocker to watch for</div>
          {blocker ? (
            <>
              <div className="item-title">{blocker.issue} <ConfidencePill level={blocker.confidence} /></div>
              <div className="item-detail">{blocker.how_to_resolve}</div>
            </>
          ) : <div className="sub">None found.</div>}
        </div>
      </div>
      <div className="next" role="status">
        <strong>Next step:</strong>{' '}
        {next ? <>{next.text}{next.url && <> · <a href={next.url} target="_blank" rel="noreferrer">open</a></>}</> : <>Everything is checked off. You are set up.</>}
      </div>
    </section>
  );
}

function ComposioCard({ c }) {
  const verdict = c.available === true ? { text: 'Not yet. Start with Composio-managed auth.', cls: 'c-green' } : c.available === false ? { text: 'Yes. You need your own OAuth app from day one.', cls: 'c-orange' } : { text: 'Unclear whether you can skip your own app.', cls: 'c-gray' };
  return (
    <div className="card">
      <div className="row between">
        <strong>{verdict.text}</strong>
        <ConfidencePill level={c.confidence} />
      </div>
      <p className="sub" style={{ margin: '8px 0 0' }}>{c.notes}</p>
      {c.source_url && <p className="claim-link" style={{ margin: '6px 0 0' }}><a href={c.source_url} target="_blank" rel="noreferrer">{c.source_url}</a></p>}
      {c.confidence === 'sourced' && c.supporting_quote && <blockquote className="quote">“{c.supporting_quote}”</blockquote>}
    </div>
  );
}

export default function Guide({ slug }) {
  const [guide, setGuide] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState(null);
  const [checks, toggle] = useChecks(slug);

  useEffect(() => {
    setGuide(undefined);
    setError(null);
    fetchGuide(slug).then(setGuide).catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <div className="wrap"><div className="error" style={{ marginTop: 24 }}>{error}</div></div>;
  if (guide === undefined) return <div className="wrap" style={{ paddingTop: 24 }}><div className="skeleton" /></div>;
  if (guide === null)
    return (
      <div className="wrap">
        <Link to="/" className="crumb">← All guides</Link>
        <h1 style={{ fontSize: '1.6rem' }}>No guide for “{slug}”</h1>
        <p className="sub">Search for it on the home page and an agent will research it.</p>
      </div>
    );

  const g = guide;
  const setup = setupTime(g.time.setup_minutes_estimate);
  const wait = approvalWait(g.time.approval_wait);
  const skipped = g.meta.skipped_stages ?? [];
  const steps = [...g.steps].sort((x, y) => x.order - y.order);
  const findings = attemptFindings(g.agent_attempts);
  // Blockers the endpoint tests found come first; stored copies (added at generation time) are not shown twice.
  const stored = new Set(g.blockers.map((b) => b.issue));
  const blockers = [
    ...g.blockers.filter((b) => b.confidence === 'agent_checked'),
    ...findings.filter((f) => !stored.has(f.issue)).map((f) => ({ issue: f.issue, how_to_resolve: f.how_to_resolve, confidence: 'agent_checked' })),
    ...g.blockers.filter((b) => b.confidence !== 'agent_checked'),
  ];
  const note = g.verdict_note ?? verdictNote(findings);

  return (
    <div className="wrap">
      <Link to="/" className="crumb">← All guides</Link>

      <div className="card verdict">
        <div>
          <div className="row between">
            <div className="row">
              <TierBadge tier={g.tier} />
              <VerifiedTag generatedBy={g.meta.generated_by} method={g.meta.verification_method} />
            </div>
            <ShareButton />
          </div>
          <h1 style={{ marginTop: 12 }}>{g.app.name}</h1>
          <p style={{ margin: '8px 0 0' }}>{g.summary}</p>
          <p className="small sub" style={{ margin: '6px 0 0' }}>
            <a href={g.app.website} target="_blank" rel="noreferrer">{g.app.website}</a> · {g.app.category} · last checked {new Date(g.meta.last_checked).toLocaleDateString()}
          </p>
        </div>
        <div className="metrics">
          <Metric label="Setup time" value={setup} note={g.time.setup_notes} confidence={g.time.setup_confidence} />
          <Metric label="Approval wait" value={wait} note={g.time.approval_wait.notes} confidence={g.time.approval_wait.confidence} long={Boolean(g.time.approval_wait.label)} />
        </div>
        {note && (
          <div className="warn" role="status">
            {note} <ConfidencePill level="agent_checked" />
          </div>
        )}
        {skipped.length > 0 && (
          <div className="warn" role="status">
            <strong>Partial run.</strong> {plural(skipped.length, 'research stage')} did not finish ({skipped.join(', ')}), so claims that depend on {skipped.length === 1 ? 'it' : 'them'} are unverified.
          </div>
        )}
      </div>

      <StartHere g={g} steps={steps} blockers={blockers} checks={checks} />

      {g.composio_managed_auth && (
        <Section title="Do you need your own OAuth app yet?">
          <ComposioCard c={g.composio_managed_auth} />
        </Section>
      )}

      {g.product_tiers?.length > 0 && (
        <Section title="Product tiers" hint="Different products from the same provider can have different access levels.">
          <div className="tablewrap">
            <table>
              <thead><tr><th>Product</th><th>Tier</th><th>Notes</th></tr></thead>
              <tbody>
                {g.product_tiers.map((p) => (
                  <tr key={p.product}><td>{p.product}</td><td><TierBadge tier={p.tier} /></td><td>{p.notes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {g.prerequisites.length > 0 && (
        <Section title="Prerequisites">
          <ul className="list">
            {g.prerequisites.map((p) => (
              <li key={p.item}>
                <CheckBox checked={Boolean(checks.p[p.item])} onChange={() => toggle('p', p.item)} label={`Done: ${p.item}`} required={p.required} />
                <div className="grow">
                  <div className="item-title">{p.item} <span className="tag">{p.required ? 'required' : 'optional'}</span> <ConfidencePill level={p.confidence} /></div>
                  {p.notes && <div className="item-detail">{p.notes}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Steps">
        <ul className="list">
          {steps.map((s) => (
            <li key={s.order}>
              <CheckBox checked={Boolean(checks.s[s.order])} onChange={() => toggle('s', s.order)} label={`Done: step ${s.order}, ${s.title}`} />
              <div className="grow">
                <div className="row between">
                  <span className="item-title">{s.title} <ConfidencePill level={s.confidence} /></span>
                  <span className={`pill ${s.owner === 'agent' ? 'c-blue' : 'c-gray'}`}>{s.owner === 'agent' ? 'Agent can do' : 'You do this'}</span>
                </div>
                <div className="item-detail">{s.detail}</div>
                {s.url && <div className="claim-link"><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></div>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {g.scopes.length > 0 && (
        <Section title="Scopes" hint="Highlighted rows trigger a review.">
          <div className="tablewrap">
            <table>
              <thead><tr><th>Scope</th><th>Purpose</th><th>Review</th><th>Confidence</th></tr></thead>
              <tbody>
                {g.scopes.map((s) => (
                  <tr key={s.scope} className={s.triggers_review ? 'hl' : ''}>
                    <td><code>{s.scope}</code></td>
                    <td>{s.purpose}{s.notes && <div className="small sub">{s.notes}</div>}</td>
                    <td>{s.triggers_review ? <span className="pill c-amber">Triggers review</span> : <span className="sub">No</span>}</td>
                    <td><ConfidencePill level={s.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {blockers.length > 0 && (
        <Section title="Blockers and how to resolve them">
          <ul className="list">
            {blockers.map((b) => (
              <li key={b.issue}>
                <div className="grow">
                  <div className="item-title">{b.issue} <ConfidencePill level={b.confidence} /></div>
                  <div className="item-detail">{b.how_to_resolve}</div>
                  {b.verified_with && <div className="small sub">Verified: {b.verified_with}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.notes?.length > 0 && (
        <Section title="Good to know">
          <ul className="list">
            {g.notes.map((n) => (
              <li key={n.title}>
                <div className="grow">
                  <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <span className="item-title">{n.title}</span>
                    <ConfidencePill level={n.confidence} />
                  </div>
                  <div className="item-detail">{n.text}</div>
                  {n.verified_with && <div className="small sub">Verified: {n.verified_with}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {g.agent_attempts?.length > 0 && (
        <Section title="What the agent tried" hint="Live checks against the provider's endpoints.">
          <div className="tablewrap">
            <table>
              <thead><tr><th>Action</th><th>Result</th><th>Evidence</th></tr></thead>
              <tbody>
                {g.agent_attempts.map((a, i) => (
                  <tr key={i}><td>{a.action}</td><td>{a.result}</td><td className="small sub">{a.evidence}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Evidence" hint="Every step, scope, prerequisite, blocker and claim carries one of these levels.">
        <Legend />
        <ul className="list" style={{ marginTop: 12 }}>
          {g.claims_evidence.map((c, i) => (
            <li key={i}>
              <div className="grow">
                <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <span>{c.claim}</span>
                  <ConfidencePill level={c.confidence} />
                </div>
                {c.source_url && <div className="claim-link"><a href={c.source_url} target="_blank" rel="noreferrer">{c.source_url}</a></div>}
                {c.confidence === 'sourced' && c.supporting_quote && <blockquote className="quote">“{c.supporting_quote}”</blockquote>}
                {c.verified_with && <div className="small sub">Verified: {c.verified_with}</div>}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <footer className="foot">
        Generated {new Date(g.meta.generated_at).toLocaleDateString()}{g.meta.models_used?.length ? ` · ${g.meta.models_used.join(', ')}` : ''}. Verify anything important against the provider's own docs.
      </footer>
    </div>
  );
}
