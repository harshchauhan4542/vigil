// Tier 2 gate: re-run policy on fresh PayPal state → mint token → start execute_proposal.
// Requests for the same proposal are serialised; the database allows one decision per proposal.
import { approveProposal } from '@vigil/gate';
import { ensureSession, json, rateLimited, serialized } from '../../../../../lib/guards';
import { UUID_RE, serverFor, type IdParams } from '../../../../../lib/request';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = {
  not_found: 404,
  not_pending: 409,
  expired: 409,
  policy_failed: 409,
  typed_amount_required: 422,
};

export async function POST(req: Request, { params }: IdParams) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const limited = rateLimited('approve', 20, 60_000, req);
  if (limited) return limited;
  const s = await serverFor(req);
  const session = ensureSession(req, s.env.SESSION_SECRET!);
  const body = (await req.json().catch(() => ({}))) as { typed_amount?: string };
  const result = await serialized(`approve:${id}`, () =>
    approveProposal(s.gate, {
      proposalId: id,
      approver: session.id,
      typedAmount: body.typed_amount ?? null,
    }),
  );
  const headers: Record<string, string> = session.setCookie
    ? { 'set-cookie': session.setCookie }
    : {};
  return result.ok
    ? json(
        { ok: true, status: result.status, run_id: result.runId, policy: result.policy },
        202,
        headers,
      )
    : json(
        { ok: false, error: result.code, status: result.status, policy: result.policy },
        STATUS[result.code] ?? 400,
        headers,
      );
}
