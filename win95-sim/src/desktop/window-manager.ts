/**
 * Window Manager - handles window creation, focus, minimize, maximize, close,
 * drag/resize, and taskbar integration.
 */

import { MenuManager } from '../menu';
import type { WindowConfig, WindowState } from './types';
import { isMobileViewport } from './types';

export class WindowManager {
  private windows = new Map<string, WindowState>();
  private activeWindowId: string | null = null;
  private zIndexCounter = 100;
  private windowIdCounter = 0;
  private desktop: HTMLElement;
  private taskArea: HTMLElement;
  private drag = { active: false, type: '' as '' | 'move' | 'resize', dir: '', startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0, windowId: null as string | null };
  private dragOutline: HTMLElement;
  private lastViewport = { width: window.innerWidth, height: window.innerHeight };
  private appSubmenu: HTMLElement;
  private menuManager: MenuManager;

  constructor(desktop: HTMLElement, taskArea: HTMLElement, menuManager: MenuManager) {
    this.desktop = desktop;
    this.taskArea = taskArea;
    this.menuManager = menuManager;

    document.addEventListener('mousemove', e => this.onMouseMove(e));
    document.addEventListener('mouseup', () => this.onMouseUp());
    document.addEventListener('touchmove', e => this.onTouchMove(e), { passive: false });
    document.addEventListener('touchend', () => this.onMouseUp());
    window.addEventListener('resize', () => this.onViewportResize());

    // Create drag outline element (lightweight border only)
    this.dragOutline = document.createElement('div');
    this.dragOutline.className = 'drag-outline';
    this.desktop.appendChild(this.dragOutline);

    // Create app submenu element
    this.appSubmenu = document.createElement('div');
    this.appSubmenu.id = 'app-submenu';
    this.appSubmenu.className = 'menu';
    this.desktop.appendChild(this.appSubmenu);
  }

  private onViewportResize() {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight - 28; // account for taskbar
    const oldWidth = this.lastViewport.width;
    const oldHeight = this.lastViewport.height - 28;

    const scaleX = newWidth / oldWidth;
    const scaleY = newHeight / oldHeight;

    this.windows.forEach((state, id) => {
      if (state.maximized) return;

      const win = document.getElementById(id);
      if (!win) return;

      // Scale position proportionally
      state.x = Math.round(state.x * scaleX);
      state.y = Math.round(state.y * scaleY);

      // Clamp to viewport bounds
      state.x = Math.max(0, Math.min(state.x, newWidth - 100));
      state.y = Math.max(0, Math.min(state.y, newHeight - 50));

      win.style.left = `${state.x}px`;
      win.style.top = `${state.y}px`;

      // Update prevState too so restore works correctly
      if (state.prevState) {
        state.prevState.x = Math.round(state.prevState.x * scaleX);
        state.prevState.y = Math.round(state.prevState.y * scaleY);
        state.prevState.x = Math.max(0, Math.min(state.prevState.x, newWidth - 100));
        state.prevState.y = Math.max(0, Math.min(state.prevState.y, newHeight - 50));
      }
    });

    this.lastViewport = { width: newWidth, height: newHeight + 28 };
  }

