import { cookieKey, cookiesFor, isSecureContextUrl, parseSetCookie, upsertCookie } from '../shared/cookies';
import type { StoredCookie } from '../shared/types';
import { cachedCtx, refreshRules, setCachedJar } from './ctx';
import { applyTabRules } from './rules';
import { getJar, setJar, tabSessionSync, tabsOfSessionSync } from './state';

/**
 * Keeps each session's cookie jar in sync:
 *  1. Set-Cookie on responses in session tabs  -> session jar (webRequest, extraHeaders)
 *  2. The same cookie landing in the browser's real jar is rolled back, so the default
 *     profile is never polluted (or logged out) by what happens inside sessions.
 *  3. document.cookie writes from the page shim -> session jar.
 *  4. After any jar change, DNR rules for every tab of that session are rebuilt and the
 *     non-HttpOnly cookies are pushed to the page shims.
 *  5. "Self-heal": MV3 cannot block requests, so a redirect that follows a Set-Cookie can
 *     race the rule update and be sent with a stale Cookie header. We detect that with
 *     onSendHeaders and re-issue that top-level GET once.
 */

// ---------------- (2) real-jar rollback ----------------
// Event order between webRequest and cookies.onChanged is not guaranteed, and several sessions
// may write the same cookie name at once, so we keep a short history of real-jar changes and
// a list of values claimed by sessions, and reconcile whenever either side arrives.
const realKey = (c: { name: string; domain: string; path: string }) => `${c.domain.replace(/^\./, '').toLowerCase()}|${c.path}|${c.name}`;
interface RealEvent { at: number; cookie: chrome.cookies.Cookie; removed: boolean; cause: string; handled?: boolean }
interface Claim { at: number; value: string; deleted: boolean }
const history = new Map<string, RealEvent[]>();
const claims = new Map<string, Claim[]>();
/** values any session wrote recently: never "restore" those into the default profile */
const sessionValues = new Map<string, Map<string, number>>();
/** Echoes of our own rollback writes: `${key}|${removed}|${value}` -> expiry. Only those exact events are ignored. */
const ourEchoes = new Map<string, number>();
const echoId = (k: string, removed: boolean, value: string) => `${k}|${removed ? 1 : 0}|${value}`;
function expectEcho(k: string, removed: boolean, value: string) { ourEchoes.set(echoId(k, removed, value), Date.now() + 2000); }

const WINDOW = 4000;
const fresh = <T extends { at: number }>(arr: T[] | undefined) => (arr ?? []).filter((e) => Date.now() - e.at < WINDOW);

chrome.cookies.onChanged.addListener(({ cookie, removed, cause }) => {
  const k = realKey(cookie);
  const echo = echoId(k, removed, cookie.value);
  if ((ourEchoes.get(echo) ?? 0) > Date.now()) { ourEchoes.delete(echo); return; }
  history.set(k, [...fresh(history.get(k)), { at: Date.now(), cookie, removed, cause }]);
  if (fresh(claims.get(k)).length) void reconcile(k);
});

function claim(c: StoredCookie) {
  const k = realKey(c);
  const cl: Claim = { at: Date.now(), value: c.value, deleted: c.expires !== -1 && c.expires <= Math.floor(Date.now() / 1000) };
  claims.set(k, [...fresh(claims.get(k)), cl]);
  const sv = sessionValues.get(k) ?? new Map<string, number>();
  sv.set(c.value, Date.now());
  sessionValues.set(k, sv);
  void reconcile(k);
}

const cookieUrl = (c: chrome.cookies.Cookie) => `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`;
const isSessionValue = (k: string, v: string) => Date.now() - (sessionValues.get(k)?.get(v) ?? 0) < 30_000;

let reconciling = Promise.resolve();
function reconcile(k: string) {
  reconciling = reconciling.then(() => reconcileNow(k)).catch((e) => console.warn('[QSL] reconcile', e));
  return reconciling;
}

