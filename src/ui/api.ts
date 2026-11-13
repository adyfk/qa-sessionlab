import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Recording, Session, Settings } from '../shared/types';
import { setLanguage } from '../shared/i18n';

export async function call<T = any>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const r = await chrome.runtime.sendMessage({ type, ...payload });
  if (!r?.ok) throw new Error(r?.error ?? 'No response from background');
  return r.result as T;
}

export interface AppState {
  sessions: Session[];
  assignments: Record<number, string>;
  counts: Record<string, number>;
  settings: Settings;
  recordings: { id: string; tabId: number; title: string; startedAt: number; counts: number[] }[];
  matrixTabs: number[];
}

/** Background state + the active tab, refreshed on any relevant browser event. */
export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const refresh = useCallback(async () => {
    const [s, [t]] = await Promise.all([call<AppState>('getState'), chrome.tabs.query({ active: true, lastFocusedWindow: true })]);
    setLanguage(s.settings.language);
    setState(s);
    setTab(t ?? null);
  }, []);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 120); };
    chrome.storage.onChanged.addListener(soon);
    chrome.tabs.onActivated.addListener(soon);
    chrome.tabs.onUpdated.addListener(soon);
    chrome.tabs.onRemoved.addListener(soon);
    chrome.windows.onFocusChanged.addListener(soon);
    const poll = setInterval(soon, 2000); // recording counters
    return () => {
      chrome.storage.onChanged.removeListener(soon);
      chrome.tabs.onActivated.removeListener(soon);
      chrome.tabs.onUpdated.removeListener(soon);
      chrome.tabs.onRemoved.removeListener(soon);
      chrome.windows.onFocusChanged.removeListener(soon);
      clearInterval(poll);
    };
  }, [refresh]);
  return { state, tab, refresh };
}

export const isWebUrl = (u?: string) => !!u && /^https?:/.test(u);

export function download(name: string, data: string | Blob, mime = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function dataUrlToBlob(dataUrl: string) {
  const [head, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const show = (text: string, err = false) => setMsg({ text, err });
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try { const r = await fn(); if (ok) show(ok); return r; } catch (e) { show(String((e as Error).message ?? e), true); return undefined; }
  };
  return { msg, show, run };
}

export async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export type { Recording };
