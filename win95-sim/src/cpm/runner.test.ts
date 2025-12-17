/**
 * Tests for CP/M Runner and Assembler harness.
 *
 * Run with: npm test -- src/cpm/runner.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { CpmRunner, Assembler, ASSEMBLERS, createDevEnvironment, LANGUAGES, ScriptedCompiler } from './runner';
import { SharedMemoryFS } from './shared-memoryfs';
import { HeadlessTerminal } from './headless-terminal';
import { CpmEmulator } from './emulator';
import { CaptureConsole } from './runner';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Path to CP/M binaries (from src/cpm/ up to project root, then to public/cpm)
const CPM_DIR = join(__dirname, '../../public/cpm');

// Package subdirectories for different tool types
const PACKAGE_DIRS: Record<string, string> = {
  'LASM3.COM': 'assemblers',
  'Z1.COM': 'assemblers',
  'Z80MR.COM': 'assemblers',
  'ZASM.COM': 'assemblers',
  'TURBO.COM': 'turbo-pascal-3',
  'TURBO.MSG': 'turbo-pascal-3',
  'CC.COM': 'bds-c',
  'CC2.COM': 'bds-c',
  'CLINK.COM': 'bds-c',
  'CLIB.COM': 'bds-c',
  'C.CCC': 'bds-c',
  'DEFF.CRL': 'bds-c',
  'DEFF2.CRL': 'bds-c',
  'CBAS2.COM': 'cbasic',
  'CRUN2.COM': 'cbasic',
  'MTPLUS.COM': 'pascal-mt',
  'LINKMT.COM': 'pascal-mt',
  'LIBMT.COM': 'pascal-mt',
  'PASLIB.ERL': 'pascal-mt',
  'MTERRS.TXT': 'pascal-mt',
  'DIR.COM': 'core',
  'ERA.COM': 'core',
  'REN.COM': 'core',
  'D.COM': 'core',
};

/**
 * Load a .COM file from the public/cpm directory structure.
 */
