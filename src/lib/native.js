/**
 * Native-shell glue. Everything here is a no-op in a plain browser / the PWA — it only does
 * anything when the page is running inside the Capacitor app (see capacitor.config.ts), where
 * `window.Capacitor.isNativePlatform()` is true and the native push bridge is available.
 *
 * What it does there: create the high-importance Android notification channel, ask for the
 * notification permission, register for APNs/FCM, and POST the device token to /api/register-native
 * so the server can send this parent a *critical* alert. Also acks (stops the server re-buzzing
 * me) when I tap a native notification.
 */

const CHANNEL_ID = 'freddy-alerts';

/** @returns {boolean} */
export function isNativeApp() {
	if (typeof window === 'undefined') return false;
	const cap = /** @type {any} */ (window).Capacitor;
	return !!cap?.isNativePlatform?.();
}

/** @returns {'ios' | 'android' | 'web'} */
function platform() {
	const p = /** @type {any} */ (window).Capacitor?.getPlatform?.();
	return p === 'ios' || p === 'android' ? p : 'web';
}

/** Fire-and-forget POST helper. @param {string} url @param {unknown} payload */
function post(url, payload) {
	return fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload)
	}).catch(() => {});
}

/**
 * @param {string} identity   which parent this device belongs to
 * @param {() => void} [onAck] called when the user taps a native notification
 * @returns {Promise<{ active: boolean, platform?: string, reason?: string }>}
 */
export async function initNativePush(identity, onAck) {
	if (!isNativeApp() || !identity) return { active: false };

	let PushNotifications;
	try {
		({ PushNotifications } = await import('@capacitor/push-notifications'));
	} catch {
		return { active: false, reason: 'plugin-unavailable' };
	}

	// Android 8+: a high-importance channel is what lets a notification ring while we're
	// backgrounded. (True DND bypass = setBypassDnd(true) on the channel — needs a small native
	// tweak, see mobile/README.md. Importance MAX already handles "phone on silent".)
	try {
		await PushNotifications.createChannel({
			id: CHANNEL_ID,
			name: 'Freddy alerts',
			description: 'Need you / Diaper / Bottle pings',
			importance: 5, // IMPORTANCE_HIGH/MAX
			visibility: 1, // VISIBILITY_PUBLIC
			vibration: true,
			sound: 'default'
		});
	} catch {
		/* not Android, or channel already exists — fine */
	}

	let perm = await PushNotifications.checkPermissions();
	if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
		perm = await PushNotifications.requestPermissions();
	}
	if (perm.receive !== 'granted') return { active: false, reason: 'denied' };

	await PushNotifications.removeAllListeners();
	PushNotifications.addListener('registration', (t) => post('/api/register-native', { identity, platform: platform(), token: t.value }));
	PushNotifications.addListener('registrationError', (e) => console.error('[freddy] native push registration error', e));
	PushNotifications.addListener('pushNotificationActionPerformed', () => {
		post('/api/ack', { identity });
		onAck?.();
	});

	await PushNotifications.register();
	return { active: true, platform: platform() };
}
