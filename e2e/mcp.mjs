// End-to-end test of the AI control path: real MCP client (stdio JSON-RPC) -> qsl-mcp.mjs -> WebSocket -> extension.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ext = join(process.cwd(), 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, det = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${det ? '  — ' + det : ''}`); };

// app with a real login form and a role-dependent page
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const who = /sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
  if (req.method === 'POST' && url.pathname === '/login') {
    let body = ''; for await (const c of req) body += c;
    const u = new URLSearchParams(body).get('user');
    res.writeHead(303, { 'Set-Cookie': `sid=${u}; Path=/; HttpOnly`, Location: '/orders' }); return res.end();
  }
  if (url.pathname === '/err') { res.writeHead(500); return res.end('boom'); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (url.pathname === '/login' || !who) return res.end(`<title>Login</title><form method=post action=/login><input name=user placeholder="Username"><button>Sign in</button></form>`);
  res.end(`<title>Orders</title><h1>Orders for ${who}</h1>${who === 'admin' ? '<button id=refund>Refund</button><button>Delete order</button>' : '<button>View</button>'}<button id=boom onclick="console.error('refund failed');fetch('/err')">Break</button>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://localhost:${server.address().port}`;

const PORT = 17000 + Math.floor(Math.random() * 900);
const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qslm-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const d = await ctx.newPage(); await d.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
const call = (type, p = {}) => d.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).result, [type, p]);

// MCP server first, with a WRONG token: the extension must refuse it
const startMcp = (token) => {
  const proc = spawn(process.execPath, ['tools/mcp/qsl-mcp.mjs'], { env: { ...process.env, QSL_TOKEN: token, QSL_PORT: String(PORT) }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiters = new Map(); let id = 1; const errLog = [];
  proc.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiters.get(m.id)?.(m); } });
  proc.stderr.on('data', (c) => errLog.push(String(c).trim()));
  const rpc = (method, params) => new Promise((resolve) => { const n = id++; waiters.set(n, resolve); proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const tool = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const c = r.result?.content ?? []; const t = c.find((x) => x.type === 'text')?.text; let v = t; try { v = JSON.parse(t); } catch {} return { isError: !!r.result?.isError, value: v, content: c, raw: r }; };
  return { proc, rpc, tool, errLog };
};

await call('saveSettings', { patch: { agentEnabled: true, agentPort: PORT } });
const { token } = await call('agentStatus');
await sleep(1500); // let the install migration run; it must not revert our port (regression: unlocked settings writes)
const st0 = await call('getState');
const { token: token2 } = await call('agentStatus');
check('Token is stable (no concurrent regeneration)', token2 === token && st0.settings.agentToken === token);
check('Settings survive concurrent writes (port kept)', st0.settings.agentPort === PORT && st0.settings.agentEnabled === true, `port ${st0.settings.agentPort} vs ${PORT}`);
let bad = startMcp('wrong-token');
await sleep(2500);
const badStatus = await bad.tool('qsl_status');
check('Wrong token is refused', badStatus.isError && bad.errLog.join(' ').includes('rejected'), String(badStatus.value).slice(0, 80));
bad.proc.kill(); await sleep(500);

