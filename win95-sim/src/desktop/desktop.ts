/**
 * Desktop - main container that coordinates window manager, taskbar,
 * message bus, context store, and capability registry.
 */

import { MessageBus, ContextStore, isValidContextPath } from '../messaging';
import type { AppMessage } from '../messaging';
import { IframeAppElement, AppMessageEvent, AppReadyEvent } from '../components';
import { CapabilityRegistry, isValidCapabilityPath } from '../capabilities';
import type { CapabilityManifest } from '../capabilities';
import { MenuManager } from '../menu';
import { WindowManager } from './window-manager';
import { Taskbar } from './taskbar';
import type { AppWindowConfig } from './types';

export class Desktop {
  readonly element: HTMLElement;
  readonly menuManager: MenuManager;
  readonly wm: WindowManager;
  readonly taskbar: Taskbar;
  readonly bus: MessageBus;
  readonly context: ContextStore;
  readonly capabilities: CapabilityRegistry;
  private appWindows = new Map<string, string>(); // address -> windowId

  constructor(container: HTMLElement) {
    container.innerHTML = `<div id="desktop"><div id="taskbar"><button id="start-button"><div class="win-logo"></div><span>Start</span></button><div id="task-area"></div><button id="task-switcher"><span class="arrow">^</span><span class="count"></span></button><div id="system-tray"><div class="tray-icon"></div><div id="clock"></div></div></div><div id="start-menu"><div id="start-menu-sidebar"><span>OS/402 Desktop</span></div><div id="start-menu-items"></div></div><div id="task-switcher-menu" class="menu"></div></div>`;

    this.element = document.getElementById('desktop')!;
    this.menuManager = new MenuManager(this.element);
    this.wm = new WindowManager(this.element, document.getElementById('task-area')!, this.menuManager);
    this.taskbar = new Taskbar(this.menuManager);
    this.bus = new MessageBus();
    this.context = new ContextStore();
    this.capabilities = new CapabilityRegistry();

    this.setupContextBus();
    this.setupCapabilityBus();
    this.setupTaskSwitcher();
    this.registerSystemCapabilities();
  }

  private setupContextBus() {
    // Handle context messages from apps
    this.bus.onMessage = (msg) => {
      if (!msg.from) return;

      // Get the app's owner (domain) - they can only write at or below this level
      const owner = this.bus.getOwner(msg.from);
      if (!owner) return;

      switch (msg.type) {
        case 'context:set': {
          const { path, data } = msg.payload as { path: string; data: Record<string, unknown> };
          // Validate: path must be at or below owner's domain
          if (isValidContextPath(owner, path)) {
            this.context.set(path, data);
            this.broadcastContextChange(path);
          } else {
            console.warn(`[Context] Denied: ${msg.from} tried to set ${path} (owner: ${owner})`);
          }
          break;
        }

        case 'context:get': {
          // Send back merged context for the requested path (or sender's path)
          // Reading is allowed from any level (context cascades down)
          const { path } = (msg.payload as { path?: string }) || {};
          const targetPath = path || msg.from;
          const context = this.context.get(targetPath);
          this.bus.send({
            type: 'context:value',
            to: msg.from.replace(/\./g, '\\.'),
            payload: { path: targetPath, context }
          });
          break;
        }

        case 'context:delete': {
          const { path, key } = msg.payload as { path: string; key: string };
          if (isValidContextPath(owner, path)) {
            this.context.delete(path, key);
            this.broadcastContextChange(path);
          } else {
            console.warn(`[Context] Denied: ${msg.from} tried to delete from ${path}`);
          }
          break;
        }

        case 'context:clear': {
          const { path } = msg.payload as { path: string };
          if (isValidContextPath(owner, path)) {
            this.context.clear(path);
            this.broadcastContextChange(path);
          } else {
            console.warn(`[Context] Denied: ${msg.from} tried to clear ${path}`);
          }
          break;
        }
      }
    };

    // When context changes locally, broadcast to affected apps
    this.context.onChange((path, context) => {
      console.log(`[Context] ${path}:`, context);
    });
  }

  // Broadcast context change to all windows whose address starts with path
  // Each window receives their own merged context (not just the changed level)
  private broadcastContextChange(changedPath: string) {
    const pattern = changedPath.replace(/\./g, '\\.') + '.*';
    const matchingAddresses = this.bus.getMatchingAddresses(pattern);

    for (const address of matchingAddresses) {
      // Send each window their full merged context
      this.bus.send({
        type: 'context:changed',
        to: address.replace(/\./g, '\\.'),
        payload: {
          changedPath,  // What path triggered the change
          context: this.context.get(address)  // Merged context at THEIR level
        }
      });
    }
  }

