import { COLOR_HEX, pageEnvOf, type BootPayload, type Session, type Snapshot } from '../shared/types';
import { fromChromeCookie, fromPlaywrightCookie, toPlaywrightCookie, upsertCookie } from '../shared/cookies';
import { applyTabRules } from './rules';
import { propagateJar, withJar } from './cookieSync';
import { ruleCtx, setPendingRestore } from './ctx';
import { qslShim } from './shim';
import {
  createSession, deleteSessionRecord, getJar, getSession, getSessions, getSettings, getSnapshots,
  newId, setJar, setSnapshots, setTabSession, tabSession, tabsOfSession, updateSession,
} from './state';
import { syncDebugger } from './debuggerHub';
import { guardOrigin } from './swGuard';
import { dumpIdbInPage, restoreIdbInPage, type IdbDump } from './idb';

const isWeb = (url?: string) => !!url && /^https?:/.test(url);

// ---------------- visual identity ----------------
export async function decorateTab(tabId: number) {
  const sid = await tabSession(tabId);
  const s = await getSession(sid);
  try {
    if (!s) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: s.name.replace(/\s+/g, '').slice(0, 4).toUpperCase() });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: COLOR_HEX[s.color] });
    await chrome.action.setTitle({ tabId, title: `QA SessionLab — ${s.name}${s.temporary ? ' (temporary)' : ''}` });
  } catch { /* tab closed */ }
}

async function groupTab(tabId: number, s: Session) {
  const settings = await getSettings();
  if (!settings.useTabGroups || !chrome.tabGroups) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId, title: s.name });
    if (groups[0]) {
      if (tab.groupId !== groups[0].id) await chrome.tabs.group({ tabIds: [tabId], groupId: groups[0].id });
      await chrome.tabGroups.update(groups[0].id, { color: s.color });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(groupId, { title: s.name, color: s.color, collapsed: false });
    }
  } catch (e) {
    console.warn('[QSL] group', e);
  }
}

async function ungroupTab(tabId: number) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId !== -1) {
      const group = await chrome.tabGroups.get(tab.groupId);
      const sessions = await getSessions();
      if (sessions.some((s) => s.name === group.title)) await chrome.tabs.ungroup(tabId);
    }
  } catch { /* ignore */ }
}

export async function refreshSessionTabs(sid: string) {
  const s = await getSession(sid);
  if (!s) return;
  for (const t of await tabsOfSession(sid)) {
    await decorateTab(t);
    await groupTab(t, s);
    chrome.tabs.sendMessage(t, { type: 'session', session: s }).catch(() => undefined);
  }
}

// ---------------- binding ----------------
export async function bindTab(tabId: number, sid: string | null, opts: { reload?: boolean } = {}) {
  const prev = await tabSession(tabId);
  await setTabSession(tabId, sid);
  await applyTabRules(tabId, sid ? await ruleCtx(sid) : null);
  await decorateTab(tabId);
  if (sid) {
    const s = await getSession(sid);
    if (s) await groupTab(tabId, s);
  } else if (prev) {
    await ungroupTab(tabId);
  }
  await syncDebugger(tabId);
  if (opts.reload) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab && isWeb(tab.url)) {
      if (sid) await guardOrigin(tab.url);
      await chrome.tabs.reload(tabId);
    }
  }
  if (prev && prev !== sid) await maybeDisposeTemporary(prev);
}

/** Open a URL in a tab bound to `sid` *before* the first request is sent. */
export async function openInSession(sid: string, url: string | undefined, where: { windowId?: number; index?: number; active?: boolean } = {}) {
  const s = await getSession(sid);
  if (!s) throw new Error('Unknown session');
  const target = url || s.startUrl || 'about:blank';
  const tab = await chrome.tabs.create({ url: 'about:blank', active: where.active ?? true, windowId: where.windowId, index: where.index });
  await bindTab(tab.id!, sid);
  await guardOrigin(target);
  if (target !== 'about:blank') await navigateReliably(tab.id!, target);
  return tab.id!;
}

/**
 * Navigating a freshly created (often background) tab is occasionally dropped or aborted by Chrome
 * (net::ERR_ABORTED with no newer navigation), leaving it on about:blank. Watch until a web document
 * commits and retry (max 2x) if the tab is still empty. Runs in the background; returns immediately.
 */