  create(config: WindowConfig): string {
    const id = `win-${this.windowIdCounter++}`;
    const width = config.width ?? 640;
    const height = config.height ?? 480;
    const x = config.x ?? 50 + (this.windowIdCounter * 30) % 200;
    const y = config.y ?? 50 + (this.windowIdCounter * 30) % 150;

    const state: WindowState = {
      id, title: config.title, x, y, width, height,
      minimized: false, maximized: false, zIndex: ++this.zIndexCounter,
      app: config.app, appName: config.appName, icon: config.icon
    };
    this.windows.set(id, state);

    const win = document.createElement('div');
    win.className = 'window';
    win.id = id;
    win.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:${state.zIndex}`;

    win.innerHTML = `
      <div class="window-titlebar">
        <div class="window-icon" style="${config.icon || ''}"></div>
        <div class="window-title">${config.title}</div>
        <div class="window-controls">
          <button class="window-btn btn-minimize"></button>
          <button class="window-btn btn-maximize"></button>
          <button class="window-btn btn-close"></button>
        </div>
      </div>
      <div class="window-content"></div>
      <div class="window-overlay"></div>
      <div class="resize-handle resize-n"></div>
      <div class="resize-handle resize-s"></div>
      <div class="resize-handle resize-e"></div>
      <div class="resize-handle resize-w"></div>
      <div class="resize-handle resize-ne"></div>
      <div class="resize-handle resize-nw"></div>
      <div class="resize-handle resize-se"></div>
      <div class="resize-handle resize-sw"></div>
    `;

    this.desktop.insertBefore(win, document.getElementById('taskbar'));
    this.updateTaskbar();
    this.bindEvents(id);
    this.focus(id);
    return id;
  }

  getApps(): Array<{ app: string; appName: string; icon?: string; windows: WindowState[]; hasActive: boolean }> {
    const apps = new Map<string, { appName: string; icon?: string; windows: WindowState[] }>();
    const ungrouped: WindowState[] = [];

    for (const state of this.windows.values()) {
      if (state.app) {
        if (!apps.has(state.app)) {
          apps.set(state.app, { appName: state.appName || state.app.split('.').pop() || state.app, icon: state.icon, windows: [] });
        }
        apps.get(state.app)!.windows.push(state);
      } else {
        ungrouped.push(state);
      }
    }

    const result: Array<{ app: string; appName: string; icon?: string; windows: WindowState[]; hasActive: boolean }> = [];

    for (const [app, data] of apps) {
      result.push({
        app,
        appName: data.appName,
        icon: data.icon,
        windows: data.windows,
        hasActive: data.windows.some(w => w.id === this.activeWindowId)
      });
    }

    // Ungrouped windows become their own "apps"
    for (const w of ungrouped) {
      result.push({
        app: w.id,
        appName: w.title,
        icon: w.icon,
        windows: [w],
        hasActive: w.id === this.activeWindowId
      });
    }

    return result;
  }

  private updateTaskbar() {
    this.taskArea.innerHTML = '';
    const apps = this.getApps();

    for (const app of apps) {
      const btn = document.createElement('button');
      btn.className = 'task-button' + (app.hasActive ? ' active' : '');
      btn.dataset.app = app.app;

      const count = app.windows.length;
      const countBadge = count > 1 ? `<span class="task-count">${count}</span>` : '';
      // Show active window title (or first), truncate from left to keep end visible
      const activeWin = app.windows.find(w => w.id === this.activeWindowId) || app.windows[0];
      btn.innerHTML = `<div class="icon" style="${app.icon || ''}"></div><span class="task-app-name">${app.appName} -</span><span class="task-window-title">${activeWin.title}</span>${countBadge}`;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Hide start menu and task switcher
        document.getElementById('start-menu')?.classList.remove('visible');
        document.getElementById('start-button')?.classList.remove('active');
        document.getElementById('task-switcher-menu')?.classList.remove('visible');
        document.getElementById('task-switcher')?.classList.remove('active');
        this.onTaskButtonClick(app.windows, btn);
      });

      this.taskArea.appendChild(btn);
    }
  }

  private onTaskButtonClick(windows: WindowState[], btn: HTMLElement) {
    const isMobile = isMobileViewport();

    if (windows.length === 1) {
      const w = windows[0];
      if (w.minimized) {
        this.restore(w.id);
      } else if (this.activeWindowId === w.id && !isMobile) {
        this.minimize(w.id);
      } else {
        this.focus(w.id);
      }
      return;
    }

    // Multiple windows - show submenu via MenuManager (handles toggle)
    this.menuManager.show(this.appSubmenu, btn, {
      align: 'left',
      onOpen: () => this.populateAppSubmenu(windows)
    });
  }

  private populateAppSubmenu(windows: WindowState[]) {
    this.appSubmenu.innerHTML = windows.map(w => `
      <div class="app-submenu-item${w.minimized ? ' minimized' : ''}${w.id === this.activeWindowId ? ' active' : ''}" data-window-id="${w.id}">
        <span>${w.title}</span>
      </div>
    `).join('');

    this.appSubmenu.querySelectorAll('.app-submenu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (item as HTMLElement).dataset.windowId!;
        this.restore(id);
        this.focus(id);
        this.menuManager.close();
      });
    });
  }

  private bindEvents(id: string) {
    const win = document.getElementById(id)!;
    const titlebar = win.querySelector('.window-titlebar')!;

    win.addEventListener('mousedown', () => this.focus(id));
    win.addEventListener('touchstart', () => this.focus(id));

    titlebar.addEventListener('mousedown', e => this.startMove(e as MouseEvent, id));
    titlebar.addEventListener('touchstart', e => this.startTouchMove(e as TouchEvent, id));
    titlebar.addEventListener('dblclick', () => this.toggleMaximize(id));

    win.querySelector('.btn-minimize')!.addEventListener('click', e => { e.stopPropagation(); this.minimize(id); });
    win.querySelector('.btn-maximize')!.addEventListener('click', e => { e.stopPropagation(); this.toggleMaximize(id); });
    win.querySelector('.btn-close')!.addEventListener('click', e => { e.stopPropagation(); this.close(id); });

    win.querySelectorAll('.resize-handle').forEach(h => {
      h.addEventListener('mousedown', e => this.startResize(e as MouseEvent, id, h.className.split(' ')[1].replace('resize-', '')));
    });
  }

  focus(id: string) {
    if (this.activeWindowId && this.activeWindowId !== id) {
      document.getElementById(this.activeWindowId)?.classList.add('inactive');
    }
    const state = this.windows.get(id)!;
    state.zIndex = ++this.zIndexCounter;
    const win = document.getElementById(id)!;
    win.classList.remove('inactive');
    win.style.zIndex = String(state.zIndex);
    this.activeWindowId = id;
    this.updateTaskbar();
    // Close all menus when focusing a window
    document.getElementById('start-menu')?.classList.remove('visible');
    document.getElementById('start-button')?.classList.remove('active');
    document.getElementById('app-submenu')?.classList.remove('visible');
    document.getElementById('task-switcher-menu')?.classList.remove('visible');
    document.getElementById('task-switcher')?.classList.remove('active');
    document.getElementById('theme-picker')?.classList.remove('visible');
  }

  minimize(id: string) {
    this.windows.get(id)!.minimized = true;
    document.getElementById(id)!.classList.add('minimized');
    if (this.activeWindowId === id) {
      this.activeWindowId = null;
      // Focus next non-minimized window
      for (const [wid, s] of this.windows) {
        if (!s.minimized && wid !== id) {
          this.focus(wid);
          return;
        }
      }
    }
    this.updateTaskbar();
  }

  restore(id: string) {
    this.windows.get(id)!.minimized = false;
    document.getElementById(id)!.classList.remove('minimized');
    this.focus(id);
  }

  toggleMaximize(id: string) {
    const state = this.windows.get(id)!;
    const win = document.getElementById(id)!;
    if (state.maximized) {
      state.maximized = false;
      win.classList.remove('maximized');
      if (state.prevState) {
        win.style.left = `${state.prevState.x}px`;
        win.style.top = `${state.prevState.y}px`;
        win.style.width = `${state.prevState.width}px`;
        win.style.height = `${state.prevState.height}px`;
      }
    } else {
      state.prevState = { x: state.x, y: state.y, width: state.width, height: state.height };
      state.maximized = true;
      win.classList.add('maximized');
    }
  }

  close(id: string) {
    this.windows.delete(id);
    document.getElementById(id)?.remove();
    // Close menus since window list changed
    this.menuManager.close();
    if (this.activeWindowId === id) {
      this.activeWindowId = null;
      // Focus next non-minimized window
      for (const [wid, s] of this.windows) {
        if (!s.minimized) {
          this.focus(wid);
          return;
        }
      }
    }
    this.updateTaskbar();
  }

  getContent(id: string): HTMLElement | null {
    return document.querySelector(`#${id} .window-content`);
  }

