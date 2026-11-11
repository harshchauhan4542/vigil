'use client';
// AG Studio analytics over Vigil's data. Client-only (Studio renders in the browser).
// Without a licence key Studio works with a watermark.
import { studioTheme } from 'ag-studio';
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useMemo } from 'react';
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

export function StudioPanel({ rows, licenseKey }: { rows: QueueRow[]; licenseKey: string }) {
  if (!licenseKey) muteLicenceBanner();
  const data = useMemo(
    () => ({
      sources: [
        {
          id: 'exceptions',
          name: 'Exceptions',
          description: 'Money exceptions detected in the PayPal account',
          data: rows.map((r) => ({
            type: r.type,
            target: r.targetRef,
            status: r.status,
            amount_at_risk: r.amountAtRiskCents === null ? null : r.amountAtRiskCents / 100,
            currency: r.currency,
            severity: r.severity,
            deadline: r.deadlineAt,
            proposal_action: r.latestProposal?.actionType ?? null,
            proposal_status: r.latestProposal?.status ?? null,
            risk_tier: r.latestProposal?.riskTier ?? null,
          })),
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
      <div style={{ height: 520 }}>
        <AgStudio
          data={data}
          mode="edit"
          ai={vigilHarness}
          theme={vigilStudioTheme}
          style={{ height: '100%' }}
        />
      </div>
    </AgStudioProvider>
  );
}
