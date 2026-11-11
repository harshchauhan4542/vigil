'use client';
// /audit: the append-only, hash-chained audit log in AG Grid, with the chain verification result.
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useState } from 'react';

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
  { field: 'seq', width: 80, sort: 'desc' },
  {
    field: 'ts',
    headerName: 'Time',
    width: 190,
    valueFormatter: (p) => new Date(p.value as string).toLocaleString(),
  },
  {
    headerName: 'Actor',
    valueGetter: (p) => `${p.data!.actorType}:${p.data!.actorId}`,
    width: 200,
  },
  { field: 'action', width: 200, filter: true },
  { field: 'entityType', headerName: 'Entity', width: 110, filter: true },
  { field: 'entityId', headerName: 'Entity id', flex: 1, minWidth: 200, cellClass: 'mono' },
  {
    headerName: 'Payload',
    valueGetter: (p) => JSON.stringify(p.data!.payload),
    flex: 1,
    minWidth: 220,
    cellClass: 'mono',
  },
  {
    field: 'hash',
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
      <header className="topbar">
        <a className="wordmark" href="/control-room">
          VIGIL
        </a>
        <span className="muted">Audit log</span>
        <span style={{ flex: 1 }} />
        {chain && (
          <span className={`badge ${chain.ok ? 'ok' : 'bad'}`}>
            {chain.ok
              ? `Hash chain verified · ${chain.rows} rows · head ${chain.head.slice(0, 12)}…`
              : `Chain BROKEN at #${chain.brokenAtSeq} (${chain.reason})`}
          </span>
        )}
      </header>
      <main style={{ padding: 16 }}>
        <p className="muted">
          Every detection, proposal, policy decision, approval, execution and settlement,
          append-only (UPDATE/DELETE are blocked in the database). Each row stores sha256(previous
          hash + row); the badge re-verifies the whole chain.
        </p>
        <div className="panel" style={{ height: 'calc(100vh - 170px)' }}>
          <AgGridReact<Row>
            theme={themeQuartz}
            rowData={rows}
            columnDefs={COLUMNS}
            getRowId={(p) => String(p.data.seq)}
          />
        </div>
      </main>
    </>
  );
}
