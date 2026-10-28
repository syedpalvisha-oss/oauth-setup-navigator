# OAuth Setup Navigator

Helps developers set up OAuth apps with providers (Google, Slack, …) and get them approved.

## Quick start
```
cp .env.example .env
npm run install:all
npm run dev
```
- Client: http://localhost:5173 (proxies `/api` to the server)
- Server: http://localhost:3001/api/health

Without Upstash env vars the server caches in memory (health reports `cache: "memory"`).
