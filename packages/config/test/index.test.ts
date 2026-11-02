import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  loadDbEnv,
  loadPayPalLiveEnv,
  loadWebEnv,
  loadWorkflowsEnv,
} from '../src/index.js';

const SECRET = 'x'.repeat(32);
const webBase = { APPROVAL_HMAC_SECRET: SECRET, SESSION_SECRET: SECRET };

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return [...e.issues];
    throw e;
  }
  throw new Error('expected ConfigError');
}

describe('config loaders', () => {
  it('applies defaults in replay mode with zero keys', () => {
    const env = loadWebEnv(webBase);
    expect(env.VIGIL_MODE).toBe('replay');
    expect(env.PAYPAL_BASE_URL).toBe('https://api-m.sandbox.paypal.com');
    expect(env.EXECUTION_ENABLED).toBe(true);
    expect(env.POLICY_PER_ACTION_CAP_USD).toBe(500);
    expect(env.POLICY_DAILY_CAP_USD).toBe(2000);
    expect(env.TASK_RUNNER).toBe('inline');
    expect(env.VIGIL_MODEL_INTERACTIVE).toBe('claude-sonnet-5');
  });

  it('treats empty strings as unset', () => {
    const env = loadWebEnv({ ...webBase, PAYPAL_BASE_URL: '', EXECUTION_ENABLED: '' });
    expect(env.PAYPAL_BASE_URL).toBe('https://api-m.sandbox.paypal.com');
    expect(env.EXECUTION_ENABLED).toBe(true);
  });

  it('names every missing key in live mode', () => {
    const issues = issuesOf(() => loadWebEnv({ ...webBase, VIGIL_MODE: 'live' }));
    expect(issues.join('\n')).toContain('PAYPAL_CLIENT_ID is missing');
    expect(issues.join('\n')).toContain('PAYPAL_SECRET is missing');
    expect(issues.join('\n')).toContain('ANTHROPIC_API_KEY is missing');
  });

  it('requires and length-checks secrets', () => {
    expect(issuesOf(() => loadWebEnv({})).join('\n')).toMatch(/APPROVAL_HMAC_SECRET is missing/);
    expect(issuesOf(() => loadWebEnv({ ...webBase, SESSION_SECRET: 'short' })).join('\n')).toMatch(
      /SESSION_SECRET must be at least 32/,
    );
  });

  it('rejects invalid values without echoing them', () => {
    const err = issuesOf(() =>
      loadWebEnv({ ...webBase, VIGIL_MODE: 'prod', POLICY_DAILY_CAP_USD: '-5' }),
    ).join('\n');
    expect(err).toContain('VIGIL_MODE');
    expect(err).toContain('POLICY_DAILY_CAP_USD');
    expect(err).not.toContain(SECRET);
  });

  it('parses booleans strictly', () => {
    expect(loadWebEnv({ ...webBase, EXECUTION_ENABLED: 'false' }).EXECUTION_ENABLED).toBe(false);
    expect(loadWebEnv({ ...webBase, EXECUTION_ENABLED: '0' }).EXECUTION_ENABLED).toBe(false);
    expect(() => loadWebEnv({ ...webBase, EXECUTION_ENABLED: 'yes' })).toThrow(ConfigError);
  });

  it('workflows need the approval secret', () => {
    expect(issuesOf(() => loadWorkflowsEnv({})).join('\n')).toMatch(/APPROVAL_HMAC_SECRET/);
    expect(loadWorkflowsEnv({ APPROVAL_HMAC_SECRET: SECRET }).VIGIL_MODE).toBe('replay');
  });

  it('scripts always need PayPal credentials', () => {
    const issues = issuesOf(() => loadPayPalLiveEnv({}));
    expect(issues).toEqual(['PAYPAL_CLIENT_ID is missing', 'PAYPAL_SECRET is missing']);
    expect(loadPayPalLiveEnv({ PAYPAL_CLIENT_ID: 'id', PAYPAL_SECRET: 's' }).PAYPAL_CLIENT_ID).toBe(
      'id',
    );
  });

  it('db env defaults to PGlite', () => {
    const env = loadDbEnv({});
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.PGLITE_DIR).toBe('.data/pglite');
  });
});
