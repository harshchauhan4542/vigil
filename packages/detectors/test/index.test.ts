import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@vigil/detectors', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@vigil/detectors');
  });
});
