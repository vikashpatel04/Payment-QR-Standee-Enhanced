import type { Clock, DisplayConfig } from '@counterpay/core';
import { SerialFrameDriver, SerialSmartDriver } from './serial';
import { SimulatorDriver } from './simulator';
import type { DisplayDriver } from './types';
import { WebDriver } from './web';
import { type WindowHost, WindowDriver } from './window';

export * from './linked-driver';
export * from './serial';
export * from './simulator';
export * from './types';
export * from './web';
export * from './window';

export interface DriverDeps {
  windowHost: WindowHost;
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
      return new SerialFrameDriver(config.id, config.profile, config.port);
    default: {
      const unknown: never = config.driver;
      throw new Error(`Unknown display driver: ${String(unknown)}`);
    }
  }
}
