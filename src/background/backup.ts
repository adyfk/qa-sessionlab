import type { Session, Settings, Snapshot, StoredCookie } from '../shared/types';
import { getSessions, getSettings, invalidateCaches, newId } from './state';

/** Portable backup of everything the user created (no data ever leaves the browser otherwise). */
export interface Backup {
  format: 'qa-sessionlab-backup';
  version: 1;
  exportedAt: string;
  settings: Settings;
  sessions: Session[];
  jars: Record<string, StoredCookie[]>;
  snapshots: Record<string, Snapshot[]>;
}

export async function exportAll(includeCookies: boolean): Promise<Backup> {
  const sessions = await getSessions();
  const keys = sessions.flatMap((s) => [`jar:${s.id}`, `snaps:${s.id}`]);
  const raw = keys.length ? await chrome.storage.local.get(keys) : {};
  const jars: Backup['jars'] = {};
  const snapshots: Backup['snapshots'] = {};
  for (const s of sessions) {
    jars[s.id] = includeCookies ? ((raw[`jar:${s.id}`] as StoredCookie[]) ?? []) : [];
    snapshots[s.id] = includeCookies ? ((raw[`snaps:${s.id}`] as Snapshot[]) ?? []) : [];
  }
  return { format: 'qa-sessionlab-backup', version: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), sessions, jars, snapshots };
}

/** Merge a backup: sessions are added; a name clash gets a " (imported)" suffix. Returns count. */
export async function importAll(b: Backup): Promise<number> {
  if (b?.format !== 'qa-sessionlab-backup' || !Array.isArray(b.sessions)) throw new Error('This file is not a QA SessionLab backup');
  const existing = await getSessions();
  const names = new Set(existing.map((s) => s.name));
  const added: Session[] = [];
  const writes: Record<string, unknown> = {};
  for (const s of b.sessions) {
    const id = newId();
    let name = s.name;
    while (names.has(name)) name = `${name} (imported)`;
    names.add(name);
    added.push({ ...s, id, name });
    writes[`jar:${id}`] = b.jars?.[s.id] ?? [];
    writes[`snaps:${id}`] = (b.snapshots?.[s.id] ?? []).map((x) => ({ ...x, sessionId: id }));
  }
  await chrome.storage.local.set({ ...writes, sessions: [...existing, ...added], ...(b.settings ? { settings: { ...(await getSettings()), ...b.settings } } : {}) });
  invalidateCaches();
  return added.length;
}
