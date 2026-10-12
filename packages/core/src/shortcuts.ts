/**
 * Global shortcuts are Electron accelerators such as `F9` or `Shift+F9`.
 * Settings records them from a key press and warns about keys that can't work.
 */

export type ShortcutWarning = 'reservedF12' | 'layoutSwitch' | 'windowMenu' | 'needsKey' | 'plainKey';

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

/** Keys Electron names differently from `KeyboardEvent.code`. */
const CODE_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ScrollLock: 'Scrolllock',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

function keyName(code: string): string | null {
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `num${numpad[1]}`;
  return CODE_NAMES[code] ?? null;
}

/**
 * Turns a key press into an accelerator, or null while only modifiers are held.
 * Uses the physical key (`code`) so a Tamil keyboard layout records the same shortcut.
 */
export function acceleratorFromKeyPress(press: KeyPress): string | null {
  if (MODIFIER_KEYS.has(press.key)) return null;
  const name = keyName(press.code);
  if (!name) return null;
  const parts: string[] = [];
  if (press.ctrlKey) parts.push('Ctrl');
  if (press.altKey) parts.push('Alt');
  if (press.shiftKey) parts.push('Shift');
  if (press.metaKey) parts.push('Super');
  parts.push(name);
  return parts.join('+');
}

function split(accelerator: string): { modifiers: Set<string>; key: string } {
  const parts = accelerator.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const modifiers = new Set(
    parts.map((p) => {
      const lower = p.toLowerCase();
      if (lower === 'control' || lower === 'commandorcontrol' || lower === 'cmdorctrl') return 'ctrl';
      if (lower === 'option') return 'alt';
      if (lower === 'command' || lower === 'cmd' || lower === 'meta') return 'super';
      return lower;
    }),
  );
  return { modifiers, key };
}

/** Why a shortcut won't work well, or null when it is fine. */
export function shortcutWarning(accelerator: string): ShortcutWarning | null {
  const { modifiers, key } = split(accelerator);
  if (!key) return 'needsKey';
  const upper = key.toUpperCase();
  // Windows reserves F12 for debuggers, so RegisterHotKey refuses F12 and Shift+F12.
  if (upper === 'F12' && (modifiers.size === 0 || (modifiers.size === 1 && modifiers.has('shift')))) {
    return 'reservedF12';
  }
  if (upper === 'SPACE' && modifiers.has('ctrl')) return 'layoutSwitch';
  if (upper === 'SPACE' && modifiers.has('alt')) return 'windowMenu';
  // A letter, digit or symbol with no modifier would swallow ordinary typing in the billing software.
  const isFunctionKey = /^F([1-9]|1\d|2[0-4])$/i.test(key);
  const isQuietKey = ['SCROLLLOCK', 'INSERT'].includes(upper);
  const typingModifiers = [...modifiers].filter((m) => m !== 'shift');
  if (!isFunctionKey && !isQuietKey && typingModifiers.length === 0) return 'plainKey';
  return null;
}

export function sameAccelerator(a: string, b: string): boolean {
  const x = split(a);
  const y = split(b);
  return x.key.toLowerCase() === y.key.toLowerCase() && x.modifiers.size === y.modifiers.size && [...x.modifiers].every((m) => y.modifiers.has(m));
}
