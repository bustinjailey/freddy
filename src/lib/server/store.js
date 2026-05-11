import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';

// Push subscriptions are written here at runtime. On the webapps LXC the
// service runs with ProtectSystem=strict + ReadWritePaths=/opt/apps/freddy,
// and WorkingDirectory=/opt/apps/freddy, so "data/" resolves there and is writable.
const DATA_DIR = resolve(env.FREDDY_DATA_DIR ?? 'data');
const FILE = join(DATA_DIR, 'subscriptions.json');

/** @returns {Record<string, import('web-push').PushSubscription>} */
function readAll() {
	try {
		const txt = readFileSync(FILE, 'utf8');
		const obj = JSON.parse(txt);
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
}

/** @param {Record<string, unknown>} obj */
function writeAll(obj) {
	mkdirSync(DATA_DIR, { recursive: true });
	const tmp = `${FILE}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(obj, null, 2));
	renameSync(tmp, FILE); // atomic replace
}

/** @param {string} identity */
export function getSubscription(identity) {
	return readAll()[identity] ?? null;
}

/** @param {string} identity @param {import('web-push').PushSubscription} subscription */
export function setSubscription(identity, subscription) {
	const all = readAll();
	all[identity] = subscription;
	writeAll(all);
}

/** @param {string} identity */
export function deleteSubscription(identity) {
	const all = readAll();
	if (identity in all) {
		delete all[identity];
		writeAll(all);
	}
}

/** @returns {Record<string, boolean>} which identities currently have a subscription */
export function subscriptionStatus() {
	const all = readAll();
	return Object.fromEntries(Object.keys(all).map((k) => [k, Boolean(all[k]?.endpoint)]));
}

// Make sure the data dir exists at boot so the first write can't race a missing parent.
try {
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
} catch {
	/* will retry on first write */
}
