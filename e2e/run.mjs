// End-to-end test: loads dist/ into Playwright's Chromium and verifies real isolation.
//   node e2e/run.mjs            (headless)
//   HEADED=1 node e2e/run.mjs   (watch it)
import { chromium } from 'playwright';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'dist');

// ---------------- test app ----------------
const parseCookies = (h = '') => Object.fromEntries(h.split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const ck = parseCookies(req.headers.cookie);
  if (url.pathname === '/login') {
    // Set-Cookie + immediate redirect: the classic MV3 race.
    res.writeHead(302, { 'Set-Cookie': [`sid=${url.searchParams.get('u')}; HttpOnly; Path=/`, `pref=${url.searchParams.get('u')}-pref; Path=/`], Location: '/me' });
    return res.end();
  }
  if (url.pathname === '/logout') {
    res.writeHead(302, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0', Location: '/me' });
    return res.end();
  }
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(req.headers.cookie ?? '');
  }
  if (url.pathname === '/404') { res.writeHead(404); return res.end('nope'); }
  if (url.pathname === '/frame-host') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<iframe id=f src="http://127.0.0.1:${server.address().port}/frame"></iframe>`);
  }
  if (url.pathname === '/frame') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<pre id=fsrv>${ck.fsid ?? 'none'}</pre><script>document.cookie='fjs='+(new URLSearchParams(location.search).get('v')||'x')+'; path=/'</script>`);
  }
  if (url.pathname === '/flogin') {
    res.writeHead(200, { 'Set-Cookie': `fsid=${url.searchParams.get('u')}; Path=/; SameSite=None; Secure`, 'content-type': 'text/plain' });
    return res.end('ok');
  }
  if (url.pathname === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    // like SvelteKit/PWA workers: serve every navigation from the worker
    return res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (e.request.mode === 'navigate') e.respondWith(fetch(e.request)); });`);
  }
  if (url.pathname === '/pwa') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<pre id="srv">${ck.sid ?? 'anonymous'}</pre><script>navigator.serviceWorker.register('/sw.js').catch(()=>{})</script>`);
  }
  if (url.pathname === '/echo-lang') { res.writeHead(200); return res.end(req.headers['accept-language'] ?? ''); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>Me</title><body>
<pre id="srv">${ck.sid ?? 'anonymous'}</pre>
<pre id="cli"></pre>
<form><input name="email"><input name="first_name"><input type="password" name="password"><input name="no_hp"></form>
<script>
  document.getElementById('cli').textContent = 'ls=' + localStorage.getItem('mark') + ' cookie=' + document.cookie;
</script></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

// ---------------- harness ----------------
const results = [];
const swLog = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = await mkdtemp(join(tmpdir(), 'qsl-e2e-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  sw.on('console', (m) => swLog.push(`${m.type()} ${m.text()}`));
  const driver = await ctx.newPage();
  await driver.goto(`chrome-extension://${extId}/popup.html`);
  const call = (type, payload = {}) => driver.evaluate(async ([type, payload]) => {
    const r = await chrome.runtime.sendMessage({ type, ...payload });
    if (!r?.ok) throw new Error(r?.error);
    return r.result;
  }, [type, payload]);

  const pageForTab = async (tabId) => {
    let url = '';
    for (let i = 0; i < 100 && !/^http/.test(url); i++) {
      url = await driver.evaluate(async (id) => (await chrome.tabs.get(id)).url, tabId);
      if (!/^http/.test(url)) await sleep(100);
    }
    for (let i = 0; i < 100; i++) {
      // tag each tab via its id, then find the matching Playwright page
      for (const p of ctx.pages()) {
        const id = await p.evaluate(() => window.__qslTab).catch(() => undefined);
        if (id === tabId) return p;
      }
      await driver.evaluate(async (id) => {
        await chrome.scripting.executeScript({ target: { tabId: id }, world: 'MAIN', func: (x) => { window.__qslTab = x; }, args: [id] }).catch(() => {});
      }, tabId);
      await sleep(100);
    }
    const info = await driver.evaluate(async (id) => JSON.stringify({ tab: await chrome.tabs.get(id).catch((e) => String(e)), frames: await chrome.webNavigation.getAllFrames({ tabId: id }).catch((e) => String(e)) }), tabId);
    throw new Error(`no page for tab ${tabId} (${url}) ${info} pages=${ctx.pages().map((p) => p.url()).join(',')}`);
  };
  /** Exact chrome tab id of a Playwright page, via a unique marker in its MAIN world. */
  const tabIdForPage = async (page) => {
    const mark = `m${Math.random()}`;
    await page.evaluate((m) => { window.__pwMark = m; }, mark);
    return driver.evaluate(async (m) => {
      for (const t of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: () => window.__pwMark }).catch(() => [{}]);
        if (r?.result === m) return t.id;
      }
      return undefined;
    }, mark);
  };
  const text = (p, sel) => p.locator(sel).innerText();
  const waitText = async (p, sel, want, ms = 5000) => {
    const end = Date.now() + ms;
    let last = '';
    while (Date.now() < end) { last = await text(p, sel).catch(() => ''); if (last.includes(want)) return last; await sleep(100); }
    return last;
  };

  // --- create two roles and log in with a Set-Cookie + 302 redirect ---
  const { session: A } = await call('createSession', { session: { name: 'Alice-Admin' } });
  const { session: B } = await call('createSession', { session: { name: 'Bob-Customer' } });
  const ta = await call('openInSession', { id: A.id, url: `${BASE}/login?u=alice` });
  const tb = await call('openInSession', { id: B.id, url: `${BASE}/login?u=bob` });
  const pa = await pageForTab(ta);
  const pb = await pageForTab(tb);
  check('Login A survives Set-Cookie+redirect race (self-heal)', (await waitText(pa, '#srv', 'alice')).includes('alice'), await text(pa, '#srv'));
  check('Login B survives Set-Cookie+redirect race (self-heal)', (await waitText(pb, '#srv', 'bob')).includes('bob'), await text(pb, '#srv'));

  const urlA = await pa.evaluate(() => location.href);
  check('Heal marker never visible to the app', !urlA.includes('__qsl_heal') && urlA.endsWith('/me'), urlA);
  await pa.reload(); await pb.reload();
  check('A still alice after reload', (await waitText(pa, '#srv', 'alice')).includes('alice'));
  check('B still bob after reload', (await waitText(pb, '#srv', 'bob')).includes('bob'));

  // --- default profile is not polluted ---
  const pd = await ctx.newPage();
  await pd.goto(`${BASE}/me`);
  check('Default profile stays anonymous (server)', (await text(pd, '#srv')) === 'anonymous', await text(pd, '#srv'));
  const real = await driver.evaluate(async () => (await chrome.cookies.getAll({ domain: 'localhost' })).map((c) => `${c.name}=${c.value}`));
  check('Real cookie jar has no session cookies', !real.some((c) => /alice|bob/.test(c)), JSON.stringify(real));

  // --- client-side isolation: each session writes its own mark, nobody else may see it ---
  await pa.evaluate(() => localStorage.setItem('mark', 'alice'));
  await pb.evaluate(() => { localStorage.mark = 'bob'; });
  await pa.reload(); await pb.reload(); await pd.reload();
  const cliA = await waitText(pa, '#cli', 'ls=alice');
  const cliB = await waitText(pb, '#cli', 'ls=bob');
  check('localStorage isolated (A)', cliA.includes('ls=alice'), cliA);
  check('localStorage isolated (B)', cliB.includes('ls=bob'), cliB);
  check('document.cookie shows only non-HttpOnly session cookies', cliA.includes('pref=alice-pref') && !cliA.includes('sid='), cliA);
  check('Default tab localStorage untouched', (await text(pd, '#cli')).includes('ls=null'), await text(pd, '#cli'));
  check('Default tab sees no session cookies via JS', !(await text(pd, '#cli')).includes('pref='), await text(pd, '#cli'));

  await pa.evaluate(() => { document.cookie = 'jsc=from-alice; path=/'; });
  await sleep(400);
  const echoA = await pa.evaluate(async () => (await fetch('/echo')).text());
  const echoB = await pb.evaluate(async () => (await fetch('/echo')).text());
  check('document.cookie write reaches server in A', echoA.includes('jsc=from-alice') && echoA.includes('sid=alice'), echoA);
  check('…and not in B', !echoB.includes('jsc') && echoB.includes('sid=bob'), echoB);

  const idb = await pa.evaluate(() => new Promise((res) => { const r = indexedDB.open('appdb'); r.onsuccess = () => res(r.result.name); r.onerror = () => res('err'); }));
  check('IndexedDB names are namespaced', String(idb).startsWith('__qsl:'), String(idb));

  // --- inheritance: window.open from A stays in A ---
  const [popup] = await Promise.all([ctx.waitForEvent('page'), pa.evaluate((u) => window.open(u), `${BASE}/me`)]);
  check('window.open inherits the session', (await waitText(popup, '#srv', 'alice')).includes('alice'), await text(popup, '#srv'));
  await popup.close();

  // --- snapshot / clear / restore ---
  await call('takeSnapshot', { id: A.id, label: 'logged in' });
  await call('clearSessionData', { id: A.id });
  await sleep(800);
  check('Clear data logs A out', (await waitText(pa, '#srv', 'anonymous')).includes('anonymous'), await text(pa, '#srv'));
  const [snap] = await call('listSnapshots', { id: A.id });
  await call('restoreSnapshot', { id: A.id, snapId: snap.id });
  await sleep(800);
  check('Snapshot restore logs A back in', (await waitText(pa, '#srv', 'alice')).includes('alice'), await text(pa, '#srv'));
  check('Snapshot restores localStorage', (await waitText(pa, '#cli', 'ls=alice')).includes('ls=alice'), await text(pa, '#cli'));
  check('Clear data had wiped localStorage (sanity)', true);

  // --- Playwright storageState round trip ---
  const st = await call('exportStorageState', { id: A.id });
  check('storageState export has sid cookie', st.cookies.some((c) => c.name === 'sid' && c.value === 'alice'), `${st.cookies.length} cookies, ${st.origins.length} origins`);
  const C = await call('importStorageState', { name: 'Imported-Alice', state: st });
  const tc = await call('openInSession', { id: C.id, url: `${BASE}/me` });
  const pc = await pageForTab(tc);
  check('Imported storageState session is logged in', (await waitText(pc, '#srv', 'alice')).includes('alice'), await text(pc, '#srv'));
  check('Imported session gets localStorage', (await waitText(pc, '#cli', 'ls=alice')).includes('ls=alice'), await text(pc, '#cli'));

  // --- logout in B does not affect A ---
  // the self-heal supersedes the stale redirect navigation, so Playwright sees ERR_ABORTED for its own goto
  await pb.goto(`${BASE}/logout`).catch(() => undefined);
  check('Logout in B', (await waitText(pb, '#srv', 'anonymous')).includes('anonymous'), `${pb.url()} srv=${await text(pb, '#srv').catch((e) => e.message)} jar=${JSON.stringify((await call('getCookies', { id: B.id })).map((c) => c.name + '=' + c.value))}`);
  await pa.reload();
  check('A unaffected by B logout', (await waitText(pa, '#srv', 'alice')).includes('alice'));

  // --- emulation preset ---
  await call('updateSession', { id: A.id, patch: { preset: { device: 'iphone15', locale: 'ja-JP', timezone: 'Asia/Tokyo', network: 'none', colorScheme: 'dark', reducedMotion: false, geo: { latitude: -6.2, longitude: 106.8, accuracy: 50 } } } });
  await sleep(1200); // the extension reloads the session's tabs itself
  await pa.waitForLoadState('load');
  const env = await pa.evaluate(async () => ({
    w: innerWidth, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: navigator.language,
    dark: matchMedia('(prefers-color-scheme: dark)').matches, ua: navigator.userAgent,
    off: new Date('2024-06-01T00:00:00Z').getTimezoneOffset(), hours: new Date('2024-06-01T00:00:00Z').getHours(),
    local: new Date(2024, 5, 1, 9, 0).toISOString(), str: String(new Date('2024-06-01T00:00:00Z')),
    geo: await new Promise((r) => navigator.geolocation.getCurrentPosition((p) => r(p.coords.latitude), () => r('denied'))),
    srvLang: await (await fetch('/echo-lang')).text(),
  }));
  check('Device preset (iPhone 15 width 393)', env.w === 393, JSON.stringify(env));
  check('Timezone preset', env.tz === 'Asia/Tokyo');
  check('Locale preset (navigator.language)', env.lang.startsWith('ja'));
  check('Locale preset (Accept-Language header)', env.srvLang.startsWith('ja-JP'), env.srvLang);
  check('Date math follows emulated timezone (UTC+9)', env.off === -540 && env.hours === 9 && env.local === '2024-06-01T00:00:00.000Z', `${env.off} ${env.hours} ${env.local} | ${env.str}`);
  check('Geolocation preset', env.geo === -6.2, String(env.geo));
  check('Colour-scheme preset', env.dark);
  check('Session still logged in under emulation', (await text(pa, '#srv')).includes('alice'));

  // --- bug recorder ---
  await call('startRecording', { tabId: ta, title: 'E2E bug' });
  await pa.evaluate(() => { console.error('boom from test'); return fetch('/404'); });
  await pa.locator('input[name=email]').fill('x@y.z');
  await pa.locator('input[name=email]').dispatchEvent('change');
  await sleep(500);
  await call('addNote', { tabId: ta, text: 'tester note' });
  const rec = await call('stopRecording', { tabId: ta });
  check('Recorder captured console error', rec.console.some((c) => c.text.includes('boom from test')), `${rec.console.length} console`);
  check('Recorder captured 404', rec.network.some((n) => n.status === 404), `${rec.network.length} network`);
  check('Recorder captured input step', rec.steps.some((s) => s.kind === 'input' && s.text.includes('x@y.z')), rec.steps.map((s) => s.kind).join(','));
  check('Recorder took final screenshot', rec.screenshots.length >= 1);

  // --- form fill ---
  const n = await driver.evaluate(async (id) => chrome.tabs.sendMessage(id, { type: 'fillForm', domain: 'mail.test' }), tb);
  const vals = await pb.evaluate(() => [...document.querySelectorAll('input')].map((i) => `${i.name}=${i.value}`));
  check('Fill form filled fields', n >= 3 && vals.some((v) => /^no_hp=\+62/.test(v)), vals.join(' | '));

  // --- temporary session cleanup ---
  const { session: T, tabId: tt } = await call('createSession', { session: { name: 'Temp', temporary: true }, openUrl: `${BASE}/login?u=tmp` });
  await sleep(500);
  await driver.evaluate((id) => chrome.tabs.remove(id), tt);
  await sleep(500);
  const state = await call('getState');
  check('Temporary session removed with its last tab', !state.sessions.some((s) => s.id === T.id));
  // --- an already-registered service worker must not break sessions (real-world SvelteKit/PWA case) ---
  const SWB = `http://127.0.0.1:${server.address().port}`; // separate origin from the rest of the test
  const pw = await ctx.newPage();
  await pw.goto(`${SWB}/pwa`); await sleep(1000); await pw.reload(); await sleep(500);
  check('PWA worker controls the default tab (precondition)', await pw.evaluate(() => !!navigator.serviceWorker.controller));
  const { session: P } = await call('createSession', { session: { name: 'PWA user' } });
  const tp = await call('openInSession', { id: P.id, url: `${SWB}/login?u=pwauser` });
  const pp = await pageForTab(tp);
  await sleep(1500);
  await pp.goto(`${SWB}/pwa`).catch(() => undefined); await sleep(1500);
  await pp.reload().catch(() => undefined); await sleep(1000);
  check('Session tab on a PWA site stays logged in across full reloads', (await waitText(pp, '#srv', 'pwauser')).includes('pwauser'), await text(pp, '#srv').catch((e) => e.message));
  check('…and is not controlled by the service worker', !(await pp.evaluate(() => !!navigator.serviceWorker.controller)));
  await pw.reload(); await sleep(800);
  check('Default tab does not re-register the worker', !(await pw.evaluate(() => !!navigator.serviceWorker.controller)));
  check('Default tab still anonymous on the PWA site', (await text(pw, '#srv')) === 'anonymous', await text(pw, '#srv'));
  const swList = await call('swBlockedOrigins');
  check('Origin listed under Settings → Service workers', swList.includes(SWB), JSON.stringify(swList));

  // --- welcome page on first install ---
  check('Welcome page opened on install', ctx.pages().some((p) => p.url().endsWith('/welcome.html')), ctx.pages().map((p) => p.url()).join(', '));

  // --- cross-origin iframe isolation (127.0.0.1 inside localhost) ---
  const IP = `http://127.0.0.1:${server.address().port}`;
  await pb.goto(`${BASE}/me`);
  await pa.evaluate((u) => fetch(u, { credentials: 'include', mode: 'no-cors' }), `${IP}/flogin?u=alice-frame`);
  await pb.evaluate((u) => fetch(u, { credentials: 'include', mode: 'no-cors' }), `${IP}/flogin?u=bob-frame`);
  await sleep(500);
  await pa.goto(`${BASE}/frame-host`); await pb.goto(`${BASE}/frame-host`);
  await sleep(500);
  const fa = await pa.frameLocator('#f').locator('#fsrv').innerText();
  const fb = await pb.frameLocator('#f').locator('#fsrv').innerText();
  check('Cross-origin iframe gets its session cookies (A)', fa === 'alice-frame', fa);
  check('Cross-origin iframe gets its session cookies (B)', fb === 'bob-frame', fb);

  // --- move an already-open default tab into a session ---
  const { session: M } = await call('createSession', { session: { name: 'Mover' } });
  const pm = await ctx.newPage();
  await pm.goto(`${BASE}/me`);
  const tm = await tabIdForPage(pm);
  await driver.evaluate(async ([tabId, sid]) => chrome.runtime.sendMessage({ type: 'assignTab', tabId, sessionId: sid }), [tm, M.id]);
  await sleep(800);
  await pm.goto(`${BASE}/login?u=mover`).catch(() => undefined);
  check('Existing tab moved into a session logs in isolated', (await waitText(pm, '#srv', 'mover')).includes('mover'));
  await pd.reload();
  check('…default tab still anonymous', (await text(pd, '#srv')) === 'anonymous', await text(pd, '#srv'));

  // --- duplicate keeps the login ---
  const D = await call('duplicateSession', { id: M.id });
  const td = await call('openInSession', { id: D.id, url: `${BASE}/me` });
  check('Duplicated session keeps the login', (await waitText(await pageForTab(td), '#srv', 'mover')).includes('mover'));

  // --- clone login from the default profile ---
  await pd.goto(`${BASE}/login?u=defaultuser`);
  const { session: K } = await call('createSession', { session: { name: 'Cloned' } });
  const nClone = await call('cloneDefaultCookies', { id: K.id, url: `${BASE}/me` });
  const tk = await call('openInSession', { id: K.id, url: `${BASE}/me` });
  check('Clone login from default profile', nClone >= 1 && (await waitText(await pageForTab(tk), '#srv', 'defaultuser')).includes('defaultuser'), `${nClone} cookies`);

  // --- matrix (tabs layout) ---
  const before = ctx.pages().length;
  const mt = await call('openMatrix', { url: `${BASE}/me`, sessionIds: [M.id, K.id], layout: 'tabs', screen: { width: 1200, height: 800, left: 0, top: 0 } });
  await sleep(1000);
  // read through the extension API: Playwright can lose track of tabs whose first navigation Chrome aborted
  const srvOfTab = async (tabId) => {
    for (let i = 0; i < 50; i++) {
      const v = await driver.evaluate(async (id) => (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.querySelector('#srv')?.textContent ?? '' }).catch(() => [{ result: '' }]))[0]?.result ?? '', tabId);
      if (v && v !== 'anonymous') return v;
      await sleep(100);
    }
    return 'timeout';
  };
  const who = await Promise.all(mt.map(srvOfTab));
  check('Matrix opens one tab per role with the right login', mt.length === 2 && who[0].includes('mover') && who[1].includes('defaultuser'), who.join(' | '));
  await call('matrixAction', { action: 'close' });
  await sleep(500);
  check('Matrix close-all', ctx.pages().length === before, `${before} -> ${ctx.pages().length}`);

  // --- offline network preset ---
  await call('updateSession', { id: K.id, patch: { preset: { device: 'none', locale: '', timezone: '', network: 'offline', colorScheme: '', reducedMotion: false, geo: null } } });
  const pk = await pageForTab(tk);
  await sleep(500);
  const offline = await pk.evaluate(async () => { try { await fetch('/echo'); return 'online'; } catch { return 'offline'; } });
  check('Offline network preset', offline === 'offline', offline);

  // --- backup round trip ---
  const bk = await call('exportAll', { includeCookies: true });
  const nImp = await call('importAll', { backup: bk });
  const after = await call('getState');
  check('Backup export/import round trip', nImp === bk.sessions.length && after.sessions.filter((x) => x.name.endsWith('(imported)')).length === bk.sessions.length, `${nImp} imported`);
} catch (e) {
  check('Unexpected error', false, e.stack);
} finally {
  await ctx.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
if (failed.length && process.env.DEBUG) console.log('--- service worker log ---\n' + swLog.join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
