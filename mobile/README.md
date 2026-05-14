# Freddy — native Android wrapper

A thin [Capacitor](https://capacitorjs.com/) shell around the same web app, so we can do the one
thing a PWA fundamentally can't: **ring through silent mode / Focus / Do-Not-Disturb** when the
other parent taps a request tile.

**Android-only, sideloaded.** No Play Store, no Firebase, no FCM, no Apple anything. The phone
itself talks to Freddy over a persistent SSE connection and raises a *local* notification on a
DND-bypass channel — which is Android's only way to override silent mode from a non-Play-Store
app, and it works for a sideloaded build because the heavy lifting is the *channel*, not the
push payload.

## How it works

```
+----------------+ tap a tile +-----------------+ SSE 'signal'  +------------------+
| Sender's phone | ---------> | freddy server   | ------------> | Justin's Android |
| (PWA, browser) |   /notify  |  /api/stream    |               |  FreddyStream    |
+----------------+            |  /api/notify    |               |  foreground svc  |
                              +-----------------+               +------------------+
                                                                         |
                                                                         v
                                                       local notification on
                                                       "freddy-alerts" channel:
                                                         IMPORTANCE_HIGH
                                                         setBypassDnd(true)
                                                         USAGE_ALARM sound
                                                       -> rings through silent/DND
```

The foreground service is what holds the SSE connection. Android won't kill it while it's
foreground; an "Freddy is listening" notification on a low-importance channel keeps it pinned.
The service auto-reconnects on network drops (exponential backoff) and re-starts after reboot.

There's no FCM, no `google-services.json`, no Apple Push, no APNs key, no Critical Alerts
entitlement request. The whole thing is self-contained on `freddy.bustinjailey.org` plus the
Android code in `android/app/src/main/java/org/bustinjailey/freddy/`.

## What's done vs. what needs you

**Done in this repo:**
- Capacitor v7 wired up, Android project scaffolded
- `AndroidManifest.xml`: `INTERNET`, `POST_NOTIFICATIONS`, `ACCESS_NOTIFICATION_POLICY`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`,
  service declaration with `foregroundServiceType="dataSync"`
- `FreddyStreamService` — the foreground service: OkHttp SSE client, reconnect-with-backoff,
  high-importance + DND-bypass + alarm-volume alerts channel, low-importance status channel
- `FreddyStreamPlugin` — Capacitor plugin exposing `start({identity, baseUrl})`, `stop()`,
  `status()`, `requestNotificationPermission()`, `openDndSettings()`, `openBatterySettings()`
- `src/lib/native.js` — calls into the plugin from the WebView once the user has picked their
  identity; surfaces "needs DND access" state to the UI
- Server-side: `GET /api/stream?identity=…` SSE endpoint, in-memory subscriber registry, notify
  fans out to SSE first (preferred), then web push for whoever's still on the PWA

**Needs you (one-time setup on your Android phone):**

1. **Build the APK** — needs Android Studio's SDK + Java 17. From a Mac/Linux with the SDK:
   ```sh
   npm install && npm run build && npm run cap:sync && npm run cap:apk
   ```
   APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`. (Debug builds are fine for
   sideloading — release signing only matters for the Play Store.)

2. **Install on your phone:**
   ```sh
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
   Or copy the APK to the phone and tap it (you'll have to allow "install unknown apps" once).

3. **Grant permissions on first launch:**
   - Allow the notification permission when prompted.
   - The app will show a yellow "let Freddy ring through Do-Not-Disturb" banner. Tap **DND access**,
     find Freddy in the list, toggle it on. There's no programmatic grant for this — Android
     forces it to be a manual settings-screen toggle.
   - Tap **Battery settings**, find Freddy, mark it **Unrestricted**. Without this, aggressive
     OEMs (Samsung One UI, Xiaomi MIUI, Oneplus OxygenOS) will kill the foreground service after
     a while of idle and you'll stop getting alerts. Stock Android / Pixel is more forgiving but
     still benefits.

After that the app's job is just to stay launched once — it'll be alive across reboots via the
sticky foreground service, and the connection auto-reconnects.

## Testing it

With the server reachable, the phone connected to the app, and `Erica` triggering from the PWA:

- Phone on silent → "Need you" rings (alarm-volume, vibrates), even with Do-Not-Disturb on.
- Phone in Focus mode → same.
- App in background or screen off → service stays alive, notification fires.
- Tap the notification → opens Freddy → triggers `/api/ack` → server stops escalating.

The server's `/api/health` shows whether a stream is currently connected:
`recipients: { "Justin": { web: false, stream: 1 }, "Erica": { web: true, stream: 0 } }`.

## Limitations / things to know

- **Phone must have a path to `freddy.bustinjailey.org`.** That means home WiFi or Tailscale up.
  If the connection drops, the service reconnects when it comes back. Signals fired while the
  phone was offline are lost — but the escalation timer keeps re-firing every ~30s for a few
  minutes, so as long as it reconnects within that window you'll get the alert.
- **`setBypassDnd(true)` requires user-granted policy access** (the manual settings toggle). Until
  that's granted the channel is still high-importance but DND will still suppress it.
- **No code-signing for the APK.** It's a debug build sideloaded to one phone. If we ever want it
  on more than two devices or in the Play Store, generate a release key and sign.

## Why not FCM / why not Critical Alerts?

- *FCM* would work and would let Android sleep the app between pushes (better battery), but it
  requires a Firebase project, a `google-services.json`, and a server-side service account —
  all extra moving parts for a two-person family app. The SSE-from-our-own-server approach has
  one fewer vendor in the loop and works fine on a phone that's always on the home network.
- *Critical Alerts* is iOS-only. Justin's on Android; his wife uses the PWA. If she ever wants
  the iOS native experience later, that's a separate piece of work (Apple Developer Program +
  entitlement request + Mac/Xcode).
