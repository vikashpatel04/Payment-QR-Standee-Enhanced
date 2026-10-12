import koffi from 'koffi';
import { release } from 'node:os';
import type { Platform } from './index';

const SW_RESTORE = 9;

/** Focus capture and return through user32.dll. Read-only towards other apps: it only moves focus. */
export function createWin32Platform(): Platform {
  const user32 = koffi.load('user32.dll');
  koffi.pointer('HWND', koffi.opaque());
  const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow()');
  const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(HWND hWnd)');
  const IsWindow = user32.func('bool __stdcall IsWindow(HWND hWnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(HWND hWnd)');
  const ShowWindow = user32.func('bool __stdcall ShowWindow(HWND hWnd, int nCmdShow)');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *pid)');

  const ownerPid = (hwnd: unknown): number => {
    const pid = [0];
    GetWindowThreadProcessId(hwnd, pid);
    return pid[0] ?? 0;
  };

  return {
    name: 'win32',

    captureForeground() {
      const hwnd = GetForegroundWindow();
      // Never "return" focus to one of our own windows.
      if (!hwnd || ownerPid(hwnd) === process.pid) return null;
      return hwnd;
    },

    restoreForeground(token) {
      if (!token || !IsWindow(token)) return false;
      if (IsIconic(token)) ShowWindow(token, SW_RESTORE);
      return Boolean(SetForegroundWindow(token));
    },

    foregroundIsOursOrNone() {
      const hwnd = GetForegroundWindow();
      return !hwnd || ownerPid(hwnd) === process.pid;
    },

    supportsAcrylic() {
      const build = Number(release().split('.')[2] ?? 0);
      return build >= 22000;
    },
  };
}
