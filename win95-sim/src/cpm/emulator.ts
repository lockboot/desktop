/**
 * CP/M Emulator - Virtualized Z80 with BDOS/CBIOS hooks.
 *
 * This is a browser-compatible refactoring of cpmemu.ts that uses
 * pluggable interfaces for filesystem and console I/O.
 */

import { lo, hi, inc16 } from 'z80-base';
import type { Hal } from 'z80-emulator';
import { Z80 } from 'z80-emulator';
import type { VirtualFS, CpmConsole, CpmOptions, CpmExitInfo } from './types';

// Memory layout constants
const TPA_ADDRESS = 0x0100;      // Transient Program Area (where .COM files load)
export const CCP_ADDRESS = 0xDC00;      // Console Command Processor (resident shell)
const CPM_CALL_ADDRESS = 0x0005;
const RECORD_SIZE = 128;
const DEFAULT_DMA = 0x0080;
const FCB1_ADDRESS = 0x005C;
const FCB2_ADDRESS = 0x006C;
const BDOS_ADDRESS = 0xFE00;
const CBIOS_ADDRESS = 0xFF00;

// CBIOS entry points
const CbiosEntryPoint = {
  BOOT: 0,    // COLD START
  WBOOT: 1,   // WARM START
  CONST: 2,   // CONSOLE STATUS
  CONIN: 3,   // CONSOLE CHARACTER IN
  CONOUT: 4,  // CONSOLE CHARACTER OUT
  LIST: 5,    // LIST CHARACTER OUT
  PUNCH: 6,   // PUNCH CHARACTER OUT
  READER: 7,  // READER CHARACTER OUT
  HOME: 8,    // MOVE HEAD TO HOME POSITION
  SELDSK: 9,  // SELECT DISK
  SETTRK: 10, // SET TRACK NUMBER
  SETSEC: 11, // SET SECTOR NUMBER
  SETDMA: 12, // SET DMA ADDRESS
  READ: 13,   // READ DISK
  WRITE: 14,  // WRITE DISK
  LISTST: 15, // RETURN LIST STATUS
  SECTRAN: 16,// SECTOR TRANSLATE
} as const;
type CbiosEntryPoint = typeof CbiosEntryPoint[keyof typeof CbiosEntryPoint];

const CBIOS_ENTRY_POINT_NAMES = [
  'BOOT', 'WBOOT', 'CONST', 'CONIN', 'CONOUT', 'LIST', 'PUNCH', 'READER',
  'HOME', 'SELDSK', 'SETTRK', 'SETSEC', 'SETDMA', 'READ', 'WRITE', 'LISTST', 'SECTRAN'
];
const CBIOS_ENTRY_POINT_COUNT = 17;

// BDOS function names for tracing
const BDOS_FUNCTION_NAMES: Record<number, string> = {
  0: 'P_TERMCPM',      // System Reset
  1: 'C_READ',         // Console Input
  2: 'C_WRITE',        // Console Output
  3: 'A_READ',         // Reader Input
  4: 'A_WRITE',        // Punch Output
  5: 'L_WRITE',        // List Output
  6: 'C_RAWIO',        // Direct Console I/O
  7: 'A_STATIN',       // Get I/O Byte
  8: 'A_STATOUT',      // Set I/O Byte
  9: 'C_WRITESTR',     // Print String
  10: 'C_READSTR',     // Read Console Buffer
  11: 'C_STAT',        // Get Console Status
  12: 'S_BDOSVER',     // Return Version Number
  13: 'DRV_ALLRESET',  // Reset Disk System
  14: 'DRV_SET',       // Select Disk
  15: 'F_OPEN',        // Open File
  16: 'F_CLOSE',       // Close File
  17: 'F_SFIRST',      // Search for First
  18: 'F_SNEXT',       // Search for Next
  19: 'F_DELETE',      // Delete File
  20: 'F_READ',        // Read Sequential
  21: 'F_WRITE',       // Write Sequential
  22: 'F_MAKE',        // Make File
  23: 'F_RENAME',      // Rename File
  24: 'DRV_LOGINVEC',  // Return Login Vector
  25: 'DRV_GET',       // Return Current Disk
  26: 'F_DMAOFF',      // Set DMA Address
  27: 'DRV_ALLOCVEC',  // Get Addr (Alloc)
  28: 'DRV_SETRO',     // Write Protect Disk
  29: 'DRV_ROVEC',     // Get R/O Vector
  30: 'F_ATTRIB',      // Set File Attributes
  31: 'DRV_DPB',       // Get Addr (DPB)
  32: 'F_USERNUM',     // Get/Set User Code
  33: 'F_READRAND',    // Read Random
  34: 'F_WRITERAND',   // Write Random
  35: 'F_SIZE',        // Compute File Size
  36: 'F_RANDREC',     // Set Random Record
  37: 'DRV_RESET',     // Reset Drive
  40: 'F_WRITEZF',     // Write Random with Zero Fill
};

const FD_SIGNATURE = 0xBEEF;

/**
 * File Control Block - view into CP/M memory for file operations.
 * http://members.iinet.net.au/~daveb/cpm/fcb.html
 */
class Fcb {
  private mem: Uint8Array;

  constructor(mem: Uint8Array) {
    this.mem = mem;
  }

  /** Clear internal state for file open/create (s2, fd, currentRecord) */
  clear(): void {
    this.s2 = 0;
    this.fd = 0;
    this.currentRecord = 0;  // Reset sequential record counter
  }

  /** Drive number: 0 = current, 1 = A:, 2 = B:, etc. */
  get drive(): number {
    return this.mem[0];
  }

  /** Main filename (8 chars max, without extension) */
  get name(): string {
    let name = '';
    for (let i = 1; i < 9; i++) {
      const letter = this.mem[i] & 0x7F;
      if (letter > 32) name += String.fromCodePoint(letter);
    }
    return name;
  }

  /** File extension (3 chars max, without dot) */
  get fileType(): string {
    let ext = '';
    for (let i = 9; i < 12; i++) {
      const letter = this.mem[i] & 0x7F;
      if (letter > 32) ext += String.fromCodePoint(letter);
    }
    return ext;
  }

  /** Full filename with extension */
  getFilename(): string {
    const ext = this.fileType;
    return ext ? `${this.name}.${ext}` : this.name;
  }

