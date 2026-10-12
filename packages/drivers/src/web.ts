import { type Clock, getProfile } from '@counterpay/core';
import { LinkedDriver } from './linked-driver';

/**
 * A phone, tablet, old laptop or smart-TV browser on the shop Wi-Fi. The device
 * opens the LAN display page, enters the pairing code, and the agent's server
 * attaches its WebSocket here. The page is read-only: it can only receive scenes.
 */
export class WebDriver extends LinkedDriver {
  constructor(id: string, clock?: Clock) {
    super({ id, kind: 'web', profile: getProfile('browser'), includeUri: true, ...(clock ? { clock } : {}) });
  }
}
