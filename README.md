# Freddy

A tiny installable PWA for two parents. Four big tiles — **Need you · Diaper · Bottle · All good**.
Tap one and the *other* parent's phone gets a push notification. That's the whole app.

- **Who you are**: picked once on first open ("Justin" / "Erica"), stored in `localStorage`, no password.
- **A tap never echoes to the sender** — the backend only pushes to the other identity.
- **Keeps nudging until seen** — the request tiles (Need you / Diaper / Bottle) re-fire the
  notification every ~30s (configurable) until the other parent opens the app or taps/dismisses the
  notification. "All good" pings once.
- **Two delivery channels:**
  - **PWA / Web Push** — for whoever's on a phone without the native app (e.g. on iPhone).
    Works fine in the foreground, can be heard if the phone is *not* on silent. Can't bypass DND.
  - **Native Android app** — a sideloaded APK (no Play Store, no Firebase) that keeps a persistent
    SSE connection open to Freddy and raises a local notification on a `setBypassDnd(true)`
    channel with alarm-volume sound. That's the one that **rings through silent / Focus / DND** —
    Android's equivalent of iOS Critical Alerts, done client-side. Install it from
    [`mobile/`](mobile/README.md).
- Lives at `https://freddy.bustinjailey.org` (LAN + Tailscale only).

Stack: SvelteKit (Svelte 5) + `@sveltejs/adapter-node`, `web-push`. One Node process serves the
static client *and* the small API. Web push subscriptions persist to `data/subscriptions.json`;
the SSE stream is in-memory.

## Layout

```
src/
  routes/
    +page.svelte                  the whole UI (identity pick + 4 tiles + alert setup)
    +page.server.js                hands the page the two names + the public VAPID key
    api/subscribe/+server.js        POST { identity, subscription }  -> store a PWA web-push sub
    api/stream/+server.js           GET  ?identity=…                 -> SSE firehose for the native app
    api/notify/+server.js           POST { from, signal }            -> push to the other parent on every live channel (+ escalation)
    api/ack/+server.js              POST { identity }                -> "I've seen it" -> stop escalating to me
    api/health/+server.js           GET  -> { ok, identities, webPushConfigured, recipients, escalation }
  lib/
    signals.js                    the 4 tiles (id/label/emoji/escalate), shared client+server
    native.js                     in-WebView Capacitor glue — starts the FreddyStream plugin; no-op in a browser
    server/{config,store,push}.js
    server/stream.js              in-memory SSE subscriber registry (identity -> live clients)
    server/escalation.js          in-memory "re-buzz until ack'd" timers (one per recipient), channel-agnostic
  service-worker.js               precaches the shell + handles `push` / `notificationclick` / `notificationclose`
static/                           manifest, icons, apple-touch-icon, badge
scripts/make-icons.py             regenerates the PNG icons (PIL)
capacitor.config.ts               native shell config (Android-only, loads the remote URL)
mobile/                           native wrapper — fallback page + build notes (mobile/README.md)
android/app/src/main/java/.../FreddyStreamPlugin.java   Capacitor plugin (start/stop, perms)
android/app/src/main/java/.../FreddyStreamService.java  foreground service holding the SSE connection
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

## Build the Android app

```sh
npm run build               # generates the SvelteKit client (the fallback page is bundled)
npm run cap:sync            # syncs capacitor.config.ts + plugins into android/
npm run cap:apk             # gradle assembleDebug -> android/app/build/outputs/apk/debug/app-debug.apk
# or: npm run cap:android   # opens Android Studio
```

Sideload the APK with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` (or just
copy the APK to the phone and tap it). First launch:

1. Allow notifications when prompted.
2. The app will show a "let Freddy ring through DND" banner — tap it, find Freddy in the system
   list, and toggle it on. This is a one-time manual step (Android doesn't expose a permission
   request for this).
3. Tap the "Battery settings" button and mark Freddy **Unrestricted** so the foreground service
   isn't killed overnight on aggressive OEMs (Samsung, Xiaomi, Oneplus).

See [`mobile/README.md`](mobile/README.md) for the full why-and-how.

## Config (env)

| var | what |
|---|---|
| `PORT` | port the Node server binds (webapps convention: in `./env`) |
| `ORIGIN` | public URL, e.g. `https://freddy.bustinjailey.org` — needed for SvelteKit CSRF behind the proxy |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys (`npx web-push generate-vapid-keys`) |
| `VAPID_SUBJECT` | `mailto:` contact for the push services |
| `FREDDY_IDENTITIES` | the two names, comma-separated (default `Justin,Erica`) |
| `FREDDY_DATA_DIR` | where `subscriptions.json` lives (default `data`) |
| `FREDDY_REPEAT_INTERVAL_SEC` | seconds between escalation nudges (default `30`, clamped 5–600) |
| `FREDDY_REPEAT_MAX` | how many times to re-buzz before giving up (default `6` → ~3 min; `0` disables escalation) |
| `FREDDY_NATIVE_URL` *(build-time)* | URL the native Android shell loads (default `https://freddy.bustinjailey.org`) |

If the reverse proxy in front of Freddy buffers responses (nginx does by default), set it to *not*
buffer `/api/stream` — the server already sets `X-Accel-Buffering: no`. Caddy is fine out of the box.

To change the second parent's name, just edit `FREDDY_IDENTITIES` and restart — no rebuild.
