// Inputs and outputs of the policy engine. Fresh PayPal state is an INPUT: the caller re-GETs
// the target right before evaluation; the engine itself never fetches anything.
import { z } from 'zod';
import type { ActionType, ExceptionType, RiskTier } from '@vigil/core';

export const PolicyConfigSchema = z.object({
  version: z.string().min(1),
  perActionCapCents: z.number().int().positive(),
  dailyCapCents: z.number().int().positive(),
  sessionDailyCapCents: z.number().int().positive(),
  reauthorize: z.object({
    maxPercent: z.number().int().positive(),
    maxIncreaseCents: z.number().int().nonnegative(),
    honorHours: z.number().positive(),
    validityDays: z.number().positive(),
  }),
  approvalTokenTtlMinutes: z.number().positive(),
  proposalTtlMinutes: z.number().positive(),
  disabledActions: z.array(z.string()),
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export type FreshState =
  | {
      kind: 'authorization';
      id: string;
      status: string;
      amountCents: number;
      currency: string;
      capturedCents: number;
      createdAt: Date | null;
    }
  | {
      kind: 'capture';
      id: string;
      status: string;
      amountCents: number;
      currency: string;
      refundedCents: number;
      /** Open dispute on this capture (R8). */
      disputed: boolean;
    }
  | {
      kind: 'subscription';
      id: string;
      status: string;
      outstandingCents: number;
      currency: string;
    }
  | {
      kind: 'capture_for_tracking';
      captureId: string;
      orderId: string;
      captureStatus: string;
      hasTracker: boolean;
    }
  /** Internal-only actions (journal entry, dismiss) have no PayPal target. */
  | { kind: 'none' }
  /** The re-GET failed or the target no longer exists. */
  | { kind: 'unavailable'; reason: string };

export interface PolicyInput {
  exception: {
    id: string;
    type: ExceptionType;
    targetRef: string;
  };
  proposal: {
    id?: string;
    actionType: ActionType;
    targetRef: string;
    params: unknown;
    evidenceRefs: readonly string[];
  };
  fresh: FreshState;
  context: {
    now: Date;
    /** Other OPEN proposals on the same target (excluding this one). */
    otherOpenProposalsOnTarget: number;
    /** Money already executed today across the account / this judge session. */
    executedTodayCents: number;
    sessionExecutedTodayCents?: number;
    executionEnabled: boolean;
    /** Every evidence id that belongs to this exception (mirror rows, PayPal ids). */
    evidenceUniverse: readonly string[];
  };
}

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10';
export type RuleStatus = 'pass' | 'fail' | 'skip';

export interface RuleVerdict {
  id: RuleId;
  name: string;
  status: RuleStatus;
  detail: string;
}

export interface PolicyResult {
  policyVersion: string;
  verdict: 'PASS' | 'FAIL';
  tier: RiskTier;
  /** T3: the approver must type this exact amount. */
  requiresTypedAmount: boolean;
  amountCents: number | null;
  currency: string | null;
  rules: RuleVerdict[];
  evaluatedAt: string;
}
