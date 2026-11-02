// Money as integer minor units ("cents") plus an ISO 4217 currency code.
// Floating-point money is never used: parsing and formatting are string <-> integer.

/** Currencies PayPal supports with zero decimal places. Everything else uses two. */
const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

export interface Money {
  /** Integer amount in the currency's minor unit (cents for USD). */
  readonly cents: number;
  /** ISO 4217 code, upper case. */
  readonly currency: string;
}

/** PayPal's wire format for money (`{ currency_code, value }`, value as a decimal string). */
export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export class CurrencyMismatchError extends MoneyError {
  override name = 'CurrencyMismatchError';
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`Currency mismatch: ${left} vs ${right}`);
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

export function minorUnits(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

function assertCurrency(currency: string): void {
  if (!CURRENCY_RE.test(currency)) throw new MoneyError(`Invalid currency code: "${currency}"`);
}

function assertSafe(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new MoneyError(`Amount is not a safe integer: ${cents}`);
}

export function money(cents: number, currency: string): Money {
  assertCurrency(currency);
  assertSafe(cents);
  return Object.freeze({ cents, currency });
}

export function zero(currency: string): Money {
  return money(0, currency);
}

/**
 * Parse a decimal string ("48.00", "0.1", "12") into Money.
 * Rejects more fraction digits than the currency allows instead of silently rounding.
 */
export function parseMoney(value: string, currency: string): Money {
  assertCurrency(currency);
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new MoneyError(`Invalid decimal amount: "${value}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  const digits = minorUnits(currency);
  if (fraction.length > digits) {
    throw new MoneyError(
      `Amount "${value}" has more than ${digits} decimal places for ${currency}`,
    );
  }
  const cents = Number(BigInt(whole + fraction.padEnd(digits, '0')) * (sign ? -1n : 1n));
  return money(Object.is(cents, -0) ? 0 : cents, currency);
}

/** Format as a plain decimal string ("48.00"), the form PayPal expects in `value`. */
export function formatDecimal(m: Money): string {
  const digits = minorUnits(m.currency);
  const negative = m.cents < 0;
  const abs = String(Math.abs(m.cents)).padStart(digits + 1, '0');
  const whole = digits === 0 ? abs : abs.slice(0, -digits);
  const fraction = digits === 0 ? '' : `.${abs.slice(-digits)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Human display, e.g. "$48.00" or "-€12.50". */
export function formatDisplay(m: Money, locale = 'en-US'): string {
  const digits = minorUnits(m.currency);
  // Intl takes a number; build it from the decimal string so no float arithmetic happens on cents.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(formatDecimal(m)));
}

export function toPayPalAmount(m: Money): PayPalAmount {
  return { currency_code: m.currency, value: formatDecimal(m) };
}

export function fromPayPalAmount(amount: PayPalAmount): Money {
  return parseMoney(amount.value, amount.currency_code);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.cents + b.cents, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.cents - b.cents, a.currency);
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  return a.cents < b.cents ? -1 : a.cents > b.cents ? 1 : 0;
}

export const equals = (a: Money, b: Money): boolean => compare(a, b) === 0;
export const lessThanOrEqual = (a: Money, b: Money): boolean => compare(a, b) <= 0;
export const greaterThan = (a: Money, b: Money): boolean => compare(a, b) > 0;
export const isNegative = (m: Money): boolean => m.cents < 0;
export const isZero = (m: Money): boolean => m.cents === 0;

export type Rounding = 'floor' | 'ceil' | 'half-up' | 'half-even';

/**
 * Multiply by a rational `numerator / denominator` using integer math, then round.
 * Example: 115% of an authorization is `multiplyRatio(m, 115, 100, 'floor')`.
 */
export function multiplyRatio(
  m: Money,
  numerator: number,
  denominator: number,
  rounding: Rounding = 'half-even',
): Money {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new MoneyError('Ratio must be safe integers with a positive denominator');
  }
  const product = BigInt(m.cents) * BigInt(numerator);
  const d = BigInt(denominator);
  let q = product / d; // truncates toward zero
  const r = product % d;
  if (r !== 0n) {
    const negative = product < 0n;
    const twice = (r < 0n ? -r : r) * 2n;
    const awayFromZero = (): bigint => (negative ? q - 1n : q + 1n);
    switch (rounding) {
      case 'floor':
        if (negative) q -= 1n;
        break;
      case 'ceil':
        if (!negative) q += 1n;
        break;
      case 'half-up':
        if (twice >= d) q = awayFromZero();
        break;
      case 'half-even':
        if (twice > d || (twice === d && q % 2n !== 0n)) q = awayFromZero();
        break;
    }
  }
  return money(Number(q), m.currency);
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}
