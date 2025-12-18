/**
 * Tests for Z1 Assembler (Z80).
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

describe('Z1 Assembler (Z80)', () => {
  let runner: CpmRunner;
  let loadBinary: Uint8Array | null;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'z1.com');
    loadBinary = loadPackageFile(cpm22Dir, 'LOAD.COM');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('Z1.COM', binary);
      available = true;
    }
    // Get the z1 action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'z1');
  });

  describe('manifest action', () => {
    it('should have z1 action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('z1');
      expect(action!.name).toBe('Z1 (Z80)');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .AZM files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'TEST.AZM')).toBe(true);
      expect(actionMatchesFile(action!, 'hello.azm')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
      expect(action!.outputExts).toContain('HEX');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'A');
      expect(cmd).toBe('Z1 A:HELLO\r');
    });
  });

  describe('compilation', () => {
    it('should assemble the Z80 IDE template', async () => {
      expect(available).toBe(true);

      const result = await testAssemblerWithTemplate(runner, 'Z1', 'z80asm');

      expect(result.success).toBe(true);
      expect(result.hexFile || result.comFile).toBeDefined();
      console.log('Z1 generated HEX:', result.hexFile?.length, 'bytes');
    });

    it('should run the compiled program and produce correct output', async () => {
      expect(available).toBe(true);
      expect(loadBinary).toBeDefined();

      const e2eRunner = new CpmRunner();
      e2eRunner.addTool('Z1.COM', loadPackageFile(__dirname, 'z1.com')!);

      const result = await testAssemblerE2E(e2eRunner, 'Z1', 'z80asm', loadBinary!);

      console.log('Z1 E2E output:', result.output);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Sum:');
    });
  });
});
