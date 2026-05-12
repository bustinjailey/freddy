import { json } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { subscriptionStatus } from '$lib/server/store.js';
import { isPushConfigured } from '$lib/server/push.js';
import { escalationStatus, escalationConfig } from '$lib/server/escalation.js';

/** Liveness + a quick peek at config/subscription/escalation state for debugging. */
export function GET() {
	const identities = getIdentities();
	const subs = subscriptionStatus();
	return json({
		ok: true,
		app: 'freddy',
		identities,
		pushConfigured: isPushConfigured(),
		subscriptions: Object.fromEntries(identities.map((n) => [n, Boolean(subs[n])])),
		escalation: {
			intervalSec: Math.round(escalationConfig.intervalMs / 1000),
			maxRepeats: escalationConfig.maxRepeats,
			active: escalationStatus()
		}
	});
}
