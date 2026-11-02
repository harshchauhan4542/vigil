import { listAudit, verifyChain } from '@vigil/db';
import { json } from '../../../lib/guards';
import { serverFor } from '../../../lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await serverFor(req);
  const [rows, chain] = await Promise.all([listAudit(s.db), verifyChain(s.db)]);
  return json({ chain, rows });
}
