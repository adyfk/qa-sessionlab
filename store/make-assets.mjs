// Generates Chrome Web Store images from the REAL extension UI running against a local demo app.
//   node store/make-assets.mjs   ->  store/assets/*.png
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'dist');
const out = join(root, 'store/assets');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- demo app ----------
const USERS = { admin: { name: 'Rina', role: 'Admin', color: '#374151' }, customer: { name: 'Budi', role: 'Customer', color: '#374151' }, guest: null };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const sid = /sid=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
  if (url.pathname.startsWith('/api/')) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"refund_not_allowed"}'); }
  if (url.pathname === '/login') { res.writeHead(302, { 'Set-Cookie': `sid=${url.searchParams.get('u')}; Path=/; HttpOnly`, Location: '/orders' }); return res.end(); }
  const u = USERS[sid];
  const rows = [['#1042', 'Kopi Arabika 1kg', 'Rp 245.000', 'Paid'], ['#1041', 'Teh Hijau', 'Rp 89.000', 'Shipped'], ['#1040', 'Gula Aren', 'Rp 56.000', 'Refund requested']];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Acme Shop · Orders</title>
<style>body{margin:0;font:14px system-ui;background:#f6f7f9;color:#1f2328}header{display:flex;align-items:center;gap:10px;background:#111827;color:#fff;padding:12px 18px}
header b{font-size:16px}.who{margin-left:auto;display:flex;align-items:center;gap:8px}.pill{padding:2px 10px;border-radius:99px;font-weight:600;font-size:12px}
main{padding:18px}table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
td,th{padding:10px 12px;border-bottom:1px solid #eee;text-align:left}th{background:#fafafa;color:#59636e;font-weight:600}
.btn{border:1px solid #d0d7de;background:#fff;border-radius:6px;padding:4px 10px;font-size:12px}.danger{color:#d93025;border-color:#f3c0bc}
.empty{background:#fff;padding:40px;text-align:center;border-radius:8px;color:#59636e}</style>
<header><b>🛒 Acme Shop</b><span style="opacity:.6">Orders</span><span class=who>${u ? `${u.name} <span class=pill style="background:${u.color}">${u.role}</span>` : '<span class=pill style="background:#5f6368">Not logged in</span>'}</span></header>
<main>${!u ? '<div class=empty><h2>Please log in</h2>Guests can’t see orders.</div>' : `<h2 style="margin:0 0 12px">Orders</h2><table><tr><th>Order</th><th>Item</th><th>Total</th><th>Status</th><th></th></tr>
${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${u.role === 'Admin' ? '<button class=btn>Edit</button> <button class="btn danger">Refund</button>' : '<button class=btn>View</button>'}</td></tr>`).join('')}</table>
${u.role === 'Admin' ? '<p style="margin-top:14px"><button class=btn>+ New order</button> <button class=btn>Export CSV</button></p>' : ''}`}</main>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qsla-')), { channel: 'chromium', headless: true, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
const call = (type, p = {}) => panel.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).result, [type, p]);

// sessions
const made = await call('createMany', { names: ['Admin', 'Customer', 'Guest'], group: 'Acme staging', startUrl: `${BASE}/orders` });
await call('createMany', { names: ['Seller', 'Super Admin'], group: 'Production' });
const [A, C, G] = made;
await call('updateSession', { id: A.id, patch: { notes: 'rina@acme.test · full access', preset: { device: 'none', locale: 'id-ID', timezone: 'Asia/Jakarta', network: 'none', colorScheme: '', reducedMotion: false, geo: null } } });
await call('updateSession', { id: C.id, patch: { notes: 'budi@acme.test · read-only orders' } });
await call('updateSession', { id: G.id, patch: { temporary: true } });
const tabFor = async (sid, u) => { const t = await call('openInSession', { id: sid, url: `${BASE}/login?u=${u}` }); await sleep(1200); return t; };
const ta = await tabFor(A.id, 'admin');
const tc = await tabFor(C.id, 'customer');
await call('openInSession', { id: G.id, url: `${BASE}/orders` });
await sleep(1000);

const pageOf = async (tabId) => {
  for (let i = 0; i < 50; i++) {
    for (const p of ctx.pages()) {
      const t = await p.evaluate(() => window.__t).catch(() => undefined);
      if (t === tabId) return p;
    }
    await panel.evaluate(async (id) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: (x) => { window.__t = x; }, args: [id] }).catch(() => {}), tabId);
    await sleep(100);
  }
};
const pa = await pageOf(ta), pc = await pageOf(tc);
const pg = ctx.pages().find((p) => p.url().endsWith('/orders') && p !== pa && p !== pc);
for (const p of [pa, pc, pg]) { await p.setViewportSize({ width: 560, height: 420 }); await p.reload(); }
await sleep(800);
const shotsB64 = {};
const snap = async (name, page) => { shotsB64[name] = (await page.screenshot()).toString('base64'); };
await snap('admin', pa); await snap('customer', pc); await snap('guest', pg);

// a recording for the recorder screenshot
await call('startRecording', { tabId: tc, title: 'Customer sees “Refund” error on order #1040' });
await pc.evaluate(() => { console.error('TypeError: Cannot read properties of undefined (reading \'amount\')'); fetch('/api/refund/1040', { method: 'POST' }); });
await pc.locator('button').first().click();
await sleep(600);
await call('addNote', { tabId: tc, text: 'Refund button missing for customer — expected per spec 4.2' });
const rec = await call('stopRecording', { tabId: tc });

// panel screenshots (real UI)
await panel.setViewportSize({ width: 380, height: 700 });
const panelShot = async (name, prep) => { await panel.reload(); await sleep(500); if (prep) await prep(); await sleep(300); shotsB64[name] = (await panel.screenshot()).toString('base64'); };
await panelShot('p-sessions', async () => panel.getByRole('tab', { name: 'Sessions' }).click());
await panelShot('p-detail', async () => { await panel.getByRole('tab', { name: 'Sessions' }).click(); await panel.locator('button[aria-label="Details for Admin"]').click(); await panel.locator('summary', { hasText: 'Environment emulation' }).click(); await panel.evaluate(() => document.querySelector('.sess-body')?.scrollIntoView({ block: 'start' })); });
await panelShot('p-matrix', async () => { await panel.getByRole('tab', { name: 'Matrix' }).click(); for (const n of ['Admin', 'Customer', 'Guest']) await panel.locator('label.check', { hasText: n }).first().locator('input').check(); await panel.locator('input[type=url]').first().fill(`https://staging.acme.test/orders`); });
await panelShot('p-recorder', async () => { await panel.getByRole('tab', { name: 'Recorder' }).click(); await panel.locator('.list button').first().click(); await sleep(400); await panel.evaluate(() => window.scrollTo(0, 0)); });
await panelShot('p-data', async () => panel.getByRole('tab', { name: 'Test data' }).click());

// ---------- compose store images ----------
const img = (k, style = '') => `<img src="data:image/png;base64,${shotsB64[k]}" style="display:block;${style}">`;
const css = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0b1020}
.frame{position:relative;overflow:hidden;background:linear-gradient(135deg,#eef4ff 0%,#f7f9fc 55%,#fff6ec 100%)}
h1{font-size:46px;line-height:1.08;margin:0;letter-spacing:-.02em}h1 em{font-style:normal;color:#1a73e8}
p.lead{font-size:20px;color:#3c4a5c;margin:14px 0 0;line-height:1.4}.win{border-radius:12px;overflow:hidden;box-shadow:0 18px 50px rgba(15,30,60,.18),0 2px 6px rgba(15,30,60,.08);background:#fff}
.bar{height:26px;background:#e8ebf0;display:flex;align-items:center;gap:6px;padding:0 10px;font:600 12px system-ui;color:#3c4a5c}.bar i{width:9px;height:9px;border-radius:50%;background:#c7ccd4;display:inline-block}
.tab{margin-left:8px;padding:2px 10px;border-radius:6px;color:#fff}.ul{margin:22px 0 0;padding:0;list-style:none;font-size:19px;color:#25324a}.ul li{margin:10px 0;display:flex;gap:10px}.ul li:before{content:"✓";color:#188038;font-weight:800}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:#25324a}`;
const logo = `<div class=logo><img src="data:image/png;base64,${(await readFile(join(ext, 'icons/128.png'))).toString('base64')}" width=34 height=34>QA SessionLab</div>`;
const win = (label, color, k, w) => `<div class=win style="width:${w}px"><div class=bar><i></i><i></i><i></i><span class=tab style="background:${color}">${label}</span></div>${img(k, `width:${w}px`)}</div>`;

const slides = {
  'screenshot-1-side-by-side': `<div class=frame style="width:1280px;height:800px;padding:56px 64px">
    ${logo}<h1 style="margin-top:22px">Many logins. Same site.<br><em>Side by side.</em></h1>
    <p class=lead>Test Admin, Customer and Guest at the same time — in normal tabs, no extra browser profiles.</p>
    <div style="position:absolute;left:64px;top:330px">${win('Admin', '#1a73e8', 'admin', 380)}</div>
    <div style="position:absolute;left:470px;top:370px">${win('Customer', '#d93025', 'customer', 380)}</div>
    <div style="position:absolute;left:876px;top:410px">${win('Guest', '#188038', 'guest', 340)}</div></div>`,
  'screenshot-2-sessions': `<div class=frame style="width:1280px;height:800px;padding:64px;display:flex;gap:56px;align-items:center">
    <div style="flex:1">${logo}<h1 style="margin-top:22px">Every role in <em>one click</em></h1>
    <ul class=ul><li>Isolated cookies, localStorage &amp; IndexedDB per session</li><li>Coloured tab groups and [Role] tab titles</li><li>Snapshots: save a logged-in state, restore after destructive tests</li><li>Playwright storageState export / import</li><li>Clone your normal login into any role</li></ul></div>
    <div class=win style="width:380px">${img('p-sessions', 'width:380px')}</div></div>`,
  'screenshot-3-matrix': `<div class=frame style="width:1280px;height:800px;padding:64px;display:flex;gap:56px;align-items:center">
    <div class=win style="width:380px">${img('p-matrix', 'width:380px')}</div>
    <div style="flex:1">${logo}<h1 style="margin-top:22px">Role matrix for <em>RBAC testing</em></h1>
    <ul class=ul><li>Open one URL as several roles in tiled windows</li><li>Navigate, reload or go back in all of them at once</li><li>Spot permission bugs in seconds</li></ul></div></div>`,
  'screenshot-4-recorder': `<div class=frame style="width:1280px;height:800px;padding:64px;display:flex;gap:56px;align-items:center">
    <div style="flex:1">${logo}<h1 style="margin-top:22px">Bug reports that <em>write themselves</em></h1>
    <ul class=ul><li>Steps, console errors and failed requests captured</li><li>Screenshots with one shortcut (Alt+Shift+R)</li><li>Passwords masked automatically</li><li>Paste-ready Markdown for Jira, GitHub, Linear</li></ul></div>
    <div class=win style="width:380px">${img('p-recorder', 'width:380px')}</div></div>`,
  'screenshot-5-env-data': `<div class=frame style="width:1280px;height:800px;padding:56px 64px;display:flex;gap:40px;align-items:center">
    <div style="flex:1">${logo}<h1 style="margin-top:22px">Devices, locales &amp; <em>test data</em></h1>
    <ul class=ul><li>iPhone / Android / iPad / desktop emulation per role</li><li>Timezone, locale, dark mode, geolocation, offline &amp; 3G</li><li>Unique emails, phone numbers, addresses, sandbox cards</li><li>28 edge cases: boundaries, unicode, RTL, emoji</li><li>Fill a whole form from the right-click menu</li></ul></div>
    <div class=win style="width:340px">${img('p-detail', 'width:340px')}</div><div class=win style="width:340px">${img('p-data', 'width:340px')}</div></div>`,
  'promo-small-440x280': `<div class=frame style="width:440px;height:280px;padding:26px">${logo}<h1 style="font-size:30px;margin-top:16px">Many logins.<br>Same site.<br><em>Side by side.</em></h1>
    <div style="position:absolute;right:-30px;bottom:-26px;transform:rotate(-4deg)">${win('Admin', '#1a73e8', 'admin', 210)}</div></div>`,
  'promo-marquee-1400x560': `<div class=frame style="width:1400px;height:560px;padding:64px">${logo}<h1 style="margin-top:20px;font-size:56px">Many logins. Same site.<br><em>Side by side.</em></h1>
    <p class=lead style="max-width:560px">Isolated sessions, role matrix, bug recorder and test data — the QA toolkit in one extension.</p>
    <div style="position:absolute;left:720px;top:70px">${win('Admin', '#1a73e8', 'admin', 330)}</div><div style="position:absolute;left:1000px;top:200px">${win('Customer', '#d93025', 'customer', 330)}</div></div>`,
};
const sizes = { 'promo-small-440x280': [440, 280], 'promo-marquee-1400x560': [1400, 560] };
const comp = await ctx.newPage();
for (const [name, html] of Object.entries(slides)) {
  const [w, h] = sizes[name] ?? [1280, 800];
  await comp.setViewportSize({ width: w, height: h });
  await comp.setContent(`<!doctype html><style>${css}</style>${html}`);
  await sleep(150);
  // Store requires exact pixel sizes: capture at scale 1.
  await comp.screenshot({ path: join(out, `${name}.png`), scale: 'css' });
}
await ctx.close();
server.close();
console.log('assets written to', out, '· recording had', rec.console.length, 'console,', rec.network.length, 'network entries');
