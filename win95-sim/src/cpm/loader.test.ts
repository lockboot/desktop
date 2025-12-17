/**
 * Tests for CP/M loader utilities.
 *
 * Run with: npm test -- src/cpm/loader.test.ts
 */

import { describe, it, expect } from 'vitest';
import { hexToCom } from './loader';

describe('hexToCom', () => {
  it('should convert simple Intel HEX to binary', () => {
    // Simple HEX: load 3 bytes at address 0x0100: C3 00 01 (JP 0100H)
    const hex = `:03010000C30001F8
:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(3);
    expect(result![0]).toBe(0xC3); // JP opcode
    expect(result![1]).toBe(0x00);
    expect(result![2]).toBe(0x01);
  });

  it('should handle multiple data records', () => {
    // Two records: 3 bytes at 0x0100, 3 bytes at 0x0103
    const hex = `:03010000C30001F8
:03010300C90000F9
:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(6);
    expect(result![0]).toBe(0xC3); // First record
    expect(result![3]).toBe(0xC9); // Second record (RET)
  });

  it('should handle gaps in address space with zeros', () => {
    // Two records with a gap: bytes at 0x0100, then bytes at 0x0105
    const hex = `:01010000C93B
:01010500C930
:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(6);
    expect(result![0]).toBe(0xC9); // At 0x0100
    expect(result![1]).toBe(0x00); // Gap filled with 0
    expect(result![5]).toBe(0xC9); // At 0x0105
  });

  it('should return undefined for empty HEX', () => {
    const hex = `:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeUndefined();
  });

  it('should handle CRLF and LF line endings', () => {
    const hexCRLF = `:03010000C30001F8\r\n:00000001FF\r\n`;
    const hexLF = `:03010000C30001F8\n:00000001FF\n`;

    const resultCRLF = hexToCom(new TextEncoder().encode(hexCRLF));
    const resultLF = hexToCom(new TextEncoder().encode(hexLF));

    expect(resultCRLF).toEqual(resultLF);
    expect(resultCRLF!.length).toBe(3);
  });

  it('should ignore non-data record types', () => {
    // Type 02 = extended segment address, Type 04 = extended linear address
    const hex = `:020000021000EC
:03010000C30001F8
:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(3);
    expect(result![0]).toBe(0xC3);
  });

  it('should handle real-world assembler output', () => {
    // Typical output from ZASM for a simple "Hello World"
    const hex = `:10010000110801CD05000EC309000D0A48656C6CC8
:0C011000792057696C64210D0A2400C7
:00000001FF
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(0x1C); // 28 bytes
    // Check for "Hell" string starting at offset 12 (bytes 12-15 are 48 65 6C 6C)
    expect(result![12]).toBe(0x48); // 'H'
    expect(result![13]).toBe(0x65); // 'e'
    expect(result![14]).toBe(0x6C); // 'l'
    expect(result![15]).toBe(0x6C); // 'l'
  });

  it('should stop at EOF record', () => {
    const hex = `:03010000C30001F8
:00000001FF
:03020000AABBCCD0
`;
    const hexBytes = new TextEncoder().encode(hex);
    const result = hexToCom(hexBytes);

    expect(result).toBeDefined();
    expect(result!.length).toBe(3); // Only first record, not data after EOF
  });
});
