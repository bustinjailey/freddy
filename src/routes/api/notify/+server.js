import { json, error } from '@sveltejs/kit';
import { getIdentities, otherIdentity } from '$lib/server/config.js';
import {
	getSubscription,
	deleteSubscription,
	getNativeToken,
	deleteNativeToken
} from '$lib/server/store.js';
import { sendWebPush, sendApns, sendFcm } from '$lib/server/push.js';
import { startEscalation, cancelEscalation } from '$lib/server/escalation.js';
import { SIGNAL_BY_ID } from '$lib/signals.js';

/**
 * Deliver one notification for `sig` to `to`, over every channel that parent is registered on:
 * the native app (APNs/FCM) — which, for "request" tiles, sends a *critical* alert that bypasses
 * silent/DND — and/or the PWA (Web Push). Dead endpoints are pruned. `attempt` 0 = the initial
 * ping; >0 = an escalation nudge (labelled as such).
 *
 * @param {string} to
 * @param {string} from
 * @param {{ id: string, label: string, emoji: string, escalate: boolean }} sig
 * @param {number} attempt
 * @returns {Promise<{ ok: boolean, gone: boolean, channels: string[], errors: string[] }>}
 *   ok   = at least one channel accepted it
 *   gone = the recipient has no live endpoint left (stop escalating)
 */
async function deliver(to, from, sig, attempt) {
	const payload = {
		title: `${sig.emoji} ${sig.label}`,
		body: attempt > 0 ? `from ${from} · still waiting` : `from ${from}`,
		signal: sig.id,
		from,
		to,
		attempt,
		ts: Date.now()
	};
	const critical = sig.escalate; // "request" tiles ride the critical-alert path on iOS

	const channels = /** @type {string[]} */ ([]);
	const errors = /** @type {string[]} */ ([]);
	let anyOk = false;
	let anyEndpoint = false;

	const native = getNativeToken(to);
	if (native) {
		anyEndpoint = true;
		const r =
			native.platform === 'ios'
				? await sendApns(native.token, payload, { critical })
				: await sendFcm(native.token, payload, { critical });
		if (r.ok) {
			anyOk = true;
			channels.push(native.platform);
		} else {
			errors.push(r.error);
			if (r.gone) {
				deleteNativeToken(to);
				anyEndpoint = false;
			}
		}
	}

	const sub = getSubscription(to);
	if (sub) {
		anyEndpoint = true;
		const r = await sendWebPush(sub, payload);
		if (r.ok) {
			anyOk = true;
			channels.push('web');
		} else {
			errors.push(r.error);
			if (r.gone) {
				deleteSubscription(to);
				// only mark "no endpoint" if there's also no live native token
				if (!getNativeToken(to)) anyEndpoint = anyEndpoint && false;
			}
		}
	}

	return { ok: anyOk, gone: !anyEndpoint, channels, errors };
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

	const r = await deliver(to, from, sig, 0);
	if (!r.ok) {
		const noEndpoint = !getNativeToken(to) && !getSubscription(to);
		return json({
			ok: true,
			delivered: false,
			reason: noEndpoint ? 'not-registered' : 'push-error',
			detail: r.errors.join('; ') || undefined,
			to
		});
	}

	let escalating = false;
	if (sig.escalate) {
		escalating = true;
		startEscalation(to, sig, (attempt) => deliver(to, from, sig, attempt));
	}
	return json({ ok: true, delivered: true, escalating, channels: r.channels, to });
}
