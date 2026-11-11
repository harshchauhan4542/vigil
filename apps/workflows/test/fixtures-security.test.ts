// Security pass: committed fixtures must never contain credentials, tokens or card data.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const PATTERNS: [string, RegExp][] = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{10,}/],
  ['PayPal access token', /A21AA[A-Za-z0-9_-]{20,}/],
  ['Bearer credential', /Bearer [A-Za-z0-9._~+/=-]{20,}/],
  ['Basic credential', /Basic [A-Za-z0-9+/=]{20,}/],
  ['card number', /\b4[0-9]{15}\b/],
  [
    'secret-looking key',
    /"(access_token|client_secret|refresh_token|password)":\s*"(?!\[SCRUBBED\])[^"]+"/,
  ],
];

it('fixtures contain no secrets (the test-only webhook key is the documented exception)', () => {
  const offenders: string[] = [];
  for (const f of files(root)) {
    if (f.endsWith(path.join('webhooks', 'test-key.pem'))) continue;
    const text = readFileSync(f, 'utf8');
    for (const [name, re] of PATTERNS)
      if (re.test(text)) offenders.push(`${path.relative(root, f)}: ${name}`);
  }
  expect(offenders).toEqual([]);
});
