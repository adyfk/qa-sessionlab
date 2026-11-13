# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-11-14

### Added
- Six UI languages (English, Bahasa Indonesia, Español, Português (BR), 日本語, 简体中文), auto-detected or chosen in Settings; localized store name and description.
- Encrypted team sharing of a session (AES-256-GCM, passphrase).
- Snapshots now include IndexedDB (Dates and binary data preserved).
- Storage isolation inside Web Workers when the site's CSP allows it.
- SameSite enforcement for cross-site subresources and iframes.
- Speculative prefetch/prerender disabled in session tabs.

### Fixed
- False self-heal reloads on `127.0.0.1` / `*.localhost` with Secure cookies.
- "Log out / clear" now also wipes the session's IndexedDB and Cache Storage.

## [1.2.0]

### Security
- HTTP cache isolation between sessions (cached per-user responses could cross sessions).
- AI bridge: mutual HMAC challenge-response; the token never crosses the socket.
- Page scripts can no longer forge HttpOnly cookies; web-page contexts cannot call privileged commands.
- Shared workers blocked in session tabs.

## [1.1.0]
- AI control through a zero-dependency MCP server (`tools/mcp/qsl-mcp.mjs`).
- Service-worker guard: sites' service workers no longer serve session tabs outside their session.

## [1.0.0]
- Isolated per-tab sessions, role matrix, snapshots, Playwright storageState, environment emulation,
  bug recorder, test data, onboarding, backup/restore.
