import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { type CounterPayApi, IPC } from '../shared/api';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: CounterPayApi = {
  popup: {
    onOpen: (callback) => subscribe(IPC.popupOpen, callback),
    submit: (amountPaise) => ipcRenderer.invoke(IPC.popupSubmit, amountPaise),
    cancel: () => ipcRenderer.send(IPC.popupCancel),
    done: () => ipcRenderer.send(IPC.popupDone),
  },
  toast: {
    onShow: (callback) => subscribe(IPC.toastShow, callback),
  },
  app: {
    snapshot: () => ipcRenderer.invoke(IPC.snapshot),
    onSnapshot: (callback) => subscribe(IPC.snapshotPush, callback),
    updateConfig: (patch) => ipcRenderer.invoke(IPC.updateConfig, patch),
    showAmount: (amountPaise) => ipcRenderer.invoke(IPC.showAmount, amountPaise),
    clear: () => ipcRenderer.invoke(IPC.clear),
    testPattern: (displayId) => ipcRenderer.send(IPC.testPattern, displayId),
    openSimulator: () => ipcRenderer.send(IPC.openSimulator),
    regeneratePairingCode: (displayId) => ipcRenderer.invoke(IPC.regeneratePairing, displayId),
    suspendShortcuts: (suspended) => ipcRenderer.send(IPC.suspendShortcuts, suspended),
    pickLogo: () => ipcRenderer.invoke(IPC.pickLogo),
    pickImage: () => ipcRenderer.invoke(IPC.pickImage),
    backupConfig: () => ipcRenderer.invoke(IPC.backupConfig),
    restoreConfig: () => ipcRenderer.invoke(IPC.restoreConfig),
    updates: {
      check: () => ipcRenderer.invoke(IPC.updateCheck),
      install: () => ipcRenderer.invoke(IPC.updateInstall),
      dismissWhatsNew: () => ipcRenderer.invoke(IPC.whatsNewDismiss),
    },
    history: {
      query: (filter) => ipcRenderer.invoke(IPC.historyQuery, filter),
      exportCsv: (filter) => ipcRenderer.invoke(IPC.historyExport, filter),
      reshow: (id) => ipcRenderer.invoke(IPC.historyReshow, id),
    },
    payee: {
      inspect: (text) => ipcRenderer.invoke(IPC.payeeInspect, text),
      save: (baseUri, payeeLabel) => ipcRenderer.invoke(IPC.payeeSave, baseUri, payeeLabel),
    },
    onboarding: {
      saveTest: (answer) => ipcRenderer.invoke(IPC.onboardingTest, answer),
      complete: () => ipcRenderer.invoke(IPC.onboardingComplete),
    },
  },
};

contextBridge.exposeInMainWorld('counterpay', api);
