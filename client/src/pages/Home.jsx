import { useEffect, useState } from 'react';
import { fetchGuides, findGuide } from '../lib/api.js';
import { Legend, TierBadge, VerifiedTag } from '../lib/guideUi.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { validateQuery } from '../lib/validateQuery.js';

export default function Home() {
  const [guides, setGuides] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState(null);

  useEffect(() => {
    fetchGuides().then(setGuides).catch((e) => setError(e.message));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const checked = validateQuery(query);
    if (!checked.ok) return setQueryError(checked.error);
    setQueryError(null);
    const q = checked.query;
    const match = guides && findGuide(guides, q);
    navigate(match ? `/guide/${match.slug}` : `/generate?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="wrap wide">
      <section style={{ padding: '56px 0 8px', maxWidth: 720 }}>
        <h1>Know how long your OAuth app setup will really take</h1>
        <p className="sub" style={{ fontSize: '1.05rem', marginTop: 12 }}>
          Setup time, approval waits, review gates and gotchas for the APIs you integrate with, each claim tagged with how well it is backed.
        </p>
        <form className="search" onSubmit={submit} role="search">
          <input aria-label="App name or website URL" aria-invalid={queryError ? 'true' : undefined} aria-describedby={queryError ? 'query-error' : undefined} placeholder="App name or URL, e.g. Zoom or zoom.us" value={query} onChange={(e) => { setQuery(e.target.value); setQueryError(null); }} autoFocus />
          <button className="btn primary" type="submit">Search</button>
        </form>
        {queryError && <div id="query-error" className="field-error" role="alert">{queryError}</div>}
      </section>

      <section className="section">
        <h2>Guides</h2>
        <p className="hint">Not listed? Search for it and an agent will research it live (about 1-2 minutes).</p>
        {error && <div className="error">{error}</div>}
        {!guides && !error && (
          <div className="grid">
            {[0, 1, 2].map((i) => <div className="skeleton" key={i} />)}
          </div>
        )}
        {guides && (
          <div className="grid">
            {guides.map((g) => (
              <Link key={g.slug} to={`/guide/${g.slug}`} className="card">
                <div className="row between">
                  <span className="name">{g.name}</span>
                </div>
                <div className="row">
                  <TierBadge tier={g.tier} />
                  <VerifiedTag generatedBy={g.generated_by} />
                </div>
                <p className="summ" style={{ margin: 0 }}>{g.summary}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>How to read the evidence</h2>
        <p className="hint">Every claim in a guide carries one of these labels.</p>
        <Legend />
      </section>
    </div>
  );
}
