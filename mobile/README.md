# Freddy — native wrapper

A thin [Capacitor](https://capacitorjs.com/) shell around the same web app, so we can do the one
thing a PWA fundamentally can't: **ring through silent mode / Focus / Do-Not-Disturb** when the
other parent taps a request tile.

The shell is *just* a WebView pointed at `https://freddy.bustinjailey.org` (`server.url` in
`capacitor.config.ts`) plus a native push bridge. There is no second copy of the UI — fix a bug in
`src/`, deploy, and the app updates. The only native-specific code is:

- `capacitor.config.ts` — appId `org.bustinjailey.freddy`, loads the remote URL, falls back to
  `mobile/fallback/index.html` if the server is unreachable at launch.
- `src/lib/native.js` — runs *inside* the WebView; when `window.Capacitor.isNativePlatform()` it
  creates the Android alert channel, asks for the notification permission, registers for APNs/FCM,
  and POSTs the device token to `/api/register-native`. No-op in a plain browser / the PWA.
- `src/lib/server/push.js` — server-side APNs (via `@parse/node-apn`) and an FCM stub; for request
  tiles the iOS payload uses `sound:{critical:1}` + `interruption-level:critical`.
- `ios/`, `android/` — the generated native projects (committed so the entitlements / manifest /
  Info.plist edits below don't get lost).

## What's done vs. what needs you (Justin)

**Done in this repo:** Capacitor v7 wired up, both native projects scaffolded, iOS entitlements +
`UIBackgroundModes`, Android `POST_NOTIFICATIONS` / `ACCESS_NOTIFICATION_POLICY` permissions and the
high-importance notification channel, server-side APNs dispatch (gated on env vars — does nothing
until they're set), `/api/register-native`, and the in-WebView registration glue.

**Blocked on you — none of this can happen on the Linux build runner / without your Apple+Google
accounts:**

1. **Apple Developer Program** enrollment ($99/yr) on the `org.bustinjailey.freddy` bundle ID.
2. **Critical Alerts entitlement** — Apple gates this behind a manual request:
   <https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/>.
   Draft justification (paste into the form):
   > Freddy is a private two-person app my partner and I use to call each other when one of us
   > needs help with our newborn — "need you", "diaper", "bottle". These are time-critical, in-home
   > requests; if the phone is on silent or in a Focus mode the alert is useless. We need Critical
   > Alerts so the "need you" class of notification can be heard. The app is not distributed publicly
   > (LAN + Tailscale only, two known users) and Critical Alerts are used *only* for those explicit
   > help requests, never for marketing or routine notifications.
   While it's pending, comment out the `com.apple.developer.usernotifications.critical-alerts` key in
   `ios/App/App/App.entitlements` so TestFlight/debug builds still sign — they'll just deliver a
   normal (time-sensitive) alert until the entitlement lands.
3. **APNs auth key** — App Store Connect → Users & Access → Integrations → Keys → "+", enable Apple
   Push Notifications service (APNs), download the `.p8` once. Gives you `APNS_KEY` (the file
   contents, or path), `APNS_KEY_ID`, `APNS_TEAM_ID`. Put them in `/opt/apps/freddy/env` — see the
   table in the top-level README / `.env.example`.
4. **A Mac with Xcode** to actually build & ship the iOS app (`npm run cap:ios` opens it). The Linux
   runner scaffolded `ios/` but can't run `pod install` / `xcodebuild`. On the Mac, also: in Xcode →
   target *App* → Signing & Capabilities, add the **Push Notifications** capability and the
   **Critical Alerts** capability (once Apple approves), and make sure *Build Settings →
   Code Signing Entitlements* points at `App/App.entitlements` (Xcode usually wires this when you add
   the capability — verify it).
5. **Android (later, optional):** to push to the Android app we need FCM — create a Firebase project,
   add an Android app for `org.bustinjailey.freddy`, drop `google-services.json` into
   `android/app/`, and create a service account for the server (`FCM_*` env, `firebase-admin`).
   `src/lib/server/push.js` has the dispatch stubbed with a TODO. **Until then the Android build
   falls back to Web Push** (which still works on Android — Android honors high-importance Web Push
   channels reasonably well; it just can't bypass DND). The `setBypassDnd(true)` channel tweak is a
   small native change we can do once FCM is in.

## Build (once the above is sorted)

```sh
npm install
npm run build            # produces the SvelteKit client the fallback page lives alongside
npx cap sync             # copies capacitor.config.ts + plugins into ios/ and android/
npm run cap:android      # opens Android Studio  -> Run / generate signed APK/AAB
npm run cap:ios          # opens Xcode (Mac only) -> Run / Archive -> TestFlight
```

`FREDDY_NATIVE_URL` (build-time env, optional) overrides the URL the shell loads — handy for
pointing a dev build at a laptop. Defaults to `https://freddy.bustinjailey.org`.

## How a critical alert flows

1. Mom opens the native app → `src/lib/native.js` registers → APNs returns a device token →
   `POST /api/register-native { identity:"Mom", platform:"ios", token }` → server stores it in
   `data/native-tokens.json`.
2. Justin taps **Need you** → `POST /api/notify { from:"Justin", signal:"need-you" }`.
3. Server sees Mom has a native iOS token, sends an APNs alert with `sound:{critical:1, volume:1}` +
   `interruption-level:"critical"` → it rings even on silent / in Focus.
4. It also starts the existing escalation timer, so it re-fires every ~30s until Mom acks (opens the
   app, or taps the notification — `pushNotificationActionPerformed` → `POST /api/ack`).
5. If Mom *also* has the PWA subscribed, she gets that too (deduped by notification tag); dead
   endpoints get pruned on the first failed send.
