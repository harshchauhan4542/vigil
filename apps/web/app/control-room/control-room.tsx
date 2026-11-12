'use client';
// The control room: money at risk and deadlines up top, the problem queue (AG Grid), the
// Proposal Card, live updates over SSE, and an AG Studio analytics panel. Everything
// money-related goes through the server's gate.
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vigilGridTheme } from '../ui/grid-theme';
import { actionLabel, exceptionStatus, money, problemLabel, proposalStatus } from '../ui/labels';
import { Pill } from '../ui/pill';
import { TopBar } from '../ui/top-bar';
import { INTERNAL_ACTIONS, ProposalCard } from './proposal-card';
import type { QueueRow } from './types';
import { DeadlineStrip, MoneyAtRisk, SettlementTrail } from './widgets';

ModuleRegistry.registerModules([AllCommunityModule]);

const TrendCharts = dynamic(() => import('./trend-charts').then((m) => m.TrendCharts), {
  ssr: false,
  loading: () => <div className="trends-loading" />,
});

const StudioPanel = dynamic(() => import('./studio-panel').then((m) => m.StudioPanel), {
  ssr: false,
  loading: () => <p className="muted">Loading analytics…</p>,
});

/** A small coloured badge per problem type, like a transaction icon in a banking app. */
const PROBLEM_ICON: Record<string, { tone: string; d: string }> = {
  AUTH_HONOR_EXPIRING: { tone: 'warn', d: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z' },
  UNTRACKED_CAPTURE: {
    tone: 'info',
    d: 'M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10',
  },
  FAILED_RENEWAL: {
    tone: 'risk',
    d: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  },
  UNMATCHED_TXN: { tone: 'neutral', d: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6' },
};

function ProblemIcon({ type }: { type: string }) {
  const icon = PROBLEM_ICON[type] ?? PROBLEM_ICON.UNMATCHED_TXN!;
  return (
    <span className={`problem-icon ${icon.tone}`} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24">
        <path
          d={icon.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function dueIn(deadline: string | null, now: number): { text: string; cls: string } {
  if (!deadline) return { text: 'No rush', cls: 'muted' };
  const ms = Date.parse(deadline) - now;
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  const m = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
  if (ms < 0) return { text: `Overdue ${h}h ${m}m`, cls: 'due-bad' };
  return { text: `${h}h ${m}m`, cls: h < 12 ? 'due-warn' : '' };
}

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
  const grid = useRef<AgGridReact<QueueRow>>(null);
  const cardRef = useRef<HTMLElement>(null);
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
    es.addEventListener('audit', () => {
      setLastEvent(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      setVersion((v) => v + 1);
      void load();
    });
    const t = setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [load, offset]);

  const revealCard = () => {
    const el = cardRef.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.6) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };

  const selectRow = (id: string) => {
    const node = grid.current?.api.getRowNode(id);
    if (node) {
      node.setSelected(true, true);
      grid.current?.api.ensureNodeVisible(node);
    } else setSelected(id);
  };

  const columns = useMemo<ColDef<QueueRow>[]>(
    () => [
      {
        headerName: 'Problem',
        valueGetter: (p) => problemLabel(p.data!.type),
        cellRenderer: (p: { data: QueueRow }) => (
          <span className="cell-problem" title={p.data.type}>
            <ProblemIcon type={p.data.type} />
            <span>{problemLabel(p.data.type)}</span>
          </span>
        ),
        flex: 1.3,
        minWidth: 240,
      },
      {
        headerName: 'PayPal reference',
        field: 'targetRef',
        flex: 1,
        minWidth: 170,
        cellClass: 'mono',
      },
      {
        headerName: 'At risk',
        valueGetter: (p) => p.data!.amountAtRiskCents,
        valueFormatter: (p) => money(p.value as number | null, p.data!.currency),
        width: 120,
        type: 'rightAligned',
        cellClass: 'cell-amount',
      },
      {
        headerName: 'Time left',
        valueGetter: (p) => dueIn(p.data!.deadlineAt, now).text,
        comparator: (_a, _b, x, y) =>
          (x.data?.deadlineAt ? Date.parse(x.data.deadlineAt) : Infinity) -
          (y.data?.deadlineAt ? Date.parse(y.data.deadlineAt) : Infinity),
        cellRenderer: (p: { data: QueueRow }) => {
          const d = dueIn(p.data.deadlineAt, now);
          return <span className={d.cls}>{d.text}</span>;
        },
        width: 130,
      },
      {
        headerName: 'Status',
        valueGetter: (p) => exceptionStatus(p.data!.status)[0],
        cellRenderer: (p: { data: QueueRow }) => {
          const [label, tone] = exceptionStatus(p.data.status);
          return <Pill label={label} tone={tone} code={p.data.status} />;
        },
        width: 215,
      },
      {
        headerName: 'Suggested fix',
        // Include the status so the cell re-renders when the proposal moves on.
        valueGetter: (p) =>
          p.data!.latestProposal
            ? `${proposalStatus(p.data!.latestProposal.status)[0]} ${actionLabel(p.data!.latestProposal.actionType)}`
            : '',
        cellRenderer: (p: { data: QueueRow }) => {
          const lp = p.data.latestProposal;
          if (!lp) return <span className="muted">None yet</span>;
          const [label, tone] = proposalStatus(lp.status);
          return (
            <div className="cell-fix">
              <Pill label={label} tone={tone} code={lp.status} />
              <span title={lp.actionType}>{actionLabel(lp.actionType)}</span>
            </div>
          );
        },
        flex: 1.5,
        minWidth: 280,
      },
      { headerName: 'Priority', field: 'score', sort: 'desc', width: 100, hide: true },
    ],
    [now],
  );

  const current = rows.find((r) => r.id === selected) ?? null;
  const needsYou = rows.filter((r) => r.latestProposal?.status === 'PENDING_APPROVAL').length;

  return (
    <>
      <TopBar page="control-room" mode={mode}>
        {lastEvent && (
          <span className="muted" style={{ fontSize: 13 }} aria-live="polite">
            Updated at {lastEvent}
          </span>
        )}
      </TopBar>
      <div className={`mode-note${fallbackReason ? ' fallback' : ''}`}>
        {fallbackReason ? (
          <>
            <strong>Live mode isn't working right now</strong> ({fallbackReason}), so you are seeing
            demo data.{' '}
          </>
        ) : null}
        {mode === 'replay' ? (
          <>
            <strong>Demo mode.</strong>{' '}
            {replaySynthetic
              ? 'You are looking at made-up sample data. Nothing here touches a real PayPal account, so click around freely.'
              : 'You are looking at a recording of a PayPal test account. Nothing here touches real money, so click around freely.'}
          </>
        ) : (
          <>
            <strong>Live mode.</strong> Connected to your PayPal test (sandbox) account. No money
            moves until the safety rules pass and you press Approve.
          </>
        )}
      </div>

      <div className="greeting">
        <h1>{greeting(now)}</h1>
        <p>Here is what needs your attention in your PayPal account today.</p>
      </div>

      <section className="band" aria-label="Overview">
        <MoneyAtRisk version={version} />
        <DeadlineStrip rows={rows} now={now} selected={selected} onSelect={selectRow} />
      </section>

      <main className="workspace">
        <div className="wide">
          <TrendCharts rows={rows} now={now} />
        </div>
        <section className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Problems Vigil found in your PayPal account</h2>
              <p className="muted">
                {needsYou > 0
                  ? `${needsYou} ${needsYou === 1 ? 'fix is' : 'fixes are'} waiting for your OK. Click a row to see it.`
                  : 'Click a row to see what Vigil suggests.'}
              </p>
            </div>
          </div>
          {/* Tall enough for every row (up to 9) without an inner scrollbar. */}
          <div style={{ height: 48 + 60 * Math.min(Math.max(rows.length, 3), 9) }}>
            <AgGridReact<QueueRow>
              ref={grid}
              theme={vigilGridTheme}
              rowData={rows}
              columnDefs={columns}
              getRowId={(p) => p.data.id}
              rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
              onSelectionChanged={(e) => {
                const id = e.api.getSelectedRows()[0]?.id ?? null;
                setSelected(id);
                if (id) revealCard();
              }}
              overlayNoRowsTemplate="All clear: no money problems right now. To check PayPal again, open Help."
            />
          </div>
        </section>

        <section className="panel" aria-label="Suggested fix" ref={cardRef}>
          {current?.latestProposal ? (
            <ProposalCard
              key={`${current.latestProposal.id}:${version}`}
              proposalId={current.latestProposal.id}
              onChanged={load}
            />
          ) : (
            <div className="empty">
              <strong>{current ? 'No fix suggested yet' : 'Pick a problem to start'}</strong>
              {current ? (
                'The AI is still looking into this one, or it needs you to handle it in PayPal.'
              ) : (
                <>
                  Click a row in the list, or an amount on the timeline above.
                  <ol className="how">
                    <li>Vigil spots a money problem in your PayPal account.</li>
                    <li>The AI suggests a fix and explains why.</li>
                    <li>Safety rules check the fix.</li>
                    <li>You press Approve. Only then does Vigil ask PayPal to make the change.</li>
                  </ol>
                </>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>What happened</h2>
              <p className="muted">
                {current
                  ? 'Every step so far, from spotting the problem to PayPal confirming the fix.'
                  : 'Pick a problem to see everything that happened with it.'}
              </p>
            </div>
          </div>
          {current && (
            <SettlementTrail
              exceptionId={current.id}
              version={version}
              internal={INTERNAL_ACTIONS.has(current.latestProposal?.actionType ?? '')}
            />
          )}
        </section>

        <section className="panel wide">
          <div className="panel-head">
            <div>
              <h2>Charts and questions</h2>
              <p className="muted">
                Your space to make your own charts, or ask the assistant a question about your
                problems (powered by AG Studio). The main charts are at the top of the page.
              </p>
            </div>
          </div>
          <StudioPanel rows={rows} licenseKey={studioLicense} />
        </section>
      </main>
    </>
  );
}
