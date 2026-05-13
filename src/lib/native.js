/**
 * Native-shell glue. In a plain browser / the PWA this is all no-ops — it only does anything when
 * the page is running inside the Capacitor Android app, where `window.Capacitor.isNativePlatform()`
 * is true and the custom `FreddyStream` plugin is registered.
 *
 * What it does there: ask the FreddyStream plugin to start the foreground service that holds an
 * SSE connection to /api/stream and raises local notifications on a `setBypassDnd(true)` channel
 * (USAGE_ALARM sound -> rings through silent / Focus / DND). No FCM, no Firebase — Justin's
 * sideloaded APK talks straight to Freddy.
 */

/** @returns {boolean} */
export function isNativeApp() {
	if (typeof window === 'undefined') return false;
	const cap = /** @type {any} */ (window).Capacitor;
	return !!cap?.isNativePlatform?.();
}

/** @returns {any | null} the FreddyStream plugin, if available */
function plugin() {
	if (typeof window === 'undefined') return null;
	const cap = /** @type {any} */ (window).Capacitor;
	return cap?.Plugins?.FreddyStream ?? null;
}

/**
 * Bring the native alert pipeline up: ask for the runtime notification permission, kick the
 * foreground service, and (if DND-bypass isn't granted yet) report that so the page can prompt
 * the user to enable it.
 *
 * @param {string} identity   which parent this device belongs to
 * @returns {Promise<{
 *   active: boolean,
 *   notificationPermission?: boolean,
 *   dndPolicyGranted?: boolean,
 *   reason?: string
 * }>}
 */
export async function initNativeStream(identity) {
	if (!isNativeApp() || !identity) return { active: false };
	const p = plugin();
	if (!p) return { active: false, reason: 'plugin-unavailable' };

	try {
		const perm = await p.requestNotificationPermission();
		if (perm && perm.granted === false) {
			return { active: false, reason: 'notification-denied' };
		}
	} catch (e) {
		console.warn('[freddy] permission request failed', e);
	}

	const baseUrl = window.location.origin;
	const r = await p.start({ identity, baseUrl });
	return {
		active: !!r?.started,
		notificationPermission: r?.notificationPermission !== false,
		dndPolicyGranted: !!r?.dndPolicyGranted
	};
}

/** Open the system "Notification policy access" settings screen for DND bypass. */
export async function openDndSettings() {
	const p = plugin();
	if (p?.openDndSettings) await p.openDndSettings();
}

/** Open per-app battery settings so the user can mark Freddy "Unrestricted". */
export async function openBatterySettings() {
	const p = plugin();
	if (p?.openBatterySettings) await p.openBatterySettings();
}
