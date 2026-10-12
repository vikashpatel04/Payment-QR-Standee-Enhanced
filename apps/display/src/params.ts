/**
 * How this page was opened:
 *  - by the agent on this PC: `?id=<display>&key=<local key>` (role `preview` for live previews);
 *  - by a phone on the shop Wi-Fi: no key, so it pairs with a code and keeps a token.
 */
export interface PageParams {
  id: string | null;
  key: string | null;
  role: 'display' | 'preview';
  rotate: 0 | 90 | 180 | 270;
}

function rotation(value: string | null): PageParams['rotate'] {
  const n = Number(value);
  return n === 90 || n === 180 || n === 270 ? n : 0;
}

export function readParams(search: string = window.location.search): PageParams {
  const q = new URLSearchParams(search);
  return {
    id: q.get('id'),
    key: q.get('key'),
    role: q.get('role') === 'preview' ? 'preview' : 'display',
    rotate: rotation(q.get('rotate')),
  };
}

const TOKEN_KEY = 'counterpay.display.token';

export function loadToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode or blocked storage: the phone just pairs again next time.
  }
}
