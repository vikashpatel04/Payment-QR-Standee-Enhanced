import type { RefCounterState } from '@counterpay/core';
import Store from 'electron-store';
import type { AmountLockTest } from '../shared/api';

interface AgentState {
  refCounter?: RefCounterState;
  lastAmountPaise?: number;
  onboardingCompleted?: boolean;
  amountLockTest?: AmountLockTest;
  /** The app version the shop last saw "What's new" for. */
  seenVersion?: string;
  /** Paired Wi-Fi displays: token → the display and the pairing code it was issued for. */
  webTokens?: Record<string, { id: string; code: string }>;
  /** Wi-Fi displays removed while unreachable: device id → key, so pairing them again needs no reset. */
  wifiKeys?: Record<string, string>;
}

/** Runtime state that must survive restarts but isn't a setting: counters, pairings, onboarding. */
export class StateStore {
  private readonly store = new Store<AgentState>({ name: 'state' });

  get<K extends keyof AgentState>(key: K): AgentState[K] {
    return this.store.get(key);
  }

  set<K extends keyof AgentState>(key: K, value: AgentState[K]): void {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
  }
}
