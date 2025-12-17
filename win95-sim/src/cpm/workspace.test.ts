/**
 * Tests for the CP/M Workspace.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CpmWorkspace,
  WorkspaceFS,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  DriveManager,
} from './workspace';
import type { LoadedPackage } from './package-loader';

describe('WorkspaceFS', () => {
  let driveManager: DriveManager;
  let fs: WorkspaceFS;

  beforeEach(() => {
    driveManager = new DriveManager();
    driveManager.mount('A', new MemoryDriveFS());
    driveManager.mount('B', new MemoryDriveFS());
    fs = new WorkspaceFS(driveManager);
  });

  it('should add and read files using drive paths', () => {
    fs.addFile('/A/TEST.TXT', 'Hello World');

    expect(fs.exists('/A/TEST.TXT')).toBe(true);
    expect(fs.exists('/A/TEST.TXT')).toBe(true); // case insensitive
    expect(fs.exists('/B/TEST.TXT')).toBe(false);

    const content = fs.getFile('/A/TEST.TXT');
    expect(content).toBeDefined();
    expect(new TextDecoder().decode(content!)).toBe('Hello World');
  });

  it('should list files in a drive directory', () => {
    fs.addFile('/A/FILE1.COM', new Uint8Array([1, 2, 3]));
    fs.addFile('/A/FILE2.COM', new Uint8Array([4, 5, 6]));
    fs.addFile('/B/OTHER.COM', new Uint8Array([7, 8, 9]));

    const filesA = fs.readdir('/A');
    expect(filesA).toContain('FILE1.COM');
    expect(filesA).toContain('FILE2.COM');
    expect(filesA).not.toContain('OTHER.COM');

    const filesB = fs.readdir('/B');
    expect(filesB).toContain('OTHER.COM');
    expect(filesB.length).toBe(1);
  });

  it('should handle file open/read/close operations', () => {
    fs.addFile('/A/DATA.BIN', new Uint8Array([0x41, 0x42, 0x43, 0x44]));

    const handle = fs.open('/A/DATA.BIN', 'r');
    expect(handle).toBeGreaterThan(0);

    const buffer = new Uint8Array(4);
    const bytesRead = fs.read(handle, buffer, 0, 4, 0);
    expect(bytesRead).toBe(4);
    expect(Array.from(buffer)).toEqual([0x41, 0x42, 0x43, 0x44]);

    fs.close(handle);
  });

  it('should handle file write operations', () => {
    const handle = fs.open('/A/NEW.TXT', 'wx+');
    expect(handle).toBeGreaterThan(0);

    const data = new Uint8Array([0x48, 0x69]); // 'Hi'
    const bytesWritten = fs.write(handle, data, 0, 2, 0);
    expect(bytesWritten).toBe(2);

    fs.close(handle);

    // Verify the file was written
    const content = fs.getFile('/A/NEW.TXT');
    expect(content).toEqual(new Uint8Array([0x48, 0x69]));
  });

  it('should get file stats', () => {
    fs.addFile('/A/SIZE.DAT', new Uint8Array(100));

    const stat = fs.stat('/A/SIZE.DAT');
    expect(stat).not.toBeNull();
    expect(stat!.size).toBe(100);

    expect(fs.stat('/A/NONEXISTENT.DAT')).toBeNull();
  });

  it('should delete files', () => {
    fs.addFile('/A/DELETE.ME', 'content');
    expect(fs.exists('/A/DELETE.ME')).toBe(true);

    const result = fs.unlink('/A/DELETE.ME');
    expect(result).toBe(true);
    expect(fs.exists('/A/DELETE.ME')).toBe(false);
  });

  it('should rename files within same drive', () => {
    fs.addFile('/A/OLD.TXT', 'data');

    const result = fs.rename('/A/OLD.TXT', '/A/NEW.TXT');
    expect(result).toBe(true);
    expect(fs.exists('/A/OLD.TXT')).toBe(false);
    expect(fs.exists('/A/NEW.TXT')).toBe(true);
  });

  it('should list all files across drives', () => {
    fs.addFile('/A/FILE1.COM', new Uint8Array([1]));
    fs.addFile('/B/FILE2.COM', new Uint8Array([2]));

    const allFiles = fs.listAll();
    expect(allFiles).toContain('/A/FILE1.COM');
    expect(allFiles).toContain('/B/FILE2.COM');
  });
});

describe('CpmWorkspace', () => {
  let workspace: CpmWorkspace;

  beforeEach(() => {
    workspace = new CpmWorkspace('/test-cpm');
  });

  it('should mount and access drives', () => {
    const memDrive = new MemoryDriveFS();
    workspace.mount('A', memDrive);

    expect(workspace.drive('A')).toBe(memDrive);
    expect(workspace.drive('B')).toBeUndefined();
  });

  it('should read/write files through workspace interface', () => {
    workspace.mount('A', new MemoryDriveFS());

    workspace.writeFile('A', 'TEST.COM', new Uint8Array([0xC9]));
    expect(workspace.listFiles('A')).toContain('TEST.COM');

    const content = workspace.readFile('A', 'TEST.COM');
    expect(content).toEqual(new Uint8Array([0xC9]));
  });

  it('should create package drives with overlay', () => {
    // Create a mock package
    const pkg: LoadedPackage = {
      manifest: { name: 'test', files: [] },
      files: new Map([['TOOL.COM', new Uint8Array([0xC9])]])
    };

    const drive = workspace.createPackageDrive([pkg], true);
    workspace.mount('B', drive);

    // Read from package
    expect(workspace.readFile('B', 'TOOL.COM')).toEqual(new Uint8Array([0xC9]));

    // Write to overlay
    workspace.writeFile('B', 'NEW.TXT', new Uint8Array([0x41]));
    expect(workspace.readFile('B', 'NEW.TXT')).toEqual(new Uint8Array([0x41]));
  });

  it('should create memory drives', () => {
    const memDrive = workspace.createMemoryDrive();
    workspace.mount('C', memDrive);

    workspace.writeFile('C', 'SCRATCH.DAT', new Uint8Array([1, 2, 3]));
    expect(workspace.listFiles('C')).toContain('SCRATCH.DAT');
  });

  it('should provide VirtualFS interface', () => {
    workspace.mount('A', new MemoryDriveFS());

    const vfs = workspace.getVirtualFS();
    vfs.addFile('/A/VIA.VFS', 'hello');

    expect(vfs.exists('/A/VIA.VFS')).toBe(true);
    expect(workspace.listFiles('A')).toContain('VIA.VFS');
  });

  it('should expose DriveManager', () => {
    workspace.mount('A', new MemoryDriveFS());

    const dm = workspace.getDriveManager();
    expect(dm.listDrives().length).toBe(1);
    expect(dm.listDrives()[0].letter).toBe('A');
  });
});

describe('Workspace with package integration', () => {
  it('should layer multiple packages with overlay', () => {
    // Simulate core + tools packages
    const corePkg: LoadedPackage = {
      manifest: { name: 'core', files: [] },
      files: new Map([
        ['CCP.COM', new Uint8Array([0x01])],
        ['DIR.COM', new Uint8Array([0x02])],
      ])
    };

    const toolsPkg: LoadedPackage = {
      manifest: { name: 'tools', files: [] },
      files: new Map([
        ['ASM.COM', new Uint8Array([0x03])],
      ])
    };

    const workspace = new CpmWorkspace();

    // A: = core + tools with writable overlay
    const driveA = workspace.createPackageDrive([corePkg, toolsPkg], true);
    workspace.mount('A', driveA);

    // B: = scratch space
    workspace.mount('B', workspace.createMemoryDrive());

    // All package files are accessible
    expect(workspace.readFile('A', 'CCP.COM')).toEqual(new Uint8Array([0x01]));
    expect(workspace.readFile('A', 'DIR.COM')).toEqual(new Uint8Array([0x02]));
    expect(workspace.readFile('A', 'ASM.COM')).toEqual(new Uint8Array([0x03]));

    // Can write new files (to overlay)
    workspace.writeFile('A', 'USER.TXT', new Uint8Array([0x41]));
    expect(workspace.readFile('A', 'USER.TXT')).toEqual(new Uint8Array([0x41]));

    // Can override package files (in overlay)
    workspace.writeFile('A', 'DIR.COM', new Uint8Array([0xFF]));
    expect(workspace.readFile('A', 'DIR.COM')).toEqual(new Uint8Array([0xFF]));
  });
});
