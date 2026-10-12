import type { DisplayContent, DisplayMessage, DisplayProfile, DriverKind, PcMessage, Scene, SceneKind } from '@counterpay/core';

export interface Ack {
  ok: boolean;
  seq: number;
  /** The scene the device reports it is now showing. */
  scene?: SceneKind;
  /** Time from send to ack. */
  latencyMs?: number;
  /** Why there was no ack: nobody connected, no reply in time, or a newer scene took over. */
  reason?: 'offline' | 'timeout' | 'superseded' | 'unsupported';
  /** The simulator acknowledges immediately; there is no device to wait for. */
  virtual?: boolean;
}

export type DriverState = 'connected' | 'waiting' | 'offline' | 'unsupported';

export interface DriverStatus {
  id: string;
  kind: DriverKind;
  state: DriverState;
  /** A short machine-readable reason, turned into words by the app. */
  detail?: 'monitorMissing' | 'noClients' | 'phase2' | 'linkLost';
  /** Connected devices or pages showing scenes. */
  clients: number;
  /** Live previews watching this display in the main window. */
  previews: number;
  /** From the device's hello. */
  fw?: string;
  /** Masked UPI ID held by a smart device. */
  vpa?: string;
  size?: { w: number; h: number };
  lastAckMs?: number;
}

/** One end of a message link: a WebSocket, a serial port or an in-process pipe. */
export interface DisplayLink {
  readonly id: string;
  /** Previews mirror a display in the main window. Their acks don't count and they never keep a display "connected". */
  readonly role: 'display' | 'preview';
  send(message: PcMessage): void;
  close(): void;
  onMessage(handler: (message: DisplayMessage) => void): void;
  onClose(handler: () => void): void;
}

/** A customer display. Contributors add new screens by implementing this. */
export interface DisplayDriver {
  readonly id: string;
  readonly kind: DriverKind;
  readonly profile: DisplayProfile;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  show(scene: Scene): Promise<Ack>;
  /** Branding, wording and the Ambient playlist. Sent again to every device that (re)connects. */
  setContent(content: DisplayContent): void;
  /** Shows a test pattern for a few seconds, where the display supports it. */
  testPattern?(): void;
  status(): DriverStatus;
  onStatus(callback: (status: DriverStatus) => void): () => void;
  /** Every device link has been gone for 10 s while a pay QR was showing. */
  onLinkLost(callback: () => void): () => void;
  /** Links that accept message-based devices (web pages, serial ports) take them here. */
  attach?(link: DisplayLink): void;
}
