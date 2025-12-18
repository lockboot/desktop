/**
 * CP/M Workspace - Unified interface for managing a CP/M environment.
 *
 * A Workspace is an isolated CP/M environment with:
 * - Drive mappings (A-P) backed by DriveFS implementations
 * - Lazy package loading from /cpm/*.zip
 * - VirtualFS interface for emulator compatibility
 *
 * Examples:
 * - Terminal Workspace: Shell + mounted packages + scratch space
 * - IDE Workspace: Editor + live file binding + compiler tools + output
 */

import type { VirtualFS, CpmConsole, CpmOptions, CpmExitInfo } from './types';
import type { DriveFS, LoadedPackage, PackageAction } from './package-loader';
import { CpmEmulator } from './emulator';
import {
  DriveManager,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  loadPackageFromUrl,
  actionMatchesFile,
  JSZip,
} from './package-loader';

/**
 * Configuration for a single drive.
 *
 * Drives can have:
 * - Zero or more package layers (read-only)
 * - An optional writable [files] layer for user files
 */
export interface DriveConfig {
  /** Drive letter (A-P) */
  letter: string;
  /** Package names loaded on this drive */
  packages: string[];
  /** Whether the drive has a writable [files] layer */
  writable: boolean;
}

/**
 * Full workspace configuration.
 */
export interface WorkspaceConfig {
  /** Configured drives */
  drives: DriveConfig[];
}

/**
 * Workspace interface - a self-contained CP/M environment.
 */
export interface Workspace {
  /** Mount a filesystem to a drive letter (A-P) */
  mount(letter: string, fs: DriveFS): void;

  /** Unmount a drive */
  unmount(letter: string): void;

  /** Get a drive's filesystem */
  drive(letter: string): DriveFS | undefined;

  /** Load a package (lazy, cached) */
  loadPackage(name: string): Promise<LoadedPackage>;

  /** Create an emulator bound to this workspace */
  createEmulator(console: CpmConsole, options?: WorkspaceEmulatorOptions): CpmEmulator;

  /** Read a file from a drive */
  readFile(drive: string, name: string): Uint8Array | undefined;

  /** Write a file to a drive */
  writeFile(drive: string, name: string, data: Uint8Array): void;

  /** List files on a drive */
  listFiles(drive: string): string[];

  /** Get the underlying DriveManager */
  getDriveManager(): DriveManager;

  /** Get a VirtualFS view of this workspace (for emulator compatibility) */
  getVirtualFS(): VirtualFS;

  /** Find a shell from mounted packages */
  findShell(): ShellInfo | null;

  /** Get all actions applicable to a file based on its extension */
  getActionsForFile(filename: string): PackageAction[];

  /** Get all actions from all mounted packages */
  getAllActions(): PackageAction[];
}

/**
 * Options for creating an emulator from a workspace.
 */
export interface WorkspaceEmulatorOptions {
  /** Shell binary to load */
  shellBinary?: Uint8Array;
  /** Address to load shell at (default: TPA 0x0100) */
  shellAddress?: number;
  /** Called when program exits */
  onExit?: (info: CpmExitInfo) => void;
  /** Logging function */
  log?: (msg: string) => void;
}

/**
 * Shell info returned by findShell.
 */
export interface ShellInfo {
  /** Shell binary data */
  binary: Uint8Array;
  /** Shell filename (e.g., "XCCP.COM" or "CCP.COM") */
  filename: string;
  /** Drive letter where shell was found */
  drive: string;
  /** Load address (default: 0x100 for TPA, or custom like 0xDC00) */
  loadAddress: number;
  /** Package name that provided the shell */
  packageName: string;
}

/**
 * Package info from the packages index.
 */
export interface PackageInfo {
  /** Package ID (used to load the .zip file) */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
}

/**
 * Fetch available packages from the packages index.
 * @param baseUrl - Base URL for the packages (default: '/cpm')
 * @returns Array of available packages
 */
export async function fetchAvailablePackages(baseUrl = './cpm'): Promise<PackageInfo[]> {
  const url = `${baseUrl}/packages.json`;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(`Failed to fetch packages index: ${response.status}`);
    return [];
  }
  const data = await response.json() as { packages: PackageInfo[] };
  return data.packages || [];
}

/**
 * VirtualFS implementation backed by DriveManager.
 *
 * Routes path-based operations to the appropriate DriveFS.
 * Paths are in the form: /A/FILENAME.EXT or /B/FILENAME.EXT
 */
