/**
 * Tests for the XCCP package.
 *
 * Basic tests to verify XCCP shell and utilities are present.
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('XCCP Shell & Utilities', () => {
  it('should have XCCP.COM', () => {
    const binary = loadPackageFile(__dirname, 'xccp.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });

  it('should have DIR.COM', () => {
    const binary = loadPackageFile(__dirname, 'dir.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });

  it('should have ERA.COM', () => {
    const binary = loadPackageFile(__dirname, 'era.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });

  it('should have REN.COM', () => {
    const binary = loadPackageFile(__dirname, 'ren.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });

  it('should have D.COM', () => {
    const binary = loadPackageFile(__dirname, 'd.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });

  it('should have RM.COM', () => {
    const binary = loadPackageFile(__dirname, 'rm.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
  });
});
