/** The four tiles. `id` is the wire value; `label`/`emoji` are shown to people. */
export const SIGNALS = [
	{ id: 'need-you', label: 'Need you', emoji: '🙋' },
	{ id: 'diaper', label: 'Diaper', emoji: '🧷' },
	{ id: 'bottle', label: 'Bottle', emoji: '🍼' },
	{ id: 'all-good', label: 'All good', emoji: '👍' }
];

/** @type {Record<string, { id: string, label: string, emoji: string }>} */
export const SIGNAL_BY_ID = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