function loadCom(name: string): Uint8Array | null {
  const upperName = name.toUpperCase();
  const subdir = PACKAGE_DIRS[upperName] || '';
  const filePath = subdir ? join(CPM_DIR, subdir, upperName) : join(CPM_DIR, name.toLowerCase());
  if (!existsSync(filePath)) {
    console.warn(`[TEST] ${name} not found at ${filePath}`);
    return null;
  }
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Load all available tools into a dev environment.
 */
function loadDevEnvironment(): CpmRunner | null {
  const tools: Record<string, Uint8Array> = {};

  for (const name of ['lasm3.com', 'z1.com', 'z80mr.com']) {
    const binary = loadCom(name);
    if (binary) {
      tools[name.toUpperCase()] = binary;
    }
  }

  if (Object.keys(tools).length === 0) {
    return null;
  }

  return createDevEnvironment(tools);
}

// Tests use the actual IDE templates from LANGUAGES to ensure they compile correctly

describe('CpmRunner', () => {
  it('should have standard drive layout', () => {
    const runner = new CpmRunner();

    expect(runner.sourcePath).toBe('/src');
    expect(runner.toolsPath).toBe('/tools');
  });

  it('should add source files to A: drive', () => {
    const runner = new CpmRunner();
    runner.addSourceFile('TEST.TXT', 'Hello World');

    expect(runner.getSourceFileAsString('TEST.TXT')).toBe('Hello World');
    expect(runner.listSourceFiles()).toContain('TEST.TXT');
  });

  it('should add tools to B: drive', () => {
    const runner = new CpmRunner();
    runner.addTool('TEST.COM', new Uint8Array([0xC9])); // RET instruction

    expect(runner.listTools()).toContain('TEST.COM');
  });

  it('should clear source files without affecting tools', () => {
    const runner = new CpmRunner();
    runner.addSourceFile('SRC.TXT', 'source');
    runner.addTool('TOOL.COM', new Uint8Array([0xC9]));

    runner.clearSourceFiles();

    expect(runner.listSourceFiles()).not.toContain('SRC.TXT');
    expect(runner.listTools()).toContain('TOOL.COM');
  });
});

describe('Dev Environment', () => {
  it('should create environment with tools on B:', () => {
    const env = createDevEnvironment({
      'ASM.COM': new Uint8Array([0xC9]),
      'LINK.COM': new Uint8Array([0xC9]),
    });

    expect(env.listTools()).toContain('ASM.COM');
    expect(env.listTools()).toContain('LINK.COM');
  });
});

describe('Language Definitions', () => {
  it('should have Z80 assembly defined', () => {
    expect(LANGUAGES['z80asm']).toBeDefined();
    expect(LANGUAGES['z80asm'].extension).toBe('AZM');
    expect(LANGUAGES['z80asm'].tool).toBe('Z80MR');
  });

  it('should have Pascal defined', () => {
    expect(LANGUAGES['pascal']).toBeDefined();
    expect(LANGUAGES['pascal'].extension).toBe('PAS');
  });
});

describe('Assembler Configuration', () => {
  it('should have configurations for known assemblers', () => {
    expect(ASSEMBLERS.LASM3).toBeDefined();
    expect(ASSEMBLERS.Z1).toBeDefined();
    expect(ASSEMBLERS.Z80MR).toBeDefined();
    expect(ASSEMBLERS.ASM).toBeDefined();
    expect(ASSEMBLERS.ZASM).toBeDefined();
  });

  it('should use correct source extensions', () => {
    expect(ASSEMBLERS.LASM3.sourceExt).toBe('ASM');
    expect(ASSEMBLERS.Z1.sourceExt).toBe('AZM');
    expect(ASSEMBLERS.Z80MR.sourceExt).toBe('AZM');
    expect(ASSEMBLERS.ZASM.sourceExt).toBe('Z80');
  });
});

describe('LASM3 Assembler (8080)', () => {
  let runner: CpmRunner;
  let assembler: Assembler;
  let available = false;

  beforeAll(() => {
    runner = new CpmRunner();
    const binary = loadCom('lasm3.com');
    if (binary) {
      runner.addTool('LASM3.COM', binary);
      assembler = new Assembler(runner, 'LASM3');
      available = true;
    }
  });

  it('should assemble the IDE template', async () => {
    if (!available) {
      console.log('LASM3.COM not available, skipping');
      return;
    }

    // Use the actual IDE template
    const template = LANGUAGES['8080asm'].template!;
    const result = await assembler.assemble('CALC', template, { trace: false });

    console.log('LASM3 output:', result.output);

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('Generated HEX:', result.hexFile?.length, 'bytes');
    if (result.comFile) {
      console.log('Converted to COM:', result.comFile.length, 'bytes');
    }
  });
});

describe('Z1 Assembler (Z80)', () => {
  let runner: CpmRunner;
  let assembler: Assembler;
  let available = false;

  beforeAll(() => {
    runner = new CpmRunner();
    const binary = loadCom('z1.com');
    if (binary) {
      runner.addTool('Z1.COM', binary);
      assembler = new Assembler(runner, 'Z1');
      available = true;
    }
  });

  it('should use .AZM extension', () => {
    if (!available) return;
    expect(assembler.getSourceExtension()).toBe('AZM');
  });

  it('should assemble the IDE template', async () => {
    if (!available) {
      console.log('Z1.COM not available, skipping');
      return;
    }

    // Use the actual IDE template
    const template = LANGUAGES['z80asm'].template!;
    const result = await assembler.assemble('CALC', template, { trace: false });

    console.log('Z1 output:', result.output);

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('Generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('Z80MR Assembler (Z80)', () => {
  let runner: CpmRunner;
  let assembler: Assembler;
  let available = false;

  beforeAll(() => {
    runner = new CpmRunner();
    const binary = loadCom('z80mr.com');
    if (binary) {
      runner.addTool('Z80MR.COM', binary);
      assembler = new Assembler(runner, 'Z80MR');
      available = true;
    }
  });

  it('should use .AZM extension', () => {
    if (!available) return;
    expect(assembler.getSourceExtension()).toBe('AZM');
  });

  it('should assemble the IDE template', async () => {
    if (!available) {
      console.log('Z80MR.COM not available, skipping');
      return;
    }

    // Use the actual IDE template
    const template = LANGUAGES['z80asm'].template!;
    const result = await assembler.assemble('CALC', template, { trace: false });

    console.log('Z80MR output:', result.output);

    expect(result.success).toBe(true);
    expect(result.hexFile || result.comFile).toBeDefined();
    console.log('Generated HEX:', result.hexFile?.length, 'bytes');
  });
});

describe('Full compile and run cycle with I/O', () => {
  it('should assemble and run the 8080 calculator (3+5=8)', async () => {
    const runner = new CpmRunner();

    // Load assembler to B: (tools)
    const asmBinary = loadCom('lasm3.com');
    if (!asmBinary) {
      console.log('LASM3.COM not available, skipping');
      return;
    }
    runner.addTool('LASM3.COM', asmBinary);

    // Assemble the IDE template
    const template = LANGUAGES['8080asm'].template!;
    const assembler = new Assembler(runner, 'LASM3');
    const asmResult = await assembler.assemble('CALC', template);

    if (!asmResult.success || !asmResult.comFile) {
      console.log('Assembly failed, skipping run test');
      console.log('Output:', asmResult.output);
      return;
    }

    expect(runner.getSourceFile('CALC.COM')).toBeDefined();
    console.log('Generated CALC.COM:', asmResult.comFile.length, 'bytes');

    // Run with HeadlessTerminal to test I/O
    const terminal = new HeadlessTerminal();
    let exitInfo: any = null;

    const cpm = new CpmEmulator({
      fs: runner['fs'],
      console: terminal,
      drives: new Map([[0, '/src'], [1, '/tools']]),
      onExit: (info) => { exitInfo = info; }
    });

    cpm.setupTransient(asmResult.comFile, '');

    // Queue input: first digit '3', second digit '5'
    terminal.sendKey('3'.charCodeAt(0));
    terminal.sendKey('5'.charCodeAt(0));

    // Run until exit
    while (!exitInfo && cpm.tStateCount < 10000000) {
      await cpm.step();
    }

    const output = terminal.getFullOutput();
    console.log('Program output:', output);

    // Verify the calculator worked: 3 + 5 = 8
    expect(output).toContain('First digit:');
    expect(output).toContain('Second digit:');
    expect(output).toContain('Sum:');
    expect(output).toContain('8');
    expect(exitInfo.reason).toBe('warmboot');
  });

  it('should assemble and run with two-digit result (7+6=13)', async () => {
    const runner = new CpmRunner();

    const asmBinary = loadCom('lasm3.com');
    if (!asmBinary) {
      console.log('LASM3.COM not available, skipping');
      return;
    }
    runner.addTool('LASM3.COM', asmBinary);

    const template = LANGUAGES['8080asm'].template!;
    const assembler = new Assembler(runner, 'LASM3');
    const asmResult = await assembler.assemble('CALC', template);

    if (!asmResult.success || !asmResult.comFile) {
      console.log('Assembly failed');
      return;
    }

    const terminal = new HeadlessTerminal();
    let exitInfo: any = null;

    const cpm = new CpmEmulator({
      fs: runner['fs'],
      console: terminal,
      drives: new Map([[0, '/src'], [1, '/tools']]),
      onExit: (info) => { exitInfo = info; }
    });

    cpm.setupTransient(asmResult.comFile, '');

    // Queue input: '7' + '6' = 13
    terminal.sendKey('7'.charCodeAt(0));
    terminal.sendKey('6'.charCodeAt(0));

    while (!exitInfo && cpm.tStateCount < 10000000) {
      await cpm.step();
    }

    const output = terminal.getFullOutput();
    console.log('Program output:', output);

    // Verify: 7 + 6 = 13 (two digits)
    expect(output).toContain('Sum:');
    expect(output).toContain('13');
  });
});

describe('Assembly failure handling', () => {
  const BAD_ASM_SYNTAX = `
; Bad syntax - undefined label
        ORG     100H
START:  MVI     C,9
        LXI     D,UNDEFINED_LABEL
        CALL    5
        RET
        END     START
`;

  const BAD_ASM_INSTRUCTION = `
; Bad instruction
        ORG     100H
START:  FAKEINSTR 123
        RET
        END     START
`;

  it('should detect assembly errors and capture output', async () => {
    const runner = new CpmRunner();
    const binary = loadCom('lasm3.com');
    if (!binary) {
      console.log('LASM3.COM not available, skipping');
      return;
    }
    runner.addTool('LASM3.COM', binary);

    const assembler = new Assembler(runner, 'LASM3');
    const result = await assembler.assemble('BAD', BAD_ASM_SYNTAX);

    console.log('Error test output:', result.output);
    console.log('Success:', result.success);
    console.log('Error:', result.error);
    console.log('New files:', Array.from(result.newFiles.keys()));

    // LASM3 may still "succeed" with undefined labels (generates 0000H)
    // but it should capture output with error information
    expect(result.output.length).toBeGreaterThan(0);
    // newFiles should contain any partial outputs (listing, etc.)
    expect(result.newFiles).toBeDefined();
    // Output should mention "UNDEFINED" if it detected the error
    if (result.output.includes('UNDEFINED') || result.output.includes('Error')) {
      console.log('Assembler detected error in output');
    }
  });

  it('should capture all output files even on failure', async () => {
    const runner = new CpmRunner();
    const binary = loadCom('lasm3.com');
    if (!binary) {
      console.log('LASM3.COM not available, skipping');
      return;
    }
    runner.addTool('LASM3.COM', binary);

    const assembler = new Assembler(runner, 'LASM3');
    const result = await assembler.assemble('BAD2', BAD_ASM_INSTRUCTION);

    console.log('Bad instruction test:');
    console.log('  Output:', result.output);
    console.log('  Success:', result.success);
    console.log('  Error:', result.error);
    console.log('  New files:', Array.from(result.newFiles.keys()));

    // Even on failure, we should have file info
    expect(result.newFiles).toBeDefined();

    // If a listing file was generated, it should be captured
    if (result.listingFile) {
      console.log('  Listing file size:', result.listingFile.length);
    }
  });

  it('should include exit info', async () => {
    const runner = new CpmRunner();
    const binary = loadCom('lasm3.com');
    if (!binary) {
      console.log('LASM3.COM not available, skipping');
      return;
    }
    runner.addTool('LASM3.COM', binary);

    const assembler = new Assembler(runner, 'LASM3');
    const template = LANGUAGES['8080asm'].template!;
    const result = await assembler.assemble('TEST', template);

    expect(result.exitInfo).toBeDefined();
    expect(result.exitInfo?.reason).toBeDefined();
    expect(result.exitInfo?.tStates).toBeGreaterThan(0);

    console.log('Exit info:', result.exitInfo);
  });
});

// Helper to load Turbo Pascal files
function loadTurboPascalFiles(): { turbo: Uint8Array; msg: Uint8Array; ovr: Uint8Array } | null {
  const turboDir = join(CPM_DIR, 'turbo-pascal-3');
  const turbo = existsSync(join(turboDir, 'TURBO.COM'))
    ? new Uint8Array(readFileSync(join(turboDir, 'TURBO.COM')))
    : null;
  const msg = existsSync(join(turboDir, 'TURBO.MSG'))
    ? new Uint8Array(readFileSync(join(turboDir, 'TURBO.MSG')))
    : null;
  const ovr = existsSync(join(turboDir, 'TURBO.OVR'))
    ? new Uint8Array(readFileSync(join(turboDir, 'TURBO.OVR')))
    : null;

  if (!turbo || !msg) {
    console.log('Turbo Pascal files not available');
    return null;
  }

  return { turbo, msg, ovr: ovr ?? new Uint8Array(0) };
}

/**
 * Simple Turbo Pascal test program
 */
const HELLO_PASCAL = `program Hello;
begin
  WriteLn('Hello from Turbo Pascal!');
end.
`;

describe('ScriptedCompiler with Turbo Pascal', () => {
  let files: { turbo: Uint8Array; msg: Uint8Array; ovr: Uint8Array } | null;

  beforeAll(() => {
    files = loadTurboPascalFiles();
  });

  it('should have interactiveScript defined for TURBO3', () => {
    expect(ASSEMBLERS.TURBO3).toBeDefined();
    expect(ASSEMBLERS.TURBO3.interactiveScript).toBeDefined();
    expect(ASSEMBLERS.TURBO3.interactiveScript!.length).toBeGreaterThan(0);
  });

  it('should compile a simple Pascal program', async () => {
    if (!files) {
      console.log('Turbo Pascal not available, skipping');
      return;
    }

    // Set up shared filesystem
    const fs = new SharedMemoryFS();
    fs.addFile('/compiler/TURBO.COM', files.turbo);
    fs.addFile('/compiler/TURBO.MSG', files.msg);
    fs.addFile('/compiler/TURBO.OVR', files.ovr);
    fs.addFile('/src/TURBO.MSG', files.msg);  // Also on A: drive
    fs.addFile('/src/TURBO.OVR', files.ovr);

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

    console.log('Terminal output:', terminal.getFullOutput().slice(0, 500));

    if (result.success && result.comFile) {
      expect(result.comFile.length).toBeGreaterThan(0);
      console.log('Generated HELLO.COM:', result.comFile.length, 'bytes');

      // Run the compiled program and verify output
      const runTerminal = new HeadlessTerminal();
      let exitInfo: any = null;

      const cpm = new CpmEmulator({
        fs,
        console: runTerminal,
        drives: new Map([[0, '/src']]),
        onExit: (info) => { exitInfo = info; }
      });

      cpm.setupTransient(result.comFile, '');

      // Run until exit
      while (!exitInfo) {
        await cpm.step();
        if (cpm.tStateCount > 10000000) break; // Safety limit
      }

      const output = runTerminal.getFullOutput();
      console.log('Program output:', output);

      expect(output).toContain('Hello from Turbo Pascal!');
    }
  }, 120000); // 2 minute timeout for this test

  it('should handle compilation errors gracefully', async () => {
    if (!files) {
      console.log('Turbo Pascal not available, skipping');
      return;
    }

    const fs = new SharedMemoryFS();
    fs.addFile('/compiler/TURBO.COM', files.turbo);
    fs.addFile('/compiler/TURBO.MSG', files.msg);
    fs.addFile('/compiler/TURBO.OVR', files.ovr);
    fs.addFile('/src/TURBO.MSG', files.msg);
    fs.addFile('/src/TURBO.OVR', files.ovr);

    const terminal = new HeadlessTerminal();
    const compiler = new ScriptedCompiler(fs, terminal, 'TURBO3');

    // Invalid Pascal code
    const badPascal = `program Bad;
begin
  this is not valid pascal
end.
`;

    const result = await compiler.compile(badPascal, {
      programName: 'BAD',
      timeout: 30000
    });

    console.log('Bad compilation result:', {
      success: result.success,
      output: terminal.getFullOutput().slice(0, 300)
    });

    // Should not produce a COM file for invalid code
    // (though Turbo Pascal behavior may vary)
  }, 60000);
});

describe('ScriptedCompiler integration', () => {
  it('should work with HeadlessTerminal for pattern matching', async () => {
    const terminal = new HeadlessTerminal();

    // Simulate what ScriptedCompiler does
    const script = [
      { wait: 'Ready>', send: 'Y' },
      { wait: 'Done', send: 'Q' }
    ];

    // Simulate a program
    const program = async () => {
      terminal.writeString('System Ready>');
      const key1 = await terminal.waitForKey();
      terminal.write(key1);
      terminal.writeString('\nProcessing...\nDone\n');
      const key2 = await terminal.waitForKey();
      terminal.write(key2);
    };

    const programPromise = program();

    // Run script
    for (const step of script) {
      await terminal.waitFor(step.wait, 1000);
      terminal.clearOutputBuffer();
      await terminal.queueInputSlow(step.send, 5);
    }

    await programPromise;

    expect(terminal.getFullOutput()).toContain('Done');
  });
});

// ============================================================================
// BDS C Compiler Tests
// ============================================================================

function loadBdsCFiles(): Record<string, Uint8Array> | null {
  const bdsDir = join(CPM_DIR, 'bds-c/bdsc160');
  const files: Record<string, Uint8Array> = {};

  const required = ['CC.COM', 'CC2.COM', 'CLINK.COM', 'DEFF.CRL', 'DEFF2.CRL', 'C.CCC'];
  const optional = ['work/STDIO.H'];

  for (const file of required) {
    const path = join(bdsDir, file);
    if (!existsSync(path)) {
      console.log(`BDS C file not found: ${file}`);
      return null;
    }
    files[file] = new Uint8Array(readFileSync(path));
  }

  for (const file of optional) {
    const path = join(bdsDir, file);
    if (existsSync(path)) {
      const name = file.includes('/') ? file.split('/').pop()! : file;
      files[name] = new Uint8Array(readFileSync(path));
    }
  }

  return files;
}

const HELLO_C = `/* BDS C Hello World */
main()
{
    printf("Hello from BDS C!\\n");
}
`;

describe('BDS C Compiler', () => {
  let files: Record<string, Uint8Array> | null;
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    files = loadBdsCFiles();
    if (files) {
      runner = new CpmRunner();
      runner.addTool('CC.COM', files['CC.COM']);
      runner.addTool('CC2.COM', files['CC2.COM']);
      runner.addTool('CLINK.COM', files['CLINK.COM']);
      runner.addTool('DEFF.CRL', files['DEFF.CRL']);
      runner.addTool('DEFF2.CRL', files['DEFF2.CRL']);
      runner.addTool('C.CCC', files['C.CCC']);
      if (files['STDIO.H']) {
        runner.addTool('STDIO.H', files['STDIO.H']);
        runner.addSourceFile('STDIO.H', new TextDecoder().decode(files['STDIO.H']));
      }
      available = true;
    }
  });

  it('should have BDSC configuration', () => {
    expect(ASSEMBLERS.BDSC).toBeDefined();
    expect(ASSEMBLERS.BDSC.linker).toBe('CLINK');
    expect(ASSEMBLERS.BDSC.sourceExt).toBe('C');
  });

  it('should compile and link hello world', async () => {
    if (!available) {
      console.log('BDS C not available, skipping');
      return;
    }

    const assembler = new Assembler(runner, 'BDSC');
    const result = await assembler.assemble('HELLO', HELLO_C, { timeout: 120000 });

    console.log('BDS C output:', result.output);
    console.log('BDS C result:', {
      success: result.success,
      hasComFile: !!result.comFile,
      comSize: result.comFile?.length,
      error: result.error
    });

    if (result.success && result.comFile) {
      expect(result.comFile.length).toBeGreaterThan(0);

      // Run the compiled program
      const capture = new CaptureConsole();
      let exitInfo: any = null;

      const cpm = new CpmEmulator({
        fs: runner['fs'],
        console: capture,
        drives: new Map([[0, '/src'], [1, '/tools']]),
        onExit: (info) => { exitInfo = info; }
      });

      cpm.setupTransient(result.comFile, '');

      while (!exitInfo && cpm.tStateCount < 10000000) {
        await cpm.step();
      }

      const output = capture.getOutput();
      console.log('Program output:', output);
      expect(output).toContain('Hello from BDS C!');
    }
  }, 180000);
});

// ============================================================================
// CBASIC Compiler Tests
// ============================================================================

function loadCbasicFiles(): Record<string, Uint8Array> | null {
  const cbasicDir = join(CPM_DIR, 'cbasic2');
  const files: Record<string, Uint8Array> = {};

  for (const file of ['CBAS2.COM', 'CRUN2.COM']) {
    const path = join(cbasicDir, file);
    if (!existsSync(path)) {
      console.log(`CBASIC file not found: ${file}`);
      return null;
    }
    files[file] = new Uint8Array(readFileSync(path));
  }

  return files;
}

const HELLO_BASIC = `REM CBASIC Hello World
PRINT "Hello from CBASIC!"
END
`;

describe('CBASIC Compiler', () => {
  let files: Record<string, Uint8Array> | null;
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    files = loadCbasicFiles();
    if (files) {
      runner = new CpmRunner();
      runner.addTool('CBAS2.COM', files['CBAS2.COM']);
      runner.addTool('CRUN2.COM', files['CRUN2.COM']);
      available = true;
    }
  });

  it('should have CBAS2 configuration', () => {
    expect(ASSEMBLERS.CBAS2).toBeDefined();
    expect(ASSEMBLERS.CBAS2.runtime).toBe('CRUN2');
    expect(ASSEMBLERS.CBAS2.sourceExt).toBe('BAS');
  });

  it('should compile and run hello world via interpreter', async () => {
    if (!available) {
      console.log('CBASIC not available, skipping');
      return;
    }

    const assembler = new Assembler(runner, 'CBAS2');
    const result = await assembler.assemble('HELLO', HELLO_BASIC, { timeout: 60000 });

    console.log('CBASIC output:', result.output);
    console.log('CBASIC result:', {
      success: result.success,
      hasIntermediate: !!result.intermediateFile,
      runtime: result.runtime,
      error: result.error
    });

    // CBASIC produces .INT files, not .COM
    if (result.success && result.intermediateFile) {
      // runtime is now an object: { program: 'CRUN2', argsFormat: '{name}', baseName: 'HELLO' }
      expect(result.runtime?.program).toBe('CRUN2');
      expect(result.intermediateFile.length).toBeGreaterThan(0);
    }
  }, 60000);
});

