// E2E for v1.3 features: SameSite, worker isolation (+CSP), speculation rules, IndexedDB snapshots,
// encrypted team sharing, full clear, and localization.
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ext = join(process.cwd(), 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, det = '') => { results.push(ok); console.log(`${ok ? '✅' : '❌'} ${n}${det ? '  — ' + det : ''}`); };

const WORKER = `onmessage = async (e) => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('wdb', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  if (e.data.write) await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(e.data.write, 'who'); tx.oncomplete = res; });
  const who = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get('who'); r.onsuccess = () => res(r.result ?? null); });
  const cookie = await (await fetch('echo')).text();
  postMessage({ who, cookie, loc: String(self.location).slice(0, 5) });
};`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ck = req.headers.cookie ?? '';
  const who = /sid=(\w+)/.exec(ck)?.[1] ?? 'anonymous';
  if (url.pathname === '/login') { res.writeHead(302, { 'Set-Cookie': [`sid=${url.searchParams.get('u')}; Path=/; HttpOnly`], Location: '/page' }); return res.end(); }
  if (url.pathname === '/w.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(WORKER); }
  if (url.pathname === '/m.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(WORKER + '\nexport {};'); }
  if (url.pathname === '/echo') { res.writeHead(200); return res.end(ck); }
  if (url.pathname === '/xsite-set') { res.writeHead(200, { 'Set-Cookie': [`lax=${url.searchParams.get('u')}; Path=/`, `none=${url.searchParams.get('u')}; Path=/; SameSite=None; Secure`] }); return res.end('ok'); }
  if (url.pathname === '/xsite-echo') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<pre id=c>${ck}</pre>`); }
  const csp = url.searchParams.has('csp') ? { 'content-security-policy': "default-src 'self'; worker-src 'self'; script-src 'self' 'unsafe-inline'" } : {};
  res.writeHead(200, { 'content-type': 'text/html', ...csp });
  res.end(`<title>Page</title><pre id=srv>${who}</pre><script type="speculationrules">{"prefetch":[{"source":"list","urls":["/spec"]}]}</script>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const APP = `http://localhost:${PORT}`;
const OTHER = `http://127.0.0.1:${PORT}`;

const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qslf-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const d = await ctx.newPage(); await d.goto(`chrome-extension://${extId}/popup.html`);
const call = (type, p = {}) => d.evaluate(async ([t, p]) => { const r = await chrome.runtime.sendMessage({ type: t, ...p }); if (!r.ok) throw new Error(r.error); return r.result; }, [type, p]);
const callErr = (type, p = {}) => d.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).error ?? null, [type, p]);
const pageOf = async (tabId) => { for (let i = 0; i < 80; i++) { for (const p of ctx.pages()) { if (await p.evaluate(() => window.__t).catch(() => 0) === tabId) return p; } await d.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: (x) => { window.__t = x; }, args: [id] }).catch(() => {}), tabId); await sleep(100); } };

const { session: A } = await call('createSession', { session: { name: 'A' } });
const { session: B } = await call('createSession', { session: { name: 'B' } });
const ta = await call('openInSession', { id: A.id, url: `${APP}/login?u=alice` });
const tb = await call('openInSession', { id: B.id, url: `${APP}/login?u=bob` });
const pa = await pageOf(ta), pb = await pageOf(tb);
await sleep(1500);

// ---- SameSite ----
await pa.evaluate((u) => fetch(u, { mode: 'no-cors', credentials: 'include' }), `${OTHER}/xsite-set?u=alice`);
await sleep(500);
await pa.evaluate((u) => { const f = document.createElement('iframe'); f.id = 'x'; f.src = u; document.body.append(f); }, `${OTHER}/xsite-echo`);
await sleep(1200);
const xs = await pa.frameLocator('#x').locator('#c').innerText();
check('SameSite: cross-site iframe gets SameSite=None cookie', xs.includes('none=alice'), xs);
check('SameSite: cross-site iframe does NOT get Lax cookie', !xs.includes('lax=alice'), xs);
const top = await (async () => { await pa.goto(`${OTHER}/xsite-echo`); return pa.locator('#c').innerText(); })();
check('SameSite: top-level navigation still gets Lax cookie', top.includes('lax=alice'), top);
await pa.goto(`${APP}/page`);

// ---- speculation rules ----
const spec = await pa.evaluate(() => ({ scripts: document.querySelectorAll('script[type=speculationrules]').length, supports: HTMLScriptElement.supports?.('speculationrules') }));
check('Speculation rules neutralized in session tabs', spec.scripts === 0 && spec.supports === false, JSON.stringify(spec));

