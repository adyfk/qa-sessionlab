import type { StoredCookie } from './types';

const nowSec = () => Math.floor(Date.now() / 1000);

/** RFC 6265 default-path. */
export function defaultPath(urlPath: string): string {
  if (!urlPath.startsWith('/')) return '/';
  const i = urlPath.lastIndexOf('/');
  return i <= 0 ? '/' : urlPath.slice(0, i);
}

/** Domain-match per RFC 6265 §5.1.3. `domain` has no leading dot. */
export function domainMatches(host: string, domain: string): boolean {
  host = host.toLowerCase();
  if (host === domain) return true;
  return host.endsWith('.' + domain) && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
}

export function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

/**
 * Parse one Set-Cookie header value (as seen from `url`).
 * Returns null when the cookie must be rejected (bad domain, etc).
 */
export function parseSetCookie(header: string, url: string, now = nowSec()): StoredCookie | null {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const parts = header.split(';');
  const first = parts.shift() ?? '';
  const eq = first.indexOf('=');
  // Cookie without "=" is treated as a value with an empty name (browser behaviour).
  const name = (eq === -1 ? '' : first.slice(0, eq)).trim();
  const value = (eq === -1 ? first : first.slice(eq + 1)).trim();
  if (!name && !value) return null;

  const c: StoredCookie = {
    name, value, domain: host, hostOnly: true, path: defaultPath(u.pathname),
    expires: -1, secure: false, httpOnly: false, sameSite: 'Lax',
  };
  let maxAgeSeen = false;
  for (const raw of parts) {
    const i = raw.indexOf('=');
    const k = (i === -1 ? raw : raw.slice(0, i)).trim().toLowerCase();
    const v = i === -1 ? '' : raw.slice(i + 1).trim();
    switch (k) {
      case 'domain': {
        let d = v.toLowerCase().replace(/^\./, '');
        if (!d) break;
        if (!domainMatches(host, d)) return null; // cannot set cookie for foreign domain
        c.domain = d; c.hostOnly = false;
        break;
      }
      case 'path': c.path = v.startsWith('/') ? v : defaultPath(u.pathname); break;
      case 'max-age': {
        const n = parseInt(v, 10);
        if (!Number.isNaN(n)) { c.expires = n <= 0 ? 0 : now + n; maxAgeSeen = true; }
        break;
      }
      case 'expires': {
        if (maxAgeSeen) break;
        const t = Date.parse(v);
        if (!Number.isNaN(t)) c.expires = Math.max(0, Math.floor(t / 1000));
        break;
      }
      case 'secure': c.secure = true; break;
      case 'httponly': c.httpOnly = true; break;
      case 'samesite': {
        const s = v.toLowerCase();
        c.sameSite = s === 'strict' ? 'Strict' : s === 'none' ? 'None' : 'Lax';
        break;
      }
    }
  }
  if (name.startsWith('__Secure-') && !c.secure) return null;
  if (name.startsWith('__Host-') && (!c.secure || !c.hostOnly || c.path !== '/')) return null;
  return c;
}

export const cookieKey = (c: Pick<StoredCookie, 'name' | 'domain' | 'path' | 'hostOnly'>) =>
  `${c.hostOnly ? '=' : '.'}${c.domain}|${c.path}|${c.name}`;

export function isExpired(c: StoredCookie, now = nowSec()): boolean {
  return c.expires !== -1 && c.expires <= now;
}

/** Insert/replace/delete a cookie in a jar (returns new array). */
export function upsertCookie(jar: StoredCookie[], c: StoredCookie, now = nowSec()): StoredCookie[] {
  const k = cookieKey(c);
  const out = jar.filter((x) => cookieKey(x) !== k && !isExpired(x, now));
  if (!isExpired(c, now)) out.push(c);
  return out;
}

export function purgeExpired(jar: StoredCookie[], now = nowSec()): StoredCookie[] {
  return jar.filter((c) => !isExpired(c, now));
}

export interface MatchOpts { secure: boolean; includeHttpOnly: boolean; path?: string }

export function cookiesFor(jar: StoredCookie[], host: string, opts: MatchOpts, now = nowSec()): StoredCookie[] {
  host = host.toLowerCase();
  return jar
    .filter((c) => !isExpired(c, now))
    .filter((c) => (c.hostOnly ? c.domain === host : domainMatches(host, c.domain)))
    .filter((c) => !c.secure || opts.secure)
    .filter((c) => opts.includeHttpOnly || !c.httpOnly)
    .filter((c) => (opts.path === undefined ? true : pathMatches(opts.path, c.path)))
    // RFC 6265 §5.4: longer paths first
    .sort((a, b) => b.path.length - a.path.length);
}

export function serializeCookieHeader(cs: StoredCookie[]): string {
  return cs.map((c) => (c.name ? `${c.name}=${c.value}` : c.value)).join('; ');
}

/** Convert to Playwright storageState cookie. */
export function toPlaywrightCookie(c: StoredCookie) {
  return {
    name: c.name, value: c.value,
    domain: c.hostOnly ? c.domain : '.' + c.domain,
    path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
  };
}

export function fromPlaywrightCookie(p: {
  name: string; value: string; domain: string; path?: string; expires?: number;
  httpOnly?: boolean; secure?: boolean; sameSite?: string;
}): StoredCookie {
  const dotted = p.domain.startsWith('.');
  const ss = (p.sameSite ?? 'Lax').toLowerCase();
  return {
    name: p.name, value: p.value,
    domain: p.domain.replace(/^\./, '').toLowerCase(), hostOnly: !dotted,
    path: p.path || '/', expires: p.expires === undefined ? -1 : Math.floor(p.expires),
    httpOnly: !!p.httpOnly, secure: !!p.secure,
    sameSite: ss === 'strict' ? 'Strict' : ss === 'none' ? 'None' : 'Lax',
  };
}

/** Convert a chrome.cookies.Cookie to our format (used for "clone current login"). */
export function fromChromeCookie(c: chrome.cookies.Cookie): StoredCookie {
  const ss = c.sameSite === 'strict' ? 'Strict' : c.sameSite === 'no_restriction' ? 'None' : 'Lax';
  return {
    name: c.name, value: c.value, domain: c.domain.replace(/^\./, '').toLowerCase(), hostOnly: c.hostOnly,
    path: c.path, expires: c.session || c.expirationDate === undefined ? -1 : Math.floor(c.expirationDate),
    secure: c.secure, httpOnly: c.httpOnly, sameSite: ss,
  };
}

/** Hosts where Chrome accepts and sends Secure cookies over plain http (potentially trustworthy). */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/** Would a Secure cookie be sent to this URL? */
export function isSecureContextUrl(url: URL): boolean {
  return url.protocol === 'https:' || url.protocol === 'wss:' || isLocalHost(url.hostname);
}
