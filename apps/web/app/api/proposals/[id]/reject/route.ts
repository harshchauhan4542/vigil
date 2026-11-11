import { rejectProposal } from '@vigil/gate';
import { ensureSession, json, rateLimited, serialized } from '../../../../../lib/guards';
import { UUID_RE, serverFor, type IdParams } from '../../../../../lib/request';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: IdParams) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const limited = rateLimited('reject', 20, 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  const session = ensureSession(req, s.env.SESSION_SECRET!);
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const r = await serialized(`approve:${id}`, () =>
    rejectProposal(s.gate, {
      proposalId: id,
      approver: session.id,
      ...(body.reason ? { reason: body.reason.slice(0, 300) } : {}),
    }),
  );
  return json(r, r.ok ? 200 : 409, session.setCookie ? { 'set-cookie': session.setCookie } : {});
}
