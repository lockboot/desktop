/**
 * Simple terminal emulator for CP/M console output.
 *
 * Features:
 * - Fixed-width character grid
 * - Basic cursor positioning
 * - Keyboard input handling
 * - Implements CpmConsole interface
 */

import type { CpmConsole } from './types';

export interface TerminalOptions {
  /** Columns (default 80) */
  cols?: number;
  /** Rows (default 24) */
  rows?: number;
  /** Font size in pixels (default 14) */
  fontSize?: number;
  /** Foreground color (default #00ff41 green) */
  fgColor?: string;
  /** Background color (default #000) */
  bgColor?: string;
}

export class Terminal implements CpmConsole {
  readonly element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cols: number;
  private rows: number;
  private fontSize: number;
  private charWidth: number;
  private charHeight: number;
  private fgColor: string;
  private bgColor: string;

  // Screen buffer
  private buffer: number[][];
  private cursorX = 0;
  private cursorY = 0;
  private cursorVisible = true;
  private cursorBlinkInterval: number | null = null;

  // Keyboard
  private keyQueue: number[] = [];
  private keyWaiters: Array<(key: number) => void> = [];

  // Expect-style pattern matching
  private outputBuffer = '';
  private patternWaiters: Array<{ pattern: string | RegExp; resolve: () => void }> = [];

  // Line-buffered console logging
  private lineBuffer = '';
  public consoleLog = false;  // Set to true to log output to browser console

  // Resize handling
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: TerminalOptions = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.fontSize = options.fontSize ?? 14;
    this.fgColor = options.fgColor ?? '#00ff41';
    this.bgColor = options.bgColor ?? '#000000';

    // Create container
    this.element = document.createElement('div');
    this.element.className = 'cpm-terminal';
    this.element.style.cssText = `
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: ${this.bgColor};
      overflow: hidden;
    `;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.element.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    // Measure character size with monospace font
    this.ctx.font = `${this.fontSize}px monospace`;
    const metrics = this.ctx.measureText('M');
    this.charWidth = Math.ceil(metrics.width);
    this.charHeight = Math.ceil(this.fontSize * 1.2);

    // Set canvas size (native resolution)
    this.canvas.width = this.cols * this.charWidth;
    this.canvas.height = this.rows * this.charHeight;

    // Initialize buffer with spaces
    this.buffer = [];
    for (let y = 0; y < this.rows; y++) {
      this.buffer[y] = new Array(this.cols).fill(32); // space
    }

    // Set up keyboard handling
    this.element.tabIndex = 0;
    this.element.addEventListener('keydown', e => this.handleKeyDown(e));
    this.element.addEventListener('keypress', e => this.handleKeyPress(e));

    // Set up resize handling to scale canvas to fit container
    this.resizeObserver = new ResizeObserver(() => this.updateScale());
    this.resizeObserver.observe(this.element);

    // Initial render
    this.render();

    // Start cursor blink
    this.startCursorBlink();