  setTitle(id: string, title: string) {
    const state = this.windows.get(id);
    if (state) state.title = title;
    const titleEl = document.querySelector(`#${id} .window-title`);
    if (titleEl) titleEl.textContent = title;
    this.updateTaskbar();
  }

  getWindows(): Array<{ id: string; title: string; minimized: boolean }> {
    return [...this.windows.entries()].map(([id, state]) => ({
      id,
      title: state.title,
      minimized: state.minimized
    }));
  }

  getWindowCount(): number {
    return this.windows.size;
  }

  getActiveWindowId(): string | null {
    return this.activeWindowId;
  }

  // Drag/Resize - uses outline for performance
  private showDragOutline(x: number, y: number, w: number, h: number) {
    this.dragOutline.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;display:block`;
  }

  private hideDragOutline() {
    this.dragOutline.style.display = 'none';
  }

  private startMove(e: MouseEvent, id: string) {
    // Disable drag on mobile viewports (windows are fullscreen)
    if (isMobileViewport()) return;
    if (this.windows.get(id)!.maximized) return;
    const s = this.windows.get(id)!;
    const win = document.getElementById(id)!;
    this.drag = { active: true, type: 'move', dir: '', startX: e.clientX, startY: e.clientY, startLeft: s.x, startTop: s.y, startWidth: win.offsetWidth, startHeight: win.offsetHeight, windowId: id };
    document.body.classList.add('dragging');
    this.showDragOutline(s.x, s.y, win.offsetWidth, win.offsetHeight);
  }

  private startTouchMove(e: TouchEvent, id: string) {
    // Disable drag on mobile viewports (windows are fullscreen)
    if (isMobileViewport()) return;
    if (this.windows.get(id)!.maximized) return;
    const s = this.windows.get(id)!;
    const win = document.getElementById(id)!;
    const t = e.touches[0];
    this.drag = { active: true, type: 'move', dir: '', startX: t.clientX, startY: t.clientY, startLeft: s.x, startTop: s.y, startWidth: win.offsetWidth, startHeight: win.offsetHeight, windowId: id };
    document.body.classList.add('dragging');
    this.showDragOutline(s.x, s.y, win.offsetWidth, win.offsetHeight);
  }

  private startResize(e: MouseEvent, id: string, dir: string) {
    e.stopPropagation();
    if (this.windows.get(id)!.maximized) return;
    const s = this.windows.get(id)!;
    const win = document.getElementById(id)!;
    this.drag = { active: true, type: 'resize', dir, startX: e.clientX, startY: e.clientY, startLeft: s.x, startTop: s.y, startWidth: win.offsetWidth, startHeight: win.offsetHeight, windowId: id };
    document.body.classList.add('dragging');
    this.showDragOutline(s.x, s.y, win.offsetWidth, win.offsetHeight);
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.drag.active || !this.drag.windowId) return;
    const dx = e.clientX - this.drag.startX;
    const dy = e.clientY - this.drag.startY;

    if (this.drag.type === 'move') {
      const x = this.drag.startLeft + dx;
      const y = Math.max(0, this.drag.startTop + dy);
      this.showDragOutline(x, y, this.drag.startWidth, this.drag.startHeight);
    } else {
      const d = this.drag.dir;
      let { startWidth: w, startHeight: h, startLeft: x, startTop: y } = this.drag;
      if (d.includes('e')) w = Math.max(200, w + dx);
      if (d.includes('w')) { const nw = Math.max(200, w - dx); if (nw > 200) x += dx; w = nw; }
      if (d.includes('s')) h = Math.max(100, h + dy);
      if (d.includes('n')) { const nh = Math.max(100, h - dy); if (nh > 100) y += dy; h = nh; }
      this.showDragOutline(x, y, w, h);
    }
  }

  private onTouchMove(e: TouchEvent) {
    if (!this.drag.active || this.drag.type !== 'move') return;
    e.preventDefault();
    const t = e.touches[0];
    const x = this.drag.startLeft + t.clientX - this.drag.startX;
    const y = Math.max(0, this.drag.startTop + t.clientY - this.drag.startY);
    this.showDragOutline(x, y, this.drag.startWidth, this.drag.startHeight);
  }

  private onMouseUp() {
    if (this.drag.active && this.drag.windowId) {
      const state = this.windows.get(this.drag.windowId)!;
      const win = document.getElementById(this.drag.windowId)!;
      const outline = this.dragOutline;

      // Apply final position from outline
      const x = parseInt(outline.style.left) || 0;
      const y = parseInt(outline.style.top) || 0;
      const w = parseInt(outline.style.width) || state.width;
      const h = parseInt(outline.style.height) || state.height;

      Object.assign(state, { x, y, width: w, height: h });
      win.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${state.zIndex}`;
    }
    document.body.classList.remove('dragging');
    this.hideDragOutline();
    this.drag = { active: false, type: '', dir: '', startX: 0, startY: 0, startLeft: 0, startTop: 0, startWidth: 0, startHeight: 0, windowId: null };
  }
}
