<script>
	import { onMount } from 'svelte';
	import { SIGNALS } from '$lib/signals.js';
	import { isNativeApp, initNativePush } from '$lib/native.js';

	let { data } = $props();
	// data.identities: [string, string], data.vapidPublicKey: string

	const STORE_KEY = 'freddy.identity';

	// presentation for each tile (ids/labels come from $lib/signals)
	/** @type {Record<string, string>} */
	const TILE_CLASS = {
		'need-you': 'need',
		diaper: 'diaper',
		bottle: 'bottle',
		'all-good': 'good'
	};

	/** @type {'loading' | 'pick' | 'main'} */
	let view = $state('loading');
	let me = $state('');
	let other = $derived(data.identities.find((n) => n !== me) ?? '');

	/** @type {'unknown' | 'working' | 'ok' | 'denied' | 'unsupported' | 'needs-install' | 'error'} */
	let pushState = $state('unknown');
	let pushDetail = $state('');

	/** @type {{ text: string, kind: 'ok' | 'err' } | null} */
	let toast = $state(null);
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let toastTimer;
	let sending = $state(false);

	/** @param {string} text @param {'ok' | 'err'} kind */
	function showToast(text, kind) {
		toast = { text, kind };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 3500);
	}

	function isStandalone() {
		return (
			window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
			/** @type {any} */ (window.navigator).standalone === true
		);
	}
	function isIOS() {
		const ua = navigator.userAgent || '';
		return (
			/iphone|ipad|ipod/i.test(ua) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
		);
	}

	/** @param {string} base64 */
	function urlBase64ToUint8Array(base64) {
		const padding = '='.repeat((4 - (base64.length % 4)) % 4);
		const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
		const raw = atob(normalized);
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	}

	/** Set up alerts the right way for where we're running: native push in the Capacitor app,
	 *  Web Push in the browser/PWA. */
	async function setupAlerts() {
		if (isNativeApp()) {
			pushState = 'working';
			try {
				const r = await initNativePush(me, ackSeen);
				if (r.active) pushState = 'ok';
				else if (r.reason === 'denied') pushState = 'denied';
				else {
					pushState = 'error';
					pushDetail = 'native push: ' + (r.reason ?? 'unavailable');
				}
			} catch (err) {
				pushState = 'error';
				pushDetail = String(/** @type {any} */ (err)?.message ?? err);
			}
			return;
		}
		await setupPush();
	}

	async function setupPush() {
		try {
			if (isNativeApp()) return; // the native shell handles its own push
			if (
				!('serviceWorker' in navigator) ||
				!('PushManager' in window) ||
				!('Notification' in window)
			) {
				pushState = 'unsupported';
				return;
			}
			if (isIOS() && !isStandalone()) {
				pushState = 'needs-install';
				return;
			}
			if (!data.vapidPublicKey) {
				pushState = 'error';
				pushDetail = 'server is missing its push key';
				return;
			}
			pushState = 'working';
			const reg = await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('service worker did not start')), 8000)
				)
			]);

			let perm = Notification.permission;
			if (perm === 'default') perm = await Notification.requestPermission();
			if (perm !== 'granted') {
				pushState = 'denied';
				return;
			}

			let sub = await /** @type {ServiceWorkerRegistration} */ (reg).pushManager.getSubscription();
			if (!sub) {
				sub = await /** @type {ServiceWorkerRegistration} */ (reg).pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey)
				});
			}
			const res = await fetch('/api/subscribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ identity: me, subscription: sub.toJSON() })
			});
			if (!res.ok) throw new Error('subscribe failed (HTTP ' + res.status + ')');
			pushState = 'ok';
		} catch (err) {
			console.error('[freddy] setupPush', err);
			pushState = 'error';
			pushDetail = String(/** @type {any} */ (err)?.message ?? err);
		}
	}

	/** Tell the server "I'm looking at it" so it stops re-buzzing me. Best-effort, fire-and-forget. */
	function ackSeen() {
		if (!me) return;
		fetch('/api/ack', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ identity: me })
		}).catch(() => {});
	}

	onMount(() => {
		const saved = localStorage.getItem(STORE_KEY);
		if (saved && data.identities.includes(saved)) {
			me = saved;
			view = 'main';
			ackSeen(); // opening the app = I've seen whatever was nudging me
			setupAlerts(); // best-effort (no fresh gesture; may resolve to needs-install / already-granted)
		} else {
			view = 'pick';
		}

		const onVisible = () => {
			if (document.visibilityState === 'visible' && view === 'main') ackSeen();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	/** @param {string} name */
	function pick(name) {
		me = name;
		localStorage.setItem(STORE_KEY, name);
		view = 'main';
		ackSeen();
		setupAlerts(); // inside a click handler → user gesture → permission prompt is allowed
	}

	function switchIdentity() {
		localStorage.removeItem(STORE_KEY);
		me = '';
		pushState = 'unknown';
		pushDetail = '';
		view = 'pick';
	}

	/** @param {{ id: string, label: string }} signal */
	async function send(signal) {
		if (sending) return;
		sending = true;
		navigator.vibrate?.(30);
		try {
			const res = await fetch('/api/notify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ from: me, signal: signal.id })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body?.message || 'HTTP ' + res.status);
			if (body.delivered)
				showToast(
					body.escalating
						? `Sent “${signal.label}” — keeping ${other}'s phone buzzing until they see it`
						: `Sent “${signal.label}” to ${other}`,
					'ok'
				);
			else showToast(`${other}'s phone isn't set up for alerts yet`, 'err');
		} catch (err) {
			console.error('[freddy] send', err);
			showToast('Couldn’t send — check connection and try again', 'err');
		} finally {
			setTimeout(() => (sending = false), 350);
		}
	}

	const STATUS_DOT = { ok: '#3ecf6b', working: '#f4c542', unknown: '#f4c542' };
	let dotColor = $derived(STATUS_DOT[/** @type {'ok'|'working'|'unknown'} */ (pushState)] ?? '#e0573f');
</script>

<div id="app">
	{#if view === 'loading'}
		<div class="splash">
			<div class="splash-mark">👶</div>
			<div class="splash-name">Freddy</div>
		</div>
	{:else if view === 'pick'}
		<div class="pick">
			<div class="pick-mark">👶</div>
			<h1 class="pick-title">Who’s on the phone?</h1>
			<p class="pick-sub">Pick once — Freddy remembers on this device.</p>
			<div class="pick-buttons">
				{#each data.identities as name (name)}
					<button class="pick-btn" onclick={() => pick(name)}>{name}</button>
				{/each}
			</div>
		</div>
	{:else}
		<header class="bar">
			<span class="brand">Freddy</span>
			<button class="who" onclick={switchIdentity} aria-label="Switch who you are">
				<span class="dot" style="background:{dotColor}"></span>
				{me} · switch
			</button>
		</header>

		<div class="grid">
			{#each SIGNALS as s (s.id)}
				<button
					class="tile {TILE_CLASS[s.id] ?? ''}"
					disabled={sending}
					onclick={() => send(s)}
					aria-label={`Tell ${other}: ${s.label}`}
				>
					<span class="tile-emoji" aria-hidden="true">{s.emoji}</span>
					<span class="tile-label">{s.label}</span>
				</button>
			{/each}
		</div>

		{#if pushState !== 'ok'}
			<div class="status status-{pushState}">
				{#if pushState === 'working' || pushState === 'unknown'}
					<span>Setting up alerts…</span>
				{:else if pushState === 'needs-install'}
					<span class="status-main">📲 Add Freddy to your Home Screen</span>
					<span class="status-sub"
						>Tap the Share button, then “Add to Home Screen”. Open Freddy from there — push
						notifications only work in the installed app.</span
					>
				{:else if pushState === 'denied'}
					<span class="status-main">🔕 Notifications are off</span>
					<span class="status-sub">Turn them on for Freddy in your phone’s Settings, then </span>
					<button class="retry" onclick={setupPush}>try again</button>
				{:else if pushState === 'unsupported'}
					<span class="status-main">This browser can’t do push</span>
					<span class="status-sub">Use Safari on iPhone, or Chrome on Android.</span>
				{:else}
					<span class="status-main">⚠️ Couldn’t set up alerts</span>
					<span class="status-sub">{pushDetail}</span>
					<button class="retry" onclick={setupPush}>try again</button>
				{/if}
			</div>
		{/if}
	{/if}

	{#if toast}
		<div class="toast toast-{toast.kind}" role="status">{toast.text}</div>
	{/if}
</div>

<style>
	.splash,
	.pick {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 10px;
	}
	.splash-mark,
	.pick-mark {
		font-size: 4.5rem;
		line-height: 1;
	}
	.splash-name {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.pick {
		gap: 6px;
		padding: 16px;
	}
	.pick-title {
		margin: 8px 0 0;
		font-size: 1.7rem;
		font-weight: 700;
	}
	.pick-sub {
		margin: 0 0 18px;
		color: var(--muted);
		font-size: 1rem;
	}
	.pick-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: min(420px, 100%);
	}
	.pick-btn {
		padding: 26px 16px;
		font-size: 1.6rem;
		font-weight: 700;
		border-radius: var(--card-radius);
		background: #2c2420;
		color: var(--fg);
		box-shadow: inset 0 0 0 2px #4a3d34;
		transition: transform 0.06s ease;
	}
	.pick-btn:active {
		transform: scale(0.97);
		background: #3a3029;
	}

	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 6px;
		flex: 0 0 auto;
	}
	.brand {
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: 0.02em;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--muted);
		font-size: 0.95rem;
		padding: 6px 8px;
		border-radius: 999px;
	}
	.who:active {
		background: #2c2420;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		display: inline-block;
	}

	.grid {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: var(--gap);
		min-height: 0;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: var(--card-radius);
		color: #fff;
		font-weight: 800;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
		transition:
			transform 0.06s ease,
			filter 0.06s ease;
		min-height: 0;
		padding: 8px;
	}
	.tile:active {
		transform: scale(0.97);
		filter: brightness(0.9);
	}
	.tile:disabled {
		opacity: 0.55;
	}
	.tile-emoji {
		font-size: clamp(2.6rem, 12vh, 4.4rem);
		line-height: 1;
		filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.2));
	}
	.tile-label {
		font-size: clamp(1.15rem, 4.2vh, 1.7rem);
		letter-spacing: 0.01em;
	}
	.tile.need {
		background: linear-gradient(160deg, #d6453a, #b2261d);
	}
	.tile.diaper {
		background: linear-gradient(160deg, #c98a2e, #a06b1f);
	}
	.tile.bottle {
		background: linear-gradient(160deg, #3a86c8, #2563a0);
	}
	.tile.good {
		background: linear-gradient(160deg, #38b06a, #258a4f);
	}

	.status {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px 14px;
		border-radius: 16px;
		background: #2c2420;
		font-size: 0.95rem;
		color: var(--fg);
	}
	.status-needs-install {
		background: #324a63;
	}
	.status-denied,
	.status-error {
		background: #5a2b26;
	}
	.status-main {
		font-weight: 700;
	}
	.status-sub {
		color: var(--muted);
		display: inline;
	}
	.retry {
		align-self: flex-start;
		margin-top: 4px;
		font-weight: 700;
		text-decoration: underline;
		color: var(--fg);
		padding: 4px 0;
	}

	.toast {
		position: fixed;
		left: 50%;
		bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
		transform: translateX(-50%);
		max-width: min(92vw, 460px);
		padding: 13px 18px;
		border-radius: 14px;
		font-size: 1rem;
		font-weight: 600;
		text-align: center;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
		animation: toast-in 0.18s ease;
	}
	.toast-ok {
		background: #214f33;
		color: #d6f5e0;
	}
	.toast-err {
		background: #5a2b26;
		color: #f6dcd7;
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translate(-50%, 10px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}
</style>
