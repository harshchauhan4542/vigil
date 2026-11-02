import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@vigil/config', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@vigil/config');
  });
});