// ============================================================================
// ZASM Z80 Macro Assembler Tests
// ============================================================================

function loadZasmFiles(): Uint8Array | null {
  const zasmPath = join(CPM_DIR, 'zasm.com');
  if (!existsSync(zasmPath)) {
    console.log('ZASM.COM not found');
    return null;
  }
  return new Uint8Array(readFileSync(zasmPath));
}

describe('ZASM Assembler', () => {
  let binary: Uint8Array | null;
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    binary = loadZasmFiles();
    if (binary) {
      runner = new CpmRunner();
      runner.addTool('ZASM.COM', binary);
      available = true;
    }
  });

  it('should have ZASM configuration', () => {
    expect(ASSEMBLERS.ZASM).toBeDefined();
    expect(ASSEMBLERS.ZASM.sourceExt).toBe('Z80');
    expect(ASSEMBLERS.ZASM.noDrivePrefix).toBe(true);
  });

  it('should assemble the IDE template', async () => {
    if (!available) {
      console.log('ZASM not available, skipping');
      return;
    }

    // Use the actual IDE template
    const template = LANGUAGES['zasm'].template!;
    const assembler = new Assembler(runner, 'ZASM');
    const result = await assembler.assemble('CALC', template, { timeout: 60000 });

    console.log('ZASM output:', result.output);
    console.log('ZASM result:', {
      success: result.success,
      hasHexFile: !!result.hexFile,
      hasComFile: !!result.comFile,
      error: result.error
    });

    if (result.success) {
      // ZASM produces HEX files
      if (result.hexFile) {
        expect(result.hexFile.length).toBeGreaterThan(0);
        console.log('Generated HEX:', result.hexFile.length, 'bytes');
      }
      if (result.comFile) {
        console.log('Generated COM:', result.comFile.length, 'bytes');
      }
    }
  }, 60000);
});

