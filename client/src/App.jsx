import { useEffect, useState } from 'react';

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow">
        <h1 className="text-2xl font-semibold">OAuth Setup Navigator</h1>
        <p className="mt-1 text-sm text-slate-500">Skeleton running end to end.</p>
        <pre className="mt-4 overflow-auto rounded bg-slate-100 p-3 text-xs">
          {error ? `API error: ${error}` : health ? JSON.stringify(health, null, 2) : 'Checking /api/health…'}
        </pre>
      </div>
    </main>
  );
}