  private setupCapabilityBus() {
    // Extend existing onMessage handler to also handle capability messages
    const existingHandler = this.bus.onMessage;

    this.bus.onMessage = (msg) => {
      // Call existing context handler first
      existingHandler?.(msg);

      if (!msg.from) return;
      const owner = this.bus.getOwner(msg.from);

      switch (msg.type) {
        case 'capability:register': {
          const { path, manifest } = msg.payload as { path: string; manifest: CapabilityManifest };
          if (owner && isValidCapabilityPath(owner, path)) {
            this.capabilities.register(path, manifest, msg.from);
            this.broadcastCapabilityChange(path, 'registered', manifest);
          } else {
            console.warn(`[Capability] Denied: ${msg.from} tried to register at ${path} (owner: ${owner})`);
          }
          break;
        }

        case 'capability:unregister': {
          const { path } = msg.payload as { path: string };
          if (owner && isValidCapabilityPath(owner, path)) {
            this.capabilities.unregister(path);
            this.broadcastCapabilityChange(path, 'unregistered', null);
          } else {
            console.warn(`[Capability] Denied: ${msg.from} tried to unregister ${path}`);
          }
          break;
        }

        case 'capability:query': {
          const { path } = msg.payload as { path: string };
          const manifest = this.capabilities.get(path);
          this.bus.send({
            type: 'capability:result',
            to: msg.from.replace(/\./g, '\\.'),
            payload: { path, manifest }
          });
          break;
        }

        case 'capability:list': {
          const { prefix, depth } = msg.payload as { prefix: string; depth?: number };
          const paths = this.capabilities.list(prefix, depth);
          this.bus.send({
            type: 'capability:list-result',
            to: msg.from.replace(/\./g, '\\.'),
            payload: { prefix, paths }
          });
          break;
        }
      }
    };

    // Log capability changes
    this.capabilities.onChange((path, manifest) => {
      console.log(`[Capability] ${path}:`, manifest ? manifest.name : 'unregistered');
    });
  }

  private broadcastCapabilityChange(path: string, changeType: 'registered' | 'unregistered', manifest: CapabilityManifest | null) {
    this.bus.send({
      type: 'capability:changed',
      to: '.*',  // Broadcast to everyone
      from: 'system',
      payload: { path, changeType, manifest }
    });
  }