async function reconcileNow(k: string) {
  const pending = fresh(claims.get(k));
  if (!pending.length) return;
  const events = fresh(history.get(k));
  const left: Claim[] = [];
  let removeCookie: chrome.cookies.Cookie | undefined;
  let matched = false;
  for (const cl of pending) {
    const ev = cl.deleted
      ? events.find((e) => !e.handled && e.removed && e.cause !== 'overwrite')
      : events.find((e) => !e.handled && !e.removed && e.cookie.value === cl.value);
    if (!ev) { left.push(cl); continue; }
    ev.handled = true;
    matched = true;
    if (!ev.removed) removeCookie = ev.cookie;
  }
  claims.set(k, left);
  if (!matched) return;
  // What did the default profile have before sessions touched this cookie?
  const previous = [...events].reverse().find((e) => e.removed && !isSessionValue(k, e.cookie.value))?.cookie;
  const current = (await chrome.cookies.getAll({ name: k.split('|')[2], domain: k.split('|')[0] })).find((c) => realKey(c) === k);
  if (current && (isSessionValue(k, current.value) || current.value === removeCookie?.value)) {
    expectEcho(k, true, current.value);
    await chrome.cookies.remove({ url: cookieUrl(current), name: current.name, storeId: current.storeId });
  }
  if (previous && (!current || isSessionValue(k, current.value))) {
    const o = previous;
    expectEcho(k, false, o.value);
    await chrome.cookies.set({
      url: cookieUrl(o), name: o.name, value: o.value, path: o.path, secure: o.secure, httpOnly: o.httpOnly,
      sameSite: o.sameSite, storeId: o.storeId, ...(o.hostOnly ? {} : { domain: o.domain }),
      ...(o.session || o.expirationDate === undefined ? {} : { expirationDate: o.expirationDate }),
    });
  }
}

// ---------------- (4) propagate ----------------
export async function propagateJar(sid: string) {
  const { ctx, tabs } = await refreshRules(sid);
  const visible = ctx.jar.filter((c) => !c.httpOnly);
  for (const t of tabs) chrome.tabs.sendMessage(t, { type: 'jar', sid, jar: visible }).catch(() => undefined);
}

/** Serialize jar mutations per session (read-modify-write). */
const locks = new Map<string, Promise<unknown>>();
export function withJar(sid: string, fn: (jar: StoredCookie[]) => StoredCookie[] | Promise<StoredCookie[]>): Promise<void> {
  const prev = locks.get(sid) ?? Promise.resolve();
  const run = prev.then(async () => {
    const next = await fn(await getJar(sid));
    await setJar(sid, next);
    setCachedJar(sid, next);
    stamp(sid, Date.now(), next);
    await propagateJar(sid);
  });
  locks.set(sid, run.catch(() => undefined));
  return run;
}

// ---------------- jar timeline (for stale detection) ----------------
// Each jar version is stamped with the browser-side time it became effective, so a request can be
// compared with the jar *as it was when the request was sent* (not with later changes).
const timeline = new Map<string, { t: number; jar: StoredCookie[] }[]>();
function stamp(sid: string, t: number, jar: StoredCookie[]) {
  const arr = (timeline.get(sid) ?? []).filter((v) => t - v.t < 15_000);
  arr.push({ t, jar });
  arr.sort((a, b) => a.t - b.t);
  timeline.set(sid, arr);
}
function jarAt(sid: string, t: number): StoredCookie[] | undefined {
  const arr = timeline.get(sid) ?? [];
  let best: StoredCookie[] | undefined;
  for (const v of arr) if (v.t <= t) best = v.jar;
  return best;
}
/** Last time the jar of a session changed (browser clock). */
const lastChange = (sid: string) => timeline.get(sid)?.at(-1)?.t ?? 0;

// ---------------- (1) Set-Cookie capture ----------------
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    const sid = tabSessionSync(d.tabId);
    if (!sid || !d.responseHeaders) return;
    const headers = d.responseHeaders.filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value);
    if (!headers.length) return;
    const parsed: StoredCookie[] = [];
    for (const h of headers) {
      // Some servers fold multiple cookies into one header separated by newlines.
      for (const line of h.value!.split('\n')) {
        const c = parseSetCookie(line, d.url);
        if (c) { parsed.push(c); claim(c); }
      }
    }
    if (!parsed.length) return;
    // Fast path: update this session's rules from memory right now, before the browser
    // follows a redirect / the page issues its next request. Persistence follows below.
    const base = cachedCtx(sid);
    if (base) {
      const jar = parsed.reduce((j, c) => upsertCookie(j, c), base.jar);
      setCachedJar(sid, jar);
      stamp(sid, d.timeStamp, jar);
      const ctx = { ...base, jar };
      for (const t of tabsOfSessionSync(sid)) void applyTabRules(t, ctx).catch(() => undefined);
    }
    void withJar(sid, (jar) => parsed.reduce((j, c) => upsertCookie(j, c), jar));
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders'],
);

