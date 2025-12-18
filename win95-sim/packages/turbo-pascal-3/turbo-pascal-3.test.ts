/**
 * Tests for the Turbo Pascal 3 package.
 *
 * Tests compilation of Pascal programs using Turbo Pascal 3.
 * Also tests manifest actions.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  ScriptedCompiler,
  getManifestActions,
  verifyActionCommand,
  actionMatchesFile,
} from '../test-utils';
import type { PackageAction } from '../test-utils';
import { SharedMemoryFS } from '../../src/cpm/shared-memoryfs';
import { HeadlessTerminal } from '../../src/cpm/headless-terminal';
import { CpmEmulator } from '../../src/cpm/emulator';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HELLO_PASCAL = `program Hello;
begin
  WriteLn('Hello from Turbo Pascal!');
end.
`;

describe('Turbo Pascal 3', () => {
  let turbo: Uint8Array | null;
  let msg: Uint8Array | null;
  let ovr: Uint8Array | null;
  let action: PackageAction | undefined;

  beforeAll(() => {
    turbo = loadPackageFile(__dirname, 'TURBO.COM');
    msg = loadPackageFile(__dirname, 'TURBO.MSG');
    ovr = loadPackageFile(__dirname, 'TURBO.OVR');
    // Get the turbo3 action from manifest
    const actions = getManifestActions(__dirname);
    action = actions.find(a => a.id === 'turbo3');
  });

  describe('manifest action', () => {
    it('should have turbo3 action defined', () => {
      expect(action).toBeDefined();
      expect(action!.id).toBe('turbo3');
      expect(action!.name).toBe('Turbo Pascal 3');
    });

    it('should have command file that exists', () => {
      expect(action).toBeDefined();
      expect(verifyActionCommand(__dirname, action!)).toBe(true);
    });

    it('should match .PAS files', () => {
      expect(action).toBeDefined();
      expect(actionMatchesFile(action!, 'HELLO.PAS')).toBe(true);
      expect(actionMatchesFile(action!, 'test.pas')).toBe(true);
      expect(actionMatchesFile(action!, 'TEST.ASM')).toBe(false);
    });

    it('should have correct output extensions', () => {
      expect(action).toBeDefined();
      expect(action!.outputExts).toContain('COM');
    });

    it('should have interactive script for menu-driven compilation', () => {
      expect(action).toBeDefined();
      expect(action!.interactiveScript).toBeDefined();
      expect(action!.interactiveScript!.length).toBeGreaterThan(0);
      // Check key steps exist
      const steps = action!.interactiveScript!;
      expect(steps.some(s => s.wait.includes('Work file name'))).toBe(true);
      expect(steps.some(s => s.send.includes('{name}'))).toBe(true);
    });
  });

  describe('package files', () => {
    it('should have TURBO.COM', () => {
      expect(turbo).toBeDefined();
      expect(turbo!.length).toBeGreaterThan(0);
      console.log('TURBO.COM:', turbo?.length, 'bytes');
    });

    it('should have TURBO.MSG', () => {
      expect(msg).toBeDefined();
      expect(msg!.length).toBeGreaterThan(0);
      console.log('TURBO.MSG:', msg?.length, 'bytes');
    });

    it('should have TURBO.OVR', () => {
      expect(ovr).toBeDefined();
      expect(ovr!.length).toBeGreaterThan(0);
      console.log('TURBO.OVR:', ovr?.length, 'bytes');
    });
  });

  describe('compilation', () => {
    it('should compile a simple Pascal program', async () => {
      if (!turbo || !msg) {
        console.log('Turbo Pascal not available, skipping');
        return;
      }

      // Set up shared filesystem
      const fs = new SharedMemoryFS();
      fs.addFile('/compiler/TURBO.COM', turbo);
      fs.addFile('/compiler/TURBO.MSG', msg);
      fs.addFile('/compiler/TURBO.OVR', ovr ?? new Uint8Array(0));
      fs.addFile('/src/TURBO.MSG', msg);  // Also on A: drive
      fs.addFile('/src/TURBO.OVR', ovr ?? new Uint8Array(0));

      // Create headless terminal for scripted interaction
      const terminal = new HeadlessTerminal();

      // Create scripted compiler
      const compiler = new ScriptedCompiler(fs, terminal, 'TURBO3');

      console.log('Starting Turbo Pascal compilation...');

      // Compile the program
      const result = await compiler.compile(HELLO_PASCAL, {
        programName: 'HELLO',
        timeout: 5000
      });

      console.log('Compilation result:', {
        success: result.success,
        hasComFile: !!result.comFile,
        comSize: result.comFile?.length,
        exitInfo: result.exitInfo
      });

      if (result.success && result.comFile) {
        expect(result.comFile.length).toBeGreaterThan(0);
        console.log('Generated HELLO.COM:', result.comFile.length, 'bytes');

        // Run the compiled program and verify output
        const runTerminal = new HeadlessTerminal();
        let exitInfo: { reason: string } | null = null;

        const cpm = new CpmEmulator({
          fs,
          console: runTerminal,
          drives: new Map([[0, '/src']]),
          onExit: (info) => { exitInfo = info; }
        });

        cpm.loadProgram(result.comFile);

        while (!exitInfo) {
          cpm.step();
        }

        const output = runTerminal.getFullOutput();
        console.log('Program output:', output);
        expect(output).toContain('Hello from Turbo Pascal!');
      }
    }, 10000);
  });
});
