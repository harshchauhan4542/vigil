// Run a detection sweep (and settle_check) now, without the cron. Locally this keeps everything in
// the one process that owns the embedded database.
import { ensureSession, json, rateLimited } from '../../../../lib/guards';
import { serverFor } from '../../../../lib/request';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const limited = rateLimited('detect', 4, 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  if (s.mode === 'replay')
    return json({ ok: false, error: 'Replay data is fixed; switch to Live' }, 409);
  const session = ensureSession(req, s.env.SESSION_SECRET!);
  const detect = await s.runner.start('detect_exceptions', []);
  const settle = await s.runner.start('settle_check', []);
  return json(
    { ok: true, runs: [detect.runId, settle.runId] },
    202,
    session.setCookie ? { 'set-cookie': session.setCookie } : {},
  );
}
