import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';

// Push state is written here at runtime. On the webapps LXC the service runs with
// ProtectSystem=strict + ReadWritePaths=/opt/apps/freddy and WorkingDirectory=/opt/apps/freddy,
// so "data/" resolves there and is writable.
const DATA_DIR = resolve(env.FREDDY_DATA_DIR ?? 'data');
const SUBS_FILE = join(DATA_DIR, 'subscriptions.json'); // Web Push (PWA)

/** @returns {Record<string, any>} */
function readSubs() {
	try {
		const obj = JSON.parse(readFileSync(SUBS_FILE, 'utf8'));
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
}

/** @param {Record<string, unknown>} obj */
function writeSubs(obj) {
	mkdirSync(DATA_DIR, { recursive: true });
	const tmp = `${SUBS_FILE}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(obj, null, 2));
	renameSync(tmp, SUBS_FILE); // atomic replace
}

/** @param {string} identity */
export function getSubscription(identity) {
	return readSubs()[identity] ?? null;
}

/** @param {string} identity @param {import('web-push').PushSubscription} subscription */
export function setSubscription(identity, subscription) {
	const all = readSubs();
	all[identity] = subscription;
	writeSubs(all);
}

/** @param {string} identity */
export function deleteSubscription(identity) {
	const all = readSubs();
	if (identity in all) {
		delete all[identity];
		writeSubs(all);
	}
}

/** @returns {Record<string, boolean>} identity -> has a stored web-push subscription */
export function subscriptionStatus() {
	const all = readSubs();
	return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Boolean(v?.endpoint)]));
}

// Make sure the data dir exists at boot so the first write can't race a missing parent.
try {
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
} catch {
	/* will retry on first write */
}
