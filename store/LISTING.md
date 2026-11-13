# Chrome Web Store / Edge Add-ons — listing kit

Copy-paste each block into the developer dashboard. Images are in `store/assets/` (regenerate with `node store/make-assets.mjs`).

## Name
QA SessionLab — Multi-Login Tabs for Testers

## Summary (max 132 chars)
Log in as Admin, Customer and Guest on the same site, side by side. Role matrix, bug recorder, device emulation & test data.

## Category
Developer Tools

## Languages
English (default) + localized name/description: id, es, pt_BR, ja, zh_CN (from `_locales/`)

## Description
QA SessionLab turns normal tabs into isolated sessions, so you can be logged in as many users on the same website at the same time — no extra browser profiles, no incognito juggling, no logging out and in again.

Built for QA engineers, testers and developers who check roles and permissions every day.

ISOLATED SESSIONS
• Each session has its own cookies, localStorage, IndexedDB and cache
• Coloured tab groups and [Role] tab titles: you always know who you are
• Links and pop-ups opened from a session stay in that session
• Your normal browsing profile is never touched
• Temporary sessions that clean themselves up

ROLE MATRIX
• Open one page as Admin, Customer and Guest in tiled windows
• Navigate, reload or go back in all roles at once
• Find permission (RBAC) bugs in seconds

SNAPSHOTS, SHARING & AUTOMATION
• Save a logged-in state (cookies, localStorage, IndexedDB) and restore it after destructive tests
• Share a session with a teammate as an encrypted file (AES-256-GCM + passphrase)
• Export / import Playwright storageState JSON
• Copy your normal login into any role with one click
• Backup and move all sessions to another computer

ENVIRONMENT EMULATION (per session)
• iPhone, Android, iPad and desktop viewports
• Offline, Slow 3G, Fast 3G/4G throttling
• Locale + Accept-Language, timezone, dark mode, reduced motion, geolocation

BUG RECORDER
• Records clicks and inputs (passwords masked), console errors, failed requests and screenshots
• Generates a ready-to-paste Markdown report for Jira, GitHub or Linear
• Alt+Shift+R to start/stop from any tab

TEST DATA
• Realistic identities with unique emails (qa+tag@your-domain), phone numbers and addresses
• Sandbox payment test cards
• 28 edge cases: boundary lengths, unicode, emoji, RTL, quotes, injection probes
• Fill a whole form from the right-click menu

AI AGENT CONTROL (token-protected, can be switched off in Settings)
• Built-in MCP bridge: let Claude, Cursor or any MCP client create roles, open pages, click, type, compare roles and record bugs
• Local only (127.0.0.1) and protected by a token

LANGUAGES
English, Bahasa Indonesia, Español, Português (Brasil), 日本語, 简体中文 — follows your browser or pick one in Settings.

PRIVACY
Everything stays in your browser. No account, no servers, no analytics, no tracking. QA SessionLab never sends your data anywhere.

## Single purpose (dashboard field)
Let testers use multiple isolated logins on the same website in normal browser tabs, and provide QA tooling (role comparison, bug recording, environment emulation, test data) for those sessions.

## Permission justifications (dashboard fields)
- **declarativeNetRequestWithHostAccess** — Replaces the Cookie header of requests made by a session's tabs with that session's own cookies; this is the core isolation feature.
- **webRequest** — Reads Set-Cookie response headers in session tabs so logins are stored in the session instead of the normal browser profile.
- **cookies** — Removes cookies that session logins would otherwise write into the normal profile, and (only when the user clicks "Clone login") copies the user's own cookies into a session.
- **scripting** — Injects the in-page isolation layer (cookie/localStorage/IndexedDB namespacing) and reads/writes session storage for snapshots.
- **webNavigation** — Detects new documents and pop-ups so they get the right session, and repairs the one redirect that races a login.
- **tabs / tabGroups** — Opens tabs in a session, shows each session as a coloured tab group, and restores sessions after a browser restart.
- **storage / unlimitedStorage** — Stores sessions, cookies, snapshots and bug recordings (with screenshots) locally.
- **debugger** — Only when the user enables device/network emulation or starts a bug recording on a tab: applies emulation and captures console errors and failed requests for the report.
- **browsingData** — Removes a site's service-worker registration when it would serve session tabs outside their isolated session (service-worker requests can't carry per-tab cookies). Only for sites where the user uses sessions.
- **alarms** — Keeps the optional, user-enabled local AI-control connection (127.0.0.1 only) alive.
- **contextMenus** — Right-click menu for test data, edge cases and "open link in session".
- **sidePanel** — The main QA SessionLab panel.
- **Host permission <all_urls>** — Testers work on arbitrary staging/production domains; isolation must apply to whatever site they test.

## Data usage disclosures (dashboard checkboxes)
- Collects: **none** sent to the developer. Website content/authentication data is processed **only locally** to provide the feature.
- Not sold, not used for unrelated purposes, not used for creditworthiness.

## Privacy policy URL
https://adyfk.github.io/qa-sessionlab/privacy.html (published by the `pages` workflow from `store/privacy-policy.html`).
