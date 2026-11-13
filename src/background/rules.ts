import { cookiesFor, domainMatches, isLocalHost, serializeCookieHeader } from '../shared/cookies';
import type { BootPayload, PageEnv, StoredCookie } from '../shared/types';

/**
 * Per-tab request isolation using declarativeNetRequest *session* rules.
 *
 * For every tab bound to a session:
 *   prio 1   : remove the browser's real Cookie header (nothing leaks from the default profile)
 *   prio 10+n: Domain-cookie rule for each domain with non-host-only cookies (covers unseen subdomains)
 *   prio 1000: exact-host rule for each host that has cookies, with the full RFC 6265 match
 * Higher-priority "set" wins over lower-priority "remove" for the same header.
 *
 * Every rule also appends a `Server-Timing: qsl;dur=<prio>;desc="<payload>"` response header.
 * The page's MAIN-world content script reads it synchronously at document_start via
 * performance.getEntriesByType('navigation') — before any page script runs — so the page
 * learns its session (and the session's document.cookie view / env emulation) with no race.
 * The entry with the highest `dur` is the most specific one.
 */

type Rule = chrome.declarativeNetRequest.Rule;
const DNR = chrome.declarativeNetRequest;
const ALL_TYPES = Object.values(DNR.ResourceType) as chrome.declarativeNetRequest.ResourceType[];
/** Per-user content: documents, fetch/XHR and "other" (e.g. EventSource). Static assets keep normal caching. */
const DATA_TYPES = [DNR.ResourceType.MAIN_FRAME, DNR.ResourceType.SUB_FRAME, DNR.ResourceType.XMLHTTPREQUEST, DNR.ResourceType.OTHER];

export interface RuleCtx {
  sid: string;
  jar: StoredCookie[];
  env: PageEnv | null;
  /** Pending localStorage restore (snapshot / storageState import): origin -> kv */
  restore: { id: string; byOrigin: Record<string, Record<string, string>> } | null;
}

const ruleIdsByTab = new Map<number, number[]>();
let nextRuleId = 1;
let restored = false;

async function restore() {
  if (restored) return;
  restored = true;
  // Service worker restarted: rebuild our id bookkeeping from the live rule set.
  const rules = await DNR.getSessionRules();
  for (const r of rules) {
    const tab = r.condition.tabIds?.[0];
    if (tab === undefined) continue;
    const ids = ruleIdsByTab.get(tab) ?? [];
    ids.push(r.id);
    ruleIdsByTab.set(tab, ids);
    nextRuleId = Math.max(nextRuleId, r.id + 1);
  }
}

const isLocal = isLocalHost;

function b64url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function payloadHeader(prio: number, p: BootPayload): chrome.declarativeNetRequest.ModifyHeaderInfo {
  return { header: 'server-timing', operation: DNR.HeaderOperation.APPEND, value: `qsl;dur=${prio};desc="${b64url(JSON.stringify(p))}"` };
}

function action(prio: number, cookie: string | null, ctx: RuleCtx, payload: BootPayload): chrome.declarativeNetRequest.RuleAction {
  const requestHeaders: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [
    cookie === null
      ? { header: 'cookie', operation: DNR.HeaderOperation.REMOVE }
      : { header: 'cookie', operation: DNR.HeaderOperation.SET, value: cookie },
  ];
  if (ctx.env?.locale) {
    const l = ctx.env.locale;
    requestHeaders.push({ header: 'accept-language', operation: DNR.HeaderOperation.SET, value: `${l},${l.split('-')[0]};q=0.9` });
  }
  return { type: DNR.RuleActionType.MODIFY_HEADERS, requestHeaders, responseHeaders: [payloadHeader(prio, payload)] };
}

/** Non-HttpOnly cookies a document on `host` may see (path/secure filtered by the page shim). */
const visibleFor = (jar: StoredCookie[], host: string, onlyDomainCookies = false) =>
  jar.filter((c) => !c.httpOnly && (c.hostOnly ? !onlyDomainCookies && c.domain === host : domainMatches(host, c.domain)));

function restoreFor(ctx: RuleCtx, host: string): BootPayload['restore'] {
  if (!ctx.restore) return null;
  const byOrigin: Record<string, Record<string, string>> = {};
  for (const [o, kv] of Object.entries(ctx.restore.byOrigin)) {
    try { if (new URL(o).hostname === host) byOrigin[o] = kv; } catch { /* ignore */ }
  }
  return Object.keys(byOrigin).length ? { id: ctx.restore.id, byOrigin } : null;
}

