import { type DisplayMessage, MAX_LINE_LENGTH, type PcMessage, parseDisplayMessage } from '@counterpay/core';
import type { DisplayLink } from '@counterpay/drivers';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

/** A display page connected over WebSocket. One JSON message per frame. */
export class WsLink implements DisplayLink {
  readonly id = randomUUID();
  private messageHandler: (message: DisplayMessage) => void = () => {};
  private closeHandlers: Array<() => void> = [];

  constructor(
    private readonly socket: WebSocket,
    readonly role: 'display' | 'preview',
  ) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (text.length > MAX_LINE_LENGTH) return;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return;
      }
      const message = parseDisplayMessage(value);
      if (message) this.messageHandler(message);
    });
    socket.on('close', () => {
      for (const handler of this.closeHandlers) handler();
      this.closeHandlers = [];
    });
  }

  send(message: PcMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close(1000);
  }

  onMessage(handler: (message: DisplayMessage) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }
}
