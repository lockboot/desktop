/**
 * CP/M Package Loader
 *
 * Loads package zip files and provides drive mounting capabilities.
 * Packages can be combined onto drives (A: = [assemblers, xccp, zork])
 * or drives can use raw MemoryFS for scratch space.
 */

import JSZip from 'jszip';

/**
 * Convert a filename to valid CP/M 8.3 format.
 * - Uppercases
 * - Truncates name to 8 chars, extension to 3 chars
 * - Removes invalid characters
 */
export function to83(filename: string): string {
  const upper = filename.toUpperCase();
  const lastDot = upper.lastIndexOf('.');

  let name: string;
  let ext: string;

  if (lastDot === -1) {
    name = upper;
    ext = '';
  } else {
    name = upper.slice(0, lastDot);
    ext = upper.slice(lastDot + 1);
  }

  // Valid characters: A-Z, 0-9, $ # @ ! % ' ` ( ) { } ~ ^ - _
  const clean = (s: string) => s.replace(/[^A-Z0-9$#@!%'`(){}~^\-_]/g, '');

  name = clean(name).slice(0, 8);
  ext = clean(ext).slice(0, 3);

  // Name must be at least 1 char
  if (name.length === 0) name = '_';

  return ext ? `${name}.${ext}` : name;
}

/** Action defined in a package manifest */
export interface PackageAction {
  id: string;
  name: string;
  command: string;        // COM file to run
  patterns: string[];     // File patterns this action applies to (e.g., "*.ASM")
  outputExts?: string[];  // Expected output extensions
  submit?: string;        // SUBMIT template (command line with {name} placeholder)
  interactiveScript?: Array<{ wait: string; send: string }>;  // For menu-driven tools
  package?: string;       // Package that provides this action (filled in at load time)
}

/**
 * Check if a filename matches an action's patterns.
 * Supports simple glob patterns like "*.ASM" or exact matches.
 *
 * @param action - The action to check
 * @param filename - Filename to match (e.g., "TEST.ASM")
 * @returns true if filename matches any of the action's patterns
 */
export function actionMatchesFile(action: PackageAction, filename: string): boolean {
  const upper = filename.toUpperCase();
  return action.patterns.some(pattern => {
    const upperPattern = pattern.toUpperCase();
    // Simple glob matching: *.EXT matches files with that extension
    if (upperPattern.startsWith('*.')) {
      const ext = upperPattern.slice(1); // e.g., ".ASM"
      return upper.endsWith(ext);
    }
    // Exact match
    return upper === upperPattern;
  });
}

/**
 * Expand a submit template with the given basename and drive.
 * Replaces {name} placeholder with the basename and {drive} with the drive letter.
 *
 * @param action - Action with submit template
 * @param baseName - Base filename (without extension)
 * @param drive - Drive letter (e.g., 'A', 'B')
 * @returns Expanded command string
 */
export function expandSubmitTemplate(action: PackageAction, baseName: string, drive?: string): string {
  if (!action.submit) return `${action.command} ${baseName}\r`;
  let result = action.submit.replace(/\{name\}/g, baseName);
  if (drive) {
    result = result.replace(/\{drive\}/g, drive);
  }
  return result;
}

/** Package manifest schema */
export interface PackageManifest {
  id?: string;           // Package ID (matches zip filename, e.g., "turbo-pascal-3")
  name: string;          // Display name (e.g., "Turbo Pascal 3")
  version?: string;
  description?: string;
  outputDir?: string;
  files?: { src: string; dst?: string; required?: boolean; loadAddress?: string; type?: string }[];
  meta?: Record<string, unknown>;
  actions?: PackageAction[];
}

/** Loaded package with files and actions */
export interface LoadedPackage {
  manifest: PackageManifest;
  files: Map<string, Uint8Array>;
  actions: PackageAction[];  // Actions with package name filled in
}

/**
 * Normalize manifest data to array format.
 * Supports single dict or array of dicts.
 */
function normalizeManifestData(data: unknown): PackageManifest[] {
  if (Array.isArray(data)) {
    return data as PackageManifest[];
  }
  return [data as PackageManifest];
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
 * Load packages from zip data.
 * Supports manifest.mf as single object or array of objects.
 * Returns multiple packages if the manifest is an array.
 */
export async function loadPackages(zipData: Uint8Array | ArrayBuffer): Promise<LoadedPackage[]> {
  const zip = await JSZip.loadAsync(zipData);
  const allFiles = new Map<string, Uint8Array>();
  let manifests: PackageManifest[] = [];

  // Extract all files
  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const content = await zipEntry.async('uint8array');
    const upperName = filename.toUpperCase();

    if (upperName === 'MANIFEST.MF') {
      try {
        const text = new TextDecoder().decode(content);
        const parsed = JSON.parse(text);
        manifests = normalizeManifestData(parsed);
      } catch (e) {
        console.warn('Failed to parse manifest.mf:', e);
      }
    } else {
      // Store with 8.3 filename (CP/M format)
      allFiles.set(to83(upperName), content);
    }
  }

  // Create default manifest if none found
  if (manifests.length === 0) {
    manifests = [{
      name: 'Unknown Package',
      files: Array.from(allFiles.keys()).map(name => ({ src: name }))
    }];
  }

  // Create a LoadedPackage for each manifest
  const packages: LoadedPackage[] = [];
  const assignedFiles = new Set<string>();

  for (const manifest of manifests) {
    const pkgFiles = new Map<string, Uint8Array>();
    const actions: PackageAction[] = [];

    // Get files listed in this manifest
    if (manifest.files) {
      for (const fileEntry of manifest.files) {
        const fname = to83(fileEntry.src);
        const content = allFiles.get(fname);
        if (content) {
          pkgFiles.set(fname, content);
          assignedFiles.add(fname);
        }
      }
    }

    // Collect actions for this package
    if (manifest.actions) {
      for (const action of manifest.actions) {
        // Use manifest.id for loading packages, fall back to name
        actions.push({ ...action, package: manifest.id || manifest.name });
      }
    }

    packages.push({ manifest, files: pkgFiles, actions });
  }

  // Any unassigned files go to the first package
  if (packages.length > 0) {
    for (const [fname, content] of allFiles) {
      if (!assignedFiles.has(fname)) {
        packages[0].files.set(fname, content);
      }
    }
  }

  return packages;
}

/**
 * Load a single package from zip data (convenience wrapper).
 * If the zip contains multiple packages, returns the first one with all files.
 */
export async function loadPackage(zipData: Uint8Array | ArrayBuffer): Promise<LoadedPackage> {
  const packages = await loadPackages(zipData);
  if (packages.length === 0) {
    return {
      manifest: { name: 'Empty Package' },
      files: new Map(),
      actions: []
    };
  }
  if (packages.length === 1) {
    return packages[0];
  }
  // Multiple packages - merge into one for backwards compat
  const merged: LoadedPackage = {
    manifest: packages[0].manifest,
    files: new Map(),
    actions: []
  };
  for (const pkg of packages) {
    for (const [name, data] of pkg.files) {
      merged.files.set(name, data);
    }
    merged.actions.push(...pkg.actions);
  }
  return merged;
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
    return this.files.get(to83(name));
  }

  writeFile(name: string, data: Uint8Array): void {
    this.files.set(to83(name), data);
  }

  deleteFile(name: string): boolean {
    return this.files.delete(to83(name));
  }

  listFiles(): string[] {
    return Array.from(this.files.keys());
  }

  exists(name: string): boolean {
    return this.files.has(to83(name));
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
  private allActions: PackageAction[] = [];

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
      const fname = to83(name);
      this.files.set(fname, data);
      this.fileOrigins.set(fname, pkgName);
    }
    // Collect actions (if present)
    if (pkg.actions) {
      for (const action of pkg.actions) {
        this.allActions.push(action);
      }
    }
  }

  /** Remove a package by name */
  removePackage(name: string): boolean {
    const idx = this.packages.findIndex(p => p.manifest.name === name);
    if (idx === -1) return false;

    this.packages.splice(idx, 1);

    // Rebuild files, origins, and actions from remaining packages
    this.files.clear();
    this.fileOrigins.clear();
    this.allActions = [];
    for (const pkg of this.packages) {
      const pkgName = pkg.manifest.name;
      for (const [f, data] of pkg.files) {
        const fname = to83(f);
        this.files.set(fname, data);
        this.fileOrigins.set(fname, pkgName);
      }
      if (pkg.actions) {
        for (const action of pkg.actions) {
          this.allActions.push(action);
        }
      }
    }
    return true;
  }

  /** Get all actions from all packages */
  getActions(): PackageAction[] {
    return [...this.allActions];
  }

  /** Get all loaded packages */
  getPackages(): LoadedPackage[] {
    return [...this.packages];
  }

  /** Get which package a file came from */
  getFileOrigin(name: string): string | undefined {
    return this.fileOrigins.get(to83(name));
  }

  /** Get files grouped by package */
  getFilesByPackage(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const pkg of this.packages) {
      const pkgName = pkg.manifest.name;
      const files: string[] = [];
      for (const fname of pkg.files.keys()) {
        files.push(to83(fname));
      }
      result.set(pkgName, files);
    }
    return result;
  }

  /** Generate virtual MANIFEST.MF content from all packages */
  private getManifestContent(): Uint8Array {
    const manifests = this.packages.map(p => p.manifest);
    const json = manifests.length === 1
      ? JSON.stringify(manifests[0], null, 2)
      : JSON.stringify(manifests, null, 2);
    return new TextEncoder().encode(json);
  }

  readFile(name: string): Uint8Array | undefined {
    const fname = to83(name);
    // Virtual MANIFEST.MF
    if (fname === 'MANIFEST.MF' && this.packages.length > 0) {
      return this.getManifestContent();
    }
    return this.files.get(fname);
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
    const files = Array.from(this.files.keys());
    // Add virtual MANIFEST.MF if we have packages
    if (this.packages.length > 0 && !files.includes('MANIFEST.MF')) {
      files.push('MANIFEST.MF');
    }
    return files;
  }

  exists(name: string): boolean {
    const fname = to83(name);
    // Virtual MANIFEST.MF
    if (fname === 'MANIFEST.MF' && this.packages.length > 0) {
      return true;
    }
    return this.files.has(fname);
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
    const fname = to83(name);
    if (this.deleted.has(fname)) return undefined;
    return this.overlay.get(fname) ?? this.base.readFile(fname);
  }

  writeFile(name: string, data: Uint8Array): void {
    const fname = to83(name);
    this.overlay.set(fname, data);
    this.deleted.delete(fname);
  }

  deleteFile(name: string): boolean {
    const fname = to83(name);
    const existed = this.exists(fname);
    this.overlay.delete(fname);
    this.deleted.add(fname);
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
    const fname = to83(name);
    if (this.deleted.has(fname)) return false;
    return this.overlay.has(fname) || this.base.exists(fname);
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
