import { auditForEntities, listProposalsForException } from '@vigil/db';
import { json } from '../../../../../lib/guards';
import { UUID_RE, serverFor, type IdParams } from '../../../../../lib/request';

export const dynamic = 'force-dynamic';

/** W4 Settlement Trail: detected → proposed → policy → approved → executed → settled. */
export async function GET(req: Request, { params }: IdParams) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const s = await serverFor(req);
  const proposals = await listProposalsForException(s.db, id);
  const rows = await auditForEntities(s.db, [id, ...proposals.map((p) => p.id)]);
  return json({
    trail: rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      actor: `${r.actorType}:${r.actorId}`,
      action: r.action,
      entity_type: r.entityType,
      entity_id: r.entityId,
      payload: r.payload,
      hash: r.hash.slice(0, 12),
    })),
  });
}