export async function navigateReliably(tabId: number, url: string) {
  let attempts = 0;
  const watch = () => {
    let settled = false;
    const done = () => {
      settled = true;
      chrome.webNavigation.onCommitted.removeListener(onCommit);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
    };
    const onCommit = (d: { tabId: number; frameId: number; url: string }) => {
      if (d.tabId === tabId && d.frameId === 0 && /^https?:/.test(d.url)) done();
    };
    const onError = (d: { tabId: number; frameId: number; error: string }) => {
      if (d.tabId !== tabId || d.frameId !== 0) return;
      setTimeout(() => void retryIfEmpty(`navigation error ${d.error}`), 300);
    };
    const retryIfEmpty = async (why: string) => {
      if (settled) return;
      const t = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!t) return done();
      if (/^https?:/.test(t.url ?? '') || t.pendingUrl || t.status === 'loading') return; // something else is going on: leave it
      if (attempts >= 2) return done();
      attempts++;
      console.info('[QSL] tab stayed empty (' + why + '), retrying', url);
      await chrome.tabs.update(tabId, { url }).catch(() => undefined);
    };
    chrome.webNavigation.onCommitted.addListener(onCommit);
    chrome.webNavigation.onErrorOccurred.addListener(onError);
    setTimeout(() => void retryIfEmpty('no commit after 3s'), 3000);
    setTimeout(() => { if (!settled) done(); }, 15_000);
  };
  watch();
  await chrome.tabs.update(tabId, { url });
}

// ---------------- injection (fallback) ----------------
/**
 * The primary path is the static MAIN-world content script reading the Server-Timing boot
 * payload at document_start. This fallback covers documents that never got the header
 * (e.g. served from bfcache/prerender or by a site that strips Server-Timing via a proxy).
 * The shim is idempotent, so double injection is harmless.
 */
export async function injectShim(tabId: number, frameId: number, url: string) {
  const sid = await tabSession(tabId);
  if (!sid || !isWeb(url)) return;
  const ctx = await ruleCtx(sid);
  let host = '';
  try { host = new URL(url).hostname; } catch { return; }
  const boot: BootPayload = {
    sid, env: ctx.env, restore: null,
    jar: ctx.jar.filter((c) => !c.httpOnly && (c.hostOnly ? c.domain === host : host === c.domain || host.endsWith('.' + c.domain))),
  };
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', injectImmediately: true, func: qslShim, args: [boot] });
  } catch (e) {
    // chrome:// pages, the Web Store, PDF viewer, etc. cannot be scripted.
    if (!String(e).includes('Cannot access')) console.debug('[QSL] inject', url, e);
  }
}

// ---------------- lifecycle ----------------
export async function maybeDisposeTemporary(sid: string) {
  const s = await getSession(sid);
  if (!s?.temporary) return;
  if ((await tabsOfSession(sid)).length === 0) await deleteSession(sid);
}

export async function deleteSession(sid: string, closeTabs = false) {
  const tabs = await tabsOfSession(sid);
  for (const t of tabs) {
    if (closeTabs) await chrome.tabs.remove(t).catch(() => undefined);
    else await bindTab(t, null, { reload: true }).catch(() => undefined);
  }
  await deleteSessionRecord(sid);
}

export async function newSession(partial: Partial<Session>, openUrl?: string | null) {
  const s = await createSession(partial);
  let tabId: number | undefined;
  if (openUrl !== null && openUrl !== undefined) tabId = await openInSession(s.id, openUrl);
  return { session: s, tabId };
}

export async function duplicateSession(sid: string) {
  const src = await getSession(sid);
  if (!src) throw new Error('Unknown session');
  const copy = await createSession({ ...src, name: `${src.name} copy`, color: undefined });
  await setJar(copy.id, await getJar(sid));
  return copy;
}

/** Wipe cookies + session-scoped storage; keeps the session itself. */
export async function clearSessionData(sid: string) {
  await withJar(sid, () => []);
  for (const t of await tabsOfSession(sid)) {
    await chrome.scripting.executeScript({
      target: { tabId: t, allFrames: true },
      func: async (prefix: string, marker: string) => {
        try {
          const ks: string[] = [];
          for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix) || k === marker) ks.push(k); }
          ks.forEach((k) => localStorage.removeItem(k));
        } catch { /* ignore */ }
        try {
          for (const d of (await (indexedDB as any).databases?.()) ?? []) {
            if (d.name?.startsWith(prefix)) await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
          }
        } catch { /* ignore */ }
        try {
          for (const k of await caches.keys()) if (k.startsWith(prefix)) await caches.delete(k);
        } catch { /* ignore */ }
      },
      args: [`__qsl:${sid}:`, `__qsl-restored:${sid}`],
    }).catch(() => undefined);
    await chrome.tabs.reload(t).catch(() => undefined);
  }
}

