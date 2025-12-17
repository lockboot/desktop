/**
 * CP/M Package Loader
 *
 * Loads package zip files and provides drive mounting capabilities.
 * Packages can be combined onto drives (A: = [assemblers, core, zork])
 * or drives can use raw MemoryFS for scratch space.
 */

import JSZip from 'jszip';

/** Package manifest schema */
export interface PackageManifest {
  name: string;
  version?: string;
  description?: string;
  outputDir?: string;
  files: { src: string; dst?: string; required?: boolean }[];
  meta?: Record<string, any>;
}

/** Loaded package with files */
export interface LoadedPackage {
  manifest: PackageManifest;
  files: Map<string, Uint8Array>;
}

/** Virtual filesystem interface for drive backing */
export interface DriveFS {
  readFile(name: string): Uint8Array | undefined;
  writeFile(name: string, data: Uint8Array): void;
  deleteFile(name: string): boolean;
  listFiles(): string[];
  exists(name: string): boolean;
}

/**
 * Load a package from zip data.
 * Extracts all files and parses the manifest if present.
 */
export async function loadPackage(zipData: Uint8Array | ArrayBuffer): Promise<LoadedPackage> {
  const zip = await JSZip.loadAsync(zipData);
  const files = new Map<string, Uint8Array>();
  let manifest: PackageManifest | null = null;

  // Extract all files
  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const content = await zipEntry.async('uint8array');
    const upperName = filename.toUpperCase();

    if (upperName === 'MANIFEST.JSON') {
      try {
        const text = new TextDecoder().decode(content);
        manifest = JSON.parse(text);
      } catch (e) {
        console.warn('Failed to parse manifest.json:', e);
      }
    } else {
      // Store with uppercase filename (CP/M convention)
      files.set(upperName, content);
    }
  }

  // Create default manifest if none found
  if (!manifest) {
    manifest = {
      name: 'Unknown Package',
      files: Array.from(files.keys()).map(name => ({ src: name }))
    };
  }

  return { manifest, files };
}

/**
 * Load a package from a URL (fetch + load).
 */
