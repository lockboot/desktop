/**
 * Workspace Manager - Unified CP/M development environment.
 *
 * Features:
 * - Configurable drives with packages and optional writable layer
 * - File browser with tree view
 * - Editor for direct file editing
 * - Terminal spawning (shares workspace)
 * - Build/Run for CP/M programs
 * - Export drives as ZIP
 */

import type { Desktop } from '../desktop';
import { Terminal } from '../cpm';
import type { CpmExitInfo } from '../cpm';
import {
  CpmWorkspace,
  MergedWorkspaceFS,
  PackageDriveFS,
  fetchAvailablePackages,
  loadPackageFromUrl,
} from '../cpm/workspace';
import type { PackageAction } from '../cpm/workspace';

let workspaceCount = 0;

// CSS styles for the workspace manager - Win3.11/Win95 retro theme
const STYLES = `
  .ws-container { display: flex; flex-direction: column; height: 100%; background: #c0c0c0; font-family: "MS Sans Serif", "Segoe UI", Tahoma, sans-serif; font-size: 11px; color: #000; }
  .ws-toolbar-group { display: flex; align-items: center; gap: 2px; }
  .ws-btn { padding: 2px 8px; background: #c0c0c0; color: #000; border-width: 2px; border-style: solid; border-color: #fff #808080 #808080 #fff; cursor: pointer; font-size: 11px; font-family: inherit; }
  .ws-btn:hover { background: #d4d4d4; }
  .ws-btn:active { border-color: #808080 #fff #fff #808080; }
  .ws-btn:disabled { color: #808080; text-shadow: 1px 1px #fff; }
  .ws-btn-primary { background: #000080; color: #fff; border-color: #0000c0 #000040 #000040 #0000c0; }
  .ws-btn-primary:hover { background: #0000a0; }
  .ws-btn-primary:active { border-color: #000040 #0000c0 #0000c0 #000040; }
  .ws-btn-success { background: #008000; color: #fff; border-color: #00c000 #004000 #004000 #00c000; }
  .ws-btn-success:hover { background: #00a000; }
  .ws-btn-success:active { border-color: #004000 #00c000 #00c000 #004000; }
  .ws-main { display: flex; flex: 1; overflow: hidden; }
  .ws-sidebar { width: 130px; background: #fff; border-right: 1px solid #808080; display: flex; flex-direction: column; overflow: hidden; }
  .ws-sidebar-header { display: flex; align-items: center; padding: 2px 4px; background: #000080; color: #fff; font-size: 11px; font-weight: bold; }
  .ws-sidebar-title { flex: 1; }
  .ws-sidebar-btn { color: #aaf; font-weight: bold; padding: 0 4px; cursor: pointer; }
  .ws-sidebar-btn:hover { color: #fff; }
  .ws-file-tree { flex: 1; overflow: auto; font-size: 11px; background: #fff; }
  .ws-tree-drive { }
  .ws-tree-drive-header { display: flex; align-items: center; gap: 2px; padding: 2px 3px; background: #c0c0c0; border-bottom: 1px solid #808080; cursor: pointer; user-select: none; color: #000; }
  .ws-tree-drive-header:hover { background: #d0d0d0; }
  .ws-tree-drive-header.dragover { background: #000080; color: #fff; }
  .ws-tree-drive-letter { font-weight: bold; color: #000080; }
  .ws-tree-drive-type { color: #808080; font-size: 10px; }
  .ws-tree-drive-count { color: #808080; font-size: 10px; margin-left: 4px; }
  .ws-tree-drive-spacer { flex: 1; }
  .ws-tree-drive-btn { font-weight: bold; padding: 0 2px; cursor: pointer; }
  .ws-tree-drive-btn.add { color: #008; }
  .ws-tree-drive-btn.add:hover { color: #00f; }
  .ws-tree-drive-btn.remove { color: #800; }
  .ws-tree-drive-btn.remove:hover { color: #f00; }
  .ws-tree-drive-btn.save { color: #040; }
  .ws-tree-drive-btn.save:hover { color: #080; }
  .ws-tree-layers { background: #fff; }
  .ws-tree-layer { }
  .ws-tree-layer-header { display: flex; align-items: center; gap: 2px; padding: 1px 2px 1px 8px; background: #e8e8e8; border-bottom: 1px solid #d0d0d0; cursor: pointer; user-select: none; color: #000; font-size: 10px; }
  .ws-tree-layer-header:hover { background: #d8d8d8; }
  .ws-tree-layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .ws-tree-layer-btn { color: #008; font-weight: bold; padding: 0 2px; cursor: pointer; }
  .ws-tree-layer-btn:hover { color: #00f; }
  .ws-tree-layer-btn.remove { color: #800; }
  .ws-tree-layer-btn.remove:hover { color: #f00; }
  .ws-tree-files { background: #fff; }
  .ws-tree-file { display: flex; align-items: center; padding: 1px 2px 1px 16px; cursor: pointer; color: #000; }
  .ws-tree-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ws-tree-file-remove { font-weight: bold; padding: 0 2px; cursor: pointer; display: none; font-size: 10px; color: #fcc; }
  .ws-tree-file:hover .ws-tree-file-remove { display: inline; }
  .ws-tree-file:hover .ws-tree-file-remove:hover { color: #f66; }
  .ws-tree-file:hover { background: #000080; color: #fff; }
  .ws-tree-file.selected { background: #000080; color: #fff; }
  .ws-tree-file.selected .ws-tree-file-remove { display: inline; color: #fcc; }
  .ws-tree-file.selected .ws-tree-file-remove:hover { color: #f66; }
  .ws-tree-file.readonly { color: #808080; }
  .ws-tree-file.readonly:hover { background: #000080; color: #c0c0c0; }
  .ws-editor-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fff; }
  .ws-editor-toolbar { display: flex; align-items: center; gap: 4px; padding: 2px 4px; background: #c0c0c0; border-bottom: 1px solid #808080; }
  .ws-editor-path { flex: 1; font-size: 11px; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ws-editor { flex: 1; padding: 4px; background: #fff; color: #000; border: none; outline: none; font-family: "Fixedsys", "Courier New", monospace; font-size: 12px; line-height: 1.3; resize: none; white-space: pre; overflow: auto; tab-size: 8; }
  .ws-tool-select { padding: 1px 2px; background: #fff; border-width: 2px; border-style: solid; border-color: #808080 #fff #fff #808080; font-size: 11px; font-family: inherit; max-width: 120px; }
  .ws-modal-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .ws-modal { background: #c0c0c0; border-width: 2px; border-style: solid; border-color: #fff #808080 #808080 #fff; padding: 8px; min-width: 220px; color: #000; }
  .ws-modal h3 { margin: 0 0 8px 0; font-size: 11px; color: #000; font-weight: bold; }
  .ws-modal label { display: block; margin-bottom: 6px; color: #000; font-size: 11px; }
  .ws-modal p { color: #000; }
  .ws-modal select, .ws-modal input { width: 100%; padding: 2px; background: #fff; border-width: 2px; border-style: solid; border-color: #808080 #fff #fff #808080; color: #000; font-size: 11px; margin-top: 2px; box-sizing: border-box; font-family: inherit; }
  .ws-modal-btns { display: flex; gap: 4px; margin-top: 12px; justify-content: center; }
`;

