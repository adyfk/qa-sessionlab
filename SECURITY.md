# Security policy

QA SessionLab handles login cookies, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private
[“Report a vulnerability”](https://github.com/adyfk/qa-sessionlab/security/advisories/new) form instead.
Include the version, browser, steps to reproduce and the impact you expect. You will get an answer within 7 days.

## In scope

- One session's cookies, storage or cached responses becoming visible to another session or to the normal browser profile
- A web page gaining access to privileged extension commands, cookies or recordings
- The AI-control bridge (`tools/mcp/qsl-mcp.mjs` ↔ extension) accepting an unauthenticated peer or leaking its token
- Weaknesses in the encrypted session-share format

## Design notes

- No servers, no analytics, no remote code. Nothing leaves the browser unless the user exports it.
- Content scripts can only use the narrow `cs:*` message channel; everything else is reserved for extension pages.
- The AI bridge listens on `127.0.0.1` only, accepts only extension origins and uses mutual HMAC-SHA256 challenge-response; the token never crosses the socket.
- Shared sessions use AES-256-GCM with a PBKDF2-SHA256 (310 000 iterations) key derived from a passphrase.

Known, documented limitations (not vulnerabilities) are listed in the README.