  /** Get raw name bytes (8 chars, space-padded, with ? wildcards preserved) */
  getRawName(): string {
    let name = '';
    for (let i = 1; i < 9; i++) {
      const letter = this.mem[i] & 0x7F;
      name += String.fromCodePoint(letter);
    }
    return name;
  }

  /** Get raw extension bytes (3 chars, space-padded, with ? wildcards preserved) */
  getRawExt(): string {
    let ext = '';
    for (let i = 9; i < 12; i++) {
      const letter = this.mem[i] & 0x7F;
      ext += String.fromCodePoint(letter);
    }
    return ext;
  }

  /** Current extent number */
  get ex(): number { return this.mem[0x0C]; }
  set ex(n: number) { this.mem[0x0C] = n; }

  get s2(): number { return this.mem[0x0E]; }
  set s2(n: number) { this.mem[0x0E] = n; }

  /** Current record within extent */
  get cr(): number { return this.mem[0x20]; }
  set cr(n: number) { this.mem[0x20] = n; }

  /** Computed current record for sequential access */
  get currentRecord(): number {
    if (this.cr > 127 || this.ex > 31 || this.s2 > 16 || (this.s2 === 16 && (this.cr !== 0 || this.ex !== 0))) {
      throw new Error('Invalid current record');
    }
    return this.cr | (this.ex << 7) | (this.s2 << 12);
  }

  set currentRecord(n: number) {
    this.cr = n & 0x7F;
    this.ex = (n >> 7) & 0x1F;
    this.s2 = n >> 12;
  }

  /** Record number for random access */
  get randomRecord(): number {
    return this.mem[0x21] | (this.mem[0x22] << 8);
  }

  set randomRecord(n: number) {
    this.mem[0x21] = n & 0xFF;
    this.mem[0x22] = (n >> 8) & 0xFF;
    this.mem[0x23] = n > 0xFFFF ? 0x01 : 0x00;
  }

  /** Check if FCB has a valid file descriptor */
  get hasValidFd(): boolean {
    const n1 = this.mem[0x10] | (this.mem[0x11] << 8);
    const n2 = this.mem[0x12] | (this.mem[0x13] << 8);
    return (n1 ^ FD_SIGNATURE) === n2 && n1 !== 0;
  }

  /** File descriptor stored in FCB (using d[] bytes), returns -1 if invalid */
  get fd(): number {
    const n1 = this.mem[0x10] | (this.mem[0x11] << 8);
    const n2 = this.mem[0x12] | (this.mem[0x13] << 8);
    if ((n1 ^ FD_SIGNATURE) !== n2) {
      return -1; // Invalid FD - FCB wasn't opened through our F_OPEN
    }
    return n1;
  }

  set fd(n: number) {
    this.mem[0x10] = n & 0xFF;
    this.mem[0x11] = (n >> 8) & 0xFF;
    const sig = n ^ FD_SIGNATURE;
    this.mem[0x12] = sig & 0xFF;
    this.mem[0x13] = (sig >> 8) & 0xFF;
  }

  /** Blank out filename area */
  static blankOut(memory: Uint8Array, address: number): void {
    memory[address] = 0;
    for (let i = 0; i < 11; i++) {
      memory[address + i + 1] = 0x20; // space
    }
  }
}

/**
 * CP/M Emulator - Z80 HAL implementation with BDOS hooks.
 */
export class CpmEmulator implements Hal {
  private memory = new Uint8Array(64 * 1024);
  private fs: VirtualFS;
  private con: CpmConsole;
  private log: (msg: string) => void;
  private onExit: (info: CpmExitInfo) => void;
  private currentDrive = 0;
  private currentUser = 0;
  private driveDirMap = new Map<number, string>();
  private dma = DEFAULT_DMA;
  private dirEntries: string[] = [];
  private currentSearchDir: string | null = null; // Directory being searched
  private searchPatternName: string = '????????'; // 8-char name pattern (? = wildcard)
  private searchPatternExt: string = '???'; // 3-char ext pattern (? = wildcard)
  private keyQueue: number[] = [];
  private keyResolve: ((key: number) => void) | undefined;
  private running = false;
  private shellBinary: Uint8Array | null = null;
  private shellAddress: number; // Where to load the shell (CCP_ADDRESS or TPA_ADDRESS)
  private consecutivePolls = 0; // Track consecutive "no key" polls for smart throttling

  // Public for Z80
  tStateCount = 0;

  // Z80 CPU
  readonly z80: Z80;

  // Debugging
  syscallTrace = false;

  constructor(options: CpmOptions) {
    this.fs = options.fs;
    this.con = options.console;
    this.log = options.log ?? (() => {});
    this.onExit = options.onExit ?? (() => { /* no-op */ });
    this.shellAddress = options.shellAddress ?? TPA_ADDRESS;

    // Set up drives
    if (options.drives) {
      for (const [drive, dir] of options.drives) {
        this.driveDirMap.set(drive, dir);
      }
    } else {
      // Default: A: maps to root
      this.driveDirMap.set(0, '/');
    }

    // Set up low memory system area
    this.memory[0x0000] = 0xC3; // JP WBOOT
    this.memory[0x0001] = lo(CBIOS_ADDRESS + 3);
    this.memory[0x0002] = hi(CBIOS_ADDRESS + 3);
    this.memory[0x0003] = 0x00; // IOBYTE
    this.memory[0x0004] = this.currentDrive; // Current drive
    this.memory[CPM_CALL_ADDRESS] = 0xC3; // JP BDOS
    this.memory[CPM_CALL_ADDRESS + 1] = lo(BDOS_ADDRESS);
    this.memory[CPM_CALL_ADDRESS + 2] = hi(BDOS_ADDRESS);
    this.memory[BDOS_ADDRESS] = 0xC9; // RET

    // Set all CBIOS routines to just return
    for (let i = 0; i < CBIOS_ENTRY_POINT_COUNT; i++) {
      this.memory[CBIOS_ADDRESS + i * 3] = 0xC9; // RET
    }

    // Blank command-line FCBs
    Fcb.blankOut(this.memory, FCB1_ADDRESS);
    Fcb.blankOut(this.memory, FCB2_ADDRESS);

    // Create Z80 CPU
    this.z80 = new Z80(this);
    this.z80.reset();
    this.z80.regs.pc = this.shellAddress; // Start at shell
    this.z80.regs.sp = BDOS_ADDRESS;

    // Push return address 0x0000 so RET goes to warm boot
    this.z80.regs.sp -= 2;
    this.memory[this.z80.regs.sp] = 0x00;
    this.memory[this.z80.regs.sp + 1] = 0x00;
  }

