/**
 * Tests for LASM3 Assembler (8080).
 *
 * E2E test: Assemble → LOAD (HEX→COM) → Run → Verify output.
 * Also tests manifest actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  testAssemblerWithTemplate,
  testAssemblerE2E,
  CpmRunner,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
  expandSubmitTemplate,
} from '../test-utils';
import type { PackageAction } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cpm22Dir = join(__dirname, '../cpm22');

describe('LASM3 Assembler (8080)', () => {
  let runner: CpmRunner;
  let loadBinary: Uint8Array | null;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'lasm3.com');
    loadBinary = loadPackageFile(cpm22Dir, 'LOAD.COM');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('LASM3.COM', binary);
      available = true;
    }
    // Get the lasm3 action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'lasm3');
  });

  describe('manifest action', () => {
    it('should have lasm3 action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('lasm3');
      expect(action!.name).toBe('LASM3 (8080)');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .ASM files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(true);
      expect(actionMatchesFile(action!, 'hello.asm')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.AZM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
      expect(action!.outputExts).toContain('HEX');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'A');
      expect(cmd).toBe('LASM3 A:HELLO\r');
    });
  });

  describe('compilation', () => {
    it('should assemble the 8080 IDE template', async () => {
      expect(available).toBe(true);

      const result = await testAssemblerWithTemplate(runner, 'LASM3', '8080asm');

      expect(result.success).toBe(true);
      expect(result.hexFile || result.comFile).toBeDefined();
      console.log('LASM3 generated HEX:', result.hexFile?.length, 'bytes');
    });

    it('should run the compiled program and produce correct output', async () => {
      expect(available).toBe(true);
      expect(loadBinary).toBeDefined();

      // Fresh runner for E2E test
      const e2eRunner = new CpmRunner();
      e2eRunner.addTool('LASM3.COM', loadPackageFile(__dirname, 'lasm3.com')!);

      const result = await testAssemblerE2E(e2eRunner, 'LASM3', '8080asm', loadBinary!);

      console.log('LASM3 E2E output:', result.output);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Sum:');
    });
  });
});
