import { describe, expect, it } from 'vitest';
import { applyAmountKey, formatINR, formatTyping, parseAmount, toAmountInput, toUpiAmount } from '../src/amount';

describe('parseAmount (spec test vectors)', () => {
  it('reads whole rupees as paise', () => {
    expect(parseAmount('1140')).toEqual({ ok: true, paise: 114000 });
  });

  it('ignores leading zeros', () => {
    expect(parseAmount('01140')).toEqual({ ok: true, paise: 114000 });
  });

  it('reads one decimal digit as tens of paise', () => {
    expect(parseAmount('1140.5')).toEqual({ ok: true, paise: 114050 });
  });

  it('rejects zero with "Enter an amount"', () => {
    expect(parseAmount('0')).toEqual({ ok: false, error: 'enterAmount' });
  });

  it('rejects more than the maximum', () => {
    expect(parseAmount('100001', 100000)).toEqual({ ok: false, error: 'max', maxPaise: 10000000 });
  });
});

describe('parseAmount edge cases', () => {
  it.each(['', '   ', '.', '0.', '0.00', '00'])('treats %j as no amount', (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: 'enterAmount' });
  });

  it.each(['abc', '1,140', '11.405', '1.2.3', '-5', '1e3'])('rejects %j as badly formed', (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, error: 'format' });
  });

  it('accepts exactly the maximum', () => {
    expect(parseAmount('100000', 100000)).toEqual({ ok: true, paise: 10000000 });
    expect(parseAmount('100000.01', 100000)).toMatchObject({ ok: false, error: 'max' });
  });

  it('accepts paise-only amounts', () => {
    expect(parseAmount('.5')).toEqual({ ok: true, paise: 50 });
    expect(parseAmount('0.01')).toEqual({ ok: true, paise: 1 });
  });

  it('reports absurdly long input as over the maximum, not as a float', () => {
    expect(parseAmount('99999999999999999999')).toMatchObject({ ok: false, error: 'max' });
  });
});

describe('applyAmountKey', () => {
  const type = (keys: string[]) => keys.reduce(applyAmountKey, '');

  it('builds the amount from digits', () => {
    expect(type(['1', '1', '4', '0'])).toBe('1140');
  });

  it('ignores a third decimal digit (spec test vector)', () => {
    expect(type(['1', '.', '2', '5', '9'])).toBe('1.25');
  });

  it('allows only one decimal point', () => {
    expect(type(['1', '.', '.', '5'])).toBe('1.5');
  });

  it('starts a bare point as 0.', () => {
    expect(type(['.', '5'])).toBe('0.5');
  });

  it('replaces a lone leading zero', () => {
    expect(type(['0', '7'])).toBe('7');
  });

  it('ignores letters and other keys', () => {
    expect(type(['1', 'a', '-', ' ', '2'])).toBe('12');
  });

  it('deletes with Backspace', () => {
    expect(type(['1', '2', 'Backspace'])).toBe('1');
    expect(applyAmountKey('', 'Backspace')).toBe('');
  });

  it('caps the whole-rupee digits', () => {
    expect(type(Array.from({ length: 12 }, () => '9'))).toBe('999999999');
  });
});

describe('formatINR', () => {
  it('groups the Indian way (spec test vector)', () => {
    expect(formatINR(11400000)).toBe('₹1,14,000');
  });

  it.each([
    [0, '₹0'],
    [100, '₹1'],
    [99900, '₹999'],
    [114000, '₹1,140'],
    [10000000, '₹1,00,000'],
    [1000000000, '₹1,00,00,000'],
    [114050, '₹1,140.50'],
    [5, '₹0.05'],
  ])('formats %i paise as %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it('can leave out the symbol', () => {
    expect(formatINR(114000, { symbol: false })).toBe('1,140');
  });
});

describe('formatTyping', () => {
  it.each([
    ['', ''],
    ['1140', '₹1,140'],
    ['1140.', '₹1,140.'],
    ['1140.5', '₹1,140.5'],
    ['0.', '₹0.'],
    ['114000', '₹1,14,000'],
  ])('shows %j as %j', (raw, expected) => {
    expect(formatTyping(raw)).toBe(expected);
  });
});

describe('toUpiAmount', () => {
  it('always has two decimals and no grouping', () => {
    expect(toUpiAmount(114000)).toBe('1140.00');
    expect(toUpiAmount(114050)).toBe('1140.50');
    expect(toUpiAmount(1)).toBe('0.01');
    expect(toUpiAmount(10000000)).toBe('100000.00');
  });
});

describe('toAmountInput', () => {
  it('round-trips through parseAmount', () => {
    for (const paise of [100, 114000, 114050, 114055, 1, 10]) {
      expect(parseAmount(toAmountInput(paise))).toEqual({ ok: true, paise });
    }
  });

  it('drops a trailing zero in the paise', () => {
    expect(toAmountInput(114050)).toBe('1140.5');
    expect(toAmountInput(114000)).toBe('1140');
  });
});