  /** Load binary into memory */
  load(bin: Uint8Array, isShell = true): void {
    const loadAddr = isShell ? this.shellAddress : TPA_ADDRESS;
    for (let i = 0; i < bin.length; i++) {
      this.memory[loadAddr + i] = bin[i];
    }
    // Save as shell binary for warm boot
    if (isShell) {
      this.shellBinary = new Uint8Array(bin);
    }
  }

  /** Perform warm boot - reload shell and restart */
  private warmBoot(): void {
    this.traceStartTime = performance.now(); // Reset trace timer

    // Flush all open files before reloading shell
    this.fs.closeAll();

    if (!this.shellBinary) {
      this.running = false;
      this.onExit({
        reason: 'warmboot',
        message: 'No shell to reload',
        tStates: this.tStateCount,
        pc: 0
      });
      return;
    }

    // Reload shell at configured address
    for (let i = 0; i < this.shellBinary.length; i++) {
      this.memory[this.shellAddress + i] = this.shellBinary[i];
    }

    // Re-initialize system vectors (programs may have overwritten them)
    this.memory[0x0000] = 0xC3; // JP WBOOT
    this.memory[0x0001] = lo(CBIOS_ADDRESS + 3);
    this.memory[0x0002] = hi(CBIOS_ADDRESS + 3);
    this.memory[0x0003] = 0x00; // IOBYTE
    this.memory[0x0004] = this.currentDrive; // Current drive (A: = 0)
    this.memory[CPM_CALL_ADDRESS] = 0xC3; // JP BDOS
    this.memory[CPM_CALL_ADDRESS + 1] = lo(BDOS_ADDRESS);
    this.memory[CPM_CALL_ADDRESS + 2] = hi(BDOS_ADDRESS);

    // Reset DMA and directory search state
    this.dma = DEFAULT_DMA;
    this.dirEntries = [];
    this.currentSearchDir = null;
    this.searchPatternName = '????????';
    this.searchPatternExt = '???';

    // Clear command line buffer and tail area
    this.memory[0x0080] = 0;
    for (let i = 0x0081; i < 0x0100; i++) {
      this.memory[i] = 0;
    }

    // Blank out FCBs
    Fcb.blankOut(this.memory, FCB1_ADDRESS);
    Fcb.blankOut(this.memory, FCB2_ADDRESS);

    // Full CPU reset
    this.z80.reset();
    this.z80.regs.pc = this.shellAddress; // Start at shell
    this.z80.regs.sp = BDOS_ADDRESS; // Stack below BDOS

    // Set C = current drive to signal warm boot (CCP skips banner)
    this.z80.regs.c = this.currentDrive;

    // Push return address 0x0000 so RET at end of program goes to warm boot
    this.z80.regs.sp -= 2;
    this.memory[this.z80.regs.sp] = 0x00;
    this.memory[this.z80.regs.sp + 1] = 0x00;
  }

  /** Set command-line arguments (tail at 0x0080) */
  setCommandLine(args: string): void {
    const tail = ' ' + args.toUpperCase();
    const len = Math.min(tail.length, 127);
    this.memory[0x0080] = len;
    for (let i = 0; i < len; i++) {
      this.memory[0x0081 + i] = tail.charCodeAt(i);
    }
  }

  /** Load a program into TPA (0x0100) for direct execution */
  loadProgram(binary: Uint8Array): void {
    for (let i = 0; i < binary.length; i++) {
      this.memory[TPA_ADDRESS + i] = binary[i];
    }
  }

  /** Set up for running a transient program (not shell) */
  setupTransient(binary: Uint8Array, args: string = ''): void {
    // Initialize system vectors (required - programs read these!)
    this.memory[0x0000] = 0xC3; // JP WBOOT
    this.memory[0x0001] = lo(CBIOS_ADDRESS + 3);
    this.memory[0x0002] = hi(CBIOS_ADDRESS + 3);
    this.memory[0x0003] = 0x00; // IOBYTE
    this.memory[0x0004] = this.currentDrive; // Current drive
    this.memory[0x0005] = 0xC3; // JP BDOS
    this.memory[0x0006] = lo(BDOS_ADDRESS);
    this.memory[0x0007] = hi(BDOS_ADDRESS);


    // Load program at TPA
    this.loadProgram(binary);

    // Set command line and FCBs
    if (args) {
      this.setCommandLine(args);
      // Parse first argument into FCB1
      const argParts = args.trim().toUpperCase().split(/\s+/);
      if (argParts[0]) {
        this.parseFCBArg(FCB1_ADDRESS, argParts[0]);
      }
      // Parse second argument into FCB2 (only first 16 bytes used)
      if (argParts[1]) {
        this.parseFCBArg(FCB2_ADDRESS, argParts[1]);
      } else {
        // Clear FCB2 if no second argument
        for (let i = 0; i < 16; i++) {
          this.memory[FCB2_ADDRESS + i] = i >= 1 && i < 12 ? 0x20 : 0;
        }
      }
    } else {
      this.memory[0x0080] = 0;
      // Clear both FCBs
      for (let i = 0; i < 16; i++) {
        this.memory[FCB1_ADDRESS + i] = i >= 1 && i < 12 ? 0x20 : 0;
        this.memory[FCB2_ADDRESS + i] = i >= 1 && i < 12 ? 0x20 : 0;
      }
    }

    // Initialize CPU state
    this.z80.regs.pc = TPA_ADDRESS;
    this.z80.regs.sp = BDOS_ADDRESS;

    // Push return address 0x0000 (warm boot on RET)
    this.z80.regs.sp -= 2;
    this.memory[this.z80.regs.sp] = 0x00;
    this.memory[this.z80.regs.sp + 1] = 0x00;

    // Reset DMA
    this.dma = DEFAULT_DMA;
  }

