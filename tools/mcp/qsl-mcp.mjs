#!/usr/bin/env node
// QA SessionLab MCP server — lets an AI agent drive the QA SessionLab extension.
//
//   AI client (Claude Code / Desktop / Cursor …) ⇄ stdio MCP ⇄ this process ⇄ ws://127.0.0.1:PORT ⇄ extension
//
// Zero dependencies (Node ≥ 18). Configure with env vars:
//   QSL_TOKEN  token shown in the extension: Settings → AI control   (required)
//   QSL_PORT   port, default 17321 (must match the extension setting)
//
// Register in Claude Code:
//   claude mcp add qa-sessionlab -e QSL_TOKEN=<token> -- node /path/to/tools/mcp/qsl-mcp.mjs
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.QSL_PORT || 17321);
const TOKEN = process.env.QSL_TOKEN || '';
const log = (...a) => process.stderr.write(`[qsl-mcp] ${a.join(' ')}\n`);

// ---------------- minimal WebSocket server (RFC 6455, text frames) ----------------
let ext = null; // { send(obj), authed }
let nextId = 1;
const pending = new Map();

function frame(str) {
  const payload = Buffer.from(str);
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
  return Buffer.concat([head, payload]);
}

const server = http.createServer((_, res) => { res.writeHead(426); res.end('QA SessionLab MCP bridge: WebSocket only'); });
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin ?? '';
  // Only the extension may connect (browsers always send Origin): rejects any web page.
  if (!origin.startsWith('chrome-extension://') && !origin.startsWith('extension://')) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const conn = { authed: false, send: (o) => socket.write(frame(JSON.stringify(o))) };
  let buf = Buffer.alloc(0);
  let fragments = [];
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let data = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const m = buf.subarray(off, off + 4); data = Buffer.from(data.map((b, i) => b ^ m[i & 3])); }
      buf = buf.subarray(need);
      if (op === 0x8) { socket.end(); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 0x1 || op === 0x0) {
        fragments.push(data);
        if (!fin) continue;
        const text = Buffer.concat(fragments).toString('utf8');
        fragments = [];
        onExtMessage(conn, text);
      }
    }
  };
  socket.on('data', onData);
  if (head?.length) onData(head); // bytes that arrived together with the upgrade request
  socket.on('close', () => { if (ext === conn) { ext = null; log('extension disconnected'); } for (const [, p] of pending) p.reject(new Error('Extension disconnected')); pending.clear(); });
  socket.on('error', () => {});
});

function onExtMessage(conn, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  // Mutual challenge-response (HMAC-SHA256); the token never travels over the socket.
  if (m.type === 'hello' && typeof m.nonce === 'string') {
    conn.nonce = crypto.randomBytes(16).toString('hex');
    conn.send({ type: 'challenge', nonce: conn.nonce, proof: hmac(`server|${m.nonce}`) });
    return;
  }
  if (m.type === 'auth') {
    if (m.ok && conn.nonce && safeEqual(m.proof, hmac(`ext|${conn.nonce}`))) { conn.authed = true; ext = conn; log('extension connected (QA SessionLab)'); }
    else if (!m.ok) log('extension rejected the token: copy it again from Settings → AI control');
    else log('a client failed to prove the token; ignored');
    return;
  }
  if (!conn.authed) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
}

const hmac = (msg) => crypto.createHmac('sha256', TOKEN).update(msg).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function waitForExtension(ms = 8000) {
  const end = Date.now() + ms;
  while (!ext && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  if (!ext) throw new Error(`QA SessionLab is not connected. In Chrome: QA SessionLab → Settings → AI control → turn it on (port ${PORT}) and make sure QSL_TOKEN matches.`);
}

async function callExt(method, params = {}, timeoutMs = 60000) {
  await waitForExtension();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    ext.send({ id, method, params });
  });
}

server.on('error', (e) => log(`cannot listen on 127.0.0.1:${PORT}: ${e.message}`));
server.listen(PORT, '127.0.0.1', () => log(`waiting for the extension on ws://127.0.0.1:${PORT}`));

