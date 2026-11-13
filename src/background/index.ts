import { onScriptCookie } from './cookieSync';
import { refreshRules, restoreApplied } from './ctx';
import { exportAll, importAll } from './backup';
import { workerModeOf } from './csp';
import { exportShare, importShare } from './share';
import { agentStatus, ensureToken, startAgentBridge } from './agentBridge';
import { allowServiceWorkers, guardOrigin, onSessionTabControlled, swBlockedOrigins } from './swGuard';
import {
  activeRecording, activeRecordings, addStep, forgetTab, persistRecording, screenshot, startRecording, stopRecording, syncDebugger,
} from './debuggerHub';
import {
  bindTab, clearSessionData, cloneDefaultCookies, decorateTab, deleteSession, deleteSnapshot, duplicateSession, exportStorageState,
  importStorageState, injectShim, maybeDisposeTemporary, navigateReliably, applyPendingIdb, newSession, openInSession, reattachByGroups, renameOrRecolor,
  restoreSnapshot, takeSnapshot,
} from './sessions';
import {
  allTabAssignments, getJar, getSession, getSessions, getSettings, getSnapshots, saveSettings, tabSession, tabSessionSync, tabsOfSession, warmUp,
} from './state';
import { QUICK_VALUES, EDGE_CASES } from '../shared/datagen';
import { setLanguage, t } from '../shared/i18n';
import type { MessageKey } from '../shared/locales/en';
import type { Recording } from '../shared/types';

const ready = warmUp();

// ---------------- tab lifecycle ----------------
/**
 * Tabs opened from a session tab (target=_blank, window.open, middle-click) inherit its session.
 * The new tab's first request is usually already in flight when we hear about it, so after
 * binding we re-issue the navigation (GET) so it runs with the session's rules.
 */
const inheriting = new Set<number>();
async function inherit(tabId: number, fromTabId: number, url: string | undefined) {
  if (inheriting.has(tabId) || !(await getSettings()).inheritOnOpen) return;
  const sid = await tabSession(fromTabId);
  if (!sid || (await tabSession(tabId))) return;
  inheriting.add(tabId);
  try {
    await bindTab(tabId, sid);
    if (url && /^https?:/.test(url)) { await guardOrigin(url); await chrome.tabs.update(tabId, { url }); }
  } finally {
    setTimeout(() => inheriting.delete(tabId), 2000);
  }
}

// Only real "opened from this page" navigations (link target=_blank, middle-click, window.open).
// tabs.onCreated is NOT used: Chrome also sets openerTabId for plain Ctrl+T tabs, which must stay default.
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
  await ready;
  await inherit(d.tabId, d.sourceTabId, d.url);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  const sid = await tabSession(tabId);
  forgetTab(tabId);
  if (!sid) return;
  await bindTab(tabId, null).catch(() => undefined);
  await maybeDisposeTemporary(sid);
});

chrome.tabs.onReplaced.addListener(async (added, removed) => {
  await ready;
  const sid = await tabSession(removed);
  if (sid) { await bindTab(removed, null).catch(() => undefined); await bindTab(added, sid); }
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading') { await ready; await decorateTab(tabId); }
});

chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (d.frameId === 0 && tabSessionSync(d.tabId)) console.debug('[QSL] nav error', d.tabId, d.url, d.error);
});

// User navigates a session tab to a new site (address bar, link): guard as early as possible.
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0 && tabSessionSync(d.tabId)) void guardOrigin(d.url);
});

chrome.webNavigation.onCommitted.addListener(async (d) => {
  await ready;
  await injectShim(d.tabId, d.frameId, d.url);
});

// Keep the step recorder running across navigations of a recorded tab (content scripts restart per page).
chrome.webNavigation.onDOMContentLoaded.addListener(async (d) => {
  if (!activeRecording(d.tabId)) return;
  const { maskSecrets } = await getSettings();
  chrome.tabs.sendMessage(d.tabId, { type: 'recording', on: true, quiet: true, maskSecrets }, { frameId: d.frameId }).catch(() => undefined);
});

// Fallback for documents created without a committed navigation (about:blank iframes, document.open).
chrome.webNavigation.onDOMContentLoaded.addListener(async (d) => {
  await ready;
  if (d.url.startsWith('about:')) await injectShim(d.tabId, d.frameId, d.url);
});

// ---------------- install / startup ----------------
async function applyLanguage() {
  setLanguage((await getSettings()).language);
}

