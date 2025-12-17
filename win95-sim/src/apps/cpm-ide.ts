/**
 * CP/M IDE - Integrated Development Environment for CP/M programs.
 * Supports multiple languages (Assembly, Pascal, C, etc.) with compilation and execution.
 *
 * Uses the Workspace abstraction - editor content is written to the workspace
 * before compilation, no complex live file binding needed.
 */

import type { Desktop } from '../desktop';
import { CpmEmulator, MemoryFS, Terminal, CpmRunner, Assembler, ScriptedCompiler, LANGUAGES, ASSEMBLERS, hexToCom } from '../cpm';
import type { CpmExitInfo, ScriptedConsole } from '../cpm';
import {
  CpmWorkspace,
  MemoryDriveFS,
  OverlayDriveFS,
  PackageDriveFS,
} from '../cpm/workspace';

let ideCount = 0;

/**
 * Register CP/M IDE with the desktop taskbar.
 */
export function registerCpmIde(desktop: Desktop): void {
  desktop.taskbar.addItem('background:#004;border:1px solid #08f', 'IDE', async () => {
    ideCount++;
    const windowId = desktop.wm.create({
      title: `CP/M IDE ${ideCount}`,
      app: 'system.cpm-ide',
      appName: 'IDE',
      width: 700,
      height: 520,
      icon: 'background:#004;border:1px solid #08f'
    });

    const content = desktop.wm.getContent(windowId);
    if (!content) return;

    // Create IDE layout
    const ideContainer = document.createElement('div');
    ideContainer.className = 'ide-container';
    ideContainer.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#1e1e1e;';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ide-toolbar';
    toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;background:#333;border-bottom:1px solid #444;';

    // Language selector
    const langSelect = document.createElement('select');
    langSelect.style.cssText = 'padding:4px 8px;background:#444;color:#fff;border:1px solid #555;border-radius:3px;font-size:12px;';
    for (const [key, lang] of Object.entries(LANGUAGES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = lang.name;
      langSelect.appendChild(opt);
    }
    toolbar.appendChild(langSelect);

    // Run button
    const runBtn = document.createElement('button');
    runBtn.textContent = '▶ Run';
    runBtn.style.cssText = 'padding:4px 12px;background:#2a7a2a;color:#fff;border:1px solid #3a9a3a;border-radius:3px;cursor:pointer;font-weight:bold;font-size:12px;';
    runBtn.onmouseenter = () => runBtn.style.background = '#3a9a3a';
    runBtn.onmouseleave = () => runBtn.style.background = '#2a7a2a';
    toolbar.appendChild(runBtn);

    // Shell button (debug terminal)
    const shellBtn = document.createElement('button');
    shellBtn.textContent = '⌘ Shell';
    shellBtn.style.cssText = 'padding:4px 12px;background:#2a2a7a;color:#fff;border:1px solid #3a3a9a;border-radius:3px;cursor:pointer;font-weight:bold;font-size:12px;';
    shellBtn.onmouseenter = () => shellBtn.style.background = '#3a3a9a';
    shellBtn.onmouseleave = () => shellBtn.style.background = '#2a2a7a';
    toolbar.appendChild(shellBtn);

    // Load Example button
    const exampleBtn = document.createElement('button');
    exampleBtn.textContent = 'Example';
    exampleBtn.style.cssText = 'padding:4px 12px;background:#555;color:#fff;border:1px solid #666;border-radius:3px;cursor:pointer;font-size:12px;';
    exampleBtn.onmouseenter = () => exampleBtn.style.background = '#666';
    exampleBtn.onmouseleave = () => exampleBtn.style.background = '#555';
    exampleBtn.onclick = () => {
      const lang = LANGUAGES[langSelect.value];
      if (lang?.template) {
        editor.value = lang.template;
        statusLabel.textContent = `Loaded ${lang.name} example`;
      }
    };
    toolbar.appendChild(exampleBtn);

    // Trace toggle
    const traceLabel = document.createElement('label');
    traceLabel.style.cssText = 'display:flex;align-items:center;gap:4px;color:#888;font-size:11px;cursor:pointer;';
    const traceCheckbox = document.createElement('input');
    traceCheckbox.type = 'checkbox';
    traceCheckbox.style.cssText = 'cursor:pointer;';
    traceLabel.appendChild(traceCheckbox);
    traceLabel.appendChild(document.createTextNode('Trace'));
    toolbar.appendChild(traceLabel);

    // Status label
    const statusLabel = document.createElement('span');
    statusLabel.style.cssText = 'margin-left:auto;color:#888;font-size:11px;';
    statusLabel.textContent = 'Ready';
    toolbar.appendChild(statusLabel);

    ideContainer.appendChild(toolbar);

    // Editor area
    const editor = document.createElement('textarea');
    editor.className = 'ide-editor';
    editor.style.cssText = 'flex:1;padding:8px;background:#1e1e1e;color:#d4d4d4;border:none;outline:none;font-family:"Cascadia Code","Consolas","Courier New",monospace;font-size:13px;line-height:1.4;resize:none;white-space:pre;overflow:auto;tab-size:8;';
    editor.spellcheck = false;

    // Set initial template
    const initialLang = LANGUAGES[langSelect.value];
    editor.value = initialLang?.template ?? '';
    ideContainer.appendChild(editor);

    // Error output panel (hidden by default)
    const outputPanel = document.createElement('div');
    outputPanel.className = 'ide-output';
    outputPanel.style.cssText = 'display:none;max-height:150px;overflow:auto;padding:8px;background:#2d0000;color:#ff6b6b;font-family:monospace;font-size:12px;border-top:2px solid #800;white-space:pre-wrap;user-select:text;cursor:text;';
    ideContainer.appendChild(outputPanel);

    content.appendChild(ideContainer);

    // Create workspace for this IDE instance
    const workspace = new CpmWorkspace('/cpm');
    let workspaceInitialized = false;

    // Initialize workspace with packages
    const initWorkspace = async () => {
      if (workspaceInitialized) return;

      // Load core package for shell
      const core = await workspace.loadPackage('core');

      // A: = source files (writable)
      workspace.mount('A', new MemoryDriveFS());

      // B: = tools (starts with core, add language tools as needed)
      workspace.mount('B', new OverlayDriveFS(new PackageDriveFS([core])));

      // C: = output (writable scratch)
      workspace.mount('C', new MemoryDriveFS());

      workspaceInitialized = true;
    };

    // Load tools for current language into B: drive
    const loadToolsForLanguage = async () => {
      const langKey = langSelect.value;
      const lang = LANGUAGES[langKey];
      const toolConfig = lang ? ASSEMBLERS[lang.tool.toUpperCase()] : null;

      if (!toolConfig?.package) return;

      try {
        const toolPackage = await workspace.loadPackage(toolConfig.package);
        // Add tool files to B: drive (overlay allows adding to package-backed drive)
        for (const [name, data] of toolPackage.files) {
          workspace.writeFile('B', name, data);
        }
        console.log(`[IDE] Loaded ${toolConfig.package}: ${toolPackage.files.size} files to B:`);
      } catch (err) {
        console.warn(`[IDE] Failed to load package ${toolConfig.package}:`, err);
      }
    };

    // Write source code to A: drive
    const writeSourceToWorkspace = () => {
      const lang = LANGUAGES[langSelect.value];
      const ext = lang?.extension ?? 'ASM';
      const source = editor.value;

      // Convert to CP/M line endings
      const cpmSource = source.replace(/\r?\n/g, '\r\n') + '\x1A'; // Add ^Z EOF
      workspace.writeFile('A', `PROGRAM.${ext}`, new TextEncoder().encode(cpmSource));
    };

    // Update template when language changes
    langSelect.addEventListener('change', () => {
      const lang = LANGUAGES[langSelect.value];
      if (lang?.template && editor.value === (LANGUAGES[Object.keys(LANGUAGES).find(k => LANGUAGES[k].template === editor.value) ?? '']?.template ?? '')) {
        editor.value = lang.template;
      }
      statusLabel.textContent = `${lang?.name ?? 'Unknown'} selected`;
    });

    // Handle tab key in editor
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '\t' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1;
      }
    });

    // Shell button handler - opens interactive debug terminal
    shellBtn.addEventListener('click', async () => {
      const langKey = langSelect.value;
      const lang = LANGUAGES[langKey];

      statusLabel.textContent = 'Loading shell...';
      statusLabel.style.color = '#888';
      shellBtn.disabled = true;
      shellBtn.style.opacity = '0.6';

      try {
        await initWorkspace();
        await loadToolsForLanguage();
        writeSourceToWorkspace();

        // Open terminal window
        const termWindowId = desktop.wm.create({
          title: `IDE Shell - ${lang?.name ?? 'Debug'}`,
          app: 'system.cpm',
          appName: 'CP/M',
          width: 660,
          height: 420,
          icon: 'background:#000;border:1px solid #00f'
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
        termContent.addEventListener('mousedown', () => terminal.focus());
        termWin.addEventListener('mousedown', () => requestAnimationFrame(() => terminal.focus()));

        // Show drive info
        terminal.writeString('IDE Debug Shell\r\n');
        terminal.writeString('===============\r\n');
        terminal.writeString(`A: Source files (${workspace.listFiles('A').length})\r\n`);
        terminal.writeString(`B: Tools (${workspace.listFiles('B').length})\r\n`);
        terminal.writeString('\r\n');

        // Get shell from core package
        const core = await workspace.loadPackage('core');
        const shellName = (core.manifest.meta?.shell as string) ?? 'XCCP.COM';
        const shellBinary = workspace.readFile('B', shellName);

        if (!shellBinary) {
          terminal.writeString(`Error: Shell ${shellName} not found\r\n`);
          return;
        }

        const cpm = workspace.createEmulator(terminal, {
          shellBinary,
          onExit: (info: CpmExitInfo) => {
            terminal.writeString('\r\n');
            terminal.writeString(`[${info.message}]\r\n`);
          }
        });

        cpm.syscallTrace = traceCheckbox.checked;
        terminal.focus();
        cpm.run().catch(err => {
          terminal.writeString(`\r\nError: ${err.message}\r\n`);
        });

        statusLabel.textContent = 'Shell opened';
        statusLabel.style.color = '#6f6';
      } catch (err) {
        outputPanel.style.display = 'block';
        outputPanel.textContent = 'Shell error: ' + (err instanceof Error ? err.message : String(err));
        statusLabel.textContent = 'Error';
        statusLabel.style.color = '#f66';
      } finally {
        shellBtn.disabled = false;
        shellBtn.style.opacity = '1';
      }
    });

    // Run button handler
    runBtn.addEventListener('click', async () => {
      const langKey = langSelect.value;
      const lang = LANGUAGES[langKey];
      if (!lang) {
        outputPanel.style.display = 'block';
        outputPanel.textContent = 'Error: Unknown language selected';
        return;
      }

      statusLabel.textContent = 'Compiling...';
      statusLabel.style.color = '#888';
      runBtn.disabled = true;
      runBtn.style.opacity = '0.6';
      outputPanel.style.display = 'none';

      try {
        await initWorkspace();
        await loadToolsForLanguage();
        writeSourceToWorkspace();

        // Create runner using workspace's VirtualFS
        const runner = new CpmRunner({
          fs: workspace.getVirtualFS(),
          sourcePath: '/A',
          toolsPath: '/B'
        });

        // Get assembler config
        const toolConfig = ASSEMBLERS[lang.tool.toUpperCase()] ?? { name: lang.tool.toUpperCase() };

        // For complex compilers, show a terminal during compilation
        let compileTerminal: Terminal | undefined;
        let compileWindowId: string | undefined;
        const abortController = new AbortController();

        if (toolConfig.linker || toolConfig.showTerminal) {
          compileWindowId = desktop.wm.create({
            title: `Compiling with ${lang.tool}...`,
            app: 'system.cpm',
            appName: 'CP/M',
            width: 660,
            height: 420,
            icon: 'background:#000;border:1px solid #0f0'
          });

          const compileContent = desktop.wm.getContent(compileWindowId);
          if (compileContent) {
            compileTerminal = new Terminal({
              cols: 80,
              rows: 24,
              fontSize: 14,
              fgColor: '#00ff41',
              bgColor: '#000000'
            });
            compileTerminal.consoleLog = true;
            compileContent.appendChild(compileTerminal.element);

            const compileWin = document.getElementById(compileWindowId)!;
            compileContent.addEventListener('click', () => compileTerminal!.focus());
            compileContent.addEventListener('mousedown', () => compileTerminal!.focus());
            compileWin.addEventListener('mousedown', () => requestAnimationFrame(() => compileTerminal!.focus()));
            compileTerminal.focus();

            // Abort compilation if window is closed
            const observer = new MutationObserver(() => {
              if (!document.getElementById(compileWindowId!)) {
                abortController.abort();
                observer.disconnect();
              }
            });
            observer.observe(document.getElementById('desktop')!, { childList: true, subtree: true });
          }
        }

        if (compileTerminal) {
          compileTerminal.writeString(`Compiling ${lang.name}...\r\n\r\n`);
        }

        statusLabel.textContent = 'Compiling...';
        console.log(`[IDE] Starting compilation with ${lang.tool}...`);

        let result: Awaited<ReturnType<Assembler['assemble']>>;

        // Check if this tool needs scripted interaction
        if (toolConfig.interactiveScript && compileTerminal) {
          const scriptedCompiler = new ScriptedCompiler(workspace.getVirtualFS(), compileTerminal as ScriptedConsole, lang.tool);
          const scriptResult = await scriptedCompiler.compile(editor.value, {
            programName: 'PROGRAM',
            trace: traceCheckbox.checked,
            signal: abortController.signal
          });
          result = {
            success: scriptResult.success,
            output: scriptResult.output,
            comFile: scriptResult.comFile,
            newFiles: new Map(),
            exitInfo: scriptResult.exitInfo
          };
        } else {
          const assembler = new Assembler(runner, lang.tool);
          result = await assembler.assemble('PROGRAM', editor.value, {
            trace: traceCheckbox.checked,
            timeout: 60000,
            console: compileTerminal,
            signal: abortController.signal
          });
        }

        console.log(`[IDE] Compilation result:`, { success: result.success, hasComFile: !!result.comFile });

        // Get COM file, or convert HEX to COM
        let comFile = result.comFile;
        if (!comFile && result.hexFile) {
          comFile = hexToCom(result.hexFile);
        }

        const isInterpreted = result.runtime && result.intermediateFile;

        if (!result.success || (!comFile && !isInterpreted)) {
          if (compileTerminal) {
            compileTerminal.writeString('\r\n\r\n*** COMPILATION FAILED ***\r\n');
          }
          outputPanel.style.display = 'block';
          outputPanel.style.background = '#2d0000';
          outputPanel.style.borderColor = '#800';
          outputPanel.style.color = '#ff6b6b';
          outputPanel.textContent = 'Compilation failed:\n\n' + (result.output || result.error || 'Unknown error');
          statusLabel.textContent = 'Compilation failed';
          statusLabel.style.color = '#f66';
        } else if (compileTerminal && compileWindowId) {
          // Success - run in the same terminal
          statusLabel.textContent = 'Running...';
          statusLabel.style.color = '#6f6';
          outputPanel.style.display = 'none';

          const runFs = new MemoryFS();

          if (isInterpreted && result.runtime && result.intermediateFile) {
            const runtimeName = result.runtime.program + '.COM';
            const intFileName = `PROGRAM.${toolConfig?.intermediateExt ?? 'INT'}`;

            desktop.wm.setTitle(compileWindowId, `Run: ${result.runtime.program} PROGRAM`);
            compileTerminal.writeString(`\r\n--- Running ${result.runtime.program} PROGRAM ---\r\n\r\n`);

            const runtimeBinary = workspace.readFile('B', runtimeName);
            if (!runtimeBinary) {
              compileTerminal.writeString(`Error: Runtime ${runtimeName} not found\r\n`);
              statusLabel.textContent = 'Error';
              statusLabel.style.color = '#f66';
              return;
            }

            runFs.addFile(`/${runtimeName}`, runtimeBinary);
            runFs.addFile(`/${intFileName}`, result.intermediateFile);

            const runCpm = new CpmEmulator({
              fs: runFs,
              console: compileTerminal,
              drives: new Map([[0, '/']]),
              onExit: (info: CpmExitInfo) => {
                compileTerminal!.writeString('\r\n');
                compileTerminal!.writeString(`[${info.message}, ${info.tStates.toLocaleString()} T-states]\r\n`);
                statusLabel.textContent = 'Done';
              }
            });

            const runtimeArgs = result.runtime.argsFormat.replace('{name}', 'PROGRAM');
            runCpm.setupTransient(runtimeBinary, runtimeArgs);
            compileTerminal.focus();
            runCpm.run().catch(err => {
              compileTerminal!.writeString(`\r\n\r\nError: ${err.message}\r\n`);
            });
          } else {
            desktop.wm.setTitle(compileWindowId, 'Run: PROGRAM.COM');
            compileTerminal.writeString('\r\n--- Running PROGRAM.COM ---\r\n\r\n');

            runFs.addFile('/PROGRAM.COM', comFile!);

            const runCpm = new CpmEmulator({
              fs: runFs,
              console: compileTerminal,
              drives: new Map([[0, '/']]),
              onExit: (info: CpmExitInfo) => {
                compileTerminal!.writeString('\r\n');
                compileTerminal!.writeString(`[${info.message}, ${info.tStates.toLocaleString()} T-states]\r\n`);
                statusLabel.textContent = 'Done';
              }
            });

            runCpm.setupTransient(comFile!, '');
            compileTerminal.focus();
            runCpm.run().catch(err => {
              compileTerminal!.writeString(`\r\n\r\nError: ${err.message}\r\n`);
            });
          }
        } else {
          // No compile terminal - open new window for running
          statusLabel.textContent = 'Running...';
          statusLabel.style.color = '#6f6';
          outputPanel.style.display = 'none';

          const windowTitle = isInterpreted && result.runtime
            ? `Run: ${result.runtime.program} PROGRAM`
            : 'Run: PROGRAM.COM';

          const termWindowId = desktop.wm.create({
            title: windowTitle,
            app: 'system.cpm',
            appName: 'CP/M',
            width: 660,
            height: 420,
            icon: 'background:#000;border:1px solid #0f0'
          });

          const termContent = desktop.wm.getContent(termWindowId);
          if (termContent) {
            const runTerminal = new Terminal({
              cols: 80,
              rows: 24,
              fontSize: 14,
              fgColor: '#00ff41',
              bgColor: '#000000'
            });
            termContent.appendChild(runTerminal.element);

            const termWin = document.getElementById(termWindowId)!;
            termContent.addEventListener('click', () => runTerminal.focus());
            termContent.addEventListener('mousedown', () => runTerminal.focus());
            termWin.addEventListener('mousedown', () => requestAnimationFrame(() => runTerminal.focus()));

            const runFs = new MemoryFS();

            if (isInterpreted && result.runtime && result.intermediateFile) {
              const runtimeName = result.runtime.program + '.COM';
              const intFileName = `PROGRAM.${toolConfig?.intermediateExt ?? 'INT'}`;

              const runtimeBinary = workspace.readFile('B', runtimeName);
              if (!runtimeBinary) {
                runTerminal.writeString(`Error: Runtime ${runtimeName} not found\r\n`);
                statusLabel.textContent = 'Error';
                statusLabel.style.color = '#f66';
                return;
              }

              runFs.addFile(`/${runtimeName}`, runtimeBinary);
              runFs.addFile(`/${intFileName}`, result.intermediateFile);

              const runCpm = new CpmEmulator({
                fs: runFs,
                console: runTerminal,
                drives: new Map([[0, '/']]),
                onExit: (info: CpmExitInfo) => {
                  runTerminal.writeString('\r\n');
                  runTerminal.writeString(`[${info.message}, ${info.tStates.toLocaleString()} T-states]\r\n`);
                  statusLabel.textContent = 'Done';
                }
              });

              const runtimeArgs = result.runtime.argsFormat.replace('{name}', 'PROGRAM');
              runCpm.setupTransient(runtimeBinary, runtimeArgs);
              runTerminal.focus();
              runCpm.run().catch(err => {
                runTerminal.writeString(`\r\n\r\nError: ${err.message}\r\n`);
              });
            } else {
              runFs.addFile('/PROGRAM.COM', comFile!);

              const runCpm = new CpmEmulator({
                fs: runFs,
                console: runTerminal,
                drives: new Map([[0, '/']]),
                onExit: (info: CpmExitInfo) => {
                  runTerminal.writeString('\r\n');
                  runTerminal.writeString(`[${info.message}, ${info.tStates.toLocaleString()} T-states]\r\n`);
                  statusLabel.textContent = 'Done';
                }
              });

              runCpm.setupTransient(comFile!, '');
              runTerminal.focus();
              runCpm.run().catch(err => {
                runTerminal.writeString(`\r\n\r\nError: ${err.message}\r\n`);
              });
            }
          }
        }
      } catch (err) {
        outputPanel.style.display = 'block';
        outputPanel.style.background = '#2d0000';
        outputPanel.style.borderColor = '#800';
        outputPanel.style.color = '#ff6b6b';
        outputPanel.textContent = 'Error: ' + (err instanceof Error ? err.message : String(err));
        statusLabel.textContent = 'Error';
        statusLabel.style.color = '#f66';
      } finally {
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
      }
    });

    // Focus editor
    requestAnimationFrame(() => editor.focus());
  });
}
