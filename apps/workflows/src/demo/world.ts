// The Replay "world": a database state + recordings that replay deterministically with zero keys.
// fixtures/demo/seed.json holds the starting rows; fixtures/demo/manifest.json the frozen clock.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  insertCustomerNote,
  insertLedgerEntries,
  upsertSeedObject,
  type CustomerNote,
  type Db,
  type LedgerEntry,
} from '@vigil/db';
import type { TaskRunner } from '@vigil/tasks';

export interface DemoManifest {
  /** The frozen "now" used while recording; replay runs on the same clock. */
  recordedAt: string;
  /** true = generated against Vigil's fake PayPal + scripted Claude, not the real sandbox. */
  synthetic: boolean;
  note: string;
}

export interface DemoSeed {
  seedObjects: {
    seedKey: string;
    kind: string;
    paypalId: string;
    status: string;
    data: Record<string, unknown>;
  }[];
  ledger: LedgerEntry[];
  notes: (Omit<CustomerNote, 'receivedAt'> & { receivedAt: string })[];
}

export const demoDir = (repoRoot: string) => path.join(repoRoot, 'fixtures', 'demo');

export function readDemoManifest(repoRoot: string): DemoManifest | null {
  const file = path.join(demoDir(repoRoot), 'manifest.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DemoManifest) : null;
}

export async function loadDemoSeed(db: Db, seed: DemoSeed) {
  for (const o of seed.seedObjects) await upsertSeedObject(db, o);
  await insertLedgerEntries(db, seed.ledger);
  for (const n of seed.notes)
    await insertCustomerNote(db, { ...n, receivedAt: new Date(n.receivedAt) });
}

/** Load the seed (if present) and run the first detection sweep (which triages new exceptions). */
export async function prepareReplayWorld(db: Db, runner: TaskRunner, repoRoot: string) {
  const file = path.join(demoDir(repoRoot), 'seed.json');
  if (!existsSync(file)) return { loaded: false };
  await loadDemoSeed(db, JSON.parse(readFileSync(file, 'utf8')) as DemoSeed);
  await runner.start('detect_exceptions', []);
  return { loaded: true };
}
