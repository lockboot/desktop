#!/usr/bin/env npx tsx
/**
 * CP/M Package Manager CLI
 *
 * Manages packages in the packages/ directory and builds them to public/cpm/
 *
 * Usage:
 *   npx ts-node scripts/cpm-pkg.ts list              # List all packages
 *   npx ts-node scripts/cpm-pkg.ts build             # Build all packages
 *   npx ts-node scripts/cpm-pkg.ts build <name>      # Build specific package
 *   npx ts-node scripts/cpm-pkg.ts clean             # Clean public/cpm
 *   npx ts-node scripts/cpm-pkg.ts init <name>       # Create new package
 *   npx ts-node scripts/cpm-pkg.ts validate          # Validate all manifests
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import unzipper for zip extraction
import * as unzipper from 'unzipper';
// Import archiver for zip creation
import archiver from 'archiver';

const PACKAGES_DIR = path.join(__dirname, '../packages');
const OUTPUT_DIR = path.join(__dirname, '../public/cpm');

/** Package manifest schema */
interface PackageManifest {
  name: string;
  version?: string;
  description?: string;
  /** Source archive (zip, lbr, etc.) - path relative to package dir */
  source?: string;
  /** Output subdirectory in public/cpm/ (defaults to package dir name) */
  outputDir?: string;
  /** Files to extract/copy */
  files: FileEntry[];
  /** Additional metadata */
  meta?: Record<string, any>;
}

interface FileEntry {
  /** Source path within archive or package dir */
  src: string;
  /** Destination path (relative to output dir). Defaults to src uppercased */
  dst?: string;
  /** If false, file is optional. Defaults to true */
  required?: boolean;
}

/** Get destination filename - defaults to uppercased source basename */
function getDst(file: FileEntry): string {
  if (file.dst) return file.dst;
  return path.basename(file.src).toUpperCase();
}

/** Check if file is required - defaults to true */
function isRequired(file: FileEntry): boolean {
  return file.required !== false;
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string) {
  console.log(msg);
}

function logSuccess(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg: string) {
  console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(msg: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logWarn(msg: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

/** Get all package directories */
function getPackages(): string[] {
  if (!fs.existsSync(PACKAGES_DIR)) {
    return [];
  }
  return fs.readdirSync(PACKAGES_DIR)
    .filter(name => {
      const pkgPath = path.join(PACKAGES_DIR, name);
      const manifestPath = path.join(pkgPath, 'manifest.json');
      return fs.statSync(pkgPath).isDirectory() && fs.existsSync(manifestPath);
    });
}

/** Load a package manifest */
function loadManifest(pkgName: string): PackageManifest | null {
  const manifestPath = path.join(PACKAGES_DIR, pkgName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    logError(`Failed to parse manifest for ${pkgName}: ${err}`);
    return null;
  }
}

/** List all packages */
function cmdList() {
  const packages = getPackages();
  if (packages.length === 0) {
    logInfo('No packages found in packages/');
    logInfo('Create one with: npx ts-node scripts/cpm-pkg.ts init <name>');
    return;
  }

  log(`\n${colors.bright}CP/M Packages${colors.reset}\n`);

  for (const pkgName of packages) {
    const manifest = loadManifest(pkgName);
    if (manifest) {
      const fileCount = manifest.files?.length || 0;
      const version = manifest.version ? `v${manifest.version}` : '';
      log(`  ${colors.cyan}${pkgName}${colors.reset} ${version}`);
      log(`    ${manifest.name} - ${fileCount} files`);
      if (manifest.description) {
        log(`    ${colors.bright}${manifest.description}${colors.reset}`);
      }
    }
  }
  log('');
}

/** Validate all manifests */
function cmdValidate(): boolean {
  const packages = getPackages();
  let allValid = true;

  log(`\n${colors.bright}Validating packages...${colors.reset}\n`);

  for (const pkgName of packages) {
    const pkgDir = path.join(PACKAGES_DIR, pkgName);
    const manifest = loadManifest(pkgName);

    if (!manifest) {
      logError(`${pkgName}: Invalid or missing manifest`);
      allValid = false;
      continue;
    }

    // Check required fields
    if (!manifest.name) {
      logError(`${pkgName}: Missing 'name' field`);
      allValid = false;
    }

    if (!manifest.files || manifest.files.length === 0) {
      logWarn(`${pkgName}: No files defined`);
    }

    // Check source archive exists
    if (manifest.source) {
      const sourcePath = path.join(pkgDir, manifest.source);
      if (!fs.existsSync(sourcePath)) {
        logError(`${pkgName}: Source archive not found: ${manifest.source}`);
        allValid = false;
      }
    }

    // Check loose files exist (if no source archive)
    if (!manifest.source && manifest.files) {
      for (const file of manifest.files) {
        const filePath = path.join(pkgDir, file.src);
        if (!fs.existsSync(filePath)) {
          if (isRequired(file)) {
            logError(`${pkgName}: File not found: ${file.src}`);
            allValid = false;
          } else {
            logWarn(`${pkgName}: Optional file not found: ${file.src}`);
          }
        }
      }
    }

    if (allValid) {
      logSuccess(`${pkgName}: Valid`);
    }
  }

  log('');
  return allValid;
}

/** Extract a zip file to a directory */
async function extractZip(zipPath: string, outputDir: string, files?: FileEntry[]): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);

  // Build a map of files we want to extract
  const wantedFiles = new Map<string, string>();
  if (files) {
    for (const file of files) {
      // Normalize paths for comparison
      const srcLower = file.src.toLowerCase().replace(/\\/g, '/');
      wantedFiles.set(srcLower, getDst(file));
    }
  }

  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;

    const entryPath = entry.path.replace(/\\/g, '/');
    const entryLower = entryPath.toLowerCase();

    let outputPath: string;

    if (wantedFiles.size > 0) {
      // Check if this file matches any wanted file
      let matched = false;
      for (const [src, dst] of wantedFiles) {
        if (entryLower === src || entryLower.endsWith('/' + src)) {
          outputPath = path.join(outputDir, dst);
          matched = true;
          break;
        }
      }
      if (!matched) continue;
    } else {
      // Extract all files
      outputPath = path.join(outputDir, path.basename(entryPath));
    }

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath!), { recursive: true });

    // Extract file
    const content = await entry.buffer();
    fs.writeFileSync(outputPath!, content);
  }
}

