/**
 * Demo Apps - test applications for demonstrating the desktop messaging system.
 */

import type { Desktop } from '../desktop';

// Test App HTML - shows context, receives messages, has controls
export const testAppHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'MS Sans Serif', sans-serif;
      font-size: 11px;
      padding: 8px;
      background: #c0c0c0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .section { margin-bottom: 8px; flex-shrink: 0; }
    .section.grow { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-bottom: 0; }
    .section.grow .content { flex: 1; max-height: none; }
    .section-title { font-weight: bold; margin-bottom: 4px; background: #000080; color: white; padding: 2px 4px; }
    .content { background: white; border: 1px inset #808080; padding: 4px; max-height: 80px; overflow: auto; }
    pre { white-space: pre-wrap; word-break: break-all; font-size: 10px; }
    button {
      margin: 2px; padding: 2px 8px;
      background: #c0c0c0; border: 2px outset white;
      font-size: 10px; cursor: pointer;
    }
    button:active { border: 2px inset #808080; }
    .flash { animation: flash 0.3s; }
    @keyframes flash { 0%,100% { background: #c0c0c0; } 50% { background: #ffff00; } }
    #log { font-family: monospace; font-size: 9px; }
    .buttons { display: flex; flex-wrap: wrap; }
  </style>
</head>
<body>
  <div class="section">
    <div class="section-title">Address</div>
    <div class="content"><pre id="address">{{ADDRESS}}</pre></div>
  </div>

  <div class="section">
    <div class="section-title">Context</div>
    <div class="content"><pre id="context">Loading...</pre></div>
  </div>

  <div class="section">
    <div class="section-title">Set Context</div>
    <div class="buttons" id="ctx-buttons"></div>
  </div>

  <div class="section">
    <div class="section-title">Actions</div>
    <div class="buttons">
      <button onclick="requestContext()">Refresh Context</button>
      <button onclick="broadcast()">Broadcast</button>
    </div>
  </div>

  <div class="section grow">
    <div class="section-title">Message Log</div>
    <div class="content" id="log"></div>
  </div>

  <script>
    const address = '{{ADDRESS}}';
    const parts = address.split('.');
    const logEl = document.getElementById('log');
    const contextEl = document.getElementById('context');
    const buttonsEl = document.getElementById('ctx-buttons');

    // Build context level buttons
    let path = '';
    parts.forEach((part, i) => {
      path = path ? path + '.' + part : part;
      const btn = document.createElement('button');
      btn.textContent = 'Set ' + path.split('.').slice(-2).join('.');
      const p = path;
      btn.onclick = () => setContext(p);
      buttonsEl.appendChild(btn);
    });

    function log(msg) {
      const line = document.createElement('div');
      line.textContent = new Date().toLocaleTimeString() + ': ' + msg;
      logEl.insertBefore(line, logEl.firstChild);
      if (logEl.children.length > 20) logEl.lastChild.remove();
    }

    function flash() {
      document.body.classList.remove('flash');
      void document.body.offsetWidth; // trigger reflow
      document.body.classList.add('flash');
    }

    function send(type, payload, to = 'desktop') {
      parent.postMessage({ type, to, payload }, '*');
    }

    function requestContext() {
      send('context:get', { path: address });
    }

    function setContext(path) {
      const key = prompt('Key:', 'test');
      if (!key) return;
      const value = prompt('Value:', 'value-' + Date.now());
      if (value === null) return;
      send('context:set', { path, data: { [key]: value } });
      log('Set ' + path + '.' + key + ' = ' + value);
    }

    function broadcast() {
      const msg = prompt('Message:', 'hello from ' + address);
      if (!msg) return;
      // Broadcast to all windows in same app
      const appPath = parts.slice(0, -2).join('.'); // remove windowType and windowId
      send('broadcast', { message: msg }, appPath + '\\\\..*');
      log('Broadcast to ' + appPath + '.*');
    }

    // Listen for messages
    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg.type) return;

      flash();
      log(msg.type + ': ' + JSON.stringify(msg.payload || {}).slice(0, 100));

      if (msg.type === 'context:value' || msg.type === 'context:changed') {
        contextEl.textContent = JSON.stringify(msg.payload.context, null, 2);
      }
    });

    // Initial context request
    setTimeout(requestContext, 100);
  </script>
</body>
</html>
`;

// Capability Explorer - browse the type system
export const explorerAppHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'MS Sans Serif', sans-serif;
      font-size: 11px;
      display: flex;
      height: 100vh;
      background: #c0c0c0;
    }
    .pane {
      display: flex;
      flex-direction: column;
      border: 2px inset #808080;
      background: white;
    }
    .tree-pane {
      width: 200px;
      flex-shrink: 0;
      overflow: auto;
    }
    .detail-pane {
      flex: 1;
      margin-left: 2px;
      overflow: auto;
    }
    .pane-header {
      background: #000080;
      color: white;
      padding: 2px 4px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .pane-content {
      flex: 1;
      overflow: auto;
      padding: 2px;
    }

    /* Tree styles */
    .tree-node {
      cursor: pointer;
      white-space: nowrap;
    }
    .tree-node-row {
      display: flex;
      align-items: center;
      padding: 1px 2px;
    }
    .tree-node-row:hover {
      background: #e0e0e0;
    }
    .tree-node-row.selected {
      background: #000080;
      color: white;
    }
    .tree-toggle {
      width: 16px;
      text-align: center;
      font-family: monospace;
      font-size: 10px;
      flex-shrink: 0;
    }
    .tree-icon {
      width: 16px;
      height: 16px;
      margin-right: 4px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .tree-children {
      margin-left: 16px;
      display: none;
    }
    .tree-node.expanded > .tree-children {
      display: block;
    }

    /* Detail view */
    .manifest-header {
      background: #c0c0c0;
      padding: 8px;
      border-bottom: 1px solid #808080;
    }
    .manifest-header h2 {
      font-size: 14px;
      margin-bottom: 4px;
    }
    .manifest-header .meta {
      color: #404040;
      font-size: 10px;
    }
    .section {
      margin: 8px;
    }
    .section-title {
      font-weight: bold;
      background: #c0c0c0;
      padding: 2px 4px;
      margin-bottom: 4px;
      border: 1px outset white;
    }
    .item {
      margin: 4px 0;
      padding: 4px;
      border: 1px solid #c0c0c0;
      background: #f8f8f8;
    }
    .item-name {
      font-weight: bold;
      color: #000080;
    }
    .item-desc {
      color: #404040;
      font-size: 10px;
      margin-top: 2px;
    }
    .schema {
      font-family: monospace;
      font-size: 10px;
      background: #ffffcc;
      padding: 4px;
      margin-top: 4px;
      border: 1px inset #808080;
      white-space: pre-wrap;
      max-height: 100px;
      overflow: auto;
    }
    .empty {
      color: #808080;
      font-style: italic;
      padding: 8px;
    }
    .path-display {
      font-family: monospace;
      font-size: 10px;
      color: #808080;
    }

    /* Icons */
    .icon-folder { color: #c0a000; }
    .icon-folder::before { content: '📁'; }
    .icon-manifest { color: #000080; }
    .icon-manifest::before { content: '📦'; }
    .icon-tool { color: #008000; }
    .icon-tool::before { content: '⚙️'; font-size: 10px; }
    .icon-event { color: #800080; }
    .icon-event::before { content: '⚡'; }
  </style>
</head>
<body>
  <div class="pane tree-pane">
    <div class="pane-header">Capabilities</div>
    <div class="pane-content" id="tree"></div>
  </div>
  <div class="pane detail-pane">
    <div class="pane-header">Details</div>
    <div class="pane-content" id="detail">
      <div class="empty">Select a node to view details</div>
    </div>
  </div>

  <script>
    const ADDRESS = '{{ADDRESS}}';
    let allPaths = [];
    let manifests = {};
    let selectedPath = null;

    function send(type, payload) {
      parent.postMessage({ type, to: 'desktop', payload }, '*');
    }

    // Build tree structure from flat paths
    function buildTree(paths) {
      const root = { children: {}, path: '', hasManifest: false };

      for (const path of paths) {
        const parts = path.split('.');
        let node = root;
        let currentPath = '';

        for (const part of parts) {
          currentPath = currentPath ? currentPath + '.' + part : part;
          if (!node.children[part]) {
            node.children[part] = {
              name: part,
              children: {},
              path: currentPath,
              hasManifest: false
            };
          }
          node = node.children[part];
        }
        node.hasManifest = true;
      }

      return root;
    }

    function renderTree(node, container, depth = 0) {
      const children = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));

      for (const child of children) {
        const hasChildren = Object.keys(child.children).length > 0;
        const div = document.createElement('div');
        div.className = 'tree-node' + (hasChildren ? '' : ' leaf');

        const row = document.createElement('div');
        row.className = 'tree-node-row';
        row.dataset.path = child.path;

        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        toggle.textContent = hasChildren ? '+' : '';

        const icon = document.createElement('span');
        icon.className = 'tree-icon ' + (child.hasManifest ? 'icon-manifest' : 'icon-folder');

        const label = document.createElement('span');
        label.textContent = child.name;

        row.appendChild(toggle);
        row.appendChild(icon);
        row.appendChild(label);
        div.appendChild(row);

        if (hasChildren) {
          const childContainer = document.createElement('div');
          childContainer.className = 'tree-children';
          renderTree(child, childContainer, depth + 1);
          div.appendChild(childContainer);

          toggle.onclick = (e) => {
            e.stopPropagation();
            div.classList.toggle('expanded');
            toggle.textContent = div.classList.contains('expanded') ? '-' : '+';
          };
        }

        row.onclick = () => selectNode(child.path, row);
        container.appendChild(div);
      }
    }

    function selectNode(path, rowEl) {
      // Update selection
      document.querySelectorAll('.tree-node-row.selected').forEach(el => el.classList.remove('selected'));
      rowEl.classList.add('selected');
      selectedPath = path;

      // Query manifest if we have one
      if (manifests[path]) {
        renderDetail(path, manifests[path]);
      } else {
        send('capability:query', { path });
        document.getElementById('detail').innerHTML = '<div class="empty">Loading...</div>';
      }
    }

    function renderDetail(path, manifest) {
      const detail = document.getElementById('detail');

      if (!manifest) {
        detail.innerHTML = \`
          <div class="manifest-header">
            <h2>\${path.split('.').pop()}</h2>
            <div class="path-display">\${path}</div>
            <div class="meta">No manifest registered at this path</div>
          </div>
          <div class="empty">This is a namespace node only. Capabilities are registered at child paths.</div>
        \`;
        return;
      }

      const toolsHtml = manifest.tools.length ? manifest.tools.map(t => \`
        <div class="item">
          <div class="item-name"><span class="tree-icon icon-tool"></span>\${t.name}</div>
          \${t.description ? '<div class="item-desc">' + t.description + '</div>' : ''}
          <div class="schema">\${JSON.stringify(t.inputSchema, null, 2)}</div>
        </div>
      \`).join('') : '<div class="empty">No tools</div>';

      const eventsHtml = manifest.events.length ? manifest.events.map(e => \`
        <div class="item">
          <div class="item-name"><span class="tree-icon icon-event"></span>\${e.name}</div>
          \${e.description ? '<div class="item-desc">' + e.description + '</div>' : ''}
          \${e.schema ? '<div class="schema">' + JSON.stringify(e.schema, null, 2) + '</div>' : ''}
        </div>
      \`).join('') : '<div class="empty">No events</div>';

      detail.innerHTML = \`
        <div class="manifest-header">
          <h2>\${manifest.name}</h2>
          <div class="path-display">\${path}</div>
          <div class="meta">v\${manifest.version}\${manifest.description ? ' — ' + manifest.description : ''}</div>
        </div>
        <div class="section">
          <div class="section-title">Tools (\${manifest.tools.length})</div>
          \${toolsHtml}
        </div>
        <div class="section">
          <div class="section-title">Events (\${manifest.events.length})</div>
          \${eventsHtml}
        </div>
      \`;
    }

    function refresh() {
      send('capability:list', { prefix: '' });
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (!msg.type) return;

      if (msg.type === 'capability:list-result') {
        allPaths = msg.payload.paths;
        const tree = buildTree(allPaths);
        const container = document.getElementById('tree');
        container.innerHTML = '';
        renderTree(tree, container);

        // Auto-expand and select system
        const systemRow = container.querySelector('[data-path="system"]');
        if (systemRow) {
          systemRow.click();
        }
      }

      if (msg.type === 'capability:result') {
        const { path, manifest } = msg.payload;
        manifests[path] = manifest;
        if (path === selectedPath) {
          renderDetail(path, manifest);
        }
      }

      if (msg.type === 'capability:changed') {
        // Refresh tree when capabilities change
        refresh();
      }
    });

    // Initial load
    setTimeout(refresh, 100);
  </script>
</body>
</html>
`;

/**
 * Register demo apps with the desktop taskbar.
 */
export function registerDemoApps(desktop: Desktop): void {
  let testCount = 0;

  desktop.taskbar.addItem('background:#008080', 'Test App A', () => {
    testCount++;
    desktop.createInlineApp({
      title: `Instance ${testCount}`,
      app: 'com.test.appA',
      appName: 'App A',
      windowType: 'main',
      html: testAppHtml,
      width: 350,
      height: 400,
      icon: 'background:#008080'
    });
  });

  desktop.taskbar.addItem('background:#800080', 'Test App B', () => {
    testCount++;
    desktop.createInlineApp({
      title: `Instance ${testCount}`,
      app: 'com.test.appB',
      appName: 'App B',
      windowType: 'main',
      html: testAppHtml,
      width: 350,
      height: 400,
      icon: 'background:#800080'
    });
  });

  desktop.taskbar.addItem('background:#808000', 'Shared Context', () => {
    testCount++;
    desktop.createInlineApp({
      title: `Shared ${testCount}`,
      app: 'com.test.shared',
      appName: 'Shared',
      windowType: 'viewer',
      html: testAppHtml,
      width: 350,
      height: 400,
      icon: 'background:#808000'
    });
  });

  desktop.taskbar.addItem('background:#000080', 'Explorer', () => {
    desktop.createInlineApp({
      title: 'Types',
      app: 'system.explorer',
      appName: 'Explorer',
      windowType: 'main',
      html: explorerAppHtml,
      width: 600,
      height: 450,
      icon: 'background:#000080'
    });
  });
}
