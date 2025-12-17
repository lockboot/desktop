/**
 * Type declarations for z80-base and z80-emulator packages.
 */

declare module 'z80-base' {
  export function toHex(n: number, width: number): string;
  export function lo(n: number): number;
  export function hi(n: number): number;
  export function inc16(n: number): number;
  export function dec16(n: number): number;
  export function word(lo: number, hi: number): number;
}

declare module 'z80-emulator' {
  export interface Hal {
    tStateCount: number;
    readMemory(address: number): number;
    writeMemory(address: number, value: number): void;
    contendMemory(address: number): void;
    readPort(address: number): number;
    writePort(address: number, value: number): void;
    contendPort(address: number): void;
  }

  export interface Registers {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    h: number;
    l: number;
    f: number;
    pc: number;
    sp: number;
    ix: number;
    iy: number;
    de: number;
    bc: number;
    hl: number;
    af: number;
  }

  export class Z80 {
    constructor(hal: Hal);
    regs: Registers;
    hal: Hal;
    reset(): void;
    step(): void;
    interrupt(data: number): void;
    nmi(): void;
  }
}

declare module 'z80-disasm' {
  export interface Instruction {
    address: number;
    label?: string;
    binText(): string;
    toText(): string;
  }

  export class Disasm {
    addChunk(data: Uint8Array, org: number): void;
    addEntryPoint(address: number): void;
    disassemble(): Instruction[];
  }
}
