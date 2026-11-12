'use client';
// W1 Money-at-Risk, W2 Deadline strip (next 72 hours), W4 Settlement Trail.
import { useEffect, useState } from 'react';
import { ACTOR, money, problemLabel } from '../ui/labels';
import type { QueueRow } from './types';

interface Stats {
  atRisk: { currency: string; cents: number; count: number }[];
  recovered: { currency: string; cents: number; count: number }[];
}

const sum = (rows: Stats['atRisk'] | undefined) =>
  rows?.length ? rows.map((r) => money(r.cents, r.currency)).join(' + ') : '$0.00';

export function MoneyAtRisk({ version }: { version: number }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, [version]);
  const open = s?.atRisk.reduce((n, r) => n + r.count, 0) ?? 0;
  const fixed = s?.recovered.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <>
      <div>
        <div className="figure-label">Money at risk</div>
        <div className="figure risk">{sum(s?.atRisk)}</div>
        <div className="figure-sub">
          across {open} open {open === 1 ? 'problem' : 'problems'}
        </div>
      </div>
      <div>
        <div className="figure-label">Recovered this week</div>
        <div className="figure saved">{sum(s?.recovered)}</div>
        <div className="figure-sub">
          {fixed} {fixed === 1 ? 'fix' : 'fixes'} completed
        </div>
      </div>
    </>
  );
}

const HORIZON_H = 72;

/** Every open deadline on one 72-hour line, so the most urgent problem is obvious at a glance. */
export function DeadlineStrip({
  rows,
  now,
  selected,
  onSelect,
}: {
  rows: QueueRow[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const marks = rows
    .filter((r) => r.deadlineAt && !['RESOLVED', 'DISMISSED'].includes(r.status))
    .map((r) => ({ ...r, h: (Date.parse(r.deadlineAt!) - now) / 3_600_000 }))
    .sort((a, b) => a.h - b.h);

  // Stack marks into lanes so nearby labels never overlap.
  const laneEnd: number[] = [];
  const placed = marks.map((m) => {
    const pos = Math.min(Math.max(m.h, 0), HORIZON_H) / HORIZON_H;
    let lane = laneEnd.findIndex((end) => pos > end);
    if (lane === -1) lane = Math.min(laneEnd.length, 2);
    laneEnd[lane] = pos + 0.22;
    return { ...m, pos, lane };
  });

  return (
    <div className="strip-wrap">
      <div className="strip-title">
        <span>Deadlines in the next 72 hours</span>
        <span>{marks.filter((m) => m.h <= 12).length} due within 12h</span>
      </div>
      {marks.length === 0 ? (
        <p className="strip-empty">Nothing is on the clock. New deadlines show up here.</p>
      ) : (
        <div className="strip">
          <div className="strip-axis" />
          {[0, 12, 24, 48, 72].map((t) => (
            <span key={t} className="strip-tick" style={{ left: `${(t / HORIZON_H) * 100}%` }}>
              {t === 0 ? 'now' : `${t}h`}
            </span>
          ))}
          {placed.map((m) => {
            const cls = m.h <= 0 ? 'bad' : m.h <= 12 ? 'warn' : 'ok';
            const flip = m.pos > 0.75;
            const when =
              m.h <= 0
                ? `overdue ${Math.abs(m.h).toFixed(0)}h`
                : m.h > HORIZON_H
                  ? `${Math.round(m.h)}h`
                  : `${m.h.toFixed(0)}h left`;
            return (
              <button
                key={m.id}
                className={`strip-mark ${cls}`}
                style={{
                  left: `${m.pos * 100}%`,
                  bottom: `${30 + m.lane * 26}px`,
                  // Labels near the right edge grow leftwards to stay inside the strip.
                  ...(flip
                    ? { transform: 'translateX(calc(-100% + 6px))', padding: '2px 0 2px 8px' }
                    : {}),
                }}
                aria-pressed={selected === m.id}
                title={`${problemLabel(m.type)}: ${m.targetRef}`}
                onClick={() => onSelect(m.id)}
              >
                {!flip && <span className="pin" />}
                {money(m.amountAtRiskCents, m.currency)}
                <span className="when">{when}</span>
                {flip && <span className="pin" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TrailRow {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
}

const LABEL: Record<string, string> = {
  'exception.detected': 'Vigil spotted the problem',
  'exception.reopened': 'The problem came back',
  'proposal.drafted': 'The AI suggested a fix',
  'approval.approved': 'You approved the fix',
  'approval.rejected': 'You rejected the fix',
  'webhook.simulated_ignored': 'Ignored an unverified message claiming to be PayPal',
};

const STATE_WORDS: Record<string, string> = {
  TRIAGING: 'The AI started looking into it',
  PROPOSED: 'Fix proposed',
  AWAITING_APPROVAL: 'Waiting for your approval',
  PENDING_APPROVAL: 'Fix passed the safety rules, waiting for you',
  POLICY_REJECTED: 'The safety rules blocked the fix',
  ESCALATED: 'Needs your attention',
  APPROVED: 'Approval recorded',
  QUEUED: 'Queued to run',
  EXECUTING: 'Sent to PayPal',
  SUCCEEDED: 'PayPal accepted the change',
  AWAITING_SETTLEMENT: 'Waiting for PayPal to confirm',
  SETTLED: 'PayPal confirmed it',
  RESOLVED: 'Problem resolved',
  FAILED_FINAL: 'PayPal refused the change',
  FAILED: 'Fix failed',
  REJECTED: 'Fix rejected',
  EXPIRED: 'Fix expired',
  DISMISSED: 'Closed without a change',
  OPEN: 'The problem came back',
};

/** Fixes that only change Vigil's own records: these steps never involve PayPal. */
const INTERNAL_STATE_WORDS: Record<string, string> = {
  EXECUTING: 'Vigil updated its records',
  SUCCEEDED: 'Records updated',
  AWAITING_SETTLEMENT: 'Records updated',
  SETTLED: 'Done (nothing sent to PayPal)',
};

export function SettlementTrail({
  exceptionId,
  version,
  internal = false,
}: {
  exceptionId: string;
  version: number;
  /** The fix only changes Vigil's records (no PayPal call). */
  internal?: boolean;
}) {
  const [rows, setRows] = useState<TrailRow[]>([]);
  useEffect(() => {
    fetch(`/api/exceptions/${exceptionId}/trail`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setRows(j.trail ?? []))
      .catch(() => {});
  }, [exceptionId, version]);
  if (rows.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="trail">
      {rows.map((r) => {
        const to = typeof r.payload?.to === 'string' ? r.payload.to : null;
        const label =
          LABEL[r.action] ??
          (to
            ? ((internal ? INTERNAL_STATE_WORDS[to] : undefined) ??
              STATE_WORDS[to] ??
              `${r.action.split('.')[0]} → ${to}`)
            : r.action);
        return (
          <li key={r.seq}>
            <strong>{label}</strong>
            <span className="meta">
              {new Date(r.ts).toLocaleTimeString()}, by{' '}
              {ACTOR[r.actor.split(':')[0] ?? ''] ?? 'Vigil'}{' '}
              <span className="mono" title={`Audit row #${r.seq}, hash ${r.hash}`}>
                #{r.seq}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