export class WorkspaceFS implements VirtualFS {
  private driveManager: DriveManager;
  private handles = new Map<number, { drive: DriveFS; name: string; content: Uint8Array; position: number; mode: string; dirty: boolean }>();
  private nextHandle = 1;

  constructor(driveManager: DriveManager) {
    this.driveManager = driveManager;
  }

  /** Parse path to drive letter and filename */
  private parsePath(path: string): { drive: DriveFS; name: string } | null {
    // Paths are /A/FILENAME.EXT or similar
    const match = path.match(/^\/([A-P])\/(.+)$/i);
    if (!match) {
      console.warn(`[WorkspaceFS] Invalid path format: ${path}`);
      return null;
    }
    const driveLetter = match[1].toUpperCase();
    const fileName = match[2].toUpperCase();
    const driveFs = this.driveManager.drive(driveLetter);
    if (!driveFs) {
      console.warn(`[WorkspaceFS] Drive ${driveLetter}: not mounted`);
      console.log(`[WorkspaceFS] Available drives: ${this.driveManager.listDrives().map(d => d.letter).join(', ')}`);
      return null;
    }
    return { drive: driveFs, name: fileName };
  }

  open(path: string, mode: 'r' | 'r+' | 'w' | 'wx+'): number {
    const parsed = this.parsePath(path);
    if (!parsed) return -1;

    const { drive, name } = parsed;

    if (mode === 'r' || mode === 'r+') {
      const content = drive.readFile(name);
      if (!content) return -1;
      const handle = this.nextHandle++;
      // dirty=false for read modes - only set dirty when actually written
      this.handles.set(handle, { drive, name, content: new Uint8Array(content), position: 0, mode, dirty: false });
      return handle;
    }

    if (mode === 'w' || mode === 'wx+') {
      // wx+ = create exclusive (fail if exists)
      if (mode === 'wx+' && drive.exists(name)) {
        console.log(`[WorkspaceFS] open ${path} wx+ failed: file exists`);
        return -1;
      }
      // Write empty file to drive immediately so it's visible to other operations
      // This matches CP/M semantics where MAKE creates the directory entry
      drive.writeFile(name, new Uint8Array(0));
      const handle = this.nextHandle++;
      // dirty=true for write modes - these files need to be saved
      this.handles.set(handle, { drive, name, content: new Uint8Array(0), position: 0, mode, dirty: true });
      console.log(`[WorkspaceFS] open ${path} wx+ success: handle=${handle}`);
      return handle;
    }

    return -1;
  }

  close(handle: number): void {
    const h = this.handles.get(handle);
    if (h && h.dirty) {
      // Only write back if actually modified
      console.log(`[WorkspaceFS] close: Writing ${h.content.length} bytes to ${h.name}`);
      h.drive.writeFile(h.name, h.content);
    }
    this.handles.delete(handle);
  }

  closeAll(): void {
    for (const [handle, h] of this.handles) {
      if (h.dirty) {
        // Only write back if actually modified
        console.log(`[WorkspaceFS] closeAll: Writing ${h.content.length} bytes to ${h.name} (handle ${handle})`);
        h.drive.writeFile(h.name, h.content);
      }
    }
    this.handles.clear();
  }

  read(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const h = this.handles.get(handle);
    if (!h) return 0;

    const available = h.content.length - position;
    if (available <= 0) return 0;

    const toRead = Math.min(length, available);
    buffer.set(h.content.subarray(position, position + toRead), offset);
    return toRead;
  }

  write(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const h = this.handles.get(handle);
    if (!h) return 0;

    // Mark as dirty since we're modifying the file
    h.dirty = true;

    // Expand content if needed
    const endPosition = position + length;
    if (endPosition > h.content.length) {
      const newContent = new Uint8Array(endPosition);
      newContent.set(h.content);
      h.content = newContent;
    }

    // Write data
    h.content.set(buffer.subarray(offset, offset + length), position);
    return length;
  }

  stat(path: string): { size: number } | null {
    const parsed = this.parsePath(path);
    if (!parsed) return null;

    const content = parsed.drive.readFile(parsed.name);
    if (!content) return null;
    return { size: content.length };
  }

  unlink(path: string): boolean {
    const parsed = this.parsePath(path);
    if (!parsed) return false;
    return parsed.drive.deleteFile(parsed.name);
  }