  /** Parse a single filename argument into FCB at given address */
  private parseFCBArg(address: number, arg: string): void {
    // Clear FCB (at least first 16 bytes for FCB2 compatibility)
    for (let i = 0; i < 16; i++) {
      this.memory[address + i] = 0;
    }
    // Fill name/type with spaces
    for (let i = 1; i < 12; i++) {
      this.memory[address + i] = 0x20;
    }

    arg = arg.trim().toUpperCase();

    // Check for drive prefix
    let drive = 0;
    if (arg.length >= 2 && arg[1] === ':') {
      drive = arg.charCodeAt(0) - 64; // A=1, B=2, etc.
      arg = arg.slice(2);
    }
    this.memory[address] = drive;

    // Split name.ext
    const dotPos = arg.indexOf('.');
    const name = dotPos >= 0 ? arg.slice(0, dotPos) : arg;
    const ext = dotPos >= 0 ? arg.slice(dotPos + 1) : '';

    // Fill name (8 chars), handle * wildcard -> ???????
    for (let i = 0; i < 8; i++) {
      if (name === '*' || (name.length > i && name[i] === '*')) {
        // Fill rest with ?
        for (let j = i; j < 8; j++) {
          this.memory[address + 1 + j] = '?'.charCodeAt(0);
        }
        break;
      } else if (i < name.length) {
        this.memory[address + 1 + i] = name.charCodeAt(i);
      }
    }

    // Fill extension (3 chars), handle * wildcard -> ???
    for (let i = 0; i < 3; i++) {
      if (ext === '*' || (ext.length > i && ext[i] === '*')) {
        for (let j = i; j < 3; j++) {
          this.memory[address + 9 + j] = '?'.charCodeAt(0);
        }
        break;
      } else if (i < ext.length) {
        this.memory[address + 9 + i] = ext.charCodeAt(i);
      }
    }
  }

  /** Set the current drive (0=A:, 1=B:, etc.) */
  setCurrentDrive(drive: number): void {
    this.currentDrive = drive;
    this.memory[0x0004] = drive; // Also update page zero
  }

  /** Get raw memory access (for testing/debugging) */
  getMemory(): Uint8Array {
    return this.memory;
  }

  /** Send a keypress to the emulator */
  sendKey(key: number): void {
    if (this.keyResolve) {
      const resolve = this.keyResolve;
      this.keyResolve = undefined;
      resolve(key);
    } else {
      this.keyQueue.push(key);
    }
  }

  /** Check if emulator is waiting for input */
  isWaitingForKey(): boolean {
    return this.keyResolve !== undefined;
  }

  /** Stop the emulator */
  stop(): void {
    this.running = false;
  }

