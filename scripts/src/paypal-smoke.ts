// Live sandbox smoke test: fetch an OAuth token (never printed), then create and read one order.
// Usage: pnpm paypal:smoke  (needs PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env)
import { randomUUID } from 'node:crypto';
import { ConfigError, loadPayPalLiveEnv } from '@vigil/config';
import { createPayPalClient, reads } from '@vigil/paypal';
import { createOrder } from '@vigil/paypal/sandbox-setup';

try {
  const env = loadPayPalLiveEnv();
  const { tokens, http } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    secret: env.PAYPAL_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
  });
  const token = await tokens.getToken();
  const hours = ((token.expiresAt - Date.now()) / 3_600_000).toFixed(1);
  const scopes = token.scope?.split(' ').length ?? 0;
  console.log(`PayPal token OK: ${env.PAYPAL_BASE_URL}, expires in ${hours} h, ${scopes} scopes.`);

  const created = await createOrder(
    http,
    {
      intent: 'CAPTURE',
      amount: { currency_code: 'USD', value: '1.00' },
      custom_id: 'vigil-smoke',
      return_url: 'https://example.com/return',
      cancel_url: 'https://example.com/cancel',
    },
    { requestId: randomUUID() },
  );
  const order = await reads.getOrder(http, created.id);
  console.log(`Order create + read OK: ${order.id} (${order.status}, ${order.intent}).`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`${error.message}\nAdd the missing values to vigil/.env (see .env.example).`);
  } else {
    console.error(`PayPal smoke test failed: ${(error as Error).message}`);
  }
  process.exit(1);
}
