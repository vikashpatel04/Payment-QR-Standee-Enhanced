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
  reduceMotion: boolean;
  /** After Enter the pill drops away at once: the Info Island takes over. */
  infoIsland: boolean;
}

/** Settings › Info Island, as the island draws it. */
export interface IslandLook {
  /** % of the standard size. */
  size: number;
  /** % roundness of the lower corners. */
  roundness: number;
  speed: 'fast' | 'medium' | 'slow';
  reduceMotion: boolean;
}

/** What the Info Island shows. `seq` numbers every message, so a late "gone" never hides a newer one. */
export type IslandState =
  | {
      kind: 'pay';
      /** The QR's scene id. */
      id: number;
      amountPaise: number;
      /** The QR's whole life, and how much of it is left, in ms. */
      totalMs: number;
      leftMs: number;
      reach: DisplayReach;
      /** A display (or the simulator) has drawn it. */
      confirmed: boolean;
      look: IslandLook;
    }
  | { kind: 'message'; message: 'cleared' | 'timedOut'; look: IslandLook }
  /** Settings changed: redraw with the new look, nothing else. */
  | { kind: 'look'; look: IslandLook }
  | { kind: 'hide' };

/** "Show on screen" in Settings: shown, the setting is off, or a real QR is showing. */
export type IslandPreviewResult = 'shown' | 'off' | 'busy';

export interface IslandMessage {
  seq: number;
  state: IslandState;
}

export type SubmitResult = { ok: true; reach: DisplayReach } | { ok: false; error: 'noPayee' | 'invalid' | 'failed' };

export interface ToastMessage {
  text: string;
  tone: 'info' | 'warn';
  reduceMotion?: boolean;
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

export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error';

/** Automatic updates from GitHub Releases. `disabled` in a development build. */
export interface UpdateState {
  status: UpdateStatus;
  /** The version being downloaded or ready to install. */
  version?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
}

export interface AppSnapshot {
  version: string;
  config: CounterPayConfig;
  scene: SceneView;
  displays: DisplayView[];
  today: { count: number; totalPaise: number };
  shortcuts: { summon: ShortcutState; clear: ShortcutState; next: ShortcutState; paused: boolean };
  payee: PayeeInfo | null;
  onboarding: OnboardingState;
  /** Addresses a phone on the shop Wi-Fi opens to pair, when a Web display is enabled. */
  lanUrls: string[];
  /** A server that couldn't start, shown as a banner with the fix. */
  serverError: { code: 'localPortBusy' | 'lanPortBusy'; port: number } | null;
  /** Where this PC's display server is, for previews and images. */
  localBaseUrl: string;
  monitors: MonitorInfo[];
  update: UpdateState;
  /** Set after an update installed, until the shop dismisses it. */
  whatsNew: { version: string; url: string | null } | null;
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
  island: {
    onState(callback: (message: IslandMessage) => void): Unsubscribe;
    /** The mouse is over the island: let it take clicks (its × ), else clicks pass through. */
    hover(over: boolean): void;
    /** The ×: hide until the next QR. The QR itself stays on the display. */
    dismiss(seq: number): void;
    /** The island has tucked itself away after message `seq`. */
    gone(seq: number): void;
  };
  app: {
    snapshot(): Promise<AppSnapshot>;
    onSnapshot(callback: (snapshot: AppSnapshot) => void): Unsubscribe;
    updateConfig(patch: ConfigPatch): Promise<CounterPayConfig>;
    showAmount(amountPaise: number): Promise<SubmitResult>;
    clear(): Promise<boolean>;
    /** Settings › Info Island › Show on screen: the island with a sample amount for a few seconds. */
    previewIsland(): Promise<IslandPreviewResult>;
    testPattern(displayId: string): void;
    openSimulator(): void;
    regeneratePairingCode(displayId: string): Promise<string>;
    /** While recording a shortcut in Settings, the global shortcuts must not fire. */
    suspendShortcuts(suspended: boolean): void;
    pickLogo(): Promise<string | null>;
    /** Copies an image into the shop's content folder and returns the path displays load it from. */
    pickImage(): Promise<string | null>;
    backupConfig(): Promise<{ saved: boolean; path?: string }>;
    /** Opens the folder with counter-pay.log, for reporting a problem. */
    openLogs(): void;
    /** COM ports, for choosing a USB display's port. */
    listSerialPorts(): Promise<Array<{ path: string; label: string; usbSerial: boolean }>>;
    wifi: {
      /** Displays that answered on the shop network in the last moment. */
      discover(): Promise<WifiDisplayFound[]>;
      /** Pairs with the display at `address` (host or host:port) using the code on its screen, and adds it. */
      pair(address: string, code: string): Promise<WifiPairResult>;
      /**
       * Tells a Wi-Fi display to forget this PC, then removes it. If the display can't be
       * reached it stays, unless `force`.
       */
      forget(displayId: string, force?: boolean): Promise<{ ok: true } | { ok: false; reason: 'unreachable' }>;
    };
    restoreConfig(): Promise<{ restored: boolean; error?: string }>;
    updates: {
      check(): Promise<UpdateState>;
      /** Restarts into the downloaded update. Refused while a QR is showing. */
      install(): Promise<boolean>;
      dismissWhatsNew(): Promise<void>;
    };
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

export interface WifiDisplayFound {
  id: string;
  name: string;
  fw: string;
  w: number;
  h: number;
  profile?: string;
  address: string;
  /** Paired with a PC already (this one or another). */
  paired: boolean;
  /** Already one of this PC's displays. */
  added: boolean;
  rotation?: 0 | 90 | 180 | 270;
}

export type WifiPairResult =
  | { ok: true; displayId: string }
  | { ok: false; reason: 'code' | 'paired' | 'busy' | 'key' | 'unreachable' | 'address' };

export const IPC = {
  popupOpen: 'popup:open',
  popupSubmit: 'popup:submit',
  popupCancel: 'popup:cancel',
  popupDone: 'popup:done',
  toastShow: 'toast:show',
  islandState: 'island:state',
  islandHover: 'island:hover',
  islandDismiss: 'island:dismiss',
  islandGone: 'island:gone',
  snapshot: 'app:snapshot',
  snapshotPush: 'app:snapshot-push',
  updateConfig: 'app:update-config',
  showAmount: 'app:show-amount',
  clear: 'app:clear',
  islandPreview: 'app:island-preview',
  testPattern: 'app:test-pattern',
  openSimulator: 'app:open-simulator',
  regeneratePairing: 'app:regenerate-pairing',
  suspendShortcuts: 'app:suspend-shortcuts',
  pickLogo: 'app:pick-logo',
  pickImage: 'app:pick-image',
  backupConfig: 'app:backup-config',
  openLogs: 'app:open-logs',
  listSerialPorts: 'app:list-serial-ports',
  wifiDiscover: 'wifi:discover',
  wifiPair: 'wifi:pair',
  wifiForget: 'wifi:forget',
  restoreConfig: 'app:restore-config',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  whatsNewDismiss: 'update:whats-new-dismiss',
  historyQuery: 'history:query',
  historyExport: 'history:export',
  historyReshow: 'history:reshow',
  payeeInspect: 'payee:inspect',
  payeeSave: 'payee:save',
  onboardingTest: 'onboarding:test',
  onboardingComplete: 'onboarding:complete',
} as const;
