import webpush from 'web-push';
import { env } from '$env/dynamic/private';

let configured = /** @type {boolean | null} */ (null);

/** Lazily wire up VAPID details from the environment. Returns false if keys are missing. */
function ensureConfigured() {
	if (configured !== null) return configured;
	const pub = env.VAPID_PUBLIC_KEY;
	const priv = env.VAPID_PRIVATE_KEY;
	if (!pub || !priv) {
		configured = false;
		return false;
	}
	webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:admin@bustinjailey.org', pub, priv);
	configured = true;
	return true;
}

export function isPushConfigured() {
	return ensureConfigured();
}

/**
 * Send a push notification.
 * @param {import('web-push').PushSubscription} subscription
 * @param {unknown} payload  serialised to JSON and delivered to the service worker
 * @returns {Promise<{ ok: true } | { ok: false, gone: boolean, error: string }>}
 */
export async function sendPush(subscription, payload) {
	if (!ensureConfigured()) return { ok: false, gone: false, error: 'VAPID keys not configured' };
	try {
		await webpush.sendNotification(subscription, JSON.stringify(payload), {
			TTL: 600,
			urgency: 'high'
		});
		return { ok: true };
	} catch (err) {
		const code = /** @type {any} */ (err)?.statusCode;
		const body = /** @type {any} */ (err)?.body;
		return {
			ok: false,
			gone: code === 404 || code === 410,
			error: `push ${code ?? '?'}${body ? `: ${String(body).slice(0, 200)}` : ''}`
		};
	}
}