  rename(oldPath: string, newPath: string): boolean {
    const parsedOld = this.parsePath(oldPath);
    const parsedNew = this.parsePath(newPath);
    if (!parsedOld || !parsedNew) return false;

    // Simple rename only works within same drive
    if (parsedOld.drive !== parsedNew.drive) {
      console.warn('[WorkspaceFS] Cross-drive rename not supported');
      return false;
    }

    const content = parsedOld.drive.readFile(parsedOld.name);
    if (!content) return false;

    parsedOld.drive.deleteFile(parsedOld.name);
    parsedNew.drive.writeFile(parsedNew.name, content);
    return true;
  }

  readdir(path: string): string[] {
    // Path should be /A or /A/
    const match = path.match(/^\/([A-P])\/?$/i);
    if (!match) {
      console.warn(`[WorkspaceFS] Invalid directory path: ${path}`);
      return [];
    }
    const driveLetter = match[1].toUpperCase();
    const driveFs = this.driveManager.drive(driveLetter);
    if (!driveFs) return [];
    return driveFs.listFiles();
  }

  exists(path: string): boolean {
    const parsed = this.parsePath(path);
    if (!parsed) return false;
    return parsed.drive.exists(parsed.name);
  }

  addFile(path: string, content: Uint8Array | string): void {
    const parsed = this.parsePath(path);
    if (!parsed) {
      console.warn(`[WorkspaceFS] Cannot add file, invalid path: ${path}`);
      return;
    }
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    parsed.drive.writeFile(parsed.name, data);
  }

  getFile(path: string): Uint8Array | undefined {
    const parsed = this.parsePath(path);
    if (!parsed) return undefined;
    return parsed.drive.readFile(parsed.name);
  }

  listAll(): string[] {
    const files: string[] = [];
    for (const { drive, letter } of this.driveManager.listDrives()) {
      const driveFs = this.driveManager.getDrive(drive);
      if (driveFs) {
        for (const name of driveFs.listFiles()) {
          files.push(`/${letter}/${name}`);
        }
      }
    }
    return files;
  }
}

/**
 * VirtualFS wrapper that adds extra drives on top of a base VirtualFS.
 * Used for temporary tool drives in terminal sessions.
 */
export class MergedWorkspaceFS implements VirtualFS {
  private base: VirtualFS;
  private extraDrives = new Map<string, DriveFS>();
  private handles = new Map<number, { drive: DriveFS; name: string; content: Uint8Array; position: number; mode: string; dirty: boolean }>();
  private nextHandle = 1;

  constructor(base: VirtualFS) {
    this.base = base;
  }

  /** Add an extra drive (only visible to this merged FS) */
  addDrive(letter: string, fs: DriveFS): void {
    this.extraDrives.set(letter.toUpperCase(), fs);
  }

  /** Get extra drive letters */
  getExtraDrives(): string[] {
    return Array.from(this.extraDrives.keys());
  }

  /** Parse path - check extra drives first, then delegate to base */
  private parseExtraPath(path: string): { drive: DriveFS; name: string; letter: string } | null {
    const match = path.match(/^\/([A-P])\/(.+)$/i);
    if (!match) return null;
    const letter = match[1].toUpperCase();
    const name = match[2].toUpperCase();
    const extraDrive = this.extraDrives.get(letter);
    if (extraDrive) {
      return { drive: extraDrive, name, letter };
    }
    return null;
  }

  open(path: string, mode: 'r' | 'r+' | 'w' | 'wx+'): number {
    const extra = this.parseExtraPath(path);
    if (extra) {
      const { drive, name } = extra;
      if (mode === 'r' || mode === 'r+') {
        const content = drive.readFile(name);
        if (!content) return -1;
        const handle = this.nextHandle++;
        // dirty=false for read modes - only set dirty when actually written
        this.handles.set(handle, { drive, name, content: new Uint8Array(content), position: 0, mode, dirty: false });
        return handle;
      }
      if (mode === 'w' || mode === 'wx+') {
        if (mode === 'wx+' && drive.exists(name)) {
          console.log(`[MergedFS] open ${path} wx+ failed: file exists on extra drive`);
          return -1;
        }
        // Write empty file to drive immediately so it's visible to other operations
        drive.writeFile(name, new Uint8Array(0));
        const handle = this.nextHandle++;
        // dirty=true for write modes - these files need to be saved
        this.handles.set(handle, { drive, name, content: new Uint8Array(0), position: 0, mode, dirty: true });
        console.log(`[MergedFS] open ${path} wx+ success on extra drive: handle=${handle}`);
        return handle;
      }
      return -1;
    }
    console.log(`[MergedFS] open ${path} mode=${mode} -> delegating to base`);
    return this.base.open(path, mode);
  }

