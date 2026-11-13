/* eslint-disable */
import type { BootPayload, StoredCookie } from '../shared/types';

/**
 * Runs in the page's MAIN world, in every frame of a session tab, at document_start —
 * before any page script — from the static content script `main.js` (see content/main.ts),
 * fed by the Server-Timing boot payload.
 *
 * Kept self-contained (no imports/closures) so it can also be serialized and injected
 * with chrome.scripting.executeScript as a fallback.
 *
 * Isolates per session:
 *   - document.cookie and cookieStore  -> session cookie jar (kept in sync with the background)
 *   - localStorage                     -> namespaced keys "__qsl:<sid>:<key>"
 *   - indexedDB / CacheStorage / BroadcastChannel names -> prefixed
 *   - service worker registration      -> blocked (SW requests can't be attributed to a tab)
 * Emulates (when the session preset asks for it): timezone, locale, geolocation.
 */
export function qslShim(boot: BootPayload) {
  const w = window as any;
  if (w.__qslState) return;
  const sid = boot.sid;
  Object.defineProperty(w, '__qslState', { value: boot, enumerable: false });

  // Remove the self-heal marker (see cookieSync.HEAL_MARK) before the app's router sees it.
  try {
    if (window === window.top && location.hash === '#__qsl_heal') history.replaceState(history.state, '', location.href.slice(0, -'#__qsl_heal'.length));
  } catch { /* ignore */ }

  const PREFIX = `__qsl:${sid}:`;
  let cache: StoredCookie[] = boot.jar;
  const now = () => Math.floor(Date.now() / 1000);
  const loc = () => {
    try { return new URL(document.URL); } catch { return new URL(location.href); }
  };

  /** Set by the background from the document's CSP: can we wrap workers in a blob: bootstrap? */
  let workerMode: { classic: boolean; module: boolean } = { classic: false, module: false };

  // ---------- bridge ----------
  const toIso = (msg: unknown) => document.dispatchEvent(new CustomEvent('__qsl_to_iso', { detail: JSON.stringify(msg) }));
  document.addEventListener('__qsl_to_main', (e: Event) => {
    try {
      const m = JSON.parse((e as CustomEvent).detail);
      if (m.sid !== sid) return;
      if (m.type === 'jar') cache = m.jar;
      if (m.type === 'workers') workerMode = m.mode;
    } catch { /* ignore */ }
  });

  // ---------- cookie matching (mirror of shared/cookies.ts) ----------
  const domainMatch = (host: string, d: string) => host === d || host.endsWith('.' + d);
  const pathMatch = (p: string, cp: string) => p === cp || (p.startsWith(cp) && (cp.endsWith('/') || p[cp.length] === '/'));
  const visible = () => {
    const u = loc();
    const host = u.hostname.toLowerCase();
    const secure = u.protocol === 'https:' || host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
    const t = now();
    return cache
      .filter((c) => !c.httpOnly && (c.expires === -1 || c.expires > t))
      .filter((c) => (c.hostOnly ? c.domain === host : domainMatch(host, c.domain)))
      .filter((c) => !c.secure || secure)
      .filter((c) => pathMatch(u.pathname, c.path))
      .sort((a, b) => b.path.length - a.path.length);
  };
  const parse = (str: string): StoredCookie | null => {
    const u = loc();
    const host = u.hostname.toLowerCase();
    const parts = str.split(';');
    const first = parts.shift() || '';
    const i = first.indexOf('=');
    const name = (i === -1 ? '' : first.slice(0, i)).trim();
    const value = (i === -1 ? first : first.slice(i + 1)).trim();
    const dp = u.pathname.lastIndexOf('/') > 0 ? u.pathname.slice(0, u.pathname.lastIndexOf('/')) : '/';
    const c: StoredCookie = { name, value, domain: host, hostOnly: true, path: dp, expires: -1, secure: false, httpOnly: false, sameSite: 'Lax' };
    let ma = false;
    for (const raw of parts) {
      const j = raw.indexOf('=');
      const k = (j === -1 ? raw : raw.slice(0, j)).trim().toLowerCase();
      const v = j === -1 ? '' : raw.slice(j + 1).trim();
      if (k === 'domain' && v) { const d = v.toLowerCase().replace(/^\./, ''); if (!domainMatch(host, d)) return null; c.domain = d; c.hostOnly = false; }
      else if (k === 'path') c.path = v.startsWith('/') ? v : dp;
      else if (k === 'max-age') { const n = parseInt(v, 10); if (!isNaN(n)) { c.expires = n <= 0 ? 0 : now() + n; ma = true; } }
      else if (k === 'expires' && !ma) { const t = Date.parse(v); if (!isNaN(t)) c.expires = Math.max(0, Math.floor(t / 1000)); }
      else if (k === 'secure') c.secure = true;
      else if (k === 'httponly') return null; // scripts cannot create HttpOnly cookies
      else if (k === 'samesite') { const s = v.toLowerCase(); c.sameSite = s === 'strict' ? 'Strict' : s === 'none' ? 'None' : 'Lax'; }
    }
    if (!name && !value) return null;
    return c;
  };
  const keyOf = (c: StoredCookie) => `${c.hostOnly ? '=' : '.'}${c.domain}|${c.path}|${c.name}`;
  const store = (c: StoredCookie, header: string) => {
    const existing = cache.find((x) => keyOf(x) === keyOf(c));
    if (existing && existing.httpOnly) return; // cannot overwrite HttpOnly from script
    cache = cache.filter((x) => keyOf(x) !== keyOf(c));
    if (c.expires === -1 || c.expires > now()) cache.push(c);
    toIso({ type: 'cookieSet', sid, header, url: loc().href });
  };

  try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      enumerable: true,
      get() { return visible().map((c) => (c.name ? `${c.name}=${c.value}` : c.value)).join('; '); },
      set(v: string) { const c = parse(String(v)); if (c) store(c, String(v)); },
    });
  } catch { /* ignore */ }

  // Cookie Store API
  try {
    const cs = w.cookieStore;
    if (cs) {
      const toItem = (c: StoredCookie) => ({ name: c.name, value: c.value, domain: c.hostOnly ? null : c.domain, path: c.path, expires: c.expires === -1 ? null : c.expires * 1000, secure: c.secure, sameSite: c.sameSite.toLowerCase(), partitioned: false });
      const nameOf = (a: any) => (typeof a === 'string' ? a : a?.name);
      const ser = (o: any) => {
        let s = `${o.name}=${o.value ?? ''}`;
        if (o.domain) s += `; domain=${o.domain}`;
        s += `; path=${o.path ?? '/'}`;
        if (o.expires) s += `; expires=${new Date(o.expires).toUTCString()}`;
        if (o.sameSite) s += `; samesite=${o.sameSite}`;
        if (loc().protocol === 'https:') s += '; secure';
        return s;
      };
      cs.get = async (a: any) => { const n = nameOf(a); const c = visible().find((x) => n === undefined || x.name === n); return c ? toItem(c) : null; };
      cs.getAll = async (a: any) => { const n = nameOf(a); return visible().filter((x) => n === undefined || x.name === n).map(toItem); };
      cs.set = async (a: any, b?: any) => { const o = typeof a === 'string' ? { name: a, value: b } : a; const s = ser(o); const c = parse(s); if (c) store(c, s); };
      cs.delete = async (a: any) => { const o = typeof a === 'string' ? { name: a } : a; const s = `${o.name}=; path=${o.path ?? '/'}${o.domain ? `; domain=${o.domain}` : ''}; max-age=0`; const c = parse(s); if (c) store(c, s); };
    }
  } catch { /* ignore */ }

  // ---------- localStorage ----------
  try {
    const real: Storage = w.localStorage;
    const keys = () => {
      const out: string[] = [];
      for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length)); }
      return out;
    };
    // Pending snapshot restore / storageState import for this origin (applied once).
    const rs = boot.restore;
    const kv = rs?.byOrigin[location.origin];
    const doneKey = `__qsl-restored:${sid}`;
    if (rs && kv && real.getItem(doneKey) !== rs.id) {
      for (const k of keys()) real.removeItem(PREFIX + k);
      for (const [k, v] of Object.entries(kv)) real.setItem(PREFIX + k, v);
      real.setItem(doneKey, rs.id);
    }
    if (rs && kv) toIso({ type: 'restored', sid, id: rs.id, origin: location.origin });

    const api: any = {
      getItem: (k: string) => real.getItem(PREFIX + String(k)),
      setItem: (k: string, v: unknown) => real.setItem(PREFIX + String(k), String(v)),
      removeItem: (k: string) => real.removeItem(PREFIX + String(k)),
      clear: () => keys().forEach((k) => real.removeItem(PREFIX + k)),
      key: (i: number) => keys()[i] ?? null,
      get length() { return keys().length; },
    };
    Object.setPrototypeOf(api, Storage.prototype);
    const facade = new Proxy(api, {
      get(t, p) {
        if (p === 'length') return keys().length;
        if (typeof p === 'symbol' || p in t) { const v = t[p]; return typeof v === 'function' && p !== 'constructor' ? v.bind(t) : v; }
        const v = real.getItem(PREFIX + p);
        return v === null ? undefined : v;
      },
      set(t, p, v) { if (typeof p === 'string') real.setItem(PREFIX + p, String(v)); return true; },
      deleteProperty(t, p) { real.removeItem(PREFIX + String(p)); return true; },
      has(t, p) { return p in t || real.getItem(PREFIX + String(p)) !== null; },
      ownKeys() { return keys(); },
      getOwnPropertyDescriptor(t, p) {
        const v = real.getItem(PREFIX + String(p));
        return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
      },
    });
    Object.defineProperty(w, 'localStorage', { configurable: true, enumerable: true, get: () => facade });
    // Hide other sessions' / default profile's storage events.
    w.addEventListener('storage', (e: StorageEvent) => {
      if (e.storageArea === real && !(e.key ?? '').startsWith(PREFIX) && e.key !== null) e.stopImmediatePropagation();
    }, true);
  } catch { /* storage may be blocked (sandboxed iframe) */ }

  // ---------- IndexedDB ----------
  try {
    const F = w.IDBFactory?.prototype;
    if (F) {
      const open = F.open, del = F.deleteDatabase, dbs = F.databases;
      F.open = function (name: string, ...rest: any[]) {
        const r = open.call(this, PREFIX + name, ...rest);
        // Let snapshot restores (and other tabs' upgrades) proceed instead of blocking forever.
        r.addEventListener('success', () => { try { r.result.addEventListener('versionchange', () => r.result.close()); } catch { /* ignore */ } });
        return r;
      };
      F.deleteDatabase = function (name: string) { return del.call(this, PREFIX + name); };
      if (dbs) F.databases = async function () {
        const all = await dbs.call(this);
        return all.filter((d: any) => d.name?.startsWith(PREFIX)).map((d: any) => ({ ...d, name: d.name.slice(PREFIX.length) }));
      };
    }
  } catch { /* ignore */ }

  // ---------- Cache Storage ----------
  try {
    const C = w.CacheStorage?.prototype;
    if (C) {
      const { open, has, delete: del, keys } = C;
      C.open = function (n: string) { return open.call(this, PREFIX + n); };
      C.has = function (n: string) { return has.call(this, PREFIX + n); };
      C.delete = function (n: string) { return del.call(this, PREFIX + n); };
      C.keys = async function () { return (await keys.call(this)).filter((k: string) => k.startsWith(PREFIX)).map((k: string) => k.slice(PREFIX.length)); };
    }
  } catch { /* ignore */ }

  // ---------- BroadcastChannel ----------
  try {
    const BC = w.BroadcastChannel;
    if (BC) {
      const Wrapped = function (this: any, name: string) { return new BC(PREFIX + name); } as any;
      Wrapped.prototype = BC.prototype;
      w.BroadcastChannel = Wrapped;
    }
  } catch { /* ignore */ }

  // ---------- Shared workers ----------
  // Like service workers, their requests belong to no tab, so they would run outside the session.
  // Removing the constructor makes apps take their usual "not supported" fallback.
  try {
    if ('SharedWorker' in w) Object.defineProperty(w, 'SharedWorker', { value: undefined, configurable: true, writable: true });
  } catch { /* ignore */ }

  // ---------- Speculation rules ----------
  // Prefetch/prerender requests are made by the browser outside the tab (no session cookies).
  try {
    const isSpec = (n: Node) => n instanceof HTMLScriptElement && (n.type || '').toLowerCase() === 'speculationrules';
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (isSpec(n)) (n as Element).remove();
        else if (n instanceof Element) n.querySelectorAll('script[type="speculationrules" i]').forEach((x) => x.remove());
      }
    }).observe(document, { childList: true, subtree: true });
    const HS = w.HTMLScriptElement;
    if (HS?.supports) { const sup = HS.supports.bind(HS); HS.supports = (t: string) => (String(t).toLowerCase() === 'speculationrules' ? false : sup(t)); }
  } catch { /* ignore */ }

  // ---------- Dedicated workers ----------
  // A worker's own IndexedDB / Cache Storage / BroadcastChannel would be shared between sessions.
  // When the page's CSP allows blob: workers, start each same-origin worker through a tiny blob
  // bootstrap that applies the same namespacing inside the worker, then loads the real script.
  try {
    const OW = w.Worker;
    if (OW) {
      const prelude = function (prefix: string, base: string) {
        const g = self as any;
        const F = g.IDBFactory?.prototype;
        if (F) {
          const o = F.open, d = F.deleteDatabase, l = F.databases;
          F.open = function (n: string, ...r: any[]) { return o.call(this, prefix + n, ...r); };
          F.deleteDatabase = function (n: string) { return d.call(this, prefix + n); };
          if (l) F.databases = async function () { return (await l.call(this)).filter((x: any) => x.name?.startsWith(prefix)).map((x: any) => ({ ...x, name: x.name.slice(prefix.length) })); };
        }
        const C = g.CacheStorage?.prototype;
        if (C) {
          const { open, has, delete: del, keys } = C;
          C.open = function (n: string) { return open.call(this, prefix + n); };
          C.has = function (n: string) { return has.call(this, prefix + n); };
          C.delete = function (n: string) { return del.call(this, prefix + n); };
          C.keys = async function () { return (await keys.call(this)).filter((k: string) => k.startsWith(prefix)).map((k: string) => k.slice(prefix.length)); };
        }
        if (g.BroadcastChannel) { const B = g.BroadcastChannel; const W = function (n: string) { return new B(prefix + n); } as any; W.prototype = B.prototype; g.BroadcastChannel = W; }
        // Relative URLs must resolve against the real script, not the blob: bootstrap.
        const abs = (u: any) => (typeof u === 'string' ? new URL(u, base).href : u instanceof URL ? u.href : u);
        if (g.importScripts) { const i = g.importScripts; g.importScripts = (...u: any[]) => i(...u.map(abs)); }
        if (g.fetch) { const f = g.fetch; g.fetch = (input: any, init?: any) => f(abs(input), init); }
        if (g.Request) { const R = g.Request; const W = function (input: any, init?: any) { return new R(abs(input), init); } as any; W.prototype = R.prototype; g.Request = W; }
        if (g.XMLHttpRequest) { const op = g.XMLHttpRequest.prototype.open; g.XMLHttpRequest.prototype.open = function (m: string, u: any, ...r: any[]) { return op.call(this, m, abs(u), ...r); }; }
        if (g.EventSource) { const E = g.EventSource; const W = function (u: any, o?: any) { return new E(abs(u), o); } as any; W.prototype = E.prototype; g.EventSource = W; }
        if (g.WebSocket) { const S = g.WebSocket; const W = function (u: any, p?: any) { return new S(typeof u === 'string' && !/^wss?:/.test(u) ? new URL(u, base.replace(/^http/, 'ws')).href : u, p); } as any; W.prototype = S.prototype; Object.assign(W, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); g.WebSocket = W; }
      };
      const Wrapped = function (this: any, url: string | URL, opts?: WorkerOptions) {
        try {
          const href = new URL(String(url), document.baseURI).href;
          const sameOrigin = new URL(href).origin === location.origin;
          const isModule = opts?.type === 'module';
          if (!sameOrigin || !(isModule ? workerMode.module : workerMode.classic)) return new OW(url, opts);
          const boot = `(${prelude.toString()})(${JSON.stringify(PREFIX)}, ${JSON.stringify(href)});`;
          let code: string;
          if (isModule) {
            // Module imports are hoisted: load the prelude as its own module first.
            const pre = URL.createObjectURL(new Blob([boot], { type: 'text/javascript' }));
            code = `import ${JSON.stringify(pre)};\nimport ${JSON.stringify(href)};`;
          } else {
            code = `${boot}\nimportScripts(${JSON.stringify(href)});`;
          }
          return new OW(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), opts);
        } catch {
          return new OW(url, opts);
        }
      } as any;
      Wrapped.prototype = OW.prototype;
      w.Worker = Wrapped;
    }
  } catch { /* ignore */ }

  // ---------- Service workers ----------
  try {
    const SWC = w.ServiceWorkerContainer?.prototype;
    if (SWC) {
      SWC.register = function () {
        return Promise.reject(new DOMException('Service workers are disabled inside QA SessionLab isolated sessions', 'SecurityError'));
      };
    }
  } catch { /* ignore */ }

  // =================== environment emulation ===================
  const env = boot.env;
  if (!env) return;

  // ---------- locale ----------
  const LOCALE = env.locale || undefined;
  if (LOCALE) {
    try {
      const N = w.Navigator.prototype;
      Object.defineProperty(N, 'language', { configurable: true, get: () => LOCALE });
      Object.defineProperty(N, 'languages', { configurable: true, get: () => Object.freeze([LOCALE, LOCALE.split('-')[0]]) });
      const wrapIntl = (name: string) => {
        const Orig = w.Intl[name];
        if (!Orig) return;
        const Wrapped = function (this: any, locales?: any, opts?: any) {
          return new Orig(locales ?? LOCALE, opts);
        } as any;
        Wrapped.prototype = Orig.prototype;
        Wrapped.supportedLocalesOf = Orig.supportedLocalesOf;
        w.Intl[name] = Wrapped;
      };
      ['NumberFormat', 'Collator', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'DisplayNames', 'Segmenter'].forEach(wrapIntl);
      const ntl = Number.prototype.toLocaleString;
      Number.prototype.toLocaleString = function (l?: any, o?: any) { return ntl.call(this, l ?? LOCALE, o); };
      const lc = String.prototype.localeCompare;
      String.prototype.localeCompare = function (that: string, l?: any, o?: any) { return lc.call(this, that, l ?? LOCALE, o); };
    } catch { /* ignore */ }
  }

  // ---------- timezone ----------
  const TZ = env.timezone;
  const ODTF = Intl.DateTimeFormat;
  try {
    // Always wrap DateTimeFormat when locale or timezone is emulated.
    if (TZ || LOCALE) {
      const Wrapped = function (this: any, locales?: any, opts?: any) {
        const o = { ...(opts || {}) };
        if (TZ && o.timeZone === undefined) o.timeZone = TZ;
        return new ODTF(locales ?? LOCALE, o);
      } as any;
      Wrapped.prototype = ODTF.prototype;
      Wrapped.supportedLocalesOf = ODTF.supportedLocalesOf;
      (Intl as any).DateTimeFormat = Wrapped;
    }
  } catch { /* ignore */ }

  if (TZ) {
    try {
      const fmt = new ODTF('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' });
      const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const OD = Date;
      const P = OD.prototype as any;
      const getTime = P.getTime;
      const setTime = P.setTime;
      const comps = (ms: number) => {
        const o: Record<string, string> = {};
        for (const p of fmt.formatToParts(new OD(ms))) o[p.type] = p.value;
        return { y: +o.year, mo: +o.month - 1, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD[o.weekday], ms: ((ms % 1000) + 1000) % 1000 };
      };
      /** minutes east of UTC at instant ms */
      const offset = (ms: number) => {
        const c = comps(ms);
        return Math.round((OD.UTC(c.y, c.mo, c.d, c.h, c.mi, c.s) - (ms - c.ms)) / 60000);
      };
      const fromLocal = (y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number) => {
        const guess = OD.UTC(y, mo, d, h, mi, s, ms);
        let t = guess - offset(guess) * 60000;
        const o2 = offset(t);
        if (guess - o2 * 60000 !== t) t = guess - o2 * 60000;
        return t;
      };
      const pad = (n: number, l = 2) => String(Math.abs(n)).padStart(l, '0');
      const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const tzName = (ms: number) => {
        try { return new ODTF('en-US', { timeZone: TZ, timeZoneName: 'long' }).formatToParts(new OD(ms)).find((p) => p.type === 'timeZoneName')?.value ?? TZ; } catch { return TZ; }
      };
      const gmt = (ms: number) => { const o = offset(ms); return `GMT${o >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(o) / 60))}${pad(Math.abs(o) % 60)}`; };
      const valid = (self: any) => !isNaN(getTime.call(self));

      P.getTimezoneOffset = function () { return valid(this) ? -offset(getTime.call(this)) : NaN; };
      const getters: [string, keyof ReturnType<typeof comps>][] = [['getFullYear', 'y'], ['getMonth', 'mo'], ['getDate', 'd'], ['getDay', 'wd'], ['getHours', 'h'], ['getMinutes', 'mi'], ['getSeconds', 's']];
      for (const [name, k] of getters) P[name] = function () { return valid(this) ? comps(getTime.call(this))[k] : NaN; };
      const setter = (name: string, apply: (c: ReturnType<typeof comps>, a: number[]) => void) => {
        P[name] = function (...a: number[]) {
          const c = comps(valid(this) ? getTime.call(this) : 0);
          apply(c, a.map(Number));
          return setTime.call(this, fromLocal(c.y, c.mo, c.d, c.h, c.mi, c.s, c.ms));
        };
      };
      setter('setFullYear', (c, a) => { c.y = a[0]; if (a.length > 1) c.mo = a[1]; if (a.length > 2) c.d = a[2]; });
      setter('setMonth', (c, a) => { c.mo = a[0]; if (a.length > 1) c.d = a[1]; });
      setter('setDate', (c, a) => { c.d = a[0]; });
      setter('setHours', (c, a) => { c.h = a[0]; if (a.length > 1) c.mi = a[1]; if (a.length > 2) c.s = a[2]; if (a.length > 3) c.ms = a[3]; });
      setter('setMinutes', (c, a) => { c.mi = a[0]; if (a.length > 1) c.s = a[1]; if (a.length > 2) c.ms = a[2]; });
      setter('setSeconds', (c, a) => { c.s = a[0]; if (a.length > 1) c.ms = a[1]; });

      const dateStr = (c: ReturnType<typeof comps>) => `${DAYS[c.wd]} ${MON[c.mo]} ${pad(c.d)} ${pad(c.y, 4)}`;
      const timeStr = (ms: number, c: ReturnType<typeof comps>) => `${pad(c.h)}:${pad(c.mi)}:${pad(c.s)} ${gmt(ms)} (${tzName(ms)})`;
      P.toString = function () { if (!valid(this)) return 'Invalid Date'; const t = getTime.call(this); const c = comps(t); return `${dateStr(c)} ${timeStr(t, c)}`; };
      P.toDateString = function () { return valid(this) ? dateStr(comps(getTime.call(this))) : 'Invalid Date'; };
      P.toTimeString = function () { if (!valid(this)) return 'Invalid Date'; const t = getTime.call(this); return timeStr(t, comps(t)); };
      for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
        const orig = P[name];
        P[name] = function (l?: any, o?: any) { return orig.call(this, l ?? LOCALE, { ...(o || {}), timeZone: o?.timeZone ?? TZ }); };
      }

      const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
      const parseLocal = (s: string) => {
        const m = LOCAL_ISO.exec(s);
        return m ? fromLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), +((m[7] ?? '0').padEnd(3, '0'))) : OD.parse(s);
      };
      const D = function (this: any, ...a: any[]) {
        if (!new.target) return new (D as any)().toString();
        if (a.length === 0) return new OD();
        if (a.length === 1) return typeof a[0] === 'string' ? new OD(parseLocal(a[0])) : new OD(a[0]);
        const [y, mo, d = 1, h = 0, mi = 0, s = 0, ms = 0] = a.map(Number);
        return new OD(fromLocal(y >= 0 && y <= 99 ? 1900 + y : y, mo, d, h, mi, s, ms));
      } as any;
      D.prototype = OD.prototype;
      D.now = OD.now;
      D.UTC = OD.UTC;
      D.parse = (s: string) => parseLocal(String(s));
      Object.defineProperty(P, 'constructor', { value: D, writable: true, configurable: true });
      w.Date = D;
    } catch { /* ignore */ }
  }

  // ---------- geolocation ----------
  const G = env.geo;
  if (G) {
    try {
      const pos = () => ({
        coords: { latitude: G.latitude, longitude: G.longitude, accuracy: G.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return this; } },
        timestamp: Date.now(), toJSON() { return this; },
      });
      let n = 0;
      const geo = w.Geolocation?.prototype;
      if (geo) {
        geo.getCurrentPosition = function (ok: (p: any) => void) { setTimeout(() => ok(pos()), 30); };
        geo.watchPosition = function (ok: (p: any) => void) { setTimeout(() => ok(pos()), 30); return ++n; };
        geo.clearWatch = function () { /* noop */ };
      }
      const perms = w.Permissions?.prototype;
      if (perms) {
        const q = perms.query;
        perms.query = function (d: any) {
          if (d?.name === 'geolocation') return Promise.resolve({ state: 'granted', name: 'geolocation', onchange: null, addEventListener() {}, removeEventListener() {} });
          return q.call(this, d);
        };
      }
    } catch { /* ignore */ }
  }
}
