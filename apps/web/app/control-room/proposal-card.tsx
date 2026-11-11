'use client';
// W3 Proposal Card, written for merchants: what the fix does, why the AI suggests it, whether
// the safety rules passed, and one clear Approve / Say no. IDs, JSON and PayPal request ids sit
// under "Technical details".
import { useEffect, useState } from 'react';
import {
  ACTION_EXPLAIN,
  REFUSAL,
  RULE,
  TIER,
  actionLabel,
  money,
  proposalStatus,
} from '../ui/labels';
import { Pill } from '../ui/pill';
import type { ProposalDetail } from './types';

// PayPal-Mock-Response works only on Orders v2 / Payments v2 (docs/negative-testing.md).
const MOCKABLE = new Set(['capture_authorization', 'void_authorization', 'refund']);
const MOCK_OPTIONS: [string, string][] = [
  ['AUTHORIZATION_EXPIRED', 'The hold already expired'],
  ['MAX_CAPTURE_AMOUNT_EXCEEDED', 'Amount is too high'],
  ['PREVIOUSLY_CAPTURED', 'Already collected'],
  ['AUTHORIZATION_VOIDED', 'Hold was already released'],
  ['REFUND_AMOUNT_EXCEEDED', 'Refund is too large'],
  ['TRANSACTION_DISPUTED', 'Buyer opened a dispute'],
  ['INTERNAL_SERVER_ERROR', 'PayPal is having problems'],
];

/** What a decided proposal means, in words. */
const AFTER: Record<string, { text: string; tone: string }> = {
  POLICY_REJECTED: {
    text: "Vigil's safety rules stopped this fix, so it can't be approved and nothing was sent to PayPal. Please look at this payment yourself.",
    tone: 'risk',
  },
  REJECTED: { text: 'You said no to this fix. Nothing was sent to PayPal.', tone: '' },
  EXPIRED: { text: 'Nobody approved this fix in time, so it expired.', tone: '' },
  APPROVED: { text: 'Approved. Vigil is sending it to PayPal.', tone: 'ok' },
  QUEUED: { text: 'Approved. Vigil is sending it to PayPal.', tone: 'ok' },
  EXECUTING: { text: 'PayPal is working on it now.', tone: 'ok' },
  SUCCEEDED: {
    text: 'Done. PayPal made the change and Vigil is waiting for its final confirmation.',
    tone: 'ok',
  },
  SETTLED: { text: 'Done. PayPal confirmed the change.', tone: 'ok' },
  FAILED_RETRYABLE: {
    text: 'PayPal had a short problem. Vigil will try again by itself.',
    tone: 'wait',
  },
  FAILED_FINAL: {
    text: 'PayPal said no to this change, so no money moved. You may need to handle this payment in PayPal yourself.',
    tone: 'risk',
  },
  NEEDS_RECONCILE: { text: 'Vigil is double-checking with PayPal what happened.', tone: 'wait' },
};

