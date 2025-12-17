/**
 * CP/M Program Loader Utilities
 *
 * Provides utilities for file format conversion (Intel HEX, etc.)
 *
 * Note: For loading programs from packages, use the workspace module instead.
 */

/**
 * Convert Intel HEX format to binary (COM file).
 * HEX format: :LLAAAATT[DD...]CC
 * - LL = byte count
 * - AAAA = 16-bit address
 * - TT = record type (00=data, 01=EOF)
 * - DD = data bytes
 * - CC = checksum
 */
export function hexToCom(hexData: Uint8Array): Uint8Array | undefined {
  const hexStr = new TextDecoder().decode(hexData);
  const lines = hexStr.split(/[\r\n]+/);

  // Find the address range
  let minAddr = 0xFFFF;
  let maxAddr = 0;
  const dataMap = new Map<number, number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(':')) continue;

    const byteCount = parseInt(trimmed.slice(1, 3), 16);
    const address = parseInt(trimmed.slice(3, 7), 16);
    const recordType = parseInt(trimmed.slice(7, 9), 16);

    if (recordType === 0x01) break; // EOF
    if (recordType !== 0x00) continue; // Only process data records

    for (let i = 0; i < byteCount; i++) {
      const dataByte = parseInt(trimmed.slice(9 + i * 2, 11 + i * 2), 16);
      const addr = address + i;
      dataMap.set(addr, dataByte);
      minAddr = Math.min(minAddr, addr);
      maxAddr = Math.max(maxAddr, addr);
    }
  }

  if (dataMap.size === 0) return undefined;

  // For CP/M COM files, code starts at 0x0100
  // Create binary starting from minAddr (usually 0x0100)
  const startAddr = Math.min(minAddr, 0x0100);
  const size = maxAddr - startAddr + 1;
  const binary = new Uint8Array(size);

  for (const [addr, byte] of dataMap) {
    binary[addr - startAddr] = byte;
  }

  return binary;
}
