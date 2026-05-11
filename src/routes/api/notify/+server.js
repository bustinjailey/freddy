import { json, error } from '@sveltejs/kit';
import { getIdentities, otherIdentity } from '$lib/server/config.js';
import { getSubscription, deleteSubscription } from '$lib/server/store.js';
import { sendPush } from '$lib/server/push.js';
import { SIGNAL_BY_ID } from '$lib/signals.js';

/**
 * A parent tapped a tile. Fan it out to the *other* parent only — never echo to the sender.
 */
export async function POST({ request }) {
	let body;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}
	const from = body?.from;
	const sig = SIGNAL_BY_ID[body?.signal];
	if (!getIdentities().includes(from)) throw error(400, 'unknown sender');
	if (!sig) throw error(400, 'unknown signal');

	const to = otherIdentity(from);
	const sub = getSubscription(to);
	if (!sub) return json({ ok: true, delivered: false, reason: 'no-subscription', to });

	const r = await sendPush(sub, {
		title: `${sig.emoji} ${sig.label}`,
		body: `from ${from}`,
		signal: sig.id,
		from,
		ts: Date.now()
	});

	if (!r.ok) {
		if (r.gone) deleteSubscription(to);
		return json({
			ok: true,
			delivered: false,
			reason: r.gone ? 'subscription-expired' : 'push-error',
			detail: r.error,
			to
		});
	}
	return json({ ok: true, delivered: true, to });
}
