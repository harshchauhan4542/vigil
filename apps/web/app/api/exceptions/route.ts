import { listQueue } from '@vigil/db';
import { json } from '../../../lib/guards';
import { serverFor } from '../../../lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await serverFor(req);
  return json({ mode: s.mode, exceptions: await listQueue(s.db) });
}
