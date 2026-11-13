// Measures how often a Set-Cookie + 302 login needs the self-heal, at various server latencies.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ext = join(process.cwd(), 'dist');
let delay = 0, stale = 0, rendered = 0;
const server = http.createServer((req, res) => { process.env.V && console.log(Date.now() % 100000, 'SRV-in', req.url, req.headers.cookie ?? ''); setTimeout(() => {
  if (req.url.startsWith('/login')) { res.writeHead(302, { 'Set-Cookie': `sid=${Math.random()}; Path=/; HttpOnly`, Location: '/me' }); return res.end(); }
  if (req.url === '/rendered-stale') { rendered++; res.writeHead(204); return res.end(); }
  const isStale = req.url === '/me' && !/sid=/.test(req.headers.cookie ?? '');
  if (isStale) stale++;
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(isStale ? '<script>fetch("/rendered-stale")</script>stale' : 'ok');
}, delay); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qslr-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const T0 = Date.now(); sw.on('console', (m) => process.env.V && console.log(Date.now() % 100000, 'SW', m.text()));
const d = await ctx.newPage(); await d.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
const call = (type, p = {}) => d.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).result, [type, p]);
for (const ms of (process.env.MS ? [Number(process.env.MS)] : [0, 20, 80])) {
  delay = ms; stale = 0; rendered = 0;
  const N = process.env.N ? Number(process.env.N) : 12;
  for (let i = 0; i < N; i++) {
    const { session } = await call('createSession', { session: { name: `r${ms}-${i}`, temporary: true } });
    const tab = await call('openInSession', { id: session.id, url: `${BASE}/login` });
    await new Promise((r) => setTimeout(r, 400 + ms * 3));
    await d.evaluate((t) => chrome.tabs.remove(t), tab);
  }
  console.log(`server latency ${ms}ms: stale request in ${stale}/${N} logins, stale page actually rendered in ${rendered}/${N}`);
}
await ctx.close(); server.close();
