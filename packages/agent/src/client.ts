// Anthropic client wired through Vigil's record/replay transport.
import Anthropic from '@anthropic-ai/sdk';
import { createReplayFetch, type FixtureStore } from '@vigil/replay';
import { createOpenAICompatClient } from './openai-compat.js';

export interface ClaudeClientOptions {
  mode: 'live' | 'replay';
  /** Required in live mode. Never logged or recorded. */
  apiKey?: string | undefined;
  store: FixtureStore;
  record?: boolean;
  baseURL?: string;
  baseFetch?: typeof fetch;
}

export interface LlmEnv {
  LLM_PROVIDER: 'anthropic' | 'openai';
  ANTHROPIC_API_KEY?: string | undefined;
  LLM_API_KEY?: string | undefined;
  LLM_BASE_URL?: string | undefined;
  LLM_MAX_OUTPUT_TOKENS: number;
}

/** Whether a Live-mode model is configured for the chosen provider. */
export function llmConfigured(env: LlmEnv): boolean {
  return env.LLM_PROVIDER === 'openai'
    ? !!(env.LLM_API_KEY && env.LLM_BASE_URL)
    : !!env.ANTHROPIC_API_KEY;
}

/**
 * The agent's model client. Replay always uses the Claude-format client because the shipped
 * Replay world was recorded in that format; Live uses the provider chosen by LLM_PROVIDER.
 * Returns null in Live when the provider has no key (callers then disable AI features).
 */
export function createLlmClient(
  env: LlmEnv,
  options: { mode: 'live' | 'replay'; store: FixtureStore; record?: boolean },
): Anthropic | null {
  if (options.mode === 'replay') {
    return createClaudeClient({ mode: 'replay', store: options.store });
  }
  if (!llmConfigured(env)) return null;
  if (env.LLM_PROVIDER === 'openai') {
    return createOpenAICompatClient({
      mode: 'live',
      baseURL: env.LLM_BASE_URL!,
      apiKey: env.LLM_API_KEY,
      store: options.store,
      record: options.record ?? false,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    });
  }
  return createClaudeClient({
    mode: 'live',
    apiKey: env.ANTHROPIC_API_KEY,
    store: options.store,
    record: options.record ?? false,
  });
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
