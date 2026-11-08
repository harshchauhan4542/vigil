// Live sandbox smoke test: fetch an OAuth token (never printed).
// Usage: pnpm paypal:smoke  (needs PAYPAL_CLIENT_ID and PAYPAL_SECRET in .env)
import { ConfigError, loadPayPalLiveEnv } from '@vigil/config';
import { createPayPalClient } from '@vigil/paypal';

try {
  const env = loadPayPalLiveEnv();
  const { tokens } = await createPayPalClient({
    clientId: env.PAYPAL_CLIENT_ID,
    secret: env.PAYPAL_SECRET,
    baseUrl: env.PAYPAL_BASE_URL,
  });
  const token = await tokens.getToken();
  const hours = ((token.expiresAt - Date.now()) / 3_600_000).toFixed(1);
  const scopes = token.scope?.split(' ').length ?? 0;
  console.log(`PayPal token OK: ${env.PAYPAL_BASE_URL}, expires in ${hours} h, ${scopes} scopes.`);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`${error.message}\nAdd the missing values to vigil/.env (see .env.example).`);
  } else {
    console.error(`PayPal smoke test failed: ${(error as Error).message}`);
  }
  process.exit(1);
}
