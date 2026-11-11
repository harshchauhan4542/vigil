import { createTestDb, type DbHandle } from '@vigil/db';
import { MemoryCache, createPayPalClient, type PayPalHttp } from '@vigil/paypal';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { BASE, FakePayPal } from '../src/testing/fake-paypal.js';

export interface TestEnv {
  server: ReturnType<typeof setupServer>;
  fake: FakePayPal;
  handle: DbHandle;
  http: PayPalHttp;
}

/** Fresh PGlite + fake PayPal per test. */
export function useTestEnv(): TestEnv {
  const server = setupServer();
  const env = { server } as TestEnv;
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());
  beforeEach(async () => {
    env.fake = new FakePayPal();
    server.use(...env.fake.handlers());
    env.handle = await createTestDb();
    ({ http: env.http } = await createPayPalClient({
      clientId: 'c',
      secret: 's',
      baseUrl: BASE,
      cache: new MemoryCache(),
      sleep: async () => {},
    }));
  });
  afterEach(async () => {
    server.resetHandlers();
    await env.handle.close();
  });
  return env;
}
