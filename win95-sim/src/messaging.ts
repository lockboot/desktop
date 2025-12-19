// Context Store - hierarchical context with localStorage persistence
export class ContextStore {
  private prefix = 'ctx:';
  private storage: Storage | Map<string, string>;
  private listeners = new Set<(path: string, context: Record<string, unknown>) => void>();

  constructor(storage?: Storage | Map<string, string>) {
    // Allow injecting storage for testing
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : new Map());
  }

  // Set context at a specific level path (merges with existing)
  set(path: string, data: Record<string, unknown>) {
    const current = this.getLevel(path);
    const merged = { ...current, ...data };
    this.setItem(this.prefix + path, JSON.stringify(merged));
    this.notify(path);
  }

  // Replace context at a specific level (overwrites)
  replace(path: string, data: Record<string, unknown>) {
    this.setItem(this.prefix + path, JSON.stringify(data));
    this.notify(path);
  }

  // Get context at a specific level only
  getLevel(path: string): Record<string, unknown> {
    const stored = this.getItem(this.prefix + path);
    return stored ? JSON.parse(stored) : {};
  }

  // Get merged context for a full address
  // LDAP-style precedence: higher levels (closer to root) override lower levels
  // e.g., com.test's values override com.test.appA's values
  get(address: string): Record<string, unknown> {
    const parts = address.split('.');
    let result: Record<string, unknown> = {};
    let path = '';

    for (const part of parts) {
      path = path ? `${path}.${part}` : part;
      // Higher levels (earlier in iteration) take precedence
      // So we spread getLevel FIRST, then result on top (preserving higher-level values)
      result = { ...this.getLevel(path), ...result };
    }

    return result;
  }

  // Delete a key from context at a specific level
  delete(path: string, key: string) {
    const current = this.getLevel(path);
    delete current[key];
    this.setItem(this.prefix + path, JSON.stringify(current));
    this.notify(path);
  }

  // Clear context at a specific level
  clear(path: string) {
    this.removeItem(this.prefix + path);
    this.notify(path);
  }

  // Subscribe to context changes
  onChange(callback: (path: string, context: Record<string, unknown>) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(path: string) {
    const context = this.get(path);
    this.listeners.forEach(cb => cb(path, context));
  }

  // Storage abstraction for testing
  private getItem(key: string): string | null {
    if (this.storage instanceof Map) {
      return this.storage.get(key) ?? null;
    }
    return this.storage.getItem(key);
  }

  private setItem(key: string, value: string) {
    if (this.storage instanceof Map) {
      this.storage.set(key, value);
    } else {
      this.storage.setItem(key, value);
    }
  }

  private removeItem(key: string) {
    if (this.storage instanceof Map) {
      this.storage.delete(key);
    } else {
      this.storage.removeItem(key);
    }
  }
}

// Message types
export interface AppMessage {
  type: string;
  payload?: unknown;
  from?: string;  // full address: app.windowType.windowId
  to: string;     // regex pattern to match recipient addresses
}

// Mock iframe for testing
export interface IFrameLike {
  contentWindow: {
    postMessage: (msg: unknown, origin: string) => void;
  } | null;
}

// Message Bus - routes messages between windows using address patterns
export class MessageBus {
  private windows = new Map<string, { iframe: IFrameLike; origin: string; owner: string }>();
  private trustedOrigins = new Set<string>();
  onMessage?: (msg: AppMessage) => void;

  // For testing - track sent messages
  private sentMessages: Array<{ address: string; msg: AppMessage; origin: string }> = [];

  constructor() {
    // Only add listener in browser environment
    if (typeof window !== 'undefined') {
      window.addEventListener('message', e => this.handleMessage(e));
    }
  }

  // Register with owner (the app's domain, e.g., "com.test.appA")
  register(address: string, iframe: IFrameLike, origin: string, owner?: string) {
    // If owner not specified, derive from address (everything before last two parts: windowType.windowId)
    const derivedOwner = owner || address.split('.').slice(0, -2).join('.');
    this.windows.set(address, { iframe, origin, owner: derivedOwner });
    this.trustedOrigins.add(origin);
  }

  // Get owner for an address
  getOwner(address: string): string | undefined {
    return this.windows.get(address)?.owner;
  }

  unregister(address: string) {
    const win = this.windows.get(address);
    if (win) {
      this.windows.delete(address);
      const stillUsed = [...this.windows.values()].some(w => w.origin === win.origin);
      if (!stillUsed) this.trustedOrigins.delete(win.origin);
    }
  }

