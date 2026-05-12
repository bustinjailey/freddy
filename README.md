# Freddy

A tiny installable PWA for two parents. Four big tiles — **Need you · Diaper · Bottle · All good**.
Tap one and the *other* parent's phone gets a push notification. That's the whole app.

- **Who you are**: picked once on first open ("Justin" / "Mom"), stored in `localStorage`, no password.
- **Notifications**: Web Push. On iOS this requires adding the app to the Home Screen first (iOS 16.4+) —
  the app tells you to do that if you haven't.
- **A tap never echoes to the sender** — the backend only pushes to the other identity.
- **Keeps nudging until seen** — the request tiles (Need you / Diaper / Bottle) re-fire the
  notification every ~30s (configurable) until the other parent opens the app or taps/dismisses the
  notification. A PWA can't override silent mode or Do-Not-Disturb (those are native-app APIs —
  iOS Critical Alerts, Android DND-bypass channels — and there's no Web Push equivalent), so this is
  the best-effort substitute: a notification that won't quietly disappear. "All good" pings once.
- Lives at `https://freddy.bustinjailey.org` (LAN + Tailscale only).

Stack: SvelteKit (Svelte 5) + `@sveltejs/adapter-node`, `web-push`. One Node process serves the
static client *and* the small API. Push subscriptions persist to `data/subscriptions.json`.

## Layout

```
src/
  routes/
    +page.svelte            the whole UI (identity pick + 4 tiles + push setup)
    +page.server.js          hands the page the two names + the public VAPID key
    api/subscribe/+server.js  POST { identity, subscription }  -> store it
    api/notify/+server.js     POST { from, signal }            -> push to the other parent (+ start escalation)
    api/ack/+server.js        POST { identity }                -> "I've seen it" -> stop escalating to me
    api/health/+server.js     GET  -> { ok, identities, pushConfigured, subscriptions, escalation }
  lib/
    signals.js               the 4 tiles (id/label/emoji/escalate), shared client+server
    server/{config,store,push}.js
    server/escalation.js     in-memory "re-buzz until ack'd" timers (one per recipient)
  service-worker.js          precaches the shell + handles `push` / `notificationclick` / `notificationclose`
static/                      manifest, icons, apple-touch-icon, badge
scripts/make-icons.py        regenerates the PNG icons (PIL)
```

## Develop

```sh
npm install
cp .env.example .env        # then add VAPID keys (npx web-push generate-vapid-keys)
npm run dev
```

## Build & run

```sh
npm install
npm run build               # -> build/
node build/index.js         # reads PORT, ORIGIN, VAPID_*, FREDDY_* from the env
```

## Deploy (webapps LXC)

See [`deploy/README.md`](deploy/README.md). Short version: `webapp-add freddy <port>`,
clone here, `npm ci && npm run build`, fill in `/opt/apps/freddy/env`, point `run.sh` at
`node build/index.js`, `systemctl restart webapp@freddy`.

## Config (env)

| var | what |
|---|---|
| `PORT` | port the Node server binds (webapps convention: in `./env`) |
| `ORIGIN` | public URL, e.g. `https://freddy.bustinjailey.org` — needed for SvelteKit CSRF behind the proxy |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys (`npx web-push generate-vapid-keys`) |
| `VAPID_SUBJECT` | `mailto:` contact for the push services |
| `FREDDY_IDENTITIES` | the two names, comma-separated (default `Justin,Mom`) |
| `FREDDY_DATA_DIR` | where `subscriptions.json` lives (default `data`) |
| `FREDDY_REPEAT_INTERVAL_SEC` | seconds between escalation nudges (default `30`, clamped 5–600) |
| `FREDDY_REPEAT_MAX` | how many times to re-buzz before giving up (default `6` → ~3 min; `0` disables escalation) |

To change the second parent's name, just edit `FREDDY_IDENTITIES` and restart — no rebuild.
