/**
 * Shared in-memory virtual filesystem for CP/M emulator.
 *
 * Unlike MemoryFS, SharedMemoryFS supports:
 * - Live files: Dynamic content sources (e.g., editor content)
 * - Multiple emulator instances sharing the same filesystem
 * - Freezing live files to static snapshots
 */

import type { VirtualFS } from './types';

/**
 * A live file source that provides content dynamically.
 * Used for editor content that changes as the user types.
 */
export interface LiveFileSource {
  /** Get current content as bytes */
  getContent(): Uint8Array;
  /** Optional: Get content length without full read */
  getSize?(): number;
}

interface OpenFile {
  path: string;
  mode: 'r' | 'r+' | 'w' | 'wx+';
}

export class SharedMemoryFS implements VirtualFS {
  private files = new Map<string, Uint8Array>();
  private liveFiles = new Map<string, LiveFileSource>();
  private openFiles = new Map<number, OpenFile>();
  private nextHandle = 1;

  /** Normalize path (remove trailing slash, handle //) */
  private normalizePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  /**
   * Register a live file source.
   * The file content will be fetched dynamically on each read.
   */
  setLiveFile(path: string, source: LiveFileSource): void {
    path = this.normalizePath(path);
    this.liveFiles.set(path, source);
    // Remove any static version - live takes precedence
    this.files.delete(path);
  }

  /**
   * Remove a live file binding.
   * The file will no longer exist unless there's a static version.
   */
  removeLiveFile(path: string): void {
    path = this.normalizePath(path);
    this.liveFiles.delete(path);
  }

  /**
   * Convert a live file to a static snapshot.
   * Useful when the live source is going away (e.g., IDE closing).
   */
  freezeLiveFile(path: string): void {
    path = this.normalizePath(path);
    const live = this.liveFiles.get(path);
    if (live) {
      // Snapshot current content
      this.files.set(path, live.getContent());
      this.liveFiles.delete(path);
    }
  }

  /** Get file content, checking live files first */
  private getFileContent(path: string): Uint8Array | undefined {
    const live = this.liveFiles.get(path);
    if (live) {
      return live.getContent();
    }
    return this.files.get(path);
  }

  /** Check if file exists (static or live) */
  private hasFile(path: string): boolean {
    return this.files.has(path) || this.liveFiles.has(path);
  }

  /** Add a static file to the filesystem */
  addFile(path: string, content: Uint8Array | string): void {
    path = this.normalizePath(path);
    if (typeof content === 'string') {
      const encoder = new TextEncoder();
      content = encoder.encode(content);
    }
    // Static file overrides live file
    this.liveFiles.delete(path);
    this.files.set(path, content);
  }

  /** Get raw file content */
  getFile(path: string): Uint8Array | undefined {
    return this.getFileContent(this.normalizePath(path));
  }

  /** List all files (static and live) */
  listAll(): string[] {
    const paths = new Set<string>();
    for (const path of this.files.keys()) {
      paths.add(path);
    }
    for (const path of this.liveFiles.keys()) {
      paths.add(path);
    }
    return [...paths];
  }

  /** Clear all files */
  clear(): void {
    this.files.clear();
    this.liveFiles.clear();
    this.openFiles.clear();
  }

  // VirtualFS implementation

  open(path: string, mode: 'r' | 'r+' | 'w' | 'wx+'): number {
    path = this.normalizePath(path);

    if (mode === 'r' || mode === 'r+') {
      // File must exist for read modes
      if (!this.hasFile(path)) {
        return -1;
      }
    } else if (mode === 'wx+') {
      // File must NOT exist for exclusive create
      if (this.hasFile(path)) {
        return -1;
      }
      this.files.set(path, new Uint8Array(0));
    } else if (mode === 'w') {
      // Truncate or create - removes any live binding
      this.liveFiles.delete(path);
      this.files.set(path, new Uint8Array(0));
    }

    const handle = this.nextHandle++;
    this.openFiles.set(handle, { path, mode });
    return handle;
  }

