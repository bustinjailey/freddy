# Freddy

A tiny installable PWA for two parents. Four big tiles — **Need you · Diaper · Bottle · All good**.
Tap one and the *other* parent's phone gets a push notification. That's the whole app.

- **Who you are**: picked once on first open ("Justin" / "Mom"), stored in `localStorage`, no password.
- **Notifications**: Web Push. On iOS this requires adding the app to the Home Screen first (iOS 16.4+) —
  the app tells you to do that if you haven't.
- **A tap never echoes to the sender** — the backend only pushes to the other identity.
- **Keeps nudging until seen** — the request tiles (Need you / Diaper / Bottle) re-fire the
  notification every ~30s (configurable) until the other parent opens the app or taps/dismisses the
  notification. "All good" pings once.
- **Rings through silent / DND** — *in the native app only*. A PWA can't override the ringer switch
  or a Focus mode; that needs OS-level APIs (iOS Critical Alerts, Android DND-bypass channels) with
  no Web Push equivalent. So there's a thin Capacitor wrapper (`mobile/`) — the same web app in a
  WebView + native push (APNs/FCM) — that gets a *critical* alert for the request tiles. Install it
  on the phones and "Need you" is audible even on silent. The escalation re-buzz above is the
  best-effort fallback for whoever's still on the plain PWA. See [`mobile/README.md`](mobile/README.md).
- Lives at `https://freddy.bustinjailey.org` (LAN + Tailscale only).

Stack: SvelteKit (Svelte 5) + `@sveltejs/adapter-node`, `web-push` (PWA push), `@parse/node-apn`
(native iOS critical alerts). One Node process serves the static client *and* the small API. Web
push subscriptions persist to `data/subscriptions.json`, native device tokens to
`data/native-tokens.json`.

## Layout

```
src/
  routes/
    +page.svelte                 the whole UI (identity pick + 4 tiles + push/native setup)
    +page.server.js               hands the page the two names + the public VAPID key
    api/subscribe/+server.js       POST { identity, subscription }       -> store a PWA web-push sub
    api/register-native/+server.js POST { identity, platform, token }    -> store a native APNs/FCM token
    api/notify/+server.js          POST { from, signal }                 -> push to the other parent, every channel (+ escalation)
    api/ack/+server.js             POST { identity }                     -> "I've seen it" -> stop escalating to me
    api/health/+server.js          GET  -> { ok, identities, webPushConfigured, apnsConfigured, recipients, escalation }
  lib/
    signals.js                   the 4 tiles (id/label/emoji/escalate), shared client+server
    native.js                    in-WebView Capacitor glue (channel + permission + token register); no-op in a browser
    server/{config,store}.js
    server/push.js               sendWebPush (VAPID) + sendApns (@parse/node-apn, critical) + sendFcm (stub)
    server/escalation.js         in-memory "re-buzz until ack'd" timers (one per recipient), channel-agnostic
  service-worker.js              precaches the shell + handles `push` / `notificationclick` / `notificationclose`
static/                          manifest, icons, apple-touch-icon, badge
scripts/make-icons.py            regenerates the PNG icons (PIL)
capacitor.config.ts              native shell config (appId, loads the remote URL, offline fallback)
mobile/                          the native wrapper — fallback page + build/provisioning notes (mobile/README.md)
ios/  android/                   generated Capacitor projects (entitlements / manifest edits live here)
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
| `APNS_KEY` *or* `APNS_KEY_PATH` | the APNs `.p8` auth key — contents inline, or a path to the file |
| `APNS_KEY_ID` / `APNS_TEAM_ID` | from the APNs key + your Apple developer account |
| `APNS_BUNDLE_ID` | iOS bundle id (default `org.bustinjailey.freddy`) |
| `APNS_PRODUCTION` | `false` to use the APNs sandbox (default: production) |

APNs is **optional** — leave the `APNS_*` vars unset and the server just skips the native iOS
channel (PWA web push still works; `health` shows `apnsConfigured:false`). Android FCM isn't wired
yet (the Android build falls back to web push). Native build & provisioning details:
[`mobile/README.md`](mobile/README.md). `FREDDY_NATIVE_URL` (build-time) overrides the URL the
native shell loads; defaults to `https://freddy.bustinjailey.org`.

To change the second parent's name, just edit `FREDDY_IDENTITIES` and restart — no rebuild.
