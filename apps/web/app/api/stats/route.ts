import { moneyStats } from '@vigil/db';
import { json } from '../../../lib/guards';
import { serverFor } from '../../../lib/request';

export const dynamic = 'force-dynamic';

/** W1: money at risk (open exceptions) vs. recovered in the last 7 days. */
export async function GET(req: Request) {
  const s = await serverFor(req);
  return json(await moneyStats(s.db, new Date(Date.now() - 7 * 86_400_000)));
}
