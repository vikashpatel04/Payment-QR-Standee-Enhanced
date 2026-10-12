import { toUpiAmount } from './amount';

/**
 * UPI links are rebuilt from the shop's real merchant QR. Every parameter the
 * standee carries is kept byte-for-byte; only the amount, reference and currency
 * are set by Counter Pay.
 */

export interface UpiParam {
  key: string;
  /** Exactly as it appeared in the source text, still percent-encoded. */
  raw: string;
}

export interface ParsedUpi {
  params: UpiParam[];
}

export type UpiIssue = 'notUpi' | 'noPayee';

export class UpiError extends Error {
  constructor(readonly issue: UpiIssue) {
    super(issue === 'notUpi' ? 'Not a UPI payment link' : 'The UPI link has no payee (pa)');
    this.name = 'UpiError';
  }
}

const UPI_PREFIX = /^upi:\/\/pay\?/i;

/** Parameters Counter Pay owns. Any copy in the base link is dropped so it is never duplicated. */
const OWNED_KEYS = new Set(['am', 'tr', 'cu', 'mam']);

export function parseUpiUri(text: string): ParsedUpi {
  const trimmed = text.trim();
  if (!UPI_PREFIX.test(trimmed)) throw new UpiError('notUpi');

  const query = trimmed.replace(UPI_PREFIX, '').split('#')[0] ?? '';
  const params: UpiParam[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (!key) continue;
    params.push({ key, raw: eq === -1 ? '' : part.slice(eq + 1) });
  }
  if (!params.some((p) => p.key.toLowerCase() === 'pa' && p.raw)) throw new UpiError('noPayee');
  return { params };
}

export function serializeUpi(parsed: ParsedUpi): string {
  return `upi://pay?${parsed.params.map((p) => `${p.key}=${p.raw}`).join('&')}`;
}

export function decodeUpiValue(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

export function getUpiParam(parsed: ParsedUpi, key: string): string | undefined {
  const lower = key.toLowerCase();
  const param = parsed.params.find((p) => p.key.toLowerCase() === lower);
  return param === undefined ? undefined : decodeUpiValue(param.raw);
}

export interface BuildUriOptions {
  /** Adds `mam=<am>`. Only if the Phase 0 test shows that it helps. */
  addMam?: boolean;
}

/**
 * `buildUri("upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP&mc=5651", 114000, "CP2610120042")`
 * is `upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP&mc=5651&tr=CP2610120042&am=1140.00&cu=INR`.
 */
export function buildUri(base: string, paise: number, ref: string, options: BuildUriOptions = {}): string {
  if (!Number.isInteger(paise) || paise <= 0) throw new RangeError(`Amount must be positive integer paise, got ${paise}`);
  const parsed = parseUpiUri(base);
  const amount = toUpiAmount(paise);
  const params: UpiParam[] = parsed.params.filter((p) => !OWNED_KEYS.has(p.key.toLowerCase()));
  params.push({ key: 'tr', raw: encodeURIComponent(ref) });
  params.push({ key: 'am', raw: amount });
  params.push({ key: 'cu', raw: 'INR' });
  if (options.addMam) params.push({ key: 'mam', raw: amount });
  return serializeUpi({ params });
}

/** `merchantname@okaxis` is shown as `mercha…@ok…`, enough to recognise without exposing it. */
export function maskVpa(vpa: string): string {
  const at = vpa.indexOf('@');
  const local = at === -1 ? vpa : vpa.slice(0, at);
  const handle = at === -1 ? '' : vpa.slice(at + 1);
  const keep = Math.max(1, Math.min(6, Math.ceil(local.length / 2)));
  const maskedLocal = local.length > keep ? `${local.slice(0, keep)}…` : local;
  if (at === -1) return maskedLocal;
  const maskedHandle = handle.length > 2 ? `${handle.slice(0, 2)}…` : handle;
  return `${maskedLocal}@${maskedHandle}`;
}

export interface PayeeInfo {
  vpa: string;
  maskedVpa: string;
  /** Decoded `pn`, as UPI apps show it to the customer. */
  name: string;
  mcc?: string;
  /** A signed QR may stop validating once `am` is added. Phase 0 decides what to do. */
  hasSignature: boolean;
  /** The standee QR already fixes an amount, which Counter Pay will replace. */
  hasAmount: boolean;
  /** The base link with any Counter Pay–owned parameters removed. */
  baseUri: string;
}

export function readPayee(uri: string): PayeeInfo {
  const parsed = parseUpiUri(uri);
  const vpa = getUpiParam(parsed, 'pa') ?? '';
  const mcc = getUpiParam(parsed, 'mc');
  return {
    vpa,
    maskedVpa: maskVpa(vpa),
    name: getUpiParam(parsed, 'pn') ?? '',
    ...(mcc ? { mcc } : {}),
    hasSignature: getUpiParam(parsed, 'sign') !== undefined,
    hasAmount: getUpiParam(parsed, 'am') !== undefined,
    baseUri: serializeUpi({ params: parsed.params.filter((p) => !OWNED_KEYS.has(p.key.toLowerCase())) }),
  };
}
