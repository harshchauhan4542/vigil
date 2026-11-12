import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, POST } from '../app/api/settings/paypal/route';
import { resetGuardsForTests } from '../lib/guards';
import { passcodeMatches, seal, unseal } from '../lib/secret-box';

const SECRET = 'x'.repeat(40);

describe('secret box', () => {
  it('round-trips with the same server secret', () => {
    const sealed = seal({ clientId: 'abc', secret: 'shh' }, SECRET);
    expect(sealed).not.toContain('shh');
    expect(unseal(sealed, SECRET)).toEqual({ clientId: 'abc', secret: 'shh' });
  });

  it('refuses another secret or a tampered value', () => {
    const sealed = seal({ secret: 'shh' }, SECRET);
    expect(unseal(sealed, 'y'.repeat(40))).toBeNull();
    const raw = Buffer.from(sealed, 'base64');
    raw[raw.length - 1]! ^= 1;
    expect(unseal(raw.toString('base64'), SECRET)).toBeNull();
  });

  it('will not seal without a long server secret', () => {
    expect(() => seal({}, 'short')).toThrow(/SESSION_SECRET/);
    expect(() => seal({}, undefined)).toThrow(/SESSION_SECRET/);
  });

  it('checks the passcode exactly', () => {
    expect(passcodeMatches('open-sesame', 'open-sesame')).toBe(true);
    expect(passcodeMatches('open-sesam', 'open-sesame')).toBe(false);
    expect(passcodeMatches('anything', undefined)).toBe(false);
  });
});

describe('PayPal settings API is locked down', () => {
  const saved = process.env.ADMIN_PASSCODE;
  beforeEach(() => resetGuardsForTests());
  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_PASSCODE;
    else process.env.ADMIN_PASSCODE = saved;
  });

  const call = (handler: typeof POST, body: unknown) =>
    handler(
      new Request('http://localhost/api/settings/paypal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify(body),
      }),
    );

  it('refuses every change when no admin passcode is configured', async () => {
    delete process.env.ADMIN_PASSCODE;
    expect((await call(POST, { passcode: 'whatever', clientId: 'a', secret: 'b' })).status).toBe(
      403,
    );
    expect((await call(DELETE, { passcode: 'whatever' })).status).toBe(403);
  });

  it('refuses a wrong passcode', async () => {
    process.env.ADMIN_PASSCODE = 'correct-horse';
    const res = await call(POST, { passcode: 'wrong-horse', clientId: 'a', secret: 'b' });
    expect(res.status).toBe(401);
  });

  it('rejects malformed keys before contacting PayPal', async () => {
    process.env.ADMIN_PASSCODE = 'correct-horse';
    const res = await call(POST, { passcode: 'correct-horse', clientId: 'short', secret: 'x' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid');
  });
});
