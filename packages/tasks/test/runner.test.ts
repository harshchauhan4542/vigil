import { describe, expect, it, vi } from 'vitest';
import { InlineTaskRunner, RenderTaskRunner, TASK_NAMES, type TaskHandlers } from '../src/index.js';

const handlers = (impl: (name: string, args: unknown[]) => Promise<unknown>) =>
  Object.fromEntries(TASK_NAMES.map((n) => [n, (...a: unknown[]) => impl(n, a)])) as TaskHandlers;

describe('InlineTaskRunner', () => {
  it('runs the handler in-process and awaits it by default', async () => {
    const seen: [string, unknown[]][] = [];
    const runner = new InlineTaskRunner().register(
      handlers(async (n, a) => void seen.push([n, a])),
    );
    const run = await runner.start('execute_proposal', ['p-1', 'token']);
    expect(run.runId).toMatch(/^inline-/);
    expect(seen).toEqual([['execute_proposal', ['p-1', 'token']]]);
  });

  it('propagates errors when awaited, reports them when fire-and-forget', async () => {
    const boom = handlers(async () => {
      throw new Error('boom');
    });
    await expect(new InlineTaskRunner().register(boom).start('settle_check', [])).rejects.toThrow(
      'boom',
    );
    const onError = vi.fn();
    const bg = new InlineTaskRunner({ awaitCompletion: false, onError }).register(boom);
    await bg.start('settle_check', []);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('settle_check', expect.any(Error)));
  });
});

describe('RenderTaskRunner', () => {
  it('starts "<workflow>/<task>" with the args', async () => {
    const startTask = vi.fn().mockResolvedValue({ taskRunId: 'trn-1' });
    const runner = new RenderTaskRunner({
      apiKey: 'k',
      render: { workflows: { startTask } } as never,
    });
    expect(await runner.start('triage_exception', ['ex-1'])).toEqual({ runId: 'trn-1' });
    expect(startTask).toHaveBeenCalledWith('vigil-workflows/triage_exception', ['ex-1']);
  });
});
