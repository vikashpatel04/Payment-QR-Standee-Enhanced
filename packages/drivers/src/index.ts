import { type Clock, type DisplayConfig, getProfile } from '@counterpay/core';
import { SerialSmartDriver, UnsupportedDriver } from './serial';
import { type FrameRenderer, SerialFrameDriver, type SerialPorts } from './serial-frame';
import { SimulatorDriver } from './simulator';
import type { DisplayDriver } from './types';
import { WebDriver } from './web';
import { type WindowHost, WindowDriver } from './window';

export * from './linked-driver';
export * from './serial';
export * from './serial-frame';
export * from './simulator';
export * from './types';
export * from './web';
export * from './window';

export interface DriverDeps {
  windowHost: WindowHost;
  /** USB serial access and off-screen rendering, for frame-mode (E-ink) displays. */
  serialPorts?: SerialPorts;
  /** Finds and opens a paired Wi-Fi display's authenticated link. */
  wifiPorts?: (config: DisplayConfig) => SerialPorts;
  frameRenderer?: FrameRenderer;
  clock?: Clock;
}

export function createDriver(config: DisplayConfig, deps: DriverDeps): DisplayDriver {
  const clock = deps.clock;
  switch (config.driver) {
    case 'simulator':
      return new SimulatorDriver(config.id, clock);
    case 'window':
      return new WindowDriver({
        id: config.id,
        monitor: config.monitor ?? 2,
        rotation: config.rotation ?? 0,
        host: deps.windowHost,
        ...(clock ? { clock } : {}),
      });
    case 'web':
      return new WebDriver(config.id, clock);
    case 'serial-smart':
      return new SerialSmartDriver(config.id, config.profile, config.port);
    case 'serial-frame':
      if (!deps.serialPorts || !deps.frameRenderer) return new UnsupportedDriver(config.id, 'serial-frame', config.profile);
      return new SerialFrameDriver({
        id: config.id,
        port: config.port ?? 'auto',
        profile: getProfile(config.profile ?? 'waveshare-2in13-v4'),
        rotation: config.rotation ?? 0,
        ports: deps.serialPorts,
        renderer: deps.frameRenderer,
        retryMs: !config.port || config.port === 'auto' ? 15_000 : 3_000,
        ...(clock ? { clock } : {}),
      });
    case 'wifi-frame':
      if (!deps.wifiPorts || !deps.frameRenderer || !config.device || !config.key) {
        return new UnsupportedDriver(config.id, 'wifi-frame', config.profile);
      }
      return new SerialFrameDriver({
        id: config.id,
        kind: 'wifi-frame',
        port: 'auto',
        profile: getProfile(config.profile ?? 'waveshare-2in13-v4'),
        rotation: config.rotation ?? 0,
        ports: deps.wifiPorts(config),
        renderer: deps.frameRenderer,
        retryMs: 5_000,
        ...(clock ? { clock } : {}),
      });
    default: {
      const unknown: never = config.driver;
      throw new Error(`Unknown display driver: ${String(unknown)}`);
    }
  }
}