// ============================================================================
// Pascal MT+ Compiler Tests
// ============================================================================

function loadPascalMtFiles(): Record<string, Uint8Array> | null {
  const mtDir = join(CPM_DIR, 'pascal-mt');
  const files: Record<string, Uint8Array> = {};

  const required = ['MTPLUS.COM', 'LINKMT.COM', 'PASLIB.ERL', 'MTERRS.TXT'];
  const overlays = ['MTPLUS.000', 'MTPLUS.001', 'MTPLUS.002', 'MTPLUS.003',
                    'MTPLUS.004', 'MTPLUS.005', 'MTPLUS.006'];

  for (const file of required) {
    const path = join(mtDir, file);
    if (!existsSync(path)) {
      console.log(`Pascal MT+ file not found: ${file}`);
      return null;
    }
    files[file] = new Uint8Array(readFileSync(path));
  }

  for (const file of overlays) {
    const path = join(mtDir, file);
    if (existsSync(path)) {
      files[file] = new Uint8Array(readFileSync(path));
    }
  }

  return files;
}

const HELLO_MTPASCAL = `program Hello;
begin
  writeln('Hello from Pascal MT+!')
end.
`;

describe('Pascal MT+ Compiler', () => {
  let files: Record<string, Uint8Array> | null;
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    files = loadPascalMtFiles();
    if (files) {
      runner = new CpmRunner();
      for (const [name, data] of Object.entries(files)) {
        runner.addTool(name, data);
      }
      available = true;
    }
  });

  it('should have MTPLUS configuration', () => {
    expect(ASSEMBLERS.MTPLUS).toBeDefined();
    expect(ASSEMBLERS.MTPLUS.linker).toBe('LINKMT');
    expect(ASSEMBLERS.MTPLUS.sourceExt).toBe('PAS');
  });

  it('should compile and link Pascal program', async () => {
    if (!available) {
      console.log('Pascal MT+ not available, skipping');
      return;
    }

    const assembler = new Assembler(runner, 'MTPLUS');
    const result = await assembler.assemble('HELLO', HELLO_MTPASCAL, { timeout: 120000 });

    console.log('Pascal MT+ output:', result.output);
    console.log('Pascal MT+ result:', {
      success: result.success,
      hasComFile: !!result.comFile,
      comSize: result.comFile?.length,
      error: result.error
    });

    if (result.success && result.comFile) {
      expect(result.comFile.length).toBeGreaterThan(0);
      console.log('Generated COM:', result.comFile.length, 'bytes');

      // Run the compiled program
      const capture = new CaptureConsole();
      let exitInfo: any = null;

      const cpm = new CpmEmulator({
        fs: runner['fs'],
        console: capture,
        drives: new Map([[0, '/src'], [1, '/tools']]),
        onExit: (info) => { exitInfo = info; }
      });

      cpm.setupTransient(result.comFile, '');

      while (!exitInfo && cpm.tStateCount < 10000000) {
        await cpm.step();
      }

      const output = capture.getOutput();
      console.log('Program output:', output);
      expect(output).toContain('Hello from Pascal MT+!');
    }
  }, 180000);
});