/**
 * Register Workspace Manager with the desktop taskbar.
 */
export function registerWorkspaceManager(desktop: Desktop): void {
  desktop.taskbar.addItem('background:#1e1e1e;border:1px solid #4fc3f7', 'Workspace', async () => {
    workspaceCount++;

    const windowId = desktop.wm.create({
      title: `Workspace ${workspaceCount}`,
      app: 'system.workspace',
      appName: 'Workspace',
      width: 535,
      height: 325,
      icon: 'background:#1e1e1e;border:1px solid #4fc3f7'
    });

    const content = desktop.wm.getContent(windowId);
    if (!content) return;

    // Inject styles
    if (!document.getElementById('ws-styles')) {
      const style = document.createElement('style');
      style.id = 'ws-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    // Create workspace
    const workspace = new CpmWorkspace('./cpm');

    // State
    let currentFile: { drive: string; name: string } | null = null;
    let isDirty = false;

    // Track which drives/layers are expanded (default: collapsed)
    const expandedDrives = new Set<string>();
    const expandedLayers = new Set<string>(); // "A:pkgname" format

    // Create container
    const container = document.createElement('div');
    container.className = 'ws-container';

    // =====================================================================
    // MAIN AREA
    // =====================================================================
    const main = document.createElement('div');
    main.className = 'ws-main';

    // Sidebar (file browser)
    const sidebar = document.createElement('div');
    sidebar.className = 'ws-sidebar';

    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'ws-sidebar-header';

    const sidebarTitle = document.createElement('span');
    sidebarTitle.className = 'ws-sidebar-title';
    sidebarTitle.textContent = 'STORAGE';
    sidebarHeader.appendChild(sidebarTitle);

    const refreshBtn = document.createElement('span');
    refreshBtn.className = 'ws-sidebar-btn';
    refreshBtn.textContent = '↻';
    refreshBtn.title = 'Refresh';
    refreshBtn.onclick = () => updateFileTree();
    sidebarHeader.appendChild(refreshBtn);

    const addDriveBtn = document.createElement('span');
    addDriveBtn.className = 'ws-sidebar-btn';
    addDriveBtn.textContent = '+';
    addDriveBtn.title = 'Add drive';
    addDriveBtn.onclick = () => showAddDriveModal();
    sidebarHeader.appendChild(addDriveBtn);

    sidebar.appendChild(sidebarHeader);

    const fileTree = document.createElement('div');
    fileTree.className = 'ws-file-tree';
    sidebar.appendChild(fileTree);

    main.appendChild(sidebar);

    // Editor area
    const editorArea = document.createElement('div');
    editorArea.className = 'ws-editor-area';

    // Top toolbar: filename + Term button
    const editorToolbar = document.createElement('div');
    editorToolbar.className = 'ws-editor-toolbar';

    const editorPath = document.createElement('span');
    editorPath.className = 'ws-editor-path';
    editorPath.textContent = 'No file selected';
    editorToolbar.appendChild(editorPath);

    // Terminal button
    const termBtn = document.createElement('button');
    termBtn.className = 'ws-btn ws-btn-primary';
    termBtn.textContent = 'Term';
    termBtn.title = 'Open terminal';
    termBtn.onclick = () => spawnTerminal();
    editorToolbar.appendChild(termBtn);

    editorArea.appendChild(editorToolbar);

    const editor = document.createElement('textarea');
    editor.className = 'ws-editor';
    editor.spellcheck = false;
    editor.placeholder = 'Select a file from the explorer or create a new file...';
    editor.disabled = true;
    editorArea.appendChild(editor);

    // Bottom toolbar: spacer + compiler dropdown + B + R buttons (right-aligned)
    const buildToolbar = document.createElement('div');
    buildToolbar.className = 'ws-editor-toolbar';

    // Spacer (pushes everything to the right)
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    buildToolbar.appendChild(spacer);

    // Compiler/tool selector
    const toolSelect = document.createElement('select');
    toolSelect.className = 'ws-tool-select';
    toolSelect.title = 'Build tool';
    buildToolbar.appendChild(toolSelect);

    // Build button - runs build in terminal
    const buildBtn = document.createElement('button');
    buildBtn.className = 'ws-btn';
    buildBtn.textContent = '▶';
    buildBtn.title = 'Build (opens terminal)';
    buildBtn.onclick = () => buildInTerminal();
    buildToolbar.appendChild(buildBtn);

    // Term button - opens shell with tool packages
    const toolTermBtn = document.createElement('button');
    toolTermBtn.className = 'ws-btn';
    toolTermBtn.textContent = 'T';
    toolTermBtn.title = 'Open terminal with tool';
    toolTermBtn.onclick = () => openToolTerminal();
    buildToolbar.appendChild(toolTermBtn);

    editorArea.appendChild(buildToolbar);

    main.appendChild(editorArea);
    container.appendChild(main);

    content.appendChild(container);

    // =====================================================================
    // HELPER FUNCTIONS
    // =====================================================================

    function log(msg: string): void {
      console.log(`[Workspace ${workspaceCount}] ${msg}`);
    }

    function formatSize(bytes: number): string {
      if (bytes < 1024) return `${bytes}b`;
      if (bytes < 1024 * 1024) {
        const kb = bytes / 1024;
        return kb >= 10 ? `${Math.round(kb)}kb` : `${kb.toFixed(1)}kb`;
      }
      const mb = bytes / (1024 * 1024);
      return mb >= 10 ? `${Math.round(mb)}mb` : `${mb.toFixed(1)}mb`;
    }

    function updateFileTree(): void {
      fileTree.innerHTML = '';

      for (const config of workspace.listDriveConfigs()) {
        const driveEl = document.createElement('div');
        driveEl.className = 'ws-tree-drive';

        const header = document.createElement('div');
        header.className = 'ws-tree-drive-header';

        const letterSpan = document.createElement('span');
        letterSpan.className = 'ws-tree-drive-letter';
        letterSpan.textContent = `${config.letter}:`;
        header.appendChild(letterSpan);

        // Calculate file count and total size
        const files = workspace.listFiles(config.letter);
        let totalBytes = 0;
        for (const fname of files) {
          const content = workspace.readFile(config.letter, fname);
          if (content) totalBytes += content.length;
        }

        const countSpan = document.createElement('span');
        countSpan.className = 'ws-tree-drive-count';
        countSpan.textContent = `${files.length} (${formatSize(totalBytes)})`;
        header.appendChild(countSpan);

        // Spacer pushes buttons to the right
        const spacer = document.createElement('span');
        spacer.className = 'ws-tree-drive-spacer';
        header.appendChild(spacer);

        // Add button - shows dialog to add package or enable writable layer
        const addBtn = document.createElement('span');
        addBtn.className = 'ws-tree-drive-btn add';
        addBtn.textContent = '+';
        addBtn.title = 'Add package or enable writable layer';
        addBtn.onclick = (e) => {
          e.stopPropagation();
          showDriveAddDialog(config.letter);
        };
        header.appendChild(addBtn);

        // Save button for writable drives
        if (config.writable) {
          const saveBtn = document.createElement('span');
          saveBtn.className = 'ws-tree-drive-btn save';
          saveBtn.textContent = '⬇';
          saveBtn.title = `Export ${config.letter}: as ZIP`;
          saveBtn.onclick = (e) => {
            e.stopPropagation();
            exportDriveToZip(config.letter);
          };
          header.appendChild(saveBtn);
        }

        // Remove drive button
        const removeBtn = document.createElement('span');
        removeBtn.className = 'ws-tree-drive-btn remove';
        removeBtn.textContent = '−';
        removeBtn.title = `Remove ${config.letter}: drive`;
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Remove drive ${config.letter}:? All files will be lost.`)) {
            // Close any open file from this drive
            if (currentFile?.drive === config.letter) {
              currentFile = null;
              editor.value = '';
              editor.disabled = true;
              editorPath.textContent = 'No file selected';
              isDirty = false;
            }
            workspace.unmount(config.letter);
            updateFileTree();
          }
        };
        header.appendChild(removeBtn);

        const layersContainer = document.createElement('div');
        layersContainer.className = 'ws-tree-layers';
        layersContainer.style.display = expandedDrives.has(config.letter) ? 'block' : 'none';

        header.onclick = (e) => {
          if ((e.target as HTMLElement).closest('.ws-tree-drive-btn')) return;
          if (expandedDrives.has(config.letter)) {
            expandedDrives.delete(config.letter);
            layersContainer.style.display = 'none';
          } else {
            expandedDrives.add(config.letter);
            layersContainer.style.display = 'block';
          }
        };

        // Drag & drop for zip files (adds as package layer)
        header.addEventListener('dragover', (e) => {
          e.preventDefault();
          header.classList.add('dragover');
        });
        header.addEventListener('dragleave', () => {
          header.classList.remove('dragover');
        });
        header.addEventListener('drop', async (e) => {
          e.preventDefault();
          header.classList.remove('dragover');
          const file = e.dataTransfer?.files[0];
          if (file && file.name.endsWith('.zip')) {
            await handleDroppedZip(config.letter, file);
          }
        });

        driveEl.appendChild(header);

        // Get layers for this drive
        const layers = workspace.getDriveLayers(config.letter);
        const writableFiles = workspace.getWritableFiles(config.letter);

        for (const layer of layers) {
          const layerEl = document.createElement('div');
          layerEl.className = 'ws-tree-layer';

          const layerHeader = document.createElement('div');
          layerHeader.className = 'ws-tree-layer-header';

          const layerName = document.createElement('span');
          layerName.className = 'ws-tree-layer-name';
          layerName.textContent = layer.name;
          layerName.title = `${layer.files.length} files`;
          layerHeader.appendChild(layerName);

          // Determine if this is a writable layer
          const isWritableLayer = layer.name === '[files]';

          // Add file button for writable layers
          if (isWritableLayer) {
            const addBtn = document.createElement('span');
            addBtn.className = 'ws-tree-layer-btn';
            addBtn.textContent = '+';
            addBtn.title = 'Add file';
            addBtn.onclick = (e) => {
              e.stopPropagation();
              const name = prompt('File name (e.g., HELLO.ASM):');
              if (name) {
                const upperName = name.toUpperCase();
                workspace.writeFile(config.letter, upperName, new Uint8Array());
                updateFileTree();
                openFile(config.letter, upperName);
                log(`Created ${config.letter}:${upperName}`);
              }
            };
            layerHeader.appendChild(addBtn);
          }

          // Remove button for removable package layers
          if (layer.removable) {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'ws-tree-layer-btn remove';
            removeBtn.textContent = '−';
            removeBtn.title = `Remove ${layer.name}`;
            removeBtn.onclick = (e) => {
              e.stopPropagation();
              if (confirm(`Remove ${layer.name} from ${config.letter}:?`)) {
                workspace.removePackageFromDrive(config.letter, layer.name);
                updateFileTree();
                                log(`Removed ${layer.name}`);
              }
            };
            layerHeader.appendChild(removeBtn);
          }

          const layerFiles = document.createElement('div');
          layerFiles.className = 'ws-tree-files';
          const layerKey = `${config.letter}:${layer.name}`;
          layerFiles.style.display = expandedLayers.has(layerKey) ? 'block' : 'none';

          layerHeader.onclick = (e) => {
            if ((e.target as HTMLElement).closest('.ws-tree-layer-btn')) return;
            if (expandedLayers.has(layerKey)) {
              expandedLayers.delete(layerKey);
              layerFiles.style.display = 'none';
            } else {
              expandedLayers.add(layerKey);
              layerFiles.style.display = 'block';
            }
          };

          layerEl.appendChild(layerHeader);

          for (const name of layer.files) {
            const fileEl = document.createElement('div');
            fileEl.className = 'ws-tree-file';

            // Mark as readonly if not in writable files
            const isWritable = writableFiles.has(name);
            if (!isWritable) {
              fileEl.classList.add('readonly');
            }

            const fileName = document.createElement('span');
            fileName.className = 'ws-tree-file-name';
            fileName.textContent = name;
            fileEl.appendChild(fileName);

            // Delete button for writable files
            if (isWritable) {
              const deleteBtn = document.createElement('span');
              deleteBtn.className = 'ws-tree-file-remove';
              deleteBtn.textContent = '−';
              deleteBtn.title = 'Delete file';
              deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`Delete ${config.letter}:${name}?`)) {
                  const driveFs = workspace.drive(config.letter);
                  if (driveFs) {
                    driveFs.deleteFile(name);
                    if (currentFile?.drive === config.letter && currentFile?.name === name) {
                      currentFile = null;
                      editor.value = '';
                      editor.disabled = true;
                      editorPath.textContent = 'No file selected';
                    }
                    updateFileTree();
                    log(`Deleted ${config.letter}:${name}`);
                  }
                }
              };
              fileEl.appendChild(deleteBtn);
            }

            fileEl.onclick = (e) => {
              if ((e.target as HTMLElement).closest('.ws-tree-file-remove')) return;
              openFile(config.letter, name);
            };

            if (currentFile?.drive === config.letter && currentFile?.name === name) {
              fileEl.classList.add('selected');
            }

            layerFiles.appendChild(fileEl);
          }

          layerEl.appendChild(layerFiles);
          layersContainer.appendChild(layerEl);
        }

        // Show (empty) indicator for empty drives
        if (layers.length === 0) {
          const emptyLayer = document.createElement('div');
          emptyLayer.className = 'ws-tree-layer-header';
          emptyLayer.style.fontStyle = 'italic';

          const emptyName = document.createElement('span');
          emptyName.className = 'ws-tree-layer-name';
          emptyName.textContent = '(empty)';
          emptyLayer.appendChild(emptyName);

          // Add file button only for writable drives
          if (config.writable) {
            const addBtn = document.createElement('span');
            addBtn.className = 'ws-tree-layer-btn';
            addBtn.textContent = '+';
            addBtn.title = 'Add file';
            addBtn.onclick = (e) => {
              e.stopPropagation();
              const name = prompt('File name (e.g., HELLO.ASM):');
              if (name) {
                const upperName = name.toUpperCase();
                workspace.writeFile(config.letter, upperName, new Uint8Array());
                updateFileTree();
                openFile(config.letter, upperName);
                log(`Created ${config.letter}:${upperName}`);
              }
            };
            emptyLayer.appendChild(addBtn);
          }

          layersContainer.appendChild(emptyLayer);
        }

        driveEl.appendChild(layersContainer);
        fileTree.appendChild(driveEl);
      }
    }

    async function handleDroppedZip(letter: string, file: File): Promise<void> {
      log(`Loading ${file.name}...`);
      try {
        const data = await file.arrayBuffer();
        const { loadPackages, PackageDriveFS, OverlayDriveFS } = await import('../cpm/package-loader');
        const packages = await loadPackages(data);

        if (packages.length === 0) {
          log('No packages found in zip');
          return;
        }

        // Get the drive filesystem and find the base PackageDriveFS
        const driveFs = workspace.drive(letter);
        const config = workspace.getDriveConfig(letter);
        if (!driveFs || !config) {
          log(`Drive ${letter}: not found`);
          return;
        }

        let baseFs: InstanceType<typeof PackageDriveFS>;
        if (config.writable) {
          baseFs = (driveFs as InstanceType<typeof OverlayDriveFS>).getBase() as InstanceType<typeof PackageDriveFS>;
        } else {
          baseFs = driveFs as InstanceType<typeof PackageDriveFS>;
        }

        // Add each package
        const existingPkgs = baseFs.getPackages();
        let addedCount = 0;
        for (const pkg of packages) {
          // Check if already loaded
          if (existingPkgs.some((p: { manifest: { name: string } }) => p.manifest.name === pkg.manifest.name)) {
            log(`${pkg.manifest.name} already loaded, skipping`);
            continue;
          }

          baseFs.addPackage(pkg);

          // Update config
          if (!config.packages.includes(pkg.manifest.name)) {
            config.packages.push(pkg.manifest.name);
          }
          addedCount++;
          log(`Added ${pkg.manifest.name} (${pkg.files.size} files)`);
        }

        updateFileTree();
        if (packages.length > 1) {
          log(`Loaded ${addedCount} packages from ${file.name}`);
        }
      } catch (err) {
        log(`Error: ${err instanceof Error ? err.message : err}`);
      }
    }

    function openFile(drive: string, name: string): void {
      // Save current file if dirty
      if (isDirty && currentFile) {
        saveCurrentFile();
      }

      const content = workspace.readFile(drive, name);
      if (!content) {
        log(`Error: Could not read ${drive}:${name}`);
        return;
      }

      currentFile = { drive, name };
      isDirty = false;

      // Decode content
      const text = new TextDecoder().decode(content);
      // Remove CP/M EOF marker and convert line endings
      editor.value = text.replace(/\x1A.*$/, '').replace(/\r\n/g, '\n');
      editor.disabled = !workspace.isDriveWritable(drive);

      editorPath.textContent = `${drive}:${name}`;
      updateToolDropdown(name);
      updateFileTree();
      log(`Opened ${drive}:${name}`);
    }

    /** Update tool dropdown based on file extension */
    function updateToolDropdown(filename: string): void {
      // Get actions that match this file from mounted packages
      const matchingActions = workspace.getActionsForFile(filename);

      if (matchingActions.length === 0) {
        // No matching tools for this file type
        toolSelect.innerHTML = '<option value="">No tools</option>';
      } else {
        toolSelect.innerHTML = matchingActions
          .map(a => `<option value="${a.id}">${a.name}</option>`)
          .join('');
      }
    }

    /** Get the currently selected action */
    function getSelectedAction(): PackageAction | undefined {
      const selectedId = toolSelect.value;
      const allActions = workspace.getAllActions();
      return allActions.find(a => a.id === selectedId);
    }

    function saveCurrentFile(): void {
      if (!currentFile || !isDirty) return;

      const { drive, name } = currentFile;
      if (!workspace.isDriveWritable(drive)) {
        log(`Cannot save: ${drive}: is read-only`);
        return;
      }

      // Convert to CP/M format
      const text = editor.value.replace(/\r?\n/g, '\r\n') + '\x1A';
      workspace.writeFile(drive, name, new TextEncoder().encode(text));
      isDirty = false;
      log(`Saved ${drive}:${name}`);
      updateFileTree();
    }

    async function exportDriveToZip(letter: string): Promise<void> {
      const config = workspace.getDriveConfig(letter);
      if (!config) return;

      // For writable drives with packages and user files, ask what to export
      if (config.writable && config.packages.length > 0 && workspace.hasWritableContent(letter)) {
        showExportDialog(letter);
        return;
      }

      // For other drives, just export everything
      try {
        const blob = await workspace.exportDrive(letter);
        downloadBlob(blob, `drive-${letter.toLowerCase()}.zip`);
        log(`Exported ${letter}: drive`);
      } catch (err) {
        log(`Export error: ${err instanceof Error ? err.message : err}`);
      }
    }

    function downloadBlob(blob: Blob, filename: string): void {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    function showExportDialog(letter: string): void {
      const overlay = document.createElement('div');
      overlay.className = 'ws-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'ws-modal';
      modal.innerHTML = `
        <h3>Export ${letter}: Drive</h3>
        <p style="margin:8px 0;font-size:11px;">What would you like to export?</p>
        <div class="ws-modal-btns" style="flex-direction:column;gap:6px;">
          <button class="ws-btn" id="export-overlay" style="width:100%;">Overlay Only (your files)</button>
          <button class="ws-btn" id="export-all" style="width:100%;">Everything (all layers)</button>
          <button class="ws-btn" id="export-cancel" style="width:100%;">Cancel</button>
        </div>
      `;

      overlay.appendChild(modal);
      container.appendChild(overlay);

      modal.querySelector('#export-overlay')!.addEventListener('click', async () => {
        overlay.remove();
        try {
          const blob = await workspace.exportOverlay(letter);
          downloadBlob(blob, `drive-${letter.toLowerCase()}-overlay.zip`);
          log(`Exported ${letter}: overlay`);
        } catch (err) {
          log(`Export error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#export-all')!.addEventListener('click', async () => {
        overlay.remove();
        try {
          const blob = await workspace.exportDrive(letter);
          downloadBlob(blob, `drive-${letter.toLowerCase()}.zip`);
          log(`Exported ${letter}: drive`);
        } catch (err) {
          log(`Export error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#export-cancel')!.addEventListener('click', () => overlay.remove());
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    async function showDriveAddDialog(letter: string): Promise<void> {
      const config = workspace.getDriveConfig(letter);
      if (!config) return;

      const overlay = document.createElement('div');
      overlay.className = 'ws-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'ws-modal';

      // Build options based on current drive state
      let optionsHtml = '';

      // Option to enable writable layer if not already writable
      if (!config.writable) {
        optionsHtml += `<button class="ws-btn" id="add-writable" style="width:100%;margin-bottom:4px;">Enable [files] layer</button>`;
      }

      modal.innerHTML = `
        <h3>Add to ${letter}:</h3>
        ${optionsHtml}
        <label>
          Package
          <select id="pkg-select">
            <option value="">Loading...</option>
          </select>
        </label>
        <div id="drop-zone" style="margin:8px 0;padding:12px;border:2px dashed #808080;text-align:center;font-size:10px;color:#666;cursor:pointer;">
          Drop .zip here or <span style="color:#008;text-decoration:underline;">browse</span>
        </div>
        <input type="file" id="zip-input" accept=".zip" style="display:none;">
        <div class="ws-modal-btns">
          <button class="ws-btn" id="add-cancel">Cancel</button>
        </div>
      `;

      overlay.appendChild(modal);
      container.appendChild(overlay);

      // Handle enable writable layer
      const writableBtn = modal.querySelector('#add-writable');
      if (writableBtn) {
        writableBtn.addEventListener('click', async () => {
          overlay.remove();
          try {
            await workspace.enableWritableLayer(letter);
            updateFileTree();
            log(`Enabled writable layer on ${letter}:`);
          } catch (err) {
            log(`Error: ${err instanceof Error ? err.message : err}`);
          }
        });
      }

      // Handle zip file (drag-drop or browse)
      const dropZone = modal.querySelector('#drop-zone') as HTMLElement;
      const zipInput = modal.querySelector('#zip-input') as HTMLInputElement;

      const handleZipFile = async (file: File) => {
        if (!file.name.endsWith('.zip')) {
          log('Please select a .zip file');
          return;
        }
        overlay.remove();
        await handleDroppedZip(letter, file);
      };

      dropZone.addEventListener('click', () => zipInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#000080';
        dropZone.style.background = '#e0e0ff';
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#808080';
        dropZone.style.background = '';
      });

      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#808080';
        dropZone.style.background = '';
        const file = e.dataTransfer?.files[0];
        if (file) await handleZipFile(file);
      });

      zipInput.addEventListener('change', async () => {
        const file = zipInput.files?.[0];
        if (file) await handleZipFile(file);
      });

      const pkgSelect = modal.querySelector('#pkg-select') as HTMLSelectElement;

      // Load available packages dynamically
      try {
        const packages = await fetchAvailablePackages('./cpm');
        const loadedPkgs = config.packages || [];
        const available = packages.filter(p => !loadedPkgs.includes(p.id));

        pkgSelect.innerHTML = `<option value="">Select package...</option>` +
          available.map(p => `<option value="${p.id}">${p.id} - ${p.name}</option>`).join('');
      } catch {
        pkgSelect.innerHTML = `<option value="">Failed to load</option>`;
      }

      pkgSelect.addEventListener('change', async () => {
        const pkgName = pkgSelect.value;
        if (!pkgName) return;

        overlay.remove();
        log(`Loading ${pkgName}...`);
        try {
          await workspace.addPackageToDrive(letter, pkgName);
          updateFileTree();
          log(`Added ${pkgName} to ${letter}:`);
        } catch (err) {
          log(`Error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#add-cancel')!.addEventListener('click', () => overlay.remove());
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    function showAddDriveModal(): void {
      const overlay = document.createElement('div');
      overlay.className = 'ws-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'ws-modal';
      modal.innerHTML = `
        <h3>Add Drive</h3>
        <label>
          Drive Letter
          <select id="add-drive-letter">
            ${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']
              .filter(l => !workspace.getDriveConfig(l))
              .map(l => `<option value="${l}">${l}:</option>`)
              .join('')}
          </select>
        </label>
        <div class="ws-modal-btns">
          <button class="ws-btn" id="add-drive-cancel">Cancel</button>
          <button class="ws-btn ws-btn-primary" id="add-drive-ok">Add</button>
        </div>
      `;

      overlay.appendChild(modal);
      container.appendChild(overlay);

      const letterSelect = modal.querySelector('#add-drive-letter') as HTMLSelectElement;

      modal.querySelector('#add-drive-cancel')!.addEventListener('click', () => overlay.remove());
      modal.querySelector('#add-drive-ok')!.addEventListener('click', async () => {
        const letter = letterSelect.value;

        try {
          // Create an empty drive (no packages, not writable)
          // User can add packages or enable writable layer via + button
          await workspace.configureDrive({ letter, packages: [], writable: false });
          updateFileTree();
        } catch (err) {
          log(`Error: ${err instanceof Error ? err.message : err}`);
        }
        overlay.remove();
      });

      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    async function spawnTerminal(): Promise<void> {
      log('Opening terminal...');

      const termWindowId = desktop.wm.create({
        title: `Workspace ${workspaceCount} Terminal`,
        app: 'system.cpm',
        appName: 'CP/M',
        width: 660,
        height: 420,
        icon: 'background:#000;border:1px solid #0f0'
      });

      const termContent = desktop.wm.getContent(termWindowId);
      if (!termContent) return;

      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        fontSize: 14,
        fgColor: '#00ff41',
        bgColor: '#000000'
      });
      termContent.appendChild(terminal.element);

      // Focus handling
      const termWin = document.getElementById(termWindowId)!;
      termContent.addEventListener('click', () => terminal.focus());
      termContent.addEventListener('mousedown', () => terminal.focus());
      termWin.addEventListener('mousedown', () => requestAnimationFrame(() => terminal.focus()));

      // Show workspace info
      terminal.writeString('Workspace Terminal\r\n');
      terminal.writeString('==================\r\n');
      for (const config of workspace.listDriveConfigs()) {
        const mode = config.writable ? 'rw' : 'ro';
        terminal.writeString(`${config.letter}: (${mode}) - ${workspace.listFiles(config.letter).length} files\r\n`);
      }
      terminal.writeString('\r\n');

      // Find shell from mounted packages
      const shellInfo = workspace.findShell();
      if (!shellInfo) {
        terminal.writeString('Error: No shell found in mounted packages.\r\n');
        terminal.writeString('Make sure a package with shell metadata is loaded.\r\n');
        terminal.writeString('(e.g., cpm22 with CCP.COM or xccp with XCCP.COM)\r\n');
        log('Terminal error: no shell');
        return;
      }

      terminal.writeString(`Shell: ${shellInfo.drive}:${shellInfo.filename} from "${shellInfo.packageName}"\r\n`);

      const cpm = workspace.createEmulator(terminal, {
        shellBinary: shellInfo.binary,
        shellAddress: shellInfo.loadAddress,
        onExit: (info: CpmExitInfo) => {
          terminal.writeString('\r\n');
          terminal.writeString(`[${info.message}]\r\n`);
        }
      });

      cpm.syscallTrace = false;
      terminal.focus();
      cpm.run().catch(err => {
        terminal.writeString(`\r\nError: ${err.message}\r\n`);
      });

      log('Terminal opened');
    }

    /** Build current file in a terminal window */
    async function buildInTerminal(): Promise<void> {
      if (!currentFile) {
        log('No file selected');
        return;
      }

      // Save first
      saveCurrentFile();

      const { drive, name } = currentFile;
      const baseName = name.replace(/\.[^.]+$/, '');

      // Get selected action from dropdown
      const action = getSelectedAction();
      if (!action) {
        log('No tool selected');
        return;
      }

      const toolPkg = action.package;

      log(`Building ${name} with ${action.name}...`);

      // Create terminal window
      const termWindowId = desktop.wm.create({
        title: `Build: ${name}`,
        app: 'system.cpm',
        appName: 'CP/M',
        width: 660,
        height: 420,
        icon: 'background:#000;border:1px solid #0f0'
      });

      const termContent = desktop.wm.getContent(termWindowId);
      if (!termContent) return;

      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        fontSize: 14,
        fgColor: '#00ff41',
        bgColor: '#000000'
      });
      termContent.appendChild(terminal.element);

      const termWin = document.getElementById(termWindowId)!;
      termContent.addEventListener('click', () => terminal.focus());
      termWin.addEventListener('mousedown', () => requestAnimationFrame(() => terminal.focus()));

      // Check if tool package is already mounted on any drive
      let toolDriveLetter = '';
      if (toolPkg) {
        for (const config of workspace.listDriveConfigs()) {
          if (config.packages.includes(toolPkg)) {
            toolDriveLetter = config.letter;
            break;
          }
        }
      }

      // Find an unused drive letter for temp tool drive if needed
      let tempDriveLetter = '';
      if (toolPkg && !toolDriveLetter) {
        const usedLetters = new Set(workspace.listDriveConfigs().map(c => c.letter));
        for (const letter of 'CDEFGHIJKLMNOP') {
          if (!usedLetters.has(letter)) {
            tempDriveLetter = letter;
            break;
          }
        }
      }

      // Create merged FS with temp tool drive if needed
      let mergedFS: MergedWorkspaceFS | null = null;
      if (tempDriveLetter && toolPkg) {
        const pkgUrl = `./cpm/${toolPkg}.zip`;
        try {
          const pkg = await loadPackageFromUrl(pkgUrl);
          const toolDriveFS = new PackageDriveFS([pkg]);
          mergedFS = new MergedWorkspaceFS(workspace.getVirtualFS());
          mergedFS.addDrive(tempDriveLetter, toolDriveFS);
          toolDriveLetter = tempDriveLetter;
        } catch (err) {
          terminal.writeString(`Warning: Could not load ${toolPkg}: ${err}\r\n`);
        }
      }

      // Show build info
      terminal.writeString(`Building ${drive}:${name} with ${action.name}\r\n`);
      for (const config of workspace.listDriveConfigs()) {
        const mode = config.writable ? 'rw' : 'ro';
        terminal.writeString(`${config.letter}: (${mode}) - ${workspace.listFiles(config.letter).length} files\r\n`);
      }
      if (tempDriveLetter && mergedFS) {
        terminal.writeString(`${tempDriveLetter}: (tmp) - ${action.name}\r\n`);
      }
      terminal.writeString('\r\n');

      // Find shell from mounted packages
      const shellInfo = workspace.findShell();
      if (!shellInfo) {
        terminal.writeString('Error: No shell found in mounted packages.\r\n');
        return;
      }

      // Build drives map including temp drive
      const drives = new Map<number, string>();
      for (const config of workspace.listDriveConfigs()) {
        drives.set(config.letter.charCodeAt(0) - 65, `/${config.letter}`);
      }
      if (tempDriveLetter) {
        drives.set(tempDriveLetter.charCodeAt(0) - 65, `/${tempDriveLetter}`);
      }

      // Create emulator with merged FS or base FS
      const { CpmEmulator } = await import('../cpm/emulator');
      const cpm = new CpmEmulator({
        fs: mergedFS || workspace.getVirtualFS(),
        console: terminal,
        drives,
        shellAddress: shellInfo.loadAddress,
        onExit: () => {
          terminal.writeString('\r\n[Build complete]\r\n');
          updateFileTree();
        }
      });

      terminal.focus();
      cpm.load(shellInfo.binary, true);

      // Queue build command from manifest's submit template
      // Use the submit template from action, replacing {name} and {drive}
      // Also need to prefix tool command with its drive letter if on temp drive
      let cmd = action.submit
        ? action.submit.replace(/\{name\}/g, baseName).replace(/\{drive\}/g, drive)
        : `${action.command} ${drive}:${baseName}\r`;

      // If tool is on a temp drive, prefix commands with that drive
      if (tempDriveLetter && cmd) {
        // Prefix first command with drive letter (e.g., "ASM" -> "C:ASM")
        cmd = `${tempDriveLetter}:${cmd}`;
      }

      setTimeout(() => {
        terminal.queueInputSlow(cmd, 5);
      }, 100);

      cpm.run().catch(err => {
        terminal.writeString(`\r\nError: ${err.message}\r\n`);
      });
    }

    /** Open workspace terminal with tool packages on a temporary drive */
    async function openToolTerminal(): Promise<void> {
      const action = getSelectedAction();
      const toolPkg = action?.package;

      // Check if tool package is already mounted on any drive
      let existingToolDrive = '';
      if (toolPkg) {
        for (const config of workspace.listDriveConfigs()) {
          if (config.packages.includes(toolPkg)) {
            existingToolDrive = config.letter;
            break;
          }
        }
      }

      // Find an unused drive letter for temp tool drive (CP/M: A-P)
      const usedLetters = new Set(workspace.listDriveConfigs().map(c => c.letter));
      let tempDriveLetter = '';
      if (toolPkg && !existingToolDrive) {
        for (const letter of 'PONMLKJIHGFEDCBA'.split('')) {
          if (!usedLetters.has(letter)) {
            tempDriveLetter = letter;
            break;
          }
        }
      }

      // Create terminal window
      const termWindowId = desktop.wm.create({
        title: `Terminal: ${action?.name || 'CP/M'}`,
        app: 'system.cpm',
        appName: 'CP/M',
        width: 660,
        height: 420,
        icon: 'background:#000;border:1px solid #0f0'
      });

      const termContent = desktop.wm.getContent(termWindowId);
      if (!termContent) return;

      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        fontSize: 14,
        fgColor: '#00ff41',
        bgColor: '#000000'
      });
      termContent.appendChild(terminal.element);

      const termWin = document.getElementById(termWindowId)!;
      termContent.addEventListener('click', () => terminal.focus());
      termWin.addEventListener('mousedown', () => requestAnimationFrame(() => terminal.focus()));

      // Create merged FS with temp tool drive if needed
      let mergedFS: MergedWorkspaceFS | null = null;
      if (tempDriveLetter && toolPkg) {
        // Load the tool package
        const pkgUrl = `./cpm/${toolPkg}.zip`;
        try {
          const pkg = await loadPackageFromUrl(pkgUrl);
          const toolDriveFS = new PackageDriveFS([pkg]);
          mergedFS = new MergedWorkspaceFS(workspace.getVirtualFS());
          mergedFS.addDrive(tempDriveLetter, toolDriveFS);
        } catch (err) {
          terminal.writeString(`Warning: Could not load ${toolPkg}: ${err}\r\n`);
        }
      }

      // Show workspace info
      terminal.writeString('Workspace Terminal\r\n');
      terminal.writeString('==================\r\n');
      for (const config of workspace.listDriveConfigs()) {
        const mode = config.writable ? 'rw' : 'ro';
        const hasTool = config.packages.includes(toolPkg || '');
        const note = hasTool ? ` [${action?.name}]` : '';
        terminal.writeString(`${config.letter}: (${mode}) - ${workspace.listFiles(config.letter).length} files${note}\r\n`);
      }
      if (tempDriveLetter && mergedFS) {
        terminal.writeString(`${tempDriveLetter}: (tmp) - ${action?.name} [temp]\r\n`);
      }
      terminal.writeString('\r\n');

      // Find shell from mounted packages
      const shellInfo = workspace.findShell();
      if (!shellInfo) {
        terminal.writeString('Error: No shell found in mounted packages.\r\n');
        return;
      }

      // Build drives map including temp drive
      const drives = new Map<number, string>();
      for (const config of workspace.listDriveConfigs()) {
        drives.set(config.letter.charCodeAt(0) - 65, `/${config.letter}`);
      }
      if (tempDriveLetter) {
        drives.set(tempDriveLetter.charCodeAt(0) - 65, `/${tempDriveLetter}`);
      }

      // Create emulator with merged FS or base FS
      const { CpmEmulator } = await import('../cpm/emulator');
      const cpm = new CpmEmulator({
        fs: mergedFS || workspace.getVirtualFS(),
        console: terminal,
        drives,
        shellAddress: shellInfo.loadAddress,
        onExit: () => {
          terminal.writeString('\r\n[Shell exited]\r\n');
          updateFileTree(); // Refresh explorer to show any files created by CP/M programs
        }
      });

      terminal.focus();
      cpm.load(shellInfo.binary, true);
      cpm.run().catch(err => {
        terminal.writeString(`\r\nError: ${err.message}\r\n`);
      });
    }

    // Editor change tracking
    editor.addEventListener('input', () => {
      isDirty = true;
    });

    // Tab key handling
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '\t' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1;
        isDirty = true;
      } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveCurrentFile();
      }
    });

    // =====================================================================
    // INITIALIZE WORKSPACE
    // =====================================================================
    try {
      log('Loading packages...');

      // Configure default drives - cpm22 includes CCP.COM shell and system utilities
      await workspace.configureDrive({ letter: 'A', packages: ['cpm22'], writable: true });
      await workspace.configureDrive({ letter: 'B', packages: [], writable: true });

      // Create a sample file in B: (scratch drive)
      workspace.writeFile('B', 'HELLO.ASM', new TextEncoder().encode(
        '; Hello World for CP/M (8080 assembly)\r\n' +
        '        ORG     100H\r\n' +
        '\r\n' +
        'START:  LXI     D,MSG       ; Load message address\r\n' +
        '        MVI     C,9         ; BDOS print string\r\n' +
        '        CALL    5           ; Call BDOS\r\n' +
        '        RET                 ; Return to CP/M\r\n' +
        '\r\n' +
        'MSG:    DB      \'Hello from CP/M!$\'\r\n' +
        '\r\n' +
        '        END     START\r\n\x1A'
      ));

      // Set up initial expansion state for first-time user experience:
      // - A: expanded with [manifest] showing MANIFEST.MF (shows what tools are available)
      // - B: expanded with [files] showing HELLO.ASM (the file they'll work with)
      expandedDrives.add('A');
      expandedLayers.add('A:[manifest]');
      expandedDrives.add('B');
      expandedLayers.add('B:[files]');

      updateFileTree();
      log('Ready');

      // Open the sample file - users see working code immediately
      openFile('B', 'HELLO.ASM');
    } catch (err) {
      log(`Init error: ${err instanceof Error ? err.message : err}`);
    }
  });
}
