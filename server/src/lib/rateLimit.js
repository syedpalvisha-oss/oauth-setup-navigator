/** Fixed-window in-memory limiter keyed by client IP. State is per process, which is enough for a single server. */
export function rateLimit({ max, windowMs }) {
  const hits = new Map(); // ip -> { count, resetAt }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.resetAt <= now) hits.delete(ip);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let h = hits.get(ip);
    if (!h || h.resetAt <= now) hits.set(ip, (h = { count: 0, resetAt: now + windowMs }));
    h.count++;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - h.count)));
    if (h.count > max) {
      const retryAfter = Math.ceil((h.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `Rate limit exceeded: ${max} requests per ${Math.round(windowMs / 60000)} minutes. Retry in ${retryAfter}s.` });
    }
    next();
  };
}
