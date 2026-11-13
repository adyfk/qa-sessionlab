# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-14

First public release.

### Isolation
- Isolated sessions per tab: own cookie jar plus namespaced localStorage, IndexedDB, Cache Storage and BroadcastChannel (also inside Web Workers when the site's CSP allows it).
- Real-browser cookie rules: RFC 6265 matching, HttpOnly, Secure (incl. localhost), SameSite for cross-site requests.
- HTTP cache isolation between sessions; service workers, shared workers and speculative prerendering disabled for session tabs.
- Login-redirect race detected and repaired before the stale page renders.

### QA tools
- Role matrix (open one URL as several roles, drive them together).
- Snapshots (cookies, localStorage, IndexedDB), Playwright storageState export/import, clone login from the normal profile, backup/restore.
- Encrypted team sharing (AES-256-GCM, passphrase).
- Device, network, locale, timezone, colour-scheme and geolocation emulation per session.
- Bug recorder with paste-ready Markdown reports; test-data generator and 28 edge cases; form filling.

### AI & platform
- MCP server for AI agents (27 tools), local-only with mutual HMAC authentication.
- Six languages: English, Bahasa Indonesia, Español, Português (BR), 日本語, 简体中文.
- Onboarding page, keyboard shortcuts, context menus.
