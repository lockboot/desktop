/**
 * Tests for the CBASIC package.
 *
 * Tests CBASIC compiler with the IDE template.
 * Also tests manifest actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  CpmRunner,
  Assembler,
  LANGUAGES,
  runInterpretedProgram,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
  expandSubmitTemplate,
} from '../test-utils';
import type { PackageAction } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CBASIC Compiler', () => {
  let runner: CpmRunner;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const cbas2 = loadPackageFile(__dirname, 'CBAS2.COM');
    const crun2 = loadPackageFile(__dirname, 'CRUN2.COM');

    if (cbas2 && crun2) {
      runner = new CpmRunner();
      runner.addTool('CBAS2.COM', cbas2);
      runner.addTool('CRUN2.COM', crun2);
      available = true;
    }

    // Get the cbas2 action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'cbas2');
  });

  describe('manifest action', () => {
    it('should have cbas2 action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('cbas2');
      expect(action!.name).toBe('CBASIC');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .BAS files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'HELLO.BAS')).toBe(true);
      expect(actionMatchesFile(action!, 'test.bas')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.C')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('INT');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'A');
      expect(cmd).toBe('CBAS2 A:HELLO\r');
    });
  });

  describe('package files', () => {
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
  });

  describe('compilation', () => {
    it('should compile hello world', async () => {
      expect(available).toBe(true);

      const template = LANGUAGES['cbasic']?.template;
      expect(template).toBeDefined();

      const assembler = new Assembler(runner, 'CBAS2');
      const result = await assembler.assemble('HELLO', template!, { timeout: 5000 });

      console.log('CBASIC output:', result.output);

      // CBASIC produces .INT files, not .COM
      expect(result.success).toBe(true);
      expect(result.intermediateFile).toBeDefined();
      expect(result.intermediateFile!.length).toBeGreaterThan(0);
      expect(result.runtime?.program).toBe('CRUN2');
      console.log('Generated HELLO.INT:', result.intermediateFile!.length, 'bytes');
    }, 10000);

    it('should run the compiled program via CRUN2 and produce correct output', async () => {
      expect(available).toBe(true);

      // Compile the template
      const template = LANGUAGES['cbasic']?.template;
      expect(template).toBeDefined();

      const assembler = new Assembler(runner, 'CBAS2');
      const result = await assembler.assemble('HELLO', template!, { timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.intermediateFile).toBeDefined();

      // Run the compiled program via CRUN2 runtime
      // Template prints "Hello, World!" first, then asks for name
      const runResult = await runInterpretedProgram(
        runner,
        'CRUN2',
        'HELLO',
        ['Claude'],  // Input: name = Claude
        5000
      );

      console.log('Program output:', runResult.output);
      expect(runResult.success).toBe(true);
      // Check for expected output
      expect(runResult.output).toContain('Hello, World!');
      expect(runResult.output).toContain('Hello, Claude!');
    }, 15000);
  });
});
