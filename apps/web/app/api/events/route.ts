// Server-sent events: every audit-log row (detections, proposals, approvals, executions,
// settlements) as it lands. Polls the append-only log, so it works across processes.
import { auditSince, latestAuditSeq } from '@vigil/db';
import { serverFor } from '../../../lib/request';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await serverFor(req);
  const from = Number(new URL(req.url).searchParams.get('after') ?? Number.NaN);
  let cursor = Number.isFinite(from) ? from : await latestAuditSeq(s.db);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send('ready', { cursor, mode: s.mode });
      while (!req.signal.aborted) {
        for (const row of await auditSince(s.db, cursor)) {
          cursor = row.seq;
          send('audit', {
            seq: row.seq,
            ts: row.ts,
            action: row.action,
            entity_type: row.entityType,
            entity_id: row.entityId,
            payload: row.payload,
          });
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
