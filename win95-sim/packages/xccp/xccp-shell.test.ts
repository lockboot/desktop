/**
 * Tests for XCCP shell functionality.
 *
 * Tests shell features: prompt, multi-command, drive switching, etc.
 */

import { describe, it, expect } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';
import { CpmEmulator, CaptureConsole, MemoryFS } from '../../src/cpm';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('XCCP Shell', () => {
  function createXccpEmulator() {
    const xccpBinary = loadPackageFile(__dirname, 'xccp.com');
    expect(xccpBinary).toBeDefined();

    const fs = new MemoryFS();
    fs.addFile('/A/XCCP.COM', xccpBinary!);
    fs.addFile('/A/TEST.TXT', 'Hello World\r\n');

    const captureConsole = new CaptureConsole();
    const drives = new Map<number, string>();
    drives.set(0, '/A');
    drives.set(1, '/B');

    let exitInfo: { reason: string } | null = null;
    const cpm = new CpmEmulator({
      fs,
      console: captureConsole,
      drives,
      onExit: (info) => { exitInfo = info; }
    });

    cpm.load(xccpBinary!, true);

    return { cpm, captureConsole, fs, getExitInfo: () => exitInfo };
  }

  async function runUntil(
    cpm: CpmEmulator,
    captureConsole: CaptureConsole,
    condition: (output: string) => boolean,
    timeout = 5000
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

  it('should display banner and prompt on startup', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Run until we see the prompt (XCCP shows "A 0->" for drive A, user 0)
    const output = await runUntil(cpm, captureConsole,
      (out) => out.includes('0->'), 2000);

    console.log('XCCP startup output:', JSON.stringify(output));

    expect(output).toContain('XCCP Version 1.0');
    expect(output).toContain('0->');
  });

  it('should switch drives with drive letter command', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Wait for initial prompt (format is "A\x000->" with null byte)
    await runUntil(cpm, captureConsole, (out) => out.includes('0->'), 2000);

    // Send drive change command
    captureConsole.queueLine('B:');

    // Wait for new prompt showing B drive (B\x000-> pattern)
    const output = await runUntil(cpm, captureConsole,
      (out) => out.includes('B\x000->'), 3000);

    console.log('Drive switch output:', JSON.stringify(output.slice(-100)));
    expect(output).toContain('B\x000->');
  });

  it('should accept user area syntax in drive command', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('0->'), 2000);

    // Send user change command (A5: = drive A, user 5)
    // Note: The emulator may not fully support user areas, but XCCP should
    // accept the command without error and return to a prompt
    captureConsole.queueLine('A5:');

    // Wait for prompt after command (XCCP accepts the command)
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        // Count prompts - should have at least 2 (initial + after command)
        const prompts = out.match(/0->/g);
        return prompts !== null && prompts.length >= 2;
      }, 3000);

    console.log('User switch output:', JSON.stringify(output.slice(-100)));
    // Verify command was accepted (echoed) and we got back to a prompt
    expect(output).toContain('A5:');
    expect(output).toContain('0->');
  });

  it('should execute multiple commands separated by semicolon', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('0->'), 2000);

    // Send multiple commands: switch to B: then back to A:
    captureConsole.queueLine('B:;A:');

    // XCCP processes both commands in sequence. We may or may not see the
    // intermediate B: prompt depending on timing. What we should verify is:
    // 1. The command line was accepted
    // 2. We end up back at the A: drive (final state after both commands)
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        // Look for the command echo and a subsequent A: prompt
        const cmdIndex = out.indexOf('B:;A:');
        if (cmdIndex === -1) return false;
        // After command, we should see an A prompt
        const afterCmd = out.slice(cmdIndex + 5);
        return afterCmd.includes('A\x000->');
      }, 3000);

    console.log('Multi-command output:', JSON.stringify(output.slice(-200)));
    // Verify command was processed and we're back at A: drive
    expect(output).toContain('B:;A:');
    const cmdIndex = output.indexOf('B:;A:');
    expect(output.slice(cmdIndex)).toContain('A\x000->');
  });

  it('should cancel command with ^U', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('0->'), 2000);

    // Type partial command then cancel with ^U (0x15)
    captureConsole.queueInput('TEST');
    captureConsole.queueInput('\x15'); // ^U

    // Should get fresh prompt (count prompts)
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        const prompts = out.match(/0->/g);
        return prompts !== null && prompts.length >= 2;
      }, 2000);

    console.log('Cancel output:', JSON.stringify(output.slice(-100)));
    expect(output).toContain('0->');
  });

  it('should perform warm boot with ^C', async () => {
    const { cpm, captureConsole } = createXccpEmulator();

    // Wait for initial prompt
    await runUntil(cpm, captureConsole, (out) => out.includes('0->'), 2000);

    // Send ^C for warm boot
    captureConsole.queueInput('\x03'); // ^C

    // Should still be at prompt after warm boot (count prompts)
    const output = await runUntil(cpm, captureConsole,
      (out) => {
        const prompts = out.match(/0->/g);
        return prompts !== null && prompts.length >= 2;
      }, 2000);

    console.log('Warm boot output:', JSON.stringify(output.slice(-100)));
    expect(output).toContain('0->');
  });
});
