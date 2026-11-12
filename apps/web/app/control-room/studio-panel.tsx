'use client';
// AG Studio analytics over Vigil's data. Client-only (Studio renders in the browser).
// Without a licence key Studio works with a watermark.
import { studioTheme, type AgReportState } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useMemo, useState } from 'react';
import { actionLabel, exceptionStatus, problemLabel, proposalStatus } from '../ui/labels';
import { vigilHarness } from './studio/harness';
import type { QueueRow } from './types';

// Studio's colours point at Vigil's CSS tokens, so the panel follows the light/dark toggle.
const vigilStudioTheme = studioTheme.withParams({
  fontFamily: 'inherit',
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  borderColor: 'var(--line)',
  accentColor: 'var(--teal)',
  studioCanvasBackgroundColor: 'var(--surface-2)',
});

// Without a licence key, AG Studio prints a 7-line "License Key Not Found" banner with
// console.error, which the Next.js dev overlay counts as 7 issues. Drop only those banner
// lines; the trial watermark inside the panel still shows the licence state.
const LICENCE_BANNER =
  /^\*+$|AG Studio Core License|License Key Not Found|unlocked for trial|hide the watermark/;
let bannerFilterInstalled = false;
function muteLicenceBanner() {
  if (bannerFilterInstalled || typeof window === 'undefined') return;
  bannerFilterInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && LICENCE_BANNER.test(args[0].trim())) return;
    original(...args);
  };
}

const CLOSED = new Set(['RESOLVED', 'DISMISSED']);
const SAVED_KEY = 'vigil-dashboard-v2';

// Field ids are `<source>.<field>`.
const f = (field: string, aggregation?: 'sum' | 'count') => ({
  id: `problems.${field}`,
  ...(aggregation ? { aggregation } : {}),
});
const title = (text: string) => ({ title: { text, enabled: true } });

/** The ready-made "Overview" page: headline numbers on top, two charts below. */
const STANDARD_DASHBOARD = {
  selectedPageId: 'overview',
  // Start with the charts full width; the editing panels open with one click.
  panels: { filters: { collapsed: true }, edit: { collapsed: true }, data: { collapsed: true } },
  pages: [
    {
      id: 'overview',
      layout: { columns: 12, rowHeight: 40 },
      widgets: {
        risk: {
          type: 'value',
          dataMapping: { value: [f('open_money_at_risk', 'sum')] },
          format: title('Money at risk (open problems)'),
        },
        open: {
          type: 'value',
          dataMapping: { value: [f('is_open', 'sum')] },
          format: title('Open problems'),
        },
        waiting: {
          type: 'value',
          dataMapping: { value: [f('waiting_for_you', 'sum')] },
          format: title('Fixes waiting for your OK'),
        },
        fixed: {
          type: 'value',
          dataMapping: { value: [f('is_fixed', 'sum')] },
          format: title('Problems fixed'),
        },
        byProblem: {
          type: 'column-chart-grouped',
          dataMapping: {
            categoryKey: [f('problem')],
            valueKey: [f('open_money_at_risk', 'sum')],
          },
          format: title('Money at risk by problem'),
        },
        byStatus: {
          type: 'donut-chart',
          dataMapping: { categoryKey: [f('status')], valueKey: [f('reference', 'count')] },
          format: title('Problems by status'),
        },
      },
      widgetLayout: {
        risk: { xTrack: 0, yTrack: 0, xSpan: 3, ySpan: 3 },
        open: { xTrack: 3, yTrack: 0, xSpan: 3, ySpan: 3 },
        waiting: { xTrack: 6, yTrack: 0, xSpan: 3, ySpan: 3 },
        fixed: { xTrack: 9, yTrack: 0, xSpan: 3, ySpan: 3 },
        byProblem: { xTrack: 0, yTrack: 3, xSpan: 7, ySpan: 8 },
        byStatus: { xTrack: 7, yTrack: 3, xSpan: 5, ySpan: 8 },
      },
    },
  ],
} as unknown as AgReportState;

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const text = (id: string, name: string) => ({ id, name, format: 'textFormat' as const });
const count = (id: string, name: string) => ({ id, name, format: 'integerFormat' as const });
const usd = (id: string, name: string) => ({
  id,
  name,
  format: 'currencyFormat' as const,
  formatOptions: { format: USD },
});
/** Plain names for the merchant; money shown as dollars. */
const FIELDS = [
  text('problem', 'Problem'),
  text('status', 'Status'),
  text('reference', 'PayPal reference'),
  usd('money_at_risk', 'Money involved'),
  usd('open_money_at_risk', 'Money at risk (open)'),
  count('is_open', 'Open problems'),
  count('is_fixed', 'Problems fixed'),
  count('waiting_for_you', 'Fixes waiting for you'),
  text('suggested_fix', 'Suggested fix'),
  text('fix_status', 'Fix status'),
  text('currency', 'Currency'),
  count('urgency', 'Urgency (1 low to 4 overdue)'),
  text('deadline', 'Deadline'),
];