  private registerSystemCapabilities() {
    this.capabilities.register('system', {
      name: 'Desktop',
      version: '1.0.0',
      description: 'Win95 Desktop system services',
      tools: [
        {
          name: 'context_get',
          description: 'Get context at a path',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
        },
        {
          name: 'context_set',
          description: 'Set context at a path',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              data: { type: 'object' }
            },
            required: ['path', 'data']
          }
        },
        {
          name: 'context_delete',
          description: 'Delete a key from context',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              key: { type: 'string' }
            },
            required: ['path', 'key']
          }
        },
        {
          name: 'context_clear',
          description: 'Clear context at a path',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        },
        {
          name: 'capability_query',
          description: 'Query capabilities at a path',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
        },
        {
          name: 'capability_list',
          description: 'List paths with capabilities',
          inputSchema: {
            type: 'object',
            properties: {
              prefix: { type: 'string' },
              depth: { type: 'integer' }
            }
          }
        },
        {
          name: 'capability_register',
          description: 'Register capabilities at a path',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              manifest: { type: 'object' }
            },
            required: ['path', 'manifest']
          }
        }
      ],
      events: [
        {
          name: 'system:app-launched',
          description: 'App window launched',
          schema: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              owner: { type: 'string' },
              windowType: { type: 'string' }
            }
          }
        },
        {
          name: 'system:app-closed',
          description: 'App window closed',
          schema: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              owner: { type: 'string' },
              windowType: { type: 'string' }
            }
          }
        },
        {
          name: 'context:changed',
          description: 'Context changed at a path',
          schema: {
            type: 'object',
            properties: {
              changedPath: { type: 'string' },
              context: { type: 'object' }
            }
          }
        },
        {
          name: 'capability:changed',
          description: 'Capability registered or unregistered',
          schema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              changeType: { type: 'string', enum: ['registered', 'unregistered'] },
              manifest: { type: 'object' }
            }
          }
        }
      ]
    }, 'system');
  }

  private setupTaskSwitcher() {
    const btn = document.getElementById('task-switcher')!;
    const menu = document.getElementById('task-switcher-menu')!;
    const countEl = btn.querySelector('.count')!;

    const updateCount = () => {
      // Count actual windows from getApps to ensure consistency with menu
      const apps = this.wm.getApps();
      const count = apps.reduce((sum, app) => sum + app.windows.length, 0);
      countEl.textContent = count > 0 ? String(count) : '';
      btn.style.display = count > 0 ? 'flex' : 'none';
    };

    // Observe task-area for changes to update count
    const observer = new MutationObserver(updateCount);
    observer.observe(document.getElementById('task-area')!, { childList: true });
    updateCount();

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuManager.show(menu, btn, {
        align: 'auto',
        onOpen: () => {
          const apps = this.wm.getApps();
          const activeId = this.wm.getActiveWindowId();

          // Build menu with apps, each showing its windows
          menu.innerHTML = apps.map(app => {
            const windowItems = app.windows.map(w => `
              <div class="task-switcher-window${w.minimized ? ' minimized' : ''}${w.id === activeId ? ' active' : ''}" data-window-id="${w.id}">
                ${w.title}
              </div>
            `).join('');

            return `
              <div class="task-switcher-app${app.hasActive ? ' active' : ''}" data-app="${app.app}">
                <div class="task-switcher-app-header">${app.appName} (${app.windows.length})</div>
                <div class="task-switcher-app-windows">${windowItems}</div>
              </div>
            `;
          }).join('');

          // Bind click events for windows
          menu.querySelectorAll('.task-switcher-window').forEach(item => {
            item.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const id = (item as HTMLElement).dataset.windowId!;
              this.wm.restore(id);
              this.wm.focus(id);
              this.menuManager.close();
            });
          });
        }
      });
    });
  }

  createApp(config: AppWindowConfig): { windowId: string; address: string } {
    const windowId = this.wm.create(config);
    const address = `${config.app}.${config.windowType}.${windowId}`;
    const owner = config.app;
    const content = this.wm.getContent(windowId)!;

    // Use web component instead of raw iframe
    const appEl = document.createElement('win95-iframe-app') as IframeAppElement;
    appEl.setAttribute('address', address);
    appEl.setAttribute('src', config.src);

    // Add event listeners BEFORE appendChild (connectedCallback fires synchronously)
    appEl.addEventListener('app-ready', ((e: AppReadyEvent) => {
      this.bus.register(e.detail.address, appEl, config.origin);
      this.appWindows.set(e.detail.address, windowId);
      // Broadcast launch notification
      this.broadcastLifecycle('system:app-launched', address, owner, config.windowType);
    }) as EventListener);

    // Listen for app-message event to route through bus
    appEl.addEventListener('app-message', ((e: AppMessageEvent) => {
      const msg = { ...e.detail, from: address } as AppMessage;
      this.bus.send(msg, address);
      this.bus.onMessage?.(msg);
    }) as EventListener);

    content.appendChild(appEl);

    // Unregister when window closes
    const origClose = this.wm.close.bind(this.wm);
    const checkClose = (id: string) => {
      if (id === windowId) {
        this.bus.unregister(address);
        this.appWindows.delete(address);
        // Broadcast close notification
        this.broadcastLifecycle('system:app-closed', address, owner, config.windowType);
      }
      origClose(id);
    };
    this.wm.close = checkClose;

    return { windowId, address };
  }

  // Create app with inline HTML (srcdoc) - useful for test/demo apps
  createInlineApp(config: Omit<AppWindowConfig, 'src' | 'origin'> & { html: string }): { windowId: string; address: string } {
    const windowId = this.wm.create(config);
    const address = `${config.app}.${config.windowType}.${windowId}`;
    const owner = config.app;
    const content = this.wm.getContent(windowId)!;

    // Inject the address into the HTML (replace all occurrences)
    const htmlWithAddress = config.html.replaceAll('{{ADDRESS}}', address);

    // Use web component instead of raw iframe
    const appEl = document.createElement('win95-iframe-app') as IframeAppElement;
    appEl.setAttribute('address', address);
    appEl.setAttribute('srcdoc', htmlWithAddress);

    // Add event listeners BEFORE appendChild (connectedCallback fires synchronously)
    appEl.addEventListener('app-ready', ((e: AppReadyEvent) => {
      // srcdoc iframes have same origin as parent
      this.bus.register(e.detail.address, appEl, location.origin);
      this.appWindows.set(e.detail.address, windowId);
      // Broadcast launch notification
      this.broadcastLifecycle('system:app-launched', address, owner, config.windowType);
    }) as EventListener);

    // Listen for app-message event to route through bus
    appEl.addEventListener('app-message', ((e: AppMessageEvent) => {
      const msg = { ...e.detail, from: address } as AppMessage;
      this.bus.send(msg, address);
      this.bus.onMessage?.(msg);
    }) as EventListener);

    content.appendChild(appEl);

    // Unregister when window closes
    const origClose = this.wm.close.bind(this.wm);
    const checkClose = (id: string) => {
      if (id === windowId) {
        this.bus.unregister(address);
        this.appWindows.delete(address);
        // Broadcast close notification
        this.broadcastLifecycle('system:app-closed', address, owner, config.windowType);
      }
      origClose(id);
    };
    this.wm.close = checkClose;

    return { windowId, address };
  }

  // Broadcast lifecycle events to all windows
  private broadcastLifecycle(type: string, address: string, owner: string, windowType: string) {
    this.bus.send({
      type,
      to: '.*',  // Broadcast to everyone
      from: 'system',
      payload: { address, owner, windowType }
    });

    // Auto-cleanup capabilities when app closes
    if (type === 'system:app-closed') {
      const manifest = this.capabilities.get(address);
      if (manifest) {
        this.capabilities.unregister(address);
        this.broadcastCapabilityChange(address, 'unregistered', null);
      }
    }
  }
}
