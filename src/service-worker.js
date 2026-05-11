/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const CACHE = `freddy-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			// best-effort: a single missing asset must not block the worker (push matters more)
			await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

// Serve precached app-shell assets cache-first; everything else (API, navigations) hits the network.
sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
	}
});

// --- Web Push: a tap from the other parent arrives here ---
sw.addEventListener('push', (event) => {
	let data = /** @type {any} */ ({});
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		/* keep {} — still must show *something* (userVisibleOnly) */
	}
	const title = data.title || 'Freddy';
	/** @type {NotificationOptions & { vibrate?: number[], renotify?: boolean, timestamp?: number }} */
	const options = {
		body: data.body || 'needs attention',
		icon: '/icon-192.png',
		badge: '/badge-96.png',
		tag: data.signal ? `freddy-${data.signal}` : 'freddy',
		renotify: true,
		requireInteraction: true,
		vibrate: [180, 80, 180, 80, 360],
		timestamp: typeof data.ts === 'number' ? data.ts : Date.now(),
		data: { url: '/' }
	};
	event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target =
		(event.notification.data && /** @type {any} */ (event.notification.data).url) || '/';
	event.waitUntil(
		(async () => {
			const wins = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const w of wins) {
				if ('focus' in w) {
					try {
						await /** @type {any} */ (w).navigate?.(target);
					} catch {
						/* navigate can reject cross-origin; ignore */
					}
					return w.focus();
				}
			}
			return sw.clients.openWindow(target);
		})()
	);
});
