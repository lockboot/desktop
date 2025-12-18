/**
 * Tests for the DRI CCP shell and SUBMIT functionality.
 *
 * Uses our self-built CCP.COM as the shell to test:
 * - Basic shell prompt and commands
 * - SUBMIT batch file processing
 * - $$$.SUB file creation and execution
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';
import { CpmEmulator, CaptureConsole, MemoryFS } from '../../src/cpm';

const __dirname = dirname(fileURLToPath(import.meta.url));

// CCP is assembled to run at 0xDC00 (below BDOS at 0xFE00)
const CCP_ADDRESS = 0xDC00;

describe('CCP Shell (self-built)', () => {
  function createCcpEmulator() {
    const ccpBinary = loadPackageFile(__dirname, 'CCP.COM');
    expect(ccpBinary).toBeDefined();

    const fs = new MemoryFS();
    fs.addFile('/A/CCP.COM', ccpBinary!);

    const captureConsole = new CaptureConsole();
    const drives = new Map<number, string>();
    drives.set(0, '/A');
    drives.set(1, '/B');

    let exitInfo: { reason: string } | null = null;
    const cpm = new CpmEmulator({
      fs,
      console: captureConsole,
      drives,
      shellAddress: CCP_ADDRESS,
      onExit: (info) => { exitInfo = info; }
    });

    // Load CCP as shell (isShell=true means reload on warm boot)
    cpm.load(ccpBinary!, true);

    return { cpm, captureConsole, fs, getExitInfo: () => exitInfo };
  }

  async function runUntil(
    cpm: CpmEmulator,
    captureConsole: CaptureConsole,
    condition: (output: string) => boolean,
    timeout = 5000,
    debugLabel = ''
  ): Promise<string> {
    const startTime = Date.now();
    let lastOutputLen = 0;
    while ((Date.now() - startTime) < timeout) {
      await cpm.step();
      const output = captureConsole.getOutput();
      // Print new output as it arrives
      if (output.length > lastOutputLen && debugLabel) {
        const newPart = output.slice(lastOutputLen);
        if (newPart.length > 0) {
          console.log(`[${debugLabel}] new output: ${JSON.stringify(newPart)}`);
        }
        lastOutputLen = output.length;
      }
      if (condition(output)) {
        return output;
      }
    }
    const output = captureConsole.getOutput();
    if (debugLabel) {
      console.log(`[${debugLabel}] TIMEOUT! Final output: ${JSON.stringify(output)}`);
    }
    return output;
  }

  it('should display prompt on startup', async () => {
    const { cpm, captureConsole } = createCcpEmulator();

    // CCP shows "A>" prompt (drive letter + >)
    const output = await runUntil(cpm, captureConsole,
      (out) => out.includes('A>'), 2000);

    console.log('CCP startup output:', JSON.stringify(output));
    expect(output).toContain('A>');
  });

  it('should handle DIR command', async () => {
    const { cpm, captureConsole, fs } = createCcpEmulator();

    // Add some files to list
    fs.addFile('/A/TEST.TXT', 'Hello');
    fs.addFile('/A/HELLO.COM', new Uint8Array([0xC9])); // RET

    // Wait for prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);

    // Send DIR command
    captureConsole.queueLine('DIR');

    // Wait for directory listing and next prompt
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        const dirIndex = out.indexOf('DIR');
        return dirIndex > 0 && out.slice(dirIndex).includes('A>');
      }, 3000);

    console.log('DIR output:', JSON.stringify(output.slice(-200)));
    // Should show files (CCP.COM at minimum)
    expect(output).toContain('CCP');
  });

  it('should handle TYPE command', async () => {
    const { cpm, captureConsole, fs } = createCcpEmulator();

    // Add a text file
    fs.addFile('/A/HELLO.TXT', 'Hello from CP/M!\r\n');

    // Wait for prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);

    // Send TYPE command
    captureConsole.queueLine('TYPE HELLO.TXT');

    // Wait for file content
    const output = await runUntil(cpm, captureConsole,
      (out) => out.includes('Hello from CP/M!'), 3000);

    console.log('TYPE output:', JSON.stringify(output.slice(-200)));
    expect(output).toContain('Hello from CP/M!');
  });

  it('should switch drives with B:', async () => {
    const { cpm, captureConsole } = createCcpEmulator();
    const mem = (cpm as any).memory as Uint8Array;

    // Memory addresses from binary analysis (CCP at 0xDC00)
    // Offsets from CCP base: COMFCB=0x7A6, CDISK=0x7C8, SDISK=0x7C9
    const COMFCB = CCP_ADDRESS + 0x7A6;  // 0xE3A6
    const CDISK = CCP_ADDRESS + 0x7C8;   // Current disk (0xE3C8)
    const SDISK = CCP_ADDRESS + 0x7C9;   // Selected disk for command (0xE3C9)

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);

    // Dump state before command
    console.log('COMFCB before:', Array.from(mem.slice(COMFCB, COMFCB + 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('CDISK before:', mem[CDISK], 'SDISK before:', mem[SDISK]);

    // Switch to B:
    captureConsole.queueLine('B:');

    // Wait for response - either B> prompt or error
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        // Look for any prompt after the command
        const idx = out.indexOf('B:');
        return idx >= 0 && (out.slice(idx).includes('B>') || out.slice(idx).includes('A>') || out.slice(idx).includes('?'));
      }, 5000);

    // Dump state after command processing
    console.log('COMFCB after:', Array.from(mem.slice(COMFCB, COMFCB + 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('CDISK after:', mem[CDISK], 'SDISK after:', mem[SDISK]);
    // Also show as ASCII for filename
    const fcbName = String.fromCharCode(...mem.slice(COMFCB + 1, COMFCB + 12).filter(b => b >= 32 && b < 127));
    console.log('COMFCB filename:', JSON.stringify(fcbName));
    console.log('Drive switch output:', JSON.stringify(output.slice(-100)));

    // Check if there are '?' characters in FCB (which would trigger error)
    const questionMarks = Array.from(mem.slice(COMFCB + 1, COMFCB + 12)).filter(b => b === 0x3F).length;
    console.log('Question marks in FCB:', questionMarks);

    // Also dump COMBUF to see if command was read correctly
    const COMBUF = 0x108;
    console.log('COMBUF:', Array.from(mem.slice(COMBUF, COMBUF + 10)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('COMBUF text:', JSON.stringify(String.fromCharCode(...mem.slice(COMBUF, COMBUF + 10).filter(b => b >= 32 && b < 127))));

    // Verify drive switch succeeded
    expect(output).toContain('B>');
    expect(mem[CDISK]).toBe(1); // Should be on drive B
  }, 10000);
});

describe('SUBMIT batch processing', () => {
  function createSubmitEmulator() {
    const ccpBinary = loadPackageFile(__dirname, 'CCP.COM');
    const submitBinary = loadPackageFile(__dirname, 'SUBMIT.COM');
    expect(ccpBinary).toBeDefined();
    expect(submitBinary).toBeDefined();

    const fs = new MemoryFS();
    fs.addFile('/A/CCP.COM', ccpBinary!);
    fs.addFile('/A/SUBMIT.COM', submitBinary!);

    const captureConsole = new CaptureConsole();
    const drives = new Map<number, string>();
    drives.set(0, '/A');
    drives.set(1, '/B');

    let exitInfo: { reason: string } | null = null;
    let warmBootCount = 0;
    const cpm = new CpmEmulator({
      fs,
      console: captureConsole,
      drives,
      shellAddress: CCP_ADDRESS,
      onExit: (info) => {
        exitInfo = info;
        if (info.reason === 'warmboot') {
          warmBootCount++;
        }
      }
    });

    cpm.load(ccpBinary!, true);

    return {
      cpm,
      captureConsole,
      fs,
      getExitInfo: () => exitInfo,
      getWarmBootCount: () => warmBootCount
    };
  }

  async function runUntil(
    cpm: CpmEmulator,
    captureConsole: CaptureConsole,
    condition: (output: string) => boolean,
    timeout = 10000
  ): Promise<string> {
    const startTime = Date.now();
    while ((Date.now() - startTime) < timeout) {
      await cpm.step();
      const output = captureConsole.getOutput();
      if (condition(output)) {
        return output;
      }
    }
    return captureConsole.getOutput();
  }

  it('should have SUBMIT.COM available', () => {
    const submitBinary = loadPackageFile(__dirname, 'SUBMIT.COM');
    expect(submitBinary).toBeDefined();
    expect(submitBinary!.length).toBeGreaterThan(0);
    console.log('SUBMIT.COM:', submitBinary?.length, 'bytes');
  });

  it('should create $$$.SUB file when running SUBMIT', async () => {
    const { cpm, captureConsole, fs, getWarmBootCount } = createSubmitEmulator();

    // Create a simple SUB file with one command
    // Note: SUB files use CR/LF line endings
    fs.addFile('/A/TEST.SUB', 'DIR\r\n');

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);
    console.log('Initial prompt received, warm boot count:', getWarmBootCount());

    // Run SUBMIT
    captureConsole.queueLine('SUBMIT TEST');

    // Wait for SUBMIT to finish - should warm boot after creating $$$.SUB
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        // Wait for warm boot or second prompt
        return getWarmBootCount() > 0 ||
               (out.match(/A>/g) || []).length >= 2;
      }, 8000);

    console.log('SUBMIT output:', JSON.stringify(output));
    console.log('Warm boot count after SUBMIT:', getWarmBootCount());

    // Verify $$$.SUB was created
    const subFile = fs.getFile('/A/$$$.SUB');
    expect(subFile).toBeDefined();
    console.log('$$$.SUB created:', subFile!.length, 'bytes');
    console.log('$$$.SUB hex:', Array.from(subFile!).map(b => b.toString(16).padStart(2, '0')).join(' '));

    // $$$.SUB should contain the command "DIR" in reversed record format
    expect(subFile!.length).toBe(128); // One record
  }, 15000);

  it.skip('should execute commands from SUB file after warm boot', async () => {
    // TODO: Requires CCP to properly process $$$.SUB file on warm boot
    // and SUBMIT.COM to create the $$$.SUB file
    const { cpm, captureConsole, fs } = createSubmitEmulator();

    fs.addFile('/A/SWITCH.SUB', 'B:\r\n');
    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);

    captureConsole.queueLine('SUBMIT SWITCH');

    const output = await runUntil(cpm, captureConsole,
      (out) => {
        const submitIdx = out.indexOf('SUBMIT');
        return submitIdx > 0 && out.slice(submitIdx).includes('B>');
      }, 10000);

    console.log('SUBMIT SWITCH output:', JSON.stringify(output.slice(-300)));
    expect(output).toMatch(/[B$]>/);
  }, 20000);

  it.skip('should support parameter substitution in SUB files', async () => {
    // TODO: Requires full SUBMIT functionality
    const { cpm, captureConsole, fs } = createSubmitEmulator();

    fs.addFile('/A/SHOW.SUB', 'TYPE $1.TXT\r\n');
    fs.addFile('/A/HELLO.TXT', 'Parameter substitution works!\r\n');

    await runUntil(cpm, captureConsole, (out) => out.includes('A>'), 2000);
    captureConsole.queueLine('SUBMIT SHOW HELLO');

    const output = await runUntil(cpm, captureConsole,
      (out) => out.includes('Parameter substitution works!'), 15000);

    console.log('SUBMIT with params output:', JSON.stringify(output.slice(-300)));
    expect(output).toContain('Parameter substitution works!');
  }, 30000);
});
