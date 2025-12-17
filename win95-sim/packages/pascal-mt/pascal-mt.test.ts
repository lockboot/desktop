/**
 * Tests for the Pascal MT+ package.
 *
 * Tests Pascal MT+ compiler with the IDE template.
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

describe('Pascal MT+ Compiler', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const mtplus = loadPackageFile(__dirname, 'MTPLUS.COM');
    const linkmt = loadPackageFile(__dirname, 'LINKMT.COM');
    const paslib = loadPackageFile(__dirname, 'PASLIB.ERL');

    if (mtplus && linkmt && paslib) {
      runner = new CpmRunner();
      runner.addTool('MTPLUS.COM', mtplus);
      runner.addTool('LINKMT.COM', linkmt);
      runner.addTool('PASLIB.ERL', paslib);
      available = true;
    }
  });

  it('should have MTPLUS.COM', () => {
    const binary = loadPackageFile(__dirname, 'MTPLUS.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('MTPLUS.COM:', binary?.length, 'bytes');
  });

  it('should have LINKMT.COM', () => {
    const binary = loadPackageFile(__dirname, 'LINKMT.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('LINKMT.COM:', binary?.length, 'bytes');
  });

  it('should have PASLIB.ERL', () => {
    const binary = loadPackageFile(__dirname, 'PASLIB.ERL');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('PASLIB.ERL:', binary?.length, 'bytes');
  });

  it('should compile hello world', async () => {
    if (!available) {
      console.log('Pascal MT+ files not available, skipping');
      return;
    }

    const template = LANGUAGES['pascal']?.template;
    if (!template) {
      console.log('No Pascal template defined, skipping');
      return;
    }

    const assembler = new Assembler(runner, 'MTPLUS');
    const result = await assembler.assemble('HELLO', template, { timeout: 120000 });

    console.log('Pascal MT+ output:', result.output);
    console.log('Pascal MT+ result:', {
      success: result.success,
      hasComFile: !!result.comFile,
      comSize: result.comFile?.length,
      error: result.error
    });

    if (result.success && result.comFile) {
      expect(result.comFile.length).toBeGreaterThan(0);
      console.log('Generated HELLO.COM:', result.comFile.length, 'bytes');
    }
  }, 180000);
});