    // Initial scale after a frame (element needs to be in DOM)
    requestAnimationFrame(() => this.updateScale());
  }

  /** Update canvas scale to fit container while maintaining aspect ratio */
  private updateScale(): void {
    const padding = 10; // Padding around the canvas
    const containerWidth = this.element.clientWidth;
    const containerHeight = this.element.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) return;

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;

    // Calculate scale to fit container while maintaining aspect ratio (accounting for padding)
    const availableWidth = containerWidth - padding * 2;
    const availableHeight = containerHeight - padding * 2;
    const scaleX = availableWidth / canvasWidth;
    const scaleY = availableHeight / canvasHeight;
    const scale = Math.min(scaleX, scaleY);

    // Apply scale via CSS (keeps canvas crisp)
    this.canvas.style.width = `${canvasWidth * scale}px`;
    this.canvas.style.height = `${canvasHeight * scale}px`;
  }

  /** Clean up resources */
  destroy(): void {
    if (this.cursorBlinkInterval !== null) {
      clearInterval(this.cursorBlinkInterval);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  /** Focus the terminal for keyboard input */
  focus(): void {
    this.element.focus();
  }

  /** Clear the screen */
  clear(): void {
    for (let y = 0; y < this.rows; y++) {
      this.buffer[y].fill(32);
    }
    this.cursorX = 0;
    this.cursorY = 0;
    this.render();
  }

  /** Write a string to the terminal */
  writeString(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.write(str.charCodeAt(i));
    }
  }

  // CpmConsole implementation

  private writeCount = 0;
  write(char: number): void {
    this.writeCount++;
    //if (this.writeCount <= 10 || this.writeCount % 100 === 0) {
    //  console.log(`[Terminal] write(${char}) = '${char >= 32 && char < 127 ? String.fromCharCode(char) : '?'}', count=${this.writeCount}`);
    //}
    if (char === 13) { // CR
      this.cursorX = 0;
    } else if (char === 10) { // LF
      this.newLine();
    } else if (char === 8) { // Backspace
      if (this.cursorX > 0) {
        this.cursorX--;
      }
    } else if (char === 7) { // Bell
      // Could play a sound
    } else if (char >= 32 && char < 127) {
      this.buffer[this.cursorY][this.cursorX] = char;
      this.cursorX++;
      if (this.cursorX >= this.cols) {
        this.cursorX = 0;
        this.newLine();
      }
    }
    this.render();

    // Track output for pattern matching (expect-style)
    if (char >= 32 && char < 127) {
      this.outputBuffer += String.fromCharCode(char);
      // Keep buffer reasonable size
      if (this.outputBuffer.length > 1000) {
        this.outputBuffer = this.outputBuffer.slice(-500);
      }
      // Check pattern waiters
      this.checkPatternWaiters();
    }

    // Line-buffered console logging
    if (this.consoleLog) {
      if (char === 10 || char === 13) {
        if (this.lineBuffer.length > 0) {
          console.log('[CPM]', this.lineBuffer);
          this.lineBuffer = '';
        }
      } else if (char >= 32 && char < 127) {
        this.lineBuffer += String.fromCharCode(char);
      }
    }
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
      setTimeout(() => {
        const idx = this.patternWaiters.indexOf(waiter);
        if (idx !== -1) {
          this.patternWaiters.splice(idx, 1);
          reject(new Error(`Timeout waiting for pattern: ${pattern}`));
        }
      }, timeoutMs);
    });
  }

  /** Clear the output buffer (call after sending input) */
  clearOutputBuffer(): void {
    this.outputBuffer = '';
  }

  print(char: number): void {
    // Printer output - for now just log it
    console.log('PRINTER:', String.fromCharCode(char));
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
    //console.log(`[Terminal] queueInput: ${input.length} chars, waiters=${this.keyWaiters.length}, queue=${this.keyQueue.length}`);
    for (let i = 0; i < input.length; i++) {
      this.sendKey(input.charCodeAt(i));
    }
    //console.log(`[Terminal] After queue: queue=${this.keyQueue.length}`);
  }

  /** Queue input with delays between characters (simulates typing) */
  async queueInputSlow(input: string, delayMs = 10): Promise<void> {
    //console.log(`[Terminal] queueInputSlow: ${input.length} chars, current queue=${this.keyQueue.length}, waiters=${this.keyWaiters.length}`);
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      //const charDisplay = char >= 32 && char < 127 ? String.fromCharCode(char) : `\\x${char.toString(16)}`;
      //console.log(`[Terminal] Sending char ${i}: ${charDisplay} (${char}), queue=${this.keyQueue.length}, waiters=${this.keyWaiters.length}`);
      this.sendKey(char);
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    //console.log(`[Terminal] Done sending, queue=${this.keyQueue.length}`);
  }

  // Private methods

  private newLine(): void {
    this.cursorY++;
    if (this.cursorY >= this.rows) {
      // Scroll up
      this.cursorY = this.rows - 1;
      for (let y = 0; y < this.rows - 1; y++) {
        this.buffer[y] = this.buffer[y + 1];
      }
      this.buffer[this.rows - 1] = new Array(this.cols).fill(32);
    }
  }

  private render(): void {
    const ctx = this.ctx;

    // Clear
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw text
    ctx.font = `${this.fontSize}px monospace`;
    ctx.fillStyle = this.fgColor;
    ctx.textBaseline = 'top';

    for (let y = 0; y < this.rows; y++) {
      let line = '';
      for (let x = 0; x < this.cols; x++) {
        line += String.fromCharCode(this.buffer[y][x]);
      }
      ctx.fillText(line, 0, y * this.charHeight + 2);
    }

    // Draw cursor
    if (this.cursorVisible) {
      ctx.fillStyle = this.fgColor;
      ctx.fillRect(
        this.cursorX * this.charWidth,
        this.cursorY * this.charHeight + this.charHeight - 2,
        this.charWidth,
        2
      );
    }
  }

  private startCursorBlink(): void {
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this.render();
    }, 500);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Handle special keys
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.sendKey(13);
        break;
      case 'Backspace':
        e.preventDefault();
        this.sendKey(8);
        break;
      case 'Escape':
        e.preventDefault();
        this.sendKey(27);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.sendKey(0x0B); // Ctrl-K or custom
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.sendKey(0x0A); // LF
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.sendKey(8); // Backspace
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.sendKey(0x0C); // Ctrl-L
        break;
      case 'Tab':
        e.preventDefault();
        this.sendKey(9);
        break;
      default:
        // Handle Ctrl+key
        if (e.ctrlKey && e.key.length === 1) {
          e.preventDefault();
          const code = e.key.toUpperCase().charCodeAt(0) - 64;
          if (code >= 1 && code <= 26) {
            this.sendKey(code);
          }
        }
        // Handle regular printable characters
        else if (e.key.length === 1 && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.sendKey(e.key.charCodeAt(0));
        }
    }
  }

  private handleKeyPress(e: KeyboardEvent): void {
    // Handled in keydown now, but keep as fallback
    e.preventDefault();
  }
}