  close(handle: number): void {
    const h = this.handles.get(handle);
    if (h) {
      if (h.dirty) {
        // Only write back if actually modified
        h.drive.writeFile(h.name, h.content);
      }
      this.handles.delete(handle);
      return;
    }
    this.base.close(handle);
  }

  closeAll(): void {
    // Close our extra handles
    for (const [, h] of this.handles) {
      if (h.dirty) {
        // Only write back if actually modified
        h.drive.writeFile(h.name, h.content);
      }
    }
    this.handles.clear();
    // Delegate to base
    this.base.closeAll();
  }

  read(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const h = this.handles.get(handle);
    if (h) {
      const available = h.content.length - position;
      if (available <= 0) return 0;
      const toRead = Math.min(length, available);
      buffer.set(h.content.subarray(position, position + toRead), offset);
      return toRead;
    }
    return this.base.read(handle, buffer, offset, length, position);
  }

  write(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const h = this.handles.get(handle);
    if (h) {
      // Mark as dirty since we're modifying the file
      h.dirty = true;

      const endPosition = position + length;
      if (endPosition > h.content.length) {
        const newContent = new Uint8Array(endPosition);
        newContent.set(h.content);
        h.content = newContent;
      }
      h.content.set(buffer.subarray(offset, offset + length), position);
      return length;
    }
    return this.base.write(handle, buffer, offset, length, position);
  }

  stat(path: string): { size: number } | null {
    const extra = this.parseExtraPath(path);
    if (extra) {
      const content = extra.drive.readFile(extra.name);
      if (!content) return null;
      return { size: content.length };
    }
    return this.base.stat(path);
  }

  unlink(path: string): boolean {
    const extra = this.parseExtraPath(path);
    if (extra) {
      return extra.drive.deleteFile(extra.name);
    }
    return this.base.unlink(path);
  }

  rename(oldPath: string, newPath: string): boolean {
    const extraOld = this.parseExtraPath(oldPath);
    const extraNew = this.parseExtraPath(newPath);
    // If both are extra drives on same drive, handle it
    if (extraOld && extraNew && extraOld.letter === extraNew.letter) {
      const content = extraOld.drive.readFile(extraOld.name);
      if (!content) return false;
      extraOld.drive.deleteFile(extraOld.name);
      extraNew.drive.writeFile(extraNew.name, content);
      return true;
    }
    // Otherwise delegate to base (won't handle cross-extra-drive renames)
    return this.base.rename(oldPath, newPath);
  }

  readdir(path: string): string[] {
    const match = path.match(/^\/([A-P])\/?$/i);
    if (match) {
      const letter = match[1].toUpperCase();
      const extraDrive = this.extraDrives.get(letter);
      if (extraDrive) {
        return extraDrive.listFiles();
      }
    }
    return this.base.readdir(path);
  }

  exists(path: string): boolean {
    const extra = this.parseExtraPath(path);
    if (extra) {
      return extra.drive.exists(extra.name);
    }
    return this.base.exists(path);
  }

  addFile(path: string, content: Uint8Array | string): void {
    const extra = this.parseExtraPath(path);
    if (extra) {
      const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      extra.drive.writeFile(extra.name, data);
      return;
    }
    this.base.addFile(path, content);
  }

  getFile(path: string): Uint8Array | undefined {
    const extra = this.parseExtraPath(path);
    if (extra) {
      return extra.drive.readFile(extra.name);
    }
    return this.base.getFile(path);
  }

  listAll(): string[] {
    const files = this.base.listAll();
    // Add files from extra drives
    for (const [letter, drive] of this.extraDrives) {
      for (const name of drive.listFiles()) {
        files.push(`/${letter}/${name}`);
      }
    }
    return files;
  }
}

/**
 * CP/M Workspace implementation.
 */
export class CpmWorkspace implements Workspace {
  private driveManager = new DriveManager();
  private packageCache = new Map<string, LoadedPackage>();
  private driveConfigs = new Map<string, DriveConfig>();
  private packageBaseUrl: string;
  private virtualFS: WorkspaceFS;

