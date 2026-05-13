import { json } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { subscriptionStatus } from '$lib/server/store.js';
import { isPushConfigured } from '$lib/server/push.js';
import { streamStatus } from '$lib/server/stream.js';
import { escalationStatus, escalationConfig } from '$lib/server/escalation.js';

/** Liveness + a quick peek at config / delivery / escalation state for debugging. */
export function GET() {
	const identities = getIdentities();
	const webSubs = subscriptionStatus();
	const streams = streamStatus();
	return json({
		ok: true,
		app: 'freddy',
		identities,
		webPushConfigured: isPushConfigured(),
		// per identity: which channels are live right now
		recipients: Object.fromEntries(
			identities.map((n) => [n, { web: webSubs[n] ?? false, stream: streams[n] ?? 0 }])
		),
		escalation: {
			intervalSec: Math.round(escalationConfig.intervalMs / 1000),
			maxRepeats: escalationConfig.maxRepeats,
			active: escalationStatus()
		}
	});
}
