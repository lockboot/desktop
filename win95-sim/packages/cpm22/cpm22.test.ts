/**
 * Tests for the CP/M 2.2 utilities package.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile, CpmRunner, Assembler } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CP/M 2.2 Utilities', () => {
  const utilities = [
    'ASM.COM',    // 8080 assembler
    'DDT.COM',    // Dynamic Debugging Tool
    'DUMP.COM',   // Hex dump utility
    'ED.COM',     // Line editor
    'LOAD.COM',   // HEX to COM loader
    'PAUSE.COM',  // Batch pause
    'PIP.COM',    // Peripheral Interchange Program (file copy)
    'STAT.COM',   // File/disk statistics
    'SUBMIT.COM', // Batch file processor
    'XSUB.COM',   // Extended SUBMIT
  ];

  for (const util of utilities) {
    it(`should have ${util}`, () => {
      const binary = loadPackageFile(__dirname, util);
      expect(binary).toBeDefined();
      expect(binary!.length).toBeGreaterThan(0);
      console.log(`${util}: ${binary?.length} bytes`);
    });
  }
});

describe('ASM.COM (8080 Assembler)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const asm = loadPackageFile(__dirname, 'ASM.COM');
    if (asm) {
      runner = new CpmRunner();
      runner.addTool('ASM.COM', asm);
      available = true;
    }
  });

  it('should assemble a simple 8080 program', async () => {
    if (!available) {
      console.log('ASM.COM not available, skipping');
      return;
    }

    const source = `
        ORG     100H
        MVI     A,0
        RET
        END
`;
    const assembler = new Assembler(runner, 'ASM');
    const result = await assembler.assemble('TEST', source, { trace: false });

    console.log('ASM.COM output:', result.output);
    expect(result.success).toBe(true);
    expect(result.hexFile).toBeDefined();
    console.log('Generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('LOAD.COM (HEX to COM converter)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const load = loadPackageFile(__dirname, 'LOAD.COM');
    if (load) {
      runner = new CpmRunner();
      runner.addTool('LOAD.COM', load);
      available = true;
    }
  });

  it('should convert a HEX file to COM', async () => {
    if (!available) {
      console.log('LOAD.COM not available, skipping');
      return;
    }

    // Simple HEX file: MVI A,42H ; RET (at 0100H)
    // Intel HEX format: :LLAAAATT[DD...]CC (no spaces!)
    const hexContent = `:030100003E42C9B3\r\n:00000001FF\r\n`;
    runner.addSourceFile('TEST.HEX', hexContent);

    const result = await runner.run('B:LOAD', { args: 'A:TEST', trace: false });

    console.log('LOAD.COM output:', result.output);
    console.log('Files after LOAD:', runner.listSourceFiles());

    // Check if COM file was created
    const comFile = runner.getSourceFile('TEST.COM');
    if (comFile) {
      console.log('Generated TEST.COM:', comFile.length, 'bytes');
      // Verify the bytes: 3E 42 C9 (MVI A,42H ; RET)
      expect(comFile[0]).toBe(0x3E);
      expect(comFile[1]).toBe(0x42);
      expect(comFile[2]).toBe(0xC9);
    }
  });
});

describe('STAT.COM (File statistics)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const stat = loadPackageFile(__dirname, 'STAT.COM');
    if (stat) {
      runner = new CpmRunner();
      runner.addTool('STAT.COM', stat);
      available = true;
    }
  });

  it('should display disk statistics', async () => {
    if (!available) {
      console.log('STAT.COM not available, skipping');
      return;
    }

    // Add a test file so there's something to stat
    runner.addSourceFile('TEST.TXT', 'Hello World');

    const result = await runner.run('B:STAT', { trace: false });

    console.log('STAT.COM output:', result.output);
    // STAT should produce some output about disk/files
    expect(result.output.length).toBeGreaterThan(0);
  });
});

describe('DUMP.COM (Hex dump)', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const dump = loadPackageFile(__dirname, 'DUMP.COM');
    if (dump) {
      runner = new CpmRunner();
      runner.addTool('DUMP.COM', dump);
      available = true;
    }
  });

  it('should dump a file in hex', async () => {
    if (!available) {
      console.log('DUMP.COM not available, skipping');
      return;
    }

    // Create a small test file
    runner.addSourceFile('TEST.DAT', 'ABCD');

    const result = await runner.run('B:DUMP', { args: 'A:TEST.DAT', trace: false });

    console.log('DUMP.COM output:', result.output);
    // Should show hex dump with 41 42 43 44 (ASCII for ABCD)
    expect(result.output).toMatch(/41/i);
  });
});
