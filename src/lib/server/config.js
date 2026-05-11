import { env } from '$env/dynamic/private';

const DEFAULT_IDENTITIES = ['Justin', 'Mom'];

/**
 * The two parent identities shown on the "who are you?" screen.
 * Override with FREDDY_IDENTITIES="Name A,Name B" in the service env file.
 * @returns {[string, string]}
 */
export function getIdentities() {
	const raw = (env.FREDDY_IDENTITIES ?? '').trim();
	if (raw) {
		const names = raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (names.length === 2) return /** @type {[string, string]} */ ([names[0], names[1]]);
	}
	return /** @type {[string, string]} */ ([...DEFAULT_IDENTITIES]);
}

/** @param {string} from @returns {string} the other parent's name */
export function otherIdentity(from) {
	const [a, b] = getIdentities();
	return from === a ? b : a;
}
