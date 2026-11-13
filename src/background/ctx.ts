import { pageEnvOf } from '../shared/types';
import { applyTabRules, type RuleCtx } from './rules';
import { getJar, getSession, newId, tabsOfSession } from './state';

/**
 * Pending localStorage restores (snapshot restore / storageState import), per session.
 * They ride along in the Server-Timing boot payload of matching origins until the page
 * shim confirms it wrote them. Kept in storage.session to survive worker restarts.
 */
type Restore = NonNullable<RuleCtx['restore']>;

async function loadRestores(): Promise<Record<string, Restore>> {
  return ((await chrome.storage.session.get('restores')).restores as Record<string, Restore>) ?? {};
}

export async function setPendingRestore(sid: string, byOrigin: Record<string, Record<string, string>>) {
  const all = await loadRestores();
  if (Object.keys(byOrigin).length) all[sid] = { id: newId(), byOrigin };
  else delete all[sid];
  await chrome.storage.session.set({ restores: all });
}

/** Called when a page confirms it applied the restore for its origin. */
export async function restoreApplied(sid: string, id: string, origin: string) {
  const all = await loadRestores();
  const r = all[sid];
  if (!r || r.id !== id || !r.byOrigin[origin]) return false;
  delete r.byOrigin[origin];
  if (!Object.keys(r.byOrigin).length) delete all[sid];
  await chrome.storage.session.set({ restores: all });
  return true;
}

const memCtx = new Map<string, RuleCtx>();

export async function ruleCtx(sid: string): Promise<RuleCtx> {
  const [jar, s, restores] = await Promise.all([getJar(sid), getSession(sid), loadRestores()]);
  const ctx = { sid, jar, env: pageEnvOf(s?.preset), restore: restores[sid] ?? null };
  memCtx.set(sid, ctx);
  return ctx;
}

/** Last computed context, for the synchronous fast path in webRequest listeners. */
export function cachedCtx(sid: string): RuleCtx | undefined {
  return memCtx.get(sid);
}
export function setCachedJar(sid: string, jar: RuleCtx['jar']) {
  const c = memCtx.get(sid);
  if (c) memCtx.set(sid, { ...c, jar });
}

/** Rebuild DNR rules for every tab of a session. */
export async function refreshRules(sid: string) {
  const ctx = await ruleCtx(sid);
  const tabs = await tabsOfSession(sid);
  await Promise.all(tabs.map((t) => applyTabRules(t, ctx).catch((e) => console.warn('[QSL] rules', t, e))));
  return { ctx, tabs };
}