function savedDashboard(): AgReportState | null {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as AgReportState) : null;
  } catch {
    return null;
  }
}

export function StudioPanel({ rows, licenseKey }: { rows: QueueRow[]; licenseKey: string }) {
  if (!licenseKey) muteLicenceBanner();
  // Bumping this remounts Studio, which re-reads initialState (used by "reset").
  const [generation, setGeneration] = useState(0);
  const initialState = useMemo(
    () => (generation === 0 ? savedDashboard() : null) ?? STANDARD_DASHBOARD,
    [generation],
  );
  const data = useMemo(
    () => ({
      sources: [
        {
          id: 'problems',
          name: 'Problems',
          description: 'Money problems Vigil found in the PayPal account',
          fields: FIELDS,
          data: rows.map((r) => {
            const open = !CLOSED.has(r.status);
            const amount = r.amountAtRiskCents === null ? 0 : r.amountAtRiskCents / 100;
            return {
              problem: problemLabel(r.type),
              status: exceptionStatus(r.status)[0],
              reference: r.targetRef,
              money_at_risk: amount,
              open_money_at_risk: open ? amount : 0,
              is_open: open ? 1 : 0,
              is_fixed: r.status === 'RESOLVED' ? 1 : 0,
              waiting_for_you: r.latestProposal?.status === 'PENDING_APPROVAL' ? 1 : 0,
              suggested_fix: r.latestProposal ? actionLabel(r.latestProposal.actionType) : null,
              fix_status: r.latestProposal ? proposalStatus(r.latestProposal.status)[0] : null,
              currency: r.currency,
              urgency: r.severity,
              deadline: r.deadlineAt,
            };
          }),
        },
      ],
    }),
    [rows],
  );
  // Studio warns about a source with no fields when there are no rows yet.
  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>No data to chart yet</strong>
        Charts appear here once Vigil finds problems in your PayPal account.
      </div>
    );
  }
  return (
    <AgStudioProvider {...(licenseKey ? { licenseKey } : {})}>
      <div className="studio-tools">
        <span className="muted">
          Your charts are saved in this browser. Add your own with the panels on the right.
        </span>
        <button
          type="button"

          onClick={() => {
            try {
              window.localStorage.removeItem(SAVED_KEY);
            } catch {
              // Storage can be blocked (private window); the dashboard still works.
            }
            setGeneration((g) => g + 1);
          }}
        >
          Reset to the standard charts
        </button>
      </div>
      <div style={{ height: 640 }}>
        <AgStudio
          key={generation}
          data={data}
          mode="edit"
          initialState={initialState}
          onStateUpdated={(e) => {
            try {
              window.localStorage.setItem(SAVED_KEY, JSON.stringify(e.state));
            } catch {
              // Storage can be blocked (private window); the dashboard still works.
            }
          }}
          ai={vigilHarness}
          theme={vigilStudioTheme}
          style={{ height: '100%' }}
        />
      </div>
    </AgStudioProvider>
  );
}
