/**
 * Workspace Manager - Unified CP/M development environment.
 *
 * Features:
 * - Configurable drives (ro, r+, rw)
 * - File browser with tree view
 * - Editor for direct file editing
 * - Terminal spawning (shares workspace)
 * - Build/Run for CP/M programs
 * - Export drive overlays as ZIP
 */

import type { Desktop } from '../desktop';
import { Terminal, LANGUAGES, ASSEMBLERS, CpmRunner, Assembler, hexToCom, CpmEmulator, MemoryFS } from '../cpm';
import type { CpmExitInfo } from '../cpm';
import {
  CpmWorkspace,
  fetchAvailablePackages,
  type DriveType,
} from '../cpm/workspace';

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
  .ws-sidebar { width: 160px; background: #fff; border-right: 1px solid #808080; display: flex; flex-direction: column; overflow: hidden; }
  .ws-sidebar-header { display: flex; align-items: center; padding: 2px 4px; background: #000080; color: #fff; font-size: 11px; font-weight: bold; }
  .ws-sidebar-title { flex: 1; }
  .ws-sidebar-btn { color: #aaf; font-weight: bold; padding: 0 4px; cursor: pointer; }
  .ws-sidebar-btn:hover { color: #fff; }
  .ws-file-tree { flex: 1; overflow: auto; font-size: 11px; background: #fff; }
  .ws-tree-drive { }
  .ws-tree-drive-header { display: flex; align-items: center; gap: 4px; padding: 2px 4px; background: #c0c0c0; border-bottom: 1px solid #808080; cursor: pointer; user-select: none; color: #000; }
  .ws-tree-drive-header:hover { background: #d0d0d0; }
  .ws-tree-drive-header.dragover { background: #000080; color: #fff; }
  .ws-tree-drive-letter { font-weight: bold; color: #000080; }
  .ws-tree-drive-type { color: #808080; font-size: 10px; }
  .ws-tree-drive-count { color: #808080; font-size: 10px; flex: 1; text-align: right; }
  .ws-tree-drive-btn { font-weight: bold; padding: 0 3px; cursor: pointer; }
  .ws-tree-drive-btn.add { color: #008; }
  .ws-tree-drive-btn.add:hover { color: #00f; }
  .ws-tree-drive-btn.remove { color: #800; }
  .ws-tree-drive-btn.remove:hover { color: #f00; }
  .ws-tree-layers { background: #fff; }
  .ws-tree-layer { }
  .ws-tree-layer-header { display: flex; align-items: center; gap: 4px; padding: 1px 4px 1px 12px; background: #e8e8e8; border-bottom: 1px solid #d0d0d0; cursor: pointer; user-select: none; color: #000; font-size: 10px; }
  .ws-tree-layer-header:hover { background: #d8d8d8; }
  .ws-tree-layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .ws-tree-layer-btn { color: #008; font-weight: bold; padding: 0 3px; cursor: pointer; }
  .ws-tree-layer-btn:hover { color: #00f; }
  .ws-tree-layer-btn.remove { color: #800; }
  .ws-tree-layer-btn.remove:hover { color: #f00; }
  .ws-tree-files { background: #fff; }
  .ws-tree-file { display: flex; align-items: center; padding: 1px 4px 1px 24px; cursor: pointer; color: #000; }
  .ws-tree-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ws-tree-file-remove { font-weight: bold; padding: 0 3px; cursor: pointer; display: none; font-size: 10px; color: #fcc; }
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
  .ws-editor-path { flex: 1; padding: 1px 4px; background: #fff; border-width: 1px; border-style: solid; border-color: #808080 #fff #fff #808080; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ws-editor { flex: 1; padding: 4px; background: #fff; color: #000; border: none; outline: none; font-family: "Fixedsys", "Courier New", monospace; font-size: 12px; line-height: 1.3; resize: none; white-space: pre; overflow: auto; tab-size: 8; }
  .ws-statusbar { display: flex; align-items: center; gap: 4px; padding: 2px 4px; background: #c0c0c0; border-top: 1px solid #fff; font-size: 11px; color: #000; }
  .ws-status-msg { flex: 1; padding: 1px 4px; background: #fff; border-width: 1px; border-style: solid; border-color: #808080 #fff #fff #808080; color: #000; }
  .ws-status-btn { padding: 1px 6px; background: #c0c0c0; border-width: 2px; border-style: solid; border-color: #fff #808080 #808080 #fff; color: #000; cursor: pointer; font-size: 10px; font-family: inherit; }
  .ws-status-btn:hover { background: #d4d4d4; }
  .ws-status-btn:active { border-color: #808080 #fff #fff #808080; }
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
      width: 850,
      height: 550,
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
    sidebarTitle.textContent = 'EXPLORER';
    sidebarHeader.appendChild(sidebarTitle);

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

    // Editor toolbar
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

    // Build button
    const buildBtn = document.createElement('button');
    buildBtn.className = 'ws-btn';
    buildBtn.textContent = 'B';
    buildBtn.title = 'Build current file';
    buildBtn.onclick = () => buildCurrentFile();
    editorToolbar.appendChild(buildBtn);

    // Run button
    const runBtn = document.createElement('button');
    runBtn.className = 'ws-btn ws-btn-success';
    runBtn.textContent = 'R';
    runBtn.title = 'Run most recent build';
    runBtn.onclick = () => runProgram();
    editorToolbar.appendChild(runBtn);

    editorArea.appendChild(editorToolbar);

    const editor = document.createElement('textarea');
    editor.className = 'ws-editor';
    editor.spellcheck = false;
    editor.placeholder = 'Select a file from the explorer or create a new file...';
    editor.disabled = true;
    editorArea.appendChild(editor);

    main.appendChild(editorArea);
    container.appendChild(main);

    // =====================================================================
    // STATUS BAR
    // =====================================================================
    const statusBar = document.createElement('div');
    statusBar.className = 'ws-statusbar';

    const statusMsg = document.createElement('span');
    statusMsg.className = 'ws-status-msg';
    statusMsg.textContent = 'Loading...';
    statusBar.appendChild(statusMsg);

    // Save buttons container (populated dynamically)
    const saveButtons = document.createElement('div');
    saveButtons.className = 'ws-toolbar-group';
    statusBar.appendChild(saveButtons);

    container.appendChild(statusBar);
    content.appendChild(container);

    // =====================================================================
    // HELPER FUNCTIONS
    // =====================================================================

    function setStatus(msg: string): void {
      statusMsg.textContent = msg;
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

        const typeSpan = document.createElement('span');
        typeSpan.className = 'ws-tree-drive-type';
        typeSpan.textContent = `(${config.type})`;
        header.appendChild(typeSpan);

        const countSpan = document.createElement('span');
        countSpan.className = 'ws-tree-drive-count';
        countSpan.textContent = String(workspace.listFiles(config.letter).length);
        header.appendChild(countSpan);

        // Add package button for r+ drives
        if (config.type === 'r+') {
          const addBtn = document.createElement('span');
          addBtn.className = 'ws-tree-drive-btn add';
          addBtn.textContent = '+';
          addBtn.title = 'Add package';
          addBtn.onclick = (e) => {
            e.stopPropagation();
            showAddPackageDialog(config.letter);
          };
          header.appendChild(addBtn);
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
                        updateSaveButtons();
            setStatus(`Removed ${config.letter}: drive`);
          }
        };
        header.appendChild(removeBtn);

        const layersContainer = document.createElement('div');
        layersContainer.className = 'ws-tree-layers';
        layersContainer.style.display = 'block';

        header.onclick = (e) => {
          if ((e.target as HTMLElement).closest('.ws-tree-drive-btn')) return;
          layersContainer.style.display = layersContainer.style.display === 'none' ? 'block' : 'none';
        };

        // Drag & drop for r+ drives
        if (config.type === 'r+') {
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
        }

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
          const isWritableLayer = layer.name === '[overlay]' || layer.name === '[files]';

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
                setStatus(`Created ${config.letter}:${upperName}`);
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
                                setStatus(`Removed ${layer.name}`);
              }
            };
            layerHeader.appendChild(removeBtn);
          }

          const layerFiles = document.createElement('div');
          layerFiles.className = 'ws-tree-files';
          layerFiles.style.display = 'block';

          layerHeader.onclick = (e) => {
            if ((e.target as HTMLElement).closest('.ws-tree-layer-btn')) return;
            layerFiles.style.display = layerFiles.style.display === 'none' ? 'block' : 'none';
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
                    setStatus(`Deleted ${config.letter}:${name}`);
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

        // Show add button for empty rw drives
        if (layers.length === 0 && (config.type === 'rw' || config.type === 'r+')) {
          const emptyLayer = document.createElement('div');
          emptyLayer.className = 'ws-tree-layer-header';
          emptyLayer.style.fontStyle = 'italic';

          const emptyName = document.createElement('span');
          emptyName.className = 'ws-tree-layer-name';
          emptyName.textContent = '(empty)';
          emptyLayer.appendChild(emptyName);

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
              setStatus(`Created ${config.letter}:${upperName}`);
            }
          };
          emptyLayer.appendChild(addBtn);

          layersContainer.appendChild(emptyLayer);
        }

        driveEl.appendChild(layersContainer);
        fileTree.appendChild(driveEl);
      }
    }

    async function handleDroppedZip(letter: string, file: File): Promise<void> {
      setStatus(`Loading ${file.name}...`);
      try {
        const data = await file.arrayBuffer();
        const { loadPackage } = await import('../cpm/package-loader');
        const pkg = await loadPackage(data);

        // Get the drive filesystem
        const driveFs = workspace.drive(letter);
        if (!driveFs) {
          setStatus(`Drive ${letter}: not found`);
          return;
        }

        // Add package directly to the base filesystem
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const overlayFs = driveFs as any;
        const baseFs = overlayFs.getBase();

        // Check if already loaded
        const existingPkgs = baseFs.getPackages();
        if (existingPkgs.some((p: { manifest: { name: string } }) => p.manifest.name === pkg.manifest.name)) {
          setStatus(`${pkg.manifest.name} already loaded`);
          return;
        }

        baseFs.addPackage(pkg);

        // Update config
        const config = workspace.getDriveConfig(letter);
        if (config && !config.packages.includes(pkg.manifest.name)) {
          config.packages.push(pkg.manifest.name);
        }

        updateFileTree();
                setStatus(`Added ${pkg.manifest.name} (${pkg.files.size} files)`);
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : err}`);
      }
    }

    function updateSaveButtons(): void {
      saveButtons.innerHTML = '';
      for (const config of workspace.listDriveConfigs()) {
        const btn = document.createElement('button');
        btn.className = 'ws-status-btn';
        btn.textContent = `Save ${config.letter}:`;
        btn.title = `Export ${config.letter}: drive as ZIP`;
        btn.onclick = () => exportDriveToZip(config.letter);
        saveButtons.appendChild(btn);
      }
    }

    function openFile(drive: string, name: string): void {
      // Save current file if dirty
      if (isDirty && currentFile) {
        saveCurrentFile();
      }

      const content = workspace.readFile(drive, name);
      if (!content) {
        setStatus(`Error: Could not read ${drive}:${name}`);
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
      updateFileTree();
      setStatus(`Opened ${drive}:${name}`);
    }

    function saveCurrentFile(): void {
      if (!currentFile || !isDirty) return;

      const { drive, name } = currentFile;
      if (!workspace.isDriveWritable(drive)) {
        setStatus(`Cannot save: ${drive}: is read-only`);
        return;
      }

      // Convert to CP/M format
      const text = editor.value.replace(/\r?\n/g, '\r\n') + '\x1A';
      workspace.writeFile(drive, name, new TextEncoder().encode(text));
      isDirty = false;
      setStatus(`Saved ${drive}:${name}`);
      updateFileTree();
      updateSaveButtons();
    }

    async function exportDriveToZip(letter: string): Promise<void> {
      const config = workspace.getDriveConfig(letter);
      if (!config) return;

      // For r+ drives with overlay content, ask what to export
      if (config.type === 'r+' && workspace.hasWritableContent(letter)) {
        showExportDialog(letter);
        return;
      }

      // For other drives, just export everything
      try {
        const blob = await workspace.exportDrive(letter);
        downloadBlob(blob, `drive-${letter.toLowerCase()}.zip`);
        setStatus(`Exported ${letter}: drive`);
      } catch (err) {
        setStatus(`Export error: ${err instanceof Error ? err.message : err}`);
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
          setStatus(`Exported ${letter}: overlay`);
        } catch (err) {
          setStatus(`Export error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#export-all')!.addEventListener('click', async () => {
        overlay.remove();
        try {
          const blob = await workspace.exportDrive(letter);
          downloadBlob(blob, `drive-${letter.toLowerCase()}.zip`);
          setStatus(`Exported ${letter}: drive`);
        } catch (err) {
          setStatus(`Export error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#export-cancel')!.addEventListener('click', () => overlay.remove());
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    async function showAddPackageDialog(letter: string): Promise<void> {
      const overlay = document.createElement('div');
      overlay.className = 'ws-modal-overlay';

      const modal = document.createElement('div');
      modal.className = 'ws-modal';
      modal.innerHTML = `
        <h3>Add Package to ${letter}:</h3>
        <label>
          Package
          <select id="pkg-select">
            <option value="">Loading packages...</option>
          </select>
        </label>
        <p style="margin:8px 0;font-size:10px;color:#666;">Or drag & drop a .zip file onto the drive header</p>
        <div class="ws-modal-btns">
          <button class="ws-btn" id="pkg-cancel">Cancel</button>
        </div>
      `;

      overlay.appendChild(modal);
      container.appendChild(overlay);

      const pkgSelect = modal.querySelector('#pkg-select') as HTMLSelectElement;

      // Load available packages dynamically
      try {
        const packages = await fetchAvailablePackages('./cpm');
        // Filter out 'core' and packages already on this drive
        const driveConfig = workspace.getDriveConfig(letter);
        const loadedPkgs = driveConfig?.packages || [];
        const available = packages.filter(p => p.id !== 'core' && !loadedPkgs.includes(p.id));

        pkgSelect.innerHTML = `<option value="">Select package...</option>` +
          available.map(p => `<option value="${p.id}">${p.id} - ${p.name}</option>`).join('');
      } catch {
        pkgSelect.innerHTML = `<option value="">Failed to load packages</option>`;
      }

      pkgSelect.addEventListener('change', async () => {
        const pkgName = pkgSelect.value;
        if (!pkgName) return;

        overlay.remove();
        setStatus(`Loading ${pkgName}...`);
        try {
          await workspace.addPackageToDrive(letter, pkgName);
          updateFileTree();
          setStatus(`Added ${pkgName} to ${letter}:`);
        } catch (err) {
          setStatus(`Error: ${err instanceof Error ? err.message : err}`);
        }
      });

      modal.querySelector('#pkg-cancel')!.addEventListener('click', () => overlay.remove());
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
        <label>
          Type
          <select id="add-drive-type">
            <option value="rw">rw - Pure writable (scratch)</option>
            <option value="r+">r+ - Packages + overlay</option>
            <option value="ro">ro - Read-only packages</option>
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
      const typeSelect = modal.querySelector('#add-drive-type') as HTMLSelectElement;

      modal.querySelector('#add-drive-cancel')!.addEventListener('click', () => overlay.remove());
      modal.querySelector('#add-drive-ok')!.addEventListener('click', async () => {
        const letter = letterSelect.value;
        const type = typeSelect.value as DriveType;

        try {
          await workspace.configureDrive({ letter, type, packages: [] });
                    updateFileTree();
          updateSaveButtons();
          setStatus(`Added ${letter}: drive (${type})`);
        } catch (err) {
          setStatus(`Error: ${err instanceof Error ? err.message : err}`);
        }
        overlay.remove();
      });

      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    async function spawnTerminal(): Promise<void> {
      setStatus('Opening terminal...');

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
        terminal.writeString(`${config.letter}: (${config.type}) - ${workspace.listFiles(config.letter).length} files\r\n`);
      }
      terminal.writeString('\r\n');

      // Get shell
      const shellBinary = workspace.readFile('A', 'XCCP.COM');
      if (!shellBinary) {
        terminal.writeString('Error: XCCP.COM not found on A:\r\n');
        terminal.writeString('Make sure core package is loaded.\r\n');
        setStatus('Terminal error: no shell');
        return;
      }

      const cpm = workspace.createEmulator(terminal, {
        shellBinary,
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

      setStatus('Terminal opened');
    }

    // Track last built COM file
    let lastBuiltCom: Uint8Array | null = null;
    let lastBuiltName = 'PROGRAM';

    async function buildCurrentFile(): Promise<void> {
      if (!currentFile) {
        setStatus('No file selected');
        return;
      }

      // Save first
      saveCurrentFile();

      const { drive, name } = currentFile;
      const ext = name.split('.').pop()?.toUpperCase() ?? '';

      // Find language by extension
      const langEntry = Object.entries(LANGUAGES).find(([_, l]) => l.extension === ext);
      if (!langEntry) {
        setStatus(`Unknown file type: .${ext}`);
        return;
      }

      const [, lang] = langEntry;
      const toolConfig = ASSEMBLERS[lang.tool.toUpperCase()];
      if (!toolConfig) {
        setStatus(`Unknown tool: ${lang.tool}`);
        return;
      }

      setStatus(`Building with ${lang.tool}...`);
      buildBtn.disabled = true;

      try {
        // Ensure tool package is loaded
        if (toolConfig.package) {
          try {
            await workspace.addPackageToDrive('A', toolConfig.package);
          } catch {
            // Package might already be loaded
          }
        }

        // Create runner
        const runner = new CpmRunner({
          fs: workspace.getVirtualFS(),
          sourcePath: `/${drive}`,
          toolsPath: '/A'
        });

        const baseName = name.replace(/\.[^.]+$/, '');
        const assembler = new Assembler(runner, lang.tool);

        const content = workspace.readFile(drive, name);
        if (!content) {
          setStatus('Error: Could not read source file');
          return;
        }

        const source = new TextDecoder().decode(content);
        const result = await assembler.assemble(baseName, source, { timeout: 60000 });

        // Get COM file
        let comFile = result.comFile;
        if (!comFile && result.hexFile) {
          comFile = hexToCom(result.hexFile);
        }

        if (result.success && comFile) {
          lastBuiltCom = comFile;
          lastBuiltName = baseName;
          // Write COM to workspace
          workspace.writeFile(drive, `${baseName}.COM`, comFile);
          updateFileTree();
          setStatus(`Built ${baseName}.COM (${comFile.length} bytes)`);
        } else {
          setStatus(`Build failed: ${result.error || 'Unknown error'}`);
          console.log('[WS] Build output:', result.output);
        }
      } catch (err) {
        setStatus(`Build error: ${err instanceof Error ? err.message : err}`);
      } finally {
        buildBtn.disabled = false;
      }
    }

    function runProgram(): void {
      if (!lastBuiltCom) {
        setStatus('No program built yet - click B first');
        return;
      }

      setStatus('Running...');

      const termWindowId = desktop.wm.create({
        title: `Run: ${lastBuiltName}.COM`,
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

      const runFs = new MemoryFS();
      runFs.addFile(`/${lastBuiltName}.COM`, lastBuiltCom);

      const cpm = new CpmEmulator({
        fs: runFs,
        console: terminal,
        drives: new Map([[0, '/']]),
        onExit: (info: CpmExitInfo) => {
          terminal.writeString('\r\n');
          terminal.writeString(`[${info.message}, ${info.tStates.toLocaleString()} T-states]\r\n`);
          setStatus('Done');
        }
      });

      cpm.setupTransient(lastBuiltCom, '');
      terminal.focus();
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
      setStatus('Loading packages...');

      // Configure default drives
      await workspace.configureDrive({ letter: 'A', type: 'r+', packages: ['core'] });
      await workspace.configureDrive({ letter: 'B', type: 'rw', packages: [] });

      // Create a sample file in B: (scratch drive)
      workspace.writeFile('B', 'HELLO.ASM', new TextEncoder().encode(
        '; Hello World for CP/M\r\n' +
        '        ORG     100H\r\n' +
        '\r\n' +
        'START:  LD      DE,MSG\r\n' +
        '        LD      C,9\r\n' +
        '        CALL    5\r\n' +
        '        RET\r\n' +
        '\r\n' +
        'MSG:    DB      \'Hello from CP/M!$\'\r\n' +
        '\r\n' +
        '        END     START\r\n\x1A'
      ));

            updateFileTree();
      updateSaveButtons();
      setStatus('Ready');

      // Open the sample file
      openFile('B', 'HELLO.ASM');
    } catch (err) {
      setStatus(`Init error: ${err instanceof Error ? err.message : err}`);
    }
  });
}
