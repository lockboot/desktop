# CP/M Packages

This directory contains CP/M software packages for the OS/402 Desktop. Each package is a folder with a `manifest.mf` file and associated binaries.

## Package Structure

```
packages/
  my-package/
    manifest.mf          # Package definition (JSON)
    TOOL.COM             # CP/M binaries
    TOOL.DOC             # Documentation (optional)
    my-package.test.ts   # Tests (optional)
```

## Building Packages

```bash
npm run pkg:list      # List all packages
npm run pkg:build     # Build all → public/cpm/*.zip
npm run pkg:validate  # Validate manifests
npm run pkg:clean     # Remove built packages
```

The build process:
1. Reads each `manifest.mf`
2. Collects specified files (from loose files or source archives)
3. Creates a `.zip` with the files + manifest
4. Generates `public/cpm/packages.json` index

## Manifest Format

`manifest.mf` is a JSON file with the following fields:

```json
{
  "id": "my-package",
  "name": "My Package",
  "version": "1.0",
  "description": "What this package does",
  "outputDir": "my-package",
  "files": [...],
  "meta": {...},
  "actions": [...]
}
```

### Top-Level Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | No | Package identifier (defaults to folder name) |
| `name` | **Yes** | Display name shown in UI |
| `version` | No | Version string |
| `description` | No | Short description |
| `outputDir` | No | Output zip name (defaults to folder name) |
| `source` | No | Source archive to extract from (e.g., `"archive.zip"`) |
| `files` | **Yes** | Array of files to include |
| `meta` | No | Additional metadata |
| `actions` | No | Build/run actions for file types |

### File Entries

