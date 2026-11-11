// PayPal webhook verification (developer.paypal.com/api/rest/webhooks/rest/).
//  1. Postback: POST /v1/notifications/verify-webhook-signature with the event exactly as received.
//  2. Self-verification: signature over `transmission_id|transmission_time|webhook_id|crc32(raw body)`
//     (CRC32 in decimal, over the unparsed bytes), SHA256withRSA, cert only from a PayPal host.
//  3. Dashboard-simulated events are signed with the literal webhook id "WEBHOOK_ID"; if allowed,
//     they verify as `simulated` and must never settle a real proposal.
import { X509Certificate, verify as cryptoVerify } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { PayPalHttp } from './http.js';

export const SIMULATOR_WEBHOOK_ID = 'WEBHOOK_ID';

export interface TransmissionHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

type HeaderSource = Headers | Record<string, string | undefined>;

function header(h: HeaderSource, name: string): string | undefined {
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  return key ? h[key] : undefined;
}

export function transmissionHeaders(h: HeaderSource): TransmissionHeaders | null {
  const t = {
    transmissionId: header(h, 'paypal-transmission-id'),
    transmissionTime: header(h, 'paypal-transmission-time'),
    transmissionSig: header(h, 'paypal-transmission-sig'),
    certUrl: header(h, 'paypal-cert-url'),
    authAlgo: header(h, 'paypal-auth-algo'),
  };
  return Object.values(t).every((v) => typeof v === 'string' && v.length > 0)
    ? (t as TransmissionHeaders)
    : null;
}

/** The string PayPal signs. */
export function signedMessage(
  t: TransmissionHeaders,
  webhookId: string,
  rawBody: Uint8Array,
): string {
  return `${t.transmissionId}|${t.transmissionTime}|${webhookId}|${crc32(rawBody) >>> 0}`;
}

/** Only fetch signing certificates from PayPal over HTTPS. */
export function isPayPalCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' && (u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'))
    );
  } catch {
    return false;
  }
}

export class CertCache {
  private readonly certs = new Map<string, Promise<string>>();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  get(url: string): Promise<string> {
    if (!isPayPalCertUrl(url))
      return Promise.reject(new Error(`Refusing to fetch a certificate from ${url}`));
    let hit = this.certs.get(url);
    if (!hit) {
      hit = this.fetchImpl(url).then(async (r) => {
        if (!r.ok) throw new Error(`Certificate fetch failed: HTTP ${r.status}`);
        return r.text();
      });
      hit.catch(() => this.certs.delete(url));
      this.certs.set(url, hit);
    }
    return hit;
  }
}

export function selfVerify(
  t: TransmissionHeaders,
  webhookId: string,
  rawBody: Uint8Array,
  certPem: string,
): boolean {
  if (!/SHA256withRSA/i.test(t.authAlgo)) return false;
  try {
    const cert = new X509Certificate(certPem);
    if (new Date(cert.validTo) < new Date()) return false;
    return cryptoVerify(
      'sha256',
      Buffer.from(signedMessage(t, webhookId, rawBody)),
      cert.publicKey,
      Buffer.from(t.transmissionSig, 'base64'),
    );
  } catch {
    return false;
  }
}

export async function postbackVerify(
  http: PayPalHttp,
  t: TransmissionHeaders,
  webhookId: string,
  rawBody: Uint8Array,
): Promise<boolean> {
  const head = JSON.stringify({
    auth_algo: t.authAlgo,
    cert_url: t.certUrl,
    transmission_id: t.transmissionId,
    transmission_sig: t.transmissionSig,
    transmission_time: t.transmissionTime,
    webhook_id: webhookId,
  });
  // The event goes back byte-for-byte as received (re-serialising could break the signature).
  const body = `${head.slice(0, -1)},"webhook_event":${Buffer.from(rawBody).toString('utf8')}}`;
  const res = await http.request<{ verification_status?: string }>({
    method: 'POST',
    path: '/v1/notifications/verify-webhook-signature',
    operation: 'webhooks.verify',
    rawJsonBody: body,
  });
  return res.data?.verification_status === 'SUCCESS';
}

export interface VerifyResult {
  verified: boolean;
  method: 'postback' | 'self' | 'self_simulated' | 'none';
  simulated: boolean;
  reason?: string;
}

export async function verifyWebhook(options: {
  http: PayPalHttp;
  headers: HeaderSource;
  rawBody: Uint8Array;
  webhookId: string | undefined;
  allowSimulated: boolean;
  certs: CertCache;
  /** Skip the postback (offline tests, or when PayPal is unreachable). */
  postback?: boolean;
}): Promise<VerifyResult> {
  const t = transmissionHeaders(options.headers);
  if (!t)
    return {
      verified: false,
      method: 'none',
      simulated: false,
      reason: 'missing PAYPAL-* transmission headers',
    };
  if (!isPayPalCertUrl(t.certUrl))
    return {
      verified: false,
      method: 'none',
      simulated: false,
      reason: 'cert url is not a PayPal host',
    };

  if (options.webhookId && options.postback !== false) {
    try {
      if (await postbackVerify(options.http, t, options.webhookId, options.rawBody)) {
        return { verified: true, method: 'postback', simulated: false };
      }
    } catch {
      // fall through to self-verification
    }
  }
  let certPem: string;
  try {
    certPem = await options.certs.get(t.certUrl);
  } catch (error) {
    return { verified: false, method: 'none', simulated: false, reason: (error as Error).message };
  }
  if (options.webhookId && selfVerify(t, options.webhookId, options.rawBody, certPem)) {
    return { verified: true, method: 'self', simulated: false };
  }
  if (options.allowSimulated && selfVerify(t, SIMULATOR_WEBHOOK_ID, options.rawBody, certPem)) {
    return { verified: true, method: 'self_simulated', simulated: true };
  }
  return { verified: false, method: 'none', simulated: false, reason: 'signature did not verify' };
}
