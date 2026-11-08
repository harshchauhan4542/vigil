import { verifyChain } from '@vigil/db';
import { openDb } from './db.js';

const handle = await openDb();
const result = await verifyChain(handle.db);
await handle.close();
if (result.ok) {
  console.log(`Audit chain OK: ${result.rows} rows, head ${result.head.slice(0, 12)}…`);
} else {
  console.error(`Audit chain BROKEN at seq ${result.brokenAtSeq} (${result.reason}).`);
  process.exit(1);
}
