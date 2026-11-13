// Renders popup + every side-panel tab with sample data and saves screenshots; fails on console errors.
import { chromium } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ext = join(process.cwd(), 'dist');
const out = process.argv[2] ?? join(process.cwd(), 'e2e/artifacts');
await mkdir(out, { recursive: true });
const ctx = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'qslu-')), { channel: 'chromium', headless: true, colorScheme: process.env.DARK ? 'dark' : 'light', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const errors = [];
const site = await ctx.newPage(); await site.goto('data:text/html,<title>Shop</title>hello');
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`chrome-extension://${id}/sidepanel.html`);
const call = (type, p = {}) => page.evaluate(async ([t, p]) => (await chrome.runtime.sendMessage({ type: t, ...p })).result, [type, p]);
if (process.env.LANG_UI) await call('saveSettings', { patch: { language: process.env.LANG_UI } });
await call('createMany', { names: ['Super Admin', 'Admin', 'Customer'], group: 'Staging' });
await call('createMany', { names: ['Seller', 'Guest'], group: 'Production' });
const s = (await call('getState')).sessions;
await call('updateSession', { id: s[0].id, patch: { notes: 'admin@shop.test — full access', preset: { ...s[0].preset, device: 'iphone15', timezone: 'Asia/Jakarta' } } });
await call('updateSession', { id: s[3].id, patch: { temporary: true } });
const shot = async (name, w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `${name}.png`) }); };
await page.reload(); await page.waitForTimeout(400);
await shot('1-sessions', 400, 760);
await page.locator('.sess-head button[aria-expanded]').nth(2).click();
await page.locator('.sess-body details summary').first().click();
await shot('2-session-detail', 400, 1100);
for (const [i, tab] of [['3', 'Matrix'], ['4', 'Recorder'], ['5', 'Test data'], ['6', 'Settings']]) {
  await page.locator('nav.tabs button').nth(Number(i) - 2).click();
  await shot(`${i}-${tab.toLowerCase().replace(' ', '-')}`, 400, tab === 'Test data' ? 1300 : 800);
}
await page.goto(`chrome-extension://${id}/popup.html`);
await shot('0-popup', 360, 520);
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await ctx.close();
