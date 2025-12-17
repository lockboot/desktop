/**
 * Tests for the utilities package.
 *
 * Verifies utility programs are present.
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CP/M Utilities', () => {
  it('should have MAKE.COM', () => {
    const binary = loadPackageFile(__dirname, 'make.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('MAKE.COM:', binary?.length, 'bytes');
  });

  it('should have PMAKE.COM', () => {
    const binary = loadPackageFile(__dirname, 'pmake.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('PMAKE.COM:', binary?.length, 'bytes');
  });

  it('should have RM.COM', () => {
    const binary = loadPackageFile(__dirname, 'rm.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('RM.COM:', binary?.length, 'bytes');
  });

  it('should have PSET.COM', () => {
    const binary = loadPackageFile(__dirname, 'pset.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('PSET.COM:', binary?.length, 'bytes');
  });
});
