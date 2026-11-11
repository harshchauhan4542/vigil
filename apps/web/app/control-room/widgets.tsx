'use client';
// W1 Money-at-Risk, W2 Deadline Radar, W4 Settlement Trail.
import { useEffect, useState } from 'react';
import type { QueueRow } from './types';

const fmt = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

interface Stats {
  atRisk: { currency: string; cents: number; count: number }[];
  recovered: { currency: string; cents: number; count: number }[];
}

export function MoneyAtRisk({ version }: { version: number }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, [version]);
  const line = (rows: Stats['atRisk'] | undefined) =>
    rows?.length ? rows.map((r) => fmt(r.cents, r.currency)).join(' + ') : '$0.00';
  return (
    <div className="tiles">
      <div className="tile">
        <div className="muted">Money at risk</div>
        <div className="big bad">{line(s?.atRisk)}</div>
        <div className="muted">
          {s?.atRisk.reduce((n, r) => n + r.count, 0) ?? 0} open exceptions
        </div>
      </div>
      <div className="tile">
        <div className="muted">Recovered (7 days)</div>
        <div className="big ok">{line(s?.recovered)}</div>
        <div className="muted">
          {s?.recovered.reduce((n, r) => n + r.count, 0) ?? 0} executed fixes
        </div>
      </div>
    </div>
  );
}

export function DeadlineRadar({ rows, now }: { rows: QueueRow[]; now: number }) {
  const upcoming = rows
    .filter((r) => r.deadlineAt && !['RESOLVED', 'DISMISSED'].includes(r.status))
    .map((r) => ({ ...r, ms: Date.parse(r.deadlineAt!) - now }))
    .sort((a, b) => a.ms - b.ms)
    .slice(0, 6);
  if (upcoming.length === 0) return <p className="muted">No deadlines in the queue.</p>;
  return (
    <ul className="radar">
      {upcoming.map((r) => {
        const h = r.ms / 3_600_000;
        const cls = h <= 0 ? 'bad' : h <= 12 ? 'warn' : 'ok';
        return (
          <li key={r.id}>
            <span className={`dot ${cls}`} />
            <span className="mono">{r.targetRef}</span>
            <span className={cls}>
              {h <= 0 ? `overdue ${Math.abs(h).toFixed(1)}h` : `${h.toFixed(1)}h left`}
            </span>
          </li>
        );
      })}
    </ul>
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
  'exception.detected': 'Detected',
  'exception.reopened': 'Re-opened',
  'proposal.drafted': 'Agent proposed (DRAFT)',
  'approval.approved': 'Human approved',
  'approval.rejected': 'Human rejected',
  'webhook.simulated_ignored': 'Simulated webhook ignored',
};

export function SettlementTrail({
  exceptionId,
  version,
}: {
  exceptionId: string;
  version: number;
}) {
  const [rows, setRows] = useState<TrailRow[]>([]);
  useEffect(() => {
    fetch(`/api/exceptions/${exceptionId}/trail`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setRows(j.trail ?? []))
      .catch(() => {});
  }, [exceptionId, version]);
  return (
    <ol className="trail">
      {rows.map((r) => {
        const to = typeof r.payload?.to === 'string' ? r.payload.to : null;
        return (
          <li key={r.seq}>
            <strong>
              {LABEL[r.action] ?? (to ? `${r.action.split('.')[0]} → ${to}` : r.action)}
            </strong>{' '}
            <span className="muted">
              {new Date(r.ts).toLocaleTimeString()} · {r.actor} · #{r.seq} {r.hash}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