async function setupMenus() {
  await applyLanguage();
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'root', title: 'QA SessionLab', contexts: ['all'] });
  chrome.contextMenus.create({ id: 'open-link-new', parentId: 'root', title: t('menu.openNew'), contexts: ['link'] });
  chrome.contextMenus.create({ id: 'open-link-same', parentId: 'root', title: t('menu.openSame'), contexts: ['link'] });
  chrome.contextMenus.create({ id: 'fill', parentId: 'root', title: t('menu.fill'), contexts: ['all'] });
  chrome.contextMenus.create({ id: 'ins', parentId: 'root', title: t('menu.insert'), contexts: ['editable'] });
  for (const k of Object.keys(QUICK_VALUES)) chrome.contextMenus.create({ id: `ins:${k}`, parentId: 'ins', title: t(`q.${k}` as MessageKey), contexts: ['editable'] });
  chrome.contextMenus.create({ id: 'edge', parentId: 'root', title: t('menu.edge'), contexts: ['editable'] });
  for (const k of Object.keys(EDGE_CASES)) chrome.contextMenus.create({ id: `edge:${k}`, parentId: 'edge', title: t(`e.${k}` as MessageKey), contexts: ['editable'] });
  chrome.contextMenus.create({ id: 'shot', parentId: 'root', title: t('menu.shot'), contexts: ['all'] });
}

// Re-localize menus when the language setting changes.
let lastLang: string | undefined;
chrome.storage.onChanged.addListener((c) => {
  const lang = (c.settings?.newValue as { language?: string } | undefined)?.language;
  if (c.settings && lang !== lastLang) { lastLang = lang; void setupMenus(); }
});
void applyLanguage();

/** Fill the form of a tab (frame) with localized feedback text. */
async function fillTab(tabId: number, frameId = 0) {
  await applyLanguage();
  const { testEmailDomain } = await getSettings();
  return chrome.tabs.sendMessage(tabId, { type: 'fillForm', domain: testEmailDomain, textOne: t('cs.filled_one'), textOther: t('cs.filled_other') }, { frameId });
}

/** Content scripts are not injected into tabs that were open before install/update: add them now. */
async function injectIntoOpenTabs() {
  const manifest = chrome.runtime.getManifest();
  for (const tab of await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
    if (!tab.id) continue;
    for (const cs of manifest.content_scripts ?? []) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: cs.js ?? [],
        world: (cs as { world?: 'MAIN' | 'ISOLATED' }).world ?? 'ISOLATED',
      }).catch(() => undefined);
    }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ready;
  // v1.1.1: AI control became on-by-default (token still required). Apply once to existing installs.
  const { agentDefaultV2 } = await chrome.storage.local.get('agentDefaultV2');
  if (!agentDefaultV2) {
    await saveSettings({ agentEnabled: true });
    await chrome.storage.local.set({ agentDefaultV2: true });
  }
  await setupMenus();
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => undefined);
  await injectIntoOpenTabs();
  // After an update/reload, DNR session rules and tab bindings are gone: re-attach via tab groups.
  await reattachByGroups().catch(() => undefined);
  if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
chrome.runtime.onStartup.addListener(async () => {
  await ready;
  await setupMenus();
  await reattachByGroups();
  // Temporary sessions whose tabs were closed together with the browser.
  for (const s of await getSessions()) if (s.temporary) await maybeDisposeTemporary(s.id);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ready;
  if (!tab?.id) return;
  const id = String(info.menuItemId);
  const settings = await getSettings();
  if (id === 'open-link-new' && info.linkUrl) {
    await newSession({ temporary: false }, info.linkUrl);
  } else if (id === 'open-link-same' && info.linkUrl) {
    const sid = await tabSession(tab.id);
    if (sid) await openInSession(sid, info.linkUrl, { windowId: tab.windowId, index: tab.index + 1 });
    else await chrome.tabs.create({ url: info.linkUrl, windowId: tab.windowId, index: tab.index + 1 });
  } else if (id === 'fill') {
    await fillTab(tab.id, info.frameId ?? 0).catch(() => undefined);
  } else if (id.startsWith('ins:')) {
    const v = QUICK_VALUES[id.slice(4)]?.value(settings.testEmailDomain);
    if (v !== undefined) await chrome.tabs.sendMessage(tab.id, { type: 'insert', value: v }, { frameId: info.frameId ?? 0 }).catch(() => undefined);
  } else if (id.startsWith('edge:')) {
    const v = EDGE_CASES[id.slice(5)]?.value();
    if (v !== undefined) await chrome.tabs.sendMessage(tab.id, { type: 'insert', value: v }, { frameId: info.frameId ?? 0 }).catch(() => undefined);
  } else if (id === 'shot') {
    await screenshot(tab.id, 'Manual screenshot').catch(() => undefined);
  }
});