  /**
   * Create a new workspace.
   *
   * @param packageBaseUrl - Base URL for loading packages (default: '/cpm')
   */
  constructor(packageBaseUrl = './cpm') {
    this.packageBaseUrl = packageBaseUrl;
    this.virtualFS = new WorkspaceFS(this.driveManager);
  }

  mount(letter: string, fs: DriveFS): void {
    this.driveManager.mount(letter, fs);
  }

  unmount(letter: string): void {
    const upper = letter.toUpperCase();
    this.driveManager.unmount(upper);
    this.driveConfigs.delete(upper);
  }

  drive(letter: string): DriveFS | undefined {
    return this.driveManager.drive(letter);
  }

  async loadPackage(name: string): Promise<LoadedPackage> {
    const cacheKey = name.toLowerCase();
    const cached = this.packageCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = `${this.packageBaseUrl}/${name}.zip`;
    console.log(`[Workspace] Loading package: ${url}`);
    const pkg = await loadPackageFromUrl(url);
    this.packageCache.set(cacheKey, pkg);
    this.driveManager.cachePackage(name, pkg);
    return pkg;
  }

  createEmulator(console: CpmConsole, options?: WorkspaceEmulatorOptions): CpmEmulator {
    // Build drives map from DriveManager for emulator compatibility
    // The emulator expects drives map to be drive number -> directory path
    // We use /A, /B, etc. as paths which WorkspaceFS will route to DriveFS
    const drives = new Map<number, string>();
    for (const { drive, letter } of this.driveManager.listDrives()) {
      drives.set(drive, `/${letter}`);
    }

    const emulatorOptions: CpmOptions = {
      fs: this.virtualFS,
      console,
      drives,
      onExit: options?.onExit,
      log: options?.log,
      shellAddress: options?.shellAddress,
    };

    const emu = new CpmEmulator(emulatorOptions);
    if (options?.shellBinary) {
      emu.load(options.shellBinary);
    }
    return emu;
  }

  readFile(driveLetter: string, name: string): Uint8Array | undefined {
    const driveFs = this.drive(driveLetter);
    if (!driveFs) return undefined;
    return driveFs.readFile(name);
  }

  writeFile(driveLetter: string, name: string, data: Uint8Array): void {
    const driveFs = this.drive(driveLetter);
    if (!driveFs) {
      console.warn(`[Workspace] Cannot write to unmounted drive ${driveLetter}:`);
      return;
    }
    driveFs.writeFile(name, data);
  }

  listFiles(driveLetter: string): string[] {
    const driveFs = this.drive(driveLetter);
    if (!driveFs) return [];
    return driveFs.listFiles();
  }

  getDriveManager(): DriveManager {
    return this.driveManager;
  }

  getVirtualFS(): VirtualFS {
    return this.virtualFS;
  }

