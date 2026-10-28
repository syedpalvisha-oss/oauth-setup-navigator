import { useState } from 'react';
import Generate from './pages/Generate.jsx';
import Guide from './pages/Guide.jsx';
import Home from './pages/Home.jsx';
import { Link, usePath } from './lib/router.jsx';

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'system');
  const next = { system: 'light', light: 'dark', dark: 'system' };
  const cycle = () => {
    const t = next[theme];
    setTheme(t);
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', t);
    } catch {
      /* storage unavailable: the choice just won't persist */
    }
  };
  return <button className="btn" onClick={cycle} title="Switch theme" aria-label={`Theme: ${theme}. Click to change.`}>Theme: {theme}</button>;
}

export default function App() {
  const path = usePath();
  const guideMatch = /^\/guide\/([^/]+)\/?$/.exec(path);
  let page;
  if (guideMatch) page = <Guide slug={decodeURIComponent(guideMatch[1])} />;
  else if (path === '/generate') {
    const q = new URLSearchParams(window.location.search).get('q')?.trim();
    page = q ? <Generate key={q} query={q} /> : <Home />;
  } else page = <Home />;

  return (
    <>
      <header className="top">
        <div className="wrap wide">
          <Link to="/" className="brand"><span className="brand-dot" />OAuth Setup Navigator</Link>
          <ThemeToggle />
        </div>
      </header>
      <main>{page}</main>
    </>
  );
}
