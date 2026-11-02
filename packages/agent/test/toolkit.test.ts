import { describe, expect, it } from 'vitest';
import { toClaudeTool } from '../src/tool.js';
import { createToolkitTools } from '../src/toolkit-adapter.js';

describe('toolkit adapter (quarantined)', () => {
  it('exposes only read-only PayPal toolkit tools, as non-strict Claude tools', () => {
    const tools = createToolkitTools({ clientId: 'id', secret: 'secret', sandbox: true });
    const names = tools.map((t) => t.name).sort();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^(get_|list_|show_|search_)/);
    for (const forbidden of [
      'create_refund',
      'pay_order',
      'cancel_subscription',
      'accept_dispute_claim',
      'create_order',
      'send_invoice',
    ])
      expect(names).not.toContain(forbidden);
    const claude = tools.map(toClaudeTool);
    expect(claude.every((t) => t.strict === undefined && t.input_schema.type === 'object')).toBe(
      true,
    );
  });
});