/** Copy loose files from package to output */
function copyFiles(pkgDir: string, outputDir: string, files: FileEntry[]): void {
  for (const file of files) {
    const srcPath = path.join(pkgDir, file.src);
    const dstPath = path.join(outputDir, getDst(file));

    if (!fs.existsSync(srcPath)) {
      if (isRequired(file)) {
        logError(`File not found: ${file.src}`);
      }
      continue;
    }

    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
  }
}

/** Create a zip file from package files */
async function createZip(zipPath: string, files: { name: string; content: Uint8Array }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    for (const file of files) {
      archive.append(Buffer.from(file.content), { name: file.name });
    }

    archive.finalize();
  });
}

/** Collect files from a source archive */
async function collectFromZip(zipPath: string, fileEntries: FileEntry[]): Promise<{ name: string; content: Uint8Array }[]> {
  const directory = await unzipper.Open.file(zipPath);
  const result: { name: string; content: Uint8Array }[] = [];

  // Build a map of files we want to extract
  const wantedFiles = new Map<string, string>();
  for (const file of fileEntries) {
    const srcLower = file.src.toLowerCase().replace(/\\/g, '/');
    wantedFiles.set(srcLower, getDst(file));
  }

  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;

    const entryPath = entry.path.replace(/\\/g, '/');
    const entryLower = entryPath.toLowerCase();

    for (const [src, dst] of wantedFiles) {
      if (entryLower === src || entryLower.endsWith('/' + src)) {
        const content = await entry.buffer();
        result.push({ name: dst, content: new Uint8Array(content) });
        break;
      }
    }
  }

  return result;
}

/** Collect loose files from package directory */
function collectLooseFiles(pkgDir: string, fileEntries: FileEntry[]): { name: string; content: Uint8Array }[] {
  const result: { name: string; content: Uint8Array }[] = [];

  for (const file of fileEntries) {
    const srcPath = path.join(pkgDir, file.src);

    if (!fs.existsSync(srcPath)) {
      if (isRequired(file)) {
        throw new Error(`File not found: ${file.src}`);
      }
      continue;
    }

    const content = fs.readFileSync(srcPath);
    result.push({ name: getDst(file), content: new Uint8Array(content) });
  }

  return result;
}

/** Build a single package */
async function buildPackage(pkgName: string): Promise<boolean> {
  const manifest = loadManifest(pkgName);
  if (!manifest) {
    logError(`Package not found or invalid: ${pkgName}`);
    return false;
  }

  const pkgDir = path.join(PACKAGES_DIR, pkgName);
  const outputName = manifest.outputDir || pkgName;
  const zipPath = path.join(OUTPUT_DIR, `${outputName}.zip`);

  logInfo(`Building ${pkgName} → ${path.relative(process.cwd(), zipPath)}`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    let files: { name: string; content: Uint8Array }[];

    if (manifest.source) {
      // Collect from archive
      const sourcePath = path.join(pkgDir, manifest.source);
      const ext = path.extname(manifest.source).toLowerCase();

      if (ext === '.zip') {
        files = await collectFromZip(sourcePath, manifest.files);
      } else {
        logError(`Unsupported archive format: ${ext}`);
        return false;
      }
    } else {
      // Collect loose files
      files = collectLooseFiles(pkgDir, manifest.files);
    }

    // Add manifest to the zip
    const manifestPath = path.join(pkgDir, 'manifest.json');
    const manifestContent = fs.readFileSync(manifestPath);
    files.push({ name: 'manifest.json', content: new Uint8Array(manifestContent) });

    // Create the output zip
    await createZip(zipPath, files);

    logSuccess(`Built ${pkgName} (${files.length} files → ${outputName}.zip)`);
    return true;
  } catch (err) {
    logError(`Failed to build ${pkgName}: ${err}`);
    return false;
  }
}

