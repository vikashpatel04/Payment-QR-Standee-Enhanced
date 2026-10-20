import { LINK_LOSS_MS, type ContentMessage, type DisplayMessage, fromWirePlaylist, type PcMessage } from './protocol';
import type { AmbientItem, AmbientReason } from './scenes';

/**
 * What a display does with the messages it receives. Browser displays run this in
 * the display page; smart firmware follows the same rules. It is the display's own
 * guarantee that a pay QR never outlives its ttl or a lost link, even if the PC crashes.
 */

export type DisplayScene =
  | { kind: 'ambient'; reason: AmbientReason; since: number }
  | { kind: 'pay'; amt: number; ref: string; uri?: string; since: number; until: number }
  | { kind: 'thanks'; since: number; until: number };

export interface DisplayState {
  content: ContentMessage | null;
  playlist: AmbientItem[];
  slideSeconds: number;
  /** Slides change only on the cashier's key: show `slideIndex`. */
  manual: boolean;
  slideIndex: number;
  scene: DisplayScene;
  /** When the PC was last heard from. */
  lastHeard: number;
  /** Until when a test pattern covers the scene. */
  testUntil: number | null;
}

export const DEFAULT_THANKS_SECONDS = 10;
export const DEFAULT_SLIDE_SECONDS = 8;

export function initialDisplayState(now: number): DisplayState {
  return {
    content: null,
    playlist: [],
    slideSeconds: DEFAULT_SLIDE_SECONDS,
    manual: false,
    slideIndex: 0,
    scene: { kind: 'ambient', reason: 'idle', since: now },
    lastHeard: now,
    testUntil: null,
  };
}

export interface Step {
  state: DisplayState;
  /** Messages to send back to the PC. */
  replies: DisplayMessage[];
}

export function applyPcMessage(state: DisplayState, message: PcMessage, now: number): Step {
  const heard = { ...state, lastHeard: now };
  switch (message.t) {
    case 'pay': {
      const scene: DisplayScene = {
        kind: 'pay',
        amt: message.amt,
        ref: message.ref,
        since: now,
        until: now + message.ttl * 1000,
        ...(message.uri ? { uri: message.uri } : {}),
      };
      return { state: { ...heard, scene }, replies: [{ t: 'ack', seq: message.seq, scene: 'pay' }] };
    }
    case 'clear': {
      const thanksSeconds = state.content?.thanks ?? DEFAULT_THANKS_SECONDS;
      const scene: DisplayScene =
        message.then === 'thanks' && thanksSeconds > 0
          ? { kind: 'thanks', since: now, until: now + thanksSeconds * 1000 }
          : { kind: 'ambient', reason: 'cleared', since: now };
      return { state: { ...heard, scene }, replies: [{ t: 'ack', seq: message.seq, scene: scene.kind }] };
    }
    case 'content':
      return { state: { ...heard, content: message }, replies: [] };
    case 'playlist':
      return {
        state: {
          ...heard,
          playlist: fromWirePlaylist(message.items),
          slideSeconds: message.slide ?? state.slideSeconds,
          manual: message.manual === true,
          slideIndex: message.index ?? 0,
        },
        replies: [],
      };
    case 'test':
      return { state: { ...heard, testUntil: now + message.seconds * 1000 }, replies: [] };
    case 'ping':
    case 'frame':
    case 'who':
      return { state: heard, replies: [] };
  }
}

/** Runs the display's own clocks: ttl expiry, link loss, the end of Thanks and of a test pattern. */
export function tickDisplay(state: DisplayState, now: number): Step {
  let next = state;
  const replies: DisplayMessage[] = [];
  if (next.testUntil !== null && now >= next.testUntil) next = { ...next, testUntil: null };

  const scene = next.scene;
  if (scene.kind === 'pay') {
    const reason: AmbientReason | null =
      now >= scene.until ? 'expired' : now - next.lastHeard > LINK_LOSS_MS ? 'link-lost' : null;
    if (reason) {
      next = { ...next, scene: { kind: 'ambient', reason, since: now } };
      replies.push({ t: 'state', scene: 'ambient', reason });
    }
  } else if (scene.kind === 'thanks' && now >= scene.until) {
    next = { ...next, scene: { kind: 'ambient', reason: 'thanks-done', since: now } };
  }
  return { state: next, replies };
}

