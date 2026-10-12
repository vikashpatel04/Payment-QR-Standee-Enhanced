import type { Scene } from '@counterpay/core';

/**
 * Point-of-sale plugins only ever READ the point-of-sale system and tell the agent
 * what happened. They never write to its screens or database.
 */
export type TriggerEvent =
  /** A bill was saved. During Pay this clears the QR and shows Thanks. */
  | { kind: 'billSaved'; at: number; billNo?: string; amountPaise?: number }
  /** The point-of-sale knows the amount, so the popup can open pre-filled. */
  | { kind: 'amountReady'; amountPaise: number };

export interface TriggerContext {
  /** The scene the displays show now. */
  currentScene(): Scene;
  onScene(callback: (scene: Scene) => void): () => void;
  emit(event: TriggerEvent): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface TriggerPlugin {
  readonly id: string;
  readonly name: string;
  start(context: TriggerContext): Promise<void>;
  stop(): Promise<void>;
}
