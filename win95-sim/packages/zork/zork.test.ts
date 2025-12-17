/**
 * Tests for the Zork package.
 *
 * Basic tests to verify Zork files are present.
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Zork I', () => {
  it('should have ZORK1.COM', () => {
    const binary = loadPackageFile(__dirname, 'ZORK1.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('ZORK1.COM:', binary?.length, 'bytes');
  });

  it('should have ZORK1.DAT', () => {
    const data = loadPackageFile(__dirname, 'ZORK1.DAT');
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);
    console.log('ZORK1.DAT:', data?.length, 'bytes');
  });
});
