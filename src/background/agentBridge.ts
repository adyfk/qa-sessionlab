import { toMarkdown } from '../shared/report';
import { getSettings, saveSettings, tabSession, getSession } from './state';

/**
 * AI control bridge.
 *
 *   AI client ⇄ (stdio MCP) ⇄ tools/mcp/qsl-mcp.mjs ⇄ ws://127.0.0.1:<port> ⇄ this service worker
 *
 * The extension is the WebSocket *client*: it only connects when the user enabled "AI control" in
 * Settings, and the server must authenticate with the token shown there before any command runs.
 * Commands reuse the same handler as the UI, plus page-automation helpers for session tabs.
 */

type Handler = (msg: { type: string; [k: string]: unknown }) => Promise<unknown>;
let handler: Handler | null = null;
let ws: WebSocket | null = null;
let authed = false;
let status: 'off' | 'connecting' | 'connected' | 'waiting' = 'off';
let lastError = '';
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 750;

export function agentStatus() { return { status, lastError }; }

export async function ensureToken() {
  const s = await getSettings();
  if (s.agentToken) return s.agentToken;
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const token = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 24);
  await saveSettings({ agentToken: token });
  return token;
}

export function startAgentBridge(h: Handler) {
  handler = h;
  void connect();
  // MV3 workers sleep; an alarm wakes us to (re)connect while AI control is on.
  chrome.alarms.create('qsl-agent', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'qsl-agent') void connect(); });
  chrome.storage.onChanged.addListener((c) => {
    if (c.settings) { ws?.close(); ws = null; void connect(); }
  });
}

async function connect() {
  const s = await getSettings();
  if (!s.agentEnabled) { status = 'off'; ws?.close(); ws = null; return; }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  await ensureToken();
  status = 'connecting';
  authed = false;
  let sock: WebSocket;
  try {
    sock = new WebSocket(`ws://127.0.0.1:${s.agentPort}/qsl`);
  } catch (e) {
    status = 'waiting'; lastError = 'noServer'; return;
  }
  ws = sock;
  // Mutual challenge-response: the token itself never travels over the socket.
  const myNonce = randomHex(16);
  sock.onopen = () => {
    sock.send(JSON.stringify({ type: 'hello', product: 'qa-sessionlab', version: chrome.runtime.getManifest().version, nonce: myNonce }));
  };
  sock.onmessage = async (ev) => {
    let m: { type?: string; nonce?: string; proof?: string; id?: number; method?: string; params?: Record<string, unknown> };
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.type === 'challenge') {
      const token = (await getSettings()).agentToken;
      const expected = await hmac(token, `server|${myNonce}`);
      if (!m.proof || m.proof !== expected || !m.nonce) {
        sock.send(JSON.stringify({ type: 'auth', ok: false }));
        lastError = 'wrongToken'; status = 'waiting'; sock.close();
        return;
      }
      sock.send(JSON.stringify({ type: 'auth', ok: true, proof: await hmac(token, `ext|${m.nonce}`) }));
      authed = true; status = 'connected'; lastError = ''; retryDelay = 750;
      return;
    }
    if (!authed || m.id === undefined || !m.method) return;
    try {
      const result = await run(m.method, m.params ?? {});
      sock.send(JSON.stringify({ id: m.id, result: result === undefined ? null : result }));
    } catch (e) {
      sock.send(JSON.stringify({ id: m.id, error: String((e as Error)?.message ?? e) }));
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    status = status === 'off' ? 'off' : 'waiting';
    // Keep trying while AI control is on (the MCP server may start later or restart):
    // quick at first, then back off to 5s (a cheap failed localhost connect) so a freshly started MCP server is picked up quickly. The 30s alarm also retries.
    clearTimeout(retryTimer);
    retryDelay = Math.min(retryDelay * 2, 5_000);
    retryTimer = setTimeout(() => void connect(), retryDelay);
  };
  sock.onerror = () => { lastError = 'noServer'; };
}

// ---------------- commands ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveSession(ref: unknown): Promise<string> {
  const st = (await handler!({ type: 'getState' })) as { sessions: { id: string; name: string }[] };
  const r = String(ref ?? '');
  const s = st.sessions.find((x) => x.id === r) ?? st.sessions.find((x) => x.name.toLowerCase() === r.toLowerCase());
  if (!s) throw new Error(`No session "${r}". Existing: ${st.sessions.map((x) => x.name).join(', ') || '(none)'}`);
  return s.id;
}