// ---------------- (5) stale-request self-heal ----------------
const healed = new Map<string, number[]>(); // `${tab}|${url}` -> recent heal times

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    if (d.method !== 'GET') return;
    const sid = tabSessionSync(d.tabId);
    if (!sid) return;
    const sent = d.requestHeaders?.find((h) => h.name.toLowerCase() === 'cookie')?.value ?? '';
    const url = new URL(d.url);
    const got = new Set(sent.split(/;\s*/).filter(Boolean));
    const isStale = () => {
      if (d.timeStamp - lastChange(sid) > 5000) return false; // jar stable: nothing can be stale
      const jar = jarAt(sid, d.timeStamp);
      if (!jar) return false;
      const expected = cookiesFor(jar, url.hostname, { secure: isSecureContextUrl(url), includeHttpOnly: true, path: url.pathname }).map((c) => `${c.name}=${c.value}`);
      return !(expected.length === got.size && expected.every((x) => got.has(x)));
    };
    void (async () => {
      // Check immediately (fastest heal = stale page usually never renders), then once more after
      // 40ms in case the Set-Cookie event that preceded this redirect is dispatched after us
      // (event order across event types is not guaranteed).
      if (!isStale()) {
        await new Promise((r) => setTimeout(r, 40));
        if (!isStale()) return;
      }
      const key = `${d.tabId}|${d.url.split('#')[0]}`; // the heal marker must not create a new budget
      // Loop guard: at most 2 heals of the same URL in the same tab within 5s.
      const recent = (healed.get(key) ?? []).filter((t) => Date.now() - t < 5000);
      if (recent.length >= 2) return;
      healed.set(key, [...recent, Date.now()]);
      console.info('[QSL] stale cookie header on', d.url, '- re-navigating once to self-heal');
      await heal(d.tabId, d.url);
    })();
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['requestHeaders', 'extraHeaders'],
);

/** Fragment used to make the healing navigation differ from the pending stale one. Stripped by the page shim. */
export const HEAL_MARK = '#__qsl_heal';

/**
 * Re-issue a stale top-level GET with the now-correct rules.
 * Chrome ignores tabs.update() to the *same* URL while that navigation is still pending, so we
 * navigate to url + HEAL_MARK: a different URL (cancels the stale navigation before it commits),
 * identical request on the wire (fragments are never sent), and the shim removes the marker with
 * history.replaceState before any page script reads location.
 * URLs that already carry a fragment fall back to reloading right after the stale commit.
 */
async function heal(tabId: number, url: string) {
  const noHash = (u: string) => u.split('#')[0];
  // tabs.get().url may report the *pending* URL for a fresh tab; webNavigation knows the committed document.
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  if (frame?.url && noHash(frame.url) === noHash(url)) {
    // The committed page already is this URL: a fragment change would be same-document.
    // reload() starts a fresh request for it and cancels the pending stale navigation.
    await chrome.tabs.reload(tabId).catch(() => undefined);
    return;
  }
  if (!url.includes('#')) {
    // Watchdog: on very fast (local) servers Chrome can drop the replacement navigation while the
    // stale response is torn down, leaving the tab idle. Retry once if no web document committed.
    let committed = false;
    const onCommit = (n: { tabId: number; frameId: number; url: string }) => {
      if (n.tabId === tabId && n.frameId === 0 && /^https?:/.test(n.url)) committed = true;
    };
    chrome.webNavigation.onCommitted.addListener(onCommit);
    await chrome.tabs.update(tabId, { url: url + HEAL_MARK }).catch(() => undefined);
    setTimeout(async () => {
      chrome.webNavigation.onCommitted.removeListener(onCommit);
      const t = await chrome.tabs.get(tabId).catch(() => undefined);
      if (t && !committed && !t.pendingUrl && t.status !== 'loading') {
        console.info('[QSL] heal navigation was dropped; retrying', url);
        await chrome.tabs.update(tabId, { url }).catch(() => undefined);
      }
    }, 1200);
    return;
  }
  const done = (n: { tabId: number; frameId: number }) => {
    if (n.tabId !== tabId || n.frameId !== 0) return;
    chrome.webNavigation.onCommitted.removeListener(done);
    chrome.tabs.reload(tabId).catch(() => undefined);
  };
  chrome.webNavigation.onCommitted.addListener(done);
  setTimeout(() => chrome.webNavigation.onCommitted.removeListener(done), 10_000);
}

// If the stale response committed in the instant between our check and the healing navigation,
// url+HEAL_MARK becomes a same-document fragment change (no request). Catch that and reload.
chrome.webNavigation.onReferenceFragmentUpdated.addListener((n) => {
  if (n.frameId === 0 && n.url.endsWith(HEAL_MARK) && tabSessionSync(n.tabId)) {
    chrome.tabs.reload(n.tabId).catch(() => undefined);
  }
});

// ---------------- (3) document.cookie writes from the shim ----------------
export async function onScriptCookie(sid: string, header: string, url: string) {
  const c = parseSetCookie(header, url);
  // Scripts can never create HttpOnly cookies (a page could forge the bridge event).
  if (!c || c.httpOnly) return;
  await withJar(sid, (jar) => {
    const existing = jar.find((x) => cookieKey(x) === cookieKey(c));
    if (existing?.httpOnly) return jar;
    return upsertCookie(jar, c);
  });
}
