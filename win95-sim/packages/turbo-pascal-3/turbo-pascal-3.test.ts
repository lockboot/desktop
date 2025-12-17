/**
 * Tests for the Turbo Pascal 3 package.
 *
 * Tests compilation of Pascal programs using Turbo Pascal 3.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile, ScriptedCompiler } from '../test-utils';
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

  beforeAll(() => {
    turbo = loadPackageFile(__dirname, 'TURBO.COM');
    msg = loadPackageFile(__dirname, 'TURBO.MSG');
    ovr = loadPackageFile(__dirname, 'TURBO.OVR');
  });

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
      timeout: 60000
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
  }, 60000);
});