async function exec<T>(tabId: number, func: (...a: any[]) => T, args: unknown[] = []): Promise<T> {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: func as any, args });
  return r?.result as T;
}

async function waitLoaded(tabId: number, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete' && /^https?:/.test(t.url ?? '')) return t;
    await sleep(150);
  }
  return chrome.tabs.get(tabId);
}

function readPage(selector: string | null, maxChars: number) {
  const root = selector ? document.querySelector(selector) : document.body;
  const text = root ? (root as HTMLElement).innerText : '';
  const interactive = [...document.querySelectorAll('a,button,input,select,textarea,[role=button]')]
    .filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .slice(0, 150)
    .map((e) => {
      const el = e as HTMLInputElement;
      const label = (el.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      return `${el.tagName.toLowerCase()}${el.type && el.tagName === 'INPUT' ? `[${el.type}]` : ''}${el.name ? `[name=${el.name}]` : ''}${el.id ? `#${el.id}` : ''}: ${label}${el.tagName === 'A' ? ` -> ${(el as unknown as HTMLAnchorElement).getAttribute('href')}` : ''}`;
    });
  return { url: location.href, title: document.title, found: !!root, text: text.slice(0, maxChars), truncated: text.length > maxChars, interactive };
}

function findAndAct(selector: string | null, text: string | null, action: 'click' | 'type', value: string, submit: boolean) {
  let el: Element | null = null;
  if (selector) el = document.querySelector(selector);
  if (!el && text) {
    const want = text.trim().toLowerCase();
    const cands = [...document.querySelectorAll('button,a,[role=button],input[type=submit],input[type=button],label,summary,[onclick]')];
    el = cands.find((c) => ((c as HTMLElement).innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '').trim().toLowerCase() === want)
      ?? cands.find((c) => ((c as HTMLElement).innerText || (c as HTMLInputElement).value || c.getAttribute('aria-label') || '').trim().toLowerCase().includes(want))
      ?? null;
    if (!el && action === 'type') {
      el = [...document.querySelectorAll('input,textarea')].find((i) => {
        const e = i as HTMLInputElement;
        const lbl = e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : e.closest('label')?.textContent;
        return [e.name, e.placeholder, e.getAttribute('aria-label'), lbl].some((x) => (x ?? '').toLowerCase().includes(want));
      }) ?? null;
    }
  }
  if (!el) return { ok: false, error: `Element not found (selector: ${selector ?? '-'}, text: ${text ?? '-'})` };
  (el as HTMLElement).scrollIntoView({ block: 'center' });
  if (action === 'click') { (el as HTMLElement).click(); return { ok: true, clicked: (el as HTMLElement).innerText?.slice(0, 80) || el.tagName }; }
  const input = el as HTMLInputElement;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  input.focus();
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (submit) {
    const form = input.form;
    if (form?.requestSubmit) form.requestSubmit(); else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  return { ok: true, typed: input.name || input.id || input.type };
}

async function run(method: string, p: Record<string, any>): Promise<unknown> {
  const h = handler!;
  switch (method) {
    case 'status': {
      const st = (await h({ type: 'getState' })) as any;
      return { version: chrome.runtime.getManifest().version, sessions: st.sessions.length, openSessionTabs: Object.keys(st.assignments).length };
    }
    case 'listSessions': {
      const st = (await h({ type: 'getState' })) as any;
      return st.sessions.map((s: any) => ({
        id: s.id, name: s.name, group: s.group, temporary: s.temporary, notes: s.notes, startUrl: s.startUrl, preset: s.preset,
        openTabs: Object.entries(st.assignments).filter(([, sid]) => sid === s.id).map(([t]) => Number(t)),
      }));
    }
    case 'createSession': return (await h({ type: 'createSession', session: p.session ?? { name: p.name, group: p.group, temporary: p.temporary, startUrl: p.startUrl, notes: p.notes }, openUrl: null }) as any).session;
    case 'updateSession': return h({ type: 'updateSession', id: await resolveSession(p.session), patch: p.patch });
    case 'deleteSession': return h({ type: 'deleteSession', id: await resolveSession(p.session), closeTabs: !!p.closeTabs });
    case 'clearSession': return h({ type: 'clearSessionData', id: await resolveSession(p.session) });
    case 'open': {
      const tabId = (await h({ type: 'openInSession', id: await resolveSession(p.session), url: p.url })) as number;
      const t = await waitLoaded(tabId, p.timeoutMs ?? 20000);
      return { tabId, url: t.url, title: t.title };
    }
    case 'listTabs': {
      const tabs = await chrome.tabs.query({});
      const out = [];
      for (const t of tabs) {
        const sid = t.id !== undefined ? await tabSession(t.id) : undefined;
        out.push({ tabId: t.id, url: t.url, title: t.title, active: t.active, session: sid ? (await getSession(sid))?.name ?? sid : null });
      }
      return out;
    }
    case 'navigate': {
      await chrome.tabs.update(p.tabId, { url: p.url });
      await sleep(300);
      const t = await waitLoaded(p.tabId, p.timeoutMs ?? 20000);
      return { url: t.url, title: t.title };
    }
    case 'reload': await chrome.tabs.reload(p.tabId); await sleep(300); return waitLoaded(p.tabId).then((t) => ({ url: t.url, title: t.title }));
    case 'closeTab': await chrome.tabs.remove(p.tabId); return { ok: true };
    case 'readPage': return exec(p.tabId, readPage, [p.selector ?? null, p.maxChars ?? 8000]);
    case 'click': {
      const r = await exec(p.tabId, findAndAct, [p.selector ?? null, p.text ?? null, 'click', '', false]);
      await sleep(p.settleMs ?? 600);
      return r;
    }
    case 'type': {
      const r = await exec(p.tabId, findAndAct, [p.selector ?? null, p.field ?? null, 'type', String(p.value ?? ''), !!p.submit]);
      await sleep(p.settleMs ?? (p.submit ? 800 : 100));
      return r;
    }
    case 'waitFor': {
      const end = Date.now() + (p.timeoutMs ?? 10000);
      while (Date.now() < end) {
        const ok = await exec(p.tabId, (sel: string | null, txt: string | null) => (sel ? !!document.querySelector(sel) : true) && (txt ? document.body?.innerText.includes(txt) : true), [p.selector ?? null, p.text ?? null]).catch(() => false);
        if (ok) return { ok: true };
        await sleep(200);
      }
      return { ok: false, error: 'timeout' };
    }
    case 'screenshot': {
      const t = await chrome.tabs.get(p.tabId);
      await chrome.windows.update(t.windowId, { focused: true });
      await chrome.tabs.update(p.tabId, { active: true });
      await sleep(250);
      return { dataUrl: await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' }) };
    }
    case 'compare': {
      // Objective RBAC check: open the same URL as each role, return what each one sees.
      const results = [];
      for (const ref of p.sessions as string[]) {
        const sid = await resolveSession(ref);
        const tabId = (await h({ type: 'openInSession', id: sid, url: p.url })) as number;
        await waitLoaded(tabId, p.timeoutMs ?? 20000);
        await sleep(p.settleMs ?? 800);
        const page = await exec(tabId, readPage, [p.selector ?? null, p.maxChars ?? 4000]);
        results.push({ session: ref, tabId, ...page });
        if (p.closeTabs) await chrome.tabs.remove(tabId).catch(() => undefined);
      }
      return results;
    }
    case 'cookies': return h({ type: 'getCookies', id: await resolveSession(p.session) });
    case 'snapshot': return h({ type: 'takeSnapshot', id: await resolveSession(p.session), label: p.label ?? 'AI snapshot' });
    case 'listSnapshots': return h({ type: 'listSnapshots', id: await resolveSession(p.session) });
    case 'restoreSnapshot': return h({ type: 'restoreSnapshot', id: await resolveSession(p.session), snapId: p.snapshotId });
    case 'exportStorageState': return h({ type: 'exportStorageState', id: await resolveSession(p.session) });
    case 'importStorageState': return h({ type: 'importStorageState', name: p.name, state: p.state });
    case 'fillForm': return chrome.tabs.sendMessage(p.tabId, { type: 'fillForm', domain: (await getSettings()).testEmailDomain });
    case 'startRecording': return h({ type: 'startRecording', tabId: p.tabId, title: p.title });
    case 'stopRecording': {
      const r = (await h({ type: 'stopRecording', tabId: p.tabId })) as any;
      if (!r) return null;
      return { id: r.id, markdown: toMarkdown(r), console: r.console, failedRequests: r.network, steps: r.steps };
    }
    case 'openMatrix': return h({ type: 'openMatrix', url: p.url, sessionIds: await Promise.all((p.sessions as string[]).map(resolveSession)), layout: p.layout ?? 'tabs', screen: { width: 1600, height: 900, left: 0, top: 0 } });
  }
  throw new Error(`Unknown method ${method}`);
}

function randomHex(bytes: number) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