/** Copy the *default profile's* cookies for a site into a session (log in once normally, clone to roles). */
export async function cloneDefaultCookies(sid: string, url: string) {
  const host = new URL(url).hostname;
  const parts = host.split('.');
  const domains = new Set<string>();
  for (let i = 0; i < parts.length - 1; i++) domains.add(parts.slice(i).join('.'));
  if (parts.length === 1) domains.add(host);
  const found: chrome.cookies.Cookie[] = [];
  for (const d of domains) found.push(...(await chrome.cookies.getAll({ domain: d })));
  const uniq = new Map(found.map((c) => [`${c.domain}|${c.path}|${c.name}`, c]));
  await withJar(sid, (jar) => [...uniq.values()].map(fromChromeCookie).reduce((j, c) => upsertCookie(j, c), jar));
  return uniq.size;
}

// ---------------- snapshots ----------------
async function dumpLocalStorage(sid: string): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  for (const t of await tabsOfSession(sid)) {
    const res = await chrome.scripting.executeScript({
      target: { tabId: t, allFrames: true },
      func: (prefix: string) => {
        const kv: Record<string, string> = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith(prefix)) kv[k.slice(prefix.length)] = localStorage.getItem(k) ?? '';
          }
        } catch { /* ignore */ }
        return { origin: location.origin, kv };
      },
      args: [`__qsl:${sid}:`],
    }).catch(() => []);
    for (const r of res) {
      const v = r.result as { origin: string; kv: Record<string, string> } | undefined;
      if (v && v.origin !== 'null') out[v.origin] = { ...(out[v.origin] ?? {}), ...v.kv };
    }
  }
  return out;
}

async function dumpIndexedDb(sid: string): Promise<Record<string, IdbDump[]>> {
  const out: Record<string, IdbDump[]> = {};
  const seen = new Set<string>();
  for (const t of await tabsOfSession(sid)) {
    const res = await chrome.scripting.executeScript({ target: { tabId: t }, func: dumpIdbInPage, args: [`__qsl:${sid}:`, 25_000_000] }).catch(() => []);
    for (const r of res) {
      const v = r.result as { origin: string; dbs: IdbDump[] } | undefined;
      if (!v || seen.has(v.origin) || v.origin === 'null') continue;
      seen.add(v.origin);
      if (v.dbs.length) out[v.origin] = v.dbs;
    }
  }
  return out;
}

/** IndexedDB restores waiting for a tab of that origin (storage.session: sid -> origin -> dbs). */
async function pendingIdb(): Promise<Record<string, Record<string, IdbDump[]>>> {
  return ((await chrome.storage.session.get('pendingIdb')).pendingIdb as Record<string, Record<string, IdbDump[]>>) ?? {};
}
async function setPendingIdb(all: Record<string, Record<string, IdbDump[]>>) {
  await chrome.storage.session.set({ pendingIdb: all });
}

/** Called when a session document starts: apply a pending IndexedDB restore for its origin, then reload once. */
export async function applyPendingIdb(tabId: number, sid: string, origin: string) {
  const all = await pendingIdb();
  const dbs = all[sid]?.[origin];
  if (!dbs) return;
  delete all[sid][origin];
  await setPendingIdb(all);
  await chrome.scripting.executeScript({ target: { tabId }, func: restoreIdbInPage, args: [`__qsl:${sid}:`, dbs] }).catch((e) => console.warn('[QSL] idb restore', e));
  await chrome.tabs.reload(tabId).catch(() => undefined);
}

export async function takeSnapshot(sid: string, label: string): Promise<Snapshot> {
  const snap: Snapshot = {
    id: newId(), sessionId: sid, label: label.trim() || new Date().toLocaleString(), createdAt: Date.now(),
    cookies: await getJar(sid), localStorage: await dumpLocalStorage(sid), indexedDB: await dumpIndexedDb(sid),
  };
  await setSnapshots(sid, [snap, ...(await getSnapshots(sid))].slice(0, 30));
  return snap;
}

