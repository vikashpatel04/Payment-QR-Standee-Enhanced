import type { CounterPayApi } from '@shared/api';

declare global {
  interface Window {
    counterpay: CounterPayApi;
  }
}

/** The agent, as the preload script exposes it. */
export const api: CounterPayApi = window.counterpay;
