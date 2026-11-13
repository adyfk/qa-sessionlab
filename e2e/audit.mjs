// Audit probes: each check tries to break isolation or security in a specific way.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ext = join(process.cwd(), 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, det = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${det ? '  — ' + det : ''}`); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const who = /sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'anonymous';
  if (url.pathname === '/login') { res.writeHead(302, { 'Set-Cookie': `sid=${url.searchParams.get('u')}; Path=/; HttpOnly`, Location: '/page' }); return res.end(); }
  // A careless API: cacheable for 5 minutes and no "Vary: Cookie"
  if (url.pathname === '/api/me') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=300' }); return res.end(JSON.stringify({ who })); }
  if (url.pathname === '/echo') { res.writeHead(200); return res.end(req.headers.cookie ?? ''); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<pre id=srv>${who}</pre>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const APP = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qsla2-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const d = await ctx.newPage(); await d.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
const call = (type, p = {}) => d.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).result, [type, p]);
const pageOf = async (tabId) => { for (let i = 0; i < 60; i++) { for (const p of ctx.pages()) { if (await p.evaluate(() => window.__t).catch(() => 0) === tabId) return p; } await d.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: (x) => { window.__t = x; }, args: [id] }).catch(() => {}), tabId); await sleep(100); } };

const { session: A } = await call('createSession', { session: { name: 'A' } });
const { session: B } = await call('createSession', { session: { name: 'B' } });
const pa = await pageOf(await call('openInSession', { id: A.id, url: `${APP}/login?u=alice` }));
const pb = await pageOf(await call('openInSession', { id: B.id, url: `${APP}/login?u=bob` }));
await sleep(1500);

// 1. HTTP cache shared between sessions
const a1 = await pa.evaluate(async () => (await (await fetch('/api/me')).json()).who);
const b1 = await pb.evaluate(async () => (await (await fetch('/api/me')).json()).who);
check('HTTP cache: B does not get A\'s cached API response', a1 === 'alice' && b1 === 'bob', `A=${a1} B=${b1}`);

// 2. page script forging the bridge to create an HttpOnly cookie
await pa.evaluate(() => document.dispatchEvent(new CustomEvent('__qsl_to_iso', { detail: JSON.stringify({ type: 'cookieSet', sid: window.__qslState.sid, header: 'forged=1; HttpOnly; Path=/', url: location.href }) })));
await sleep(600);
const jarA = await call('getCookies', { id: A.id });
check('Page script cannot forge an HttpOnly cookie', !jarA.some((c) => c.name === 'forged'), JSON.stringify(jarA.filter((c) => c.name === 'forged')));

// 3. privileged messages from a content-script context are refused
const fromContent = await d.evaluate(async (tabId) => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: async () => { try { const x = await chrome.runtime.sendMessage({ type: 'getCookies', id: 'any' }); return JSON.stringify(x); } catch (e) { return 'threw ' + e.message; } } });
  return r.result;
}, await d.evaluate(async () => (await chrome.tabs.query({ url: '*://localhost/*' }))[0].id));
check('Content-script context cannot call privileged commands', /"ok":false/.test(fromContent) || fromContent.startsWith('threw'), fromContent.slice(0, 90));

// 4. SharedWorker requests leave the tab
const sharedWorker = await pa.evaluate(async () => {
  try {
    const src = `onconnect = (e) => { const p = e.ports[0]; fetch('/echo').then(r => r.text()).then(t => p.postMessage(t)); }`;
    const w = new SharedWorker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    return await new Promise((res) => { w.port.onmessage = (e) => res('cookie:' + e.data); w.port.start(); setTimeout(() => res('timeout'), 3000); });
  } catch (e) { return 'blocked:' + e.message.slice(0, 60); }
});
check('SharedWorker cannot run outside the session', sharedWorker.startsWith('blocked') || sharedWorker.includes('sid=alice'), sharedWorker);

// 5. recorder in a NORMAL (non-session) tab keeps recording steps across navigations
const pn = await ctx.newPage();
await pn.goto(`${APP}/page`);
const tn = await d.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u && t.groupId === -1)?.id, `${APP}/page`);
await call('startRecording', { tabId: tn, title: 'normal tab' });
await pn.goto(`${APP}/page?step=2`);
await sleep(600);
await pn.locator('#srv').click();
await sleep(600);
const recN = await call('stopRecording', { tabId: tn });
check('Recorder in a normal tab survives navigation', recN.steps.some((x) => x.kind === 'click' && x.url?.includes('step=2')), recN.steps.map((x) => x.kind).join(','));

// 6. normal tabs never wake the background (efficiency)

console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await ctx.close(); server.close();
process.exit(results.every(Boolean) ? 0 : 1);
