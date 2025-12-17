/**
 * CP/M Emulator module
 *
 * Provides a virtualized CP/M 2.2 environment running on a Z80 emulator.
 * The emulator hooks BDOS (Basic Disk Operating System) calls to provide
 * file I/O, console I/O, and other services through pluggable interfaces.
 *
 * Usage:
 *   import { CpmEmulator, MemoryFS, Terminal } from './cpm';
 *
 *   const fs = new MemoryFS();
 *   fs.addFile('/HELLO.COM', binaryData);
 *
 *   const terminal = new Terminal();
 *   document.body.appendChild(terminal.element);
 *
 *   const cpm = new CpmEmulator({
 *     fs,
 *     console: terminal,
 *     onExit: () => console.log('CP/M program exited'),
 *   });
 *
 *   cpm.load(binaryData);
 *   cpm.run();
 */

export { CpmEmulator } from './emulator';
export { MemoryFS, createTestFS } from './memoryfs';
export { SharedMemoryFS, createLiveFileSource } from './shared-memoryfs';
export { Terminal } from './terminal';
export { HeadlessTerminal } from './headless-terminal';
export { hexToCom } from './loader';
export {
  CpmRunner,
  CaptureConsole,
  Assembler,
  Compiler,
  ScriptedCompiler,
  createRunner,
  createDevEnvironment,
  ASSEMBLERS,
  COMPILERS,
  LANGUAGES,
  STANDARD_DRIVES
} from './runner';
export type { VirtualFS, CpmConsole, CpmOptions, CpmExitInfo, ScriptedConsole } from './types';
export type { LiveFileSource } from './shared-memoryfs';
export type { TerminalOptions } from './terminal';
export type {
  RunResult,
  RunOptions,
  AssemblyResult,
  AssemblerConfig,
  CompilerConfig,
  LanguageDefinition,
  ScriptedCompileResult,
  ScriptedCompileOptions
} from './runner';
