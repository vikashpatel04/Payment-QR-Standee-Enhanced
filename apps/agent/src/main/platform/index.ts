/**
 * OS-specific behaviour, kept behind one interface so macOS and Linux can follow
 * Windows. Only `win32.ts` touches native APIs.
 */
export interface Platform {
  readonly name: string;
  /** Remembers the window that has focus now (usually the billing software), before the popup takes it. */
  captureForeground(): unknown;
  /** Gives focus back to a captured window. Returns false if it is gone or Windows refused. */
  restoreForeground(token: unknown): boolean;
  /** True when no other app's window has focus, so giving focus back won't fight a click elsewhere. */
  foregroundIsOursOrNone(): boolean;
  /** Windows 11 acrylic behind the popup. */
  supportsAcrylic(): boolean;
}

const fallback: Platform = {
  name: 'fallback',
  captureForeground: () => null,
  restoreForeground: () => false,
  foregroundIsOursOrNone: () => true,
  supportsAcrylic: () => false,
};

export async function loadPlatform(): Promise<Platform> {
  if (process.platform === 'win32') {
    try {
      const { createWin32Platform } = await import('./win32');
      return createWin32Platform();
    } catch (error) {
      console.error('[platform] Win32 focus helpers unavailable, focus return disabled:', error);
    }
  }
  return fallback;
}
