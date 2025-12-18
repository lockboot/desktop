/**
 * Tests for the BDS C package.
 *
 * Tests BDS C compiler with the IDE template.
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

const HELLO_C = `/* BDS C Hello World */
#include <stdio.h>

main()
{
    printf("Hello from BDS C!\\n");
}
`;

describe('BDS C Compiler', () => {
  let runner: CpmRunner;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const cc = loadPackageFile(__dirname, 'CC.COM');
    const cc2 = loadPackageFile(__dirname, 'CC2.COM');
    const clink = loadPackageFile(__dirname, 'CLINK.COM');
    const deff = loadPackageFile(__dirname, 'DEFF.CRL');
    const deff2 = loadPackageFile(__dirname, 'DEFF2.CRL');
    const ccc = loadPackageFile(__dirname, 'C.CCC');
    const stdio = loadPackageFile(__dirname, 'STDIO.H');

    if (cc && cc2 && clink && deff && deff2 && ccc && stdio) {
      runner = new CpmRunner();
      runner.addTool('CC.COM', cc);
      runner.addTool('CC2.COM', cc2);
      runner.addTool('CLINK.COM', clink);
      runner.addTool('DEFF.CRL', deff);
      runner.addTool('DEFF2.CRL', deff2);
      runner.addTool('C.CCC', ccc);
      runner.addTool('STDIO.H', stdio);
      available = true;
    }

    // Get the bdsc action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'bdsc');
  });

  describe('manifest action', () => {
    it('should have bdsc action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('bdsc');
      expect(action!.name).toBe('BDS C');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .C files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'HELLO.C')).toBe(true);
      expect(actionMatchesFile(action!, 'test.c')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'A');
      expect(cmd).toBe('CC A:HELLO\rCLINK A:HELLO\r');
    });
  });

  describe('package files', () => {
    it('should have CC.COM', () => {
      const binary = loadPackageFile(__dirname, 'CC.COM');
      expect(binary).toBeDefined();
      expect(binary!.length).toBeGreaterThan(0);
      console.log('CC.COM:', binary?.length, 'bytes');
    });

    it('should have CC2.COM', () => {
      const binary = loadPackageFile(__dirname, 'CC2.COM');
      expect(binary).toBeDefined();
      expect(binary!.length).toBeGreaterThan(0);
      console.log('CC2.COM:', binary?.length, 'bytes');
    });

    it('should have CLINK.COM', () => {
      const binary = loadPackageFile(__dirname, 'CLINK.COM');
      expect(binary).toBeDefined();
      expect(binary!.length).toBeGreaterThan(0);
      console.log('CLINK.COM:', binary?.length, 'bytes');
    });
  });

  describe('compilation', () => {
    it('should compile and link hello world', async () => {
      expect(available).toBe(true);

      const template = LANGUAGES['bdsc']?.template || HELLO_C;
      const assembler = new Assembler(runner, 'BDSC');
      const result = await assembler.assemble('HELLO', template, { timeout: 5000 });

      console.log('BDS C output:', result.output);

      expect(result.success).toBe(true);
      expect(result.comFile).toBeDefined();
      expect(result.comFile!.length).toBeGreaterThan(0);
      console.log('Generated HELLO.COM:', result.comFile!.length, 'bytes');
    }, 10000);

    // TODO: BDS C program execution hangs - needs investigation of scanf/getchar behavior
    it.skip('should run the compiled program and produce correct output', async () => {
      expect(available).toBe(true);

      // Compile the template (calculator program)
      const template = LANGUAGES['bdsc']?.template || HELLO_C;
      const assembler = new Assembler(runner, 'BDSC');
      const result = await assembler.assemble('CALC', template, { timeout: 5000 });

      expect(result.success).toBe(true);
      expect(result.comFile).toBeDefined();

      // Run the compiled program with input: 5, +, 3 → should output "5 + 3 = 8"
      // The template is a calculator that prompts for two numbers and an operator
      // Input as single string: scanf reads "5\r", getchar reads '\r', getchar reads '+', scanf reads "3\r"
      const runResult = await verifyProgramOutput(
        runner,
        'CALC',
        ['BDS C Calculator'],
        '5\r+3\r',  // Input: first=5, operator=+, second=3
        5000
      );

      console.log('Program output:', runResult.output);
      expect(runResult.success).toBe(true);
      expect(runResult.matched).toBe(true);
      // Check for the calculation result
      expect(runResult.output).toMatch(/5\s*\+\s*3\s*=\s*8/);
    }, 15000);
  });
});
