/**
 * Tests for the CP/M Package Loader
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadPackage,
  MemoryDriveFS,
  PackageDriveFS,
  OverlayDriveFS,
  DriveManager,
  LoadedPackage,
} from './package-loader';

const CPM_DIR = join(__dirname, '../../public/cpm');

/** Load a package zip file from public/cpm */
function loadPackageZip(name: string): Uint8Array | null {
  const path = join(CPM_DIR, `${name}.zip`);
  if (!existsSync(path)) {
    return null;
  }
  return new Uint8Array(readFileSync(path));
}

describe('Package Loading', () => {
  it('should load a package from zip data', async () => {
    const zipData = loadPackageZip('core');
    if (!zipData) {
      console.log('core.zip not found, skipping');
      return;
    }

    const pkg = await loadPackage(zipData);

    expect(pkg.manifest).toBeDefined();
    expect(pkg.manifest.name).toBe('CP/M Core Utilities');
    expect(pkg.files.size).toBeGreaterThan(0);

    // Check for expected files
    expect(pkg.files.has('DIR.COM')).toBe(true);
    expect(pkg.files.has('ERA.COM')).toBe(true);

    console.log('Loaded package:', pkg.manifest.name);
    console.log('Files:', Array.from(pkg.files.keys()));
  });

  it('should load assemblers package with all tools', async () => {
    const zipData = loadPackageZip('assemblers');
    if (!zipData) {
      console.log('assemblers.zip not found, skipping');
      return;
    }

    const pkg = await loadPackage(zipData);

    expect(pkg.manifest.name).toBe('Assemblers');
    expect(pkg.files.has('LASM3.COM')).toBe(true);
    expect(pkg.files.has('Z80MR.COM')).toBe(true);
    expect(pkg.files.has('ZASM.COM')).toBe(true);
  });
});

describe('MemoryDriveFS', () => {
  it('should store and retrieve files', () => {
    const fs = new MemoryDriveFS();

    fs.writeFile('TEST.COM', new Uint8Array([0xC9]));

    expect(fs.exists('TEST.COM')).toBe(true);
    expect(fs.exists('test.com')).toBe(true); // Case insensitive
    expect(fs.readFile('TEST.COM')).toEqual(new Uint8Array([0xC9]));
    expect(fs.listFiles()).toContain('TEST.COM');
  });

  it('should delete files', () => {
    const fs = new MemoryDriveFS();

    fs.writeFile('TEST.COM', new Uint8Array([0xC9]));
    expect(fs.deleteFile('TEST.COM')).toBe(true);
    expect(fs.exists('TEST.COM')).toBe(false);
    expect(fs.deleteFile('NOTEXIST.COM')).toBe(false);
  });
});

describe('PackageDriveFS', () => {
  it('should provide read-only access to package files', async () => {
    const zipData = loadPackageZip('core');
    if (!zipData) {
      console.log('core.zip not found, skipping');
      return;
    }

    const pkg = await loadPackage(zipData);
    const fs = new PackageDriveFS([pkg]);

    expect(fs.exists('DIR.COM')).toBe(true);
    expect(fs.readFile('DIR.COM')).toBeDefined();
    expect(fs.listFiles()).toContain('DIR.COM');
  });

  it('should merge multiple packages', async () => {
    const coreZip = loadPackageZip('core');
    const asmZip = loadPackageZip('assemblers');

    if (!coreZip || !asmZip) {
      console.log('Packages not found, skipping');
      return;
    }

    const core = await loadPackage(coreZip);
    const asm = await loadPackage(asmZip);

    const fs = new PackageDriveFS([core, asm]);

    // Should have files from both packages
    expect(fs.exists('DIR.COM')).toBe(true);      // From core
    expect(fs.exists('LASM3.COM')).toBe(true);    // From assemblers
    expect(fs.exists('Z80MR.COM')).toBe(true);    // From assemblers

    console.log('Merged drive files:', fs.listFiles());
  });
});

describe('OverlayDriveFS', () => {
  it('should allow writes on top of read-only packages', async () => {
    const zipData = loadPackageZip('core');
    if (!zipData) {
      console.log('core.zip not found, skipping');
      return;
    }

    const pkg = await loadPackage(zipData);
    const base = new PackageDriveFS([pkg]);
    const fs = new OverlayDriveFS(base);

    // Read from base
    expect(fs.exists('DIR.COM')).toBe(true);

    // Write new file to overlay
    fs.writeFile('MYFILE.TXT', new Uint8Array([65, 66, 67]));
    expect(fs.exists('MYFILE.TXT')).toBe(true);
    expect(fs.readFile('MYFILE.TXT')).toEqual(new Uint8Array([65, 66, 67]));

    // Override a package file
    const original = fs.readFile('DIR.COM');
    fs.writeFile('DIR.COM', new Uint8Array([0xC9]));
    expect(fs.readFile('DIR.COM')).toEqual(new Uint8Array([0xC9]));
    expect(fs.readFile('DIR.COM')).not.toEqual(original);

    // Delete a file
    fs.deleteFile('ERA.COM');
    expect(fs.exists('ERA.COM')).toBe(false);

    // Track modifications
    expect(fs.getModifiedFiles().has('MYFILE.TXT')).toBe(true);
    expect(fs.getModifiedFiles().has('DIR.COM')).toBe(true);
    expect(fs.getDeletedFiles()).toContain('ERA.COM');
  });
});

describe('DriveManager', () => {
  it('should manage multiple drives', async () => {
    const manager = new DriveManager();

    // Create memory drive for A:
    manager.setDrive(0, manager.createMemoryDrive());

    // Create package drive for B:
    const coreZip = loadPackageZip('core');
    if (coreZip) {
      const core = await loadPackage(coreZip);
      manager.cachePackage('core', core);
      manager.setDrive(1, manager.createPackageDrive([core]));
    }

    // Test drive access
    const driveA = manager.getDrive(0);
    const driveB = manager.getDrive(1);

    expect(driveA).toBeDefined();
    driveA!.writeFile('TEST.COM', new Uint8Array([0xC9]));
    expect(driveA!.exists('TEST.COM')).toBe(true);

    if (coreZip) {
      expect(driveB).toBeDefined();
      expect(driveB!.exists('DIR.COM')).toBe(true);
    }

    // Test letter access
    expect(manager.drive('A')).toBe(driveA);
    expect(manager.drive('B')).toBe(driveB);

    console.log('Configured drives:', manager.listDrives());
  });

  it('should support package caching', async () => {
    const manager = new DriveManager();

    const coreZip = loadPackageZip('core');
    if (!coreZip) {
      console.log('core.zip not found, skipping');
      return;
    }

    const pkg = await loadPackage(coreZip);
    manager.cachePackage('core', pkg);

    const cached = manager.getCachedPackage('core');
    expect(cached).toBe(pkg);
    expect(manager.getCachedPackage('CORE')).toBe(pkg); // Case insensitive
  });
});