// ---------------- MCP tools ----------------
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (d) => ({ type: 'string', description: d });
const num = (d) => ({ type: 'number', description: d });
const bool = (d) => ({ type: 'boolean', description: d });
const sessionRef = str('Session name (case-insensitive) or id');

const TOOLS = [
  ['qsl_status', 'Check the connection to the QA SessionLab browser extension.', S({}), 'status'],
  ['qsl_list_sessions', 'List isolated sessions (roles) with their open tab ids, presets and notes.', S({}), 'listSessions'],
  ['qsl_create_session', 'Create an isolated session (separate cookies/storage), e.g. a role like "Admin".', S({ name: str('Session / role name'), group: str('Optional group'), startUrl: str('Optional default URL'), notes: str('Optional notes, e.g. test account'), temporary: bool('Delete when its last tab closes') }, ['name']), 'createSession'],
  ['qsl_update_session', 'Update a session: name, notes, startUrl, color, or emulation preset {device, locale, timezone, network, colorScheme, reducedMotion, geo}.', S({ session: sessionRef, patch: { type: 'object', description: 'Fields to change. preset.device: iphone15|iphoneSE|pixel8|galaxyS23|galaxyA14|ipadAir|laptop|desktop|none; preset.network: offline|slow3g|fast3g|fast4g|highLatency|none' } }, ['session', 'patch']), 'updateSession'],
  ['qsl_delete_session', 'Delete a session.', S({ session: sessionRef, closeTabs: bool('Also close its tabs') }, ['session']), 'deleteSession'],
  ['qsl_clear_session', 'Log a session out: wipe its cookies and storage (tabs reload).', S({ session: sessionRef }, ['session']), 'clearSession'],
  ['qsl_open', 'Open a URL in a new tab of a session and wait for it to load. Returns tabId.', S({ session: sessionRef, url: str('URL to open') }, ['session', 'url']), 'open'],
  ['qsl_list_tabs', 'List all browser tabs with their session (null = normal profile).', S({}), 'listTabs'],
  ['qsl_navigate', 'Navigate a tab to a URL and wait for load.', S({ tabId: num('Tab id'), url: str('URL') }, ['tabId', 'url']), 'navigate'],
  ['qsl_reload', 'Reload a tab and wait for load.', S({ tabId: num('Tab id') }, ['tabId']), 'reload'],
  ['qsl_close_tab', 'Close a tab.', S({ tabId: num('Tab id') }, ['tabId']), 'closeTab'],
  ['qsl_read_page', 'Read a tab: url, title, visible text and a list of interactive elements (links, buttons, inputs).', S({ tabId: num('Tab id'), selector: str('Optional CSS selector to scope the text'), maxChars: num('Max text length, default 8000') }, ['tabId']), 'readPage'],
  ['qsl_click', 'Click an element by CSS selector or by its visible text.', S({ tabId: num('Tab id'), selector: str('CSS selector'), text: str('Visible text of a button/link') }, ['tabId']), 'click'],
  ['qsl_type', 'Type into an input found by CSS selector or by name/placeholder/label text; optionally submit its form.', S({ tabId: num('Tab id'), selector: str('CSS selector'), field: str('Field name, placeholder or label text'), value: str('Text to type'), submit: bool('Submit the form afterwards') }, ['tabId', 'value']), 'type'],
  ['qsl_wait_for', 'Wait until a selector exists and/or text appears in a tab.', S({ tabId: num('Tab id'), selector: str('CSS selector'), text: str('Text to wait for'), timeoutMs: num('Default 10000') }, ['tabId']), 'waitFor'],
  ['qsl_screenshot', 'Screenshot the visible part of a tab (PNG).', S({ tabId: num('Tab id') }, ['tabId']), 'screenshot'],
  ['qsl_compare_roles', 'Objective role/permission check: open the same URL as several sessions and return what each one sees (text + interactive elements).', S({ url: str('URL'), sessions: { type: 'array', items: { type: 'string' }, description: 'Session names or ids' }, selector: str('Optional CSS selector to compare'), closeTabs: bool('Close the tabs afterwards (default false)') }, ['url', 'sessions']), 'compare'],
  ['qsl_open_matrix', 'Open a URL as several sessions side by side (layout "tabs" or "windows").', S({ url: str('URL'), sessions: { type: 'array', items: { type: 'string' } }, layout: str('tabs | windows') }, ['url', 'sessions']), 'openMatrix'],
  ['qsl_get_cookies', 'Cookies stored in a session (to verify logins).', S({ session: sessionRef }, ['session']), 'cookies'],
  ['qsl_snapshot', 'Save the session state (cookies + localStorage) to restore later.', S({ session: sessionRef, label: str('Label') }, ['session']), 'snapshot'],
  ['qsl_list_snapshots', 'List snapshots of a session.', S({ session: sessionRef }, ['session']), 'listSnapshots'],
  ['qsl_restore_snapshot', 'Restore a snapshot (tabs reload).', S({ session: sessionRef, snapshotId: str('Snapshot id') }, ['session', 'snapshotId']), 'restoreSnapshot'],
  ['qsl_export_storage_state', 'Export a session as Playwright storageState JSON.', S({ session: sessionRef }, ['session']), 'exportStorageState'],
  ['qsl_import_storage_state', 'Create a session from a Playwright storageState JSON object.', S({ name: str('New session name'), state: { type: 'object' } }, ['name', 'state']), 'importStorageState'],
  ['qsl_fill_form', 'Fill the visible empty form fields of a tab with realistic test data.', S({ tabId: num('Tab id') }, ['tabId']), 'fillForm'],
  ['qsl_start_recording', 'Start the bug recorder on a tab (steps, console errors, failed requests).', S({ tabId: num('Tab id'), title: str('Bug title') }, ['tabId']), 'startRecording'],
  ['qsl_stop_recording', 'Stop recording and get the Markdown bug report plus raw console/network data.', S({ tabId: num('Tab id') }, ['tabId']), 'stopRecording'],
];

