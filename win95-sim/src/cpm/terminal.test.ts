/**
 * Tests for HeadlessTerminal's ScriptedConsole implementation.
 *
 * Tests the expect-style pattern matching (waitFor) and input queueing
 * that enables automated interaction with CP/M programs.
 *
 * Run with: npm test -- src/cpm/terminal.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HeadlessTerminal } from './headless-terminal';

describe('HeadlessTerminal as ScriptedConsole', () => {
  let terminal: HeadlessTerminal;

  beforeEach(() => {
    terminal = new HeadlessTerminal();
  });

  describe('output buffer and waitFor', () => {
    it('should accumulate printable characters in output buffer', async () => {
      // Simulate CP/M writing "Hello"
      for (const char of 'Hello') {
        terminal.write(char.charCodeAt(0));
      }

      // waitFor should resolve immediately if pattern exists
      await expect(terminal.waitFor('Hello', 100)).resolves.toBeUndefined();
    });

    it('should match partial strings', async () => {
      for (const char of 'Include error messages (Y/N)?') {
        terminal.write(char.charCodeAt(0));
      }

      await expect(terminal.waitFor('(Y/N)?', 100)).resolves.toBeUndefined();
    });

    it('should wait for pattern that appears later', async () => {
      // Start waiting before output
      const waitPromise = terminal.waitFor('Ready', 1000);

      // Simulate delayed output
      setTimeout(() => {
        for (const char of 'System Ready>') {
          terminal.write(char.charCodeAt(0));
        }
      }, 50);

      await expect(waitPromise).resolves.toBeUndefined();
    });

    it('should timeout if pattern never appears', async () => {
      terminal.write('X'.charCodeAt(0));

      await expect(terminal.waitFor('Never', 50)).rejects.toThrow('Timeout');
    });

    it('should match regex patterns', async () => {
      for (const char of 'Error on line 42') {
        terminal.write(char.charCodeAt(0));
      }

      await expect(terminal.waitFor(/line \d+/, 100)).resolves.toBeUndefined();
    });

    it('should clear output buffer', async () => {
      for (const char of 'First message') {
        terminal.write(char.charCodeAt(0));
      }

      terminal.clearOutputBuffer();

      // Old pattern should not match after clear
      await expect(terminal.waitFor('First', 50)).rejects.toThrow('Timeout');
    });

    it('should not include control characters in output buffer', async () => {
      // Write with CR, LF, backspace mixed in
      terminal.write('H'.charCodeAt(0));
      terminal.write(13); // CR
      terminal.write(10); // LF
      terminal.write('i'.charCodeAt(0));
      terminal.write(8);  // Backspace (ignored in output buffer)
      terminal.write('!'.charCodeAt(0));

      // Output buffer should only have printable chars
      await expect(terminal.waitFor('Hi!', 100)).resolves.toBeUndefined();
    });

    it('should handle multiple waiters for same pattern', async () => {
      const wait1 = terminal.waitFor('Done', 500);
      const wait2 = terminal.waitFor('Done', 500);

      setTimeout(() => terminal.writeString('Done'), 50);

      await Promise.all([wait1, wait2]);
    });

    it('should handle different patterns concurrently', async () => {
      const waitA = terminal.waitFor('Apple', 500);
      const waitB = terminal.waitFor('Banana', 500);

      setTimeout(() => terminal.writeString('Apple and Banana'), 50);

      await Promise.all([waitA, waitB]);
    });
  });

  describe('keyboard input queueing', () => {
    it('should queue input for getKey', () => {
      terminal.sendKey(65); // 'A'
      terminal.sendKey(66); // 'B'

      expect(terminal.hasKey()).toBe(true);
      expect(terminal.getKey()).toBe(65);
      expect(terminal.getKey()).toBe(66);
      expect(terminal.hasKey()).toBe(false);
    });

    it('should queue string input', () => {
      terminal.queueInput('Hi\r');

      expect(terminal.getKey()).toBe('H'.charCodeAt(0));
      expect(terminal.getKey()).toBe('i'.charCodeAt(0));
      expect(terminal.getKey()).toBe(13); // CR
    });

    it('should resolve waitForKey when key is queued', async () => {
      // Start waiting before key
      const keyPromise = terminal.waitForKey();

      // Queue key after short delay
      setTimeout(() => terminal.sendKey(65), 10);

      await expect(keyPromise).resolves.toBe(65);
    });

    it('should return immediately if key already queued', async () => {
      terminal.sendKey(66);

      await expect(terminal.waitForKey()).resolves.toBe(66);
    });

    it('should handle queueInputSlow with delays', async () => {
      const keys: number[] = [];

      // Collect keys as they arrive
      const collector = async () => {
        for (let i = 0; i < 3; i++) {
          keys.push(await terminal.waitForKey());
        }
      };

      const collectorPromise = collector();
      await terminal.queueInputSlow('ABC', 5);
      await collectorPromise;

      expect(keys).toEqual([65, 66, 67]);
    });

    it('should handle interleaved read/write', async () => {
      // Simulate a program that reads input and echoes it
      const simulate = async () => {
        const key = await terminal.waitForKey();
        terminal.write(key); // Echo
        terminal.writeString(' received');
      };

      const simPromise = simulate();
      terminal.sendKey(65); // 'A'
      await simPromise;

      await expect(terminal.waitFor('A received', 100)).resolves.toBeUndefined();
    });
  });

  describe('ScriptedConsole contract', () => {
    it('should implement all ScriptedConsole methods', () => {
      // Check all required methods exist
      expect(typeof terminal.write).toBe('function');
      expect(typeof terminal.hasKey).toBe('function');
      expect(typeof terminal.getKey).toBe('function');
      expect(typeof terminal.waitForKey).toBe('function');
      expect(typeof terminal.waitFor).toBe('function');
      expect(typeof terminal.clearOutputBuffer).toBe('function');
      expect(typeof terminal.queueInputSlow).toBe('function');
      expect(typeof terminal.writeString).toBe('function');
    });

    it('should handle typical expect-style interaction pattern', async () => {
      // Simulate a program that prompts and waits for input
      const simulateProgram = async () => {
        // Program writes prompt
        terminal.writeString('Enter name: ');

        // Program waits for input (read until CR)
        let input = '';
        while (true) {
          const key = await terminal.waitForKey();
          if (key === 13) break;
          input += String.fromCharCode(key);
          terminal.write(key); // Echo
        }

        // Program responds
        terminal.write(13);
        terminal.write(10);
        terminal.writeString(`Hello, ${input}!`);
      };

      // Start simulated program
      const programPromise = simulateProgram();

      // Automation script
      await terminal.waitFor('Enter name:', 500);
      terminal.clearOutputBuffer();
      await terminal.queueInputSlow('World\r', 5);
      await terminal.waitFor('Hello, World!', 500);

      await programPromise;
    });

    it('should handle menu-style interaction like Turbo Pascal', async () => {
      // Simulate Turbo Pascal menu
      const simulateMenu = async () => {
        terminal.writeString('Include error messages (Y/N)? ');
        const key1 = await terminal.waitForKey();
        terminal.write(key1);
        terminal.writeString('\r\n');

        terminal.writeString('E)dit  C)ompile  R)un  Q)uit\r\n> ');
        const key2 = await terminal.waitForKey();
        terminal.write(key2);

        if (String.fromCharCode(key2).toUpperCase() === 'C') {
          terminal.writeString('\r\nCompiling...\r\n');
          terminal.writeString('Done.\r\n');
        }
      };

      const menuPromise = simulateMenu();

      // Script interaction
      await terminal.waitFor('(Y/N)?', 500);
      terminal.clearOutputBuffer();
      await terminal.queueInputSlow('Y', 5);

      await terminal.waitFor('E)dit', 500);
      terminal.clearOutputBuffer();
      await terminal.queueInputSlow('C', 5);

      await terminal.waitFor('Done.', 500);

      await menuPromise;
    });
  });

  describe('output capture', () => {
    it('should capture full output when enabled', () => {
      terminal.captureOutput = true;
      terminal.writeString('Hello\r\nWorld');

      expect(terminal.getFullOutput()).toBe('Hello\r\nWorld');
    });

    it('should reset all state', async () => {
      terminal.writeString('Some output');
      terminal.sendKey(65);

      terminal.reset();

      expect(terminal.getFullOutput()).toBe('');
      expect(terminal.hasKey()).toBe(false);
      await expect(terminal.waitFor('Some', 50)).rejects.toThrow('Timeout');
    });
  });
});
