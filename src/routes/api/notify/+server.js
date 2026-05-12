import { json, error } from '@sveltejs/kit';
import { getIdentities, otherIdentity } from '$lib/server/config.js';
import { getSubscription, deleteSubscription } from '$lib/server/store.js';
import { sendPush } from '$lib/server/push.js';
import { startEscalation, cancelEscalation } from '$lib/server/escalation.js';
import { SIGNAL_BY_ID } from '$lib/signals.js';

/**
 * Push one notification for `sig` to `to`. Returns the same shape as `sendPush` and prunes a
 * dead subscription. `attempt` 0 = the initial ping; >0 = an escalation nudge (labelled as such).
 * @param {string} to
 * @param {string} from
 * @param {{ id: string, label: string, emoji: string }} sig
 * @param {number} attempt
 * @returns {Promise<{ ok: true } | { ok: false, gone: boolean, error: string }>}
 */
async function pushSignal(to, from, sig, attempt) {
	const sub = getSubscription(to);
	if (!sub) return { ok: false, gone: true, error: 'no-subscription' };
	const r = await sendPush(sub, {
		title: `${sig.emoji} ${sig.label}`,
		body: attempt > 0 ? `from ${from} · still waiting` : `from ${from}`,
		signal: sig.id,
		from,
		to,
		attempt,
		ts: Date.now()
	});
	if (!r.ok && r.gone) deleteSubscription(to);
	return r;
}

/**
 * A parent tapped a tile. Fan it out to the *other* parent only — never echo to the sender.
 * For "request" tiles we also start an escalation so the alert keeps nudging until it's ack'd.
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

	// Tapping a tile means the sender is looking at their phone — clear anything nudging them.
	// And a fresh signal supersedes whatever was buzzing the recipient before.
	cancelEscalation(from);
	cancelEscalation(to);

	const r = await pushSignal(to, from, sig, 0);
	if (!r.ok) {
		return json({
			ok: true,
			delivered: false,
			reason:
				r.error === 'no-subscription'
					? 'no-subscription'
					: r.gone
						? 'subscription-expired'
						: 'push-error',
			detail: r.error,
			to
		});
	}

	let escalating = false;
	if (sig.escalate) {
		escalating = true;
		startEscalation(to, sig, (attempt) => pushSignal(to, from, sig, attempt));
	}
	return json({ ok: true, delivered: true, escalating, to });
}
