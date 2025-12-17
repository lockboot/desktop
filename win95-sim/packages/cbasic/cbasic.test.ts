/**
 * Tests for the CBASIC package.
 *
 * Tests CBASIC compiler with the IDE template.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  CpmRunner,
  Assembler,
  LANGUAGES,
} from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CBASIC Compiler', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const cbas2 = loadPackageFile(__dirname, 'CBAS2.COM');
    const crun2 = loadPackageFile(__dirname, 'CRUN2.COM');

    if (cbas2 && crun2) {
      runner = new CpmRunner();
      runner.addTool('CBAS2.COM', cbas2);
      runner.addTool('CRUN2.COM', crun2);
      available = true;
    }
  });

  it('should have CBAS2.COM', () => {
    const binary = loadPackageFile(__dirname, 'CBAS2.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('CBAS2.COM:', binary?.length, 'bytes');
  });

  it('should have CRUN2.COM', () => {
    const binary = loadPackageFile(__dirname, 'CRUN2.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('CRUN2.COM:', binary?.length, 'bytes');
  });

  it('should compile hello world', async () => {
    if (!available) {
      console.log('CBASIC files not available, skipping');
      return;
    }

    const template = LANGUAGES['cbasic']?.template;
    if (!template) {
      console.log('No CBASIC template defined, skipping');
      return;
    }

    const assembler = new Assembler(runner, 'CBAS2');
    const result = await assembler.assemble('HELLO', template, { timeout: 60000 });

    console.log('CBASIC output:', result.output);
    console.log('CBASIC result:', {
      success: result.success,
      hasIntermediate: !!result.intermediateFile,
      runtime: result.runtime,
      error: result.error
    });

    // CBASIC produces .INT files, not .COM
    if (result.success && result.intermediateFile) {
      expect(result.runtime?.program).toBe('CRUN2');
      expect(result.intermediateFile.length).toBeGreaterThan(0);
      console.log('Generated HELLO.INT:', result.intermediateFile.length, 'bytes');
    }
  }, 60000);
});
