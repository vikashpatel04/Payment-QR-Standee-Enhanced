import {
  applyPcMessage,
  type DisplayMessage,
  type DisplayState,
  initialDisplayState,
  parsePcMessage,
  type Step,
  tickDisplay,
} from '@counterpay/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageParams } from './params';

export type LinkStatus = 'connecting' | 'open';

/** Close code the agent uses when a Wi-Fi display's token is no longer valid. */
export const UNAUTHORIZED_CLOSE = 4001;

const FIRMWARE = 'web-0.1.0';

function socketUrl(params: PageParams, token: string | null): string {
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (params.key && params.id) {
    url.searchParams.set('id', params.id);
    url.searchParams.set('key', params.key);
    url.searchParams.set('role', params.role);
  } else if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

/**
 * Keeps a WebSocket to the agent open, applies what it sends and runs the
 * display's own clocks, so a pay QR ends on time even if the PC goes away.
 */
export function useDisplayLink(params: PageParams, token: string | null, onUnauthorized: () => void) {
  const [state, setState] = useState<DisplayState>(() => initialDisplayState(Date.now()));
  const [status, setStatus] = useState<LinkStatus>('connecting');
  const stateRef = useRef(state);
  const socketRef = useRef<WebSocket | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const send = useCallback(
    (message: DisplayMessage) => {
      const socket = socketRef.current;
      if (params.role === 'display' && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    [params.role],
  );

  const run = useCallback(
    (step: (current: DisplayState) => Step) => {
      const result = step(stateRef.current);
      for (const reply of result.replies) send(reply);
      if (result.state !== stateRef.current) {
        stateRef.current = result.state;
        setState(result.state);
      }
    },
    [send],
  );

  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(socketUrl(params, token));
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setStatus('open');
        send({ t: 'hello', fw: FIRMWARE, w: window.innerWidth, h: window.innerHeight });
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        for (const line of event.data.split('\n')) {
          if (!line.trim()) continue;
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          const message = parsePcMessage(value);
          if (message) run((current) => applyPcMessage(current, message, Date.now()));
        }
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        if (stopped) return;
        if (event.code === UNAUTHORIZED_CLOSE) {
          unauthorizedRef.current();
          return;
        }
        setStatus('connecting');
        retryTimer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry++));
      };
    };

    connect();
    const tick = setInterval(() => run((current) => tickDisplay(current, Date.now())), 250);
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(tick);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [params, token, run, send]);

  return { state, status };
}
