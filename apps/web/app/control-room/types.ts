export interface QueueRow {
  id: string;
  type: string;
  targetRef: string;
  amountAtRiskCents: number | null;
  currency: string | null;
  severity: number;
  score: number;
  deadlineAt: string | null;
  detectedAt: string | null;
  resolvedAt: string | null;
  status: string;
  latestProposal: {
    id: string;
    actionType: string;
    status: string;
    riskTier: number | null;
    amountCents: number | null;
    currency: string | null;
  } | null;
}

export interface RuleVerdict {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

export interface ProposalDetail {
  proposal: {
    id: string;
    actionType: string;
    targetRef: string;
    params: Record<string, unknown>;
    rationale: string;
    evidenceRefs: string[];
    confidence: number;
    status: string;
    riskTier: number | null;
    amountCents: number | null;
    currency: string | null;
    expiresAt: string | null;
    policyResult: {
      verdict: string;
      tier: number;
      requiresTypedAmount: boolean;
      rules: RuleVerdict[];
    } | null;
  };
  exception: { id: string; type: string; evidence: Record<string, unknown>; status: string } | null;
  executions: {
    attempt: number;
    httpStatus: number | null;
    paypalStatus: string | null;
    paypalRequestId: string | null;
    debugId: string | null;
    startedAt: string;
  }[];
  approval: { decision: string; approver: string; decided_at: string } | null;
}
