import { useEffect, useState } from 'react';
import { fetchGuide } from '../lib/api.js';
import { ConfidencePill, Legend, TierBadge, VerifiedTag } from '../lib/guideUi.jsx';
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

  return (
    <div className="wrap">
      <Link to="/" className="crumb">← All guides</Link>

      <div className="card verdict">
        <div>
          <div className="row between">
            <div className="row">
              <TierBadge tier={g.tier} />
              <VerifiedTag generatedBy={g.meta.generated_by} />
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
          <Metric label="Setup time" value={setup} confidence={g.time.setup_confidence} />
          <Metric label="Approval wait" value={wait} note={g.time.approval_wait.notes} confidence={g.time.approval_wait.confidence} long={Boolean(g.time.approval_wait.label)} />
        </div>
        {skipped.length > 0 && (
          <div className="warn" role="status">
            <strong>Partial run.</strong> {plural(skipped.length, 'research stage')} did not finish ({skipped.join(', ')}), so claims that depend on {skipped.length === 1 ? 'it' : 'them'} are unverified.
          </div>
        )}
      </div>

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
                <span className={`box${p.required ? ' req' : ''}`} aria-hidden="true" />
                <div className="grow">
                  <div className="item-title">{p.item} <span className="tag">{p.required ? 'required' : 'optional'}</span></div>
                  {p.notes && <div className="item-detail">{p.notes}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Steps">
        <ul className="list">
          {[...g.steps].sort((a, b) => a.order - b.order).map((s) => (
            <li key={s.order}>
              <span className="num">{s.order}</span>
              <div className="grow">
                <div className="row between">
                  <span className="item-title">{s.title}</span>
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
              <thead><tr><th>Scope</th><th>Purpose</th><th>Review</th></tr></thead>
              <tbody>
                {g.scopes.map((s) => (
                  <tr key={s.scope} className={s.triggers_review ? 'hl' : ''}>
                    <td><code>{s.scope}</code></td>
                    <td>{s.purpose}{s.notes && <div className="small sub">{s.notes}</div>}</td>
                    <td>{s.triggers_review ? <span className="pill c-amber">Triggers review</span> : <span className="sub">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {g.blockers.length > 0 && (
        <Section title="Blockers and how to resolve them">
          <ul className="list">
            {g.blockers.map((b) => (
              <li key={b.issue}>
                <div className="grow">
                  <div className="item-title">{b.issue}</div>
                  <div className="item-detail">{b.how_to_resolve}</div>
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

      <Section title="Evidence" hint="Every claim above rests on one of these levels.">
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
