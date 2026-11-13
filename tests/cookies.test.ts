import { describe, expect, it } from 'vitest';
import { cookiesFor, domainMatches, parseSetCookie, pathMatches, serializeCookieHeader, upsertCookie, fromPlaywrightCookie, toPlaywrightCookie } from '../src/shared/cookies';

const NOW = 1_700_000_000;

describe('parseSetCookie', () => {
  it('parses host-only cookie with default path', () => {
    const c = parseSetCookie('sid=abc; HttpOnly; Secure; SameSite=Strict', 'https://app.example.com/a/b/login', NOW)!;
    expect(c).toMatchObject({ name: 'sid', value: 'abc', domain: 'app.example.com', hostOnly: true, path: '/a/b', httpOnly: true, secure: true, sameSite: 'Strict', expires: -1 });
  });
  it('accepts Domain= of a parent and strips the dot', () => {
    const c = parseSetCookie('t=1; Domain=.Example.com; Path=/', 'https://app.example.com/', NOW)!;
    expect(c).toMatchObject({ domain: 'example.com', hostOnly: false, path: '/' });
  });
  it('rejects foreign domains', () => {
    expect(parseSetCookie('t=1; Domain=evil.com', 'https://app.example.com/', NOW)).toBeNull();
  });
  it('Max-Age wins over Expires and <=0 expires immediately', () => {
    expect(parseSetCookie('a=1; Max-Age=60; Expires=Wed, 21 Oct 2015 07:28:00 GMT', 'https://x.com/', NOW)!.expires).toBe(NOW + 60);
    expect(parseSetCookie('a=1; Max-Age=0', 'https://x.com/', NOW)!.expires).toBe(0);
  });
  it('enforces __Host- / __Secure- prefixes', () => {
    expect(parseSetCookie('__Host-a=1; Path=/', 'https://x.com/', NOW)).toBeNull();
    expect(parseSetCookie('__Host-a=1; Secure; Path=/', 'https://x.com/', NOW)).not.toBeNull();
    expect(parseSetCookie('__Secure-a=1', 'https://x.com/', NOW)).toBeNull();
  });
  it('keeps "=" inside values', () => {
    expect(parseSetCookie('jwt=a.b=c==; Path=/', 'https://x.com/', NOW)!.value).toBe('a.b=c==');
  });
});

describe('matching', () => {
  it('domain and path match per RFC 6265', () => {
    expect(domainMatches('a.example.com', 'example.com')).toBe(true);
    expect(domainMatches('badexample.com', 'example.com')).toBe(false);
    expect(pathMatches('/docs/x', '/docs')).toBe(true);
    expect(pathMatches('/docsx', '/docs')).toBe(false);
  });
  it('builds header with host-only, domain, secure and expiry rules', () => {
    let jar = [] as ReturnType<typeof parseSetCookie>[] & any[];
    for (const [h, u] of [
      ['host=1', 'https://app.example.com/'],
      ['dom=2; Domain=example.com; Path=/', 'https://app.example.com/'],
      ['sec=3; Secure; Path=/', 'https://app.example.com/'],
      ['old=4; Max-Age=0', 'https://app.example.com/'],
      ['deep=5; Path=/admin', 'https://app.example.com/'],
    ]) jar = upsertCookie(jar, parseSetCookie(h, u, NOW)!, NOW);
    const https = cookiesFor(jar, 'app.example.com', { secure: true, includeHttpOnly: true, path: '/admin/x' }, NOW);
    expect(serializeCookieHeader(https)).toBe('deep=5; host=1; dom=2; sec=3');
    const sub = cookiesFor(jar, 'api.example.com', { secure: false, includeHttpOnly: true }, NOW);
    expect(serializeCookieHeader(sub)).toBe('dom=2');
  });
  it('upsert replaces same key and deletes on expiry', () => {
    let jar = upsertCookie([], parseSetCookie('a=1; Path=/', 'https://x.com/', NOW)!, NOW);
    jar = upsertCookie(jar, parseSetCookie('a=2; Path=/', 'https://x.com/', NOW)!, NOW);
    expect(jar).toHaveLength(1);
    expect(jar[0].value).toBe('2');
    jar = upsertCookie(jar, parseSetCookie('a=; Path=/; Max-Age=0', 'https://x.com/', NOW)!, NOW);
    expect(jar).toHaveLength(0);
  });
  it('round-trips Playwright storageState cookies', () => {
    const c = parseSetCookie('d=1; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=None', 'https://a.example.com/', NOW)!;
    expect(fromPlaywrightCookie(toPlaywrightCookie(c))).toEqual(c);
  });
});

import { workerModeFor } from '../src/shared/csp';
describe('worker isolation vs CSP', () => {
  it('no CSP allows both', () => expect(workerModeFor([])).toEqual({ classic: true, module: true }));
  it("worker-src 'self' (SvelteKit app) disables wrapping", () => expect(workerModeFor(["default-src 'self'; worker-src 'self'; script-src 'self'"])).toEqual({ classic: false, module: false }));
  it('worker-src blob: allows classic only when script-src lacks blob:', () => expect(workerModeFor(["worker-src 'self' blob:; script-src 'self'"])).toEqual({ classic: true, module: false }));
  it('falls back through child-src/script-src/default-src', () => expect(workerModeFor(["default-src 'self' blob:"])).toEqual({ classic: true, module: true }));
  it('every policy must allow', () => expect(workerModeFor(['worker-src blob:', "worker-src 'self'"]).classic).toBe(false));
});

import { isSecureContextUrl } from '../src/shared/cookies';
describe('secure context hosts', () => {
  it('treats https and loopback hosts as secure', () => {
    for (const u of ['https://a.com/', 'http://localhost:3000/', 'http://app.localhost/', 'http://127.0.0.1:8080/', 'http://[::1]:3000/']) expect(isSecureContextUrl(new URL(u))).toBe(true);
    expect(isSecureContextUrl(new URL('http://example.com/'))).toBe(false);
  });
});
