import type { AgAiRunInput, AgLlmRequest } from 'ag-studio';
import { describe, expect, it } from 'vitest';
import { responseToEvents } from '../app/control-room/studio/anthropic-adapter';
import { lastUserText, toAgUi } from '../app/control-room/studio/vigil-ops-agent';
import { fromClaudeResult, toClaudeParams } from '../lib/studio-ai';

const req = (over: Partial<AgLlmRequest> = {}): AgLlmRequest =>
  ({
    instructions: 'You build dashboards.',
    responseFormat: { type: 'text' },
    input: [
      {
        id: 's',
        kind: 'input',
        type: 'message',
        role: 'system',
        status: 'completed',
        content: [{ type: 'text', text: 'Studio context' }],
      },
      {
        id: 'u1',
        kind: 'input',
        type: 'message',
        role: 'user',
        status: 'completed',
        content: [{ type: 'text', text: 'Chart money at risk' }],
      },
      {
        id: 'c1',
        kind: 'output',
        type: 'function_call',
        callId: 'call_1',
        name: 'studio_addWidget',
        arguments: '{"type":"bar"}',
      },
      {
        kind: 'input',
        type: 'function_call_output',
        callId: 'call_1',
        output: 'added',
        status: 'completed',
      },
      {
        id: 'a1',
        kind: 'output',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: 'Done.', annotations: [] }],
      },
    ],
    tools: [
      {
        name: 'studio_addWidget',
        description: 'Add a widget',
        parameters: { type: 'object', properties: { type: { type: 'string' } } },
      },
    ],
    toolChoice: 'auto',
    ...over,
  }) as AgLlmRequest;

describe('AgLlmRequest → Claude', () => {
  it('maps instructions + system items to system, tool calls to tool_use/tool_result pairs', () => {
    const p = toClaudeParams(req());
    expect(p.system).toBe('You build dashboards.\n\nStudio context');
    expect(p.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Chart money at risk' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'call_1', name: 'studio_addWidget', input: { type: 'bar' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'added' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    ]);
    expect(p.tools?.[0]).toMatchObject({
      name: 'studio_addWidget',
      input_schema: { type: 'object' },
    });
    expect(p.tool_choice).toEqual({ type: 'auto' });
  });

  it.each([
    ['none', { type: 'none' }],
    ['required', { type: 'any' }],
    [{ name: 'studio_addWidget' }, { type: 'tool', name: 'studio_addWidget' }],
  ] as const)('tool choice %j → %j', (tc, want) => {
    expect(
      toClaudeParams(req({ toolChoice: tc as AgLlmRequest['toolChoice'] })).tool_choice,
    ).toEqual(want);
  });

  it('JSON response formats use structured output when no tools are offered', () => {
    const p = toClaudeParams(
      req({ tools: [], responseFormat: { type: 'json', name: 'x', schema: { type: 'object' } } }),
    );
    expect(p.output_config).toEqual({
      format: { type: 'json_schema', schema: { type: 'object' } },
    });
    expect(p.tools).toBeUndefined();
  });
});

describe('Claude → AgLlmResponse', () => {
  it('maps text and tool_use, usage and stop reasons', () => {
    const r = fromClaudeResult(
      {
        id: 'msg_1',
        model: 'claude-sonnet-5',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Adding a chart.' },
          { type: 'tool_use', id: 'toolu_1', name: 'studio_addWidget', input: { type: 'bar' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      1,
    );
    expect(r).toMatchObject({
      id: 'msg_1',
      status: 'completed',
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    expect(r.output.map((o) => o.type)).toEqual(['message', 'function_call']);
    expect(r.output[1]).toMatchObject({ callId: 'toolu_1', arguments: '{"type":"bar"}' });
    expect(responseToEvents(r).map((e) => e.type)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ]);
    const cut = fromClaudeResult({
      id: 'm',
      model: 'x',
      stop_reason: 'max_tokens',
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect(cut).toMatchObject({
      status: 'incomplete',
      incompleteDetails: { reason: 'max_output_tokens' },
    });
    expect(
      fromClaudeResult({
        id: 'm',
        model: 'x',
        stop_reason: 'refusal',
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }).status,
    ).toBe('failed');
  });
});

describe('Vigil Ops agent: server events → AG-UI', () => {
  const input = {
    threadId: 't1',
    runId: 'r1',
    messages: [
      {
        id: 'u',
        kind: 'input',
        type: 'message',
        role: 'user',
        status: 'completed',
        content: [{ type: 'text', text: 'What needs attention?' }],
      },
    ],
    tools: [],
    state: null,
    context: [],
    forwardedProps: {},
  } as unknown as AgAiRunInput;

  it('takes the latest user text', () => {
    expect(lastUserText(input)).toBe('What needs attention?');
  });

  it('streams text, tool calls, the policy verdict and finishes the run', async () => {
    async function* server() {
      yield { event: 'run_started', data: { runId: 'x' } };
      yield {
        event: 'tool_call',
        data: { id: 'tu1', name: 'get_exception', input: { exception_id: 'e' } },
      };
      yield { event: 'tool_result', data: { id: 'tu1', isError: false } };
      yield { event: 'text', data: { delta: 'Capture the $48 hold.' } };
      yield { event: 'policy', data: { proposalId: '0190abcd-0000', verdict: 'PASS', tier: 2 } };
      yield { event: 'done', data: {} };
    }
    const types = [];
    let text = '';
    for await (const e of toAgUi(input, server())) {
      types.push(e.type);
      if (e.type === 'TEXT_MESSAGE_CONTENT') text += e.delta;
    }
    expect(types).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      'TOOL_CALL_RESULT',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    expect(text).toContain('policy: PASS (T2)');
  });

  it('turns a server error into RUN_ERROR', async () => {
    async function* server() {
      yield { event: 'error', data: { message: 'budget' } };
    }
    const out = [];
    for await (const e of toAgUi(input, server())) out.push(e);
    expect(out.at(-1)).toEqual({ type: 'RUN_ERROR', message: 'budget' });
  });
});
