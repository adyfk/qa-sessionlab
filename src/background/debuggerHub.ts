import { DEVICE_PRESETS, NETWORK_PRESETS } from '../shared/presets';
import { needsDebugger, type EnvPreset, type Recording } from '../shared/types';
import { t } from '../shared/i18n';
import { getSession, newId, tabSession } from './state';

/**
 * One chrome.debugger attachment per tab, shared by:
 *   - environment presets (device, UA, locale, timezone, network throttling, colour scheme, geolocation)
 *   - the bug recorder (console, exceptions, failed requests, navigations)
 * Attached only while at least one of them is needed. Chrome shows its standard
 * "… started debugging this browser" bar while attached — that is expected.
 */

const attached = new Set<number>();
const recordings = new Map<number, Recording>(); // tabId -> active recording
const reqs = new Map<string, { method: string; url: string; type?: string }>();

const send = <T = any>(tabId: number, method: string, params?: object) =>
  chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;

async function ensureAttached(tabId: number) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attached.add(tabId);
}

async function detach(tabId: number) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
}

export function isAttached(tabId: number) { return attached.has(tabId); }

/**
 * CDP-side emulation only. Timezone, locale and geolocation are emulated in-page by the
 * shim (Chrome refuses e.g. Emulation.setTimezoneOverride from extension debugger clients).
 * Each command is applied independently so one refusal never blocks the others.
 */
async function applyPreset(tabId: number, p: EnvPreset): Promise<string[]> {
  const warnings: string[] = [];
  const tryCmd = async (method: string, params?: object) => {
    try { await send(tabId, method, params); } catch (e) { warnings.push(`${method}: ${(e as Error).message ?? e}`); }
  };
  const dev = DEVICE_PRESETS[p.device];
  if (dev) {
    await tryCmd('Emulation.setDeviceMetricsOverride', { width: dev.width, height: dev.height, deviceScaleFactor: dev.dpr, mobile: dev.mobile });
    await tryCmd('Emulation.setTouchEmulationEnabled', { enabled: dev.mobile, maxTouchPoints: dev.mobile ? 5 : 0 });
    if (dev.userAgent) {
      await tryCmd('Emulation.setUserAgentOverride', {
        userAgent: dev.userAgent, platform: dev.platform,
        ...(p.locale ? { acceptLanguage: `${p.locale},${p.locale.split('-')[0]};q=0.9` } : {}),
      });
    }
  }
  const net = NETWORK_PRESETS[p.network];
  if (net) {
    await tryCmd('Network.enable');
    await tryCmd('Network.emulateNetworkConditions', { offline: net.offline, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
  }
  const features: { name: string; value: string }[] = [];
  if (p.colorScheme) features.push({ name: 'prefers-color-scheme', value: p.colorScheme });
  if (p.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  if (features.length) await tryCmd('Emulation.setEmulatedMedia', { features });
  if (warnings.length) console.warn('[QSL] some emulation commands were refused', warnings);
  return warnings;
}

/** Make the tab's debugger state match its session preset + recording state. */
export async function syncDebugger(tabId: number) {
  const sid = await tabSession(tabId);
  const s = await getSession(sid);
  const wantPreset = needsDebugger(s?.preset);
  const wantRec = recordings.has(tabId);
  if (!wantPreset && !wantRec) return detach(tabId);
  try {
    // Re-attach to drop any emulation left over from a previous preset.
    if (attached.has(tabId) && !wantRec) await detach(tabId);
    await ensureAttached(tabId);
  } catch (e) {
    attached.delete(tabId);
    throw new Error(`Could not attach to the tab (close DevTools for it and try again): ${String((e as Error).message ?? e)}`);
  }
  if (wantPreset) await applyPreset(tabId, s!.preset);
  if (wantRec) await enableRecordingDomains(tabId);
}

// ---------------- recorder ----------------
async function enableRecordingDomains(tabId: number) {
  await send(tabId, 'Runtime.enable');
  await send(tabId, 'Log.enable');
  await send(tabId, 'Network.enable');
  await send(tabId, 'Page.enable');
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { for (const r of recordings.values()) void persistRecording(r); }, 800);
}

export async function persistRecording(r: Recording) {
  const { recIndex = [] } = (await chrome.storage.local.get('recIndex')) as { recIndex?: { id: string; title: string; startedAt: number; stoppedAt: number | null; tabId: number; sessionName?: string; counts: number[] }[] };
  const meta = { id: r.id, title: r.title, startedAt: r.startedAt, stoppedAt: r.stoppedAt, tabId: r.tabId, sessionName: r.env.sessionName, counts: [r.steps.length, r.console.length, r.network.length, r.screenshots.length] };
  const idx = [meta, ...recIndex.filter((x) => x.id !== r.id)].slice(0, 50);
  await chrome.storage.local.set({ recIndex: idx, [`rec:${r.id}`]: r });
}

export async function startRecording(tabId: number, title?: string): Promise<Recording> {
  if (recordings.has(tabId)) return recordings.get(tabId)!;
  const sid = (await tabSession(tabId)) ?? null;
  const s = await getSession(sid);
  const tab = await chrome.tabs.get(tabId);
  const r: Recording = {
    id: newId(), tabId, sessionId: sid, startedAt: Date.now(), stoppedAt: null,
    title: title?.trim() || `Bug on ${tab.url ? new URL(tab.url).hostname : 'page'} — ${new Date().toLocaleString()}`,
    steps: [{ t: Date.now(), kind: 'navigate', text: `Start on ${tab.title ?? ''}`, url: tab.url }],
    console: [], network: [], screenshots: [],
    env: { url: tab.url, preset: s?.preset ?? null, sessionName: s?.name },
  };
  recordings.set(tabId, r);
  await syncDebugger(tabId);
  try {
    const ev = await send<{ result: { value: { ua: string; vp: string; lang: string; tz: string } } }>(tabId, 'Runtime.evaluate', {
      expression: '({ua:navigator.userAgent,vp:innerWidth+"x"+innerHeight+" @"+devicePixelRatio+"x",lang:navigator.language,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})',
      returnByValue: true,
    });
    r.env.userAgent = ev.result.value.ua;
    r.env.viewport = `${ev.result.value.vp} · ${ev.result.value.lang} · ${ev.result.value.tz}`;
  } catch { /* ignore */ }
  chrome.tabs.sendMessage(tabId, { type: 'recording', on: true, text: t('cs.recOn') }).catch(() => undefined);
  await persistRecording(r);
  return r;
}

export async function stopRecording(tabId: number): Promise<Recording | undefined> {
  const r = recordings.get(tabId);
  if (!r) return;
  try { await screenshot(tabId, 'Final state'); } catch { /* ignore */ }
  r.stoppedAt = Date.now();
  recordings.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: 'recording', on: false, text: t('cs.recOff') }).catch(() => undefined);
  await persistRecording(r);
  await syncDebugger(tabId);
  return r;
}

