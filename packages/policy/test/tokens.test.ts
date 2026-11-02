import { describe, expect, it } from 'vitest';
import {
  checkTypedAmount,
  mintApprovalToken,
  tokenHash,
  verifyApprovalToken,
} from '../src/tokens.js';

const SECRET = 's'.repeat(40);
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-11-05T12:00:00Z');
const in15 = new Date(NOW.getTime() + 15 * 60_000);

describe('approval tokens', () => {
  const { token, tokenHash: th } = mintApprovalToken(SECRET, {
    proposalId: 'p-1',
    paramsHash: HASH,
    expiresAt: in15,
  });

  it('round-trips and exposes a stable hash for single-use tracking', () => {
    expect(
      verifyApprovalToken(SECRET, token, { proposalId: 'p-1', paramsHash: HASH, now: NOW }),
    ).toMatchObject({ ok: true });
    expect(th).toBe(tokenHash(token));
    expect(th).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an expired token', () => {
    const later = new Date(in15.getTime());
    expect(
      verifyApprovalToken(SECRET, token, { proposalId: 'p-1', paramsHash: HASH, now: later }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token used with changed params', () => {
    expect(
      verifyApprovalToken(SECRET, token, {
        proposalId: 'p-1',
        paramsHash: 'b'.repeat(64),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'params_mismatch' });
  });

  it('rejects a token for another proposal', () => {
    expect(
      verifyApprovalToken(SECRET, token, { proposalId: 'p-2', paramsHash: HASH, now: NOW }),
    ).toEqual({ ok: false, reason: 'proposal_mismatch' });
  });

  it('rejects tampering and a wrong secret', () => {
    const parts = token.split('.');
    const forged = [parts[0], parts[1], 'b'.repeat(64), parts[3], parts[4]].join('.');
    expect(
      verifyApprovalToken(SECRET, forged, {
        proposalId: 'p-1',
        paramsHash: 'b'.repeat(64),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    const extended = [
      parts[0],
      parts[1],
      parts[2],
      String(in15.getTime() + 3_600_000),
      parts[4],
    ].join('.');
    expect(
      verifyApprovalToken(SECRET, extended, { proposalId: 'p-1', paramsHash: HASH, now: NOW }).ok,
    ).toBe(false);
    expect(
      verifyApprovalToken('x'.repeat(40), token, { proposalId: 'p-1', paramsHash: HASH, now: NOW }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects malformed tokens', () => {
    for (const t of ['', 'v1.a.b', 'v2.p-1.' + HASH + '.1.x', 'v1.p-1.nothex.1.x']) {
      expect(
        verifyApprovalToken(SECRET, t, { proposalId: 'p-1', paramsHash: HASH, now: NOW }),
      ).toMatchObject({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses a short secret', () => {
    expect(() =>
      mintApprovalToken('short', { proposalId: 'p', paramsHash: HASH, expiresAt: in15 }),
    ).toThrow(/32/);
  });
});

describe('T3 typed amount', () => {
  it.each([
    ['612.00', true],
    [' $612.00 ', true],
    ['612', false],
    ['612.0', false],
    ['611.99', false],
    ['', false],
    [null, false],
  ])('%j → %s', (typed, ok) => {
    expect(checkTypedAmount(typed, 61200, 'USD')).toBe(ok);
  });
});