export async function loadPackageFromUrl(url: string): Promise<LoadedPackage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch package: ${response.status} ${response.statusText}`);
  }
  const data = await response.arrayBuffer();
  return loadPackage(data);
}

/**
 * Simple in-memory filesystem for a drive.
 */
export class MemoryDriveFS implements DriveFS {
  private files = new Map<string, Uint8Array>();

  readFile(name: string): Uint8Array | undefined {
    return this.files.get(name.toUpperCase());
  }

  writeFile(name: string, data: Uint8Array): void {
    this.files.set(name.toUpperCase(), data);
  }

  deleteFile(name: string): boolean {
    return this.files.delete(name.toUpperCase());
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  exists(name: string): boolean {
    return this.files.has(name.toUpperCase());
  }
}

/**
 * Read-only filesystem backed by loaded packages.
 * Multiple packages are merged (later packages override earlier ones).
 */
export class PackageDriveFS implements DriveFS {
  private files = new Map<string, Uint8Array>();
  private fileOrigins = new Map<string, string>(); // filename -> package name
  private packages: LoadedPackage[] = [];

  constructor(packages: LoadedPackage[] = []) {
    for (const pkg of packages) {
      this.addPackage(pkg);
    }
  }

  /** Add a package (files are merged, later overrides earlier) */
  addPackage(pkg: LoadedPackage): void {
    this.packages.push(pkg);
    const pkgName = pkg.manifest.name;
    for (const [name, data] of pkg.files) {
      const upper = name.toUpperCase();
      this.files.set(upper, data);
      this.fileOrigins.set(upper, pkgName);
    }
  }

  /** Remove a package by name */
  removePackage(name: string): boolean {
    const idx = this.packages.findIndex(p => p.manifest.name === name);
    if (idx === -1) return false;

    this.packages.splice(idx, 1);

    // Rebuild files and origins from remaining packages
    this.files.clear();
    this.fileOrigins.clear();
    for (const pkg of this.packages) {
      const pkgName = pkg.manifest.name;
      for (const [fname, data] of pkg.files) {
        const upper = fname.toUpperCase();
        this.files.set(upper, data);
        this.fileOrigins.set(upper, pkgName);
      }
    }
    return true;
  }

  /** Get all loaded packages */
  getPackages(): LoadedPackage[] {
    return [...this.packages];
  }

  /** Get which package a file came from */
  getFileOrigin(name: string): string | undefined {
    return this.fileOrigins.get(name.toUpperCase());
  }

  /** Get files grouped by package */
  getFilesByPackage(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const pkg of this.packages) {
      const pkgName = pkg.manifest.name;
      const files: string[] = [];
      for (const fname of pkg.files.keys()) {
        files.push(fname.toUpperCase());
      }
      result.set(pkgName, files);
    }
    return result;
  }

  readFile(name: string): Uint8Array | undefined {
    return this.files.get(name.toUpperCase());
  }

  writeFile(name: string, _data: Uint8Array): void {
    // Package drives are read-only by default
    console.warn(`PackageDriveFS is read-only, ignoring write to ${name}`);
  }

  deleteFile(name: string): boolean {
    console.warn(`PackageDriveFS is read-only, ignoring delete of ${name}`);
    return false;
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  exists(name: string): boolean {
    return this.files.has(name.toUpperCase());
  }
}

/**
 * Writable overlay on top of package files.
 * Reads come from overlay first, then packages.
 * Writes go to overlay only.
 */
export class OverlayDriveFS implements DriveFS {
  private overlay = new Map<string, Uint8Array>();
  private deleted = new Set<string>();
  private base: DriveFS;

  constructor(base: DriveFS) {
    this.base = base;
  }

  /** Get the underlying base filesystem */
  getBase(): DriveFS {
    return this.base;
  }

  readFile(name: string): Uint8Array | undefined {
    const upper = name.toUpperCase();
    if (this.deleted.has(upper)) return undefined;
    return this.overlay.get(upper) ?? this.base.readFile(upper);
  }

  writeFile(name: string, data: Uint8Array): void {
    const upper = name.toUpperCase();
    this.overlay.set(upper, data);
    this.deleted.delete(upper);
  }

  deleteFile(name: string): boolean {
    const upper = name.toUpperCase();
    const existed = this.exists(upper);
    this.overlay.delete(upper);
    this.deleted.add(upper);
    return existed;
  }

  listFiles(): string[] {
    const files = new Set(this.base.listFiles());
    for (const name of this.overlay.keys()) {
      files.add(name);
    }
    for (const name of this.deleted) {
      files.delete(name);
    }
    return Array.from(files);
  }

  exists(name: string): boolean {
    const upper = name.toUpperCase();
    if (this.deleted.has(upper)) return false;
    return this.overlay.has(upper) || this.base.exists(upper);
  }

  /** Get files that have been modified/added */
  getModifiedFiles(): Map<string, Uint8Array> {
    return new Map(this.overlay);
  }

  /** Get list of deleted files */
  getDeletedFiles(): string[] {
    return Array.from(this.deleted);
  }
}

/**
 * Drive manager for CP/M emulator.
 * Maps drive letters (A-P) to filesystem implementations.
 */
export class DriveManager {
  private drives = new Map<number, DriveFS>();
  private packageCache = new Map<string, LoadedPackage>();

  /** Get drive by letter (A=0, B=1, etc.) */
  getDrive(drive: number): DriveFS | undefined {
    return this.drives.get(drive);
  }

  /** Get drive by letter string */
  drive(letter: string): DriveFS | undefined {
    const driveNum = letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    return this.getDrive(driveNum);
  }

  /** Set a drive to a filesystem */
  setDrive(drive: number, fs: DriveFS): void {
    this.drives.set(drive, fs);
  }

  /** Set drive by letter string */
  setDriveByLetter(letter: string, fs: DriveFS): void {
    const driveNum = letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    this.setDrive(driveNum, fs);
  }

  /** Alias for setDriveByLetter */
  mount(letter: string, fs: DriveFS): void {
    this.setDriveByLetter(letter, fs);
  }

  /** Unmount a drive */
  unmount(letter: string): boolean {
    const driveNum = letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
    return this.drives.delete(driveNum);
  }

  /** Cache a loaded package for reuse */
  cachePackage(name: string, pkg: LoadedPackage): void {
    this.packageCache.set(name.toLowerCase(), pkg);
  }

  /** Get a cached package */
  getCachedPackage(name: string): LoadedPackage | undefined {
    return this.packageCache.get(name.toLowerCase());
  }

  /** Create a drive from one or more packages (with optional write overlay) */
  createPackageDrive(packages: LoadedPackage[], writable = true): DriveFS {
    const base = new PackageDriveFS(packages);
    return writable ? new OverlayDriveFS(base) : base;
  }

  /** Create an empty writable drive */
  createMemoryDrive(): MemoryDriveFS {
    return new MemoryDriveFS();
  }

  /** List all configured drives */
  listDrives(): { drive: number; letter: string; fileCount: number }[] {
    const result: { drive: number; letter: string; fileCount: number }[] = [];
    for (const [drive, fs] of this.drives) {
      result.push({
        drive,
        letter: String.fromCharCode('A'.charCodeAt(0) + drive),
        fileCount: fs.listFiles().length
      });
    }
    return result.sort((a, b) => a.drive - b.drive);
  }
}

// Re-export for convenience
export { JSZip };
