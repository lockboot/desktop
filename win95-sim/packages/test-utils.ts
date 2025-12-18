/**
 * Shared test utilities for package tests.
 *
 * Each package can import these utilities to test its binaries.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { CpmRunner, Assembler, ASSEMBLERS, LANGUAGES, ScriptedCompiler } from '../src/cpm/runner';
import {
  actionMatchesFile,
  expandSubmitTemplate,
} from '../src/cpm/package-loader';
import type { PackageManifest, PackageAction } from '../src/cpm/package-loader';

/**
 * Load a binary file from the current package directory.
 */
export function loadPackageFile(packageDir: string, filename: string): Uint8Array | null {
  const filePath = join(packageDir, filename);
  if (!existsSync(filePath)) {
    return null;
  }
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Load multiple files from a package directory into a tools map.
 */
export function loadPackageTools(packageDir: string, filenames: string[]): Record<string, Uint8Array> {
  const tools: Record<string, Uint8Array> = {};
  for (const filename of filenames) {
    const binary = loadPackageFile(packageDir, filename);
    if (binary) {
      tools[filename.toUpperCase()] = binary;
    }
  }
  return tools;
}

/**
 * Create a CpmRunner with tools loaded from a package directory.
 */
export function createPackageRunner(packageDir: string, toolFiles: string[]): CpmRunner {
  const runner = new CpmRunner();
  const tools = loadPackageTools(packageDir, toolFiles);
  for (const [name, binary] of Object.entries(tools)) {
    runner.addTool(name, binary);
  }
  return runner;
}

/**
 * Test an assembler with the IDE template for its language.
 */
export async function testAssemblerWithTemplate(
  runner: CpmRunner,
  assemblerName: keyof typeof ASSEMBLERS,
  languageKey: string
): Promise<{ success: boolean; output: string; hexFile?: Uint8Array; comFile?: Uint8Array }> {
  const assembler = new Assembler(runner, assemblerName);
  const template = LANGUAGES[languageKey]?.template;

  if (!template) {
    throw new Error(`No template found for language: ${languageKey}`);
  }

  return await assembler.assemble('TEST', template, { trace: false });
}

/**
 * Run a compiled .COM file and capture its output.
 *
 * @param runner - CpmRunner with the program on A: drive
 * @param programName - Name of the .COM file (without extension)
 * @param input - Input to provide (array of lines or single string)
 * @param timeout - Timeout in ms (default 5000)
 */
export async function runCompiledProgram(
  runner: CpmRunner,
  programName: string,
  input?: string | string[],
  timeout = 5000
): Promise<{ output: string; success: boolean }> {
  const result = await runner.run(`A:${programName}`, { input, timeout });
  return {
    output: result.output,
    success: result.exitInfo?.reason === 'warmboot' || result.exitInfo?.reason === 'exit'
  };
}

/**
 * Run an interpreted program via its runtime (e.g., CRUN2 for CBASIC).
 *
 * @param runner - CpmRunner with the program on A: drive and runtime on B: drive
 * @param runtimeName - Name of the runtime program (e.g., 'CRUN2')
 * @param programName - Name of the program file (without extension)
 * @param input - Input to provide (array of lines or single string)
 * @param timeout - Timeout in ms (default 5000)
 */
export async function runInterpretedProgram(
  runner: CpmRunner,
  runtimeName: string,
  programName: string,
  input?: string | string[],
  timeout = 5000
): Promise<{ output: string; success: boolean }> {
  // Run runtime from B: drive with program name as argument
  const result = await runner.run(`B:${runtimeName}`, {
    args: `A:${programName}`,
    input,
    timeout
  });
  return {
    output: result.output,
    success: result.exitInfo?.reason === 'warmboot' || result.exitInfo?.reason === 'exit'
  };
}

/**
 * Test that a compiled program produces expected output.
 *
 * @param runner - CpmRunner with the program on A: drive
 * @param programName - Name of the .COM file (without extension)
 * @param expectedOutput - String that should appear in output
 * @param input - Input to provide (array of lines or single string)
 * @param timeout - Timeout in ms (default 5000)
 */
export async function verifyProgramOutput(
  runner: CpmRunner,
  programName: string,
  expectedOutput: string | string[],
  input?: string | string[],
  timeout = 5000
): Promise<{ output: string; success: boolean; matched: boolean }> {
  const result = await runCompiledProgram(runner, programName, input, timeout);
  const expectations = Array.isArray(expectedOutput) ? expectedOutput : [expectedOutput];
  const matched = expectations.every(exp => result.output.includes(exp));
  return { ...result, matched };
}

/**
 * Convert a HEX file to COM using LOAD.COM.
 * Requires LOAD.COM to be added to the runner's tools.
 */
export async function convertHexToCom(
  runner: CpmRunner,
  programName: string,
  timeout = 5000
): Promise<Uint8Array | undefined> {
  const result = await runner.run('B:LOAD', {
    args: `A:${programName}`,
    timeout
  });

  if (result.exitInfo?.reason !== 'warmboot') {
    console.log('LOAD.COM failed:', result.output);
    return undefined;
  }

  return runner.getSourceFile(`${programName}.COM`) ?? undefined;
}

/**
 * Full E2E test for assemblers: Assemble → Load → Run → Verify output.
 * The templates produce programs that add two single digits.
 */
export async function testAssemblerE2E(
  runner: CpmRunner,
  assemblerName: string,
  languageKey: string,
  loadBinary: Uint8Array
): Promise<{ success: boolean; output: string; error?: string }> {
  // Add LOAD.COM for HEX→COM conversion
  runner.addTool('LOAD.COM', loadBinary);

  // Step 1: Assemble
  const assembler = new Assembler(runner, assemblerName);
  const template = LANGUAGES[languageKey]?.template;
  if (!template) {
    return { success: false, output: '', error: `No template for ${languageKey}` };
  }

  const asmResult = await assembler.assemble('TEST', template, { timeout: 5000 });
  if (!asmResult.success || !asmResult.hexFile) {
    return { success: false, output: asmResult.output, error: 'Assembly failed' };
  }

  // Step 2: Convert HEX to COM
  const comFile = await convertHexToCom(runner, 'TEST', 5000);
  if (!comFile) {
    return { success: false, output: '', error: 'HEX to COM conversion failed' };
  }

  // Step 3: Run the program with input "3" and "5" (should output "Sum: 8")
  // Use single string without line breaks since assembly templates use BDOS function 1
  // (read single char) not BDOS function 10 (read line)
  const runResult = await runner.run('A:TEST', {
    input: '35',  // Two digits to add, read as single characters
    timeout: 5000
  });

  const output = runResult.output;
  const hasSum = output.includes('8');  // 3 + 5 = 8

  return {
    success: hasSum,
    output,
    error: hasSum ? undefined : 'Expected sum of 8 not found in output'
  };
}

/**
 * Load and parse manifest.mf from a package directory.
 */
export function loadManifest(packageDir: string): PackageManifest | null {
  const manifestPath = join(packageDir, 'manifest.mf');
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Get actions from a package manifest.
 */
export function getManifestActions(packageDir: string): PackageAction[] {
  const manifest = loadManifest(packageDir);
  return manifest?.actions ?? [];
}

/**
 * Verify that an action's command file exists in the package.
 * Checks both uppercase and lowercase variants.
 */
export function verifyActionCommand(packageDir: string, action: PackageAction): boolean {
  // Try uppercase (CP/M convention)
  let comFile = loadPackageFile(packageDir, `${action.command}.COM`);
  if (!comFile) {
    // Try lowercase (common on case-sensitive filesystems)
    comFile = loadPackageFile(packageDir, `${action.command.toLowerCase()}.com`);
  }
  return comFile !== null && comFile.length > 0;
}

/**
 * Test an action by running its submit template with a test source file.
 * Returns the compiled output file if successful.
 */
export async function testActionSubmit(
  runner: CpmRunner,
  action: PackageAction,
  sourceCode: string,
  sourceExt: string,
  options: { baseName?: string; timeout?: number } = {}
): Promise<{ success: boolean; output: string; outputFiles: Map<string, Uint8Array> }> {
  const baseName = options.baseName ?? 'TEST';
  const timeout = options.timeout ?? 5000;
  const sourceFile = `${baseName}.${sourceExt}`;

  // Add source file
  runner.addSourceFile(sourceFile, new TextEncoder().encode(sourceCode + '\x1A'));

  // Build command from submit template (use A: as the source drive)
  const command = expandSubmitTemplate(action, baseName, 'A');
  // Strip trailing \r for run()
  const cmdLine = command.replace(/\r$/, '');

  // Run the command (assumes tool is already loaded)
  const result = await runner.run(cmdLine, { timeout });

  // Collect output files
  const outputFiles = new Map<string, Uint8Array>();
  for (const ext of action.outputExts ?? ['COM']) {
    const outFile = runner.getSourceFile(`${baseName}.${ext}`);
    if (outFile) {
      outputFiles.set(ext, outFile);
    }
  }

  return {
    success: result.exitInfo?.reason === 'warmboot' || result.exitInfo?.reason === 'exit',
    output: result.output,
    outputFiles
  };
}

// Re-export commonly used items
export { CpmRunner, Assembler, ASSEMBLERS, LANGUAGES, ScriptedCompiler };
export { actionMatchesFile, expandSubmitTemplate };
export type { PackageManifest, PackageAction };
