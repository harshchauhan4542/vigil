'use client';
// The control room: exception queue (AG Grid), Proposal Card, live updates over SSE, and an
// AG Studio analytics panel. Everything money-related goes through the server's gate.
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProposalCard } from './proposal-card';
import type { QueueRow } from './types';
import { DeadlineRadar, MoneyAtRisk, SettlementTrail } from './widgets';

ModuleRegistry.registerModules([AllCommunityModule]);

const StudioPanel = dynamic(() => import('./studio-panel').then((m) => m.StudioPanel), {
  ssr: false,
  loading: () => <p className="muted">Loading analytics…</p>,
});

const money = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

function countdown(deadline: string | null, now: number): string {
  if (!deadline) return '—';
  const ms = Date.parse(deadline) - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  return `${ms < 0 ? 'overdue ' : ''}${h}h ${m}m`;
}

const CODES: Record<string, string> = {
  FAILED_RENEWAL: 'E1',
  UNTRACKED_CAPTURE: 'E2',
  AUTH_HONOR_EXPIRING: 'E3',
  UNMATCHED_TXN: 'E4',
  DISPUTE_DEADLINE: 'E5',
};

export function ControlRoom({
  mode,
  fallbackReason,
  replaySynthetic,
  serverNow,
  studioLicense,
}: {
  /** The server's clock (frozen in Replay); countdowns follow it, not the browser's. */
  serverNow: string;
  mode: 'live' | 'replay';
  fallbackReason: string | null;
  replaySynthetic: boolean;
  studioLicense: string;
}) {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Offset between the server clock (frozen demo clock in Replay) and this browser.
  const [offset] = useState(() => Date.parse(serverNow) - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  const [lastEvent, setLastEvent] = useState<string>('');
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    const r = await fetch('/api/exceptions', { cache: 'no-store' });
    if (r.ok) setRows((await r.json()).exceptions);
  }, []);

  useEffect(() => {
    void load();
    const es = new EventSource('/api/events');
    es.addEventListener('audit', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { action: string; entity_type: string };
      setLastEvent(`${ev.action} (${ev.entity_type})`);
      setVersion((v) => v + 1);
      void load();
    });
    const t = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [load, offset]);

  const columns = useMemo<ColDef<QueueRow>[]>(
    () => [
      {
        headerName: 'Type',
        valueGetter: (p) => `${CODES[p.data!.type] ?? ''} ${p.data!.type}`,
        width: 210,
      },
      { headerName: 'Target', field: 'targetRef', flex: 1, minWidth: 160, cellClass: 'mono' },
      {
        headerName: 'At risk',
        valueGetter: (p) => p.data!.amountAtRiskCents,
        valueFormatter: (p) => money(p.value as number | null, p.data!.currency),
        width: 110,
        type: 'rightAligned',
      },
      {
        headerName: 'Deadline',
        valueGetter: (p) => countdown(p.data!.deadlineAt, now),
        width: 130,
      },
      { headerName: 'Status', field: 'status', width: 170 },
      {
        headerName: 'Proposal',
        valueGetter: (p) =>
          p.data!.latestProposal
            ? `${p.data!.latestProposal.actionType} · ${p.data!.latestProposal.status}`
            : '—',
        flex: 1,
        minWidth: 180,
      },
      {
        headerName: 'Tier',
        valueGetter: (p) =>
          (p.data!.latestProposal?.riskTier ?? null) === null
            ? ''
            : `T${p.data!.latestProposal!.riskTier}`,
        width: 70,
      },
      { headerName: 'Priority', field: 'score', sort: 'desc', width: 100, hide: true },
    ],
    [now],
  );

  const current = rows.find((r) => r.id === selected) ?? null;

  async function switchMode(next: 'live' | 'replay') {
    await fetch('/api/demo/mode', {
      method: 'POST',
      body: JSON.stringify({ mode: next }),
      headers: { 'content-type': 'application/json' },
    });
    window.location.reload();
  }

  return (
    <>
      <header className="topbar">
        <span className="wordmark">VIGIL</span>
        <span className="muted">Money-ops control room</span>
        <span style={{ flex: 1 }} />
        <span className="muted mono">{lastEvent}</span>
        <a href="/audit">Audit log</a>
        <a href="/judge">Judge panel</a>
        <button onClick={() => switchMode(mode === 'live' ? 'replay' : 'live')}>
          Switch to {mode === 'live' ? 'Replay' : 'Live'}
        </button>
      </header>
      <div className={`banner ${mode}`}>
        {fallbackReason
          ? `Live is unavailable (${fallbackReason}), so you are seeing Replay. `
          : ''}
        {mode === 'replay'
          ? replaySynthetic
            ? "REPLAY MODE: recorded responses from Vigil's PayPal simulator and a scripted agent (synthetic demo data). No keys, no network, deterministic."
            : 'REPLAY MODE: recorded PayPal sandbox and Claude responses. No keys, no network, deterministic.'
          : 'LIVE MODE: real PayPal sandbox calls and real Claude. Every money action needs policy + your approval.'}
      </div>
      <main className="layout">
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <MoneyAtRisk version={version} />
        </section>
        <section className="panel">
          <h2>Exception queue</h2>
          <div style={{ height: 420 }}>
            <AgGridReact<QueueRow>
              theme={themeQuartz}
              rowData={rows}
              columnDefs={columns}
              getRowId={(p) => p.data.id}
              rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
              onSelectionChanged={(e) => setSelected(e.api.getSelectedRows()[0]?.id ?? null)}
              overlayNoRowsTemplate="No open exceptions. Run detection (pnpm flow) or reset the demo."
            />
          </div>
        </section>
        <section className="panel">
          <h2>Proposal</h2>
          {current?.latestProposal ? (
            <ProposalCard
              key={`${current.latestProposal.id}:${version}`}
              proposalId={current.latestProposal.id}
              onChanged={load}
            />
          ) : (
            <p className="muted">
              {current ? 'No proposal yet for this exception.' : 'Select an exception.'}
            </p>
          )}
        </section>
        <section className="panel">
          <h2>Deadline radar</h2>
          <DeadlineRadar rows={rows} now={now} />
        </section>
        <section className="panel">
          <h2>Settlement trail</h2>
          {current ? (
            <SettlementTrail exceptionId={current.id} version={version} />
          ) : (
            <p className="muted">Select an exception to see its trail.</p>
          )}
        </section>
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <h2>Analytics (AG Studio)</h2>
          <StudioPanel rows={rows} licenseKey={studioLicense} />
        </section>
      </main>
    </>
  );
}
