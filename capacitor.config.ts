import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell for Freddy.
 *
 * The app itself stays the SvelteKit web app at https://freddy.bustinjailey.org — the native
 * wrapper just loads that URL in a WebView (`server.url`) so there's a single codebase. The whole
 * point of going native is the things a PWA can't do: iOS Critical Alerts and Android DND-bypass
 * notification channels, both wired through @capacitor/push-notifications + native code, not the
 * WebView. `mobile/fallback/` is shown only if the server is unreachable at launch.
 *
 * Build prerequisites and the Apple/Firebase provisioning checklist live in mobile/README.md.
 */
const config: CapacitorConfig = {
  appId: 'org.bustinjailey.freddy',
  appName: 'Freddy',
  webDir: 'mobile/fallback',
  server: {
    // Freddy is LAN + Tailscale only; the WebView must be able to reach this host on the device.
    url: process.env.FREDDY_NATIVE_URL || 'https://freddy.bustinjailey.org',
    cleartext: false
  },
  ios: {
    contentInset: 'always'
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['alert', 'sound', 'badge']
    }
  }
};

export default config;
