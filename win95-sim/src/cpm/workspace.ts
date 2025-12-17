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
import type { DriveFS, LoadedPackage } from './package-loader';
import { CpmEmulator } from './emulator';
import {
  DriveManager,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  loadPackageFromUrl,
  JSZip,
} from './package-loader';

/**
 * Drive type determines how the drive handles reads and writes.
 *
 * - 'ro': Read-only packages, no writes allowed
 * - 'r+': Packages with writable overlay (writes to overlay, reads from overlay then packages)
 * - 'rw': Pure writable filesystem (empty initially)
 */
export type DriveType = 'ro' | 'r+' | 'rw';

/**
 * Configuration for a single drive.
 */
export interface DriveConfig {
  /** Drive letter (A-P) */
  letter: string;
  /** Drive type: 'ro' (read-only), 'r+' (read-only + overlay), 'rw' (writable) */
  type: DriveType;
  /** Package names loaded on this drive (for ro and r+ types) */
  packages: string[];
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
  private handles = new Map<number, { drive: DriveFS; name: string; content: Uint8Array; position: number; mode: string }>();
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
      this.handles.set(handle, { drive, name, content: new Uint8Array(content), position: 0, mode });
      return handle;
    }

    if (mode === 'w' || mode === 'wx+') {
      // wx+ = create exclusive (fail if exists)
      if (mode === 'wx+' && drive.exists(name)) {
        return -1;
      }
      const handle = this.nextHandle++;
      this.handles.set(handle, { drive, name, content: new Uint8Array(0), position: 0, mode });
      return handle;
    }

    return -1;
  }

  close(handle: number): void {
    const h = this.handles.get(handle);
    if (h && (h.mode === 'w' || h.mode === 'wx+' || h.mode === 'r+')) {
      // Write back content on close
      h.drive.writeFile(h.name, h.content);
    }
    this.handles.delete(handle);
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

    let fs: DriveFS;

    switch (config.type) {
      case 'rw': {
        // Pure writable filesystem
        fs = new MemoryDriveFS();
        break;
      }

      case 'ro': {
        // Read-only package filesystem
        const packages: LoadedPackage[] = [];
        for (const pkgName of config.packages) {
          const pkg = await this.loadPackage(pkgName);
          packages.push(pkg);
        }
        fs = new PackageDriveFS(packages);
        break;
      }

      case 'r+': {
        // Package filesystem with writable overlay
        const packages: LoadedPackage[] = [];
        for (const pkgName of config.packages) {
          const pkg = await this.loadPackage(pkgName);
          packages.push(pkg);
        }
        const base = new PackageDriveFS(packages);
        fs = new OverlayDriveFS(base);
        break;
      }

      default:
        throw new Error(`Unknown drive type: ${config.type}`);
    }

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
   * Add a package to an existing r+ drive.
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

    if (config.type !== 'r+') {
      throw new Error(`Cannot add packages to ${config.type} drive. Only r+ drives support package addition.`);
    }

    // Load the package
    const pkg = await this.loadPackage(packageName);

    // Get the overlay filesystem and its base
    const overlayFs = this.drive(upper) as OverlayDriveFS;
    const baseFs = overlayFs.getBase() as PackageDriveFS;

    // Add package to base
    baseFs.addPackage(pkg);

    // Update config
    if (!config.packages.includes(packageName)) {
      config.packages.push(packageName);
    }
  }

  /**
   * Remove a package from an r+ drive.
   *
   * @param letter - Drive letter
   * @param packageName - Package name to remove
   */
  removePackageFromDrive(letter: string, packageName: string): boolean {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);

    if (!config || config.type !== 'r+') {
      return false;
    }

    const overlayFs = this.drive(upper) as OverlayDriveFS;
    const baseFs = overlayFs.getBase() as PackageDriveFS;

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

    if (config.type === 'r+') {
      const overlayFs = driveFs as OverlayDriveFS;
      const baseFs = overlayFs.getBase() as PackageDriveFS;

      // Package layers
      const filesByPkg = baseFs.getFilesByPackage();
      for (const [pkgName, files] of filesByPkg) {
        layers.push({ name: pkgName, files: files.sort(), removable: true });
      }

      // Overlay layer
      const overlayFiles = Array.from(overlayFs.getModifiedFiles().keys()).sort();
      if (overlayFiles.length > 0) {
        layers.push({ name: '[overlay]', files: overlayFiles, removable: false });
      }
    } else if (config.type === 'ro') {
      const pkgFs = driveFs as PackageDriveFS;
      const filesByPkg = pkgFs.getFilesByPackage();
      for (const [pkgName, files] of filesByPkg) {
        layers.push({ name: pkgName, files: files.sort(), removable: false });
      }
    } else {
      // rw drive - just list files as single layer
      const files = driveFs.listFiles().sort();
      if (files.length > 0) {
        layers.push({ name: '[files]', files, removable: false });
      }
    }

    return layers;
  }

  /**
   * Export only the overlay (user-modified files) from an r+ drive.
   */
  async exportOverlay(letter: string): Promise<Blob> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs) {
      throw new Error(`Drive ${upper}: not mounted`);
    }

    let filesToExport: Map<string, Uint8Array>;

    if (config.type === 'r+') {
      filesToExport = (driveFs as OverlayDriveFS).getModifiedFiles();
    } else if (config.type === 'rw') {
      filesToExport = new Map();
      for (const name of driveFs.listFiles()) {
        const content = driveFs.readFile(name);
        if (content) filesToExport.set(name, content);
      }
    } else {
      throw new Error(`Drive ${upper}: is read-only, no overlay to export`);
    }

    if (filesToExport.size === 0) {
      throw new Error(`Drive ${upper}: has no modified files to export`);
    }

    const zip = new JSZip();

    const manifest = {
      name: `${upper}: Overlay Export`,
      version: '1.0',
      description: 'User-modified files only',
      files: Array.from(filesToExport.keys()).map(name => ({ src: name })),
      meta: {
        exportedFrom: upper,
        exportType: 'overlay',
        exportDate: new Date().toISOString(),
        fileCount: filesToExport.size
      }
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    for (const [name, data] of filesToExport) {
      zip.file(name, data);
    }

    return zip.generateAsync({ type: 'blob' });
  }

  /**
   * Export drive contents as a ZIP file.
   *
   * Exports ALL files on the drive (including package files for r+ drives),
   * plus drive configuration metadata.
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

    // Get ALL files on the drive
    const filesToExport = new Map<string, Uint8Array>();
    for (const name of driveFs.listFiles()) {
      const content = driveFs.readFile(name);
      if (content) {
        filesToExport.set(name, content);
      }
    }

    // Create ZIP
    const zip = new JSZip();

    // Add manifest with full drive config
    const manifest = {
      name: `${upper}: Drive Export`,
      version: '1.0',
      description: `Exported from workspace`,
      files: Array.from(filesToExport.keys()).map(name => ({ src: name })),
      meta: {
        exportedFrom: upper,
        driveType: config.type,
        packages: config.packages,
        exportDate: new Date().toISOString(),
        fileCount: filesToExport.size
      }
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

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
   * Get writable files from a drive.
   *
   * @param letter - Drive letter
   * @returns Map of filename to content for writable files
   */
  getWritableFiles(letter: string): Map<string, Uint8Array> {
    const upper = letter.toUpperCase();
    const config = this.driveConfigs.get(upper);
    const driveFs = this.drive(upper);

    if (!config || !driveFs) {
      return new Map();
    }

    if (config.type === 'ro') {
      return new Map();
    }

    if (config.type === 'r+') {
      return (driveFs as OverlayDriveFS).getModifiedFiles();
    }

    // rw drive
    const files = new Map<string, Uint8Array>();
    for (const name of driveFs.listFiles()) {
      const content = driveFs.readFile(name);
      if (content) {
        files.set(name, content);
      }
    }
    return files;
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
   * Check if a drive is writable (r+ or rw type).
   *
   * @param letter - Drive letter
   * @returns true if drive supports writes
   */
  isDriveWritable(letter: string): boolean {
    const config = this.driveConfigs.get(letter.toUpperCase());
    return config?.type === 'r+' || config?.type === 'rw';
  }
}

// Re-export for convenience
export type { DriveFS, LoadedPackage };
export {
  DriveManager,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  loadPackageFromUrl,
};