// ---------------- keyboard shortcuts ----------------
chrome.commands.onCommand.addListener(async (command, tab) => {
  await ready;
  const active = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === 'new-session-tab') {
    const url = active?.url && /^https?:/.test(active.url) ? active.url : undefined;
    await newSession({ temporary: true }, url ?? '');
  } else if (command === 'toggle-recording' && active?.id) {
    if (activeRecording(active.id)) await stopRecording(active.id);
    else await startRecording(active.id);
  } else if (command === 'screenshot' && active?.id) {
    await screenshot(active.id, 'Shortcut screenshot').catch(() => undefined);
  }
});

// ---------------- matrix ----------------
let matrixTabs: number[] = [];

async function openMatrix(url: string, sessionIds: string[], layout: 'windows' | 'tabs', screen: { width: number; height: number; left: number; top: number }) {
  matrixTabs = [];
  const n = sessionIds.length;
  if (layout === 'tabs') {
    for (const sid of sessionIds) matrixTabs.push(await openInSession(sid, url, { active: false }));
    if (matrixTabs[0]) await chrome.tabs.update(matrixTabs[0], { active: true });
    return matrixTabs;
  }
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = Math.floor(screen.width / cols);
  const h = Math.floor(screen.height / rows);
  for (let i = 0; i < n; i++) {
    const win = await chrome.windows.create({
      url: 'about:blank', focused: i === 0,
      left: screen.left + (i % cols) * w, top: screen.top + Math.floor(i / cols) * h, width: w, height: h,
    });
    const tabId = win?.tabs?.[0]?.id;
    if (tabId === undefined) continue;
    await bindTab(tabId, sessionIds[i]);
    const target = url || (await getSession(sessionIds[i]))?.startUrl || 'about:blank';
    await guardOrigin(target);
    await navigateReliably(tabId, target);
    matrixTabs.push(tabId);
  }
  return matrixTabs;
}

async function matrixAction(action: 'navigate' | 'reload' | 'close' | 'back', url?: string) {
  const alive: number[] = [];
  for (const t of matrixTabs) {
    try {
      await chrome.tabs.get(t);
      alive.push(t);
      if (action === 'navigate' && url) await chrome.tabs.update(t, { url });
      if (action === 'reload') await chrome.tabs.reload(t);
      if (action === 'back') await chrome.tabs.goBack(t).catch(() => undefined);
      if (action === 'close') await chrome.tabs.remove(t);
    } catch { /* closed */ }
  }
  matrixTabs = action === 'close' ? [] : alive;
}