  /** Run the emulator until exit or stop */
  async run(): Promise<void> {
    this.running = true;
    while (this.running) {
      await this.step();
      // Yield to event loop periodically
      if (this.tStateCount % 10000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  /** Execute one instruction and handle any CP/M calls */
  async step(): Promise<void> {
    this.z80.step();

    const pc = this.z80.regs.pc;

    // Check for HALT instruction - exit emulator
    if ((this.z80.regs as { halted?: number }).halted) {
      this.running = false;
      this.fs.closeAll();
      this.onExit({
        reason: 'halt',
        message: 'CPU halted',
        tStates: this.tStateCount,
        pc,
      });
      return;
    }

    if (pc === BDOS_ADDRESS) {
      await this.handleBdos();
    } else if (pc >= CBIOS_ADDRESS) {
      await this.handleCbios();
    } else if (pc === 0) {
      // Program exited via JP 0 - warm boot to reload shell
      this.warmBoot();
    }
  }

  // HAL interface
  readMemory(address: number): number {
    return this.memory[address];
  }

  writeMemory(address: number, value: number): void {
    this.memory[address] = value;
  }

  contendMemory(_address: number): void {}
  readPort(_address: number): number { return 0xFF; }
  writePort(_address: number, _value: number): void {}
  contendPort(_address: number): void {}

  /** Wait for a key from the console */
  private async readKey(): Promise<number> {
    if (this.keyQueue.length > 0) {
      return this.keyQueue.shift()!;
    }
    if (this.con.waitForKey) {
      return this.con.waitForKey();
    }
    return new Promise(resolve => {
      this.keyResolve = resolve;
    });
  }

  /** Get drive directory for an FCB, returns null for invalid/unmapped drives */
  private getDriveDir(fcb: Fcb): string | null {
    const drive = fcb.drive === 0 || fcb.drive === 0x3F ? this.currentDrive : fcb.drive - 1;
    // Validate drive number (0-15)
    if (drive < 0 || drive > 15) {
      console.warn(`[CPM] Invalid drive number in FCB: ${fcb.drive} -> ${drive}`);
      return null;
    }
    const dir = this.driveDirMap.get(drive);
    if (!dir) {
      console.warn(`[CPM] Unmapped drive: ${drive} (${String.fromCharCode(65 + drive)}:)`);
      return null;
    }
    return dir;
  }

  /** Make full pathname from FCB, returns null for invalid drives */
  private makePathname(fcb: Fcb): string | null {
    const dir = this.getDriveDir(fcb);
    if (!dir) return null;
    const filename = fcb.getFilename();
    return dir.endsWith('/') ? dir + filename : dir + '/' + filename;
  }

  /** Check if a filename matches the search pattern (supports ? wildcards) */
  private matchesSearchPattern(filename: string): boolean {
    // Parse filename into name and ext
    const dotIdx = filename.lastIndexOf('.');
    const name = (dotIdx >= 0 ? filename.slice(0, dotIdx) : filename).toUpperCase();
    const ext = (dotIdx >= 0 ? filename.slice(dotIdx + 1) : '').toUpperCase();

    // Pad to 8.3 format
    const paddedName = name.padEnd(8, ' ').slice(0, 8);
    const paddedExt = ext.padEnd(3, ' ').slice(0, 3);

    // Match each character (? matches anything)
    for (let i = 0; i < 8; i++) {
      const pattern = this.searchPatternName.charCodeAt(i);
      const actual = paddedName.charCodeAt(i);
      if (pattern !== 0x3F && pattern !== actual) { // 0x3F = '?'
        return false;
      }
    }
    for (let i = 0; i < 3; i++) {
      const pattern = this.searchPatternExt.charCodeAt(i);
      const actual = paddedExt.charCodeAt(i);
      if (pattern !== 0x3F && pattern !== actual) { // 0x3F = '?'
        return false;
      }
    }
    return true;
  }

  /** Search for next directory entry */
  private searchForNextDirEntry(): number {
    // Find next file that matches the search pattern
    let filename: string | undefined;
    while ((filename = this.dirEntries.shift()) !== undefined) {
      if (this.matchesSearchPattern(filename)) {
        break;
      }
    }

    if (!filename) {
      return 0xFF; // No more entries
    }

    // Clear FCB area in DMA
    this.memory.fill(0, this.dma, this.dma + 32);
    this.memory.fill(0xE5, this.dma + 32, this.dma + RECORD_SIZE);

    // Parse filename
    const dotIdx = filename.lastIndexOf('.');
    const name = dotIdx >= 0 ? filename.slice(0, dotIdx) : filename;
    const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1) : '';

    // Fill name (8 chars, space-padded, uppercase)
    this.memory.fill(0x20, this.dma + 1, this.dma + 12);
    for (let i = 0; i < Math.min(name.length, 8); i++) {
      this.memory[this.dma + 1 + i] = name.toUpperCase().charCodeAt(i);
    }
    // Fill extension (3 chars, uppercase)
    for (let i = 0; i < Math.min(ext.length, 3); i++) {
      this.memory[this.dma + 9 + i] = ext.toUpperCase().charCodeAt(i);
    }

    // Get file size and calculate record count
    // CP/M directory entry format:
    //   Byte 12: Extent number (EX) - for files > 16K
    //   Byte 15: Record count (RC) - number of 128-byte records in this extent (0-128)
    const dir = this.currentSearchDir ?? this.driveDirMap.get(this.currentDrive) ?? '/';
    const fullPath = dir.endsWith('/') ? dir + filename : dir + '/' + filename;
    const stat = this.fs.stat(fullPath);
    if (stat) {
      const totalRecords = Math.ceil(stat.size / 128);
      // For simplicity, put everything in extent 0 if < 16K (128 records)
      // Larger files would need multiple extents, but most utilities just check RC
      const recordsInExtent = Math.min(totalRecords, 128);
      this.memory[this.dma + 12] = 0; // Extent number (EX)
      this.memory[this.dma + 15] = recordsInExtent; // Record count (RC)
    }

    return 0x00; // Success
  }

  /** Format a value for tracing */
  private traceVal(val: number, asChar = false): string {
    if (asChar && val >= 32 && val < 127) {
      return `${val} '${String.fromCharCode(val)}'`;
    }
    return val.toString();
  }

  private traceStartTime = performance.now();

  /** Format timestamp relative to start */
  private traceTime(): string {
    const elapsed = performance.now() - this.traceStartTime;
    return `+${elapsed.toFixed(1)}ms`;
  }

  /** Log syscall entry */
  private traceEntry(name: string, args: string): void {
    if (this.syscallTrace) {
      console.log(`[BDOS ${this.traceTime()}] ${name}(${args})`);
    }
  }

  /** Log syscall result */
  private traceResult(name: string, result: string): void {
    if (this.syscallTrace) {
      console.log(`[BDOS ${this.traceTime()}] ${name} => ${result}`);
    }
  }

  /** Handle BDOS call (C register = function number) */
  private async handleBdos(): Promise<void> {
    const f = this.z80.regs.c;
    const regs = this.z80.regs;
    const fname = BDOS_FUNCTION_NAMES[f] ?? `UNKNOWN_${f}`;

    // Reset poll counter on non-polling BDOS calls (file I/O, output, etc.)
    if (f !== 6 && f !== 11) {
      this.consecutivePolls = 0;
    }

    // http://members.iinet.net.au/~daveb/cpm/bdos.html
    switch (f) {
      case 0: { // System reset (P_TERMCPM) - terminate program
        this.traceEntry(fname, '');
        console.log('[CPM] Program terminated (BDOS function 0)');
        this.warmBoot();
        break;
      }

      case 1: { // Console input
        this.traceEntry(fname, '');
        const ch = await this.readKey();
        regs.a = ch;
        regs.l = ch;
        this.con.write(ch);
        this.traceResult(fname, `A=${this.traceVal(ch, true)}`);
        break;
      }

      case 2: { // Console output
        this.traceEntry(fname, `E=${this.traceVal(regs.e, true)}`);
        this.con.write(regs.e);
        break;
      }

      case 5: { // Printer output
        this.traceEntry(fname, `E=${this.traceVal(regs.e, true)}`);
        this.con.print?.(regs.e);
        break;
      }

      case 6: { // Direct console I/O (C_RAWIO)
        if (regs.e === 0xFF) {
          // E=0xFF: Return char if available, 0 if none (non-blocking)
          let ch = this.keyQueue.shift();
          const conHasKey = this.con.hasKey();
          if (this.syscallTrace && (ch !== undefined || conHasKey)) {
            console.log(`[C_RAWIO] Poll: keyQueue=${this.keyQueue.length}, con.hasKey=${conHasKey}`);
          }
          if (ch === undefined && conHasKey) {
            ch = this.con.getKey();
          }
          if (ch === undefined) {
            // Smart throttling: only delay after many consecutive polls (idle loop)
            // Occasional polls (like Ctrl+C checks) don't trigger delay
            this.consecutivePolls++;
            if (this.consecutivePolls > 50) {
              await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps when idle
            }
          } else {
            this.consecutivePolls = 0;
          }
          regs.a = ch ?? 0;
          if (ch !== undefined) {
            this.traceEntry(fname, 'E=FF (read)');
            this.traceResult(fname, `A=${this.traceVal(ch, true)}`);
          }
        } else if (regs.e === 0xFE) {
          // E=0xFE: Return console status (CP/M 3+)
          const hasKey = this.keyQueue.length > 0 || this.con.hasKey();
          regs.a = hasKey ? 0xFF : 0x00;
          this.traceEntry(fname, 'E=FE (status)');
          this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        } else if (regs.e === 0xFD) {
          // E=0xFD: Wait for char, return without echo (CP/M 3+)
          this.traceEntry(fname, 'E=FD (wait)');
          const ch = await this.readKey();
          regs.a = ch;
          this.traceResult(fname, `A=${this.traceVal(ch, true)}`);
        } else {
          // Output character
          this.traceEntry(fname, `E=${this.traceVal(regs.e, true)} (write)`);
          this.con.write(regs.e);
        }
        break;
      }

      case 9: { // Print $-terminated string
        this.traceEntry(fname, `DE=${regs.de.toString(16).toUpperCase()}`);
        let addr = regs.de;
        let str = '';
        while (true) {
          const ch = this.memory[addr];
          if (ch === 0x24) break; // '$'
          str += String.fromCharCode(ch);
          this.con.write(ch);
          addr = inc16(addr);
        }
        if (this.syscallTrace && str.length <= 80) {
          this.traceResult(fname, `"${str.replace(/\r\n/g, '\\r\\n')}"`);
        }
        break;
      }

      case 10: { // Buffered console input
        this.traceEntry(fname, `DE=${regs.de.toString(16).toUpperCase()} max=${this.memory[regs.de]}`);
        const maxLen = this.memory[regs.de];
        let pos = 0;
        const buffer: number[] = [];
        while (pos < maxLen) {
          const ch = await this.readKey();
          if (ch === 13) { // Enter
            this.con.write(13);
            this.con.write(10);
            break;
          } else if (ch === 8 || ch === 127) { // Backspace
            if (pos > 0) {
              pos--;
              buffer.pop();
              this.con.write(8);
              this.con.write(32);
              this.con.write(8);
            }
          } else if (ch >= 32) {
            buffer.push(ch);
            pos++;
            this.con.write(ch);
          }
        }
        this.memory[regs.de + 1] = buffer.length;
        for (let i = 0; i < buffer.length; i++) {
          this.memory[regs.de + 2 + i] = buffer[i];
        }
        const inputStr = buffer.map(c => String.fromCharCode(c)).join('');
        this.traceResult(fname, `len=${buffer.length} "${inputStr}"`);
        break;
      }

      case 11: { // Console status
        this.traceEntry(fname, '');
        const status = this.keyQueue.length > 0 || this.con.hasKey() ? 1 : 0;
        regs.a = status;
        regs.l = status;
        this.traceResult(fname, `A=${status}`);
        break;
      }

      case 12: { // Return version number
        this.traceEntry(fname, '');
        regs.a = 0x22; // CP/M 2.2
        regs.b = 0x00; // System type
        regs.h = 0x00;
        regs.l = 0x22;
        this.traceResult(fname, 'A=22 (CP/M 2.2)');
        break;
      }

      case 13: { // Reset disk system
        this.traceEntry(fname, '');
        this.traceResult(fname, 'OK');
        break;
      }

      case 14: { // Select drive
        this.traceEntry(fname, `E=${regs.e} (${String.fromCharCode(65 + regs.e)}:)`);
        if (this.driveDirMap.has(regs.e)) {
          this.currentDrive = regs.e;
          this.memory[0x0004] = regs.e; // Update low memory current drive byte
          this.log(`Selected drive ${regs.e}`);
          regs.a = 0;
        } else {
          regs.a = 0xFF;
        }
        regs.l = regs.a;
        this.traceResult(fname, `A=${regs.a}`);
        break;
      }

      case 15: { // Open file
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        fcb.clear();
        this.log(`Opening ${filename}`);
        const pathname = this.makePathname(fcb);
        if (!pathname) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        const fd = this.fs.open(pathname, 'r+');
        if (fd >= 0) {
          fcb.fd = fd;
          regs.a = 0x00;
          this.traceResult(fname, `A=00 fd=${fd}`);
        } else {
          fcb.fd = 0;
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (not found)');
        }
        break;
      }

      case 16: { // Close file
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        this.log(`Closing ${filename}`);
        const fd = fcb.fd;
        if (fd <= 0) {
          // FCB wasn't opened through our F_OPEN - just pretend success
          regs.a = 0x00;
          this.traceResult(fname, 'A=00 (no-op, not opened via F_OPEN)');
          break;
        }
        this.fs.close(fd);
        fcb.fd = 0;
        regs.a = 0x00;
        this.traceResult(fname, 'A=00');
        break;
      }

      case 17: { // Search for first
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        this.log(`Search for first ${filename}`);
        const dirName = this.getDriveDir(fcb);
        if (!dirName) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        this.currentSearchDir = dirName; // Save for searchForNextDirEntry
        this.searchPatternName = fcb.getRawName(); // Save search pattern
        this.searchPatternExt = fcb.getRawExt();
        this.dirEntries = this.fs.readdir(dirName).sort();
        regs.a = this.searchForNextDirEntry();
        this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        break;
      }

      case 18: { // Search for next
        this.traceEntry(fname, '');
        this.log('Search for next');
        regs.a = this.searchForNextDirEntry();
        this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        break;
      }

      case 19: { // Delete file
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        this.log(`Deleting ${filename}`);
        const pathname = this.makePathname(fcb);
        if (!pathname) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        regs.a = this.fs.unlink(pathname) ? 0x00 : 0xFF;
        this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        break;
      }

      case 20: { // Read sequential
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        let fd = fcb.fd;
        if (fd <= 0) {
          // Try to auto-open the file
          const pathname = this.makePathname(fcb);
          if (!pathname) {
            regs.a = 0x09;
            this.traceResult(BDOS_FUNCTION_NAMES[20] ?? 'F_READ', 'A=09 (invalid drive)');
            break;
          }
          fd = this.fs.open(pathname, 'r');
          if (fd < 0) {
            regs.a = 0x09; // Invalid FCB
            this.traceResult(BDOS_FUNCTION_NAMES[20] ?? 'F_READ', 'A=09 (file not open)');
            break;
          }
          fcb.fd = fd;
        }
        const recordNum = fcb.currentRecord;
        this.log(`Sequential read record ${recordNum} from ${filename}`);
        const bytesRead = this.fs.read(fd, this.memory, this.dma, RECORD_SIZE, recordNum * RECORD_SIZE);
        if (bytesRead === 0) {
          regs.a = 0x01; // EOF
          this.traceEntry(fname, `"${filename}" rec=${recordNum}`);
          this.traceResult(fname, 'A=01 (EOF)');
        } else {
          this.memory.fill(26, this.dma + bytesRead, this.dma + RECORD_SIZE); // ^Z padding
          const readData = this.memory.slice(this.dma, this.dma + bytesRead);
          const readPreview = String.fromCharCode(...readData.slice(0, 60).filter(b => b >= 32 && b < 127));
          this.traceEntry(fname, `"${filename}" rec=${recordNum} => "${readPreview}..."`);
          regs.a = 0x00;
          fcb.currentRecord = recordNum + 1;
          this.traceResult(fname, `A=00 bytes=${bytesRead}`);
        }
        regs.l = regs.a;
        regs.h = 0;
        regs.b = 0;
        break;
      }

      case 21: { // Write sequential
        const fcb = new Fcb(this.memory.subarray(regs.de));
        let fd = fcb.fd;
        if (fd <= 0) {
          // Try to auto-open the file for writing
          const pathname = this.makePathname(fcb);
          if (!pathname) {
            regs.a = 0x09;
            this.traceResult(BDOS_FUNCTION_NAMES[21] ?? 'F_WRITE', 'A=09 (invalid drive)');
            break;
          }
          fd = this.fs.open(pathname, 'r+');
          if (fd < 0) {
            // Try to create it
            fd = this.fs.open(pathname, 'wx+');
          }
          if (fd < 0) {
            regs.a = 0x09; // Invalid FCB
            this.traceResult(BDOS_FUNCTION_NAMES[21] ?? 'F_WRITE', 'A=09 (file not open)');
            break;
          }
          fcb.fd = fd;
        }
        const recordNum = fcb.currentRecord;
        const filename = fcb.getFilename();
        // Debug: show DMA buffer contents
        const dmaData = this.memory.slice(this.dma, this.dma + RECORD_SIZE);
        const dmaPreview = String.fromCharCode(...dmaData.slice(0, 40).filter(b => b >= 32 && b < 127));
        this.traceEntry(fname, `"${filename}" rec=${recordNum} dma=0x${this.dma.toString(16)} data="${dmaPreview}..."`);
        this.log(`Sequential write record ${recordNum} to ${filename}`);
        const bytesWritten = this.fs.write(fd, this.memory, this.dma, RECORD_SIZE, recordNum * RECORD_SIZE);
        if (bytesWritten !== RECORD_SIZE) {
          regs.a = 0x01; // Error
          this.traceResult(fname, 'A=01 (error)');
        } else {
          regs.a = 0x00;
          fcb.currentRecord = recordNum + 1;
          this.traceResult(fname, 'A=00');
        }
        break;
      }

      case 22: { // Make file
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        fcb.clear();
        this.log(`Making ${filename}`);
        const pathname = this.makePathname(fcb);
        if (!pathname) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        const fd = this.fs.open(pathname, 'wx+');
        if (fd >= 0) {
          fcb.fd = fd;
          regs.a = 0x00;
          this.traceResult(fname, `A=00 fd=${fd}`);
        } else {
          fcb.fd = 0;
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (error)');
        }
        break;
      }

      case 23: { // Rename file
        const fcbSrc = new Fcb(this.memory.subarray(regs.de));
        const fcbDst = new Fcb(this.memory.subarray(regs.de + 16));
        const srcName = fcbSrc.getFilename();
        const dstName = fcbDst.getFilename();
        this.traceEntry(fname, `"${srcName}" -> "${dstName}"`);
        this.log(`Renaming ${srcName} to ${dstName}`);
        const pathSrc = this.makePathname(fcbSrc);
        const pathDst = this.makePathname(fcbDst);
        if (!pathSrc || !pathDst) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        regs.a = this.fs.rename(pathSrc, pathDst) ? 0x00 : 0xFF;
        this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        break;
      }

      case 24: { // Return login vector (bitmap of available drives)
        this.traceEntry(fname, '');
        let loginVec = 0;
        for (const drive of this.driveDirMap.keys()) {
          if (drive >= 0 && drive < 16) {
            loginVec |= (1 << drive);
          }
        }
        regs.h = (loginVec >> 8) & 0xFF;
        regs.l = loginVec & 0xFF;
        regs.a = regs.l;
        regs.b = regs.h;
        this.traceResult(fname, `HL=${loginVec.toString(16).toUpperCase().padStart(4, '0')} (drives: ${Array.from(this.driveDirMap.keys()).map(d => String.fromCharCode(65 + d) + ':').join(', ')})`);
        break;
      }

      case 25: { // Return current drive
        this.traceEntry(fname, '');
        regs.a = this.currentDrive;
        this.traceResult(fname, `A=${this.currentDrive} (${String.fromCharCode(65 + this.currentDrive)}:)`);
        break;
      }

      case 26: { // Set DMA address
        this.traceEntry(fname, `DE=${regs.de.toString(16).toUpperCase()}`);
        this.dma = regs.de;
        this.traceResult(fname, 'OK');
        break;
      }

      case 27: { // Get allocation vector address (DRV_ALLOCVEC)
        this.traceEntry(fname, '');
        // Return a dummy address - most programs just check if it's non-zero
        regs.h = 0x00;
        regs.l = 0x00;
        this.traceResult(fname, 'HL=0000 (not supported)');
        break;
      }

      case 29: { // Get read-only vector (DRV_ROVEC)
        this.traceEntry(fname, '');
        // No drives are read-only
        regs.h = 0;
        regs.l = 0;
        this.traceResult(fname, 'HL=0000 (no R/O drives)');
        break;
      }

      case 31: { // Get disk parameter block address (DRV_DPB)
        this.traceEntry(fname, '');
        // Return 0 - we don't have real disk parameter blocks
        regs.h = 0;
        regs.l = 0;
        this.traceResult(fname, 'HL=0000 (not supported)');
        break;
      }

      case 32: { // Get/set user number
        if (regs.e === 0xFF) {
          // Get current user
          this.traceEntry(fname, 'E=FF (get)');
          regs.a = this.currentUser;
          this.traceResult(fname, `A=${this.currentUser}`);
        } else {
          // Set user (0-15)
          this.traceEntry(fname, `E=${regs.e} (set)`);
          this.currentUser = regs.e & 0x0F;
          regs.a = this.currentUser;
          this.traceResult(fname, `user=${this.currentUser}`);
        }
        regs.l = regs.a;
        break;
      }

      case 33: { // Random read
        const fcb = new Fcb(this.memory.subarray(regs.de));
        let fd = fcb.fd;
        if (fd <= 0) {
          // Try to auto-open the file
          const pathname = this.makePathname(fcb);
          if (!pathname) {
            regs.a = 0x09;
            this.traceResult(BDOS_FUNCTION_NAMES[33] ?? 'F_READRAND', 'A=09 (invalid drive)');
            break;
          }
          fd = this.fs.open(pathname, 'r');
          if (fd < 0) {
            regs.a = 0x09; // Invalid FCB
            this.traceResult(BDOS_FUNCTION_NAMES[33] ?? 'F_READRAND', 'A=09 (file not open)');
            break;
          }
          fcb.fd = fd;
        }
        const recordNum = fcb.randomRecord;
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}" rec=${recordNum}`);
        this.log(`Random read record ${recordNum} from ${filename}`);
        const bytesRead = this.fs.read(fd, this.memory, this.dma, RECORD_SIZE, recordNum * RECORD_SIZE);
        if (bytesRead === 0) {
          regs.a = 0x01; // EOF
          this.traceResult(fname, 'A=01 (EOF)');
        } else {
          this.memory.fill(26, this.dma + bytesRead, this.dma + RECORD_SIZE);
          regs.a = 0x00;
          this.traceResult(fname, `A=00 bytes=${bytesRead}`);
        }
        fcb.currentRecord = recordNum;
        break;
      }

      case 34: { // Random write
        const fcb = new Fcb(this.memory.subarray(regs.de));
        let fd = fcb.fd;
        if (fd <= 0) {
          // Try to auto-open the file for writing
          const pathname = this.makePathname(fcb);
          if (!pathname) {
            regs.a = 0x09;
            this.traceResult(BDOS_FUNCTION_NAMES[34] ?? 'F_WRITERAND', 'A=09 (invalid drive)');
            break;
          }
          fd = this.fs.open(pathname, 'r+');
          if (fd < 0) {
            fd = this.fs.open(pathname, 'wx+');
          }
          if (fd < 0) {
            regs.a = 0x09; // Invalid FCB
            this.traceResult(BDOS_FUNCTION_NAMES[34] ?? 'F_WRITERAND', 'A=09 (file not open)');
            break;
          }
          fcb.fd = fd;
        }
        const recordNum = fcb.randomRecord;
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}" rec=${recordNum}`);
        this.log(`Random write record ${recordNum} to ${filename}`);
        const bytesWritten = this.fs.write(fd, this.memory, this.dma, RECORD_SIZE, recordNum * RECORD_SIZE);
        regs.a = bytesWritten === 0 ? 0x05 : 0x00;
        this.traceResult(fname, `A=${regs.a.toString(16).toUpperCase()}`);
        fcb.currentRecord = recordNum;
        break;
      }

      case 35: { // Compute file size
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        this.traceEntry(fname, `"${filename}"`);
        this.log(`Computing size of ${filename}`);
        const pathname = this.makePathname(fcb);
        if (!pathname) {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (invalid drive)');
          break;
        }
        const stat = this.fs.stat(pathname);
        if (stat) {
          const records = Math.ceil(stat.size / RECORD_SIZE);
          fcb.randomRecord = records;
          regs.a = 0x00;
          this.traceResult(fname, `A=00 size=${stat.size} records=${records}`);
        } else {
          regs.a = 0xFF;
          this.traceResult(fname, 'A=FF (not found)');
        }
        break;
      }

      case 36: { // Set random record from sequential position
        const fcb = new Fcb(this.memory.subarray(regs.de));
        const filename = fcb.getFilename();
        const seqRec = fcb.currentRecord;
        fcb.randomRecord = seqRec;
        this.traceEntry(fname, `"${filename}" currentRecord=${seqRec}`);
        this.traceResult(fname, `randomRecord=${seqRec}`);
        break;
      }

      default:
        this.traceEntry(fname, `DE=${regs.de.toString(16).toUpperCase()} E=${regs.e}`);
        this.log(`Unhandled BDOS function: ${f}`);
        this.traceResult(fname, 'UNHANDLED');
        break;
    }
  }

