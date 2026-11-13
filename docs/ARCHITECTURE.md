# Architecture

QA SessionLab isolates *sessions* (roles) inside normal tabs of one Chrome profile. Manifest V3 gives no
per-tab cookie store, so isolation is built from several cooperating layers. This document explains each one
and why it exists.

```
┌──────────── service worker (src/background) ─────────────┐
│ state.ts      sessions, cookie jars, tab→session map     │
│ rules.ts      per-tab declarativeNetRequest rules         │
│ cookieSync.ts Set-Cookie capture, real-jar rollback,      │
│               fast rule updates, login-redirect self-heal │
│ swGuard.ts    service-worker removal/blocking             │
│ csp.ts        per-document worker isolation decision      │
│ sessions.ts   binding, snapshots (incl. IndexedDB), share │
│ debuggerHub   device/network emulation + bug recorder     │
│ agentBridge   AI control over WebSocket (MCP bridge)      │
└────────────┬───────────────────────────────▲─────────────┘
   DNR rules │ (Cookie header, Server-Timing) │ cs:* messages
┌────────────▼────────────┐   ┌──────────────┴───────────┐
│ content/main.ts (MAIN)  │◀─▶│ content/isolated.ts       │
│ shim.ts at doc_start    │   │ bridge, title, recorder,  │
│ cookie/storage/IDB/…    │   │ form fill                 │
└─────────────────────────┘   └───────────────────────────┘
```

## 1. Network: per-tab rules

For every tab bound to a session, `rules.ts` installs DNR *session rules* scoped with `tabIds`:

| priority | condition | action |
|---|---|---|
| 1 | any request of the tab | remove the browser's `Cookie` header |
| 1 | documents / XHR of the tab | `Cache-Control: no-cache` on the request, `no-store` on the response, strip `Speculation-Rules` |
| 10+n | domains with `Domain=` cookies (unseen subdomains) | set `Cookie` to the matching domain cookies |
| 510+n / 1001 | same, but cross-site (`domainType: thirdParty`, not top-level) | only `SameSite=None` cookies |
| 1000 | exact hosts with cookies (`\|https://host^`) | set `Cookie` with full RFC 6265 matching |

A higher-priority `set` wins over a lower-priority `remove`, so the real profile's cookies never leak into a
session. Every rule also **appends** a `Server-Timing: qsl;dur=<priority>;desc="<payload>"` response header (see 3).

## 2. Capturing cookies

- `webRequest.onHeadersReceived` (with `extraHeaders`) parses `Set-Cookie` of session tabs into the session jar.
- The same cookie also lands in the browser's real jar; `cookieSync.ts` rolls it back (removing it and restoring
  any previous default-profile value). Event order between `webRequest` and `cookies.onChanged` isn't
  guaranteed, so both sides are reconciled through short histories and per-value claims.
- **Fast path:** rules are rebuilt from memory inside the listener, before persistence, to shrink the window in
  which the next request can still carry stale cookies.
- **Self-heal:** MV3 can't block requests. A redirect immediately following a login almost always leaves with the
  old cookies. `onSendHeaders` compares what was sent with the jar *as of that moment*; if they differ, the tab is
  re-navigated to `url#__qsl_heal` (a different URL cancels the pending stale navigation; the shim strips the
  marker before app code runs). If the committed page is that URL already, `reload()` is used.

## 3. Page isolation without a race

Injecting a script after commit is too late — inline scripts may already have used `localStorage`.
Instead, the static MAIN-world content script `main.ts` reads the session payload **synchronously** from
`performance.getEntriesByType('navigation')[0].serverTiming` at `document_start` and runs `shim.ts`:

- `document.cookie` and `cookieStore` → the session jar (non-HttpOnly cookies; writes go back via the bridge)
- `localStorage` → keys namespaced `__qsl:<sid>:`
- IndexedDB, Cache Storage, BroadcastChannel → names prefixed
- dedicated workers → started through a `blob:` bootstrap that applies the same namespacing inside the worker,
  only when the page CSP allows `blob:` workers (`csp.ts`)
- service workers / shared workers / speculation rules → disabled
- timezone, locale and geolocation emulation (CDP refuses those overrides for extension clients)

## 4. Service workers

Requests made by a service worker carry no tab id, so per-tab rules can't apply. When a session tab would be
controlled by one, `swGuard.ts` removes the origin's registrations (`browsingData`), adds the origin to a list
and a global dynamic rule marks its documents with `Server-Timing: qslnosw` so `main.ts` blocks re-registration
in every tab. Users can allow an origin again in Settings.

## 5. Security boundaries

- Content scripts may only send `cs:*` messages; privileged commands are accepted from extension pages only.
- The bridge event from page to isolated world can't create HttpOnly cookies.
- AI control: `127.0.0.1` only, extension origins only, mutual HMAC-SHA256 challenge-response.
- Shared sessions: AES-256-GCM, key from PBKDF2-SHA256 (310 000 iterations).

## 6. Testing strategy

Unit tests cover the pure logic. Everything else is tested end to end in a real Chromium with the built
extension and a tiny local HTTP server — including attempts to break isolation (`e2e/audit.mjs`). See
[CONTRIBUTING.md](../CONTRIBUTING.md).