  /**
   * Find a shell from mounted packages.
   * Scans all drives for packages with shell metadata and returns the first one found.
   *
   * Shell metadata in manifest.mf can be:
   * - meta.shell: "FILENAME.COM" (shell filename)
   * - meta.type: "shell" (marks package as containing a shell)
   * - File entry with type: "shell" and optional loadAddress
   */
  findShell(): ShellInfo | null {
    const TPA_ADDRESS = 0x100;

    // Iterate through all configured drives
    for (const config of this.listDriveConfigs()) {
      const driveFs = this.drive(config.letter);
      if (!driveFs) continue;

      // Get packages from the drive (works for PackageDriveFS and OverlayDriveFS)
      let packages: LoadedPackage[] = [];
      if (driveFs instanceof PackageDriveFS) {
        packages = driveFs.getPackages();
      } else if (driveFs instanceof OverlayDriveFS) {
        const base = driveFs.getBase();
        if (base instanceof PackageDriveFS) {
          packages = base.getPackages();
        }
      }

      // Check each package for shell info
      for (const pkg of packages) {
        const meta = pkg.manifest.meta;

        let shellFilename: string | undefined;
        let loadAddress = TPA_ADDRESS;

        // Method 1: meta.shell specifies the shell filename directly
        if (meta?.shell && typeof meta.shell === 'string') {
          shellFilename = meta.shell.toUpperCase();
        }

        // Method 2: Scan file entries for type: "shell"
        // This works regardless of package-level meta.type
        if (!shellFilename && pkg.manifest.files) {
          for (const fileEntry of pkg.manifest.files) {
            const fileMeta = fileEntry as { type?: string; loadAddress?: string | number; src: string };
            if (fileMeta.type === 'shell') {
              shellFilename = fileEntry.src.toUpperCase();
              // Check for loadAddress on file entry
              if (fileMeta.loadAddress) {
                const addr = fileMeta.loadAddress;
                loadAddress = typeof addr === 'string' ? parseInt(addr, 16) : addr;
              }
              break;
            }
          }
        }

        // Method 3: meta.type === 'shell' marks entire package as shell
        // Find first .COM file as the shell
        if (!shellFilename && meta?.type === 'shell' && pkg.manifest.files) {
          for (const fileEntry of pkg.manifest.files) {
            const src = fileEntry.src.toUpperCase();
            if (src.endsWith('.COM')) {
              shellFilename = src;
              const fileMeta = fileEntry as { type?: string; loadAddress?: string | number; src: string };
              if (fileMeta.loadAddress) {
                const addr = fileMeta.loadAddress;
                loadAddress = typeof addr === 'string' ? parseInt(addr, 16) : addr;
              }
              break;
            }
          }
        }

        // If we found a shell filename, try to load it
        if (shellFilename) {
          const binary = pkg.files.get(shellFilename);
          if (binary) {
            console.log(`[Workspace] Found shell: ${shellFilename} from ${pkg.manifest.name} on ${config.letter}: (load at 0x${loadAddress.toString(16)})`);
            return {
              binary,
              filename: shellFilename,
              drive: config.letter,
              loadAddress,
              packageName: pkg.manifest.name
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Get all actions applicable to a file based on its extension.
   * Matches against patterns from all mounted packages.
   *
   * @param filename - Filename to match (e.g., "TEST.ASM")
   * @returns Array of matching actions
   */
  getActionsForFile(filename: string): PackageAction[] {
    const allActions = this.getAllActions();
    return allActions.filter(action => actionMatchesFile(action, filename));
  }

  /**
   * Get all actions from all mounted packages.
   *
   * @returns Array of all actions
   */
  getAllActions(): PackageAction[] {
    const actions: PackageAction[] = [];

    // Iterate through all configured drives
    for (const config of this.listDriveConfigs()) {
      const driveFs = this.drive(config.letter);
      if (!driveFs) continue;

      // Get PackageDriveFS (either directly or through overlay)
      let packageFs: PackageDriveFS | null = null;
      if (driveFs instanceof PackageDriveFS) {
        packageFs = driveFs;
      } else if (driveFs instanceof OverlayDriveFS) {
        const base = driveFs.getBase();
        if (base instanceof PackageDriveFS) {
          packageFs = base;
        }
      }

      if (packageFs) {
        // Get actions from the PackageDriveFS
        for (const action of packageFs.getActions()) {
          // Avoid duplicates (same action from same package)
          const existing = actions.find(a => a.id === action.id && a.package === action.package);
          if (!existing) {
            actions.push(action);
          }
        }
      }
    }

    return actions;
  }

  /** Create a writable drive from packages */
  createPackageDrive(packages: LoadedPackage[], writable = true): DriveFS {
    return this.driveManager.createPackageDrive(packages, writable);
  }

  /** Create an empty writable drive */
  createMemoryDrive(): MemoryDriveFS {
    return this.driveManager.createMemoryDrive();
  }

  // =====================================================================
  // Drive Configuration API
  // =====================================================================

  /**
   * Configure a drive based on a DriveConfig.
   * This will load any required packages and mount the appropriate filesystem.
   *
   * @param config - Drive configuration
   */
  async configureDrive(config: DriveConfig): Promise<void> {
    const letter = config.letter.toUpperCase();

    // Validate drive letter
    if (letter.length !== 1 || letter < 'A' || letter > 'P') {
      throw new Error(`Invalid drive letter: ${config.letter}`);
    }

    // Unmount existing drive if present
    if (this.drive(letter)) {
      this.unmount(letter);
    }

    // Load packages
    const packages: LoadedPackage[] = [];
    for (const pkgName of config.packages) {
      const pkg = await this.loadPackage(pkgName);
      packages.push(pkg);
    }

    // Create filesystem: PackageDriveFS base with optional OverlayDriveFS
    const base = new PackageDriveFS(packages);
    const fs: DriveFS = config.writable ? new OverlayDriveFS(base) : base;

    // Store config and mount
    this.driveConfigs.set(letter, { ...config, letter });
    this.mount(letter, fs);
  }

  /**
   * Get the configuration for a drive.
   *
   * @param letter - Drive letter (A-P)
   * @returns Drive configuration or undefined if not configured
   */
  getDriveConfig(letter: string): DriveConfig | undefined {
    return this.driveConfigs.get(letter.toUpperCase());
  }

  /**
   * List all configured drives.
   *
   * @returns Array of drive configurations
   */
  listDriveConfigs(): DriveConfig[] {
    return Array.from(this.driveConfigs.values()).sort((a, b) =>
      a.letter.localeCompare(b.letter)
    );
  }

  /**
   * Add a package to an existing drive.
   * The package files will be added to the base PackageDriveFS.
   *
   * @param letter - Drive letter
   * @param packageName - Package name to add
   */
  async addPackageToDrive(letter: string, packageName: string): Promise<void> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);

    if (!config) {
      throw new Error(`Drive ${upper}: not configured`);
    }

    // Load the package
    const pkg = await this.loadPackage(packageName);

    // Get the base PackageDriveFS
    const driveFs = this.drive(upper);
    let baseFs: PackageDriveFS;

    if (config.writable) {
      baseFs = (driveFs as OverlayDriveFS).getBase() as PackageDriveFS;
    } else {
      baseFs = driveFs as PackageDriveFS;
    }

    // Add package to base
    baseFs.addPackage(pkg);

    // Update config
    if (!config.packages.includes(packageName)) {
      config.packages.push(packageName);
    }
  }

  /**
   * Remove a package from a drive.
   *
   * @param letter - Drive letter
   * @param packageName - Package name to remove
   */
  removePackageFromDrive(letter: string, packageName: string): boolean {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);

    if (!config) {
      return false;
    }

    // Get the base PackageDriveFS
    const driveFs = this.drive(upper);
    let baseFs: PackageDriveFS;

    if (config.writable) {
      baseFs = (driveFs as OverlayDriveFS).getBase() as PackageDriveFS;
    } else {
      baseFs = driveFs as PackageDriveFS;
    }

    if (baseFs.removePackage(packageName)) {
      const idx = config.packages.indexOf(packageName);
      if (idx !== -1) {
        config.packages.splice(idx, 1);
      }
      return true;
    }
    return false;
  }

  /**
   * Layer info for display in file tree.
   */
  getDriveLayers(letter: string): { name: string; files: string[]; removable: boolean }[] {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs) return [];

    const layers: { name: string; files: string[]; removable: boolean }[] = [];

    // Get base PackageDriveFS
    let baseFs: PackageDriveFS | null = null;
    if (driveFs instanceof PackageDriveFS) {
      baseFs = driveFs;
    } else if (driveFs instanceof OverlayDriveFS) {
      const base = driveFs.getBase();
      if (base instanceof PackageDriveFS) {
        baseFs = base;
      }
    }

    // Add virtual MANIFEST.MF at drive level if packages exist
    if (baseFs && baseFs.getPackages().length > 0) {
      layers.push({ name: '[manifest]', files: ['MANIFEST.MF'], removable: false });
    }

    // Package layers (removable)
    if (baseFs) {
      const filesByPkg = baseFs.getFilesByPackage();
      for (const [pkgName, files] of filesByPkg) {
        layers.push({ name: pkgName, files: files.sort(), removable: true });
      }
    }

    // [files] layer for writable drives
    if (config.writable) {
      const overlayFs = driveFs as OverlayDriveFS;
      const overlayFiles = Array.from(overlayFs.getModifiedFiles().keys()).sort();
      if (overlayFiles.length > 0) {
        layers.push({ name: '[files]', files: overlayFiles, removable: false });
      }
    }

    return layers;
  }

  /**
   * Export only the user files from a writable drive.
   */
  async exportOverlay(letter: string): Promise<Blob> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs) {
      throw new Error(`Drive ${upper}: not mounted`);
    }

    if (!config.writable) {
      throw new Error(`Drive ${upper}: is read-only, no files to export`);
    }

    const filesToExport = (driveFs as OverlayDriveFS).getModifiedFiles();

    if (filesToExport.size === 0) {
      throw new Error(`Drive ${upper}: has no user files to export`);
    }

    const zip = new JSZip();

    const manifest = {
      name: `${upper}: Files Export`,
      version: '1.0',
      description: 'User files only',
      files: Array.from(filesToExport.keys()).map(name => ({ src: name })),
      meta: {
        exportedFrom: upper,
        exportType: 'files',
        exportDate: new Date().toISOString(),
        fileCount: filesToExport.size
      }
    };
    zip.file('manifest.mf', JSON.stringify(manifest, null, 2));

    for (const [name, data] of filesToExport) {
      zip.file(name, data);
    }

    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * Export drive contents as a ZIP file.
   *
   * Exports ALL files on the drive (including package files),
   * plus the original package manifests (as array if multiple).
   *
   * @param letter - Drive letter
   * @returns ZIP file as Blob
   */
  async exportDrive(letter: string): Promise<Blob> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs) {
      throw new Error(`Drive ${upper}: not mounted`);
    }

