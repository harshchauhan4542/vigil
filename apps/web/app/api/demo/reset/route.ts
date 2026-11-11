import { ensureSession, json, rateLimited } from '../../../../lib/guards';
import { serverFor } from '../../../../lib/request';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const limited = rateLimited('reset', 2, 10 * 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  if (s.mode === 'replay') {
    return json({ ok: false, error: 'reset is a Live-mode action; Replay data is fixed' }, 409);
  }
  const session = ensureSession(req, s.env.SESSION_SECRET!);
  const run = await s.runner.start('reseed_demo', []);
  return json(
    { ok: true, run_id: run.runId },
    202,
    session.setCookie ? { 'set-cookie': session.setCookie } : {},
  );
}
