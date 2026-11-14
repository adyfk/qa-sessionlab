import { purgeExpired } from '../shared/cookies';
import {
  DEFAULT_SETTINGS, EMPTY_PRESET, GROUP_COLORS,
  type Session, type Settings, type Snapshot, type StoredCookie,
} from '../shared/types';

/**
 * Persistent state:
 *   storage.local:   settings, sessions, jar:<sid>, snaps:<sid>
 *   storage.session: tabMap (tabId -> sid), survives service-worker restarts.
 * Every read goes through these helpers so the service worker can be killed at any time.
 */

const local = chrome.storage.local;
const sess = chrome.storage.session;

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

// ---------- settings ----------
export async function getSettings(): Promise<Settings> {
  const { settings } = await local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}
/**
 * Read-modify-write under a lock: two concurrent saves (e.g. the install migration and a user
 * change) must not overwrite each other with a stale copy.
 */
let settingsLock: Promise<unknown> = Promise.resolve();
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = settingsLock.then(async () => {
    const s = { ...(await getSettings()), ...patch };
    await local.set({ settings: s });
    return s;
  });
  settingsLock = run.catch(() => undefined);
  return run;
}

// ---------- sessions ----------
let sessionsCache: Session[] | null = null;

export async function getSessions(): Promise<Session[]> {
  if (sessionsCache) return sessionsCache;
  const { sessions } = await local.get('sessions');
  sessionsCache = ((sessions as Session[]) ?? []).map((s) => ({ ...s, preset: { ...EMPTY_PRESET, ...(s.preset ?? {}) } }));
  return sessionsCache;
}
async function putSessions(list: Session[]) {
  sessionsCache = list;
  await local.set({ sessions: list });
}
export async function getSession(id: string | null | undefined): Promise<Session | undefined> {
  if (!id) return undefined;
  return (await getSessions()).find((s) => s.id === id);
}

export async function createSession(partial: Partial<Session> = {}): Promise<Session> {
  const list = await getSessions();
  const used = new Set(list.map((s) => s.color));
  const color = partial.color ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[list.length % GROUP_COLORS.length];
  let name = (partial.name ?? '').trim() || `Session ${list.length + 1}`;
  // Names must be unique because tab-group titles are used to re-attach tabs after a browser restart.
  const names = new Set(list.map((s) => s.name));
  if (names.has(name)) { let i = 2; while (names.has(`${name} ${i}`)) i++; name = `${name} ${i}`; }
  const s: Session = {
    id: newId(), name, color, group: partial.group ?? '', temporary: partial.temporary ?? false,
    preset: { ...EMPTY_PRESET, ...(partial.preset ?? {}) }, notes: partial.notes ?? '', startUrl: partial.startUrl ?? '',
    createdAt: Date.now(),
  };
  await putSessions([...list, s]);
  return s;
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<Session | undefined> {
  const list = await getSessions();
  const i = list.findIndex((s) => s.id === id);
  if (i === -1) return undefined;
  if (patch.name !== undefined) {
    patch.name = patch.name.trim() || list[i].name;
    if (list.some((s, j) => j !== i && s.name === patch.name)) throw new Error(`A session named "${patch.name}" already exists`);
  }
  const next = { ...list[i], ...patch, id };
  const copy = list.slice(); copy[i] = next;
  await putSessions(copy);
  return next;
}

export async function deleteSessionRecord(id: string) {
  await putSessions((await getSessions()).filter((s) => s.id !== id));
  await local.remove([`jar:${id}`, `snaps:${id}`]);
}

// ---------- cookie jars ----------
const jarCache = new Map<string, StoredCookie[]>();

export async function getJar(sid: string): Promise<StoredCookie[]> {
  const hit = jarCache.get(sid);
  if (hit) return hit;
  const k = `jar:${sid}`;
  const jar = purgeExpired(((await local.get(k))[k] as StoredCookie[]) ?? []);
  jarCache.set(sid, jar);
  return jar;
}
export async function setJar(sid: string, jar: StoredCookie[]) {
  jarCache.set(sid, jar);
  await local.set({ [`jar:${sid}`]: jar });
}

// ---------- snapshots ----------
export async function getSnapshots(sid: string): Promise<Snapshot[]> {
  const k = `snaps:${sid}`;
  return ((await local.get(k))[k] as Snapshot[]) ?? [];
}
export async function setSnapshots(sid: string, snaps: Snapshot[]) {
  await local.set({ [`snaps:${sid}`]: snaps });
}

// ---------- tab -> session map ----------
let tabMap: Map<number, string> | null = null;

async function loadTabMap(): Promise<Map<number, string>> {
  if (tabMap) return tabMap;
  const { tabMap: raw } = await sess.get('tabMap');
  tabMap = new Map(Object.entries((raw as Record<string, string>) ?? {}).map(([k, v]) => [Number(k), v]));
  return tabMap;
}
async function persistTabMap() {
  await sess.set({ tabMap: Object.fromEntries(tabMap ?? []) });
}
export async function tabSession(tabId: number): Promise<string | undefined> {
  return (await loadTabMap()).get(tabId);
}
/** Synchronous lookup for hot paths (webRequest). Only valid after warmUp(). */
export function tabSessionSync(tabId: number): string | undefined {
  return tabMap?.get(tabId);
}
export async function setTabSession(tabId: number, sid: string | null) {
  const m = await loadTabMap();
  if (sid) m.set(tabId, sid); else m.delete(tabId);
  await persistTabMap();
}
export async function tabsOfSession(sid: string): Promise<number[]> {
  return [...(await loadTabMap()).entries()].filter(([, s]) => s === sid).map(([t]) => t);
}
/** Synchronous variant for hot paths. Only valid after warmUp(). */
export function tabsOfSessionSync(sid: string): number[] {
  return [...(tabMap ?? new Map()).entries()].filter(([, s]) => s === sid).map(([t]) => t);
}
export function cachedJar(sid: string): StoredCookie[] | undefined {
  return jarCache.get(sid);
}
export async function allTabAssignments(): Promise<Record<number, string>> {
  return Object.fromEntries(await loadTabMap());
}

/** Drop in-memory caches after bulk writes to storage (backup restore). */
export function invalidateCaches() {
  sessionsCache = null;
  jarCache.clear();
}

export async function warmUp() {
  await Promise.all([loadTabMap(), getSessions()]);
}