// ---------------- messages ----------------
type Msg = { type: string; [k: string]: any };

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  const tabId = sender.tab?.id;
  switch (msg.type) {
    // ----- from content script -----
    case 'cs:hello': {
      if (tabId === undefined) return null;
      const sid = await tabSession(tabId);
      if (sid && sender.frameId === 0 && sender.origin) void applyPendingIdb(tabId, sid, sender.origin);
      const s = await getSession(sid);
      const settings = await getSettings();
      return {
        session: s ?? null,
        recording: !!activeRecording(tabId),
        titlePrefix: settings.titlePrefix,
        maskSecrets: settings.maskSecrets,
        jar: s ? (await getJar(s.id)).filter((c) => !c.httpOnly) : [],
        workers: s ? workerModeOf(tabId, sender.frameId ?? 0) : null,
      };
    }
    case 'cs:cookieSet': {
      if (tabId === undefined) return;
      const sid = await tabSession(tabId);
      if (sid && sid === msg.sid) await onScriptCookie(sid, msg.header, msg.url);
      return;
    }
    case 'cs:restored': {
      if (tabId === undefined) return;
      const sid = await tabSession(tabId);
      if (sid && sid === msg.sid && (await restoreApplied(sid, msg.id, msg.origin))) await refreshRules(sid);
      return;
    }
    case 'cs:swControlled': {
      if (tabId === undefined) return;
      if (await tabSession(tabId)) await onSessionTabControlled(tabId, msg.origin);
      return;
    }
    case 'cs:step':
      if (tabId !== undefined) addStep(tabId, msg.step);
      return;

    // ----- UI -----
    case 'getState': {
      const [sessions, assignments, settings] = await Promise.all([getSessions(), allTabAssignments(), getSettings()]);
      const counts: Record<string, number> = {};
      for (const sid of Object.values(assignments)) counts[sid] = (counts[sid] ?? 0) + 1;
      const recs = activeRecordings().map((r) => ({ id: r.id, tabId: r.tabId, title: r.title, startedAt: r.startedAt, counts: [r.steps.length, r.console.length, r.network.length, r.screenshots.length] }));
      return { sessions, assignments, counts, settings, recordings: recs, matrixTabs };
    }
    case 'createSession': return newSession(msg.session ?? {}, msg.openUrl);
    case 'createMany': {
      const out = [];
      for (const name of msg.names as string[]) out.push((await newSession({ name, group: msg.group ?? '', startUrl: msg.startUrl ?? '' }, null)).session);
      return out;
    }
    case 'updateSession': return renameOrRecolor(msg.id, msg.patch);
    case 'deleteSession': return deleteSession(msg.id, !!msg.closeTabs);
    case 'duplicateSession': return duplicateSession(msg.id);
    case 'clearSessionData': return clearSessionData(msg.id);
    case 'openInSession': return openInSession(msg.id, msg.url);
    case 'assignTab': return bindTab(msg.tabId, msg.sessionId ?? null, { reload: true });
    case 'assignNewSession': {
      const { session } = await newSession({ name: msg.name, temporary: !!msg.temporary }, null);
      await bindTab(msg.tabId, session.id, { reload: true });
      return session;
    }
    case 'focusSessionTabs': {
      const tabs = await tabsOfSession(msg.id);
      if (tabs[0]) { const t = await chrome.tabs.update(tabs[0], { active: true }); await chrome.windows.update(t!.windowId, { focused: true }); }
      return tabs.length;
    }
    case 'cloneDefaultCookies': return cloneDefaultCookies(msg.id, msg.url);
    case 'getCookies': return getJar(msg.id);
    case 'listSnapshots': return getSnapshots(msg.id);
    case 'takeSnapshot': return takeSnapshot(msg.id, msg.label ?? '');
    case 'restoreSnapshot': return restoreSnapshot(msg.id, msg.snapId);
    case 'deleteSnapshot': return deleteSnapshot(msg.id, msg.snapId);
    case 'exportStorageState': return exportStorageState(msg.id);
    case 'importStorageState': return importStorageState(msg.name, msg.state);
    case 'saveSettings': return saveSettings(msg.patch);
    case 'agentStatus': return { ...agentStatus(), token: await ensureToken() };
    case 'swBlockedOrigins': return swBlockedOrigins();
    case 'allowServiceWorkers': return allowServiceWorkers(msg.origin);
    case 'fillTab': return fillTab(msg.tabId);
    case 'exportShare': return exportShare(msg.id, msg.passphrase);
    case 'importShare': return importShare(msg.file, msg.passphrase);
    case 'exportAll': return exportAll(!!msg.includeCookies);
    case 'importAll': return importAll(msg.backup);
    case 'openMatrix': return openMatrix(msg.url, msg.sessionIds, msg.layout, msg.screen);
    case 'matrixAction': return matrixAction(msg.action, msg.url);
    case 'reapplyPreset': return syncDebugger(msg.tabId);

    // ----- recorder -----
    case 'startRecording': return startRecording(msg.tabId, msg.title);
    case 'stopRecording': return stopRecording(msg.tabId);
    case 'screenshot': return screenshot(msg.tabId, msg.note);
    case 'addNote': addStep(msg.tabId, { t: Date.now(), kind: 'note', text: msg.text }); return;
    case 'listRecordings': return (await chrome.storage.local.get('recIndex')).recIndex ?? [];
    case 'getRecording': {
      const live = activeRecordings().find((r) => r.id === msg.id);
      if (live) return live;
      return (await chrome.storage.local.get(`rec:${msg.id}`))[`rec:${msg.id}`];
    }
    case 'renameRecording': {
      const r = (await chrome.storage.local.get(`rec:${msg.id}`))[`rec:${msg.id}`] as Recording | undefined;
      if (r) { r.title = msg.title; await persistRecording(r); }
      return;
    }
    case 'deleteRecording': {
      const { recIndex = [] } = await chrome.storage.local.get('recIndex');
      await chrome.storage.local.set({ recIndex: (recIndex as { id: string }[]).filter((x) => x.id !== msg.id) });
      await chrome.storage.local.remove(`rec:${msg.id}`);
      return;
    }
    case 'openSidePanel': {
      if (msg.windowId !== undefined) await chrome.sidePanel.open({ windowId: msg.windowId });
      return;
    }
  }
  throw new Error(`Unknown message ${msg.type}`);
}

startAgentBridge((msg) => handle(msg as Msg, {} as chrome.runtime.MessageSender));

const EXT_ORIGIN = chrome.runtime.getURL('');
chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  // Web pages run our content scripts too: those may only use the narrow cs:* channel.
  // Everything else (cookies, sessions, recordings…) is reserved for the extension's own pages.
  const fromExtensionPage = sender.id === chrome.runtime.id && (sender.url ?? '').startsWith(EXT_ORIGIN);
  if (!fromExtensionPage && !String(msg?.type).startsWith('cs:')) {
    reply({ ok: false, error: 'Not allowed from a web page context' });
    return false;
  }
  handle(msg, sender).then(
    (result) => reply({ ok: true, result }),
    (e) => { console.warn('[QSL]', msg.type, e); reply({ ok: false, error: String((e as Error)?.message ?? e) }); },
  );
  return true;
});
