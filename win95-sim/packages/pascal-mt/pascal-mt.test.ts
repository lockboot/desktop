/**
 * Tests for the Pascal MT+ package.
 *
 * Tests Pascal MT+ compiler with the IDE template.
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
  verifyProgramOutput,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
  expandSubmitTemplate,
} from '../test-utils';
import type { PackageAction } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Pascal MT+ Compiler', () => {
  let runner: CpmRunner;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const mtplus = loadPackageFile(__dirname, 'MTPLUS.COM');
    const linkmt = loadPackageFile(__dirname, 'LINKMT.COM');
    const paslib = loadPackageFile(__dirname, 'PASLIB.ERL');
    const mterrs = loadPackageFile(__dirname, 'MTERRS.TXT');
    const overlays = [0, 1, 2, 3, 4, 5, 6].map(n =>
      loadPackageFile(__dirname, `MTPLUS.00${n}`)
    );

    if (mtplus && linkmt && paslib && mterrs && overlays.every(o => o)) {
      runner = new CpmRunner();
      runner.addTool('MTPLUS.COM', mtplus);
      runner.addTool('LINKMT.COM', linkmt);
      runner.addTool('PASLIB.ERL', paslib);
      runner.addTool('MTERRS.TXT', mterrs);
      overlays.forEach((o, i) => runner.addTool(`MTPLUS.00${i}`, o!));
      available = true;
    }

    // Get the mtplus action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'mtplus');
  });

  describe('manifest action', () => {
    it('should have mtplus action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('mtplus');
      expect(action!.name).toBe('Pascal MT+');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .PAS files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'HELLO.PAS')).toBe(true);
      expect(actionMatchesFile(action!, 'test.pas')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.C')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'A');
      expect(cmd).toBe('MTPLUS A:HELLO\rLINKMT A:HELLO,B:PASLIB/S\r');
    });
  });

  describe('package files', () => {
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
  });

  describe('compilation', () => {
    it('should compile hello world', async () => {
      expect(available).toBe(true);

      const template = LANGUAGES['pascal']?.template;
      expect(template).toBeDefined();

      const assembler = new Assembler(runner, 'MTPLUS');
      const result = await assembler.assemble('HELLO', template!, { timeout: 5000 });

      console.log('Pascal MT+ output:', result.output);

      expect(result.success).toBe(true);
      expect(result.comFile).toBeDefined();
      expect(result.comFile!.length).toBeGreaterThan(0);
      console.log('Generated HELLO.COM:', result.comFile!.length, 'bytes');
    }, 10000);

    it('should run the compiled program and produce correct output', async () => {
      expect(available).toBe(true);

      // Compile the template
      const template = LANGUAGES['pascal']?.template;
      expect(template).toBeDefined();

      const assembler = new Assembler(runner, 'MTPLUS');
      const result = await assembler.assemble('HELLO', template!, { timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.comFile).toBeDefined();

      // Run the compiled program with input "5" and "3" - should output sum of 8
      // Template prompts for two numbers and shows "The sum is: <result>"
      const runResult = await verifyProgramOutput(
        runner,
        'HELLO',
        ['Pascal MT+ Addition', 'The sum is:'],
        ['5', '3'],  // Input: first=5, second=3
        5000
      );

      console.log('Program output:', runResult.output);
      expect(runResult.success).toBe(true);
      expect(runResult.matched).toBe(true);
      expect(runResult.output).toContain('8');  // 5 + 3 = 8
    }, 15000);
  });
});
