// @paypal/paypal-server-sdk (APIMatic-generated) client, sharing Vigil's cached OAuth token.
// See docs/spikes.md: Vigil's own calls go through http.ts (one transport for logging, error
// mapping and replay); the SDK is available for Orders, Payments, Subscriptions and
// Transaction Search where a typed controller is convenient.
import {
  Client,
  Environment,
  LogLevel,
  OrdersController,
  PaymentsController,
  SubscriptionsController,
  TransactionSearchController,
} from '@paypal/paypal-server-sdk';
import type { TokenProvider } from './token.js';

export interface PayPalSdk {
  client: Client;
  orders: OrdersController;
  payments: PaymentsController;
  subscriptions: SubscriptionsController;
  transactionSearch: TransactionSearchController;
}

export function createPayPalSdk(options: {
  clientId: string;
  secret: string;
  baseUrl: string;
  tokens: TokenProvider;
  timeoutMs?: number;
}): PayPalSdk {
  const environment = options.baseUrl.includes('sandbox')
    ? Environment.Sandbox
    : Environment.Production;
  const client = new Client({
    environment,
    timeout: options.timeoutMs ?? 30_000,
    clientCredentialsAuthCredentials: {
      oAuthClientId: options.clientId,
      oAuthClientSecret: options.secret,
      // Reuse Vigil's token cache instead of letting the SDK fetch its own.
      oAuthTokenProvider: async () => {
        const token = await options.tokens.getToken();
        return {
          accessToken: token.accessToken,
          tokenType: token.tokenType,
          expiry: BigInt(Math.floor(token.expiresAt / 1000)),
        };
      },
    },
    logging: {
      logLevel: LogLevel.Warn,
      logRequest: { logBody: false },
      logResponse: { logBody: false },
    },
  });
  return {
    client,
    orders: new OrdersController(client),
    payments: new PaymentsController(client),
    subscriptions: new SubscriptionsController(client),
    transactionSearch: new TransactionSearchController(client),
  };
}
