/**
 * Headless Terminal - implements ScriptedConsole without DOM/canvas dependencies.
 *
 * This is a real, working implementation of ScriptedConsole that can be used
 * in tests or server-side environments where DOM is not available.
 *
 * It provides the same expect-style automation (waitFor, queueInputSlow) as
 * the visual Terminal, just without rendering.
 */

import type { ScriptedConsole } from './types';

export class HeadlessTerminal implements ScriptedConsole {
  // Output tracking
  private outputBuffer = '';
  private patternWaiters: Array<{ pattern: string | RegExp; resolve: () => void }> = [];

  // Keyboard
  private keyQueue: number[] = [];
  private keyWaiters: Array<(key: number) => void> = [];

  // Optional: capture all output for inspection
  private fullOutput = '';
  public captureOutput = true;

  // CpmConsole implementation

  write(char: number): void {
    // Track printable characters for pattern matching
    if (char >= 32 && char < 127) {
      this.outputBuffer += String.fromCharCode(char);
      if (this.captureOutput) {
        this.fullOutput += String.fromCharCode(char);
      }
      // Keep buffer reasonable size
      if (this.outputBuffer.length > 1000) {
        this.outputBuffer = this.outputBuffer.slice(-500);
      }
      this.checkPatternWaiters();
    } else if (char === 13 || char === 10) {
      // Track newlines in full output
      if (this.captureOutput) {
        this.fullOutput += String.fromCharCode(char);
      }
    }
  }

  writeString(str: string): void {
    for (const char of str) {
      this.write(char.charCodeAt(0));
    }
  }

  print(_char: number): void {
    // Printer output - ignore in headless mode
  }

  hasKey(): boolean {
    return this.keyQueue.length > 0;
  }

  getKey(): number | undefined {
    return this.keyQueue.shift();
  }

  waitForKey(): Promise<number> {
    if (this.keyQueue.length > 0) {
      return Promise.resolve(this.keyQueue.shift()!);
    }
    return new Promise(resolve => {
      this.keyWaiters.push(resolve);
    });
  }

  // ScriptedConsole implementation

  /** Send a key to the terminal (for external input) */
  sendKey(key: number): void {
    if (this.keyWaiters.length > 0) {
      const waiter = this.keyWaiters.shift()!;
      waiter(key);
    } else {
      this.keyQueue.push(key);
    }
  }

  /** Queue a string as keyboard input */
  queueInput(input: string): void {
    for (const char of input) {
      this.sendKey(char.charCodeAt(0));
    }
  }

  /** Queue input with delays between characters (simulates typing) */
  async queueInputSlow(input: string, delayMs = 10): Promise<void> {
    for (const char of input) {
      this.sendKey(char.charCodeAt(0));
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  /** Wait for a pattern to appear in output (expect-style) */
  waitFor(pattern: string | RegExp, timeoutMs = 5000): Promise<void> {
    // Check if already matched
    const matches = typeof pattern === 'string'
      ? this.outputBuffer.includes(pattern)
      : pattern.test(this.outputBuffer);

    if (matches) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const waiter = { pattern, resolve };
      this.patternWaiters.push(waiter);

      // Timeout
      const timer = setTimeout(() => {
        const idx = this.patternWaiters.indexOf(waiter);
        if (idx !== -1) {
          this.patternWaiters.splice(idx, 1);
          reject(new Error(`Timeout waiting for pattern: ${pattern}`));
        }
      }, timeoutMs);

      // Clear timeout if resolved
      const originalResolve = waiter.resolve;
      waiter.resolve = () => {
        clearTimeout(timer);
        originalResolve();
      };
    });
  }

  /** Clear the output buffer (call after sending input) */
  clearOutputBuffer(): void {
    this.outputBuffer = '';
  }

  /** Check if any pattern waiters should be resolved */
  private checkPatternWaiters(): void {
    for (let i = this.patternWaiters.length - 1; i >= 0; i--) {
      const waiter = this.patternWaiters[i];
      const matches = typeof waiter.pattern === 'string'
        ? this.outputBuffer.includes(waiter.pattern)
        : waiter.pattern.test(this.outputBuffer);
      if (matches) {
        this.patternWaiters.splice(i, 1);
        waiter.resolve();
      }
    }
  }

  // Test helpers

  /** Get all captured output */
  getFullOutput(): string {
    return this.fullOutput;
  }

  /** Clear all state */
  reset(): void {
    this.outputBuffer = '';
    this.fullOutput = '';
    this.keyQueue = [];
    this.keyWaiters = [];
    this.patternWaiters = [];
  }
}