async function callTool(name, args) {
  const t = TOOLS.find((x) => x[0] === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  const result = await callExt(t[3], args ?? {});
  if (name === 'qsl_screenshot' && result?.dataUrl) {
    return { content: [{ type: 'image', data: result.dataUrl.split(',')[1], mimeType: 'image/png' }] };
  }
  if (name === 'qsl_stop_recording' && result?.markdown) {
    return { content: [{ type: 'text', text: result.markdown }, { type: 'text', text: JSON.stringify({ console: result.console, failedRequests: result.failedRequests }, null, 1) }] };
  }
  return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) }] };
}

// ---------------- MCP stdio (JSON-RPC 2.0, newline-delimited) ----------------
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let inBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inBuf += chunk;
  let i;
  while ((i = inBuf.indexOf('\n')) !== -1) {
    const line = inBuf.slice(0, i).trim();
    inBuf = inBuf.slice(i + 1);
    if (line) void onRpc(line);
  }
});
process.stdin.on('end', () => process.exit(0));

async function onRpc(line) {
  let m; try { m = JSON.parse(line); } catch { return; }
  const reply = (result) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  try {
    switch (m.method) {
      case 'initialize':
        return reply({
          protocolVersion: m.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'qa-sessionlab', version: '1.0.0' },
          instructions: 'Drive the QA SessionLab Chrome extension: isolated per-tab sessions (roles) on the same site. Typical flow: qsl_create_session for each role -> qsl_open(role, url) -> log in with qsl_type/qsl_click -> qsl_compare_roles(url, roles) to check permissions objectively -> qsl_start_recording/qsl_stop_recording for bug reports.',
        });
      case 'notifications/initialized': return;
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) });
      case 'tools/call':
        try { return reply(await callTool(m.params?.name, m.params?.arguments)); }
        catch (e) { return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }); }
      default: return fail(-32601, `Method not found: ${m.method}`);
    }
  } catch (e) { return fail(-32603, e.message); }
}
if (!TOKEN) log('QSL_TOKEN is not set: copy the token from QA SessionLab → Settings → AI control');
