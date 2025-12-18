/**
 * Build CCP.COM from CCP.ASM using ASM.COM and LOAD.COM
 *
 * Run with: npx tsx packages/cpm22/build-ccp.ts
 */

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadPackageFile } from '../test-utils';
import { CpmRunner } from '../../src/cpm/runner';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildCCP() {
  console.log('Building CCP.COM from CCP.ASM...\n');

  // Load tools
  const asm = loadPackageFile(__dirname, 'ASM.COM');
  const load = loadPackageFile(__dirname, 'LOAD.COM');
  const ccpSource = loadPackageFile(__dirname, 'CCP.ASM');

  if (!asm || !load || !ccpSource) {
    console.error('Missing required files (ASM.COM, LOAD.COM, or CCP.ASM)');
    process.exit(1);
  }

  // Set up runner
  const runner = new CpmRunner();
  runner.addTool('ASM.COM', asm);
  runner.addTool('LOAD.COM', load);

  // Add CCP.ASM as source
  const sourceText = new TextDecoder().decode(ccpSource);
  runner.addSourceFile('CCP.ASM', sourceText);

  // Step 1: Assemble
  console.log('Step 1: ASM CCP.AAZ');
  const asmResult = await runner.run('B:ASM', {
    args: 'A:CCP.AAZ',
    trace: false,
    timeout: 120000
  });
  console.log(asmResult.output);

  const hexFile = runner.getSourceFile('CCP.HEX');
  if (!hexFile) {
    console.error('Assembly failed - no HEX file generated');
    process.exit(1);
  }
  console.log(`Generated CCP.HEX: ${hexFile.length} bytes\n`);

  // Step 2: Load (convert HEX to COM)
  console.log('Step 2: LOAD CCP');
  const loadResult = await runner.run('B:LOAD', {
    args: 'A:CCP',
    trace: false
  });
  console.log(loadResult.output);

  const comFile = runner.getSourceFile('CCP.COM');
  if (!comFile) {
    console.error('LOAD failed - no COM file generated');
    process.exit(1);
  }

  // CCP is assembled at ORG 0xDC00, so LOAD creates a file padded from 0x100
  // Extract just the CCP code starting at offset 0xDB00 (0xDC00 - 0x100)
  const CCP_ORG = 0xDC00;
  const TPA_START = 0x100;
  const ccpOffset = CCP_ORG - TPA_START; // 0xDB00

  if (comFile.length <= ccpOffset) {
    console.error(`COM file too small (${comFile.length} bytes, expected > ${ccpOffset})`);
    process.exit(1);
  }

  const ccpBinary = comFile.slice(ccpOffset);
  console.log(`\nExtracted CCP from offset 0x${ccpOffset.toString(16)}: ${ccpBinary.length} bytes`);

  // Save CCP.COM to package directory
  const outPath = join(__dirname, 'CCP.COM');
  writeFileSync(outPath, ccpBinary);
  console.log(`Saved CCP.COM: ${ccpBinary.length} bytes`);
  console.log(`Location: ${outPath}`);
  console.log(`Load address: 0x${CCP_ORG.toString(16).toUpperCase()}`);

  // Verify it looks right
  if (ccpBinary[0] === 0xC3) {
    console.log('Verification: Starts with JMP (0xC3) ✓');
  }
}

buildCCP().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
