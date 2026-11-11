// process_webhook: a VERIFIED event settles proposals only after re-reading the resource from
// PayPal (events can arrive out of order). Simulated events never settle a real proposal.
import {
  advanceException,
  appendAudit,
  findProposalsByResource,
  getWebhookEvent,
  transitionProposal,
  transitionWebhookEvent,
  upsertAuthorization,
  upsertSubscription,
  type Actor,
} from '@vigil/db';
import { PayPalError, reads } from '@vigil/paypal';
import type { WorkflowContext } from '../context.js';
import { authorizationRow, subscriptionRow } from '../sync/mappers.js';

const ACTOR: Actor = { type: 'paypal', id: 'webhook' };

/** Re-read the resource; return the status PayPal reports now (null if unreadable). */
async function currentStatus(
  ctx: WorkflowContext,
  eventType: string,
  resourceId: string,
): Promise<string | null> {
  try {
    if (eventType.startsWith('PAYMENT.CAPTURE.'))
      return (await reads.getCapture(ctx.http, resourceId)).status;
    if (eventType.startsWith('PAYMENT.REFUND.'))
      return (await reads.getRefund(ctx.http, resourceId)).status;
    if (eventType.startsWith('PAYMENT.AUTHORIZATION.')) {
      const a = await reads.getAuthorization(ctx.http, resourceId);
      await upsertAuthorization(ctx.db, authorizationRow(a)); // keeps the mirror (and E3) current
      return a.status;
    }
    if (eventType.startsWith('BILLING.SUBSCRIPTION.')) {
      const sub = await reads.getSubscription(ctx.http, resourceId);
      await upsertSubscription(ctx.db, subscriptionRow(sub)); // E1 picks up failures on the next sweep
      return sub.status;
    }
  } catch (error) {
    if (error instanceof PayPalError) return null;
    throw error;
  }
  return null;
}

/** Which current statuses confirm which actions. */
const SETTLES: Record<string, string[]> = {
  capture_authorization: ['COMPLETED'],
  refund: ['COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED'],
  void_authorization: ['VOIDED'],
  reauthorize: ['CREATED'],
  retry_outstanding_balance: ['ACTIVE'],
  suspend_subscription: ['SUSPENDED'],
};

export async function processWebhookTask(ctx: WorkflowContext, eventId: string) {
  const event = await getWebhookEvent(ctx.db, eventId);
  if (!event || event.processingStatus !== 'VERIFIED')
    return { eventId, skipped: event?.processingStatus ?? 'missing' };
  const settled: string[] = [];
  try {
    const status = event.resourceId
      ? await currentStatus(ctx, event.eventType, event.resourceId)
      : null;
    if (event.resourceId && status) {
      for (const p of await findProposalsByResource(ctx.db, event.resourceId)) {
        if (p.status !== 'SUCCEEDED' || !SETTLES[p.actionType]?.includes(status)) continue;
        if (event.simulated) {
          await appendAudit(ctx.db, {
            actorType: 'paypal',
            actorId: 'webhook',
            action: 'webhook.simulated_ignored',
            entityType: 'proposal',
            entityId: p.id,
            payload: { event_id: eventId, event_type: event.eventType },
          });
          continue;
        }
        await transitionProposal(ctx.db, p.id, 'SUCCEEDED', 'SETTLED', ACTOR, {});
        await advanceException(ctx.db, p.exceptionId, 'RESOLVED', ACTOR, {
          event_id: eventId,
          event_type: event.eventType,
          status,
        });
        settled.push(p.id);
      }
    }
    await transitionWebhookEvent(ctx.db, eventId, 'VERIFIED', 'PROCESSED');
    ctx.log('webhook.processed', { eventId, type: event.eventType, settled });
    return { eventId, settled };
  } catch (error) {
    await transitionWebhookEvent(ctx.db, eventId, 'VERIFIED', 'FAILED', {
      error: (error as Error).message,
    });
    throw error;
  }
}