  /** Handle CBIOS call */
  private async handleCbios(): Promise<void> {
    const addr = this.z80.regs.pc - CBIOS_ADDRESS;
    if (addr % 3 !== 0) throw new Error('CBIOS address not multiple of 3');
    const func = addr / 3;
    const fname = CBIOS_ENTRY_POINT_NAMES[func] ?? `CBIOS_${func}`;
    this.log(`CBIOS: ${fname}`);

    switch (func) {
      case CbiosEntryPoint.CONST: {
        const hasKey = this.keyQueue.length > 0 || this.con.hasKey();
        if (!hasKey) {
          // Smart throttling: only delay after many consecutive polls
          this.consecutivePolls++;
          if (this.consecutivePolls > 50) {
            await new Promise(resolve => setTimeout(resolve, 16)); // ~60fps when idle
          }
        } else {
          this.consecutivePolls = 0;
        }
        this.z80.regs.a = hasKey ? 0xFF : 0x00;
        if (this.syscallTrace && hasKey) {
          console.log(`[CBIOS] CONST() => FF (ready)`);
        }
        break;
      }

      case CbiosEntryPoint.CONIN: {
        if (this.syscallTrace) console.log('[CBIOS] CONIN()');
        const ch = await this.readKey();
        this.z80.regs.a = ch;
        if (this.syscallTrace) console.log(`[CBIOS] CONIN => ${this.traceVal(ch, true)}`);
        break;
      }

      case CbiosEntryPoint.CONOUT: {
        const ch = this.z80.regs.c;
        if (this.syscallTrace && ch >= 32 && ch < 127) {
          console.log(`[CBIOS] CONOUT(${this.traceVal(ch, true)})`);
        }
        this.con.write(ch);
        break;
      }

      case CbiosEntryPoint.BOOT:
      case CbiosEntryPoint.WBOOT:
        console.log(`[CPM] ${func === CbiosEntryPoint.BOOT ? 'Cold' : 'Warm'} boot requested`);
        this.warmBoot();
        break;

      default:
        if (this.syscallTrace) console.log(`[CBIOS] ${fname}() UNHANDLED`);
        this.log(`Unhandled CBIOS: ${fname}`);
        break;
    }
  }
}