  close(handle: number): void {
    this.openFiles.delete(handle);
  }

  read(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const file = this.openFiles.get(handle);
    if (!file) return 0;

    const content = this.getFileContent(file.path);
    if (!content) return 0;

    // Calculate how much we can read
    const available = Math.max(0, content.length - position);
    const toRead = Math.min(length, available);

    if (toRead > 0) {
      buffer.set(content.subarray(position, position + toRead), offset);
    }

    return toRead;
  }

  write(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const file = this.openFiles.get(handle);
    if (!file) return 0;

    if (file.mode === 'r') return 0; // Can't write in read-only mode

    // Writing to a live file converts it to static
    if (this.liveFiles.has(file.path)) {
      // Snapshot current content first
      const liveContent = this.liveFiles.get(file.path)!.getContent();
      this.files.set(file.path, liveContent);
      this.liveFiles.delete(file.path);
    }

    const content = this.files.get(file.path) ?? new Uint8Array(0);

    // Expand file if needed
    const newSize = Math.max(content.length, position + length);
    let newContent: Uint8Array;

    if (newSize > content.length) {
      newContent = new Uint8Array(newSize);
      newContent.set(content);
    } else {
      newContent = content;
    }

    // Write data
    newContent.set(buffer.subarray(offset, offset + length), position);
    this.files.set(file.path, newContent);

    return length;
  }

  stat(path: string): { size: number } | null {
    path = this.normalizePath(path);

    // Check live files first
    const live = this.liveFiles.get(path);
    if (live) {
      const size = live.getSize?.() ?? live.getContent().length;
      return { size };
    }

    const content = this.files.get(path);
    return content ? { size: content.length } : null;
  }

  unlink(path: string): boolean {
    path = this.normalizePath(path);
    const hadStatic = this.files.delete(path);
    const hadLive = this.liveFiles.delete(path);
    return hadStatic || hadLive;
  }

  rename(oldPath: string, newPath: string): boolean {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);

    // Handle live files
    const live = this.liveFiles.get(oldPath);
    if (live) {
      // Snapshot content for the rename (can't rename live source)
      this.files.set(newPath, live.getContent());
      this.liveFiles.delete(oldPath);
      return true;
    }

    const content = this.files.get(oldPath);
    if (!content) return false;

    this.files.set(newPath, content);
    this.files.delete(oldPath);
    return true;
  }

  readdir(path: string): string[] {
    path = this.normalizePath(path);

    // Ensure path ends with / for prefix matching
    const prefix = path === '/' ? '/' : path + '/';

    const entries = new Set<string>();

    // Include static files
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        if (rest && !rest.includes('/')) {
          entries.add(rest);
        }
      }
    }

    // Include live files
    for (const filePath of this.liveFiles.keys()) {
      if (filePath.startsWith(prefix)) {
        const rest = filePath.slice(prefix.length);
        if (rest && !rest.includes('/')) {
          entries.add(rest);
        }
      }
    }

    return [...entries];
  }

  exists(path: string): boolean {
    return this.hasFile(this.normalizePath(path));
  }
}

/**
 * Create a LiveFileSource from a function that returns the current content.
 * Useful for binding to editor state.
 */
export function createLiveFileSource(
  getContent: () => string,
  options?: { convertLineEndings?: boolean }
): LiveFileSource {
  const convert = options?.convertLineEndings ?? true;

  return {
    getContent(): Uint8Array {
      let content = getContent();
      if (convert) {
        // Convert to CP/M line endings and add EOF marker
        content = content.replace(/\r?\n/g, '\r\n') + '\x1A';
      }
      return new TextEncoder().encode(content);
    },
    getSize(): number {
      let content = getContent();
      if (convert) {
        content = content.replace(/\r?\n/g, '\r\n') + '\x1A';
      }
      // Return byte length, not character length
      return new TextEncoder().encode(content).length;
    }
  };
}
