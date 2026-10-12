import { type Clock, getProfile, type Scene, sceneToMessage } from '@counterpay/core';
import { LinkedDriver } from './linked-driver';
import type { Ack, DriverStatus } from './types';

/**
 * The display that is always there. It has no device to wait for: the agent's own
 * state is what it shows, and the simulator window and previews only mirror it.
 * When no real display is connected, the popup says the QR went to the simulator.
 */
export class SimulatorDriver extends LinkedDriver {
  constructor(id: string, clock?: Clock) {
    super({ id, kind: 'simulator', profile: getProfile('browser'), includeUri: true, ...(clock ? { clock } : {}) });
  }

  override async show(scene: Scene): Promise<Ack> {
    this.scene = scene;
    const seq = this.nextSeq();
    this.broadcast(sceneToMessage(scene, seq, this.clock.now(), { includeUri: true }));
    return { ok: true, seq, scene: scene.kind, latencyMs: 0, virtual: true };
  }

  override status(): DriverStatus {
    const { detail: _detail, ...status } = super.status();
    return { ...status, state: 'connected', clients: 0, previews: this.links.size };
  }

  /** The simulator never loses its link. */
  override onLinkLost(): () => void {
    return () => {};
  }
}
