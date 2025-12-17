/**
 * Tests for CP/M Runner and Assembler harness.
 *
 * NOTE: Package-specific tests (assemblers, compilers, etc.) are in their
 * respective package directories under packages/<name>/. This file only tests
 * the CpmRunner infrastructure itself.
 *
 * Run with: npm test -- src/cpm/runner.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CpmRunner, createDevEnvironment, LANGUAGES, ASSEMBLERS } from './runner';
import { HeadlessTerminal } from './headless-terminal';

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

  it('should have 8080 assembly defined', () => {
    expect(LANGUAGES['8080asm']).toBeDefined();
    expect(LANGUAGES['8080asm'].extension).toBe('ASM');
    expect(LANGUAGES['8080asm'].tool).toBe('LASM3');
  });

  it('should have Pascal defined', () => {
    expect(LANGUAGES['pascal']).toBeDefined();
    expect(LANGUAGES['pascal'].extension).toBe('PAS');
  });

  it('should have all expected languages defined', () => {
    const expectedLanguages = ['z80asm', '8080asm', 'pascal', 'cbasic', 'zasm', 'turbo3', 'bdsc'];
    for (const lang of expectedLanguages) {
      expect(LANGUAGES[lang]).toBeDefined();
      console.log(`${lang}: ${LANGUAGES[lang].name} (.${LANGUAGES[lang].extension}) -> ${LANGUAGES[lang].tool}`);
    }
  });
});

describe('Assembler Configuration', () => {
  it('should have configurations for known assemblers', () => {
    expect(ASSEMBLERS.LASM3).toBeDefined();
    expect(ASSEMBLERS.Z1).toBeDefined();
    expect(ASSEMBLERS.Z80MR).toBeDefined();
    expect(ASSEMBLERS.ASM).toBeDefined();
    expect(ASSEMBLERS.ZASM).toBeDefined();
    expect(ASSEMBLERS.TURBO3).toBeDefined();
    expect(ASSEMBLERS.BDSC).toBeDefined();
    expect(ASSEMBLERS.MTPLUS).toBeDefined();
    expect(ASSEMBLERS.CBAS2).toBeDefined();
  });

  it('should use correct source extensions', () => {
    expect(ASSEMBLERS.LASM3.sourceExt).toBe('ASM');
    expect(ASSEMBLERS.Z1.sourceExt).toBe('AZM');
    expect(ASSEMBLERS.Z80MR.sourceExt).toBe('AZM');
    expect(ASSEMBLERS.ZASM.sourceExt).toBe('Z80');
    expect(ASSEMBLERS.TURBO3.sourceExt).toBe('PAS');
    expect(ASSEMBLERS.BDSC.sourceExt).toBe('C');
    expect(ASSEMBLERS.MTPLUS.sourceExt).toBe('PAS');
    expect(ASSEMBLERS.CBAS2.sourceExt).toBe('BAS');
  });

  it('should have linkers where needed', () => {
    expect(ASSEMBLERS.BDSC.linker).toBe('CLINK');
    expect(ASSEMBLERS.MTPLUS.linker).toBe('LINKMT');
  });

  it('should have runtime for interpreted languages', () => {
    expect(ASSEMBLERS.CBAS2.runtime).toBe('CRUN2');
  });

  it('should have interactive script for Turbo Pascal', () => {
    expect(ASSEMBLERS.TURBO3.interactiveScript).toBeDefined();
    expect(ASSEMBLERS.TURBO3.interactiveScript!.length).toBeGreaterThan(0);
  });
});

describe('HeadlessTerminal integration', () => {
  it('should work with pattern matching for scripted interaction', async () => {
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
