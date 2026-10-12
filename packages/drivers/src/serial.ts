import { type DisplayContent, type DisplayProfile, type DriverKind, getProfile, type Scene } from '@counterpay/core';
import type { Ack, DisplayDriver, DriverStatus } from './types';

/**
 * Phase 2 stubs. Both serial drivers will open the port with `serialport`, read the
 * device's `hello`, and then:
 *  - serial-smart: send pay / clear / playlist lines (the ESP32-S3 draws scenes itself);
 *  - serial-frame: render the display page off-screen at the profile size, threshold
 *    it to the panel format (never dithered, so the QR stays sharp) and send a
 *    `frame` header plus raw bytes, waiting for the ack.
 * Until then they report "unsupported" so the app can say so plainly.
 */
abstract class SerialDriverStub implements DisplayDriver {
  readonly profile: DisplayProfile;

  constructor(
    readonly id: string,
    readonly kind: Extract<DriverKind, 'serial-frame' | 'serial-smart'>,
    profileId: string | undefined,
    protected readonly port: string,
  ) {
    this.profile = getProfile(profileId);
  }

  async connect(): Promise<void> {
    // TODO(phase-2): open `this.port` (or auto-detect a CH340/CP210x/ESP32-S3 USB device) and wait for hello.
  }

  async disconnect(): Promise<void> {
    // TODO(phase-2): close the port.
  }

  async show(_scene: Scene): Promise<Ack> {
    // TODO(phase-2): send the scene and resolve on the device's ack.
    return { ok: false, seq: 0, reason: 'unsupported' };
  }

  setContent(_content: DisplayContent): void {
    // TODO(phase-2): send content (smart) or re-render the Ambient frames (frame).
  }

  status(): DriverStatus {
    return { id: this.id, kind: this.kind, state: 'unsupported', detail: 'phase2', clients: 0, previews: 0 };
  }

  onStatus(): () => void {
    return () => {};
  }

  onLinkLost(): () => void {
    return () => {};
  }
}

export class SerialSmartDriver extends SerialDriverStub {
  constructor(id: string, profileId: string | undefined, port = 'auto') {
    super(id, 'serial-smart', profileId ?? 'tft-3in5', port);
  }
}

export class SerialFrameDriver extends SerialDriverStub {
  constructor(id: string, profileId: string | undefined, port = 'auto') {
    super(id, 'serial-frame', profileId ?? 'waveshare-4in2', port);
  }
}
