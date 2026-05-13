import { error } from '@sveltejs/kit';
import { getIdentities } from '$lib/server/config.js';
import { addSubscriber, removeSubscriber, nextClientId } from '$lib/server/stream.js';

/**
 * Server-Sent Events firehose for one parent. The Android app keeps this open from a foreground
 * service; on each `signal` event it raises a local notification on a DND-bypass channel. That's
 * how we ring through silent/Focus without an FCM project — the server doesn't need a critical
 * payload, the *channel* on the device does the bypassing.
 *
 *   GET /api/stream?identity=<name>
 *
 * The connection is heartbeated every 25s with an SSE comment line, partly to keep proxies from
 * idling it out and partly so the app notices a dead TCP socket quickly.
 */

const ENCODER = new TextEncoder();
const HEARTBEAT_MS = 25_000;

export function GET({ url }) {
	const identity = url.searchParams.get('identity');
	if (!identity || !getIdentities().includes(identity)) throw error(400, 'unknown identity');

	const id = nextClientId();
	/** @type {ReturnType<typeof setInterval> | undefined} */
	let heartbeat;
	/** @type {ReadableStreamDefaultController<Uint8Array> | undefined} */
	let controller;
	let closed = false;

	/** @param {string} chunk */
	function write(chunk) {
		if (closed || !controller) return false;
		try {
			controller.enqueue(ENCODER.encode(chunk));
			return true;
		} catch {
			closed = true;
			return false;
		}
	}

	const client = {
		id,
		/** @param {string} event @param {unknown} data */
		send(event, data) {
			return write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		},
		close() {
			closed = true;
			if (heartbeat) clearInterval(heartbeat);
			try {
				controller?.close();
			} catch {
				/* already closed */
			}
		}
	};

	const stream = new ReadableStream({
		start(c) {
			controller = c;
			addSubscriber(identity, client);
			write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ id, identity })}\n\n`);
			heartbeat = setInterval(() => {
				if (!write(`: ping ${Date.now()}\n\n`)) {
					removeSubscriber(identity, client);
					client.close();
				}
			}, HEARTBEAT_MS);
		},
		cancel() {
			removeSubscriber(identity, client);
			client.close();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			'x-accel-buffering': 'no', // some proxies (nginx) buffer SSE by default; this disables it
			connection: 'keep-alive'
		}
	});
}
