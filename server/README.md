# Live Share Server (Cloudflare Worker)

This directory contains the Cloudflare Worker and Durable Object that power live sharing.

## Prerequisites
- Node 18+
- Cloudflare `wrangler` CLI installed: `npm i -g wrangler`
- A Cloudflare account with Durable Objects enabled

## Configure
Edit `wrangler.toml` as needed:
- `ALLOWED_ORIGINS`: comma-separated list of site origins allowed to call the APIs and open WebSockets (e.g., `http://localhost:5500`).
- `TURNSTILE_SECRET_KEY` (optional): set to enable Turnstile verification on session creation.
- `ROOM_TTL_SECONDS`, `MAX_VIEWERS`, `CREATE_LIMIT_PER_HOUR`: operational limits.

## Develop
```sh
cd server
wrangler dev
```

Serve the static client from the repo root with a simple server, e.g.:
```sh
# from repo root
npx http-server -p 5500 -c-1
```

If the Worker runs on a different origin (e.g., `http://127.0.0.1:8787`), set the base in `index.html` via:
```html
<meta name="live-share-base" content="http://127.0.0.1:8787">
```

## Deploy
```sh
cd server
wrangler publish
```
Bind the Durable Object namespace in Cloudflare if prompted. Then set the production site origin(s) in `ALLOWED_ORIGINS`.

## API Summary
- POST `/api/share/start` → `{ key, hostToken, viewerUrl, ttlSeconds }`
- POST `/api/share/stop` with `{ key, hostToken }` → `{ ok: true }`
- GET `/api/share/snapshot/:key` → `{ active, content, selection, version }`
- WS `/ws/:key?role=host&token=...` or `/ws/:key?role=viewer` 