import { useEffect, useState } from 'react';
import { fetchGuides, findGuide } from '../lib/api.js';
import { Legend, TierBadge, VerifiedTag } from '../lib/guideUi.jsx';
import { Link, navigate } from '../lib/router.jsx';

export default function Home() {
  const [guides, setGuides] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchGuides().then(setGuides).catch((e) => setError(e.message));
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
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
          <input aria-label="App name or website URL" placeholder="App name or URL, e.g. Zoom or zoom.us" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button className="btn primary" type="submit">Search</button>
        </form>
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
