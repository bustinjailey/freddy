import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';

// Push state is written here at runtime. On the webapps LXC the service runs with
// ProtectSystem=strict + ReadWritePaths=/opt/apps/freddy and WorkingDirectory=/opt/apps/freddy,
// so "data/" resolves there and is writable.
const DATA_DIR = resolve(env.FREDDY_DATA_DIR ?? 'data');
const SUBS_FILE = join(DATA_DIR, 'subscriptions.json'); // Web Push (PWA)
const NATIVE_FILE = join(DATA_DIR, 'native-tokens.json'); // APNs / FCM (Capacitor app)

/** @param {string} file @returns {Record<string, any>} */
function readJson(file) {
	try {
		const obj = JSON.parse(readFileSync(file, 'utf8'));
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
}

/** @param {string} file @param {Record<string, unknown>} obj */
function writeJson(file, obj) {
	mkdirSync(DATA_DIR, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(obj, null, 2));
	renameSync(tmp, file); // atomic replace
}

// --- Web Push subscriptions ---

/** @param {string} identity */
export function getSubscription(identity) {
	return readJson(SUBS_FILE)[identity] ?? null;
}

/** @param {string} identity @param {import('web-push').PushSubscription} subscription */
export function setSubscription(identity, subscription) {
	const all = readJson(SUBS_FILE);
	all[identity] = subscription;
	writeJson(SUBS_FILE, all);
}

/** @param {string} identity */
export function deleteSubscription(identity) {
	const all = readJson(SUBS_FILE);
	if (identity in all) {
		delete all[identity];
		writeJson(SUBS_FILE, all);
	}
}

// --- Native push tokens (APNs / FCM) ---

/**
 * @typedef {{ platform: 'ios' | 'android', token: string, updatedAt: number }} NativeToken
 */

/** @param {string} identity @returns {NativeToken | null} */
export function getNativeToken(identity) {
	const e = readJson(NATIVE_FILE)[identity];
	return e && typeof e.token === 'string' ? e : null;
}

/** @param {string} identity @param {'ios' | 'android'} platform @param {string} token */
export function setNativeToken(identity, platform, token) {
	const all = readJson(NATIVE_FILE);
	all[identity] = { platform, token, updatedAt: Date.now() };
	writeJson(NATIVE_FILE, all);
}

/** @param {string} identity */
export function deleteNativeToken(identity) {
	const all = readJson(NATIVE_FILE);
	if (identity in all) {
		delete all[identity];
		writeJson(NATIVE_FILE, all);
	}
}

// --- status (for /api/health) ---

/** @returns {Record<string, { web: boolean, native: false | 'ios' | 'android' }>} */
export function deliveryStatus() {
	const subs = readJson(SUBS_FILE);
	const native = readJson(NATIVE_FILE);
	const names = new Set([...Object.keys(subs), ...Object.keys(native)]);
	return Object.fromEntries(
		[...names].map((n) => [
			n,
			{ web: Boolean(subs[n]?.endpoint), native: native[n]?.platform ?? false }
		])
	);
}

// Make sure the data dir exists at boot so the first write can't race a missing parent.
try {
	if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
} catch {
	/* will retry on first write */
}