export function ProposalCard({
  proposalId,
  onChanged,
}: {
  proposalId: string;
  onChanged: () => void;
}) {
  const [d, setD] = useState<ProposalDetail | null>(null);
  const [typed, setTyped] = useState('');
  const [mock, setMock] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/proposals/${proposalId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => alive && setD(j as ProposalDetail));
    return () => {
      alive = false;
    };
  }, [proposalId]);

  if (!d) return <p className="muted">Loading…</p>;
  const p = d.proposal;
  const policy = p.policyResult;
  const pending = p.status === 'PENDING_APPROVAL';
  const [statusLabel, statusTone] = proposalStatus(p.status);
  const failedRules = policy?.rules.filter((r) => r.status === 'fail') ?? [];
  const passed = policy?.rules.filter((r) => r.status === 'pass').length ?? 0;
  const after = AFTER[p.status];
  const amountText = ((p.amountCents ?? 0) / 100).toFixed(2);

  async function decide(kind: 'approve' | 'reject') {
    setBusy(true);
    setMessage(null);
    const r = await fetch(`/api/proposals/${proposalId}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        kind === 'approve'
          ? { typed_amount: typed || undefined, mock_code: mock || undefined }
          : { reason: 'Rejected in control room' },
      ),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string; status?: string };
    setMessage(
      j.ok
        ? kind === 'approve'
          ? { text: 'Approved. Vigil is sending it to PayPal now.', tone: 'ok' }
          : { text: 'Got it. Nothing was sent to PayPal.', tone: '' }
        : {
            text: `Not approved yet. ${REFUSAL[j.error ?? ''] ?? `Something went wrong (${j.error}).`}`,
            tone: 'risk',
          },
    );
    setBusy(false);
    onChanged();
  }

  return (
    <div>
      <div className="card-top">
        <div>
          <p className="muted" style={{ margin: '0 0 2px', fontSize: 14 }}>
            Suggested fix
          </p>
          <h2 className="card-title">{actionLabel(p.actionType)}</h2>
        </div>
        {p.amountCents !== null && (
          <div className="card-amount">{money(p.amountCents, p.currency)}</div>
        )}
      </div>
      <div className="row card-meta">
        <Pill label={statusLabel} tone={statusTone} code={p.status} />
        {p.riskTier !== null && p.riskTier >= 2 && <span className="chip">{TIER[p.riskTier]}</span>}
      </div>
      {ACTION_EXPLAIN[p.actionType] && (
        <p style={{ margin: '10px 0 0' }}>{ACTION_EXPLAIN[p.actionType]}</p>
      )}

      <div className="card-section">
        <h3>
          Why the AI suggests this
          <span className="muted">{Math.round(p.confidence * 100)}% sure</span>
        </h3>
        <div className="confidence" aria-hidden="true">
          <span style={{ width: `${Math.round(p.confidence * 100)}%` }} />
        </div>
        <p>{p.rationale}</p>
      </div>

      <div className="card-section">
        <h3>
          {policy
            ? failedRules.length
              ? `${failedRules.length} safety ${failedRules.length === 1 ? 'check' : 'checks'} failed`
              : `All ${passed} safety checks passed`
            : 'Safety checks not run yet'}
          <span className={failedRules.length ? 'fail' : 'pass'} aria-hidden="true">
            {policy ? (failedRules.length ? '✗' : '✓') : ''}
          </span>
        </h3>
        {failedRules.length > 0 && (
          <ul className="checklist">
            {failedRules.map((r) => (
              <li key={r.id}>
                <span className="fail">✗</span>
                <span>{RULE[r.id] ?? r.name}</span>
                <span className="muted">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {policy && (
          <details>
            <summary>See every check</summary>
            <ul className="checklist">
              {policy.rules.map((r) => (
                <li key={r.id}>
                  <span className={r.status} aria-label={r.status}>
                    {r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'}
                  </span>
                  <span title={`${r.id} ${r.name}`}>{RULE[r.id] ?? r.name}</span>
                  <span className="muted">{r.detail}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {pending ? (
        <div className="decide">
          {policy?.requiresTypedAmount && (
            <label>
              <span>
                This is a large amount, above your limit. To be safe, type{' '}
                <strong>{amountText}</strong> below.
              </span>
              <input
                aria-label="Type the exact amount to approve"
                inputMode="decimal"
                placeholder={amountText}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
          )}
          <div className="buttons">
            <button className="primary" disabled={busy} onClick={() => decide('approve')}>
              Approve
            </button>
            <button className="danger" disabled={busy} onClick={() => decide('reject')}>
              Say no
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Nothing happens at PayPal until you press Approve.
          </p>
        </div>
      ) : (
        after && !message && <p className={`callout ${after.tone}`}>{after.text}</p>
      )}
      {message && (
        <p className={`callout ${message.tone}`} role="status">
          {message.text}
        </p>
      )}

      <details className="tech">
        <summary>Technical details</summary>
        <dl className="creds" style={{ marginTop: 10 }}>
          <dt>PayPal reference</dt>
          <dd>{p.targetRef}</dd>
          <dt>Action</dt>
          <dd>{p.actionType}</dd>
          <dt>Status</dt>
          <dd>{p.status}</dd>
          {p.riskTier !== null && (
            <>
              <dt>Risk tier</dt>
              <dd>T{p.riskTier}</dd>
            </>
          )}
          <dt>Evidence</dt>
          <dd>
            {p.evidenceRefs.map((e) => (
              <span key={e} className="chip mono" style={{ marginRight: 4 }}>
                {e}
              </span>
            ))}
          </dd>
        </dl>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          Exact request for PayPal (locked to your approval):
        </p>
        <pre className="mono">{JSON.stringify(p.params, null, 2)}</pre>
        {d.executions.length > 0 && (
          <ol className="trail" style={{ marginTop: 10 }}>
            {d.executions.map((x) => (
              <li key={x.attempt}>
                <strong>
                  Attempt {x.attempt}: HTTP {x.httpStatus ?? '…'} {x.paypalStatus ?? ''}
                </strong>
                <span className="meta mono">
                  PayPal-Request-Id {x.paypalRequestId ?? 'n/a'}
                  {x.debugId ? `, debug_id ${x.debugId}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
        {pending && MOCKABLE.has(p.actionType) && (
          <label
            className="mock"
            title="Sends PayPal-Mock-Response on this Orders v2 / Payments v2 call"
          >
            Simulate PayPal failure (testing only)
            <select value={mock} onChange={(e) => setMock(e.target.value)}>
              <option value="">No, make the real call</option>
              {MOCK_OPTIONS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label} ({code})
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
    </div>
  );
}
