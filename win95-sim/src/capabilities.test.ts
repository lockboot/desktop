import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CapabilityRegistry,
  isValidCapabilityPath
} from './capabilities';
import type { CapabilityManifest } from './capabilities';

// Sample manifests for testing
const chatManifest: CapabilityManifest = {
  name: 'Chat',
  version: '1.0.0',
  description: 'Chat application',
  tools: [
    {
      name: 'chat_send',
      description: 'Send a message',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          channel: { type: 'string' }
        },
        required: ['text']
      }
    },
    {
      name: 'chat_typing',
      description: 'Set typing indicator',
      inputSchema: {
        type: 'object',
        properties: {
          typing: { type: 'boolean' }
        }
      }
    }
  ],
  events: [
    {
      name: 'chat:received',
      description: 'Message received',
      schema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          text: { type: 'string' }
        }
      }
    }
  ]
};

const notesManifest: CapabilityManifest = {
  name: 'Notes',
  version: '1.0.0',
  tools: [
    {
      name: 'notes_create',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } }
    },
    {
      name: 'notes_delete',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } }
    }
  ],
  events: []
};

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    registry = new CapabilityRegistry(storage);
  });

  describe('register and get', () => {
    it('should register and retrieve a manifest', () => {
      registry.register('com.acme.chat', chatManifest, 'com.acme.chat.main.win-0');

      const result = registry.get('com.acme.chat');
      expect(result).toEqual(chatManifest);
    });

    it('should return null for unregistered path', () => {
      const result = registry.get('com.acme.unknown');
      expect(result).toBeNull();
    });

    it('should store metadata in entry', () => {
      registry.register('com.acme.chat', chatManifest, 'com.acme.chat.main.win-0');

      const entry = registry.getEntry('com.acme.chat');
      expect(entry).not.toBeNull();
      expect(entry!.registeredBy).toBe('com.acme.chat.main.win-0');
      expect(entry!.registeredAt).toBeGreaterThan(0);
    });

    it('should overwrite existing registration', () => {
      registry.register('com.acme.chat', chatManifest, 'win-0');

      const updatedManifest = { ...chatManifest, version: '2.0.0' };
      registry.register('com.acme.chat', updatedManifest, 'win-1');

      const result = registry.get('com.acme.chat');
      expect(result?.version).toBe('2.0.0');
    });
  });

  describe('unregister', () => {
    it('should remove a registration', () => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.unregister('com.acme.chat');

      expect(registry.get('com.acme.chat')).toBeNull();
    });

    it('should not throw for non-existent path', () => {
      expect(() => registry.unregister('com.acme.unknown')).not.toThrow();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.register('com.acme.chat.main.win-0', chatManifest, 'win-0');
      registry.register('com.acme.chat.settings.win-0', chatManifest, 'win-0');
      registry.register('com.acme.notes', notesManifest, 'win-0');
      registry.register('org.other.app', chatManifest, 'win-0');
    });

    it('should list all paths under prefix', () => {
      const paths = registry.list('com.acme');
      expect(paths).toContain('com.acme.chat');
      expect(paths).toContain('com.acme.chat.main.win-0');
      expect(paths).toContain('com.acme.chat.settings.win-0');
      expect(paths).toContain('com.acme.notes');
      expect(paths).not.toContain('org.other.app');
    });

    it('should list paths with depth limit', () => {
      const paths = registry.list('com.acme', 1);
      expect(paths).toContain('com.acme.chat');
      expect(paths).toContain('com.acme.notes');
      expect(paths).not.toContain('com.acme.chat.main.win-0');
    });

    it('should list all paths with empty prefix', () => {
      const paths = registry.list('');
      expect(paths).toHaveLength(5);
    });

    it('should return sorted paths', () => {
      const paths = registry.list('com.acme');
      expect(paths).toEqual([...paths].sort());
    });
  });

  describe('getPaths', () => {
    it('should return all registered paths', () => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.register('com.acme.notes', notesManifest, 'win-0');

      const paths = registry.getPaths();
      expect(paths).toHaveLength(2);
      expect(paths).toContain('com.acme.chat');
      expect(paths).toContain('com.acme.notes');
    });
  });

  describe('findByTool', () => {
    beforeEach(() => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.register('com.acme.notes', notesManifest, 'win-0');
    });

    it('should find paths with exact tool name', () => {
      const paths = registry.findByTool('chat_send');
      expect(paths).toEqual(['com.acme.chat']);
    });

    it('should find paths with wildcard pattern', () => {
      const paths = registry.findByTool('chat_*');
      expect(paths).toEqual(['com.acme.chat']);
    });

    it('should find paths with prefix wildcard', () => {
      const paths = registry.findByTool('notes_*');
      expect(paths).toEqual(['com.acme.notes']);
    });

    it('should return empty for no matches', () => {
      const paths = registry.findByTool('unknown_*');
      expect(paths).toEqual([]);
    });
  });

  describe('findByEvent', () => {
    beforeEach(() => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.register('com.acme.notes', notesManifest, 'win-0');
    });

    it('should find paths with exact event name', () => {
      const paths = registry.findByEvent('chat:received');
      expect(paths).toEqual(['com.acme.chat']);
    });

    it('should find paths with wildcard pattern', () => {
      const paths = registry.findByEvent('chat:*');
      expect(paths).toEqual(['com.acme.chat']);
    });

    it('should return empty for no matches', () => {
      const paths = registry.findByEvent('notes:*');
      expect(paths).toEqual([]);
    });
  });

  describe('onChange', () => {
    it('should notify on register', () => {
      const handler = vi.fn();
      registry.onChange(handler);

      registry.register('com.acme.chat', chatManifest, 'win-0');

      expect(handler).toHaveBeenCalledWith('com.acme.chat', chatManifest);
    });

    it('should notify on unregister with null', () => {
      const handler = vi.fn();
      registry.register('com.acme.chat', chatManifest, 'win-0');

      registry.onChange(handler);
      registry.unregister('com.acme.chat');

      expect(handler).toHaveBeenCalledWith('com.acme.chat', null);
    });

    it('should unsubscribe correctly', () => {
      const handler = vi.fn();
      const unsub = registry.onChange(handler);

      registry.register('com.acme.chat', chatManifest, 'win-0');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      registry.register('com.acme.notes', notesManifest, 'win-0');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('persistence', () => {
    it('should persist to storage', () => {
      registry.register('com.acme.chat', chatManifest, 'win-0');

      expect(storage.has('cap:com.acme.chat')).toBe(true);
    });

    it('should load from existing storage', () => {
      // Pre-populate storage
      storage.set('cap:com.acme.chat', JSON.stringify({
        manifest: chatManifest,
        registeredBy: 'win-0',
        registeredAt: Date.now()
      }));

      // New registry should find it
      const newRegistry = new CapabilityRegistry(storage);
      expect(newRegistry.get('com.acme.chat')).toEqual(chatManifest);
    });

    it('should remove from storage on unregister', () => {
      registry.register('com.acme.chat', chatManifest, 'win-0');
      registry.unregister('com.acme.chat');

      expect(storage.has('cap:com.acme.chat')).toBe(false);
    });
  });
});

describe('isValidCapabilityPath', () => {
  it('should allow registering at owner level', () => {
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme.chat')).toBe(true);
  });

  it('should allow registering below owner level', () => {
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme.chat.settings')).toBe(true);
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme.chat.main.win-0')).toBe(true);
  });

  it('should deny registering above owner level', () => {
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme')).toBe(false);
    expect(isValidCapabilityPath('com.acme.chat', 'com')).toBe(false);
  });

  it('should deny registering at sibling paths', () => {
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme.notes')).toBe(false);
    expect(isValidCapabilityPath('com.acme.chat', 'com.acme.chat2')).toBe(false);
  });

  it('should deny registering at unrelated paths', () => {
    expect(isValidCapabilityPath('com.acme.chat', 'org.other.app')).toBe(false);
  });
});
