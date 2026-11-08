// Canonical JSON (sorted keys, no whitespace) and SHA-256 hashes over it.
// Approvals are bound to `paramsHash(params)`, so the hash must not depend on key order.
import { createHash } from 'node:crypto';

export class CanonicalJsonError extends Error {
  override name = 'CanonicalJsonError';
}

function encode(value: unknown, path: string): string | undefined {
  if (value === null) return 'null';
  if (value !== undefined && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return encode((value as { toJSON(): unknown }).toJSON(), path);
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalJsonError(`Non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'undefined':
      return undefined;
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new CanonicalJsonError(`Unsupported ${typeof value} at ${path}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v, i) => encode(v, `${path}[${i}]`) ?? 'null').join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const encoded = encode(obj[key], `${path}.${key}`);
    if (encoded !== undefined) parts.push(`${JSON.stringify(key)}:${encoded}`);
  }
  return `{${parts.join(',')}}`;
}

/** Deterministic JSON: object keys sorted (code-unit order), undefined properties dropped. */
export function canonicalJson(value: unknown): string {
  const out = encode(value, '$');
  if (out === undefined) throw new CanonicalJsonError('Top-level value is undefined');
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** SHA-256 (hex, 64 chars) of the canonical JSON of the params. */
export function paramsHash(params: unknown): string {
  return sha256Hex(canonicalJson(params));
}
