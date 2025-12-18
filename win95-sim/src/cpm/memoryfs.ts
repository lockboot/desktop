/**
 * In-memory virtual filesystem for CP/M emulator.
 *
 * Files are stored as Uint8Array in a Map structure.
 * Directories are implicit (derived from file paths).
 */

import type { VirtualFS } from './types';

interface OpenFile {
  path: string;
  mode: 'r' | 'r+' | 'w' | 'wx+';
}

export class MemoryFS implements VirtualFS {
  private files = new Map<string, Uint8Array>();
  private openFiles = new Map<number, OpenFile>();
  private nextHandle = 1;

  /** Normalize path (remove trailing slash, handle //) */
  private normalizePath(path: string): string {
    return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  /** Add a file to the filesystem */
  addFile(path: string, content: Uint8Array | string): void {
    path = this.normalizePath(path);
    if (typeof content === 'string') {
      const encoder = new TextEncoder();
      content = encoder.encode(content);
    }
    this.files.set(path, content);
  }

  /** Get raw file content */
  getFile(path: string): Uint8Array | undefined {
    return this.files.get(this.normalizePath(path));
  }

  /** List all files */
  listAll(): string[] {
    return [...this.files.keys()];
  }

  /** Clear all files */
  clear(): void {
    this.files.clear();
    this.openFiles.clear();
  }

  // VirtualFS implementation

  open(path: string, mode: 'r' | 'r+' | 'w' | 'wx+'): number {
    path = this.normalizePath(path);

    if (mode === 'r' || mode === 'r+') {
      // File must exist for read modes
      if (!this.files.has(path)) {
        return -1;
      }
    } else if (mode === 'wx+') {
      // File must NOT exist for exclusive create
      if (this.files.has(path)) {
        return -1;
      }
      this.files.set(path, new Uint8Array(0));
    } else if (mode === 'w') {
      // Truncate or create
      this.files.set(path, new Uint8Array(0));
    }

    const handle = this.nextHandle++;
    this.openFiles.set(handle, { path, mode });
    return handle;
  }

  close(handle: number): void {
    this.openFiles.delete(handle);
  }

  closeAll(): void {
    // MemoryFS writes immediately, so just clear handles
    this.openFiles.clear();
  }

  read(handle: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const file = this.openFiles.get(handle);
    if (!file) return 0;

    const content = this.files.get(file.path);
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
    const content = this.files.get(path);
    return content ? { size: content.length } : null;
  }

  unlink(path: string): boolean {
    path = this.normalizePath(path);
    return this.files.delete(path);
  }

  rename(oldPath: string, newPath: string): boolean {
    oldPath = this.normalizePath(oldPath);
    newPath = this.normalizePath(newPath);

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

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        // Get the part after the prefix
        const rest = filePath.slice(prefix.length);
        // Only include if it's a direct child (no more slashes)
        if (rest && !rest.includes('/')) {
          entries.add(rest);
        }
      }
    }

    return [...entries];
  }

  exists(path: string): boolean {
    return this.files.has(this.normalizePath(path));
  }
}

/**
 * Create a MemoryFS pre-populated with some test files.
 */
export function createTestFS(): MemoryFS {
  const fs = new MemoryFS();

  // Add a simple test file
  fs.addFile('/HELLO.TXT', 'Hello from CP/M!\r\n');

  // Add a simple BASIC-like program listing
  fs.addFile('/README.TXT', `
CP/M Virtual Filesystem
=======================

This filesystem is exposed to CP/M programs running
in the Z80 emulator. Files can be read and written
using standard CP/M BDOS calls.

The filesystem is backed by the context tree:
  org.myapp.window.{id}.files.*

`);

  return fs;
}
