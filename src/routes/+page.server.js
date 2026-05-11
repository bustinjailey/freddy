import { env } from '$env/dynamic/private';
import { getIdentities } from '$lib/server/config.js';

/** Hand the two parent names + the (public) VAPID key to the page. */
export function load() {
	return {
		identities: getIdentities(),
		vapidPublicKey: env.VAPID_PUBLIC_KEY ?? ''
	};
}
