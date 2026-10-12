/**
 * Amounts are always integer paise. Rupee strings exist only at the edges:
 * what the cashier types, what the screen shows and the `am` field of a UPI link.
 */

export const DEFAULT_MAX_RUPEES = 100_000;

/** Whole-rupee digits the popup accepts. Enough to type past any sane maximum and see the error. */
const MAX_WHOLE_DIGITS = 9;

export type AmountError = 'enterAmount' | 'max' | 'format';

export type ParseAmountResult =
  | { ok: true; paise: number }
  | { ok: false; error: AmountError; maxPaise?: number };

const AMOUNT_PATTERN = /^(\d*)(?:\.(\d{0,2}))?$/;

export function parseAmount(input: string, maxRupees: number = DEFAULT_MAX_RUPEES): ParseAmountResult {
  const match = AMOUNT_PATTERN.exec(input.trim());
  if (!match) return { ok: false, error: 'format' };

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole === '' && fraction === '') return { ok: false, error: 'enterAmount' };

  const maxPaise = Math.round(maxRupees * 100);
  if (whole.replace(/^0+/, '').length > MAX_WHOLE_DIGITS) return { ok: false, error: 'max', maxPaise };

  const paise = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  if (paise <= 0) return { ok: false, error: 'enterAmount' };
  if (paise > maxPaise) return { ok: false, error: 'max', maxPaise };
  return { ok: true, paise };
}

/**
 * Applies one popup keystroke to the raw amount text. Keys that would make the text
 * invalid (a second `.`, a third decimal digit, letters) leave it unchanged.
 */
export function applyAmountKey(current: string, key: string): string {
  if (key === 'Backspace') return current.slice(0, -1);

  const dot = current.indexOf('.');
  if (key === '.' || key === 'Decimal') {
    if (dot !== -1) return current;
    return current === '' ? '0.' : `${current}.`;
  }

  if (!/^\d$/.test(key)) return current;
  if (dot !== -1) {
    return current.length - dot - 1 >= 2 ? current : current + key;
  }
  if (current === '0') return key;
  if (current.length >= MAX_WHOLE_DIGITS) return current;
  return current + key;
}

/** Groups whole rupees the Indian way: 1,14,000 and 1,00,00,000. */
export function groupIndian(wholeRupees: string): string {
  const digits = wholeRupees.replace(/^0+(?=\d)/, '');
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
}

/** `formatINR(11400000)` is `₹1,14,000`. Paise show only when there are some: `₹1,140.50`. */
export function formatINR(paise: number, options: { symbol?: boolean } = {}): string {
  const { symbol = true } = options;
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = groupIndian(String(rupees)) + (rest ? `.${String(rest).padStart(2, '0')}` : '');
  return `${sign}${symbol ? '₹' : ''}${body}`;
}

/**
 * Live formatting of what the cashier is typing. Keeps a trailing `.` and partial
 * decimals so the pill shows exactly the keys pressed: `1140.` becomes `₹1,140.`.
 */
export function formatTyping(raw: string): string {
  if (raw === '') return '';
  const [whole = '', fraction] = raw.split('.');
  const grouped = groupIndian(whole === '' ? '0' : whole);
  return fraction === undefined ? `₹${grouped}` : `₹${grouped}.${fraction}`;
}

/** The `am` value of a UPI link: always two decimals, no grouping. `114000` is `1140.00`. */
export function toUpiAmount(paise: number): string {
  const abs = Math.round(paise);
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Raw text to pre-fill the popup with when a QR is already showing. */
export function toAmountInput(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  if (!rest) return String(rupees);
  return `${rupees}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}
