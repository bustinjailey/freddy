import { json, error } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { cancelEscalation } from '$lib/server/escalation.js';

/**
 * "I've seen it" — stop nudging this parent. Called by the service worker when the notification
 * is tapped, and by the app when it's opened/brought to the foreground.
 */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const identity = body?.identity;
	if (!getIdentities().includes(identity)) throw error(400, 'unknown identity');
	const cancelled = cancelEscalation(identity);
	return json({ ok: true, cancelled });
}