    // Get ALL files on the drive (excluding virtual MANIFEST.MF)
    const filesToExport = new Map<string, Uint8Array>();
    for (const name of driveFs.listFiles()) {
      if (name === 'MANIFEST.MF') continue; // Skip virtual manifest
      const content = driveFs.readFile(name);
      if (content) {
        filesToExport.set(name, content);
      }
    }

    // Create ZIP
    const zip = new JSZip();

    // Get original package manifests
    let baseFs: PackageDriveFS | null = null;
    if (driveFs instanceof PackageDriveFS) {
      baseFs = driveFs;
    } else if (driveFs instanceof OverlayDriveFS) {
      const base = driveFs.getBase();
      if (base instanceof PackageDriveFS) {
        baseFs = base;
      }
    }

    // Build manifest - preserve original package manifests
    let manifestContent: string;
    if (baseFs && baseFs.getPackages().length > 0) {
      const manifests = baseFs.getPackages().map(p => p.manifest);
      // Single package: export as object, multiple: export as array
      manifestContent = manifests.length === 1
        ? JSON.stringify(manifests[0], null, 2)
        : JSON.stringify(manifests, null, 2);
    } else {
      // No packages - create a basic manifest for the files
      const manifest = {
        name: `${upper}: Export`,
        version: '1.0',
        files: Array.from(filesToExport.keys()).map(name => ({ src: name })),
        meta: {
          exportedFrom: upper,
          exportDate: new Date().toISOString()
        }
      };
      manifestContent = JSON.stringify(manifest, null, 2);
    }
    zip.file('manifest.mf', manifestContent);

