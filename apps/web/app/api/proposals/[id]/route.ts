import { getApproval, getException, getProposal, listExecutions } from '@vigil/db';
import { json } from '../../../../lib/guards';
import { UUID_RE, serverFor, type IdParams } from '../../../../lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: IdParams) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const s = await serverFor(req);
  const proposal = await getProposal(s.db, id);
  if (!proposal) return json({ error: 'not_found' }, 404);
  const [exception, executions, approval] = await Promise.all([
    getException(s.db, proposal.exceptionId),
    listExecutions(s.db, id),
    getApproval(s.db, id),
  ]);
  return json({
    proposal,
    exception,
    executions,
    // Never expose the token hash.
    approval: approval && {
      decision: approval.decision,
      approver: approval.approver,
      decided_at: approval.decidedAt,
      token_used_at: approval.tokenUsedAt,
      reason: approval.reason,
    },
  });
}