// ---- worker storage isolation ----
const runWorker = (p, src, opts, write) => p.evaluate(([src, opts, write]) => new Promise((res) => { try { const w = new Worker(src, opts); w.onmessage = (e) => res(e.data); w.onerror = (e) => res({ error: e.message || 'worker error' }); w.postMessage({ write }); setTimeout(() => res({ error: 'timeout' }), 4000); } catch (e) { res({ error: String(e) }); } }), [src, opts, write]);
await sleep(300);
const wa = await runWorker(pa, '/w.js', undefined, 'alice-worker');
const wb = await runWorker(pb, '/w.js', undefined, null);
check('Worker: IndexedDB inside a worker is isolated per session', wa.who === 'alice-worker' && wb.who === null, `A=${JSON.stringify(wa)} B=${JSON.stringify(wb)}`);
check('Worker: relative fetch in worker carries the session cookie', wa.cookie?.includes('sid=alice') && wb.cookie?.includes('sid=bob'), `${wa.cookie} | ${wb.cookie}`);
const ma = await runWorker(pa, '/m.js', { type: 'module' }, 'alice-module');
const mb = await runWorker(pb, '/m.js', { type: 'module' }, null);
check('Module worker: IndexedDB isolated per session', ma.who === 'alice-module' && mb.who === null, `A=${JSON.stringify(ma)} B=${JSON.stringify(mb)}`);
await pa.goto(`${APP}/page?csp=1`); await sleep(600);
const wc = await runWorker(pa, '/w.js', undefined, null);
check('Worker under strict CSP (worker-src self) still works (not wrapped)', !wc.error && wc.cookie?.includes('sid=alice'), JSON.stringify(wc));
await pa.goto(`${APP}/page`); await sleep(400);

// ---- IndexedDB snapshot + full clear + restore ----
await pa.evaluate(() => new Promise((res) => { const r = indexedDB.open('appdb', 1); r.onupgradeneeded = () => r.result.createObjectStore('items', { keyPath: 'id' }); r.onsuccess = () => { const tx = r.result.transaction('items', 'readwrite'); tx.objectStore('items').put({ id: 1, name: 'cart', at: new Date(0), bytes: new Uint8Array([1, 2, 3]) }); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
const snap = await call('takeSnapshot', { id: A.id, label: 'with idb' });
check('Snapshot includes IndexedDB', Object.values(snap.indexedDB ?? {}).flat().some((db) => db.name === 'appdb'), JSON.stringify(Object.keys(snap.indexedDB ?? {})));
const readIdb = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open('appdb'); r.onupgradeneeded = () => {}; r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('items')) { db.close(); return res(null); } const g = db.transaction('items').objectStore('items').get(1); g.onsuccess = () => { db.close(); const v = g.result; res(v ? { name: v.name, date: v.at instanceof Date, bytes: v.bytes instanceof Uint8Array ? [...v.bytes] : null } : null); }; }; r.onerror = () => res('err'); }));
await call('clearSessionData', { id: A.id });
await sleep(1500);
const afterClear = await readIdb(pa);
check('Log out / clear also wipes IndexedDB', afterClear === null, JSON.stringify(afterClear));
await call('restoreSnapshot', { id: A.id, snapId: snap.id });
await sleep(2000);
const restored = await readIdb(pa);
check('Snapshot restore brings IndexedDB back (Date/Uint8Array preserved)', restored?.name === 'cart' && restored.date && JSON.stringify(restored.bytes) === '[1,2,3]', JSON.stringify(restored));
check('…and the login', (await pa.locator('#srv').innerText()) === 'alice');

// ---- encrypted team share ----
const tooShort = await callErr('exportShare', { id: A.id, passphrase: 'short' });
check('Share requires a passphrase of 8+ characters', /PASSPHRASE_TOO_SHORT/.test(tooShort ?? ''), tooShort);
const file = await call('exportShare', { id: A.id, passphrase: 'team secret 123' });
check('Share file is encrypted (no cookie values inside)', file.format === 'qa-sessionlab-share' && !JSON.stringify(file).includes('alice'));
const wrong = await callErr('importShare', { file, passphrase: 'not the secret' });
check('Wrong passphrase is rejected', /WRONG_PASSPHRASE/.test(wrong ?? ''), wrong);
const imported = await call('importShare', { file, passphrase: 'team secret 123' });
const ti = await call('openInSession', { id: imported.id, url: `${APP}/page` });
// read through the extension API: Playwright can lose track of a new tab whose first navigation Chrome aborted
let importedWho = '';
for (let i = 0; i < 80 && importedWho !== 'alice'; i++) {
  importedWho = await d.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.querySelector('#srv')?.textContent ?? '' }).catch(() => [{ result: '' }]))[0]?.result ?? '', ti);
  if (importedWho !== 'alice') await sleep(100);
}
check('Teammate import logs in as the shared user', importedWho === 'alice', `${imported.name}: ${importedWho}`);

// ---- localization ----
await call('saveSettings', { patch: { language: 'id' } });
const sp = await ctx.newPage();
await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
await sleep(800);
const tabsId = await sp.locator('nav.tabs').innerText();
check('UI switches to Bahasa Indonesia', tabsId.includes('Sesi') && tabsId.includes('Pengaturan'), tabsId.replace(/\n/g, ' | '));
await call('saveSettings', { patch: { language: 'ja' } });
await sp.reload(); await sleep(800);
const tabsJa = await sp.locator('nav.tabs').innerText();
check('UI switches to 日本語', tabsJa.includes('セッション') && tabsJa.includes('設定'), tabsJa.replace(/\n/g, ' | '));
await call('saveSettings', { patch: { language: 'id' } });
await call('startRecording', { tabId: ta, title: 'lokal' });
await sleep(300);
const rec = await call('stopRecording', { tabId: ta });
const { toMarkdownCheck } = { toMarkdownCheck: null };
const md = await sp.evaluate(async (id) => { const r = await chrome.runtime.sendMessage({ type: 'getRecording', id }); return JSON.stringify(r.result?.title); }, rec.id);
check('Recording works with localized UI', md.includes('lokal'));
await call('saveSettings', { patch: { language: 'auto' } });

console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await ctx.close(); server.close();
process.exit(results.every(Boolean) ? 0 : 1);
