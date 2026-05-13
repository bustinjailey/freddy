import { env } from '$env/dynamic/private';

/**
 * Re-buzz the recipient's phone until they acknowledge.
 *
 * A PWA gets no Critical-Alerts / DND-bypass APIs (those are native-app only), so the next
 * best thing is persistence: after the first push we re-send the same notification (same `tag`,
 * `renotify: true`) every few seconds, which makes the OS re-alert without stacking notifications.
 * It stops on ack, when superseded by a newer signal to the same person, when the subscription
 * dies, or after a hard cap so a forgotten phone doesn't buzz forever.
 *
 * State is in-memory and per-process. adapter-node is a single long-lived process so that's fine;
 * a server restart simply drops any in-flight escalation (worst case: ~`MAX * INTERVAL` seconds).
 */

const INTERVAL_MS = clampInt(env.FREDDY_REPEAT_INTERVAL_SEC, 30, 5, 600) * 1000;
const MAX_REPEATS = clampInt(env.FREDDY_REPEAT_MAX, 6, 0, 60);

/** @param {string|undefined} raw @param {number} dflt @param {number} lo @param {number} hi */
function clampInt(raw, dflt, lo, hi) {
	const n = Number.parseInt(String(raw ?? ''), 10);
	if (!Number.isFinite(n)) return dflt;
	return Math.min(hi, Math.max(lo, n));
}

/**
 * @typedef {object} Pending
 * @property {string} signal      signal id currently escalating to this recipient
 * @property {number} attempts    repeats sent so far (the initial push is not counted)
 * @property {ReturnType<typeof setTimeout>} timer
 */

/** @type {Map<string, Pending>} recipient identity -> in-flight escalation */
const pending = new Map();

/**
 * Begin (or replace) an escalation aimed at `to`.
 * @param {string} to                       recipient identity
 * @param {{ id: string }} sig               the signal being escalated
 * @param {(attempt: number) => Promise<{ ok: boolean, gone?: boolean }>} resend
 *        re-sends the notification; `attempt` is 1-based. Return `gone: true` to stop (dead sub).
 */
export function startEscalation(to, sig, resend) {
	cancelEscalation(to); // newest signal wins
	if (MAX_REPEATS <= 0) return;

	const state = /** @type {Pending} */ ({ signal: sig.id, attempts: 0, timer: /** @type {any} */ (null) });

	const tick = async () => {
		state.attempts += 1;
		let res;
		try {
			res = await resend(state.attempts);
		} catch {
			res = { ok: false };
		}
		// Stop if the subscription is gone, or we've hit the cap. Otherwise schedule the next nudge.
		if ((res && res.gone) || state.attempts >= MAX_REPEATS) {
			if (pending.get(to) === state) pending.delete(to);
			return;
		}
		if (pending.get(to) === state) state.timer = setTimeout(tick, INTERVAL_MS);
	};

	state.timer = setTimeout(tick, INTERVAL_MS);
	pending.set(to, state);
}

/**
 * Acknowledge / cancel any escalation aimed at `identity`.
 * @param {string} identity
 * @returns {boolean} true if something was actually cancelled
 */
export function cancelEscalation(identity) {
	const state = pending.get(identity);
	if (!state) return false;
	clearTimeout(state.timer);
	pending.delete(identity);
	return true;
}

/** @returns {Record<string, { signal: string, attempts: number }>} debug view for /api/health */
export function escalationStatus() {
	return Object.fromEntries(
		[...pending.entries()].map(([to, s]) => [to, { signal: s.signal, attempts: s.attempts }])
	);
}

export const escalationConfig = { intervalMs: INTERVAL_MS, maxRepeats: MAX_REPEATS };
