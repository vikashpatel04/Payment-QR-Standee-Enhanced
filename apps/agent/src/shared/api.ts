import type {
  CounterPayConfig,
  DayTotal,
  DisplayConfig,
  EndReason,
  PayeeInfo,
  QrEvent,
  SceneKind,
  ShortcutWarning,
} from '@counterpay/core';
import type { DriverStatus } from '@counterpay/drivers';

/**
 * The typed bridge between the agent (main process) and its windows. The preload
 * script exposes exactly this as `window.counterpay`; nothing else crosses over.
 */

/** Is anything the customer can see showing the QR? */
export type DisplayReach = 'online' | 'offline' | 'simulatorOnly';

export interface PopupOpenInfo {
  /** A QR already showing: its amount is pre-filled and selected, so typing replaces it. */
  current: { amountPaise: number; ref: string } | null;
  lastAmountPaise: number | null;
  maxRupees: number;
  reach: DisplayReach;
  payeeReady: boolean;
  lang: string;
}

export type SubmitResult = { ok: true; reach: DisplayReach } | { ok: false; error: 'noPayee' | 'invalid' | 'failed' };

export interface ToastMessage {
  text: string;
  tone: 'info' | 'warn';
}

export interface ShortcutState {
  accelerator: string;
  /** False when Windows refused the key (for example F12, which it reserves for debuggers). */
  registered: boolean;
  warning: ShortcutWarning | null;
}

export interface MonitorInfo {
  /** 1-based, in the order the app lists them. */
  index: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

export interface DisplayView {
  config: DisplayConfig;
  status: DriverStatus;
  /** A read-only live preview of this display for the Home page. */
  previewUrl: string | null;
}

export interface AmountLockTest {
  answer: 'locked' | 'editable' | 'mixed';
  testedAt: number;
}

export interface OnboardingState {
  completed: boolean;
  amountLockTest: AmountLockTest | null;
}

export interface SceneView {
  kind: SceneKind;
  amountPaise?: number;
  ref?: string;
  shownAt: number;
  expiresAt?: number;
  endsAt?: number;
}

export interface AppSnapshot {
  version: string;
  config: CounterPayConfig;
  scene: SceneView;
  displays: DisplayView[];
  today: { count: number; totalPaise: number };
  shortcuts: { summon: ShortcutState; clear: ShortcutState; paused: boolean };
  payee: PayeeInfo | null;
  onboarding: OnboardingState;
  /** Addresses a phone on the shop Wi-Fi opens to pair, when a Web display is enabled. */
  lanUrls: string[];
  serverError: string | null;
  monitors: MonitorInfo[];
}

export interface HistoryFilter {
  from?: number;
  to?: number;
  minPaise?: number;
  maxPaise?: number;
  reasons?: Array<EndReason | 'open'>;
  limit?: number;
}

export interface HistoryPage {
  events: QrEvent[];
  totals: DayTotal[];
  total: { count: number; totalPaise: number };
}

export type PayeeImportResult = { ok: true; payee: PayeeInfo } | { ok: false; issue: 'notUpi' | 'noPayee' };

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** Objects merge key by key; arrays (displays, playlist items) are replaced whole. */
export type ConfigPatch = DeepPartial<CounterPayConfig>;

export type Unsubscribe = () => void;

export interface CounterPayApi {
  popup: {
    onOpen(callback: (info: PopupOpenInfo) => void): Unsubscribe;
    /** Shows the amount on every display. Focus goes back to the previous window at once. */
    submit(amountPaise: number): Promise<SubmitResult>;
    /** Esc: hide and give focus back. */
    cancel(): void;
    /** The sent animation finished: hide. */
    done(): void;
  };
  toast: {
    onShow(callback: (message: ToastMessage) => void): Unsubscribe;
  };
  app: {
    snapshot(): Promise<AppSnapshot>;
    onSnapshot(callback: (snapshot: AppSnapshot) => void): Unsubscribe;
    updateConfig(patch: ConfigPatch): Promise<CounterPayConfig>;
    showAmount(amountPaise: number): Promise<SubmitResult>;
    clear(): Promise<boolean>;
    testPattern(displayId: string): void;
    openSimulator(): void;
    regeneratePairingCode(displayId: string): Promise<string>;
    /** While recording a shortcut in Settings, the global shortcuts must not fire. */
    suspendShortcuts(suspended: boolean): void;
    pickLogo(): Promise<string | null>;
    /** Copies an image into the shop's content folder and returns the path displays load it from. */
    pickImage(): Promise<string | null>;
    backupConfig(): Promise<{ saved: boolean; path?: string }>;
    restoreConfig(): Promise<{ restored: boolean; error?: string }>;
    history: {
      query(filter: HistoryFilter): Promise<HistoryPage>;
      exportCsv(filter: HistoryFilter): Promise<{ saved: boolean; path?: string }>;
      reshow(id: number): Promise<SubmitResult>;
    };
    payee: {
      inspect(text: string): Promise<PayeeImportResult>;
      save(baseUri: string, payeeLabel: string): Promise<void>;
    };
    onboarding: {
      saveTest(answer: AmountLockTest['answer']): Promise<void>;
      complete(): Promise<void>;
    };
  };
}

export const IPC = {
  popupOpen: 'popup:open',
  popupSubmit: 'popup:submit',
  popupCancel: 'popup:cancel',
  popupDone: 'popup:done',
  toastShow: 'toast:show',
  snapshot: 'app:snapshot',
  snapshotPush: 'app:snapshot-push',
  updateConfig: 'app:update-config',
  showAmount: 'app:show-amount',
  clear: 'app:clear',
  testPattern: 'app:test-pattern',
  openSimulator: 'app:open-simulator',
  regeneratePairing: 'app:regenerate-pairing',
  suspendShortcuts: 'app:suspend-shortcuts',
  pickLogo: 'app:pick-logo',
  pickImage: 'app:pick-image',
  backupConfig: 'app:backup-config',
  restoreConfig: 'app:restore-config',
  historyQuery: 'history:query',
  historyExport: 'history:export',
  historyReshow: 'history:reshow',
  payeeInspect: 'payee:inspect',
  payeeSave: 'payee:save',
  onboardingTest: 'onboarding:test',
  onboardingComplete: 'onboarding:complete',
} as const;
