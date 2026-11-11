// Command-line driver for the full loop (local, inline runner):
//   pnpm flow                 detect → triage → list proposals awaiting approval
//   pnpm flow --approve <id> [--typed 612.00]   approve one → execute → print the result
//   pnpm flow --settle        settle_check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProposal, listExecutions, listProposalsByStatus } from '@vigil/db';
import { approveProposal } from '@vigil/gate';
import { bootstrap } from './bootstrap.js';
import { gateDeps } from './context.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const { ctx, handle, runner } = await bootstrap(undefined, repoRoot, { awaitTasks: true });
try {
  const approveId = arg('--approve');
  if (approveId) {
    const r = await approveProposal(gateDeps(ctx), {
      proposalId: approveId,
      approver: 'cli',
      typedAmount: arg('--typed') ?? null,
    });
    console.log(JSON.stringify(r.ok ? { ok: true, status: r.status } : r, null, 2));
    const p = await getProposal(ctx.db, approveId);
    console.log(`proposal ${approveId}: ${p?.status}`);
    for (const x of await listExecutions(ctx.db, approveId)) {
      console.log(
        `  attempt ${x.attempt}: HTTP ${x.httpStatus} ${x.paypalStatus ?? ''} request_id=${x.paypalRequestId} debug_id=${x.debugId ?? '-'}`,
      );
    }
  } else if (args.includes('--settle')) {
    console.log(await runner.start('settle_check', []));
  } else {
    await runner.start('detect_exceptions', []);
    const pending = await listProposalsByStatus(ctx.db, ['PENDING_APPROVAL']);
    if (pending.length === 0) console.log('No proposals awaiting approval.');
    for (const p of pending) {
      console.log(`${p.id}  T${p.riskTier}  ${p.actionType}  ${p.targetRef}  ${p.rationale}`);
    }
    if (pending.length) console.log('Approve one with: pnpm flow --approve <proposal id>');
  }
} finally {
  await handle.close();
}
