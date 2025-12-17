/**
 * Main entry point - initializes the desktop and registers all applications.
 */

import './style.css';
import { registerComponents } from './components';
import { Desktop, WindowManager, Taskbar } from './desktop';
import type { WindowConfig, AppWindowConfig } from './desktop';
import { MessageBus, ContextStore } from './messaging';
import type { AppMessage } from './messaging';
import { registerDemoApps, registerCpmTerminal, registerWorkspaceManager, registerThemePicker } from './apps';

// Register custom elements
registerComponents();

// Initialize desktop
const desktop = new Desktop(document.getElementById('app')!);

// Register all applications
registerDemoApps(desktop);
registerCpmTerminal(desktop);
registerWorkspaceManager(desktop);
registerThemePicker(desktop);

// Export for external use
export { desktop, Desktop, WindowManager, Taskbar, MessageBus, ContextStore };
export type { WindowConfig, AppWindowConfig, AppMessage };
