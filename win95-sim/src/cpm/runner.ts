/**
 * CP/M Program Runner - Test harness for running CP/M programs programmatically.
 *
 * Allows running programs, capturing output, and tracking filesystem changes.
 * Useful for testing assemblers and other tools.
 */

import { CpmEmulator } from './emulator';
import { MemoryFS } from './memoryfs';
import type { CpmConsole, CpmExitInfo, VirtualFS, ScriptedConsole } from './types';
import type { Workspace, LoadedPackage } from './workspace';
import { CpmWorkspace, MemoryDriveFS, PackageDriveFS, OverlayDriveFS } from './workspace';

/**
 * Console that captures output and provides scripted input.
 */
export class CaptureConsole implements CpmConsole {
  private output: number[] = [];
  private inputQueue: number[] = [];
  private inputWaiters: Array<(key: number) => void> = [];

  /** Get captured output as string */
  getOutput(): string {
    return String.fromCharCode(...this.output);
  }

  /** Get captured output as raw bytes */
  getOutputBytes(): Uint8Array {
    return new Uint8Array(this.output);
  }

  /** Clear captured output */
  clearOutput(): void {
    this.output = [];
  }

  /** Queue input to be sent to the program */
  queueInput(input: string | number[]): void {
    const chars = typeof input === 'string'
      ? input.split('').map(c => c.charCodeAt(0))
      : input;

    for (const ch of chars) {
      if (this.inputWaiters.length > 0) {
        const waiter = this.inputWaiters.shift()!;
        waiter(ch);
      } else {
        this.inputQueue.push(ch);
      }
    }
  }

  /** Queue a line of input (adds CR at end) */
  queueLine(line: string): void {
    this.queueInput(line + '\r');
  }

  // CpmConsole implementation

  write(char: number): void {
    this.output.push(char);
  }

  print(_char: number): void {
    // Printer output - ignore or could capture separately
  }

  hasKey(): boolean {
    return this.inputQueue.length > 0;
  }

  getKey(): number | undefined {
    return this.inputQueue.shift();
  }

  waitForKey(): Promise<number> {
    if (this.inputQueue.length > 0) {
      return Promise.resolve(this.inputQueue.shift()!);
    }
    return new Promise(resolve => {
      this.inputWaiters.push(resolve);
    });
  }
}

/**
 * Result from running a CP/M program.
 */
export interface RunResult {
  /** Console output as string */
  output: string;
  /** How the program exited */
  exitInfo: CpmExitInfo;
  /** Files that were created during execution */
  newFiles: string[];
  /** Files that were modified during execution */
  modifiedFiles: string[];
  /** Files that were deleted during execution */
  deletedFiles: string[];
  /** Whether the run timed out */
  timedOut: boolean;
}

/**
 * Options for running a program.
 */
export interface RunOptions {
  /** Command line arguments (will be uppercased) */
  args?: string;
  /** Input to provide to the program */
  input?: string | string[];
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Enable syscall tracing */
  trace?: boolean;
  /** Optional external console to use instead of CaptureConsole (for visible output) */
  console?: CpmConsole;
  /** AbortSignal to cancel execution */
  signal?: AbortSignal;
  /** Override working drive (0=A, 1=B, etc.) instead of using program's drive */
  workingDrive?: number;
}

/**
 * Standard drive layout for development environment.
 */
export const STANDARD_DRIVES = {
  /** A: - User's source code and output files */
  SOURCE: 0,
  /** B: - System tools (assemblers, compilers, utilities) */
  TOOLS: 1,
} as const;

/**
 * CP/M Program Runner - runs programs and captures results.
 *
 * Standard drive layout:
 * - A: (/src)   - User's source code and output files
 * - B: (/tools) - System tools (assemblers, compilers, utilities)
 */
export class CpmRunner {
  private fs: VirtualFS;
  private drives: Map<number, string>;

  /** Path for A: drive (source files) */
  readonly sourcePath: string;
  /** Path for B: drive (tools) */
  readonly toolsPath: string;

  constructor(options?: {
    /** External filesystem to use (for sharing across instances) */
    fs?: VirtualFS;
    drives?: Map<number, string>;
    sourcePath?: string;
    toolsPath?: string;
  }) {
    // Use provided filesystem or create new isolated one
    this.fs = options?.fs ?? new MemoryFS();
    this.sourcePath = options?.sourcePath ?? '/src';
    this.toolsPath = options?.toolsPath ?? '/tools';

    // Set up drives - default to standard layout
    this.drives = options?.drives ?? new Map([
      [STANDARD_DRIVES.SOURCE, this.sourcePath],  // A: = source
      [STANDARD_DRIVES.TOOLS, this.toolsPath],    // B: = tools
    ]);
  }

  /** Get the filesystem for adding files */
  getFS(): VirtualFS {
    return this.fs;
  }

  /** Add a file to the filesystem (raw path) */
  addFile(path: string, content: Uint8Array | string): void {
    this.fs.addFile(path, content);
  }

  /** Add a source file to A: drive */
  addSourceFile(name: string, content: Uint8Array | string): void {
    const path = this.sourcePath + '/' + name.toUpperCase();
    this.fs.addFile(path, content);
  }

  /** Add a tool/program to B: drive */
  addTool(name: string, content: Uint8Array | string): void {
    const path = this.toolsPath + '/' + name.toUpperCase();
    this.fs.addFile(path, content);
  }

  /** Get a file from the filesystem (raw path) */
  getFile(path: string): Uint8Array | undefined {
    return this.fs.getFile(path);
  }

  /** Get a source file from A: drive */
  getSourceFile(name: string): Uint8Array | undefined {
    return this.fs.getFile(this.sourcePath + '/' + name.toUpperCase());
  }

  /** Get a file as string (assumes ASCII/UTF-8) */
  getFileAsString(path: string): string | undefined {
    const data = this.fs.getFile(path);
    if (!data) return undefined;
    return new TextDecoder().decode(data);
  }

  /** Get a source file as string */
  getSourceFileAsString(name: string): string | undefined {
    return this.getFileAsString(this.sourcePath + '/' + name.toUpperCase());
  }

  /** List files on A: drive (source) */
  listSourceFiles(): string[] {
    return this.fs.readdir(this.sourcePath);
  }

  /** List files on B: drive (tools) */
  listTools(): string[] {
    return this.fs.readdir(this.toolsPath);
  }

  /** List all files in a directory */
  listFiles(dir: string = '/'): string[] {
    return this.fs.readdir(dir);
  }

  /** List all files in the filesystem */
  listAllFiles(): string[] {
    return this.fs.listAll();
  }

