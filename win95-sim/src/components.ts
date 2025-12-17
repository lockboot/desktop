import type { AppMessage } from './messaging';

// Base interface for all app components
export interface AppComponent extends HTMLElement {
  readonly address: string;
  readonly owner: string;

  // Messaging
  sendMessage(msg: Omit<AppMessage, 'from'>): void;
  receiveMessage(msg: AppMessage): void;

  // Lifecycle
  onConnect?: () => void;
  onDisconnect?: () => void;
}

// Event fired when app wants to send a message
export class AppMessageEvent extends CustomEvent<Omit<AppMessage, 'from'>> {
  constructor(msg: Omit<AppMessage, 'from'>) {
    super('app-message', { detail: msg, bubbles: true, composed: true });
  }
}

// Event fired when app is ready to receive messages
export class AppReadyEvent extends CustomEvent<{ address: string; owner: string }> {
  constructor(address: string, owner: string) {
    super('app-ready', { detail: { address, owner }, bubbles: true, composed: true });
  }
}

// Base class for app components
export abstract class BaseAppElement extends HTMLElement implements AppComponent {
  protected _address: string = '';
  protected _owner: string = '';

  get address(): string { return this._address; }
  get owner(): string { return this._owner; }

  static get observedAttributes() {
    return ['address', 'owner'];
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === 'address') this._address = value;
    if (name === 'owner') this._owner = value;
  }

  connectedCallback() {
    // Derive owner from address if not explicitly set
    if (this._address && !this._owner) {
      this._owner = this._address.split('.').slice(0, -2).join('.');
    }
    this.onConnect?.();
    this.dispatchEvent(new AppReadyEvent(this._address, this._owner));
  }

  disconnectedCallback() {
    this.onDisconnect?.();
  }

  // Send message up to the desktop/bus
  sendMessage(msg: Omit<AppMessage, 'from'>): void {
    this.dispatchEvent(new AppMessageEvent(msg));
  }

  // Receive message from bus - implemented by subclasses
  abstract receiveMessage(msg: AppMessage): void;

  onConnect?: () => void;
  onDisconnect?: () => void;
}

// Iframe-based app component
export class IframeAppElement extends BaseAppElement {
  private iframe: HTMLIFrameElement | null = null;
  private messageHandler: ((e: MessageEvent) => void) | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return [...super.observedAttributes, 'src', 'srcdoc'];
  }

  connectedCallback() {
    this.render();
    this.setupMessageBridge();
    super.connectedCallback();
  }

  disconnectedCallback() {
    this.teardownMessageBridge();
    super.disconnectedCallback();
  }

  attributeChangedCallback(name: string, old: string, value: string) {
    super.attributeChangedCallback(name, old, value);
    if ((name === 'src' || name === 'srcdoc') && this.iframe) {
      if (name === 'src') this.iframe.src = value;
      if (name === 'srcdoc') this.iframe.srcdoc = value;
    }
  }

  private render() {
    const src = this.getAttribute('src');
    const srcdoc = this.getAttribute('srcdoc');

    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; }
        iframe { width: 100%; height: 100%; border: none; }
      </style>
      <iframe ${src ? `src="${src}"` : ''} ${srcdoc ? 'srcdoc' : ''}></iframe>
    `;

    this.iframe = this.shadowRoot!.querySelector('iframe');
    if (srcdoc && this.iframe) {
      this.iframe.srcdoc = srcdoc;
    }
  }

  private setupMessageBridge() {
    // Listen for messages from iframe
    this.messageHandler = (e: MessageEvent) => {
      // Only accept messages from our iframe
      if (e.source !== this.iframe?.contentWindow) return;

      const msg = e.data as AppMessage;
      if (!msg.type || !msg.to) return;

      // Forward to bus via custom event
      this.sendMessage(msg);
    };
    window.addEventListener('message', this.messageHandler);
  }

  private teardownMessageBridge() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
    }
  }

  // Receive message from bus, forward to iframe
  receiveMessage(msg: AppMessage): void {
    if (this.iframe?.contentWindow) {
      this.iframe.contentWindow.postMessage(msg, '*');
    }
  }

  // Get iframe's contentWindow for legacy compatibility
  get contentWindow(): Window | null {
    return this.iframe?.contentWindow ?? null;
  }
}

// Native app component - runs directly in page
export class NativeAppElement extends BaseAppElement {
  private messageQueue: AppMessage[] = [];
  private ready = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    super.connectedCallback();
    this.ready = true;
    this.flushMessageQueue();
  }

  private render() {
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; }
        ::slotted(*) { width: 100%; height: 100%; }
      </style>
      <slot></slot>
    `;
  }

  // Receive message - dispatch as custom event on this element
  receiveMessage(msg: AppMessage): void {
    if (!this.ready) {
      this.messageQueue.push(msg);
      return;
    }
    this.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  private flushMessageQueue() {
    for (const msg of this.messageQueue) {
      this.receiveMessage(msg);
    }
    this.messageQueue = [];
  }
}

// Register custom elements
export function registerComponents() {
  if (!customElements.get('win95-iframe-app')) {
    customElements.define('win95-iframe-app', IframeAppElement);
  }
  if (!customElements.get('win95-native-app')) {
    customElements.define('win95-native-app', NativeAppElement);
  }
}

// Type declarations for HTML
declare global {
  interface HTMLElementTagNameMap {
    'win95-iframe-app': IframeAppElement;
    'win95-native-app': NativeAppElement;
  }

  interface HTMLElementEventMap {
    'app-message': AppMessageEvent;
    'app-ready': AppReadyEvent;
  }
}
