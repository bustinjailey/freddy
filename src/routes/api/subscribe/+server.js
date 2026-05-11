import { json, error } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { setSubscription } from '$lib/server/store.js';

/** Store (or refresh) the push subscription for one parent. */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const identity = body?.identity;
	const subscription = body?.subscription;
	if (!getIdentities().includes(identity)) throw error(400, 'unknown identity');
	if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys) {
		throw error(400, 'invalid subscription');
	}
	setSubscription(identity, subscription);
	return json({ ok: true });
}
