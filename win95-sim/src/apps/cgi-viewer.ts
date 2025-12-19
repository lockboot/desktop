/**
 * CGI Viewer - Runs a CP/M program and renders its output as HTML.
 *
 * CGI Protocol:
 * - Program outputs HTTP-style headers followed by blank line and body
 * - Headers: Content-Type, Location, Status, etc.
 * - Body is rendered in an iframe
 *
 * Environment:
 * - CGI.ENV file provides KEY=VALUE pairs
 * - Standard CGI variables: QUERY_STRING, REQUEST_METHOD, CONTENT_LENGTH, PATH_INFO
 *
 * Form/Link Handling:
 * - Forms are intercepted and re-run the CGI with new parameters
 * - Links are intercepted and update QUERY_STRING
 */

import type { Desktop } from '../desktop';
import type { CpmWorkspace } from '../cpm/workspace';
import type { CpmExitInfo } from '../cpm/types';
import { CaptureConsole } from '../cpm/runner';
import { MergedWorkspaceFS, MemoryDriveFS } from '../cpm/workspace';

/** CGI environment variables */
interface CgiEnv {
  QUERY_STRING: string;
  REQUEST_METHOD: 'GET' | 'POST';
  CONTENT_LENGTH: string;
  PATH_INFO: string;
  [key: string]: string;
}

/** Parsed CGI response */
interface CgiResponse {
  headers: Map<string, string>;
  body: string;
  statusCode: number;
  contentType: string;
}

/** Parse CGI output into headers and body */
function parseCgiOutput(output: string): CgiResponse {
  const headers = new Map<string, string>();
  let body = output;
  let statusCode = 200;
  let contentType = 'text/html';

  // Find blank line separating headers from body
  // CGI uses \r\n or \n line endings
  const headerEndIdx = output.search(/\r?\n\r?\n/);

  if (headerEndIdx !== -1) {
    const headerSection = output.slice(0, headerEndIdx);
    const lines = headerSection.split(/\r?\n/);

    // Check if first line looks like a header (contains :)
    const hasHeaders = lines.some(line => line.includes(':'));

    if (hasHeaders) {
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const value = line.slice(colonIdx + 1).trim();
          headers.set(key, value);
        }
      }

      // Extract body after blank line
      const match = output.match(/\r?\n\r?\n([\s\S]*)/);
      body = match ? match[1] : '';

      // Parse Content-Type
      if (headers.has('content-type')) {
        contentType = headers.get('content-type')!;
      }

      // Parse Status header (CGI/1.1 style)
      if (headers.has('status')) {
        const status = headers.get('status')!;
        const code = parseInt(status, 10);
        if (!isNaN(code)) statusCode = code;
      }
    }
  }

  return { headers, body, statusCode, contentType };
}

/** Create CGI.ENV file content from environment */
function createCgiEnvContent(env: CgiEnv): string {
  let content = '';
  for (const [key, value] of Object.entries(env)) {
    content += `${key}=${value}\r\n`;
  }
  return content;
}

