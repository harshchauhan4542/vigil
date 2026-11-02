'use client';
// W3 Proposal Card: the action and its parameters, the policy checklist, the agent's reasoning
// with evidence ids, the settlement trail, and Approve / Reject (typed amount for T3).
import { useEffect, useState } from 'react';
import type { ProposalDetail } from './types';

const fmt = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? ''
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

export function ProposalCard({
  proposalId,
  onChanged,
}: {
  proposalId: string;
  onChanged: () => void;
}) {
  const [d, setD] = useState<ProposalDetail | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  async function decide(kind: 'approve' | 'reject') {
    setBusy(true);
    setMessage(null);
    const r = await fetch(`/api/proposals/${proposalId}/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        kind === 'approve'
          ? { typed_amount: typed || undefined }
          : { reason: 'Rejected in control room' },
      ),
    });
    const j = (await r.json()) as { ok?: boolean; error?: string; status?: string };
    setMessage(
      j.ok ? `${kind === 'approve' ? 'Approved' : 'Rejected'}: ${j.status}` : `Refused: ${j.error}`,
    );
    setBusy(false);
    onChanged();
  }

  return (
    <div>
      <div className="row">
        <strong>{p.actionType.replaceAll('_', ' ')}</strong>
        <span className="chip">{p.status}</span>
        {p.riskTier !== null && <span className="chip">T{p.riskTier}</span>}
        <span>{fmt(p.amountCents, p.currency)}</span>
      </div>
      <p className="mono muted">{p.targetRef}</p>
      <details open>
        <summary>Parameters (bound to the approval by hash)</summary>
        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(p.params, null, 2)}
        </pre>
      </details>

      <h3 style={{ fontSize: 13, marginBottom: 0 }}>
        Policy {policy ? `· ${policy.verdict}` : ''}
      </h3>
      <ul className="checklist">
        {policy?.rules.map((r) => (
          <li key={r.id}>
            <span className={r.status}>
              {r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '–'}
            </span>
            <span>
              {r.id} {r.name}
            </span>
            <span className="muted">{r.detail}</span>
          </li>
        ))}
      </ul>

      <h3 style={{ fontSize: 13, marginBottom: 4 }}>
        Agent reasoning (confidence {Math.round(p.confidence * 100)}%)
      </h3>
      <p style={{ marginTop: 0 }}>{p.rationale}</p>
      <div className="row">
        {p.evidenceRefs.map((e) => (
          <span
            key={e}
            className="chip mono"
            title="Evidence id cited by the agent; policy R7 checked it belongs to this exception"
          >
            {e}
          </span>
        ))}
      </div>

      {d.executions.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, marginBottom: 0 }}>Settlement trail</h3>
          <ul className="trail">
            {d.approval && (
              <li>
                {d.approval.decision} by {d.approval.approver}
              </li>
            )}
            {d.executions.map((x) => (
              <li key={x.attempt} className="mono">
                attempt {x.attempt}: HTTP {x.httpStatus ?? '…'} {x.paypalStatus ?? ''} ·
                PayPal-Request-Id {x.paypalRequestId ?? 'n/a'}
                {x.debugId ? ` · debug_id ${x.debugId}` : ''}
              </li>
            ))}
            <li>Proposal {p.status}</li>
          </ul>
        </>
      )}

      {pending && (
        <div className="row" style={{ marginTop: 10 }}>
          {policy?.requiresTypedAmount && (
            <input
              aria-label="Type the exact amount to approve"
              placeholder={`Type ${((p.amountCents ?? 0) / 100).toFixed(2)} to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          )}
          <button className="primary" disabled={busy} onClick={() => decide('approve')}>
            Approve
          </button>
          <button className="danger" disabled={busy} onClick={() => decide('reject')}>
            Reject
          </button>
        </div>
      )}
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
