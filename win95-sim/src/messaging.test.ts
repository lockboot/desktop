import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBus, ContextStore, isValidContextPath } from './messaging';
import type { IFrameLike, AppMessage } from './messaging';

// Mock iframe factory
function createMockIframe(): IFrameLike & { messages: AppMessage[] } {
  const messages: AppMessage[] = [];
  return {
    messages,
    contentWindow: {
      postMessage: (msg: unknown) => {
        messages.push(msg as AppMessage);
      }
    }
  };
}

describe('MessageBus', () => {
  let bus: MessageBus;
  let iframeA1: ReturnType<typeof createMockIframe>;
  let iframeA2: ReturnType<typeof createMockIframe>;
  let iframeB1: ReturnType<typeof createMockIframe>;

  beforeEach(() => {
    bus = new MessageBus();
    iframeA1 = createMockIframe();
    iframeA2 = createMockIframe();
    iframeB1 = createMockIframe();

    // Register windows with hierarchical addresses
    bus.register('com.test.appA.main.win-0', iframeA1, 'http://localhost');
    bus.register('com.test.appA.main.win-1', iframeA2, 'http://localhost');
    bus.register('com.test.appB.main.win-0', iframeB1, 'http://localhost');
  });

  describe('address matching', () => {
    it('should match exact address', () => {
      const matches = bus.getMatchingAddresses('com\\.test\\.appA\\.main\\.win-0');
      expect(matches).toEqual(['com.test.appA.main.win-0']);
    });

    it('should match all windows in an app with wildcard', () => {
      const matches = bus.getMatchingAddresses('com\\.test\\.appA\\..*');
      expect(matches).toHaveLength(2);
      expect(matches).toContain('com.test.appA.main.win-0');
      expect(matches).toContain('com.test.appA.main.win-1');
    });

    it('should match all windows in com.test with wildcard', () => {
      const matches = bus.getMatchingAddresses('com\\.test\\..*');
      expect(matches).toHaveLength(3);
    });

    it('should match specific window type', () => {
      const matches = bus.getMatchingAddresses('com\\.test\\.appA\\.main\\..*');
      expect(matches).toHaveLength(2);
    });

    it('should not match different app', () => {
      const matches = bus.getMatchingAddresses('com\\.test\\.appC\\..*');
      expect(matches).toHaveLength(0);
    });
  });

  describe('message routing', () => {
    it('should send to exact address', () => {
      bus.send({ type: 'test', to: 'com\\.test\\.appA\\.main\\.win-0', payload: { data: 1 } });

      expect(iframeA1.messages).toHaveLength(1);
      expect(iframeA1.messages[0].type).toBe('test');
      expect(iframeA2.messages).toHaveLength(0);
      expect(iframeB1.messages).toHaveLength(0);
    });

    it('should broadcast to all windows in app', () => {
      bus.send({ type: 'broadcast', to: 'com\\.test\\.appA\\..*', payload: {} });

      expect(iframeA1.messages).toHaveLength(1);
      expect(iframeA2.messages).toHaveLength(1);
      expect(iframeB1.messages).toHaveLength(0);
    });

    it('should broadcast to all windows', () => {
      bus.send({ type: 'global', to: '.*', payload: {} });

      expect(iframeA1.messages).toHaveLength(1);
      expect(iframeA2.messages).toHaveLength(1);
      expect(iframeB1.messages).toHaveLength(1);
    });

    it('should exclude sender when specified', () => {
      bus.send(
        { type: 'test', to: 'com\\.test\\.appA\\..*', payload: {} },
        'com.test.appA.main.win-0'
      );

      expect(iframeA1.messages).toHaveLength(0); // excluded
      expect(iframeA2.messages).toHaveLength(1);
    });

    it('should simulate message from app and route correctly', () => {
      const received: AppMessage[] = [];
      bus.onMessage = (msg) => received.push(msg);

      bus.simulateMessage('com.test.appA.main.win-0', {
        type: 'chat',
        to: 'com\\.test\\.appA\\..*',
        payload: { text: 'hello' }
      });

      // Should be sent to win-1 (not win-0 which is sender)
      expect(iframeA1.messages).toHaveLength(0);
      expect(iframeA2.messages).toHaveLength(1);
      expect(iframeA2.messages[0].from).toBe('com.test.appA.main.win-0');

      // onMessage should be called
      expect(received).toHaveLength(1);
      expect(received[0].from).toBe('com.test.appA.main.win-0');
    });

    it('should handle test app broadcast pattern (escaped in JS)', () => {
      // This is what the test app actually sends after JS string escaping
      // Template: appPath + '\\\\..*' becomes 'com.test.appA' + '\..*' = 'com.test.appA\..*'
      const pattern = 'com.test.appA\\..*';

      const matches = bus.getMatchingAddresses(pattern);
      expect(matches).toHaveLength(2);
      expect(matches).toContain('com.test.appA.main.win-0');
      expect(matches).toContain('com.test.appA.main.win-1');
    });

    it('should route test app broadcast to other windows', () => {
      bus.clearSentMessages();

      // Simulate what test app sends
      bus.simulateMessage('com.test.appA.main.win-0', {
        type: 'broadcast',
        to: 'com.test.appA\\..*',  // After JS escaping in template
        payload: { message: 'hello' }
      });

      // win-0 is sender, win-1 should receive, appB should not
      expect(iframeA1.messages).toHaveLength(0);
      expect(iframeA2.messages).toHaveLength(1);
      expect(iframeA2.messages[0].type).toBe('broadcast');
      expect(iframeB1.messages).toHaveLength(0);
    });
  });

  describe('registration', () => {
    it('should unregister window', () => {
      bus.unregister('com.test.appA.main.win-0');

      const matches = bus.getMatchingAddresses('com\\.test\\.appA\\..*');
      expect(matches).toHaveLength(1);
      expect(matches).toContain('com.test.appA.main.win-1');
    });

    it('should list all addresses', () => {
      const addresses = bus.getAddresses();
      expect(addresses).toHaveLength(3);
    });
  });
});

