/**
 * Socket.io client helpers used by the chat surfaces (Task 25.6).
 *
 * The API exposes a Socket.io gateway under the `/live` namespace
 * (`LiveChatGateway`) for real-time chat during live sessions and
 * (in this iteration) for DM thread updates as well — both rely on
 * `chat:join`, `chat:message`, `chat:left`, `chat:joined` events.
 *
 * Two responsibilities:
 *   1. Resolve the WebSocket origin from `NEXT_PUBLIC_API_URL`.
 *   2. Lazily create one shared `Socket` per origin/auth-token pair
 *      so multiple components (DM thread, notification center, live
 *      panel) reuse the same multiplexed connection.
 */

import { io, type Socket } from 'socket.io-client';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let liveSocket: Socket | null = null;

/**
 * Resolve the canonical WebSocket origin (no trailing slash, no path).
 * The Next.js app talks to the same origin as the REST API; we strip
 * the `/api/v1` prefix that lives only on HTTP routes.
 */
export function getSocketOrigin(): string {
  try {
    const url = new URL(API_BASE_URL);
    return `${url.protocol}//${url.host}`;
  } catch {
    return API_BASE_URL.replace(/\/$/, '');
  }
}

/**
 * Get (or create) the shared `/live` namespace socket.
 *
 * Auth is cookie-based: the HttpOnly `access_token` cookie rides along
 * automatically on the handshake (`withCredentials: true`), and the API's
 * `authenticateSocket` helper reads it from the raw `Cookie` header. No
 * token ever passes through client JS.
 */
export function getLiveSocket(): Socket {
  if (liveSocket) {
    return liveSocket;
  }

  liveSocket = io(`${getSocketOrigin()}/live`, {
    transports: ['websocket'],
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  return liveSocket;
}

/**
 * Disconnect the shared socket (called from logout flow). Safe to call
 * when the socket has not been created yet.
 */
export function disconnectLiveSocket(): void {
  if (liveSocket) {
    liveSocket.removeAllListeners();
    liveSocket.disconnect();
    liveSocket = null;
  }
}
