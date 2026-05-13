import { json, error } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { setNativeToken } from '$lib/server/store.js';

/**
 * The Capacitor app calls this after it gets an APNs / FCM device token, so the server knows
 * which native token belongs to which parent. (The PWA uses /api/subscribe instead.)
 */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const identity = body?.identity;
	const platform = body?.platform === 'ios' ? 'ios' : body?.platform === 'android' ? 'android' : null;
	const token = typeof body?.token === 'string' ? body.token.trim() : '';
	if (!getIdentities().includes(identity)) throw error(400, 'unknown identity');
	if (!platform) throw error(400, 'platform must be "ios" or "android"');
	if (!token) throw error(400, 'missing token');
	setNativeToken(identity, platform, token);
	return json({ ok: true });
}