  /** Clear all source files (keeps tools) */
  clearSourceFiles(): void {
    for (const file of this.listSourceFiles()) {
      this.fs.unlink(this.sourcePath + '/' + file);
    }
  }

  /**
   * Run a CP/M program and capture the results.
   *
   * @param programName - Name of the .COM file to run (e.g., "ASM" or "ASM.COM")
   * @param options - Run options including arguments and input
   */
  async run(programName: string, options: RunOptions = {}): Promise<RunResult> {
    const { args = '', input, timeout = 30000, trace = false } = options;

    // Parse drive prefix (e.g., "B:PROGRAM" -> drive 1, "PROGRAM")
    let specifiedDrive: number | undefined;
    let baseName = programName.toUpperCase();

    if (baseName.length >= 2 && baseName[1] === ':') {
      const driveLetter = baseName[0];
      if (driveLetter >= 'A' && driveLetter <= 'P') {
        specifiedDrive = driveLetter.charCodeAt(0) - 'A'.charCodeAt(0);
        baseName = baseName.substring(2);
      }
    }

    // Normalize program name
    const comName = baseName.endsWith('.COM') ? baseName : baseName + '.COM';

    // Find the program binary
    let binary: Uint8Array | undefined;

    if (specifiedDrive !== undefined) {
      // Look only in the specified drive
      const dir = this.drives.get(specifiedDrive);
      if (dir) {
        const path = dir.endsWith('/') ? dir + comName : dir + '/' + comName;
        binary = this.fs.getFile(path);
      }
    } else {
      // Search all drives
      for (const [, dir] of this.drives) {
        const path = dir.endsWith('/') ? dir + comName : dir + '/' + comName;
        binary = this.fs.getFile(path);
        if (binary) {
          break;
        }
      }
    }

    if (!binary) {
      const driveInfo = specifiedDrive !== undefined
        ? ` on ${String.fromCharCode(65 + specifiedDrive)}:`
        : '';
      throw new Error(`Program not found: ${comName}${driveInfo}`);
    }

    console.log(`[CpmRunner] Found ${comName}: ${binary.length} bytes, first bytes: ${Array.from(binary.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Snapshot filesystem before run
    const filesBefore = new Map<string, number>();
    for (const path of this.fs.listAll()) {
      const stat = this.fs.stat(path);
      filesBefore.set(path, stat?.size ?? 0);
    }

    // Use provided console or create capture console
    const captureConsole = options.console ? null : new CaptureConsole();
    const activeConsole = options.console ?? captureConsole!;
    console.log(`[CpmRunner] Using ${options.console ? 'external' : 'capture'} console`);

    // Queue any input
    if (input) {
      if (captureConsole) {
        // Use CaptureConsole's queueInput
        if (Array.isArray(input)) {
          for (const line of input) {
            captureConsole.queueLine(line);
          }
        } else {
          captureConsole.queueInput(input);
        }
      } else if (options.console && 'queueInput' in options.console) {
        // External console with queueInput support (e.g., Terminal)
        const termConsole = options.console as { queueInput(s: string): void };
        const inputStr = Array.isArray(input) ? input.join('\r') + '\r' : input;
        console.log(`[CpmRunner] Queueing input to external console: ${JSON.stringify(inputStr)}`);
        termConsole.queueInput(inputStr);
      }
    }

    // Track exit
    let exitInfo: CpmExitInfo | null = null;
    let timedOut = false;

    // Create emulator
    const cpm = new CpmEmulator({
      fs: this.fs,
      console: activeConsole,
      drives: this.drives,
      onExit: (info) => {
        exitInfo = info;
      }
    });

    cpm.syscallTrace = trace;
    cpm.setupTransient(binary, args);

    // Set current drive: use workingDrive option if provided, otherwise use program's drive
    // This is important for programs that look for overlay files or output to "current" drive
    const currentDrive = options.workingDrive ?? specifiedDrive;
    if (currentDrive !== undefined) {
      cpm.setCurrentDrive(currentDrive);
      console.log(`[CpmRunner] Set current drive to ${String.fromCharCode(65 + currentDrive)}:`);
    }

    console.log(`[CpmRunner] Starting execution of ${programName}, trace=${trace}`);

    // Run with timeout
    const startTime = Date.now();
    let stepCount = 0;

    while (!exitInfo) {
      // Check for abort
      if (options.signal?.aborted) {
        console.log('[CpmRunner] Aborted');
        exitInfo = {
          reason: 'error',
          message: 'Aborted',
          tStates: cpm.tStateCount,
          pc: cpm.z80.regs.pc
        };
        break;
      }

      await cpm.step();
      stepCount++;
      if (stepCount === 1 || stepCount % 100000 === 0) {
        console.log(`[CpmRunner] Step ${stepCount}, PC=${cpm.z80.regs.pc.toString(16)}, T-states=${cpm.tStateCount}`);
      }

      // Check timeout
      const now = Date.now();
      if (now - startTime > timeout) {
        timedOut = true;
        exitInfo = {
          reason: 'error',
          message: 'Timeout',
          tStates: cpm.tStateCount,
          pc: cpm.z80.regs.pc
        };
        break;
      }

      // Yield periodically
      if (cpm.tStateCount % 10000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Compare filesystem after run
    const filesAfter = new Set(this.fs.listAll());
    const newFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const path of filesAfter) {
      if (!filesBefore.has(path)) {
        newFiles.push(path);
      } else {
        const sizeBefore = filesBefore.get(path)!;
        const sizeAfter = this.fs.stat(path)?.size ?? 0;
        if (sizeBefore !== sizeAfter) {
          modifiedFiles.push(path);
        }
      }
    }

    for (const path of filesBefore.keys()) {
      if (!filesAfter.has(path)) {
        deletedFiles.push(path);
      }
    }

    return {
      output: captureConsole?.getOutput() ?? '',
      exitInfo: exitInfo!,
      newFiles,
      modifiedFiles,
      deletedFiles,
      timedOut
    };
  }
}

/**
 * Result from assembling a file.
 */
export interface AssemblyResult {
  /** Whether assembly succeeded */
  success: boolean;
  /** Assembler output (errors, warnings, etc.) */
  output: string;
  /** Generated .COM file (if any) */
  comFile?: Uint8Array;
  /** Generated .HEX file (if any) */
  hexFile?: Uint8Array;
  /** Generated intermediate file for interpreted languages (e.g., .INT for CBASIC) */
  intermediateFile?: Uint8Array;
  /** Generated .PRN/.LST file (if any) */
  listingFile?: Uint8Array;
  /** Error message if failed */
  error?: string;
  /** All files created during assembly */
  newFiles: Map<string, Uint8Array>;
  /** Exit info from the assembler */
  exitInfo?: {
    reason: string;
    tStates: number;
  };
  /** Runtime configuration for interpreted languages */
  runtime?: {
    /** Runtime program name (e.g., 'CRUN2') */
    program: string;
    /** Arguments format (use {name} for basename) */
    argsFormat: string;
    /** The base name of the program */
    baseName: string;
  };
}

/**
 * Assembler configuration for different CP/M assemblers.
 */
export interface AssemblerConfig {
  /** Name of the .COM file */
  name: string;
  /** Source file extension (default: 'ASM') */
  sourceExt?: string;
  /** Output extensions to check for (indicates success) */
  outputExts?: string[];
  /** Listing file extensions */
  listingExts?: string[];
  /** Additional command line format (use {name} for basename) */
  argsFormat?: string;
  /** Patterns in output that indicate errors (case-insensitive) */
  errorPatterns?: string[];
  /** Patterns in output that indicate warnings (case-insensitive) */
  warningPatterns?: string[];
  /** Custom success check function (overrides default) */
  checkSuccess?: (output: string, newFiles: Map<string, Uint8Array>) => boolean;
  /** Convert LF to CR+LF and add ^Z EOF marker (default: true) */
  convertLineEndings?: boolean;
  /** Additional support files needed (e.g., overlays, message files) */
  supportFiles?: string[];
  /** Base path for fetching files (e.g., '/cpm/turbo-pascal-3') */
  basePath?: string;
  /** Package name for lazy loading (e.g., 'pascal-mt', 'assemblers') */
  package?: string;
  /** Input to queue for interactive tools (e.g., menu keystrokes) */
  interactiveInput?: string;
  /** Linker program name (for two-phase compile+link) */
  linker?: string;
  /** Linker arguments format (use {name} for basename) */
  linkerArgs?: string;
  /** Intermediate output extension from compiler (e.g., 'ERL', 'REL') */
  intermediateExt?: string;
  /** Runtime interpreter program (for interpreted languages like CBASIC) */
  runtime?: string;
  /** Runtime arguments format (use {name} for basename) */
  runtimeArgs?: string;
  /** Compile toggles/flags (e.g., '$E' for CBASIC trace support) */
  compileFlags?: string;
  /** Skip adding drive prefix to filename in args (for tools like ZASM that embed drive in suffix) */
  noDrivePrefix?: boolean;
  /** Show compilation terminal even without a linker */
  showTerminal?: boolean;
  /** Set working drive (0=A, 1=B, etc.) - overrides default of running from tools drive */
  workingDrive?: number;
  /** Scripted interaction - array of {wait, send} pairs for expect-style automation */
  interactiveScript?: Array<{ wait: string; send: string }>;
}

/** Known assembler configurations */
export const ASSEMBLERS: Record<string, AssemblerConfig> = {
  CROWECPM: {
    name: 'CROWECPM',
    sourceExt: 'ASM',
    outputExts: ['COM', 'HEX'],
    listingExts: ['PRN', 'LST'],
    errorPatterns: ['error', 'illegal', 'undefined', 'invalid'],
    showTerminal: true,
    package: 'assemblers'
  },
  LASM3: {
    name: 'LASM3',
    sourceExt: 'ASM',
    outputExts: ['COM', 'HEX'],
    listingExts: ['PRN', 'LST'],
    errorPatterns: ['error', 'illegal', 'undefined', 'invalid'],
    showTerminal: true,
    package: 'assemblers'
  },
  Z1: {
    name: 'Z1',
    sourceExt: 'AZM',
    outputExts: ['COM', 'HEX'],
    listingExts: ['PRN', 'LST'],
    errorPatterns: ['error', 'illegal', 'undefined', 'invalid'],
    showTerminal: true,
    package: 'assemblers'
  },
  Z80MR: {
    name: 'Z80MR',
    sourceExt: 'AZM',
    outputExts: ['COM', 'HEX', 'REL'],
    listingExts: ['PRN', 'LST'],
    errorPatterns: ['error', 'illegal', 'undefined', 'invalid', 'unrecognized'],
    showTerminal: true,
    package: 'assemblers'
  },
  ASM: {
    name: 'ASM',
    sourceExt: 'ASM',
    outputExts: ['HEX'],
    listingExts: ['PRN'],
    errorPatterns: ['error', 'illegal', 'undefined'],
    showTerminal: true,
    package: 'cpm22'
  },
  MTPLUS: {
    name: 'MTPLUS',
    sourceExt: 'PAS',
    outputExts: ['COM'],
    intermediateExt: 'ERL',
    listingExts: [],
    errorPatterns: ['error', 'fatal', 'undefined', 'unknown', 'illegal'],
    // Overlay files (MTPLUS.000-006) are required for the compiler to work
    supportFiles: [
      'PASLIB.ERL', 'MTERRS.TXT',
      'MTPLUS.000', 'MTPLUS.001', 'MTPLUS.002', 'MTPLUS.003',
      'MTPLUS.004', 'MTPLUS.005', 'MTPLUS.006'
    ],
    basePath: './cpm/pascal-mt',
    package: 'pascal-mt',
    // Two-phase: compile then link
    // Source (PROGRAM.ERL) is on A:, PASLIB is on B: (tools drive)
    linker: 'LINKMT',
    linkerArgs: '{name},B:PASLIB/S',
    // MTPLUS may poll for ESC key to abort - send CR to continue
    interactiveInput: '\r'
  },
  CBAS2: {
    name: 'CBAS2',
    sourceExt: 'BAS',
    // CBASIC produces .INT intermediate files (not COM)
    outputExts: ['INT'],
    intermediateExt: 'INT',
    listingExts: [],
    errorPatterns: ['error', 'unmatched', 'undefined', 'illegal', 'no file'],
    // Runtime files needed to execute .INT files
    supportFiles: ['CRUN2.COM'],
    basePath: './cpm/cbasic',
    package: 'cbasic',
    // CBASIC is interpreted - run via CRUN2 runtime
    runtime: 'CRUN2',
    runtimeArgs: '{name}',
    // $E enables trace support for CRUN2 TRACE option
    compileFlags: '$E',
    showTerminal: true
  },
  ZASM: {
    name: 'ZASM',
    sourceExt: 'Z80',
    outputExts: ['HEX', 'REL'],
    listingExts: ['PRN'],
    errorPatterns: ['error', 'illegal', 'undefined', 'unrecognized'],
    // ZASM command: ZASM PROG.sol where s=source, o=output, l=list drive
    // Blanks default to current drive. Z=none for output/list
    // .AAZ = source A:, output A:, no listing
    argsFormat: '{name}.AAZ',
    noDrivePrefix: true,  // ZASM embeds drive letters in the .sol suffix
    showTerminal: true,
    package: 'assemblers',
    // Run from A: drive so defaults work correctly
    workingDrive: 0
  },
  TURBO3: {
    name: 'TURBO',
    sourceExt: 'PAS',
    outputExts: ['COM'],
    listingExts: [],
    errorPatterns: ['error', 'unknown', 'illegal', 'expected'],
    supportFiles: ['TURBO.MSG', 'TURBO.OVR'],
    basePath: './cpm/turbo-pascal-3',
    package: 'turbo-pascal-3',
    showTerminal: true,
    noDrivePrefix: true,
    // Scripted interaction for Turbo Pascal 3 IDE
    // Note: In Options menu, 'C' toggles compile destination (Memory/Com-file) - no filename prompt
    // Pattern note: Main menu shows "X)option" (e.g. "E)dit"), Options shows "(X)option" (e.g. "(Q)uit")
    // After file operations, main menu just shows ">" prompt without full menu redraw
    interactiveScript: [
      { wait: '(Y/N)?', send: 'Y' },           // Include error messages?
      { wait: 'E)dit', send: 'W' },             // Main menu -> Work file
      { wait: 'Work file name:', send: 'A:{name}.PAS\r' },  // Enter work filename
      { wait: 'Loading', send: 'O' },           // After load, send O for Options
      { wait: '(Q)uit', send: 'C' },            // Options menu -> Toggle to Com-file
      { wait: ')om-file', send: 'Q' },          // Com-file selected -> Quit options
      { wait: '>', send: 'C' },                 // Back at main menu prompt -> Compile
      { wait: 'Compiling', send: 'Q' },         // After compile starts -> Quit Turbo
    ]
  },
  BDSC: {
    name: 'CC',
    sourceExt: 'C',
    outputExts: ['COM'],
    intermediateExt: 'CRL',
    listingExts: [],
    errorPatterns: ['error', 'ERROR', 'illegal', 'undefined', 'unknown', 'no file'],
    // BDS C needs CC2.COM (second pass), plus library, runtime, and header files
    supportFiles: ['CC2.COM', 'CLINK.COM', 'DEFF.CRL', 'DEFF2.CRL', 'C.CCC', 'work/STDIO.H'],
    basePath: './cpm/bds-c',
    package: 'bds-c',
    // Two-phase: CC compiles .C to .CRL, CLINK links .CRL to .COM
    linker: 'CLINK',
    linkerArgs: '{name}',
    showTerminal: true
  },
};

/**
 * Result from scripted compilation.
 */
export interface ScriptedCompileResult {
  success: boolean;
  comFile?: Uint8Array;
  output: string;
  exitInfo?: { reason: string; tStates: number };
}

/**
 * Options for scripted compilation.
 */
export interface ScriptedCompileOptions {
  /** Program name (without extension) */
  programName?: string;
  /** Enable syscall tracing */
  trace?: boolean;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** AbortSignal to cancel execution */
  signal?: AbortSignal;
}

/**
 * ScriptedCompiler - runs interactive compilers using expect-style automation.
 * Used for tools like Turbo Pascal that have menu-driven interfaces.
 */
export class ScriptedCompiler {
  private fs: VirtualFS;
  private terminal: ScriptedConsole;
  private config: AssemblerConfig;

  constructor(fs: VirtualFS, terminal: ScriptedConsole, toolName: string) {
    this.fs = fs;
    this.terminal = terminal;
    const upperName = toolName.toUpperCase();
    this.config = ASSEMBLERS[upperName] ?? { name: upperName };

    if (!this.config.interactiveScript) {
      throw new Error(`${toolName} does not have an interactive script defined`);
    }
  }

  /**
   * Compile source code using scripted interaction.
   *
   * @param source - Source code to compile
   * @param options - Compilation options
   */
  async compile(source: string, options: ScriptedCompileOptions = {}): Promise<ScriptedCompileResult> {
    const programName = options.programName ?? 'PROGRAM';
    const timeout = options.timeout ?? 30000;

    // Get the compiler binary
    const compilerName = this.config.name + '.COM';
    const compilerBinary = this.fs.getFile(`/compiler/${compilerName}`);
    if (!compilerBinary) {
      throw new Error(`Compiler not found: ${compilerName}`);
    }

    // Add source file to A: drive with CP/M line endings
    const ext = this.config.sourceExt ?? 'PAS';
    const srcFileName = `${programName}.${ext}`;
    const cpmSource = source.replace(/\r?\n/g, '\r\n') + '\x1A';
    this.fs.addFile(`/src/${srcFileName}`, cpmSource);

    // Set up drives: A: = source, B: = compiler
    const drives = new Map<number, string>([
      [0, '/src'],
      [1, '/compiler'],
    ]);

    // Create emulator
    let exitInfo: CpmExitInfo | null = null;
    const cpm = new CpmEmulator({
      fs: this.fs,
      console: this.terminal,
      drives,
      onExit: (info: CpmExitInfo) => { exitInfo = info; }
    });

    cpm.syscallTrace = options.trace ?? false;
    cpm.setupTransient(compilerBinary, '');
    cpm.setCurrentDrive(1); // Start on B: where compiler is

    // Run emulator in background
    const runPromise = (async () => {
      while (!exitInfo && !options.signal?.aborted) {
        await cpm.step();
        if (cpm.tStateCount % 10000 === 0) {
          await new Promise(r => setTimeout(r, 0)); // Yield
        }
      }
    })();

    // Execute the script
    for (const step of this.config.interactiveScript!) {
      if (options.signal?.aborted || exitInfo) break;

      console.log(`[ScriptedCompiler] Waiting for: "${step.wait}"`);
      try {
        await this.terminal.waitFor(step.wait, 10000);
        const sendText = step.send.replace(/\{name\}/g, programName);
        console.log(`[ScriptedCompiler] Sending: "${sendText.replace(/\r/g, '\\r')}"`);
        // Clear buffer before sending so next waitFor looks at fresh output
        this.terminal.clearOutputBuffer();
        await this.terminal.queueInputSlow(sendText, 5);
        // Small delay to let output catch up before next wait
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        console.error(`[ScriptedCompiler] Failed waiting for "${step.wait}":`, err);
        break;
      }
    }

    // Wait for emulator to finish (with timeout)
    const timeoutPromise = new Promise<void>(r => setTimeout(r, timeout));
    await Promise.race([runPromise, timeoutPromise]);

    // Check for output files
    const comFile = this.fs.getFile(`/src/${programName}.COM`) ??
                    this.fs.getFile(`/compiler/${programName}.COM`);

    const finalExitInfo = exitInfo as CpmExitInfo | null;
    return {
      success: !!comFile,
      comFile,
      output: '',
      exitInfo: finalExitInfo ? { reason: finalExitInfo.reason, tStates: finalExitInfo.tStates } : undefined
    };
  }
}

/**
 * Assembler wrapper - provides high-level interface to CP/M assemblers.
 */
export class Assembler {
  private runner: CpmRunner;
  private config: AssemblerConfig;

  /**
   * Create an assembler wrapper.
   *
   * @param runner - CpmRunner with assembler loaded
   * @param assemblerName - Name of assembler program (e.g., "Z80MR", "ASM", "LASM3")
   * @param config - Optional custom configuration (overrides built-in)
   */
  constructor(runner: CpmRunner, assemblerName: string, config?: Partial<AssemblerConfig>) {
    this.runner = runner;
    const upperName = assemblerName.toUpperCase();
    this.config = {
      ...ASSEMBLERS[upperName] ?? { name: upperName },
      ...config
    };
  }

  /** Get the source file extension for this assembler */
  getSourceExtension(): string {
    return this.config.sourceExt ?? 'ASM';
  }

  /**
   * Assemble source code and return the result.
   *
   * Source file is placed on A: drive, assembler runs from B: drive.
   * Output files (.COM, .HEX, etc.) appear on A: drive.
   *
   * @param sourceName - Name for the source file (e.g., "TEST")
   * @param source - Assembly source code
   * @param options - Additional options
   */
  async assemble(
    sourceName: string,
    source: string,
    options: { timeout?: number; trace?: boolean; console?: CpmConsole; signal?: AbortSignal } = {}
  ): Promise<AssemblyResult> {
    const ext = this.config.sourceExt ?? 'ASM';
    const baseName = sourceName.toUpperCase().replace(/\.(ASM|AZM|Z80|PAS)$/i, '');
    const srcFileName = `${baseName}.${ext}`;

    // Snapshot source files before assembly
    const filesBefore = new Set(this.runner.listSourceFiles());

    // Convert line endings to CP/M format if enabled (default: true)
    let cpmSource = source;
    if (this.config.convertLineEndings !== false) {
      cpmSource = source.replace(/\r?\n/g, '\r\n') + '\x1A';
    }

    // Add source file to A: drive
    this.runner.addSourceFile(srcFileName, cpmSource);

    try {
      // Format arguments - assembler on B:, source on A:
      // Prefix with A: since current drive will be B: (tools drive)
      // Unless noDrivePrefix is set (for tools like ZASM that embed drive in suffix)
      const nameWithDrive = this.config.noDrivePrefix ? baseName : 'A:' + baseName;
      let args = this.config.argsFormat
        ? this.config.argsFormat.replace('{name}', nameWithDrive)
        : nameWithDrive;

      // Add compile flags if configured (e.g., '$E' for CBASIC trace support)
      if (this.config.compileFlags) {
        args += ' ' + this.config.compileFlags;
      }

      console.log(`[Assembler] Running B:${this.config.name} ${args}`);
      console.log(`[Assembler] Files on B: drive:`, this.runner.listTools());

      // Run assembler from B: drive
      // Substitute {name} in interactiveInput if present (replace all occurrences)
      const input = this.config.interactiveInput?.replace(/\{name\}/g, baseName);
      const result = await this.runner.run('B:' + this.config.name, {
        args,
        timeout: options.timeout ?? 60000,
        trace: options.trace,
        input,
        console: options.console,
        signal: options.signal,
        workingDrive: this.config.workingDrive
      });

      console.log(`[Assembler] Compile finished: ${result.exitInfo.reason}, ${result.exitInfo.tStates} T-states`);
      console.log(`[Assembler] Compile output:`, result.output);
      console.log(`[Assembler] Files on A: (source) after compile:`, this.runner.listSourceFiles());
      console.log(`[Assembler] Files on B: (tools) after compile:`, this.runner.listTools());

      // Collect all new files created during assembly
      const newFiles = new Map<string, Uint8Array>();
      for (const fileName of this.runner.listSourceFiles()) {
        if (!filesBefore.has(fileName) && fileName !== srcFileName) {
          const content = this.runner.getSourceFile(fileName);
          if (content) {
            newFiles.set(fileName, content);
          }
        }
      }

      // If linker is configured and we got intermediate file, run linker
      let linkOutput = '';
      if (this.config.linker && this.config.intermediateExt) {
        const intermediateFile = this.runner.getSourceFile(`${baseName}.${this.config.intermediateExt}`);
        console.log(`[Assembler] Checking for intermediate file ${baseName}.${this.config.intermediateExt}: ${intermediateFile ? intermediateFile.length + ' bytes' : 'not found'}`);
        if (intermediateFile) {
          // Format linker arguments - use A: prefix since source/output is on A: drive
          const linkArgs = this.config.linkerArgs
            ? this.config.linkerArgs.replace('{name}', 'A:' + baseName)
            : 'A:' + baseName;

          console.log(`[Assembler] Running linker B:${this.config.linker} ${linkArgs}`);

          // Run linker from B: drive
          const linkResult = await this.runner.run('B:' + this.config.linker, {
            args: linkArgs,
            timeout: options.timeout ?? 60000,
            trace: options.trace,
            console: options.console,
            signal: options.signal
          });
          linkOutput = linkResult.output;

          console.log(`[Assembler] Link finished: ${linkResult.exitInfo.reason}, ${linkResult.exitInfo.tStates} T-states`);
          console.log(`[Assembler] Link output:`, linkOutput);

          // Add any new files from linking
          for (const fileName of this.runner.listSourceFiles()) {
            if (!filesBefore.has(fileName) && fileName !== srcFileName && !newFiles.has(fileName)) {
              const content = this.runner.getSourceFile(fileName);
              if (content) {
                newFiles.set(fileName, content);
              }
            }
          }
        }
      }

      // Check for specific output files
      let comFile: Uint8Array | undefined;
      let hexFile: Uint8Array | undefined;
      let intermediateFile: Uint8Array | undefined;

      console.log(`[Assembler] Files after compile/link:`, this.runner.listSourceFiles());
      console.log(`[Assembler] Files on tools drive:`, this.runner.listTools());

      for (const outExt of this.config.outputExts ?? ['COM', 'HEX']) {
        // Check source path (A:) first
        let file = this.runner.getSourceFile(`${baseName}.${outExt}`);
        // Also check tools path (B:) - some compilers output to current drive
        if (!file) {
          file = this.runner.getFile(this.runner.toolsPath + '/' + `${baseName}.${outExt}`);
          if (file) {
            console.log(`[Assembler] Found output file on tools drive: ${baseName}.${outExt}`);
          }
        }
        if (file) {
          console.log(`[Assembler] Found output file ${baseName}.${outExt}: ${file.length} bytes`);
          if (outExt === 'COM') comFile = file;
          else if (outExt === 'HEX') hexFile = file;
          else if (outExt === 'INT') intermediateFile = file;
        }
      }

      // For interpreted languages, check for intermediate file
      if (this.config.runtime && this.config.intermediateExt) {
        const intFile = this.runner.getSourceFile(`${baseName}.${this.config.intermediateExt}`);
        if (intFile) {
          console.log(`[Assembler] Found intermediate file ${baseName}.${this.config.intermediateExt}: ${intFile.length} bytes`);
          intermediateFile = intFile;
        }
      }

      // Check for listing file
      let listingFile: Uint8Array | undefined;
      for (const lstExt of this.config.listingExts ?? ['PRN', 'LST']) {
        listingFile = this.runner.getSourceFile(`${baseName}.${lstExt}`);
        if (listingFile) break;
      }

      // Determine success - use custom check if provided
      let success: boolean;
      let errorMessage: string | undefined;

      if (this.config.checkSuccess) {
        success = this.config.checkSuccess(result.output, newFiles);
      } else {
        // Default: if we got output files (COM/HEX/intermediate), that's success
        // Error pattern matching is secondary - many assemblers print "0 ERRORS" on success
        const hasOutput = comFile || hexFile || intermediateFile;

        if (hasOutput) {
          // Got output files = success
          success = true;
        } else {
          // No output files - check for error patterns to provide useful message
          const errorPatterns = this.config.errorPatterns ?? ['error', 'illegal', 'undefined'];

          // Look for actual error indicators (not "0 ERROR(S)")
          const lines = result.output.split(/[\r\n]+/);
          const errorLine = lines.find(line => {
            const lineLower = line.toLowerCase();
            // Skip lines that show "0 error" or "no error"
            if (/\b0+\s*error/i.test(line) || /no\s*error/i.test(line)) {
              return false;
            }
            return errorPatterns.some(p => lineLower.includes(p.toLowerCase()));
          });

          success = false;
          errorMessage = errorLine ?? 'Assembly failed - no output file generated';
        }
      }

      // Combine compile and link output
      const fullOutput = linkOutput ? result.output + '\n--- LINKER ---\n' + linkOutput : result.output;

      // Build runtime info for interpreted languages
      const runtime = this.config.runtime ? {
        program: this.config.runtime,
        argsFormat: this.config.runtimeArgs ?? '{name}',
        baseName
      } : undefined;

      return {
        success,
        output: fullOutput,
        comFile,
        hexFile,
        intermediateFile,
        listingFile,
        error: errorMessage,
        newFiles,
        exitInfo: {
          reason: result.exitInfo.reason,
          tStates: result.exitInfo.tStates
        },
        runtime
      };
    } catch (err) {
      console.error('[Assembler] Error during assembly:', err);
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        newFiles: new Map()
      };
    }
  }
}

/**
 * Compiler configuration - similar to assembler but for higher-level languages.
 */
export interface CompilerConfig extends AssemblerConfig {
  /** Language name for display */
  language: string;
}

/** Known compiler configurations */
export const COMPILERS: Record<string, CompilerConfig> = {
  // Can add more: BDS C, Aztec C, etc.
};

/**
 * High-level compiler wrapper for languages like Pascal, C, etc.
 * Same interface as Assembler but configured for compilers.
 */
export class Compiler extends Assembler {
  constructor(runner: CpmRunner, compilerName: string, config?: Partial<CompilerConfig>) {
    const upperName = compilerName.toUpperCase();
    const compilerConfig = COMPILERS[upperName] ?? { name: upperName, language: upperName };
    super(runner, compilerName, { ...compilerConfig, ...config });
  }
}

/**
 * Create a runner pre-loaded with programs from file data.
 * @deprecated Use createDevEnvironment for the standard A:/B: layout
 */
export async function createRunner(
  programs: Map<string, Uint8Array>,
  drives?: Map<number, string>
): Promise<CpmRunner> {
  const runner = new CpmRunner({ drives });

  for (const [name, data] of programs) {
    runner.addFile('/' + name.toUpperCase(), data);
  }

  return runner;
}

/**
 * Create a development environment with standard drive layout.
 *
 * @param tools - Map of tool name to binary (e.g., { 'Z80MR.COM': binary })
 * @returns Configured CpmRunner with tools on B: drive
 *
 * @example
 * ```ts
 * const env = createDevEnvironment({
 *   'Z80MR.COM': z80mrBinary,
 *   'TURBO.COM': turboBinary,
 * });
 *
 * // Add source and compile
 * env.addSourceFile('HELLO.PAS', sourceCode);
 * const result = await compiler.assemble('HELLO', sourceCode);
 * ```
 */
export function createDevEnvironment(tools: Record<string, Uint8Array>): CpmRunner {
  const runner = new CpmRunner();

  // Add all tools to B: drive
  for (const [name, binary] of Object.entries(tools)) {
    runner.addTool(name, binary);
  }

  return runner;
}

/**
 * Language/tool definition for the IDE.
 */
export interface LanguageDefinition {
  /** Display name */
  name: string;
  /** File extension (without dot) */
  extension: string;
  /** Tool to use (assembler/compiler name) */
  tool: string;
  /** Syntax highlighting mode (for editor) */
  syntaxMode?: string;
  /** Sample/template code */
  template?: string;
}

/** Available languages for the IDE */
export const LANGUAGES: Record<string, LanguageDefinition> = {
  'z80asm': {
    name: 'Z80 Assembly',
    extension: 'AZM',
    tool: 'Z80MR',
    syntaxMode: 'asm',
    template: `; Z80 Assembly - Add two single digits
        ORG     100H

START:  LD      DE,MSG1     ; "First digit: "
        LD      C,9
        CALL    5
        LD      C,1         ; Read char
        CALL    5
        SUB     '0'         ; Convert ASCII to number
        LD      B,A         ; Save first digit in B

        LD      DE,MSG2     ; "Second digit: "
        LD      C,9
        CALL    5
        LD      C,1         ; Read char
        CALL    5
        SUB     '0'         ; Convert ASCII to number

        ADD     A,B         ; Add digits (result in A)
        LD      B,A         ; Save result

        LD      DE,MSG3     ; "Sum: "
        LD      C,9
        CALL    5

        LD      A,B         ; Get result
        CP      10          ; >= 10?
        JR      C,ONEDIG    ; No, single digit
        LD      E,'1'       ; Print tens digit
        LD      C,2
        CALL    5
        LD      A,B
        SUB     10          ; Get ones digit
ONEDIG: ADD     A,'0'       ; Convert to ASCII
        LD      E,A
        LD      C,2
        CALL    5

        LD      DE,CRLF
        LD      C,9
        CALL    5
        JP      0           ; Exit to CP/M

MSG1:   DB      13,10,'First digit: $'
MSG2:   DB      13,10,'Second digit: $'
MSG3:   DB      13,10,'Sum: $'
CRLF:   DB      13,10,'$'

        END     START
`
  },
  '8080asm': {
    name: '8080 Assembly',
    extension: 'ASM',
    tool: 'LASM3',
    syntaxMode: 'asm',
    template: `; 8080 Assembly - Add two single digits
        ORG     100H

START:  LXI     D,MSG1      ; "First digit: "
        MVI     C,9
        CALL    5
        MVI     C,1         ; Read char
        CALL    5
        SUI     '0'         ; Convert ASCII to number
        MOV     B,A         ; Save first digit in B

        LXI     D,MSG2      ; "Second digit: "
        MVI     C,9
        CALL    5
        MVI     C,1         ; Read char
        CALL    5
        SUI     '0'         ; Convert ASCII to number

        ADD     B           ; Add digits (result in A)
        MOV     B,A         ; Save result

        LXI     D,MSG3      ; "Sum: "
        MVI     C,9
        CALL    5

        MOV     A,B         ; Get result
        CPI     10          ; >= 10?
        JC      ONEDIG      ; No, single digit
        MVI     E,'1'       ; Print tens digit
        MVI     C,2
        CALL    5
        MOV     A,B
        SUI     10          ; Get ones digit
ONEDIG: ADI     '0'         ; Convert to ASCII
        MOV     E,A
        MVI     C,2
        CALL    5

        LXI     D,CRLF
        MVI     C,9
        CALL    5
        JMP     0           ; Exit to CP/M

MSG1:   DB      13,10,'First digit: $'
MSG2:   DB      13,10,'Second digit: $'
MSG3:   DB      13,10,'Sum: $'
CRLF:   DB      13,10,'$'

        END     START
`
  },
  'pascal': {
    name: 'Pascal MT+',
    extension: 'PAS',
    tool: 'MTPLUS',
    syntaxMode: 'pascal',
    template: `program AddNumbers;
var
  A, B, Sum: integer;
begin
  writeln('Pascal MT+ Addition');
  writeln;
  write('Enter first number: ');
  readln(A);
  write('Enter second number: ');
  readln(B);
  Sum := A + B;
  writeln;
  writeln('The sum is: ', Sum)
end.
`
  },
  'cbasic': {
    name: 'CBASIC',
    extension: 'BAS',
    tool: 'CBAS2',
    syntaxMode: 'basic',
    template: `REM CBASIC Program
REM Variables are declared with %

PRINT "Hello, World!"
PRINT

INPUT "Enter your name: "; NAME$
PRINT "Hello, "; NAME$; "!"

REM Simple calculation
AMOUNT = 12.50
TAX.RATE = 0.08
TOTAL = AMOUNT * (1 + TAX.RATE)
PRINT "Amount: $"; AMOUNT
PRINT "Total with tax: $"; TOTAL

END
`
  },
  'zasm': {
    name: 'Z80 Macro (ZASM)',
    extension: 'Z80',
    tool: 'ZASM',
    syntaxMode: 'asm',
    template: `; ZASM - Add two digits using macros
        org     100h

; --- Macro: print string ---
prtmsg  macro   addr
        ld      de,addr
        ld      c,9
        call    5
        endm

; --- Macro: read char into A ---
getc    macro
        ld      c,1
        call    5
        endm

; --- Macro: print char in A ---
putc    macro
        ld      e,a
        ld      c,2
        call    5
        endm

; --- Main program ---
start:  prtmsg  msg1
        getc
        sub     '0'
        ld      b,a             ; First digit in B

        prtmsg  msg2
        getc
        sub     '0'
        add     a,b             ; Sum in A
        ld      b,a

        prtmsg  msg3
        ld      a,b
        cp      10
        jr      c,onedig
        ld      a,'1'
        putc
        ld      a,b
        sub     10
onedig: add     a,'0'
        putc
        prtmsg  crlf
        jp      0

msg1:   db      13,10,'First digit: $'
msg2:   db      13,10,'Second digit: $'
msg3:   db      13,10,'Sum: $'
crlf:   db      13,10,'$'

        end     start
`
  },
  'turbo3': {
    name: 'Turbo Pascal 3',
    extension: 'PAS',
    tool: 'TURBO3',
    syntaxMode: 'pascal',
    template: `program Calculator;
{ Turbo Pascal 3.0 - Simple Calculator }

var
  A, B: Integer;
  Op: Char;
  Result: Integer;

begin
  WriteLn('Turbo Pascal Calculator');
  WriteLn;
  Write('Enter first number: ');
  ReadLn(A);
  Write('Enter operator (+,-,*): ');
  ReadLn(Op);
  Write('Enter second number: ');
  ReadLn(B);

  case Op of
    '+': Result := A + B;
    '-': Result := A - B;
    '*': Result := A * B;
  else
    begin
      WriteLn('Unknown operator!');
      Halt;
    end;
  end;

  WriteLn;
  WriteLn(A, ' ', Op, ' ', B, ' = ', Result);
end.
`
  },
  'bdsc': {
    name: 'BDS C',
    extension: 'C',
    tool: 'BDSC',
    syntaxMode: 'c',
    template: `/* BDS C - Simple Calculator */
#include <stdio.h>

main()
{
    int a, b, result;
    char op;

    printf("BDS C Calculator\\n\\n");
    printf("Enter first number: ");
    scanf("%d", &a);
    printf("Enter operator (+,-,*): ");
    op = getchar();  /* skip newline */
    op = getchar();
    printf("Enter second number: ");
    scanf("%d", &b);

    switch(op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        default:
            printf("Unknown operator!\\n");
            return;
    }

    printf("\\n%d %c %d = %d\\n", a, op, b, result);
}
`
  },
};

/**
 * WorkspaceRunner - Runs CP/M programs using the Workspace abstraction.
 *
 * This is the preferred way to run programs in the new architecture.
 * Uses DriveFS for file access and supports lazy package loading.
 *
 * Standard drive layout:
 * - A: User source files and output
 * - B: Tools (assemblers, compilers, utilities)
 * - C: (optional) Additional scratch space
 *
 * @example
 * ```ts
 * const workspace = new CpmWorkspace();
 * const xccp = await workspace.loadPackage('xccp');
 * const asm = await workspace.loadPackage('assemblers');
 *
 * workspace.mount('A', new OverlayDriveFS(new MemoryDriveFS())); // Source/output
 * workspace.mount('B', new PackageDriveFS([xccp, asm]));  // Tools
 *
 * const runner = new WorkspaceRunner(workspace);
 * runner.addSourceFile('TEST.ASM', source);
 * const result = await runner.run('B:Z80MR', { args: 'A:TEST' });
 * ```
 */
export class WorkspaceRunner {
  private workspace: Workspace;

  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }

  /** Get the underlying workspace */
  getWorkspace(): Workspace {
    return this.workspace;
  }

  /** Add a source file to A: drive */
  addSourceFile(name: string, content: Uint8Array | string): void {
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.workspace.writeFile('A', name.toUpperCase(), data);
  }

  /** Add a tool to B: drive */
  addTool(name: string, content: Uint8Array): void {
    this.workspace.writeFile('B', name.toUpperCase(), content);
  }

  /** Get a source file from A: drive */
  getSourceFile(name: string): Uint8Array | undefined {
    return this.workspace.readFile('A', name.toUpperCase());
  }

  /** Get a source file as string */
  getSourceFileAsString(name: string): string | undefined {
    const data = this.getSourceFile(name);
    if (!data) return undefined;
    return new TextDecoder().decode(data);
  }

  /** List files on A: drive */
  listSourceFiles(): string[] {
    return this.workspace.listFiles('A');
  }

  /** List files on B: drive */
  listTools(): string[] {
    return this.workspace.listFiles('B');
  }

  /** Clear all source files */
  clearSourceFiles(): void {
    const drive = this.workspace.drive('A');
    if (drive) {
      for (const name of drive.listFiles()) {
        drive.deleteFile(name);
      }
    }
  }

  /**
   * Run a CP/M program and capture results.
   *
   * @param programName - Name of .COM file (e.g., "B:Z80MR" or just "Z80MR")
   * @param options - Run options
   */
  async run(programName: string, options: RunOptions = {}): Promise<RunResult> {
    const { args = '', input, timeout = 30000, trace = false } = options;

    // Parse drive prefix
    let driveLetter = 'B'; // Default to tools drive
    let baseName = programName.toUpperCase();

    if (baseName.length >= 2 && baseName[1] === ':') {
      driveLetter = baseName[0];
      baseName = baseName.substring(2);
    }

    const comName = baseName.endsWith('.COM') ? baseName : baseName + '.COM';

    // Get program binary from specified drive
    const binary = this.workspace.readFile(driveLetter, comName);
    if (!binary) {
      throw new Error(`Program not found: ${driveLetter}:${comName}`);
    }

    // Snapshot A: drive before run
    const filesBefore = new Set(this.workspace.listFiles('A'));

    // Create capture console
    const captureConsole = options.console ? null : new CaptureConsole();
    const activeConsole = options.console ?? captureConsole!;

    // Queue any input
    if (input && captureConsole) {
      if (Array.isArray(input)) {
        for (const line of input) {
          captureConsole.queueLine(line);
        }
      } else {
        captureConsole.queueInput(input);
      }
    }

    // Track exit
    let exitInfo: CpmExitInfo | null = null;
    let timedOut = false;

    // Create emulator from workspace
    const cpm = this.workspace.createEmulator(activeConsole, {
      onExit: (info) => { exitInfo = info; }
    });

    cpm.syscallTrace = trace;
    cpm.setupTransient(binary, args);

    // Set current drive
    const currentDrive = options.workingDrive ?? (driveLetter.charCodeAt(0) - 'A'.charCodeAt(0));
    cpm.setCurrentDrive(currentDrive);

    // Run with timeout
    const startTime = Date.now();

    while (!exitInfo) {
      if (options.signal?.aborted) {
        exitInfo = {
          reason: 'error',
          message: 'Aborted',
          tStates: cpm.tStateCount,
          pc: cpm.z80.regs.pc
        };
        break;
      }

      await cpm.step();

      if (Date.now() - startTime > timeout) {
        timedOut = true;
        exitInfo = {
          reason: 'error',
          message: 'Timeout',
          tStates: cpm.tStateCount,
          pc: cpm.z80.regs.pc
        };
        break;
      }

      // Yield periodically
      if (cpm.tStateCount % 10000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Compare A: drive after run
    const filesAfter = new Set(this.workspace.listFiles('A'));
    const newFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const name of filesAfter) {
      if (!filesBefore.has(name)) {
        newFiles.push(`/A/${name}`);
      }
    }
    for (const name of filesBefore) {
      if (!filesAfter.has(name)) {
        deletedFiles.push(`/A/${name}`);
      }
    }

    return {
      output: captureConsole?.getOutput() ?? '',
      exitInfo: exitInfo!,
      newFiles,
      modifiedFiles: [], // Would need content hashing to detect
      deletedFiles,
      timedOut
    };
  }

  /**
   * Load a tool's package lazily.
   *
   * @param toolName - Tool name (e.g., 'Z80MR', 'MTPLUS')
   * @returns The loaded package
   */
  async loadToolPackage(toolName: string): Promise<LoadedPackage> {
    const config = ASSEMBLERS[toolName.toUpperCase()];
    if (!config?.package) {
      throw new Error(`No package defined for tool: ${toolName}`);
    }
    return this.workspace.loadPackage(config.package);
  }
}

/**
 * Create a WorkspaceRunner with standard drive layout.
 *
 * @param sourcePackages - Packages to mount on A: drive (with overlay)
 * @param toolPackages - Packages to mount on B: drive (read-only)
 * @returns Configured WorkspaceRunner
 *
 * @example
 * ```ts
 * const runner = await createWorkspaceRunner(
 *   [], // A: starts empty
 *   [xccpPackage, assemblerPackage] // B: has tools
 * );
 * ```
 */
export function createWorkspaceRunner(
  sourcePackages: LoadedPackage[] = [],
  toolPackages: LoadedPackage[] = []
): WorkspaceRunner {
  const workspace = new CpmWorkspace();

  // A: = writable overlay (over any source packages)
  if (sourcePackages.length > 0) {
    const base = new PackageDriveFS(sourcePackages);
    workspace.mount('A', new OverlayDriveFS(base));
  } else {
    workspace.mount('A', new MemoryDriveFS());
  }

  // B: = read-only tools
  if (toolPackages.length > 0) {
    workspace.mount('B', new PackageDriveFS(toolPackages));
  } else {
    workspace.mount('B', new MemoryDriveFS());
  }

  return new WorkspaceRunner(workspace);
}

// Re-export workspace types for convenience
export { CpmWorkspace, MemoryDriveFS, PackageDriveFS, OverlayDriveFS };
export type { Workspace, LoadedPackage };
