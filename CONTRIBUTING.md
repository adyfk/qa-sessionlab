# Contributing

Thanks for helping make QA SessionLab better! Bug reports, translations and pull requests are all welcome.

## Setup

```bash
npm ci
npx playwright install chromium   # end-to-end tests run a real Chromium with the extension loaded
npm run dev                       # watch build into dist/ — load it via chrome://extensions → Load unpacked
```

## Before you open a pull request

```bash
npm run check   # typecheck, unit tests, build and all end-to-end suites
```

CI runs the same command. Please add or update a test for behaviour you change — the e2e suites in `e2e/`
use a tiny local HTTP server, so they need no network access.

| Suite | What it proves |
|---|---|
| `npm test` | cookie jar (RFC 6265), CSP parsing, encryption, data generators, translation completeness |
| `e2e/run.mjs` | core isolation, snapshots, matrix, emulation, recorder, service workers |
| `e2e/audit.mjs` | attempts to break isolation and security (cache, forged cookies, privileged messages, shared workers) |
| `e2e/features.mjs` | SameSite, worker isolation, IndexedDB snapshots, encrypted sharing, localization |
| `e2e/mcp.mjs` | the AI-control (MCP) bridge end to end, including authentication |

## Translations

UI strings live in `src/shared/locales/`. `en.ts` is the source; other languages are partial dictionaries that
fall back to English. To add a language:

1. Copy `id.ts` to `<code>.ts`, translate the values (keep `{placeholders}` unchanged).
2. Register it in `src/shared/i18n.ts` (`LANGUAGES`, `DICTS`, `matchLanguage`).
3. Add `src/_locales/<code>/messages.json` for the store name/description.
4. `npm test` checks that every string is translated and placeholders match.

## Code style

- TypeScript, strict mode; Preact for the UI; no runtime dependencies.
- Functions injected into pages (`src/background/shim.ts`, `idb.ts`) must stay self-contained — they are serialized.
- Prefer small, well-named modules and explain *why* in comments when behaviour is non-obvious.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how isolation works.
