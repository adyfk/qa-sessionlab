/**
 * Service workers vs. session isolation.
 *
 * Requests a service worker makes (including navigations it intercepts) belong to no tab, so
 * per-tab DNR cookie rules can't apply: a session tab controlled by a SW reaches the server with
 * the *default profile's* cookies (usually none) and looks permanently signed out.
 *
 * When a session tab turns out to be SW-controlled we:
 *   1. remove the origin's SW registrations (chrome.browsingData),
 *   2. add the origin to a persistent list; a global DNR rule marks every document of that origin
 *      with `Server-Timing: qslnosw`, and main.js then blocks SW registration in *all* tabs,
 *   3. reload the tab, which now loads straight from the network with the session's cookies.
 * Users can allow an origin again in Settings.
 */
const RULE_ID = 1; // dynamic rule (persists across restarts)
const DNR = chrome.declarativeNetRequest;

export async function swBlockedOrigins(): Promise<string[]> {
  return ((await chrome.storage.local.get('swBlockedOrigins')).swBlockedOrigins as string[]) ?? [];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function syncRule(origins: string[]) {
  const addRules: chrome.declarativeNetRequest.Rule[] = origins.length
    ? [{
        id: RULE_ID,
        priority: 1,
        condition: {
          regexFilter: `^(${origins.map(escapeRe).join('|')})(/|$)`,
          resourceTypes: [DNR.ResourceType.MAIN_FRAME, DNR.ResourceType.SUB_FRAME],
        },
        action: {
          type: DNR.RuleActionType.MODIFY_HEADERS,
          responseHeaders: [{ header: 'server-timing', operation: DNR.HeaderOperation.APPEND, value: 'qslnosw' }],
        },
      }]
    : [];
  await DNR.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules });
}

const reloadedAt = new Map<number, number>();

export async function onSessionTabControlled(tabId: number, origin: string) {
  if (!/^https?:\/\//.test(origin)) return;
  const list = await swBlockedOrigins();
  if (!list.includes(origin)) {
    list.push(origin);
    await chrome.storage.local.set({ swBlockedOrigins: list });
    await syncRule(list);
  }
  await chrome.browsingData.remove({ origins: [origin] }, { serviceWorkers: true });
  // one reload per tab per 10s, never a loop
  if (Date.now() - (reloadedAt.get(tabId) ?? 0) > 10_000) {
    reloadedAt.set(tabId, Date.now());
    console.info('[QSL] service worker removed for', origin, '- reloading session tab');
    await chrome.tabs.reload(tabId).catch(() => undefined);
  }
}

export async function allowServiceWorkers(origin: string) {
  guarded.delete(origin);
  const list = (await swBlockedOrigins()).filter((o) => o !== origin);
  await chrome.storage.local.set({ swBlockedOrigins: list });
  await syncRule(list);
}

const guarded = new Set<string>();
/**
 * Call BEFORE a session tab navigates to `url`: makes sure no service worker of that origin can
 * intercept the navigation (otherwise the request leaves the session and e.g. a login cookie would
 * land in the default profile). Idempotent and cheap after the first call per origin.
 */
export async function guardOrigin(url: string | undefined) {
  let origin: string;
  try { origin = new URL(url ?? '').origin; } catch { return; }
  if (!/^https?:\/\//.test(origin) || guarded.has(origin)) return;
  guarded.add(origin);
  const list = await swBlockedOrigins();
  if (!list.includes(origin)) {
    list.push(origin);
    await chrome.storage.local.set({ swBlockedOrigins: list });
    await syncRule(list);
  }
  await chrome.browsingData.remove({ origins: [origin] }, { serviceWorkers: true }).catch(() => undefined);
}
