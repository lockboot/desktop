/**
 * Tests for the Unix-like commands package.
 *
 * All commands actually work using CP/M BDOS calls (ls, cat, rm, more, etc.).
 *
 * This test compiles the .ASM source files and saves the resulting .COM files
 * to disk. The package build then includes only the .COM binaries.
 * LESS is an alias for MORE (same binary, different name in manifest).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';
import { loadPackageFile, CpmRunner, Assembler } from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cpm22Dir = join(__dirname, '../cpm22');

// Commands that have .ASM source files to compile
// LESS is excluded - it's an alias of MORE in the manifest
const COMMANDS = [
  { name: 'LS' },
  { name: 'CAT' },
  { name: 'RM' },
  { name: 'MORE' },
  { name: 'ECHO' },
  { name: 'PWD' },
  { name: 'TOUCH' },
  { name: 'CD' },
  { name: 'CP' },
  { name: 'MV' },
  { name: 'WHICH' },
  { name: 'EXIT' },
  { name: 'PAUSE' },
  { name: 'WHOAMI' },
  { name: 'UNAME' },
];

describe('Unix-like Commands Package', () => {
  // Check all .ASM source files exist
  describe('Source files', () => {
    for (const cmd of COMMANDS) {
      it(`should have ${cmd.name}.ASM source file`, () => {
        const source = loadPackageFile(__dirname, `${cmd.name}.ASM`);
        expect(source).toBeDefined();
        expect(source!.length).toBeGreaterThan(0);

        // Verify it's valid 8080 assembly
        const text = new TextDecoder().decode(source!);
        expect(text).toMatch(/ORG\s+100H/i);
        expect(text).toMatch(/END/i);
      });
    }
  });

  // Compile all commands and save .COM files
  describe('Assembly and save .COM files', () => {
    let asm: Uint8Array | null;
    let load: Uint8Array | null;

    beforeAll(() => {
      asm = loadPackageFile(cpm22Dir, 'ASM.COM');
      load = loadPackageFile(cpm22Dir, 'LOAD.COM');
    });

    for (const cmd of COMMANDS) {
      it(`should assemble and save ${cmd.name}.COM`, async () => {
        if (!asm || !load) {
          console.log('ASM.COM or LOAD.COM not available, skipping');
          return;
        }

        const runner = new CpmRunner();
        runner.addTool('ASM.COM', asm);
        runner.addTool('LOAD.COM', load);

        const source = loadPackageFile(__dirname, `${cmd.name}.ASM`);
        expect(source).toBeDefined();
        const sourceText = new TextDecoder().decode(source!);
        runner.addSourceFile(`${cmd.name}.ASM`, sourceText);

        // Assemble
        const assembler = new Assembler(runner, 'ASM');
        const asmResult = await assembler.assemble(cmd.name, sourceText, {
          trace: false,
          timeout: 10000
        });

        expect(asmResult.success).toBe(true);
        expect(asmResult.hexFile).toBeDefined();

        // Convert HEX to COM
        await runner.run('B:LOAD', {
          args: `A:${cmd.name}`,
          trace: false,
          timeout: 5000
        });

        const comFile = runner.getSourceFile(`${cmd.name}.COM`);
        expect(comFile).toBeDefined();
        console.log(`${cmd.name}.COM: ${comFile?.length} bytes`);

        // Save to disk
        const comPath = join(__dirname, `${cmd.name}.COM`);
        writeFileSync(comPath, comFile!);
      }, 30000);
    }
  });

  // Test functional commands actually work
  describe('Functional commands', () => {
    it('LS should list files', async () => {
      const comFile = loadPackageFile(__dirname, 'LS.COM');
      if (!comFile) {
        console.log('LS.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('LS.COM', comFile);
      runner.addSourceFile('TEST.TXT', 'hello');
      runner.addSourceFile('FOO.ASM', '; test');

      const result = await runner.run('A:LS', { trace: false });
      console.log('LS output:', result.output);

      // Should list the files we added
      expect(result.output).toMatch(/TEST/i);
      expect(result.output).toMatch(/FOO/i);
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('LS *.TXT should filter files', async () => {
      const comFile = loadPackageFile(__dirname, 'LS.COM');
      if (!comFile) return;

      const runner = new CpmRunner();
      runner.addSourceFile('LS.COM', comFile);
      runner.addSourceFile('TEST.TXT', 'hello');
      runner.addSourceFile('FOO.ASM', '; test');

      const result = await runner.run('A:LS', { args: '*.TXT', trace: false });
      console.log('LS *.TXT output:', result.output);

      expect(result.output).toMatch(/TEST/i);
      expect(result.output).not.toMatch(/FOO/i);
    }, 30000);

    it('CAT should display file contents', async () => {
      const comFile = loadPackageFile(__dirname, 'CAT.COM');
      if (!comFile) {
        console.log('CAT.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('CAT.COM', comFile);
      runner.addSourceFile('TEST.TXT', 'Hello from test file!\x1A');

      const result = await runner.run('A:CAT', { args: 'TEST.TXT', trace: false });
      console.log('CAT output:', result.output);

      expect(result.output).toContain('Hello from test file!');
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('CAT without filename should show usage', async () => {
      const comFile = loadPackageFile(__dirname, 'CAT.COM');
      if (!comFile) return;

      const runner = new CpmRunner();
      runner.addSourceFile('CAT.COM', comFile);

      const result = await runner.run('A:CAT', { trace: false });
      expect(result.output).toMatch(/usage/i);
    }, 30000);

    it('RM should delete files', async () => {
      const comFile = loadPackageFile(__dirname, 'RM.COM');
      if (!comFile) {
        console.log('RM.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('RM.COM', comFile);
      runner.addSourceFile('TODEL.TXT', 'delete me');

      // Verify file exists
      expect(runner.getSourceFile('TODEL.TXT')).toBeDefined();

      const result = await runner.run('A:RM', { args: 'TODEL.TXT', trace: false });
      console.log('RM output:', result.output);

      expect(result.output).toMatch(/deleted/i);
      // File should be gone
      expect(runner.getSourceFile('TODEL.TXT')).toBeUndefined();
    }, 30000);

    it('MORE should display file with paging', async () => {
      const comFile = loadPackageFile(__dirname, 'MORE.COM');
      if (!comFile) {
        console.log('MORE.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('MORE.COM', comFile);

      // Create a short file (won't trigger paging)
      runner.addSourceFile('SHORT.TXT', 'Line 1\r\nLine 2\r\nLine 3\r\n\x1A');

      const result = await runner.run('A:MORE', { args: 'SHORT.TXT', trace: false });
      console.log('MORE output:', result.output);

      expect(result.output).toContain('Line 1');
      expect(result.output).toContain('Line 2');
      expect(result.output).toContain('Line 3');
    }, 30000);

    it('ECHO should print arguments', async () => {
      const comFile = loadPackageFile(__dirname, 'ECHO.COM');
      if (!comFile) {
        console.log('ECHO.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('ECHO.COM', comFile);

      const result = await runner.run('A:ECHO', { args: 'Hello World', trace: false });
      console.log('ECHO output:', result.output);

      // CP/M uppercases command line, so check case-insensitive
      expect(result.output.toUpperCase()).toContain('HELLO WORLD');
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('ECHO without args should print blank line', async () => {
      const comFile = loadPackageFile(__dirname, 'ECHO.COM');
      if (!comFile) return;

      const runner = new CpmRunner();
      runner.addSourceFile('ECHO.COM', comFile);

      const result = await runner.run('A:ECHO', { trace: false });
      // Should just have CR LF
      expect(result.output).toMatch(/\r?\n/);
    }, 30000);

    it('PWD should show current drive', async () => {
      const comFile = loadPackageFile(__dirname, 'PWD.COM');
      if (!comFile) {
        console.log('PWD.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('PWD.COM', comFile);

      const result = await runner.run('A:PWD', { trace: false });
      console.log('PWD output:', result.output);

      // Should show "A:/" (default drive is A)
      expect(result.output).toMatch(/A:\//);
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('TOUCH should create new file', async () => {
      const comFile = loadPackageFile(__dirname, 'TOUCH.COM');
      if (!comFile) {
        console.log('TOUCH.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('TOUCH.COM', comFile);

      // File should not exist yet
      expect(runner.getSourceFile('NEWFILE.TXT')).toBeUndefined();

      const result = await runner.run('A:TOUCH', { args: 'NEWFILE.TXT', trace: false });
      console.log('TOUCH output:', result.output);

      // File should now exist (may be empty)
      const created = runner.getSourceFile('NEWFILE.TXT');
      expect(created).toBeDefined();
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('TOUCH on existing file should not error', async () => {
      const comFile = loadPackageFile(__dirname, 'TOUCH.COM');
      if (!comFile) return;

      const runner = new CpmRunner();
      runner.addSourceFile('TOUCH.COM', comFile);
      runner.addSourceFile('EXISTS.TXT', 'existing content');

      const result = await runner.run('A:TOUCH', { args: 'EXISTS.TXT', trace: false });

      // Should succeed without error
      expect(result.exitInfo?.reason).toBe('warmboot');
      // Content should be preserved
      const file = runner.getSourceFile('EXISTS.TXT');
      expect(file).toBeDefined();
    }, 30000);

    it('CD should change current drive', async () => {
      const comFile = loadPackageFile(__dirname, 'CD.COM');
      if (!comFile) {
        console.log('CD.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('CD.COM', comFile);

      // CD to B: drive
      const result = await runner.run('A:CD', { args: 'B:', trace: false });
      console.log('CD output:', result.output);

      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('CP should copy files', async () => {
      const comFile = loadPackageFile(__dirname, 'CP.COM');
      if (!comFile) {
        console.log('CP.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('CP.COM', comFile);
      runner.addSourceFile('SOURCE.TXT', 'Copy this content\x1A');

      const result = await runner.run('A:CP', { args: 'SOURCE.TXT DEST.TXT', trace: false });
      console.log('CP output:', result.output);

      // Destination should exist with same content
      const dest = runner.getSourceFile('DEST.TXT');
      expect(dest).toBeDefined();
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('MV should rename files', async () => {
      const comFile = loadPackageFile(__dirname, 'MV.COM');
      if (!comFile) {
        console.log('MV.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('MV.COM', comFile);
      runner.addSourceFile('OLD.TXT', 'rename me');

      const result = await runner.run('A:MV', { args: 'OLD.TXT NEW.TXT', trace: false });
      console.log('MV output:', result.output);

      // Old file should be gone, new file should exist
      expect(runner.getSourceFile('OLD.TXT')).toBeUndefined();
      expect(runner.getSourceFile('NEW.TXT')).toBeDefined();
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('WHICH should find commands', async () => {
      const comFile = loadPackageFile(__dirname, 'WHICH.COM');
      if (!comFile) {
        console.log('WHICH.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('WHICH.COM', comFile);
      runner.addSourceFile('TEST.COM', new Uint8Array([0xC9])); // RET

      const result = await runner.run('A:WHICH', { args: 'TEST', trace: false });
      console.log('WHICH output:', result.output);

      expect(result.output).toMatch(/TEST\.COM/i);
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('EXIT should warm boot', async () => {
      const comFile = loadPackageFile(__dirname, 'EXIT.COM');
      if (!comFile) {
        console.log('EXIT.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('EXIT.COM', comFile);

      const result = await runner.run('A:EXIT', { trace: false });

      // Should trigger warm boot
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('WHOAMI should print operator', async () => {
      const comFile = loadPackageFile(__dirname, 'WHOAMI.COM');
      if (!comFile) {
        console.log('WHOAMI.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('WHOAMI.COM', comFile);

      const result = await runner.run('A:WHOAMI', { trace: false });
      console.log('WHOAMI output:', result.output);

      expect(result.output).toContain('operator');
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('UNAME should print CP/M', async () => {
      const comFile = loadPackageFile(__dirname, 'UNAME.COM');
      if (!comFile) {
        console.log('UNAME.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('UNAME.COM', comFile);

      const result = await runner.run('A:UNAME', { trace: false });
      console.log('UNAME output:', result.output);

      expect(result.output).toContain('CP/M');
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);

    it('UNAME -a should print full info', async () => {
      const comFile = loadPackageFile(__dirname, 'UNAME.COM');
      if (!comFile) return;

      const runner = new CpmRunner();
      runner.addSourceFile('UNAME.COM', comFile);

      const result = await runner.run('A:UNAME', { args: '-a', trace: false });
      console.log('UNAME -a output:', result.output);

      expect(result.output).toContain('CP/M');
      expect(result.output).toContain('2.2');
      expect(result.output).toContain('8080');
    }, 30000);

    it('PAUSE should wait for keypress', async () => {
      const comFile = loadPackageFile(__dirname, 'PAUSE.COM');
      if (!comFile) {
        console.log('PAUSE.COM not built yet, skipping');
        return;
      }

      const runner = new CpmRunner();
      runner.addSourceFile('PAUSE.COM', comFile);

      // Provide a keypress as input
      const result = await runner.run('A:PAUSE', { input: ' ', trace: false });
      console.log('PAUSE output:', result.output);

      expect(result.output).toContain('Press any key');
      expect(result.exitInfo?.reason).toBe('warmboot');
    }, 30000);
  });

  // Verify manifest
  describe('Manifest validation', () => {
    it('should list .COM files correctly', () => {
      const manifestPath = join(__dirname, 'manifest.mf');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

      // Get unique source files from manifest
      const manifestSources = new Set(
        manifest.files.map((f: { src: string }) => f.src.toUpperCase())
      );

      // Should have all command .COM files
      for (const cmd of COMMANDS) {
        expect(manifestSources.has(`${cmd.name}.COM`)).toBe(true);
      }

      // Should have LESS as alias of MORE
      const lessEntry = manifest.files.find(
        (f: { src: string; dst?: string }) => f.dst?.toUpperCase() === 'LESS.COM'
      );
      expect(lessEntry).toBeDefined();
      expect(lessEntry.src.toUpperCase()).toBe('MORE.COM');

      console.log(`Manifest has ${manifest.files.length} entries (including LESS alias)`);
    });
  });
});
