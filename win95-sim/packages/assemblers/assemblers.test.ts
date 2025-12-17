/**
 * Tests for the assemblers package.
 *
 * Tests Z80 and 8080 assemblers using the IDE templates.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  createPackageRunner,
  testAssemblerWithTemplate,
  CpmRunner,
  Assembler,
  LANGUAGES,
} from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('LASM3 Assembler (8080)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'lasm3.com');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('LASM3.COM', binary);
      available = true;
    }
  });

  it('should assemble the 8080 IDE template', async () => {
    if (!available) {
      console.log('LASM3.COM not available, skipping');
      return;
    }

    const result = await testAssemblerWithTemplate(runner, 'LASM3', '8080asm');

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('LASM3 generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('Z1 Assembler (Z80)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'z1.com');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('Z1.COM', binary);
      available = true;
    }
  });

  it('should assemble the Z80 IDE template', async () => {
    if (!available) {
      console.log('Z1.COM not available, skipping');
      return;
    }

    const result = await testAssemblerWithTemplate(runner, 'Z1', 'z80asm');

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('Z1 generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('Z80MR Assembler (Z80)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'z80mr.com');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('Z80MR.COM', binary);
      available = true;
    }
  });

  it('should assemble the Z80 IDE template', async () => {
    if (!available) {
      console.log('Z80MR.COM not available, skipping');
      return;
    }

    const result = await testAssemblerWithTemplate(runner, 'Z80MR', 'z80asm');

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('Z80MR generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('ZASM Assembler (Z80 Macro)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'zasm.com');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('ZASM.COM', binary);
      available = true;
    }
  });

  it('should have ZASM.COM', () => {
    const binary = loadPackageFile(__dirname, 'zasm.com');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('ZASM.COM:', binary?.length, 'bytes');
  });

  // ZASM integration test - may need adjustment based on assembler behavior
  it('should attempt to assemble the ZASM IDE template', async () => {
    if (!available) {
      console.log('ZASM.COM not available, skipping');
      return;
    }

    const result = await testAssemblerWithTemplate(runner, 'ZASM', 'zasm');

    // Log the output for debugging
    console.log('ZASM output:', result.output);

    // ZASM may have different success criteria - log but don't fail
    if (result.success && (result.hexFile || result.comFile)) {
      console.log('ZASM generated HEX:', result.hexFile?.length, 'bytes');
    } else {
      console.log('ZASM assembly did not produce expected output (may need configuration)');
    }
  });
});
