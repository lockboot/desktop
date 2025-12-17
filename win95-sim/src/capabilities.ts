// JSON Schema type (standard spec, allowing any valid keywords)
export interface JSONSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  [key: string]: unknown;
}

// Tool definition (MCP-compatible)
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

// Event definition
export interface EventDefinition {
  name: string;
  description?: string;
  schema?: JSONSchema;
}

// Complete capability manifest
export interface CapabilityManifest {
  name: string;
  version: string;
  description?: string;
  tools: ToolDefinition[];
  events: EventDefinition[];
}

// Internal storage entry
interface CapabilityEntry {
  manifest: CapabilityManifest;
  registeredBy: string;
  registeredAt: number;
}

// Capability Registry - stores and queries capability manifests
export class CapabilityRegistry {
  private prefix = 'cap:';
  private storage: Storage | Map<string, string>;
  private listeners = new Set<(path: string, manifest: CapabilityManifest | null) => void>();

  constructor(storage?: Storage | Map<string, string>) {
    this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : new Map());
  }

  // Register capabilities at a path
  register(path: string, manifest: CapabilityManifest, registeredBy: string): void {
    const entry: CapabilityEntry = {
      manifest,
      registeredBy,
      registeredAt: Date.now()
    };
    this.setItem(this.prefix + path, JSON.stringify(entry));
    this.notify(path, manifest);
  }

  // Unregister capabilities at a path
  unregister(path: string): void {
    this.removeItem(this.prefix + path);
    this.notify(path, null);
  }

  // Get manifest at exact path
  get(path: string): CapabilityManifest | null {
    const stored = this.getItem(this.prefix + path);
    if (!stored) return null;
    try {
      const entry = JSON.parse(stored) as CapabilityEntry;
      return entry.manifest;
    } catch {
      return null;
    }
  }

  // Get full entry (including metadata)
  getEntry(path: string): CapabilityEntry | null {
    const stored = this.getItem(this.prefix + path);
    if (!stored) return null;
    try {
      return JSON.parse(stored) as CapabilityEntry;
    } catch {
      return null;
    }
  }

  // List all paths with capabilities under a prefix
  list(prefix: string, depth?: number): string[] {
    const paths: string[] = [];
    const prefixWithDot = prefix ? prefix + '.' : '';
    const keys = this.getKeys();

    for (const key of keys) {
      if (!key.startsWith(this.prefix)) continue;
      const path = key.slice(this.prefix.length);

      // Check if path starts with prefix
      if (prefix && path !== prefix && !path.startsWith(prefixWithDot)) continue;

      // Check depth limit
      if (depth !== undefined && prefix) {
        const remaining = path.slice(prefixWithDot.length);
        const pathDepth = remaining ? remaining.split('.').length : 0;
        if (pathDepth > depth) continue;
      }

      paths.push(path);
    }

    return paths.sort();
  }

  // Get all registered paths
  getPaths(): string[] {
    return this.list('');
  }

  // Find paths that have tools matching a pattern
  findByTool(toolPattern: string): string[] {
    const regex = new RegExp('^' + toolPattern.replace(/\*/g, '.*') + '$');
    const results: string[] = [];

    for (const path of this.getPaths()) {
      const manifest = this.get(path);
      if (manifest?.tools.some(t => regex.test(t.name))) {
        results.push(path);
      }
    }

    return results;
  }

  // Find paths that emit events matching a pattern
  findByEvent(eventPattern: string): string[] {
    const regex = new RegExp('^' + eventPattern.replace(/\*/g, '.*') + '$');
    const results: string[] = [];

    for (const path of this.getPaths()) {
      const manifest = this.get(path);
      if (manifest?.events.some(e => regex.test(e.name))) {
        results.push(path);
      }
    }

    return results;
  }

  // Subscribe to capability changes
  onChange(callback: (path: string, manifest: CapabilityManifest | null) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(path: string, manifest: CapabilityManifest | null): void {
    this.listeners.forEach(cb => cb(path, manifest));
  }

  // Storage abstraction
  private getItem(key: string): string | null {
    if (this.storage instanceof Map) {
      return this.storage.get(key) ?? null;
    }
    return this.storage.getItem(key);
  }

  private setItem(key: string, value: string): void {
    if (this.storage instanceof Map) {
      this.storage.set(key, value);
    } else {
      this.storage.setItem(key, value);
    }
  }

  private removeItem(key: string): void {
    if (this.storage instanceof Map) {
      this.storage.delete(key);
    } else {
      this.storage.removeItem(key);
    }
  }

  private getKeys(): string[] {
    if (this.storage instanceof Map) {
      return [...this.storage.keys()];
    }
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  }
}

// Check if owner can register capabilities at target path
// Same rule as context: can only register at/below owner level
export function isValidCapabilityPath(ownerPath: string, targetPath: string): boolean {
  return targetPath === ownerPath || targetPath.startsWith(ownerPath + '.');
}
