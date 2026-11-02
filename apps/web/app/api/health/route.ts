import { latestAuditSeq } from '@vigil/db';
import { json } from '../../../lib/guards';
import { serverFor } from '../../../lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const s = await serverFor(req);
    return json({
      ok: true,
      mode: s.mode,
      ai: !!s.claude,
      execution_enabled: s.env.EXECUTION_ENABLED,
      audit_seq: await latestAuditSeq(s.db),
    });
  } catch (error) {
    return json({ ok: false, error: (error as Error).message.split('\n')[0] }, 503);
  }
}
