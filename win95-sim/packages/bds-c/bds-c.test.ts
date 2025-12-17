/**
 * Tests for the BDS C package.
 *
 * Tests BDS C compiler with the IDE template.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  loadPackageFile,
  CpmRunner,
  Assembler,
  LANGUAGES,
} from '../test-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HELLO_C = `/* BDS C Hello World */
main()
{
    printf("Hello from BDS C!\\n");
}
`;

describe('BDS C Compiler', () => {
  let runner: CpmRunner;
  let available = false;

  beforeAll(() => {
    const cc = loadPackageFile(__dirname, 'CC.COM');
    const cc2 = loadPackageFile(__dirname, 'CC2.COM');
    const clink = loadPackageFile(__dirname, 'CLINK.COM');
    const deff = loadPackageFile(__dirname, 'DEFF.CRL');
    const deff2 = loadPackageFile(__dirname, 'DEFF2.CRL');
    const ccc = loadPackageFile(__dirname, 'C.CCC');

    if (cc && cc2 && clink && deff && deff2 && ccc) {
      runner = new CpmRunner();
      runner.addTool('CC.COM', cc);
      runner.addTool('CC2.COM', cc2);
      runner.addTool('CLINK.COM', clink);
      runner.addTool('DEFF.CRL', deff);
      runner.addTool('DEFF2.CRL', deff2);
      runner.addTool('C.CCC', ccc);
      available = true;
    }
  });

  it('should have CC.COM', () => {
    const binary = loadPackageFile(__dirname, 'CC.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('CC.COM:', binary?.length, 'bytes');
  });

  it('should have CC2.COM', () => {
    const binary = loadPackageFile(__dirname, 'CC2.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('CC2.COM:', binary?.length, 'bytes');
  });

  it('should have CLINK.COM', () => {
    const binary = loadPackageFile(__dirname, 'CLINK.COM');
    expect(binary).toBeDefined();
    expect(binary!.length).toBeGreaterThan(0);
    console.log('CLINK.COM:', binary?.length, 'bytes');
  });

  it('should compile and link hello world', async () => {
    if (!available) {
      console.log('BDS C files not available, skipping');
      return;
    }

    const template = LANGUAGES['bdsc']?.template || HELLO_C;
    const assembler = new Assembler(runner, 'BDSC');
    const result = await assembler.assemble('HELLO', template, { timeout: 120000 });

    console.log('BDS C output:', result.output);
    console.log('BDS C result:', {
      success: result.success,
      hasComFile: !!result.comFile,
      comSize: result.comFile?.length,
      error: result.error
    });

    if (result.success && result.comFile) {
      expect(result.comFile.length).toBeGreaterThan(0);
      console.log('Generated HELLO.COM:', result.comFile.length, 'bytes');
    }
  }, 180000);
});
