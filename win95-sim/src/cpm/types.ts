/**
 * Virtual filesystem interface for CP/M emulator.
 * Maps CP/M file operations to a pluggable backend (memory, IndexedDB, context store, etc.)
 */
export interface VirtualFS {
  /** Open a file, returns handle >= 0 on success, -1 on error */
  open(path: string, mode: 'r' | 'r+' | 'w' | 'wx+'): number;

  /** Close a file handle */
  close(handle: number): void;

  /** Read from file at position, returns bytes read */
  read(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number;

  /** Write to file at position, returns bytes written */
  write(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number;

  /** Get file size, returns null if file doesn't exist */
  stat(path: string): { size: number } | null;

  /** Delete a file, returns true on success */
  unlink(path: string): boolean;

  /** Rename a file, returns true on success */
  rename(oldPath: string, newPath: string): boolean;

  /** List directory contents (filenames only) */
  readdir(path: string): string[];

  /** Check if file exists */
  exists(path: string): boolean;

  // Convenience methods for populating the filesystem

  /** Add a file with content (for populating FS) */
  addFile(path: string, content: Uint8Array | string): void;

  /** Get raw file content */
  getFile(path: string): Uint8Array | undefined;

  /** List all files in the filesystem */
  listAll(): string[];
}

/**
 * Console interface for CP/M emulator.
 * Handles character I/O to/from the virtual terminal.
 */
export interface CpmConsole {
  /** Write a character to the console */
  write(char: number): void;

  /** Write to printer (optional, can be no-op) */
  print?(char: number): void;

  /** Check if a key is available */
  hasKey(): boolean;

  /** Get next key from buffer, returns undefined if none available */
  getKey(): number | undefined;

  /** Called when emulator needs a key - implement to wake up async wait */
  waitForKey?(): Promise<number>;
}

/**
 * Exit information passed to onExit callback.
 */
export interface CpmExitInfo {
  /** Why the program exited */
  reason: 'warmboot' | 'halt' | 'error';
  /** Human-readable description */
  message: string;
  /** Number of T-states executed */
  tStates: number;
  /** Program counter at exit */
  pc: number;
}

/**
 * Extended console interface for scripted/automated interaction.
 * Used by ScriptedCompiler for expect-style automation.
 */
export interface ScriptedConsole extends CpmConsole {
  /** Wait for a pattern to appear in output (expect-style) */
  waitFor(pattern: string | RegExp, timeoutMs?: number): Promise<void>;
  /** Clear the output buffer (call after sending input) */
  clearOutputBuffer(): void;
  /** Queue input with delays between characters (simulates typing) */
  queueInputSlow(input: string, delayMs?: number): Promise<void>;
  /** Write a string to the terminal */
  writeString?(str: string): void;
}

/**
 * Options for creating a CP/M emulator instance.
 */
export interface CpmOptions {
  /** Virtual filesystem */
  fs: VirtualFS;

  /** Console for I/O */
  console: CpmConsole;

  /** Called when CP/M program exits (WBOOT or JP 0) */
  onExit?: (info: CpmExitInfo) => void;

  /** Optional logging function for debug output */
  log?: (msg: string) => void;

  /** Map from drive number (0=A, 1=B, ...) to directory path in VFS */
  drives?: Map<number, string>;

  /**
   * Address to load shell at.
   * - 0x0100 (TPA) for .COM-style shells like XCCP
   * - 0xDC00 (CCP area) for resident CCPs like Z80CCP
   * Default: 0x0100 (TPA) for .COM compatibility
   */
  shellAddress?: number;
}
