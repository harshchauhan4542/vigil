// Anthropic client wired through Vigil's record/replay transport.
import Anthropic from '@anthropic-ai/sdk';
import { createReplayFetch, type FixtureStore } from '@vigil/replay';

export interface ClaudeClientOptions {
  mode: 'live' | 'replay';
  /** Required in live mode. Never logged or recorded. */
  apiKey?: string | undefined;
  store: FixtureStore;
  record?: boolean;
  baseURL?: string;
  baseFetch?: typeof fetch;
}

export function createClaudeClient(options: ClaudeClientOptions): Anthropic {
  if (options.mode === 'live' && !options.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required when VIGIL_MODE=live');
  }
  const transport = createReplayFetch({
    mode: options.mode,
    kind: 'llm',
    store: options.store,
    record: options.record ?? false,
    secrets: options.apiKey ? [options.apiKey] : [],
    ...(options.baseFetch ? { baseFetch: options.baseFetch } : {}),
  });
  return new Anthropic({
    apiKey: options.mode === 'live' ? options.apiKey! : 'replay-mode-no-key',
    fetch: transport,
    // Replay must be deterministic: never retry into a different fixture occurrence.
    maxRetries: options.mode === 'replay' ? 0 : 2,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
  });
}