describe('ContextStore', () => {
  let store: ContextStore;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    store = new ContextStore(storage);
  });

  describe('basic operations', () => {
    it('should set and get context at a level', () => {
      store.set('com.test', { theme: 'dark' });

      expect(store.getLevel('com.test')).toEqual({ theme: 'dark' });
    });

    it('should merge context on set', () => {
      store.set('com.test', { theme: 'dark' });
      store.set('com.test', { user: 'john' });

      expect(store.getLevel('com.test')).toEqual({ theme: 'dark', user: 'john' });
    });

    it('should replace context completely', () => {
      store.set('com.test', { theme: 'dark', user: 'john' });
      store.replace('com.test', { theme: 'light' });

      expect(store.getLevel('com.test')).toEqual({ theme: 'light' });
    });

    it('should delete specific key', () => {
      store.set('com.test', { theme: 'dark', user: 'john' });
      store.delete('com.test', 'theme');

      expect(store.getLevel('com.test')).toEqual({ user: 'john' });
    });

    it('should clear context at level', () => {
      store.set('com.test', { theme: 'dark' });
      store.clear('com.test');

      expect(store.getLevel('com.test')).toEqual({});
    });
  });

  describe('hierarchical context', () => {
    it('should merge context from all ancestor levels', () => {
      store.set('com', { global: true });
      store.set('com.test', { org: 'test' });
      store.set('com.test.appA', { feature: 'chat' });
      store.set('com.test.appA.main', { view: 'list' });
      store.set('com.test.appA.main.win-0', { scroll: 100 });

      const context = store.get('com.test.appA.main.win-0');

      expect(context).toEqual({
        global: true,
        org: 'test',
        feature: 'chat',
        view: 'list',
        scroll: 100
      });
    });

    it('should give higher levels (parents) precedence over lower levels', () => {
      // LDAP-style: parent org settings cannot be overridden by children
      store.set('com.test', { theme: 'dark', color: 'blue' });
      store.set('com.test.appA', { theme: 'light', extra: 'value' }); // tries to override theme

      const context = store.get('com.test.appA.main.win-0');

      expect(context.theme).toBe('dark');   // parent wins, cannot be overridden
      expect(context.color).toBe('blue');   // inherited from parent
      expect(context.extra).toBe('value');  // child can add new keys
    });

    it('should not affect sibling apps', () => {
      store.set('com.test', { shared: true });
      store.set('com.test.appA', { appA: true });
      store.set('com.test.appB', { appB: true });

      const contextA = store.get('com.test.appA.main.win-0');
      const contextB = store.get('com.test.appB.main.win-0');

      expect(contextA).toEqual({ shared: true, appA: true });
      expect(contextB).toEqual({ shared: true, appB: true });
    });

    it('should return partial context for intermediate paths', () => {
      store.set('com', { a: 'from-com' });
      store.set('com.test', { b: 'from-test' });
      store.set('com.test.appA', { c: 'from-appA' });

      expect(store.get('com')).toEqual({ a: 'from-com' });
      expect(store.get('com.test')).toEqual({ a: 'from-com', b: 'from-test' });
      expect(store.get('com.test.appA')).toEqual({ a: 'from-com', b: 'from-test', c: 'from-appA' });
    });

    it('should enforce policy from root level', () => {
      // Root sets a policy that cannot be overridden anywhere
      store.set('com', { enforced: 'from-root' });
      store.set('com.test', { enforced: 'from-test' });
      store.set('com.test.appA', { enforced: 'from-app' });

      const context = store.get('com.test.appA.main.win-0');
      expect(context.enforced).toBe('from-root'); // root always wins
    });
  });

  describe('change notifications', () => {
    it('should notify on set', () => {
      const notifications: Array<{ path: string; context: Record<string, unknown> }> = [];
      store.onChange((path, context) => notifications.push({ path, context }));

      store.set('com.test', { theme: 'dark' });

      expect(notifications).toHaveLength(1);
      expect(notifications[0].path).toBe('com.test');
    });

    it('should unsubscribe', () => {
      const notifications: string[] = [];
      const unsub = store.onChange((path) => notifications.push(path));

      store.set('com.test', { a: 1 });
      unsub();
      store.set('com.test', { b: 2 });

      expect(notifications).toHaveLength(1);
    });
  });
});

describe('isValidContextPath', () => {
  // Owner is the app's domain (e.g., "com.test.appA")
  // Can only write at or BELOW owner level, not above

  it('should allow setting context at owner level', () => {
    expect(isValidContextPath('com.test.appA', 'com.test.appA')).toBe(true);
  });

  it('should allow setting context below owner level', () => {
    expect(isValidContextPath('com.test.appA', 'com.test.appA.settings')).toBe(true);
    expect(isValidContextPath('com.test.appA', 'com.test.appA.main.win-0')).toBe(true);
  });

  it('should deny setting context above owner level', () => {
    expect(isValidContextPath('com.test.appA', 'com.test')).toBe(false);
    expect(isValidContextPath('com.test.appA', 'com')).toBe(false);
  });

  it('should deny setting context at sibling paths', () => {
    expect(isValidContextPath('com.test.appA', 'com.test.appB')).toBe(false);
    expect(isValidContextPath('com.test.appA', 'com.test.appA2')).toBe(false);
  });

  it('should deny setting context at completely different paths', () => {
    expect(isValidContextPath('com.test.appA', 'org.example.app')).toBe(false);
  });
});
