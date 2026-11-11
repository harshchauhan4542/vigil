'use client';
// /audit: the append-only, hash-chained audit log in AG Grid, with the chain verification result.
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useState } from 'react';
import { vigilGridTheme } from '../ui/grid-theme';
import { TopBar } from '../ui/top-bar';

ModuleRegistry.registerModules([AllCommunityModule]);

interface Row {
  seq: number;
  ts: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}
type Chain =
  | { ok: true; rows: number; head: string }
  | { ok: false; rows: number; brokenAtSeq: number; reason: string };

const COLUMNS: ColDef<Row>[] = [
  { field: 'seq', headerName: '#', width: 80, sort: 'desc' },
  {
    field: 'ts',
    headerName: 'Time',
    width: 190,
    valueFormatter: (p) => new Date(p.value as string).toLocaleString(),
  },
  {
    headerName: 'Who',
    valueGetter: (p) => `${p.data!.actorType}:${p.data!.actorId}`,
    width: 200,
  },
  { field: 'action', headerName: 'What happened', width: 210, filter: true },
  { field: 'entityType', headerName: 'On', width: 110, filter: true },
  { field: 'entityId', headerName: 'Record id', flex: 1, minWidth: 200, cellClass: 'mono' },
  {
    headerName: 'Details',
    valueGetter: (p) => JSON.stringify(p.data!.payload),
    flex: 1,
    minWidth: 220,
    cellClass: 'mono',
  },
  {
    field: 'hash',
    headerName: 'Hash',
    width: 150,
    cellClass: 'mono',
    valueFormatter: (p) => `${String(p.value).slice(0, 12)}…`,
  },
];

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  useEffect(() => {
    fetch('/api/audit', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setRows(j.rows);
        setChain(j.chain);
      })
      .catch(() => {});
  }, []);
  return (
    <>
      <TopBar page="audit" />
      <main className="page" style={{ maxWidth: 'none' }}>
        <div className="audit-head">
          <div className="page-intro">
            <h1>History</h1>
            <p>
              Everything Vigil, the AI and you did, in order: problems found, fixes suggested,
              safety checks, approvals and PayPal's answers. Entries can only be added, never
              changed or deleted, and each one is sealed to the one before it, so tampering would
              show.
            </p>
          </div>
          {chain && (
            <span className={`badge ${chain.ok ? 'ok' : 'bad'}`} role="status">
              {chain.ok
                ? `✓ Nothing was changed (hash chain verified, ${chain.rows} entries)`
                : `Warning: history was changed at entry #${chain.brokenAtSeq} (${chain.reason})`}
            </span>
          )}
        </div>
        <div style={{ height: 'calc(100vh - 230px)', minHeight: 420 }}>
          <AgGridReact<Row>
            theme={vigilGridTheme}
            rowData={rows}
            columnDefs={COLUMNS}
            getRowId={(p) => String(p.data.seq)}
          />
        </div>
      </main>
    </>
  );
}
