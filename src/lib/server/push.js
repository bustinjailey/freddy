import webpush from 'web-push';
import apn from '@parse/node-apn';
import { readFileSync } from 'node:fs';
import { env } from '$env/dynamic/private';

// ---------------------------------------------------------------------------
// Web Push (PWA)
// ---------------------------------------------------------------------------

let vapidConfigured = /** @type {boolean | null} */ (null);

/** Lazily wire up VAPID details from the environment. Returns false if keys are missing. */
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

// ---------------------------------------------------------------------------
// APNs (iOS native app) — this is the path that can actually punch through silent/DND,
// via a critical-alert payload. Needs an APNs auth key (.p8) + the Critical Alerts
// entitlement granted on the App ID. All config is env; absent => no-op.
//   APNS_KEY        the .p8 contents (PEM), OR
//   APNS_KEY_PATH   path to the .p8 file
//   APNS_KEY_ID     the key's Key ID
//   APNS_TEAM_ID    Apple Developer Team ID
//   APNS_BUNDLE_ID  app bundle id (default org.bustinjailey.freddy)
//   APNS_PRODUCTION "false" to use the sandbox gateway (default: production)
// ---------------------------------------------------------------------------

/** @type {import('@parse/node-apn').Provider | null | undefined} */
let apnsProvider;

function getApnsProvider() {
	if (apnsProvider !== undefined) return apnsProvider;
	const keyId = env.APNS_KEY_ID;
	const teamId = env.APNS_TEAM_ID;
	let key = env.APNS_KEY;
	if (!key && env.APNS_KEY_PATH) {
		try {
			key = readFileSync(env.APNS_KEY_PATH, 'utf8');
		} catch {
			/* fall through to "not configured" */
		}
	}
	if (!key || !keyId || !teamId) return (apnsProvider = null);
	apnsProvider = new apn.Provider({
		token: { key, keyId, teamId },
		production: env.APNS_PRODUCTION !== 'false'
	});
	return apnsProvider;
}

export function isApnsConfigured() {
	return getApnsProvider() !== null;
}

/**
 * @param {string} token  the device's APNs token
 * @param {{ title: string, body: string, signal: string, from: string, to: string, attempt: number }} payload
 * @param {{ critical: boolean }} opts  critical => bypass the ringer switch + Focus/DND (entitlement required)
 * @returns {Promise<{ ok: true } | { ok: false, gone: boolean, error: string }>}
 */
export async function sendApns(token, payload, { critical }) {
	const provider = getApnsProvider();
	if (!provider) return { ok: false, gone: false, error: 'APNs not configured' };
	const note = new apn.Notification();
	note.topic = env.APNS_BUNDLE_ID || 'org.bustinjailey.freddy';
	note.expiry = Math.floor(Date.now() / 1000) + 600; // match the web-push TTL
	note.priority = 10;
	note.pushType = 'alert';
	note.rawPayload = {
		aps: {
			alert: { title: payload.title, body: payload.body },
			// A critical sound is THE mechanism that overrides silent mode / DND. Plain "default"
			// otherwise. interruption-level "critical" reinforces it (also entitlement-gated).
			sound: critical ? { critical: 1, name: 'default', volume: 1.0 } : 'default',
			'interruption-level': critical ? 'critical' : 'time-sensitive',
			'relevance-score': 1.0
		},
		from: payload.from,
		signal: payload.signal,
		to: payload.to,
		attempt: payload.attempt
	};
	try {
		const res = await provider.send(note, token);
		const bad = res.failed?.[0];
		if (bad) {
			const reason = bad.response?.reason || bad.error?.message || `status ${bad.status}`;
			return { ok: false, gone: reason === 'BadDeviceToken' || reason === 'Unregistered', error: `apns ${reason}` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, gone: false, error: `apns ${String(/** @type {any} */ (err)?.message ?? err)}` };
	}
}

// ---------------------------------------------------------------------------
// FCM (Android native app) — TODO. Android's equivalent of "critical" is a high-importance
// notification channel with setBypassDnd(true) (channel is created client-side; bypassDnd needs
// a small native tweak — see mobile/README.md). Sending requires a Firebase project + service
// account; wiring `firebase-admin` here is the follow-up once those exist. Until then Android
// devices fall back to Web Push (the PWA), which still gets the escalating re-buzz.
// ---------------------------------------------------------------------------

/** @returns {boolean} */
export function isFcmConfigured() {
	return false;
}

/**
 * @param {string} _token @param {object} _payload @param {{ critical: boolean }} _opts
 * @returns {Promise<{ ok: false, gone: boolean, error: string }>}
 */
export async function sendFcm(_token, _payload, _opts) {
	return { ok: false, gone: false, error: 'FCM not implemented yet' };
}
