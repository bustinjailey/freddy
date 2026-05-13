import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell for Freddy (Android-only — sideloaded APK, no Play Store, no Firebase).
 *
 * The app itself stays the SvelteKit web app at https://freddy.bustinjailey.org — the native
 * wrapper just loads that URL in a WebView (`server.url`) so there's a single codebase. The reason
 * to go native is the one thing a PWA can't do on Android: ring through silent / Focus / DND.
 * That's done by a custom plugin (`FreddyStream`) that runs a foreground service maintaining an
 * SSE connection to /api/stream and raising local notifications on a `setBypassDnd(true)` channel.
 *
 * `mobile/fallback/` is shown only if the server is unreachable at launch.
 *
 * Build prerequisites live in mobile/README.md.
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
	android: {
		allowMixedContent: false
	}
};

export default config;
