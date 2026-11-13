import { open, seal, type Sealed } from '../shared/crypto';
import type { Session, StoredCookie } from '../shared/types';
import { setPendingRestore } from './ctx';
import { exportStorageState } from './sessions';
import { createSession, getJar, getSession, getSessions, setJar } from './state';

interface SharedSession {
  session: Pick<Session, 'name' | 'color' | 'group' | 'notes' | 'startUrl' | 'preset'>;
  cookies: StoredCookie[];
  localStorage: Record<string, Record<string, string>>;
  sharedAt: string;
}

/** Encrypted, passphrase-protected copy of one session (login included) for a teammate. */
export async function exportShare(sid: string, passphrase: string): Promise<Sealed> {
  if (passphrase.length < 8) throw new Error('PASSPHRASE_TOO_SHORT');
  const s = await getSession(sid);
  if (!s) throw new Error('Unknown session');
  const st = await exportStorageState(sid);
  const payload: SharedSession = {
    session: { name: s.name, color: s.color, group: s.group, notes: s.notes, startUrl: s.startUrl, preset: s.preset },
    cookies: await getJar(sid),
    localStorage: Object.fromEntries(st.origins.map((o) => [o.origin, Object.fromEntries(o.localStorage.map((x) => [x.name, x.value]))])),
    sharedAt: new Date().toISOString(),
  };
  return seal(payload, passphrase);
}

export async function importShare(sealed: Sealed, passphrase: string): Promise<Session> {
  const p = await open<SharedSession>(sealed, passphrase);
  const names = new Set((await getSessions()).map((x) => x.name));
  let name = p.session.name;
  while (names.has(name)) name = `${name} (shared)`;
  const s = await createSession({ ...p.session, name });
  await setJar(s.id, p.cookies ?? []);
  await setPendingRestore(s.id, p.localStorage ?? {});
  return s;
}
