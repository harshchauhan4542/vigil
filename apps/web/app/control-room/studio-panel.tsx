'use client';
// AG Studio analytics over Vigil's data. Client-only (Studio renders in the browser).
// Without a licence key Studio works with a watermark.
import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { useMemo } from 'react';
import { vigilHarness } from './studio/harness';
import type { QueueRow } from './types';

export function StudioPanel({ rows, licenseKey }: { rows: QueueRow[]; licenseKey: string }) {
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
  return (
    <AgStudioProvider {...(licenseKey ? { licenseKey } : {})}>
      <div style={{ height: 520 }}>
        <AgStudio data={data} mode="edit" ai={vigilHarness} style={{ height: '100%' }} />
      </div>
    </AgStudioProvider>
  );
}
