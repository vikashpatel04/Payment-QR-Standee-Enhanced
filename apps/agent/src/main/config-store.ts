import { CONFIG_SCHEMA_VERSION, type ConfigSecrets, type CounterPayConfig, EventHub, normalizeConfig } from '@counterpay/core';
import { randomBytes, randomInt } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import Store from 'electron-store';
import type { ConfigPatch } from '../shared/api';
import { mergePatch } from './merge';

export const secrets: ConfigSecrets = {
  token: () => randomBytes(24).toString('base64url'),
  pairingCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
};

/** Every Web display gets its own pairing code the moment it is added. */
function withPairingCodes(config: CounterPayConfig): CounterPayConfig {
  if (!config.displays.some((d) => d.driver === 'web' && !d.pairingCode)) return config;
  return {
    ...config,
    displays: config.displays.map((d) => (d.driver === 'web' && !d.pairingCode ? { ...d, pairingCode: secrets.pairingCode() } : d)),
  };
}

interface Events extends Record<string, unknown> {
  change: { config: CounterPayConfig; previous: CounterPayConfig };
}

/**
 * The shop's settings, in %APPDATA%\Counter Pay\config.json. Every read and write
 * goes through normalizeConfig, so a hand-edited or older file can't break the agent.
 */
export class ConfigStore {
  private readonly store: Store<Record<string, unknown>>;
  private readonly events = new EventHub<Events>();
  private current: CounterPayConfig;

  constructor() {
    this.store = new Store<Record<string, unknown>>({ name: 'config', clearInvalidConfig: false });
    const raw = this.store.store;
    const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : null;
    if (version !== null && version < CONFIG_SCHEMA_VERSION && existsSync(this.store.path)) {
      // Keep the old file before migrating, so "Reinstall previous version" can read it.
      copyFileSync(this.store.path, this.store.path.replace(/\.json$/, `.v${version}.backup.json`));
    }
    this.current = withPairingCodes(normalizeConfig(raw, secrets));
    this.store.store = this.current as unknown as Record<string, unknown>;
  }

  get(): CounterPayConfig {
    return this.current;
  }

  get path(): string {
    return this.store.path;
  }

  update(patch: ConfigPatch): CounterPayConfig {
    const previous = this.current;
    this.current = withPairingCodes(normalizeConfig(mergePatch(previous, patch), secrets));
    this.store.store = this.current as unknown as Record<string, unknown>;
    this.events.fire('change', { config: this.current, previous });
    return this.current;
  }

  onChange(callback: (change: Events['change']) => void): () => void {
    return this.events.on('change', callback);
  }
}
