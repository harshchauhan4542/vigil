// Encrypts small secrets (the merchant's PayPal app keys) before they are stored in the database.
// AES-256-GCM with a key derived from SESSION_SECRET, so a database dump alone reveals nothing.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const INFO = 'vigil-settings-v1';

function keyFrom(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'vigil', INFO, 32));
}

/** Seal a JSON-serialisable value. Throws if the server secret is missing or too short. */
export function seal(value: unknown, secret: string | undefined): string {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Open a sealed value; null if it was sealed with another secret or was tampered with. */
export function unseal<T>(sealed: string, secret: string | undefined): T | null {
  if (!secret || secret.length < 32) return null;
  try {
    const raw = Buffer.from(sealed, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString(
      'utf8',
    );
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Constant-time passcode check (hash first so lengths don't leak). */
export function passcodeMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