/** Wrap HTML body in a vintage HTML 3 structure */
function wrapHtml3(body: string): string {
  // If body already has <html> or <body>, use as-is
  if (body.toLowerCase().includes('<html') || body.toLowerCase().includes('<body')) {
    return body;
  }

  // Otherwise wrap in simple HTML 3.2 structure
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2//EN">
<html>
<head>
<meta charset="ascii">
<style>
  body { font-family: "Times New Roman", serif; font-size: 14px; margin: 10px; background: #c0c0c0; }
  a { color: blue; }
  input, select, textarea { font-family: monospace; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #808080; padding: 2px 4px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export interface CgiViewerOptions {
  desktop: Desktop;
  workspace: CpmWorkspace;
  programDrive: string;
  programName: string;
  initialQueryString?: string;
}

export async function openCgiViewer(options: CgiViewerOptions): Promise<void> {
  const { desktop, workspace, programDrive, programName, initialQueryString = '' } = options;

  // Read the .COM binary
  const binaryData = workspace.readFile(programDrive, programName);
  if (!binaryData) {
    console.error(`Cannot read ${programDrive}:${programName}`);
    return;
  }
  // Copy to ensure we have a stable reference
  const binary = new Uint8Array(binaryData);

  // Extract basename (without extension) for title
  const baseName = programName.replace(/\.[^.]+$/, '');
  const baseTitle = `${programDrive}:${baseName}`;

  // Create window with iframe - open immediately with title
  const windowId = desktop.wm.create({
    title: baseTitle,
    app: 'system.cgi',
    appName: 'CGI',
    width: 640,
    height: 480,
    icon: 'background:#fff;border:1px solid #00f'
  });

  const content = desktop.wm.getContent(windowId);
  if (!content) return;

  // Track if window is still open
  const isWindowOpen = () => document.getElementById(windowId) !== null;

  // Create simple container
  const container = document.createElement('div');
  container.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;background:#c0c0c0;';

  // Iframe for HTML content (no status bar on success)
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;border:none;background:#c0c0c0;';
  iframe.sandbox.add('allow-same-origin'); // Access contentDocument
  iframe.sandbox.add('allow-forms'); // Allow form submit events to fire
  container.appendChild(iframe);

  content.appendChild(container);

  // Current environment state
  let currentEnv: CgiEnv = {
    QUERY_STRING: initialQueryString,
    REQUEST_METHOD: 'GET',
    CONTENT_LENGTH: '0',
    PATH_INFO: `/${programName}`
  };

  // Function to update window title with iframe's title
  function updateTitleFromIframe(): void {
    const doc = iframe.contentDocument;
    if (doc) {
      const titleEl = doc.querySelector('title');
      if (titleEl && titleEl.textContent) {
        desktop.wm.setTitle(windowId, `${baseTitle} - ${titleEl.textContent}`);
      } else {
        desktop.wm.setTitle(windowId, baseTitle);
      }
    }
  }

  // Function to show error in iframe
  function showError(message: string): void {
    iframe.srcdoc = wrapHtml3(`<h1>Error</h1><p>${message}</p>`);
    desktop.wm.setTitle(windowId, `${baseTitle} - Error`);
  }

  // Function to run CGI and update iframe
  async function runCgi(env: CgiEnv, postBody?: string): Promise<void> {
    // Check if window was closed
    if (!isWindowOpen()) return;

    currentEnv = env;

    try {
      // Create CGI.ENV file in a temporary memory drive
      const envDrive = new MemoryDriveFS();
      envDrive.writeFile('CGI.ENV', new TextEncoder().encode(createCgiEnvContent(env)));

      // Create merged FS with env drive overlaid on program's drive
      const mergedFS = new MergedWorkspaceFS(workspace.getVirtualFS());
      mergedFS.addDrive(programDrive, envDrive);

      // Create capture console
      const captureConsole = new CaptureConsole();

      // Queue stdin input for POST body
      if (postBody) {
        captureConsole.queueInput(postBody);
      }

      // Build drives map
      const drives = new Map<number, string>();
      for (const config of workspace.listDriveConfigs()) {
        drives.set(config.letter.charCodeAt(0) - 65, `/${config.letter}`);
      }

      // Create emulator
      const { CpmEmulator } = await import('../cpm/emulator');

      let exitInfo: CpmExitInfo | null = null;

      const cpm = new CpmEmulator({
        fs: mergedFS,
        console: captureConsole,
        drives,
        onExit: (info) => {
          exitInfo = info;
        }
      });

      // Set current drive
      cpm.setCurrentDrive(programDrive.charCodeAt(0) - 65);

      // Run program directly
      cpm.setupTransient(binary, '');

      // Run with timeout, checking if window is still open
      const startTime = Date.now();
      const timeout = 10000; // 10 second timeout

      while (!exitInfo && Date.now() - startTime < timeout) {
        // Check if window was closed - abort if so
        if (!isWindowOpen()) return;

        await cpm.step();
        // Yield to event loop periodically
        if (cpm.tStateCount % 10000 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }

      // Check if window was closed during execution
      if (!isWindowOpen()) return;

      // Check for timeout
      if (!exitInfo) {
        showError('Program timed out (10 seconds)');
        return;
      }

      // Parse output
      const output = captureConsole.getOutput();
      const response = parseCgiOutput(output);

      // Handle Location redirect
      if (response.headers.has('location')) {
        const location = response.headers.get('location')!;
        // Parse location to extract query string for re-run
        const qIdx = location.indexOf('?');
        const newQuery = qIdx >= 0 ? location.slice(qIdx + 1) : '';
        await runCgi({ ...env, QUERY_STRING: newQuery, REQUEST_METHOD: 'GET', CONTENT_LENGTH: '0' });
        return;
      }

      // Wrap body in HTML 3 compatible structure
      const html = wrapHtml3(response.body);
      iframe.srcdoc = html;

      // Set up form/link interception and update title after iframe loads
      iframe.onload = () => {
        updateTitleFromIframe();
        setupInterception(iframe, runCgi);
      };

    } catch (err) {
      if (isWindowOpen()) {
        showError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Set up form and link interception in iframe */
  function setupInterception(
    iframe: HTMLIFrameElement,
    runCgiFn: (env: CgiEnv, postBody?: string) => Promise<void>
  ): void {
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Intercept forms
    doc.querySelectorAll('form').forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();

        const method = (form.method || 'GET').toUpperCase() as 'GET' | 'POST';
        const formData = new FormData(form);

        if (method === 'GET') {
          // Convert form data to query string
          const params = new URLSearchParams();
          formData.forEach((value, key) => {
            params.append(key, value.toString());
          });
          runCgiFn({
            ...currentEnv,
            QUERY_STRING: params.toString(),
            REQUEST_METHOD: 'GET',
            CONTENT_LENGTH: '0'
          });
        } else {
          // POST - send form data as body, preserve QUERY_STRING from URL
          const params = new URLSearchParams();
          formData.forEach((value, key) => {
            params.append(key, value.toString());
          });
          const body = params.toString();
          runCgiFn({
            ...currentEnv,
            REQUEST_METHOD: 'POST',
            CONTENT_LENGTH: body.length.toString()
          }, body);
        }
      });
    });

    // Intercept links
    doc.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();

        const href = link.getAttribute('href') || '';

        // Handle # anchors - don't reload
        if (href.startsWith('#')) return;

        // Extract query string from href
        const qIdx = href.indexOf('?');
        const newQuery = qIdx >= 0 ? href.slice(qIdx + 1) : '';

        runCgiFn({
          ...currentEnv,
          QUERY_STRING: newQuery,
          REQUEST_METHOD: 'GET',
          CONTENT_LENGTH: '0'
        });
      });
    });
  }

  // Initial run
  await runCgi(currentEnv);
}
