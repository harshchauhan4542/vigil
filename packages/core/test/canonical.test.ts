import { describe, expect, it } from 'vitest';
import { CanonicalJsonError, canonicalJson, paramsHash, sha256Hex } from '../src/canonical.js';

describe('canonicalJson / paramsHash', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('gives the same hash regardless of key order', () => {
    const a = { authorization_id: 'AUTH1', amount: { value: '48.00', currency_code: 'USD' } };
    const b = { amount: { currency_code: 'USD', value: '48.00' }, authorization_id: 'AUTH1' };
    expect(paramsHash(a)).toBe(paramsHash(b));
    expect(paramsHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when any value changes', () => {
    const a = { amount: { currency_code: 'USD', value: '48.00' } };
    const b = { amount: { currency_code: 'USD', value: '48.01' } };
    expect(paramsHash(a)).not.toBe(paramsHash(b));
  });

  it('keeps array order significant', () => {
    expect(paramsHash([1, 2])).not.toBe(paramsHash([2, 1]));
  });

  it('rejects values that have no stable JSON form', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ a: 1n })).toThrow(CanonicalJsonError);
    expect(() => canonicalJson(undefined)).toThrow(CanonicalJsonError);
  });

  it('serialises dates via toJSON', () => {
    expect(canonicalJson({ t: new Date('2026-11-02T00:00:00Z') })).toBe(
      '{"t":"2026-11-02T00:00:00.000Z"}',
    );
  });

  it('hashes known input', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
