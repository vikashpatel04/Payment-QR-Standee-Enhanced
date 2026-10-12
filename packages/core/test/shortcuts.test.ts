import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyPress, type KeyPress, sameAccelerator, shortcutWarning } from '../src/shortcuts';

const press = (code: string, mods: Partial<KeyPress> = {}, key = code): KeyPress => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFromKeyPress', () => {
  it('records function keys and modifiers', () => {
    expect(acceleratorFromKeyPress(press('F9'))).toBe('F9');
    expect(acceleratorFromKeyPress(press('F9', { shiftKey: true }))).toBe('Shift+F9');
    expect(acceleratorFromKeyPress(press('KeyP', { ctrlKey: true, altKey: true }, 'p'))).toBe('Ctrl+Alt+P');
  });

  it('waits while only modifiers are held', () => {
    expect(acceleratorFromKeyPress(press('ShiftLeft', { shiftKey: true }, 'Shift'))).toBeNull();
  });

  it('uses the physical key, whatever the keyboard layout types', () => {
    expect(acceleratorFromKeyPress(press('KeyK', { ctrlKey: true }, 'க'))).toBe('Ctrl+K');
  });

  it('names special keys the way Electron does', () => {
    expect(acceleratorFromKeyPress(press('ScrollLock'))).toBe('Scrolllock');
    expect(acceleratorFromKeyPress(press('ArrowUp', { ctrlKey: true }))).toBe('Ctrl+Up');
    expect(acceleratorFromKeyPress(press('Numpad5', { altKey: true }))).toBe('Alt+num5');
  });
});

describe('shortcutWarning', () => {
  it.each([
    ['F12', 'reservedF12'],
    ['Shift+F12', 'reservedF12'],
    ['Ctrl+Space', 'layoutSwitch'],
    ['Alt+Space', 'windowMenu'],
    ['A', 'plainKey'],
    ['Shift+5', 'plainKey'],
    ['', 'needsKey'],
  ])('warns about %j', (accelerator, warning) => {
    expect(shortcutWarning(accelerator)).toBe(warning);
  });

  it.each(['F9', 'Shift+F9', 'Ctrl+F12', 'Alt+F12', 'Scrolllock', 'Ctrl+Alt+P'])('accepts %j', (accelerator) => {
    expect(shortcutWarning(accelerator)).toBeNull();
  });
});

describe('sameAccelerator', () => {
  it('ignores modifier order, case and aliases', () => {
    expect(sameAccelerator('Shift+Ctrl+F9', 'control+shift+f9')).toBe(true);
    expect(sameAccelerator('CmdOrCtrl+K', 'Ctrl+K')).toBe(true);
    expect(sameAccelerator('F9', 'Shift+F9')).toBe(false);
  });
});
