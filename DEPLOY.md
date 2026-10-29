# Deploying to Render

One Render **web service** runs everything: Express serves the API (`/api/*`) and the built React app from `client/dist`.

## Before you start

- Push this repo to GitHub (or GitLab/Bitbucket).
- Have a Tavily API key and a Groq API key. A Gemini key is optional (see below).
- A secrets scan of the repo and its full git history found no keys. `.env` is git-ignored and was never committed.

## Deploy steps

### Option A: Blueprint (fastest)

1. In the Render dashboard choose **New → Blueprint** and select the repo. Render reads `render.yaml`.
2. When prompted, paste values for `TAVILY_API_KEY` and `GROQ_API_KEY`.
3. Click **Apply**. The first build takes a few minutes (it installs client and server dependencies, builds the React app and tries to download Chromium).
4. Open the service URL, then check `https://<your-service>.onrender.com/api/health`. It should report `"tavily":"configured"` and `"groq":"configured"`.

### Option B: Manual web service

1. **New → Web Service**, select the repo.
2. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
   - **Plan:** Free is fine for a demo (see the limits below).
3. Add the environment variables below, then **Create Web Service**.

## Environment variables (Render dashboard → Environment)

| Variable | Required | Notes |
|---|---|---|
| `TAVILY_API_KEY` | Yes, for generating new guides | Search. Without it the library still works and generation returns a 503. |
| `GROQ_API_KEY` | Yes, for generating new guides | Primary and only required LLM provider. |
| `GEMINI_API_KEY` | No | Fallback for the final "Writing guide" stage only, capped at 20 seconds. Leave it unset to never call Gemini; nothing logs a warning. |
| `NODE_VERSION` | Recommended: `22` | Needs Node 20.19 or newer. `render.yaml` sets it. |
| `NODE_ENV` | Recommended: `production` | `render.yaml` sets it. This is what makes the server trust Render's proxy (see "Rate limit"). |
| `PORT` | No | Render sets it. Do not set it yourself. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | No | Optional persistent cache. If Redis is unreachable the app logs one warning and uses memory. |
| `TRUST_PROXY` | No | Reverse-proxy hops for the rate limit. Defaults to `1` in production. |
| `PLAYWRIGHT_DISABLED` | No | Set to `1` to skip the Chromium download and use plain fetches only. |

## What the build does

`npm run build` (see the root `package.json`):

1. `npm install --prefix client --include=dev`: dev dependencies are needed to build the client even when `NODE_ENV=production`.
2. `npm install --prefix server`
3. Builds the React app into `client/dist`.
4. `node server/scripts/install-browsers.js`: downloads Chromium into `server/node_modules` (`PLAYWRIGHT_BROWSERS_PATH=0`, so it is still there at runtime). **This step never fails the deploy.**

## Playwright / Chromium on Render

Chromium is only used for pages whose content is rendered by JavaScript during the "Testing endpoints" stage.

- The build downloads Chromium, but Render's standard Node runtime may not have the system libraries Chromium needs, and the build cannot install them. I could not test this on Render itself.
- If Chromium can't start, the app notices on the first attempt, stops trying, and runs the endpoint tests with plain fetches. The guide's "What the agent tried" table then includes a row, "Playwright rendering: skipped: headless Chromium could not start here", with the reason. I tested this fallback locally by pointing the browser path at a missing directory.
- Effect of the fallback: pages that need JavaScript to show a login wall or a "contact sales" message may be judged as loading normally.
- To skip the roughly 150 MB download and slow-build risk, set `PLAYWRIGHT_DISABLED=1`.

## What ships with the app

- The committed guides in `server/data/guides` and `server/data/generated` are in the repo, so the library works on first load with no keys at all.
- `server/data/.cache` (search and model cache) is git-ignored and starts empty.

## Limits to know about

- **Generated guides are not durable on Render's free plan.** New guides are written to `server/data/generated` on the instance's disk, which is erased on every redeploy and when a free instance restarts after sleeping. To keep one, copy the JSON from `server/data/generated/<slug>.json` (or `GET /api/guides/<slug>` while it's still there) into the repo and commit it. Alternatives: a Render persistent disk mounted at `server/data` (paid plans), or Upstash Redis, which keeps a generated guide findable by `POST /api/generate` but does not add it to the `GET /api/guides` list.
- **Free instances sleep after about 15 minutes idle.** The first request afterwards takes about a minute to wake the service.
- **Rate limit:** `/api/generate` allows 5 requests per IP per 10 minutes. The counter lives in memory, so it resets on restart. In production the server trusts one proxy hop so the limit applies per visitor rather than to Render's proxy as a whole.
- **Free-tier model limits:** Groq's free tier is about 8k tokens per minute per model. A single generation takes roughly 10 to 70 seconds depending on how recently the previous one ran, and two generations close together will queue.
- **Generation progress** streams over Server-Sent Events from `POST /api/generate`; Render's proxy supports this.

## After deploying: quick checks

1. `/api/health` shows the keys as `configured`.
2. The home page lists the 7 guides, and `/guide/github` loads directly (it must not 404).
3. Search for an app that is not in the library and watch the 7 stages complete. Do this once; it uses real Tavily and Groq quota.

## Local production check

```
npm run build        # add PLAYWRIGHT_DISABLED=1 to skip the Chromium download
NODE_ENV=production npm start
```

Then open http://localhost:3001 (or the `PORT` in your `.env`).
