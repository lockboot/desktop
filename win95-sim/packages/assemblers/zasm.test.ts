/**
 * Tests for ZASM Assembler (Z80 Macro).
 *
 * ZASM requires running under XCCP shell as it cold boots when run directly.
 * Also tests manifest actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  LANGUAGES,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
  expandSubmitTemplate,
} from '../test-utils';
import type { PackageAction } from '../test-utils';
import { CpmEmulator, CaptureConsole, MemoryFS } from '../../src/cpm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const xccpDir = join(__dirname, '../xccp');

describe('ZASM Assembler (Z80 Macro)', () => {
  let action: PackageAction | undefined;

  beforeAll(() => {
    // Get the zasm action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'zasm');
  });

  describe('manifest action', () => {
    it('should have zasm action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('zasm');
      expect(action!.name).toBe('ZASM Macro');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .Z80 files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'TEST.Z80')).toBe(true);
      expect(actionMatchesFile(action!, 'hello.z80')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('HEX');
      expect(action!.outputExts).toContain('REL');
    });

    it('should expand submit template correctly', () => {
      expect(action).toBeDefined();
      const cmd = expandSubmitTemplate(action!, 'HELLO');
      expect(cmd).toBe('ZASM HELLO.AAZ\r');
    });
  });

  describe('package files', () => {
    it('should have ZASM.COM', () => {
      const binary = loadPackageFile(__dirname, 'zasm.com');
      expect(binary).toBeDefined();
      expect(binary!.length).toBeGreaterThan(0);
      console.log('ZASM.COM:', binary?.length, 'bytes');
    });
  });

  describe('compilation', () => {
    // ZASM cold boots when run directly but works under XCCP shell
    it('should assemble under XCCP shell', async () => {
      const zasmBinary = loadPackageFile(__dirname, 'zasm.com');
      const xccpBinary = loadPackageFile(xccpDir, 'xccp.com');
      expect(zasmBinary).toBeDefined();
      expect(xccpBinary).toBeDefined();

      // Set up virtual filesystem (directories are implicit in MemoryFS)
      const fs = new MemoryFS();

      // Add source file on A: drive
      const template = LANGUAGES['zasm']?.template;
      expect(template).toBeDefined();
      fs.addFile('/src/TEST.Z80', template!);

      // Add ZASM on B: drive
      fs.addFile('/tools/ZASM.COM', zasmBinary!);

      // Set up console with command input
      const captureConsole = new CaptureConsole();
      // Send command to XCCP: run ZASM with source file
      captureConsole.queueLine('B:ZASM TEST.AAZ HEX');

      // Create emulator with XCCP as shell
      const drives = new Map<number, string>();
      drives.set(0, '/src');   // A:
      drives.set(1, '/tools'); // B:

      let exitInfo: { reason: string } | null = null;
      const cpm = new CpmEmulator({
        fs,
        console: captureConsole,
        drives,
        onExit: (info) => { exitInfo = info; }
      });

      // Load XCCP as the shell (isShell=true means it will be reloaded on warm boot)
      cpm.load(xccpBinary!, true);

      // Run until assembly completes (detect "end of assembly" in output)
      const startTime = Date.now();
      const timeout = 10000;
      let assemblyComplete = false;
      while (!assemblyComplete && !exitInfo && (Date.now() - startTime) < timeout) {
        await cpm.step();
        // Check if assembly has completed
        const output = captureConsole.getOutput();
        if (output.includes('end of assembly')) {
          assemblyComplete = true;
        }
      }

      const output = captureConsole.getOutput();
      console.log('ZASM under XCCP output:', output);

      // Check for ZASM output (should show assembler message)
      expect(output).toContain('CROMEMCO');
      expect(output).toContain('end of assembly');
      expect(output).toContain('Errors');

      // Check if HEX file was created
      const hexFile = fs.getFile('/src/TEST.HEX');
      expect(hexFile).toBeDefined();
      console.log('HEX file:', hexFile ? hexFile.length + ' bytes' : 'not found');
    }, 15000);
  });
});
