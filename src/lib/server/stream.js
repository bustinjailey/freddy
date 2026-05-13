/**
 * In-memory SSE subscriber registry. The Android app holds an open EventSource on
 * `GET /api/stream?identity=…`; we push the same notify payload over that stream and the
 * native foreground service raises a local notification on a DND-bypass channel — which is
 * Android's *only* way to ring through silent/Focus from a non-Play-Store app (no FCM project
 * needed). One Node process serves the whole thing so a Map here is fine.
 *
 * @typedef {{
 *   id: number,
 *   send: (event: string, data: unknown) => boolean,  // returns false if the socket is dead
 *   close: () => void
 * }} StreamClient
 */

/** @type {Map<string, Set<StreamClient>>} */
const byIdentity = new Map();
let nextId = 1;

/** @param {string} identity @param {StreamClient} client */
export function addSubscriber(identity, client) {
	let set = byIdentity.get(identity);
	if (!set) byIdentity.set(identity, (set = new Set()));
	set.add(client);
}

/** @param {string} identity @param {StreamClient} client */
export function removeSubscriber(identity, client) {
	const set = byIdentity.get(identity);
	if (!set) return;
	set.delete(client);
	if (set.size === 0) byIdentity.delete(identity);
}

/** @param {string} identity @param {unknown} payload @returns {number} number of live subscribers we just pushed to */
export function sendToIdentity(identity, payload) {
	const set = byIdentity.get(identity);
	if (!set || set.size === 0) return 0;
	let delivered = 0;
	for (const c of [...set]) {
		if (c.send('signal', payload)) delivered++;
		else {
			// the underlying stream is gone — drop the client. Its own close handler will fire too,
			// this is just to make the next send() skip it.
			set.delete(c);
		}
	}
	if (set.size === 0) byIdentity.delete(identity);
	return delivered;
}

export function nextClientId() {
	return nextId++;
}

/** @returns {Record<string, number>} identity -> live client count */
export function streamStatus() {
	return Object.fromEntries([...byIdentity].map(([k, v]) => [k, v.size]));
}
