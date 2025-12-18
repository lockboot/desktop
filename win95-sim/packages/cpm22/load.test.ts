/**
 * Tests for LOAD.COM action (HEX→COM converter).
 *
 * Tests both the manifest action definition and the actual conversion.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  CpmRunner,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
  expandSubmitTemplate,
} from '../test-utils';
import type { PackageAction } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('LOAD.COM Action (HEX→COM)', () => {
  let runner: CpmRunner;
  let available = false;
  let action: PackageAction | undefined;

  beforeAll(() => {
    const binary = loadPackageFile(__dirname, 'LOAD.COM');
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('LOAD.COM', binary);
      available = true;
    }
    // Get the load action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'load');
  });

  describe('manifest action', () => {
    it('should have load action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('load');
      expect(action!.name).toBe('LOAD (HEX→COM)');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .HEX files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'TEST.HEX')).toBe(true);
      expect(actionMatchesFile(action!, 'hello.hex')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.COM')).toBe(false);
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO', 'B');
      // Template: "{drive}:\rA:LOAD {name}\r{name}\r"
      expect(cmd).toBe('B:\rA:LOAD HELLO\rHELLO\r');
    });
  });

  describe('conversion', () => {
    it('should convert a simple HEX file to COM', async () => {
      expect(available).toBe(true);

      // Simple HEX file: MVI A,42H ; RET (at 0100H)
      // Intel HEX format: :LLAAAATT[DD...]CC
      const hexContent = `:030100003E42C9B3\r\n:00000001FF\r\n`;
      runner.addSourceFile('TEST.HEX', hexContent);

      const result = await runner.run('B:LOAD', { args: 'A:TEST', trace: false });

      console.log('LOAD.COM output:', result.output);
      console.log('Files after LOAD:', runner.listSourceFiles());

      // Check if COM file was created
      const comFile = runner.getSourceFile('TEST.COM');
      expect(comFile).toBeDefined();
      if (comFile) {
        console.log('Generated TEST.COM:', comFile.length, 'bytes');
        // Verify the bytes: 3E 42 C9 (MVI A,42H ; RET)
        expect(comFile[0]).toBe(0x3E);
        expect(comFile[1]).toBe(0x42);
        expect(comFile[2]).toBe(0xC9);
      }
    });

    it('should convert a multi-record HEX file', async () => {
      expect(available).toBe(true);

      // Reset runner
      const load = loadPackageFile(__dirname, 'LOAD.COM')!;
      const freshRunner = new CpmRunner();
      freshRunner.addTool('LOAD.COM', load);

      // Multi-record HEX with correct checksums:
      // Record 1 at 0100H: 3E 01 (MVI A,1)
      //   Checksum: 0x100 - (0x02+0x01+0x00+0x00+0x3E+0x01) = 0x100 - 0x42 = 0xBE
      // Record 2 at 0102H: 3E 02 (MVI A,2)
      //   Checksum: 0x100 - (0x02+0x01+0x02+0x00+0x3E+0x02) = 0x100 - 0x45 = 0xBB
      // Record 3 at 0104H: C9 (RET)
      //   Checksum: 0x100 - (0x01+0x01+0x04+0x00+0xC9) = 0x100 - 0xCF = 0x31
      const hexContent = [
        ':020100003E01BE',  // MVI A,1 at 0100H
        ':020102003E02BB',  // MVI A,2 at 0102H (fixed checksum)
        ':01010400C931',    // RET at 0104H (fixed checksum)
        ':00000001FF',      // EOF
      ].join('\r\n') + '\r\n';

      freshRunner.addSourceFile('MULTI.HEX', hexContent);

      const result = await freshRunner.run('B:LOAD', { args: 'A:MULTI', trace: false });

      console.log('MULTI LOAD output:', result.output);
      const comFile = freshRunner.getSourceFile('MULTI.COM');
      expect(comFile).toBeDefined();
      if (comFile) {
        console.log('Generated MULTI.COM:', comFile.length, 'bytes');
        // Verify bytes at correct offsets
        expect(comFile[0]).toBe(0x3E); // MVI A at 0100H
        expect(comFile[1]).toBe(0x01);
        expect(comFile[2]).toBe(0x3E); // MVI A at 0102H
        expect(comFile[3]).toBe(0x02);
        expect(comFile[4]).toBe(0xC9); // RET at 0104H
      }
    });
  });
});