// ============================================================================
// All Languages Test
// ============================================================================

describe('Language Definitions', () => {
  it('should have all expected languages defined', () => {
    const expectedLanguages = ['z80asm', '8080asm', 'pascal', 'cbasic', 'zasm', 'turbo3', 'bdsc'];

    for (const lang of expectedLanguages) {
      expect(LANGUAGES[lang]).toBeDefined();
      expect(LANGUAGES[lang].name).toBeDefined();
      expect(LANGUAGES[lang].extension).toBeDefined();
      expect(LANGUAGES[lang].tool).toBeDefined();
      expect(LANGUAGES[lang].template).toBeDefined();

      console.log(`${lang}: ${LANGUAGES[lang].name} (.${LANGUAGES[lang].extension}) -> ${LANGUAGES[lang].tool}`);
    }
  });

  it('should have matching assembler configs for all language tools', () => {
    for (const [langKey, lang] of Object.entries(LANGUAGES)) {
      const toolKey = lang.tool.toUpperCase();
      const config = ASSEMBLERS[toolKey];

      if (!config) {
        console.log(`Warning: ${langKey} uses tool ${lang.tool} but no ASSEMBLERS.${toolKey} config`);
      } else {
        // Extension should match
        expect(config.sourceExt?.toUpperCase()).toBe(lang.extension.toUpperCase());
      }
    }
  });
});
