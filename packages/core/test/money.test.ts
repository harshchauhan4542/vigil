import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  MoneyError,
  add,
  compare,
  formatDecimal,
  formatDisplay,
  fromPayPalAmount,
  money,
  multiplyRatio,
  parseMoney,
  subtract,
  sum,
  toPayPalAmount,
} from '../src/money.js';

const usd = (v: string) => parseMoney(v, 'USD');

describe('money', () => {
  it('adds "0.10" + "0.20" exactly to "0.30"', () => {
    expect(formatDecimal(add(usd('0.10'), usd('0.20')))).toBe('0.30');
    expect(add(usd('0.10'), usd('0.20')).cents).toBe(30);
  });

  it('parses decimal strings into integer cents', () => {
    expect(usd('48.00').cents).toBe(4800);
    expect(usd('48').cents).toBe(4800);
    expect(usd('0.1').cents).toBe(10);
    expect(usd('-12.50').cents).toBe(-1250);
    expect(Object.is(usd('-0.00').cents, 0)).toBe(true);
  });

  it('rejects malformed amounts and extra precision instead of rounding', () => {
    for (const bad of ['', 'abc', '1.2.3', '1e3', '.5', '1,000.00', 'NaN']) {
      expect(() => usd(bad)).toThrow(MoneyError);
    }
    expect(() => usd('0.001')).toThrow(/decimal places/);
    expect(() => parseMoney('10.5', 'JPY')).toThrow(/decimal places/);
    expect(() => parseMoney('1.00', 'usd')).toThrow(/currency/);
  });

  it('handles zero-decimal currencies', () => {
    const yen = parseMoney('1500', 'JPY');
    expect(yen.cents).toBe(1500);
    expect(formatDecimal(yen)).toBe('1500');
  });

  it('formats for PayPal and for display', () => {
    expect(formatDecimal(money(5, 'USD'))).toBe('0.05');
    expect(formatDecimal(money(-5, 'USD'))).toBe('-0.05');
    expect(toPayPalAmount(usd('48.00'))).toEqual({ currency_code: 'USD', value: '48.00' });
    expect(fromPayPalAmount({ currency_code: 'USD', value: '12.34' }).cents).toBe(1234);
    expect(formatDisplay(usd('1234.5'))).toBe('$1,234.50');
  });

  it('throws on currency mismatch', () => {
    const eur = parseMoney('1.00', 'EUR');
    expect(() => add(usd('1.00'), eur)).toThrow(CurrencyMismatchError);
    expect(() => subtract(usd('1.00'), eur)).toThrow(CurrencyMismatchError);
    expect(() => compare(usd('1.00'), eur)).toThrow(CurrencyMismatchError);
    expect(() => sum([usd('1.00'), eur], 'USD')).toThrow(CurrencyMismatchError);
  });

  it('rejects non-integer or unsafe cents', () => {
    expect(() => money(1.5, 'USD')).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(MoneyError);
  });

  it('multiplies by ratios with explicit rounding', () => {
    // 115% of $33.33 = $38.3295
    const m = usd('33.33');
    expect(multiplyRatio(m, 115, 100, 'floor').cents).toBe(3832);
    expect(multiplyRatio(m, 115, 100, 'ceil').cents).toBe(3833);
    expect(multiplyRatio(m, 115, 100, 'half-up').cents).toBe(3833);
    // exact halves: 25 cents / 2 = 12.5 cents
    expect(multiplyRatio(usd('0.25'), 1, 2, 'half-even').cents).toBe(12);
    expect(multiplyRatio(usd('0.35'), 1, 2, 'half-even').cents).toBe(18);
    expect(multiplyRatio(usd('0.25'), 1, 2, 'half-up').cents).toBe(13);
    expect(multiplyRatio(usd('-0.25'), 1, 2, 'half-up').cents).toBe(-13);
    expect(multiplyRatio(usd('-0.25'), 1, 2, 'floor').cents).toBe(-13);
    expect(multiplyRatio(usd('-0.25'), 1, 2, 'ceil').cents).toBe(-12);
    expect(() => multiplyRatio(m, 1, 0)).toThrow(MoneyError);
  });

  it('sums lists', () => {
    expect(sum([usd('0.10'), usd('0.20'), usd('0.30')], 'USD').cents).toBe(60);
    expect(sum([], 'USD').cents).toBe(0);
  });
});