    // Add files
    for (const [name, data] of filesToExport) {
      zip.file(name, data);
    }

    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * @deprecated Use exportDrive instead
   */
  async exportDriveOverlay(letter: string): Promise<Blob> {
    return this.exportDrive(letter);
  }

  /**
   * Get writable files from a drive (user files in the [files] layer).
   *
   * @param letter - Drive letter
   * @returns Map of filename to content for writable files
   */
  getWritableFiles(letter: string): Map<string, Uint8Array> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs || !config.writable) {
      return new Map();
    }

    return (driveFs as OverlayDriveFS).getModifiedFiles();
  }

  /**
   * Check if a drive has writable content (modified files or user files).
   *
   * @param letter - Drive letter
   * @returns true if drive has exportable content
   */
  hasWritableContent(letter: string): boolean {
    return this.getWritableFiles(letter).size > 0;
  }

  /**
   * Check if a drive is writable (has a [files] layer).
   *
   * @param letter - Drive letter
   * @returns true if drive supports writes
   */
  isDriveWritable(letter: string): boolean {
    const config = this.driveConfigs.get(letter.toUpperCase());
    return config?.writable ?? false;
  }

  /**
   * Enable the writable [files] layer on a drive.
   * Remounts the drive with an OverlayDriveFS wrapper.
   *
   * @param letter - Drive letter
   */
  async enableWritableLayer(letter: string): Promise<void> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);

    if (!config) {
      throw new Error(`Drive ${upper}: not configured`);
    }

    if (config.writable) {
      return; // Already writable
    }

    // Remount with writable layer
    config.writable = true;
    await this.configureDrive(config);
  }
}

// Re-export for convenience
export type { DriveFS, LoadedPackage, PackageAction };
export {
  DriveManager,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  loadPackageFromUrl,
  actionMatchesFile,
};
