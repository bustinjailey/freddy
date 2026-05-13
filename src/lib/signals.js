/**
 * The four tiles. `id` is the wire value; `label`/`emoji` are shown to people.
 * `escalate` = keep re-buzzing the other phone until it's acknowledged. A PWA can't
 * override silent/DND, but a notification that re-fires every ~30s is much harder to miss.
 * "All good" is reassurance, not a request — it pings once and stops.
 */
export const SIGNALS = [
	{ id: 'need-you', label: 'Need you', emoji: '🙋', escalate: true },
	{ id: 'diaper', label: 'Diaper', emoji: '🧷', escalate: true },
	{ id: 'bottle', label: 'Bottle', emoji: '🍼', escalate: true },
	{ id: 'all-good', label: 'All good', emoji: '👍', escalate: false }
];

/** @type {Record<string, { id: string, label: string, emoji: string, escalate: boolean }>} */
export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
