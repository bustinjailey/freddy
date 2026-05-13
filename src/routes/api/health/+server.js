import { json } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { deliveryStatus } from '$lib/server/store.js';
import { isPushConfigured, isApnsConfigured } from '$lib/server/push.js';
import { escalationStatus, escalationConfig } from '$lib/server/escalation.js';

/** Liveness + a quick peek at config / delivery / escalation state for debugging. */
export function GET() {
	const identities = getIdentities();
	const delivery = deliveryStatus();
	return json({
		ok: true,
		app: 'freddy',
		identities,
		webPushConfigured: isPushConfigured(),
		apnsConfigured: isApnsConfigured(),
		// per identity: { web: bool, native: false | 'ios' | 'android' }
		recipients: Object.fromEntries(identities.map((n) => [n, delivery[n] ?? { web: false, native: false }])),
		escalation: {
			intervalSec: Math.round(escalationConfig.intervalMs / 1000),
			maxRepeats: escalationConfig.maxRepeats,
			active: escalationStatus()
		}
	});
}
