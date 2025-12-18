/**
 * Tests for Z80MR Assembler (Z80).
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

describe('Z80MR Assembler (Z80)', () => {
  let runner: CpmRunner;
  let loadBinary: Uint8Array | null;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'z80mr.com');
    loadBinary = loadPackageFile(cpm22Dir, 'LOAD.COM');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('Z80MR.COM', binary);
      available = true;
    }
    // Get the z80mr action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'z80mr');
  });

  describe('manifest action', () => {
    it('should have z80mr action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('z80mr');
      expect(action!.name).toBe('Z80MR (Z80)');
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
      expect(cmd).toBe('Z80MR A:HELLO\r');
    });
  });

  describe('compilation', () => {
    it('should assemble the Z80 IDE template', async () => {
      expect(available).toBe(true);

      const result = await testAssemblerWithTemplate(runner, 'Z80MR', 'z80asm');

      expect(result.success).toBe(true);
      expect(result.hexFile || result.comFile).toBeDefined();
      console.log('Z80MR generated HEX:', result.hexFile?.length, 'bytes');
    });

    it('should run the compiled program and produce correct output', async () => {
      expect(available).toBe(true);
      expect(loadBinary).toBeDefined();

      const e2eRunner = new CpmRunner();
      e2eRunner.addTool('Z80MR.COM', loadPackageFile(__dirname, 'z80mr.com')!);

      const result = await testAssemblerE2E(e2eRunner, 'Z80MR', 'z80asm', loadBinary!);

      console.log('Z80MR E2E output:', result.output);
      expect(result.success).toBe(true);
      expect(result.output).toContain('Sum:');
    });
  });
});