const mcp = startMcp(token);
await sleep(600);
// a rogue local client pretending to be the extension must not learn the token
const rogue = await new Promise((resolve) => {
  const net = require('node:net');
  const sock = net.connect(PORT, '127.0.0.1', () => {
    sock.write(`GET /qsl HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: chrome-extension://rogue\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const msg = Buffer.from(JSON.stringify({ type: 'hello', nonce: 'abc' }));
    const mask = Buffer.from([1, 2, 3, 4]);
    sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | msg.length]), mask, Buffer.from(msg.map((b, i) => b ^ mask[i & 3]))]));
  });
  let got = '';
  sock.on('data', (c) => { got += c.toString('latin1'); });
  setTimeout(() => { sock.destroy(); resolve(got); }, 800);
});
check('Token is never sent to a connecting client', !rogue.includes(token) && rogue.includes('challenge'), JSON.stringify(rogue.slice(0, 300)));
const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
check('MCP initialize', init.result?.serverInfo?.name === 'qa-sessionlab');
const tl = await mcp.rpc('tools/list', {});
check('MCP lists tools', tl.result.tools.length >= 25, `${tl.result.tools.length} tools`);
await sleep(1500);
const st = await mcp.tool('qsl_status');
check('Extension connected over the bridge', !st.isError && st.value.version, JSON.stringify(st.value) + ' | ' + mcp.errLog.join(' / '));

// AI creates roles and logs in through the real form
await mcp.tool('qsl_create_session', { name: 'Admin' });
await mcp.tool('qsl_create_session', { name: 'Customer' });
const oa = await mcp.tool('qsl_open', { session: 'admin', url: `${APP}/login` });
const oc = await mcp.tool('qsl_open', { session: 'Customer', url: `${APP}/login` });
check('qsl_open returns tab ids', oa.value.tabId && oc.value.tabId);
await mcp.tool('qsl_type', { tabId: oa.value.tabId, field: 'username', value: 'admin', submit: true });
await mcp.tool('qsl_type', { tabId: oc.value.tabId, selector: 'input[name=user]', value: 'customer' });
await mcp.tool('qsl_click', { tabId: oc.value.tabId, text: 'Sign in' });
await mcp.tool('qsl_wait_for', { tabId: oa.value.tabId, text: 'Orders for admin' });
const ra = await mcp.tool('qsl_read_page', { tabId: oa.value.tabId });
const rc = await mcp.tool('qsl_read_page', { tabId: oc.value.tabId });
check('AI logged in Admin via form (type + submit)', ra.value.text?.includes('Orders for admin'), ra.value.text?.slice(0, 60));
check('AI logged in Customer via click', rc.value.text?.includes('Orders for customer'), rc.value.text?.slice(0, 60));
check('read_page lists interactive elements', ra.value.interactive?.some((x) => x.includes('Refund')));

// objective RBAC comparison
const cmp = await mcp.tool('qsl_compare_roles', { url: `${APP}/orders`, sessions: ['Admin', 'Customer'], closeTabs: true });
const byRole = Object.fromEntries(cmp.value.map((x) => [x.session, x.text]));
check('compare_roles: Admin sees Refund', byRole.Admin.includes('Refund'));
check('compare_roles: Customer does not see Refund', !byRole.Customer.includes('Refund') && byRole.Customer.includes('customer'));

// screenshot as MCP image content
const shot = await mcp.tool('qsl_screenshot', { tabId: oa.value.tabId });
check('Screenshot returned as image', shot.content[0]?.type === 'image' && shot.content[0].data.length > 1000);

// recording -> markdown report
await mcp.tool('qsl_start_recording', { tabId: oa.value.tabId, title: 'Refund breaks' });
await mcp.tool('qsl_click', { tabId: oa.value.tabId, selector: '#boom' });
await sleep(800);
const rep = await mcp.tool('qsl_stop_recording', { tabId: oa.value.tabId });
const md = rep.content[0]?.text ?? '';
check('Bug report markdown with console error + 500', md.includes('# Refund breaks') && md.includes('refund failed') && md.includes('500'), md.split('\n').slice(0, 2).join(' / '));

// state tools
const sessions = await mcp.tool('qsl_list_sessions');
check('list_sessions shows open tabs', sessions.value.find((x) => x.name === 'Admin')?.openTabs?.length >= 1);
const cookies = await mcp.tool('qsl_get_cookies', { session: 'Customer' });
check('get_cookies shows the login', cookies.value.some((c) => c.name === 'sid' && c.value === 'customer'));
const unknown = await mcp.tool('qsl_open', { session: 'Nobody', url: APP });
check('Helpful error for unknown session', unknown.isError && String(unknown.value).includes('Existing: Admin'), String(unknown.value).slice(0, 80));

console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
mcp.proc.kill(); await ctx.close(); server.close();
process.exit(results.every(Boolean) ? 0 : 1);
