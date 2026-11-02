// Approval tokens: HMAC(secret, proposal_id ‖ params_hash ‖ expires_at), single use, 15-min TTL.
// The token binds a human approval to the exact parameters that were shown. Single use is
// enforced by the database (approvals.token_used_at), keyed by sha256(token).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { formatDecimal, money, sha256Hex } from '@vigil/core';

const VERSION = 'v1';

export interface TokenClaims {
  proposalId: string;
  paramsHash: string;
  expiresAt: Date;
}

function sign(secret: string, c: { proposalId: string; paramsHash: string; expiresAtMs: number }) {
  return createHmac('sha256', secret)
    .update(`${VERSION}|${c.proposalId}|${c.paramsHash}|${c.expiresAtMs}`)
    .digest('base64url');
}

function assertSecret(secret: string) {
  if (secret.length < 32) throw new Error('APPROVAL_HMAC_SECRET must be at least 32 characters');
}

export function mintApprovalToken(
  secret: string,
  claims: TokenClaims,
): { token: string; tokenHash: string } {
  assertSecret(secret);
  const expiresAtMs = claims.expiresAt.getTime();
  const sig = sign(secret, {
    proposalId: claims.proposalId,
    paramsHash: claims.paramsHash,
    expiresAtMs,
  });
  const token = [VERSION, claims.proposalId, claims.paramsHash, expiresAtMs, sig].join('.');
  return { token, tokenHash: tokenHash(token) };
}

export const tokenHash = (token: string) => sha256Hex(token);

export type TokenCheck =
  | { ok: true; claims: TokenClaims }
  | {
      ok: false;
      reason: 'malformed' | 'bad_signature' | 'expired' | 'proposal_mismatch' | 'params_mismatch';
    };

/**
 * Verify signature, expiry and binding. `expected.paramsHash` must be recomputed from the
 * proposal's stored params, so any change to the params after approval invalidates the token.
 */
export function verifyApprovalToken(
  secret: string,
  token: string,
  expected: { proposalId: string; paramsHash: string; now: Date },
): TokenCheck {
  assertSecret(secret);
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const [, proposalId, paramsHash, expiresRaw, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAtMs) || !/^[0-9a-f]{64}$/.test(paramsHash))
    return { ok: false, reason: 'malformed' };

  const want = Buffer.from(sign(secret, { proposalId, paramsHash, expiresAtMs }));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got))
    return { ok: false, reason: 'bad_signature' };
  if (proposalId !== expected.proposalId) return { ok: false, reason: 'proposal_mismatch' };
  if (paramsHash !== expected.paramsHash) return { ok: false, reason: 'params_mismatch' };
  if (expected.now.getTime() >= expiresAtMs) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { proposalId, paramsHash, expiresAt: new Date(expiresAtMs) } };
}

/**
 * T3 confirmation: the approver must type the exact amount, e.g. "612.00" (a leading "$" and
 * surrounding spaces are tolerated; "612" or "612.0" are not).
 */
export function checkTypedAmount(
  typed: string | null | undefined,
  amountCents: number,
  currency: string,
): boolean {
  if (!typed) return false;
  const normalized = typed.trim().replace(/^\$/, '');
  return normalized === formatDecimal(money(Math.abs(amountCents), currency));
}