export function activeRecording(tabId: number) { return recordings.get(tabId); }
export function activeRecordings() { return [...recordings.values()]; }

export function addStep(tabId: number, step: Recording['steps'][number]) {
  const r = recordings.get(tabId);
  if (!r) return;
  r.steps.push(step);
  if (r.steps.length > 1000) r.steps.shift();
  scheduleSave();
}

export async function screenshot(tabId: number, note = 'Screenshot') {
  const r = recordings.get(tabId);
  let dataUrl: string;
  if (attached.has(tabId)) {
    const { data } = await send<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png' });
    dataUrl = `data:image/png;base64,${data}`;
  } else {
    const tab = await chrome.tabs.get(tabId);
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  }
  const tab = await chrome.tabs.get(tabId);
  if (r) {
    r.screenshots.push({ t: Date.now(), dataUrl, url: tab.url ?? '' });
    r.steps.push({ t: Date.now(), kind: 'screenshot', text: `${note} (#${r.screenshots.length})`, url: tab.url });
    scheduleSave();
  }
  return dataUrl;
}

const short = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + '…' : s);

chrome.debugger.onEvent.addListener((src, method, params: any) => {
  const tabId = src.tabId;
  if (tabId === undefined) return;
  const r = recordings.get(tabId);
  if (!r) return;
  const t = Date.now();
  switch (method) {
    case 'Runtime.consoleAPICalled': {
      const text = (params.args ?? []).map((a: any) => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' ');
      const frame = params.stackTrace?.callFrames?.[0];
      r.console.push({ t, level: params.type, text: short(String(text)), url: frame?.url, line: frame?.lineNumber });
      break;
    }
    case 'Runtime.exceptionThrown': {
      const d = params.exceptionDetails;
      r.console.push({ t, level: 'exception', text: short(d.exception?.description ?? d.text), url: d.url, line: d.lineNumber });
      break;
    }
    case 'Log.entryAdded': {
      const e = params.entry;
      if (e.level === 'error' || e.level === 'warning') r.console.push({ t, level: `${e.source}:${e.level}`, text: short(e.text), url: e.url });
      break;
    }
    case 'Network.requestWillBeSent':
      reqs.set(params.requestId, { method: params.request.method, url: params.request.url, type: params.type });
      if (reqs.size > 5000) reqs.clear();
      break;
    case 'Network.responseReceived': {
      const st = params.response.status;
      if (st >= 400) {
        const q = reqs.get(params.requestId);
        r.network.push({ t, method: q?.method ?? 'GET', url: params.response.url, status: st, statusText: params.response.statusText, type: params.type });
      }
      break;
    }
    case 'Network.loadingFailed': {
      if (params.canceled) break;
      const q = reqs.get(params.requestId);
      r.network.push({ t, method: q?.method ?? '?', url: q?.url ?? '?', status: 0, statusText: '', error: params.errorText + (params.blockedReason ? ` (${params.blockedReason})` : ''), type: params.type });
      break;
    }
    case 'Page.frameNavigated':
      if (!params.frame.parentId) r.steps.push({ t, kind: 'navigate', text: `Navigated to ${params.frame.url}`, url: params.frame.url });
      break;
    default:
      return;
  }
  if (r.console.length > 2000) r.console.splice(0, r.console.length - 2000);
  if (r.network.length > 2000) r.network.splice(0, r.network.length - 2000);
  scheduleSave();
});

chrome.debugger.onDetach.addListener(async (src, reason) => {
  const tabId = src.tabId;
  if (tabId === undefined) return;
  attached.delete(tabId);
  const r = recordings.get(tabId);
  if (r && reason !== 'target_closed') {
    r.steps.push({ t: Date.now(), kind: 'note', text: `Debugger detached (${reason}); recording stopped` });
  }
  if (r) {
    r.stoppedAt = Date.now();
    recordings.delete(tabId);
    await persistRecording(r);
  }
});

export function forgetTab(tabId: number) {
  attached.delete(tabId);
  const r = recordings.get(tabId);
  if (r) { r.stoppedAt = Date.now(); recordings.delete(tabId); void persistRecording(r); }
}