/** Generate packages.json index file */
function generatePackagesIndex(): void {
  const packages = getPackages();
  const index: { packages: { id: string; name: string; description: string }[] } = {
    packages: []
  };

  for (const pkgName of packages) {
    const manifest = loadManifest(pkgName);
    if (manifest) {
      const outputName = manifest.outputDir || pkgName;
      index.packages.push({
        id: outputName,
        name: manifest.name,
        description: manifest.description || ''
      });
    }
  }

  // Sort alphabetically by id
  index.packages.sort((a, b) => a.id.localeCompare(b.id));

  const indexPath = path.join(OUTPUT_DIR, 'packages.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  logSuccess(`Generated packages.json (${index.packages.length} packages)`);
}

/** Build all packages */
async function cmdBuild(pkgName?: string) {
  if (pkgName) {
    await buildPackage(pkgName);
    // Regenerate index even for single package builds
    generatePackagesIndex();
    return;
  }

  const packages = getPackages();
  if (packages.length === 0) {
    logInfo('No packages to build');
    return;
  }

  log(`\n${colors.bright}Building ${packages.length} packages...${colors.reset}\n`);

  let success = 0;
  let failed = 0;

  for (const pkg of packages) {
    if (await buildPackage(pkg)) {
      success++;
    } else {
      failed++;
    }
  }

  // Generate the packages index
  generatePackagesIndex();

  log('');
  log(`${colors.green}${success} succeeded${colors.reset}, ${colors.red}${failed} failed${colors.reset}`);
}

/** Clean output directory */
function cmdClean() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    logInfo('Output directory does not exist');
    return;
  }

  // List what will be deleted
  const packages = getPackages();
  const zipFiles = packages.map(pkg => {
    const manifest = loadManifest(pkg);
    return (manifest?.outputDir || pkg) + '.zip';
  });

  log(`\n${colors.bright}Cleaning output directory...${colors.reset}\n`);

  for (const zipFile of zipFiles) {
    const fullPath = path.join(OUTPUT_DIR, zipFile);
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath);
      logSuccess(`Removed ${zipFile}`);
    }
  }

  log('');
}

/** Initialize a new package */
function cmdInit(pkgName: string) {
  if (!pkgName) {
    logError('Package name required');
    log('Usage: npx ts-node scripts/cpm-pkg.ts init <name>');
    return;
  }

  const pkgDir = path.join(PACKAGES_DIR, pkgName);

  if (fs.existsSync(pkgDir)) {
    logError(`Package already exists: ${pkgName}`);
    return;
  }

  fs.mkdirSync(pkgDir, { recursive: true });

  const manifest: PackageManifest = {
    name: pkgName,
    version: '1.0',
    description: 'Description here',
    files: [
      { src: 'EXAMPLE.COM', dst: 'EXAMPLE.COM' }
    ]
  };

  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  logSuccess(`Created package: ${pkgName}`);
  log(`  Edit: packages/${pkgName}/manifest.json`);
  log(`  Add files to: packages/${pkgName}/`);
}

/** Show help */
function showHelp() {
  log(`
${colors.bright}CP/M Package Manager${colors.reset}

Usage: npx ts-node scripts/cpm-pkg.ts <command> [args]

Commands:
  ${colors.cyan}list${colors.reset}              List all packages
  ${colors.cyan}build${colors.reset} [name]     Build all packages (or specific one)
  ${colors.cyan}clean${colors.reset}             Clean built packages from public/cpm
  ${colors.cyan}init${colors.reset} <name>       Create a new package
  ${colors.cyan}validate${colors.reset}          Validate all package manifests
  ${colors.cyan}help${colors.reset}              Show this help

Package Structure:
  packages/
    my-package/
      manifest.json     Package definition
      source.zip        Optional: source archive
      FILE.COM          Or: loose files

Manifest Example:
  {
    "name": "My Package",
    "version": "1.0",
    "source": "archive.zip",
    "files": [
      { "src": "FILE.COM", "dst": "FILE.COM" }
    ]
  }
`);
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'list':
      cmdList();
      break;
    case 'build':
      await cmdBuild(args[1]);
      break;
    case 'clean':
      cmdClean();
      break;
    case 'init':
      cmdInit(args[1]);
      break;
    case 'validate':
      cmdValidate();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      if (cmd) {
        logError(`Unknown command: ${cmd}`);
      }
      showHelp();
  }
}

main().catch(err => {
  logError(err.message);
  process.exit(1);
});