  // Resolve named shortcuts in patterns
  // @self     → sender's full address
  // @siblings → other instances of same app (same parent.*)
  // @app      → app namespace (parent of window id)
  // @cousins  → sibling apps (grandparent.*)
  // @workspace → workspace root (first 2 parts for workspace.N structure)
  resolvePattern(fromAddress: string, pattern: string): string {
    const parts = fromAddress.split('.');

    // Helper to escape for regex
    const esc = (s: string) => s.replace(/\./g, '\\.');

    // @self → exact match on sender
    if (pattern === '@self') {
      return esc(fromAddress);
    }

    // @app → parent namespace (remove window id)
    if (pattern === '@app') {
      return esc(parts.slice(0, -1).join('.'));
    }

    // @siblings → same app, any window (parent.*)
    if (pattern === '@siblings') {
      const appPath = parts.slice(0, -1).join('.');
      return esc(appPath) + '\\..*';
    }

    // @cousins → sibling apps (grandparent.*)
    if (pattern === '@cousins') {
      const grandparentPath = parts.slice(0, -2).join('.');
      return esc(grandparentPath) + '\\..*';
    }

    // @workspace → workspace root (assumes workspace.N.* structure)
    if (pattern === '@workspace') {
      // Find workspace root - typically first 2 parts (workspace.3)
      // But could be deeper, so we look for common patterns
      const workspacePath = parts.slice(0, 2).join('.');
      return esc(workspacePath) + '\\..*';
    }

    // @parent → immediate parent namespace
    if (pattern === '@parent') {
      return esc(parts.slice(0, -1).join('.'));
    }

    // No shortcut, return as-is
    return pattern;
  }

  // Send to all windows matching the regex pattern
  send(msg: AppMessage, excludeAddress?: string) {
    // Resolve shortcuts if sender address is known
    const resolvedTo = msg.from ? this.resolvePattern(msg.from, msg.to) : msg.to;
    const pattern = new RegExp(`^${resolvedTo}$`);
    this.windows.forEach((win, address) => {
      if (address !== excludeAddress && pattern.test(address) && win.iframe.contentWindow) {
        win.iframe.contentWindow.postMessage(msg, win.origin);
        this.sentMessages.push({ address, msg, origin: win.origin });
      }
    });
  }

  // For testing - check which addresses match a pattern
  getMatchingAddresses(pattern: string): string[] {
    const regex = new RegExp(`^${pattern}$`);
    return [...this.windows.keys()].filter(addr => regex.test(addr));
  }

  // For testing - get sent messages
  getSentMessages() {
    return this.sentMessages;
  }

  // For testing - clear sent messages
  clearSentMessages() {
    this.sentMessages = [];
  }

  // For testing - simulate receiving a message
  simulateMessage(fromAddress: string, msg: AppMessage) {
    const win = this.windows.get(fromAddress);
    if (!win) return;

    msg.from = fromAddress;
    this.send(msg, fromAddress);
    this.onMessage?.(msg);
  }

  handleMessage(event: MessageEvent) {
    if (!this.trustedOrigins.has(event.origin)) return;

    const fromAddress = this.findAddressByWindow(event.source as Window);
    if (!fromAddress) return;

    const msg = event.data as AppMessage;
    if (!msg.to) return;

    msg.from = fromAddress;
    this.send(msg, fromAddress);
    this.onMessage?.(msg);
  }

  private findAddressByWindow(win: Window): string | undefined {
    for (const [address, w] of this.windows) {
      if (w.iframe.contentWindow === win) return address;
    }
  }

  // Get all registered addresses
  getAddresses(): string[] {
    return [...this.windows.keys()];
  }
}

// Helper to check if sender can modify context at given path
// ownerPath is the app's domain (e.g., "com.test.appA") - they can only write at or below this
export function isValidContextPath(ownerPath: string, targetPath: string): boolean {
  // Target must start with owner path (equal or deeper)
  // e.g., owner "com.test.appA" can write to:
  //   - "com.test.appA" ✓
  //   - "com.test.appA.settings" ✓
  //   - "com.test.appA.main.win-0" ✓
  // but NOT:
  //   - "com.test" ✗
  //   - "com.test.appB" ✗
  return targetPath === ownerPath || targetPath.startsWith(ownerPath + '.');
}