export async function restoreSnapshot(sid: string, snapId: string) {
  const snap = (await getSnapshots(sid)).find((s) => s.id === snapId);
  if (!snap) throw new Error('Snapshot not found');
  await setPendingRestore(sid, snap.localStorage);
  await withJar(sid, () => snap.cookies); // also rebuilds rules, which now carry the restore payload
  const tabs = await tabsOfSession(sid);
  // IndexedDB: restore now in one open tab per origin; the rest when a tab of that origin opens.
  const idb = { ...(snap.indexedDB ?? {}) };
  for (const t of tabs) {
    const url = (await chrome.tabs.get(t).catch(() => undefined))?.url;
    let origin = '';
    try { origin = new URL(url ?? '').origin; } catch { continue; }
    if (!idb[origin]) continue;
    await chrome.scripting.executeScript({ target: { tabId: t }, func: restoreIdbInPage, args: [`__qsl:${sid}:`, idb[origin]] }).catch((e) => console.warn('[QSL] idb restore', e));
    delete idb[origin];
  }
  const all = await pendingIdb();
  if (Object.keys(idb).length) all[sid] = idb; else delete all[sid];
  await setPendingIdb(all);
  for (const t of tabs) await chrome.tabs.reload(t).catch(() => undefined);
}

export async function deleteSnapshot(sid: string, snapId: string) {
  await setSnapshots(sid, (await getSnapshots(sid)).filter((s) => s.id !== snapId));
}

// ---------------- Playwright storageState ----------------
export async function exportStorageState(sid: string) {
  const jar = await getJar(sid);
  const ls = await dumpLocalStorage(sid);
  return {
    cookies: jar.map(toPlaywrightCookie),
    origins: Object.entries(ls).map(([origin, kv]) => ({ origin, localStorage: Object.entries(kv).map(([name, value]) => ({ name, value })) })),
  };
}

export async function importStorageState(name: string, state: { cookies?: any[]; origins?: { origin: string; localStorage?: { name: string; value: string }[] }[] }) {
  if (!state || !Array.isArray(state.cookies)) throw new Error('Not a Playwright storageState JSON (missing "cookies" array)');
  const s = await createSession({ name: name || 'Imported' });
  await setJar(s.id, state.cookies.map(fromPlaywrightCookie));
  await setPendingRestore(s.id, Object.fromEntries((state.origins ?? []).map((o) => [o.origin, Object.fromEntries((o.localStorage ?? []).map((x) => [x.name, x.value]))])));
  return s;
}

export async function renameOrRecolor(sid: string, patch: Partial<Session>) {
  const before = await getSession(sid);
  const s = await updateSession(sid, patch);
  if (!s) return;
  // Rename the existing tab groups so they keep matching.
  if (before && (patch.name || patch.color) && chrome.tabGroups) {
    const groups = await chrome.tabGroups.query({ title: before.name });
    for (const g of groups) await chrome.tabGroups.update(g.id, { title: s.name, color: s.color }).catch(() => undefined);
  }
  await refreshSessionTabs(sid);
  await propagateJar(sid);
  if (patch.preset) {
    const envChanged = JSON.stringify(pageEnvOf(before?.preset)) !== JSON.stringify(pageEnvOf(s.preset));
    for (const t of await tabsOfSession(sid)) {
      await syncDebugger(t).catch((e) => console.warn('[QSL]', e));
      // timezone / locale / geolocation are applied in-page at document_start -> reload to take effect
      if (envChanged) await chrome.tabs.reload(t).catch(() => undefined);
    }
  }
  return s;
}

/** After a browser restart tab ids change; re-attach tabs using their tab-group title. */
export async function reattachByGroups() {
  if (!chrome.tabGroups) return;
  const sessions = await getSessions();
  const byName = new Map(sessions.map((s) => [s.name, s]));
  const groups = await chrome.tabGroups.query({});
  for (const g of groups) {
    const s = g.title ? byName.get(g.title) : undefined;
    if (!s) continue;
    for (const tab of await chrome.tabs.query({ groupId: g.id })) {
      if ((await tabSession(tab.id!)) === s.id) continue;
      await bindTab(tab.id!, s.id, { reload: true });
    }
  }
}
