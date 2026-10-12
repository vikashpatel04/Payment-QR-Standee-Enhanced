import { describe, expect, it } from 'vitest';
import { buildUri, maskVpa, parseUpiUri, readPayee, UpiError } from '../src/upi';

// Placeholders only: the repo never holds a real UPI ID or shop name.
const BASE = 'upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME&mc=5651';

describe('buildUri (spec test vectors)', () => {
  it('keeps the standee parameters and adds tr, am and cu', () => {
    expect(buildUri(BASE, 114000, 'CP2610120042')).toBe(
      'upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME&mc=5651&tr=CP2610120042&am=1140.00&cu=INR',
    );
  });

  it('adds mam only when asked', () => {
    expect(buildUri(BASE, 114000, 'CP2610120042', { addMam: true })).toBe(
      'upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME&mc=5651&tr=CP2610120042&am=1140.00&cu=INR&mam=1140.00',
    );
  });

  it('replaces am and tr already in the base, never duplicating them', () => {
    const uri = buildUri(`${BASE}&am=1.00&tr=OLD123&cu=INR`, 114000, 'CP2610120042');
    expect(uri).toBe('upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME&mc=5651&tr=CP2610120042&am=1140.00&cu=INR');
    expect(uri.match(/[?&]am=/g)).toHaveLength(1);
    expect(uri.match(/[?&]tr=/g)).toHaveLength(1);
  });
});

describe('buildUri details', () => {
  it('keeps unknown parameters byte-for-byte, in order', () => {
    const base = 'upi://pay?pa=shop@okaxis&pn=A%26B&mode=02&purpose=00&orgid=000000&mc=5651';
    expect(buildUri(base, 5000, 'CP2610120001')).toBe(
      'upi://pay?pa=shop@okaxis&pn=A%26B&mode=02&purpose=00&orgid=000000&mc=5651&tr=CP2610120001&am=50.00&cu=INR',
    );
  });

  it('accepts an upper-case scheme from the standee and normalises it', () => {
    expect(buildUri('UPI://PAY?pa=shop@okaxis', 100, 'CP2610120001')).toBe(
      'upi://pay?pa=shop@okaxis&tr=CP2610120001&am=1.00&cu=INR',
    );
  });

  it('refuses a zero or fractional amount', () => {
    expect(() => buildUri(BASE, 0, 'CP2610120001')).toThrow(RangeError);
    expect(() => buildUri(BASE, 10.5, 'CP2610120001')).toThrow(RangeError);
  });
});

describe('parseUpiUri', () => {
  it('rejects text that is not a UPI payment link', () => {
    expect(() => parseUpiUri('https://example.com')).toThrow(UpiError);
    try {
      parseUpiUri('https://example.com');
    } catch (error) {
      expect((error as UpiError).issue).toBe('notUpi');
    }
  });

  it('rejects a link with no payee', () => {
    expect(() => parseUpiUri('upi://pay?pn=Someone')).toThrowError(expect.objectContaining({ issue: 'noPayee' }));
  });

  it('skips empty segments', () => {
    expect(parseUpiUri('upi://pay?pa=shop@okaxis&&pn=X&').params).toEqual([
      { key: 'pa', raw: 'shop@okaxis' },
      { key: 'pn', raw: 'X' },
    ]);
  });
});

describe('readPayee', () => {
  it('decodes the name, masks the UPI ID and flags signed QRs', () => {
    const payee = readPayee(`${BASE}&am=10.00&sign=abc123`);
    expect(payee).toEqual({
      vpa: 'shop@okaxis',
      maskedVpa: 'sh…@ok…',
      name: 'YOUR SHOP NAME',
      mcc: '5651',
      hasSignature: true,
      hasAmount: true,
      baseUri: 'upi://pay?pa=shop@okaxis&pn=YOUR%20SHOP%20NAME&mc=5651&sign=abc123',
    });
  });

  it('treats + in the name as a space', () => {
    expect(readPayee('upi://pay?pa=x@ybl&pn=MY+SHOP').name).toBe('MY SHOP');
  });
});

describe('maskVpa', () => {
  it.each([
    ['merchantname@okaxis', 'mercha…@ok…'],
    ['shop@okaxis', 'sh…@ok…'],
    ['a@ybl', 'a@yb…'],
    ['9876543210@ybl', '98765…@yb…'],
    ['merchant@ok', 'merc…@ok'],
  ])('masks %s as %s', (vpa, expected) => {
    expect(maskVpa(vpa)).toBe(expected);
  });
});