/** Pure: compute the rules (without ids) for one tab. */
export function buildRules(tabId: number, ctx: RuleCtx): Omit<Rule, 'id'>[] {
  const { jar, sid, env } = ctx;
  const out: Omit<Rule, 'id'>[] = [];
  out.push({
    priority: 1,
    condition: { tabIds: [tabId], resourceTypes: ALL_TYPES },
    action: action(1, null, ctx, { sid, jar: [], env, restore: null }),
  });

  // The browser's HTTP cache is keyed by URL, not by cookies: a cacheable response fetched by one
  // session could be served to another (or to the normal profile). For documents and API calls of
  // session tabs: never reuse a cached entry (request no-cache) and never store one (response no-store).
  out.push({
    priority: 1,
    condition: { tabIds: [tabId], resourceTypes: DATA_TYPES },
    action: {
      type: DNR.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [
        { header: 'cache-control', operation: DNR.HeaderOperation.SET, value: 'no-cache' },
        { header: 'pragma', operation: DNR.HeaderOperation.SET, value: 'no-cache' },
      ],
      responseHeaders: [
        { header: 'cache-control', operation: DNR.HeaderOperation.SET, value: 'no-store' },
        // Speculative prefetch/prerender requests are made outside the tab (no session cookies).
        { header: 'speculation-rules', operation: DNR.HeaderOperation.REMOVE },
      ],
    },
  });

  const hosts = new Set<string>();
  const domains = new Set<string>();
  for (const c of jar) (c.hostOnly ? hosts : domains).add(c.domain);
  // A domain cookie's own domain is also an exact host that may carry host-only cookies of its parents.
  for (const d of domains) hosts.add(d);
  for (const o of Object.keys(ctx.restore?.byOrigin ?? {})) { try { hosts.add(new URL(o).hostname); } catch { /* ignore */ } }

  for (const d of domains) {
    // Subdomains of d that have no explicit rule: only Domain= cookies apply.
    const probe = `x.${d}`;
    const prio = 10 + d.split('.').length;
    for (const secure of [true, false]) {
      const cs = cookiesFor(jar, probe, { secure: secure || isLocal(d), includeHttpOnly: true }).filter((c) => !c.hostOnly);
      if (!cs.length) continue;
      const payload = { sid, jar: visibleFor(jar, probe, true), env, restore: null };
      out.push({
        priority: prio,
        condition: { tabIds: [tabId], requestDomains: [d], urlFilter: secure ? '|https:' : '|http:', resourceTypes: ALL_TYPES },
        action: action(prio, serializeCookieHeader(cs), ctx, payload),
      });
      pushThirdParty(out, cs, prio + 500, { tabIds: [tabId], requestDomains: [d], urlFilter: secure ? '|https:' : '|http:' }, ctx, payload);
    }
  }
  for (const h of hosts) {
    for (const secure of [true, false]) {
      const cs = cookiesFor(jar, h, { secure: secure || isLocal(h), includeHttpOnly: true });
      const rest = restoreFor(ctx, h);
      if (!cs.length && !rest) continue;
      const payload = { sid, jar: visibleFor(jar, h), env, restore: rest };
      // "^" is a separator: matches "/", ":port", "?" or end — never "example.com.evil.net".
      const cond = { tabIds: [tabId], urlFilter: `|${secure ? 'https' : 'http'}://${h}^` };
      out.push({ priority: 1000, condition: { ...cond, resourceTypes: ALL_TYPES }, action: action(1000, cs.length ? serializeCookieHeader(cs) : null, ctx, payload) });
      pushThirdParty(out, cs, 1001, cond, ctx, payload);
    }
  }
  return out;
}

/**
 * SameSite enforcement: a cross-site subresource or iframe request (DNR "thirdParty" relative to the
 * initiator) only carries SameSite=None cookies, like a real browser. Top-level navigations are left
 * out so Lax cookies still arrive when following a link from another site.
 */
function pushThirdParty(out: Omit<Rule, 'id'>[], cs: StoredCookie[], priority: number, cond: Partial<chrome.declarativeNetRequest.RuleCondition>, ctx: RuleCtx, payload: BootPayload) {
  if (!cs.some((c) => c.sameSite !== 'None')) return; // nothing to drop
  const allowed = cs.filter((c) => c.sameSite === 'None');
  out.push({
    priority,
    condition: { ...cond, domainType: DNR.DomainType.THIRD_PARTY, resourceTypes: ALL_TYPES.filter((t) => t !== DNR.ResourceType.MAIN_FRAME) },
    action: action(priority, allowed.length ? serializeCookieHeader(allowed) : null, ctx, payload),
  });
}

let queue: Promise<unknown> = Promise.resolve();
/** Replace all rules of a tab. Pass ctx=null to remove isolation from the tab. */
export function applyTabRules(tabId: number, ctx: RuleCtx | null): Promise<void> {
  // Serialize: concurrent updates would otherwise remove stale rule ids.
  const run = queue.then(() => applyTabRulesNow(tabId, ctx));
  queue = run.catch(() => undefined);
  return run;
}

async function applyTabRulesNow(tabId: number, ctx: RuleCtx | null) {
  await restore();
  const removeRuleIds = ruleIdsByTab.get(tabId) ?? [];
  const addRules: Rule[] = ctx ? buildRules(tabId, ctx).map((r) => ({ ...r, id: nextRuleId++ })) : [];
  await DNR.updateSessionRules({ removeRuleIds, addRules });
  if (addRules.length) ruleIdsByTab.set(tabId, addRules.map((r) => r.id));
  else ruleIdsByTab.delete(tabId);
}
