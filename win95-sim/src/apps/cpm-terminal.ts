/**
 * CP/M Terminal - opens a CP/M 2.2 virtual machine terminal window.
 *
 * Uses the Workspace abstraction for drive management and package loading.
 */

import type { Desktop } from '../desktop';
import { Terminal } from '../cpm';
import type { CpmExitInfo } from '../cpm';
import {
  CpmWorkspace,
  OverlayDriveFS,
  PackageDriveFS,
} from '../cpm/workspace';

let cpmCount = 0;

/**
 * Register CP/M Terminal with the desktop taskbar.
 */
export function registerCpmTerminal(desktop: Desktop): void {
  desktop.taskbar.addItem('background:#000;border:1px solid #0f0', 'CP/M', async () => {
    cpmCount++;
    const windowId = desktop.wm.create({
      title: `CP/M Terminal ${cpmCount}`,
      app: 'system.cpm',
      appName: 'CP/M',
      width: 660,
      height: 420,
      icon: 'background:#000;border:1px solid #0f0'
    });

    const content = desktop.wm.getContent(windowId);
    if (!content) return;

    // Create terminal with green-screen look
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      fontSize: 14,
      fgColor: '#00ff41',
      bgColor: '#000000'
    });
    content.appendChild(terminal.element);

    // Keep terminal focused when window/content is clicked
    const win = document.getElementById(windowId)!;
    const overlay = win.querySelector('.window-overlay')!;

    // Focus terminal when content is clicked
    content.addEventListener('click', () => terminal.focus());
    content.addEventListener('mousedown', () => terminal.focus());

    // Focus terminal when overlay is clicked (window becoming active)
    overlay.addEventListener('mousedown', () => {
      requestAnimationFrame(() => terminal.focus());
    });

    // Focus terminal on any window mousedown (catches edges/titlebar)
    win.addEventListener('mousedown', () => {
      requestAnimationFrame(() => terminal.focus());
    });

    // Focus after DOM update
    requestAnimationFrame(() => terminal.focus());

    // Create workspace for this CP/M instance
    const workspace = new CpmWorkspace('/cpm');

    // Show loading message
    terminal.writeString('CP/M 2.2 Virtual Machine\r\n');
    terminal.writeString('64K TPA\r\n\r\n');
    terminal.writeString('Loading packages...\r\n');

    try {
      // Load packages
      const core = await workspace.loadPackage('core');
      const cpm22 = await workspace.loadPackage('cpm22');

      // Try to load optional packages (don't fail if not found)
      let zork;
      try {
        zork = await workspace.loadPackage('zork');
      } catch {
        console.log('[CPM] zork package not available');
      }

      // Mount drives:
      // A: = core + cpm22 with writable overlay (for user files)
      // B: = cpm22 system utilities (read-only)
      // J: = zork (if available)
      const baseDriveA = new PackageDriveFS([core, cpm22]);
      workspace.mount('A', new OverlayDriveFS(baseDriveA));
      workspace.mount('B', new PackageDriveFS([cpm22]));

      if (zork) {
        workspace.mount('J', new PackageDriveFS([zork]));
      }

      // Add some default files
      workspace.writeFile('A', 'HELLO.TXT', new TextEncoder().encode('Hello from CP/M!\r\n'));
      workspace.writeFile('A', 'README.TXT', new TextEncoder().encode('CP/M 2.2 Virtual Machine\r\n'));

      // Show drive contents
      terminal.writeString(` A: Core + System (${workspace.listFiles('A').length} files)\r\n`);
      terminal.writeString(` B: System utilities (${workspace.listFiles('B').length} files)\r\n`);
      if (zork) {
        terminal.writeString(` J: ??? (${workspace.listFiles('J').length} files)\r\n`);
      }
      terminal.writeString('\r\n');

      // Get shell from core package manifest
      const shellName = (core.manifest.meta?.shell as string) ?? 'XCCP.COM';
      const shellBinary = workspace.readFile('A', shellName);

      if (shellBinary) {
        terminal.writeString(`Starting ${shellName}...\r\n`);

        const cpm = workspace.createEmulator(terminal, {
          shellBinary,
          onExit: (info: CpmExitInfo) => {
            terminal.writeString('\r\n\r\n');
            terminal.writeString('================================\r\n');
            terminal.writeString('Program terminated\r\n');
            terminal.writeString('--------------------------------\r\n');
            terminal.writeString(`Reason: ${info.message}\r\n`);
            terminal.writeString(`T-states: ${info.tStates.toLocaleString()}\r\n`);
            terminal.writeString(`PC: 0x${info.pc.toString(16).toUpperCase().padStart(4, '0')}\r\n`);
            terminal.writeString('================================\r\n');
            terminal.writeString('\r\nClose window to exit.\r\n');
          },
          log: (msg) => console.log('[CPM]', msg)
        });

        // Enable syscall tracing (set to true for debugging)
        cpm.syscallTrace = true;

        terminal.focus(); // Focus terminal right before running
        cpm.run().catch(err => {
          terminal.writeString(`\r\n\r\nError: ${err.message}\r\n`);
          terminal.writeString('\r\nClose window to exit.\r\n');
        });
      } else {
        terminal.writeString(`Error: ${shellName} not found\r\n`);
        terminal.writeString('\r\nClose window to exit.\r\n');
      }
    } catch (err) {
      terminal.writeString(`\r\nError loading packages: ${err instanceof Error ? err.message : err}\r\n`);
      terminal.writeString('\r\nClose window to exit.\r\n');
    }
  });
}