```json
{
  "files": [
    { "src": "TOOL.COM" },
    { "src": "TOOL.DOC", "required": false },
    { "src": "oldname.com", "dst": "NEWNAME.COM" },
    { "src": "CCP.COM", "loadAddress": "0xDC00", "type": "shell" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `src` | Source filename (in package dir or archive) |
| `dst` | Destination filename (auto-converted to 8.3 uppercase) |
| `required` | If `false`, missing file won't fail build (default: `true`) |
| `loadAddress` | Memory address for special binaries |
| `type` | File type hint (`"shell"`, etc.) |

### Metadata

```json
{
  "meta": {
    "type": "compiler",
    "shell": "XCCP.COM"
  }
}
```

Common meta fields:
- `type` — Category: `"compiler"`, `"game"`, `"shell"`, `"system"`, `"utilities"`
- `shell` — Filename of shell to use (e.g., `"XCCP.COM"`)

---

## Actions

Actions define how to compile/run files. They appear in the workspace toolbar dropdown when you select a matching file.

### Action Fields

```json
{
  "actions": [
    {
      "id": "turbo3",
      "name": "Turbo Pascal 3",
      "command": "TURBO",
      "patterns": ["*.PAS"],
      "outputExts": ["COM"],
      "submit": "...",
      "interactiveScript": [...]
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | **Yes** | Unique action identifier |
| `name` | **Yes** | Display name in toolbar |
| `command` | **Yes** | CP/M command to run (e.g., `"TURBO"`) |
| `patterns` | **Yes** | File patterns this action handles (e.g., `["*.PAS"]`) |
| `outputExts` | No | Expected output extensions (e.g., `["COM", "HEX"]`) |
| `submit` | No | SUBMIT-style command template |
| `interactiveScript` | No | For menu-driven tools |

### Action Types

#### 1. Simple Command

Just runs the command with the file:

```json
{
  "id": "z1",
  "name": "Z1 (Z80)",
  "command": "Z1",
  "patterns": ["*.AZM"],
  "outputExts": ["COM", "HEX"]
}
```

Runs: `Z1 {filename}`

#### 2. SUBMIT Template

For multi-step builds using a command sequence:

```json
{
  "id": "bdsc",
  "name": "BDS C",
  "command": "CC",
  "patterns": ["*.C"],
  "outputExts": ["COM"],
  "submit": "CC {drive}:{name}\rCLINK {drive}:{name}\r"
}
```

Template variables:
- `{name}` — Base filename without extension (e.g., `HELLO`)
- `{drive}` — Drive letter (e.g., `B`)

The `\r` represents carriage return (Enter key).

#### 3. Interactive Script

For menu-driven tools like Turbo Pascal that require navigating menus:

```json
{
  "id": "turbo3",
  "name": "Turbo Pascal 3",
  "command": "TURBO",
  "patterns": ["*.PAS"],
  "outputExts": ["COM"],
  "interactiveScript": [
    { "wait": "(Y/N)?", "send": "Y" },
    { "wait": "E)dit", "send": "W" },
    { "wait": "Work file name:", "send": "{drive}:{name}.PAS\r" },
    { "wait": "Loading", "send": "O" },
    { "wait": "(Q)uit", "send": "C" },
    { "wait": ")om-file", "send": "Q" },
    { "wait": ">", "send": "C" },
    { "wait": "Compiling", "send": "Q" }
  ]
}
```

Each step:
- `wait` — Text to wait for in console output
- `send` — Text to send when pattern is matched

This automates: start Turbo → select Work file → load file → compile → quit.

---

## Examples

### Minimal Package (Game)

```json
{
  "name": "Zork I",
  "files": [
    { "src": "ZORK1.COM" },
    { "src": "ZORK1.DAT" }
  ],
  "meta": { "type": "game" }
}
```

### Compiler with SUBMIT

```json
{
  "name": "BDS C",
  "files": [
    { "src": "CC.COM" },
    { "src": "CLINK.COM" },
    { "src": "DEFF.CRL" }
  ],
  "meta": { "type": "compiler" },
  "actions": [
    {
      "id": "bdsc",
      "name": "BDS C",
      "command": "CC",
      "patterns": ["*.C"],
      "outputExts": ["COM"],
      "submit": "CC {drive}:{name}\rCLINK {drive}:{name}\r"
    }
  ]
}
```

### Multiple Assemblers

```json
{
  "name": "Assemblers",
  "files": [
    { "src": "Z1.COM" },
    { "src": "Z80MR.COM" },
    { "src": "LASM3.COM" }
  ],
  "actions": [
    {
      "id": "z1",
      "name": "Z1 (Z80)",
      "command": "Z1",
      "patterns": ["*.AZM"],
      "outputExts": ["COM"]
    },
    {
      "id": "lasm3",
      "name": "LASM3 (8080)",
      "command": "LASM3",
      "patterns": ["*.ASM"],
      "outputExts": ["COM"]
    }
  ]
}
```

---

## packages.json

When you run `npm run pkg:build`, it generates `public/cpm/packages.json`:

```json
{
  "packages": [
    { "id": "assemblers", "name": "Assemblers", "description": "Z80 and 8080 assemblers" },
    { "id": "bds-c", "name": "BDS C", "description": "BDS C compiler for CP/M" },
    { "id": "turbo-pascal-3", "name": "Turbo Pascal 3", "description": "Borland Turbo Pascal 3.0" }
  ]
}
```

The workspace uses this to show available packages in the "Add Package" dialog.

---

## Existing Packages

| Package | Type | Description |
|---------|------|-------------|
| `cpm22` | system | CP/M 2.2 userland (ASM, LOAD, DDT, etc.) |
| `xccp` | shell | Extended CCP shell + utilities |
| `assemblers` | development | Z1, Z80MR, LASM3, ZASM |
| `turbo-pascal-3` | compiler | Borland Turbo Pascal 3.0 |
| `pascal-mt` | compiler | Pascal MT+ 5.6 |
| `bds-c` | compiler | BDS C 1.60 |
| `cbasic` | compiler | CBASIC 2.0 |
| `utilities` | utilities | MAKE, PMAKE, etc. |
| `zork` | game | Zork I text adventure |
