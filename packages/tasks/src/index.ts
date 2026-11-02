// TaskRunner: how the web app and cron start durable work.
//   InlineTaskRunner: runs the task in-process (local dev, tests, zero-key replay)
//   RenderTaskRunner: Render Workflows `startTask('<workflow>/<task>', args)`
import { randomUUID } from 'node:crypto';
import { Render } from '@renderinc/sdk';

export const TASK_NAMES = [
  'detect_exceptions',
  'triage_exception',
  'execute_proposal',
  'settle_check',
  'reconcile_window',
  'reseed_demo',
] as const;
export type TaskName = (typeof TASK_NAMES)[number];

export interface TaskRun {
  runId: string;
}

export interface TaskRunner {
  start(task: TaskName, args: unknown[]): Promise<TaskRun>;
}

export type TaskHandler = (...args: unknown[]) => Promise<unknown>;
export type TaskHandlers = Record<TaskName, TaskHandler>;

export interface InlineRunnerOptions {
  /** true (default): start() resolves after the task finishes; false: fire-and-forget. */
  awaitCompletion?: boolean;
  onError?: (task: TaskName, error: unknown) => void;
}

export class InlineTaskRunner implements TaskRunner {
  private handlers: Partial<TaskHandlers> = {};
  readonly runs: { runId: string; task: TaskName; args: unknown[]; error?: unknown }[] = [];

  constructor(private readonly options: InlineRunnerOptions = {}) {}

  /** Handlers are registered after construction because tasks themselves need the runner. */
  register(handlers: TaskHandlers): this {
    this.handlers = handlers;
    return this;
  }

  async start(task: TaskName, args: unknown[]): Promise<TaskRun> {
    const handler = this.handlers[task];
    if (!handler) throw new Error(`No inline handler registered for task ${task}`);
    const run: (typeof this.runs)[number] = { runId: `inline-${randomUUID()}`, task, args };
    this.runs.push(run);
    const exec = handler(...args).catch((error: unknown) => {
      run.error = error;
      this.options.onError?.(task, error);
      if (this.options.awaitCompletion !== false) throw error;
    });
    if (this.options.awaitCompletion !== false) await exec;
    else void exec;
    return { runId: run.runId };
  }
}

export class RenderTaskRunner implements TaskRunner {
  private readonly render: Render;

  constructor(
    private readonly options: { apiKey: string; workflowSlug?: string; render?: Render },
  ) {
    this.render = options.render ?? new Render({ token: options.apiKey });
  }

  async start(task: TaskName, args: unknown[]): Promise<TaskRun> {
    const slug = `${this.options.workflowSlug ?? 'vigil-workflows'}/${task}`;
    const result = await this.render.workflows.startTask(slug, args);
    return { runId: result.taskRunId };
  }
}

export function createTaskRunner(env: {
  TASK_RUNNER: 'inline' | 'render';
  RENDER_API_KEY?: string | undefined;
}) {
  if (env.TASK_RUNNER === 'render') {
    if (!env.RENDER_API_KEY) throw new Error('RENDER_API_KEY is required when TASK_RUNNER=render');
    return new RenderTaskRunner({ apiKey: env.RENDER_API_KEY });
  }
  return new InlineTaskRunner({ awaitCompletion: false });
}
