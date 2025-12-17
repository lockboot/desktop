/**
 * Shared test utilities for package tests.
 *
 * Each package can import these utilities to test its binaries.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { CpmRunner, Assembler, ASSEMBLERS, LANGUAGES, ScriptedCompiler } from '../src/cpm/runner';

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

// Re-export commonly used items
export { CpmRunner, Assembler, ASSEMBLERS, LANGUAGES, ScriptedCompiler };
