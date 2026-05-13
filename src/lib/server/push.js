import webpush from 'web-push';
import { env } from '$env/dynamic/private';

/**
 * Web Push (PWA) — for whoever isn't running the native Android app. Mom uses this; Justin uses
 * the SSE path (see `stream.js` + the Android foreground service). VAPID keys come from the env.
 */

let vapidConfigured = /** @type {boolean | null} */ (null);

function ensureVapid() {
	if (vapidConfigured !== null) return vapidConfigured;
	const pub = env.VAPID_PUBLIC_KEY;
	const priv = env.VAPID_PRIVATE_KEY;
	if (!pub || !priv) return (vapidConfigured = false);
	webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@bustinjailey.org', pub, priv);
	return (vapidConfigured = true);
}

export function isPushConfigured() {
	return ensureVapid();
}

/**
 * @param {import('web-push').PushSubscription} subscription
 * @param {unknown} payload  serialised to JSON and delivered to the service worker
 * @returns {Promise<{ ok: true } | { ok: false, gone: boolean, error: string }>}
 */
export async function sendWebPush(subscription, payload) {
	if (!ensureVapid()) return { ok: false, gone: false, error: 'VAPID keys not configured' };
	try {
		await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 600, urgency: 'high' });
		return { ok: true };
	} catch (err) {
		const code = /** @type {any} */ (err)?.statusCode;
		const body = /** @type {any} */ (err)?.body;
		return {
			ok: false,
			gone: code === 404 || code === 410,
			error: `webpush ${code ?? '?'}${body ? `: ${String(body).slice(0, 200)}` : ''}`
		};
	}
}
