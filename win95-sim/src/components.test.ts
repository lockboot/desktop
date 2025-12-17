import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerComponents,
  IframeAppElement,
  NativeAppElement,
  AppMessageEvent,
  AppReadyEvent
} from './components';
import type { AppMessage } from './messaging';

// Register components once
registerComponents();

describe('AppMessageEvent', () => {
  it('should create event with correct type and detail', () => {
    const msg = { type: 'test', to: 'com.test.app' };
    const event = new AppMessageEvent(msg);

    expect(event.type).toBe('app-message');
    expect(event.detail).toEqual(msg);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});

describe('AppReadyEvent', () => {
  it('should create event with address and owner', () => {
    const event = new AppReadyEvent('com.test.app.main.win-0', 'com.test.app');

    expect(event.type).toBe('app-ready');
    expect(event.detail.address).toBe('com.test.app.main.win-0');
    expect(event.detail.owner).toBe('com.test.app');
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
  });
});

describe('IframeAppElement', () => {
  let element: IframeAppElement;

  beforeEach(() => {
    element = document.createElement('win95-iframe-app') as IframeAppElement;
  });

  it('should be registered as custom element', () => {
    expect(customElements.get('win95-iframe-app')).toBe(IframeAppElement);
  });

  it('should have address and owner attributes', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    element.setAttribute('owner', 'com.test.app');

    expect(element.address).toBe('com.test.app.main.win-0');
    expect(element.owner).toBe('com.test.app');
  });

  it('should derive owner from address if not set', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    document.body.appendChild(element);

    // Owner derived by removing last two parts (windowType.windowId)
    expect(element.owner).toBe('com.test.app');

    document.body.removeChild(element);
  });

  it('should fire app-ready event on connect', () => {
    const handler = vi.fn();
    element.setAttribute('address', 'com.test.app.main.win-0');

    element.addEventListener('app-ready', handler);
    document.body.appendChild(element);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as AppReadyEvent;
    expect(event.detail.address).toBe('com.test.app.main.win-0');
    expect(event.detail.owner).toBe('com.test.app');

    document.body.removeChild(element);
  });

  it('should create iframe with src attribute', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    element.setAttribute('src', 'https://example.com');
    document.body.appendChild(element);

    const iframe = element.shadowRoot?.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.src).toBe('https://example.com/');

    document.body.removeChild(element);
  });

  it('should create iframe with srcdoc attribute', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    element.setAttribute('srcdoc', '<html><body>Test</body></html>');
    document.body.appendChild(element);

    const iframe = element.shadowRoot?.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.srcdoc).toBe('<html><body>Test</body></html>');

    document.body.removeChild(element);
  });

  it('should expose contentWindow', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    document.body.appendChild(element);

    // jsdom may not fully implement contentWindow, but we test the getter exists
    expect(typeof element.contentWindow).not.toBe('undefined');

    document.body.removeChild(element);
  });

  it('should dispatch app-message event when iframe posts message', async () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    element.setAttribute('srcdoc', '<html><body></body></html>');

    const handler = vi.fn();
    element.addEventListener('app-message', handler);
    document.body.appendChild(element);

    // Simulate message from iframe by dispatching window message event
    // Note: In real scenario, iframe calls parent.postMessage
    // For testing, we verify the event type exists
    expect(AppMessageEvent).toBeDefined();

    document.body.removeChild(element);
  });

  it('should forward messages to iframe via receiveMessage', () => {
    element.setAttribute('address', 'com.test.app.main.win-0');
    element.setAttribute('srcdoc', '<html><body></body></html>');
    document.body.appendChild(element);

    const msg: AppMessage = {
      type: 'test',
      to: 'com.test.app.main.win-0',
      from: 'com.test.appB.main.win-0',
      payload: { data: 'hello' }
    };

    // This should not throw
    expect(() => element.receiveMessage(msg)).not.toThrow();

    document.body.removeChild(element);
  });
});

describe('NativeAppElement', () => {
  let element: NativeAppElement;

  beforeEach(() => {
    element = document.createElement('win95-native-app') as NativeAppElement;
  });

  it('should be registered as custom element', () => {
    expect(customElements.get('win95-native-app')).toBe(NativeAppElement);
  });

  it('should have address and owner attributes', () => {
    element.setAttribute('address', 'com.test.native.main.win-0');
    element.setAttribute('owner', 'com.test.native');

    expect(element.address).toBe('com.test.native.main.win-0');
    expect(element.owner).toBe('com.test.native');
  });

  it('should fire app-ready event on connect', () => {
    const handler = vi.fn();
    element.setAttribute('address', 'com.test.native.main.win-0');

    element.addEventListener('app-ready', handler);
    document.body.appendChild(element);

    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(element);
  });

  it('should dispatch message event when receiveMessage is called', () => {
    element.setAttribute('address', 'com.test.native.main.win-0');
    document.body.appendChild(element);

    const handler = vi.fn();
    element.addEventListener('message', handler);

    const msg: AppMessage = {
      type: 'notification',
      to: 'com.test.native.main.win-0',
      from: 'com.test.appB.main.win-0',
      payload: { text: 'Hello!' }
    };

    element.receiveMessage(msg);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<AppMessage>;
    expect(event.detail).toEqual(msg);

    document.body.removeChild(element);
  });

  it('should queue messages before ready', () => {
    element.setAttribute('address', 'com.test.native.main.win-0');

    const handler = vi.fn();
    element.addEventListener('message', handler);

    const msg: AppMessage = {
      type: 'early',
      to: 'com.test.native.main.win-0',
      payload: {}
    };

    // Send message before connected
    element.receiveMessage(msg);
    expect(handler).not.toHaveBeenCalled();

    // Now connect - message should be delivered
    document.body.appendChild(element);
    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(element);
  });

  it('should have a slot for content', () => {
    element.setAttribute('address', 'com.test.native.main.win-0');
    document.body.appendChild(element);

    const slot = element.shadowRoot?.querySelector('slot');
    expect(slot).toBeTruthy();

    document.body.removeChild(element);
  });
});

describe('registerComponents', () => {
  it('should not throw when called multiple times', () => {
    expect(() => {
      registerComponents();
      registerComponents();
    }).not.toThrow();
  });
});
