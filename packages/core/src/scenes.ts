/**
 * A customer display is always in exactly one of three scenes. The agent owns the
 * current scene; displays only render it.
 */

export type SceneKind = 'ambient' | 'pay' | 'thanks';

/** Why the display is back on Ambient. Reported by devices in their `state` message. */
export type AmbientReason = 'idle' | 'cleared' | 'expired' | 'link-lost' | 'thanks-done';

export interface AmbientScene {
  kind: 'ambient';
  id: number;
  shownAt: number;
  reason: AmbientReason;
}

export interface PayScene {
  kind: 'pay';
  id: number;
  shownAt: number;
  expiresAt: number;
  amountPaise: number;
  ref: string;
  uri: string;
}

export interface ThanksScene {
  kind: 'thanks';
  id: number;
  shownAt: number;
  endsAt: number;
}

export type Scene = AmbientScene | PayScene | ThanksScene;

/** Text in several languages, keyed by language code: `{ en: "…", hi: "…" }`. */
export type LocalText = Record<string, string>;

export type AmbientItem =
  | { k: 'logo' }
  | { k: 'rating'; url: string; text?: LocalText }
  | { k: 'text'; text: LocalText }
  | { k: 'image'; src: string }
  /** The shop's own UPI QR with no amount, like the printed standee: the customer types the amount. */
  | { k: 'standee'; text?: LocalText };

/** Everything a display needs besides the scene itself: branding, wording and the playlist. */
export interface DisplayContent {
  shopName: string;
  /** Shown as "Paying: …" so the customer can match the name their UPI app shows. */
  payeeLabel: string;
  accent: string;
  /** A URL the display can load the logo from, if there is one. */
  logoUrl?: string;
  /** Display languages, primary first. Two languages are shown together. */
  languages: string[];
  ambient: { slideSeconds: number; items: AmbientItem[] };
  thanks: { seconds: number; ratingUrl?: string };
  /** The shop's standee QR (no amount), for the standee slide. Absent until a payee is set up. */
  standeeUri?: string;
}

export function secondsLeft(scene: PayScene | ThanksScene, now: number): number {
  const end = scene.kind === 'pay' ? scene.expiresAt : scene.endsAt;
  return Math.max(0, Math.ceil((end - now) / 1000));
}
