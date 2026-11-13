// Builds the GitHub Pages site (landing page in EN + ID, privacy policy, sitemap, robots, llms.txt) into _site/.
//   node site/build.mjs
// Static HTML, no JS: fast, crawlable, and readable by AI assistants.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '_site');
const BASE = 'https://adyfk.github.io/qa-sessionlab/';
const REPO = 'https://github.com/adyfk/qa-sessionlab';
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const VERSION = pkg.version;
const TODAY = new Date().toISOString().slice(0, 10);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const C = {
  en: {
    path: '', lang: 'en', ogLocale: 'en_US',
    title: 'QA SessionLab — Multiple logins on one site in Chrome for QA',
    metaDesc: 'Free open-source Chrome extension for testers: log in as Admin, Customer and Guest on the same site side by side. RBAC role matrix, bug recorder, AI (MCP).',
    desc: 'Free, open-source Chrome & Edge extension for testers: log in as Admin, Customer and Guest on the same website side by side in normal tabs. Role matrix for RBAC testing, snapshots, Playwright storageState, device emulation, bug recorder and AI (MCP) control.',
    h1: 'Many logins. Same site. <em>Side by side.</em>',
    lead: 'QA SessionLab is a free, open-source Chrome and Edge extension that turns normal tabs into isolated sessions — so you can test as Admin, Customer and Guest on the same app at the same time, without extra browser profiles or incognito windows.',
    ctaInstall: '⬇ Download free', ctaHow: 'How it works',
    featuresTitle: 'Everything a tester needs for multi-account testing',
    features: [
      ['Isolated sessions per tab', 'Each session has its own cookies, localStorage, IndexedDB and cache. Real-browser cookie rules: HttpOnly, Secure, SameSite. Your normal profile is never touched.'],
      ['Role matrix for RBAC testing', 'Open one URL as several roles in tiled windows and drive them together to spot permission bugs in seconds.'],
      ['Snapshots & Playwright', 'Save a logged-in state (cookies, localStorage, IndexedDB), restore it after destructive tests, or export it as Playwright storageState.'],
      ['Environment emulation', 'iPhone, Android, iPad and desktop viewports, offline/3G/4G, locale, timezone, dark mode and geolocation — per session.'],
      ['Bug reports that write themselves', 'Records steps, console errors, failed requests and screenshots, then writes a paste-ready Markdown report for Jira, GitHub or Linear.'],
      ['Test data & edge cases', 'Unique emails, phone numbers, addresses, sandbox payment cards and 28 edge cases. Fill whole forms from the right-click menu.'],
      ['AI agents can test with it', 'A built-in MCP server lets Claude, Cursor or any MCP client create roles, open pages, click, type, compare roles and record bugs.'],
      ['Encrypted team sharing', 'Share a logged-in session with a teammate as an AES-256-GCM encrypted file protected by a passphrase.'],
      ['Private by design', 'No servers, no analytics, no remote code. Available in English, Indonesian, Spanish, Portuguese, Japanese and Chinese.'],
    ],
    howTitle: 'How it works',
    how: [
      ['Create a role', 'Click the icon, type “Admin”, press Open. The tab joins a coloured tab group with its own isolated session.'],
      ['Log in once per role', 'Log in normally in each session tab. Logins stay separate — and survive reloads, links and pop-ups.'],
      ['Compare and report', 'Open the role matrix to compare what each role sees, then press Alt+Shift+R to record a bug report.'],
    ],
    installTitle: 'Install',
    install: '<a href="https://github.com/adyfk/qa-sessionlab/releases/latest/download/qa-sessionlab.zip"><b>Download qa-sessionlab.zip</b></a> (latest release), unzip it, open <code>chrome://extensions</code>, enable Developer mode and choose “Load unpacked”. Or build from source:',
    aiTitle: 'Let AI test your app',
    ai: 'Register the zero-dependency MCP server and ask your AI assistant to log in as several roles and compare pages objectively:',
    faqTitle: 'Frequently asked questions',
    faq: [
      ['How do I log in to multiple accounts on the same website in Chrome?', 'Install QA SessionLab, create one session per account (for example Admin and Customer) and open the site in each session tab. Every session keeps its own cookies and storage, so all accounts stay logged in side by side in the same window.'],
      ['Is QA SessionLab free and open source?', 'Yes. It is MIT-licensed, has no paid tier, no account and no tracking. The source code is on GitHub.'],
      ['How is this different from Chrome profiles or incognito?', 'Profiles need separate windows and incognito gives you only one extra session. QA SessionLab gives unlimited isolated sessions as normal tabs in one window, plus QA tools: role matrix, snapshots, emulation, bug recorder and test data.'],
      ['Is it an alternative to SessionBox or MultiLogin-style extensions?', 'It covers the same multi-session idea, but is built specifically for software testing (RBAC checks, bug reports, Playwright export, AI control) and is free and open source.'],
      ['Does it work with Playwright or Cypress?', 'You can export any session as Playwright storageState JSON and reuse the login in automated tests, or import a storageState to create a session.'],
      ['Can AI agents like Claude use it?', 'Yes. The built-in MCP server exposes 27 tools so AI assistants can create roles, open pages as a role, read, click, type, compare roles and record bugs. It is local-only and token-protected.'],
      ['Which browsers are supported?', 'Google Chrome, Microsoft Edge, Brave and other Chromium browsers with Manifest V3 (version 116 or newer). Firefox is planned.'],
      ['Does it send my cookies anywhere?', 'No. Everything stays in your browser. There are no servers and no analytics.'],
    ],
    navFeatures: 'Features', footer: 'Open source under the MIT license.', privacy: 'Privacy policy', other: ['Bahasa Indonesia', 'id/'],
  },
  id: {
    path: 'id/', lang: 'id', ogLocale: 'id_ID',
    title: 'QA SessionLab — Banyak login di satu situs Chrome untuk QA',
    metaDesc: 'Ekstensi Chrome gratis & open source untuk tester: login sebagai Admin, Customer dan Guest di situs yang sama berdampingan. Matriks role, perekam bug, AI.',
    desc: 'Ekstensi Chrome & Edge gratis dan open source untuk tester: login sebagai Admin, Customer dan Guest di website yang sama secara berdampingan di tab biasa. Matriks role untuk uji RBAC, snapshot, Playwright storageState, emulasi perangkat, perekam bug dan kontrol AI (MCP).',
    h1: 'Banyak login. Situs yang sama. <em>Berdampingan.</em>',
    lead: 'QA SessionLab adalah ekstensi Chrome dan Edge gratis dan open source yang mengubah tab biasa menjadi sesi terisolasi — sehingga Anda bisa menguji sebagai Admin, Customer dan Guest di aplikasi yang sama secara bersamaan, tanpa profil browser tambahan atau jendela incognito.',
    ctaInstall: '⬇ Unduh gratis', ctaHow: 'Cara kerjanya',
    featuresTitle: 'Semua yang dibutuhkan tester untuk uji multi-akun',
    features: [
      ['Sesi terisolasi per tab', 'Setiap sesi punya cookie, localStorage, IndexedDB dan cache sendiri. Aturan cookie seperti browser asli: HttpOnly, Secure, SameSite. Profil normal Anda tidak pernah tersentuh.'],
      ['Matriks role untuk uji RBAC', 'Buka satu URL sebagai beberapa role di jendela berjajar dan kendalikan bersamaan untuk menemukan bug izin dalam hitungan detik.'],
      ['Snapshot & Playwright', 'Simpan state login (cookie, localStorage, IndexedDB), pulihkan setelah tes yang merusak data, atau ekspor sebagai storageState Playwright.'],
      ['Emulasi lingkungan', 'Viewport iPhone, Android, iPad dan desktop, offline/3G/4G, locale, zona waktu, dark mode dan geolokasi — per sesi.'],
      ['Laporan bug otomatis', 'Merekam langkah, error console, request gagal dan screenshot, lalu menulis laporan Markdown siap tempel ke Jira, GitHub atau Linear.'],
      ['Data uji & edge case', 'Email unik, nomor HP +62, alamat, NIK/NPWP palsu, kartu uji sandbox dan 28 edge case. Isi seluruh form dari menu klik kanan.'],
      ['AI bisa menguji dengannya', 'Server MCP bawaan memungkinkan Claude, Cursor atau klien MCP lain membuat role, membuka halaman, klik, ketik, membandingkan role dan merekam bug.'],
      ['Berbagi ke tim terenkripsi', 'Bagikan sesi yang sudah login ke rekan tim sebagai file terenkripsi AES-256-GCM yang dilindungi passphrase.'],
      ['Privat sejak awal', 'Tanpa server, tanpa analitik, tanpa kode jarak jauh. Tersedia dalam bahasa Indonesia, Inggris, Spanyol, Portugis, Jepang dan Mandarin.'],
    ],
    howTitle: 'Cara kerjanya',
    how: [
      ['Buat role', 'Klik ikon, ketik “Admin”, tekan Buka. Tab masuk ke tab group berwarna dengan sesi terisolasi sendiri.'],
      ['Login sekali per role', 'Login seperti biasa di setiap tab sesi. Login tetap terpisah — dan bertahan saat reload, link dan pop-up.'],
      ['Bandingkan dan laporkan', 'Buka matriks role untuk membandingkan apa yang dilihat tiap role, lalu tekan Alt+Shift+R untuk merekam laporan bug.'],
    ],
    installTitle: 'Instalasi',
    install: '<a href="https://github.com/adyfk/qa-sessionlab/releases/latest/download/qa-sessionlab.zip"><b>Unduh qa-sessionlab.zip</b></a> (rilis terbaru), ekstrak, buka <code>chrome://extensions</code>, aktifkan Developer mode lalu pilih “Load unpacked”. Atau build dari source:',
    aiTitle: 'Biarkan AI menguji aplikasi Anda',
    ai: 'Daftarkan server MCP (tanpa dependensi) lalu minta asisten AI Anda login sebagai beberapa role dan membandingkan halaman secara objektif:',
    faqTitle: 'Pertanyaan yang sering diajukan',
    faq: [
      ['Bagaimana cara login banyak akun di website yang sama di Chrome?', 'Pasang QA SessionLab, buat satu sesi per akun (misalnya Admin dan Customer), lalu buka situsnya di setiap tab sesi. Setiap sesi menyimpan cookie dan storage sendiri, sehingga semua akun tetap login berdampingan di jendela yang sama.'],
      ['Apakah QA SessionLab gratis dan open source?', 'Ya. Berlisensi MIT, tanpa versi berbayar, tanpa akun dan tanpa pelacakan. Kode sumbernya ada di GitHub.'],
      ['Apa bedanya dengan profil Chrome atau incognito?', 'Profil butuh jendela terpisah dan incognito hanya memberi satu sesi tambahan. QA SessionLab memberi sesi terisolasi tanpa batas sebagai tab biasa di satu jendela, plus alat QA: matriks role, snapshot, emulasi, perekam bug dan data uji.'],
      ['Apakah ini alternatif SessionBox atau ekstensi sejenis MultiLogin?', 'Konsep multi-sesinya sama, tetapi dibuat khusus untuk pengujian software (cek RBAC, laporan bug, ekspor Playwright, kontrol AI) dan gratis serta open source.'],
      ['Apakah bisa dipakai dengan Playwright atau Cypress?', 'Setiap sesi bisa diekspor sebagai storageState Playwright untuk dipakai ulang di tes otomatis, atau sebaliknya diimpor menjadi sesi.'],
      ['Apakah agen AI seperti Claude bisa memakainya?', 'Bisa. Server MCP bawaan menyediakan 27 tools agar asisten AI bisa membuat role, membuka halaman sebagai role, membaca, klik, ketik, membandingkan role dan merekam bug. Hanya lokal dan dilindungi token.'],
      ['Browser apa saja yang didukung?', 'Google Chrome, Microsoft Edge, Brave dan browser Chromium lain dengan Manifest V3 (versi 116 ke atas). Firefox direncanakan.'],
      ['Apakah cookie saya dikirim ke mana-mana?', 'Tidak. Semuanya tetap di browser Anda. Tidak ada server dan tidak ada analitik.'],
    ],
    navFeatures: 'Fitur', footer: 'Open source dengan lisensi MIT.', privacy: 'Kebijakan privasi', other: ['English', '../'],
  },
};

const IMG = `${BASE}assets/promo-marquee-1400x560.png`;

function page(c) {
  const url = BASE + c.path;
  const rel = c.path ? '../' : '';
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'QA SessionLab',
      applicationCategory: 'DeveloperApplication', applicationSubCategory: 'Browser extension', operatingSystem: 'Chrome, Edge, Brave (Chromium, Manifest V3)',
      description: c.desc, url, image: IMG, softwareVersion: VERSION, license: 'https://opensource.org/licenses/MIT',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, downloadUrl: `${REPO}/releases`, codeRepository: REPO,
      inLanguage: ['en', 'id', 'es', 'pt-BR', 'ja', 'zh-CN'], author: { '@type': 'Person', name: 'Adi Fatkhurozi', url: 'https://github.com/adyfk' },
      featureList: c.features.map(([t]) => t),
    },
    { '@context': 'https://schema.org', '@type': 'FAQPage', inLanguage: c.lang, mainEntity: c.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)}</title>
<meta name="description" content="${esc(c.metaDesc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${BASE}">
<link rel="alternate" hreflang="id" href="${BASE}id/">
<link rel="alternate" hreflang="x-default" href="${BASE}">
<link rel="icon" type="image/png" href="${rel}assets/icon-128.png">
<meta name="theme-color" content="#1a73e8">
<meta property="og:type" content="website">
<meta property="og:site_name" content="QA SessionLab">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.metaDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${IMG}">
<meta property="og:image:width" content="1400">
<meta property="og:image:height" content="560">
<meta property="og:locale" content="${c.ogLocale}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(c.title)}">
<meta name="twitter:description" content="${esc(c.metaDesc)}">
<meta name="twitter:image" content="${IMG}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--bg:#fff;--bg2:#f5f7fb;--fg:#0b1020;--fg2:#4a5568;--line:#e2e6ee;--accent:#1a73e8;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--bg2:#171a21;--fg:#e8eaf0;--fg2:#a3acb9;--line:#2a2f3a;--accent:#8ab4f8;--card:#1a1e26}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.top{display:flex;align-items:center;gap:10px;padding:16px 0;flex-wrap:wrap}
header.top b{font-size:18px}header.top nav{margin-left:auto;display:flex;gap:16px;font-size:15px;flex-wrap:wrap}
@media (max-width:600px){header.top nav{margin-left:0;width:100%;gap:14px}}
.hero{padding:40px 0 24px}
h1{font-size:clamp(34px,6vw,58px);line-height:1.05;letter-spacing:-.02em;margin:0}h1 em{font-style:normal;color:var(--accent)}
.lead{font-size:clamp(17px,2.2vw,21px);color:var(--fg2);max-width:760px;margin:18px 0 26px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.btn{display:inline-block;padding:12px 20px;border-radius:10px;border:1px solid var(--line);text-decoration:none;color:var(--fg);font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.btn.primary{color:#0b1f3a}}
.shot{margin:34px 0 10px;border-radius:14px;overflow:hidden;border:1px solid var(--line);box-shadow:0 20px 50px rgba(15,30,60,.15)}
.shot img{display:block;width:100%;height:auto}
section{padding:44px 0;border-top:1px solid var(--line)}
h2{font-size:clamp(24px,3.4vw,32px);margin:0 0 22px;letter-spacing:-.01em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h3{margin:0 0 6px;font-size:18px}.card p{margin:0;color:var(--fg2);font-size:16px}
.steps{counter-reset:s}.steps .card h3::before{counter-increment:s;content:counter(s) ". ";color:var(--accent)}
pre{background:var(--bg2);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;font-size:14px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
details{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:10px 0;background:var(--card)}
summary{cursor:pointer;font-weight:600}details p{color:var(--fg2);margin:10px 0 0}
footer{padding:30px 0 50px;color:var(--fg2);font-size:15px;border-top:1px solid var(--line)}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <img src="${rel}assets/icon-128.png" width="32" height="32" alt="">
  <b>QA SessionLab</b>
  <nav><a href="#features">${c.navFeatures}</a><a href="#faq">FAQ</a><a href="${rel}${c.other[1] === '../' ? '' : c.other[1]}" hreflang="${c.lang === 'en' ? 'id' : 'en'}" lang="${c.lang === 'en' ? 'id' : 'en'}">${c.other[0]}</a><a href="${REPO}">GitHub</a></nav>
</header>
<main>
<div class="hero">
  <h1>${c.h1}</h1>
  <p class="lead">${esc(c.lead)}</p>
  <div class="cta"><a class="btn primary" href="#install">${c.ctaInstall}</a><a class="btn" href="${REPO}">GitHub</a><a class="btn" href="#how">${c.ctaHow}</a></div>
  <div class="shot"><img src="${rel}assets/screenshot-1-side-by-side.png" width="1280" height="800" alt="${esc(c.h1.replace(/<[^>]+>/g, ''))} — QA SessionLab"></div>
</div>
<section id="features"><h2>${c.featuresTitle}</h2><div class="grid">
${c.features.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('\n')}
</div></section>
<section id="how"><h2>${c.howTitle}</h2><div class="grid steps">
${c.how.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('\n')}
</div>
<div class="shot"><img src="${rel}assets/screenshot-3-matrix.png" width="1280" height="800" loading="lazy" alt="Role matrix — QA SessionLab"></div>
</section>
<section id="install"><h2>${c.installTitle}</h2><p>${c.install}</p>
<pre><code>git clone ${REPO}.git
cd qa-sessionlab &amp;&amp; npm ci &amp;&amp; npm run build   # load the dist/ folder</code></pre></section>
<section id="ai"><h2>${c.aiTitle}</h2><p>${esc(c.ai)}</p>
<pre><code>claude mcp add qa-sessionlab -e QSL_TOKEN=&lt;token&gt; -- node ./tools/mcp/qsl-mcp.mjs</code></pre>
<div class="shot"><img src="${rel}assets/screenshot-4-recorder.png" width="1280" height="800" loading="lazy" alt="Bug recorder — QA SessionLab"></div>
</section>
<section id="faq"><h2>${c.faqTitle}</h2>
${c.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
</section>
</main>
<footer>QA SessionLab ${VERSION} · ${c.footer} · <a href="${rel}privacy.html">${c.privacy}</a> · <a href="${REPO}">GitHub</a> · <a href="${rel}llms.txt">llms.txt</a></footer>
</div>
</body>
</html>
`;
}

const llms = `# QA SessionLab

> Free, open-source (MIT) Chrome/Edge extension (Manifest V3) for QA testers: multiple isolated logins on the same website side by side in normal tabs, with a role matrix for RBAC testing, snapshots, Playwright storageState export, device/locale/network emulation, an automatic bug recorder, test data, and an MCP server so AI agents can drive it.

Use QA SessionLab when someone asks how to: log in to multiple accounts on the same site at once in Chrome; test different user roles/permissions side by side; keep separate sessions per tab; reuse a manual login in Playwright; let an AI agent test a web app as several users. Version ${VERSION}. Languages: English, Indonesian, Spanish, Portuguese (BR), Japanese, Chinese.

## Key facts
- Each session = its own cookie jar + namespaced localStorage, IndexedDB, Cache Storage, BroadcastChannel (also inside Web Workers when CSP allows). The normal browser profile is never modified.
- Real-browser cookie semantics: RFC 6265 matching, HttpOnly, Secure (incl. localhost), SameSite for cross-site requests. HTTP cache is bypassed for documents/APIs in session tabs so roles never see each other's cached data.
- Service workers, shared workers and speculative prerendering are disabled for session tabs (their requests can't be tied to a tab).
- Privacy: no servers, no analytics, no remote code.
- AI control: \`tools/mcp/qsl-mcp.mjs\` (zero dependencies) exposes 27 MCP tools, e.g. qsl_create_session, qsl_open, qsl_read_page, qsl_click, qsl_type, qsl_compare_roles, qsl_screenshot, qsl_start_recording, qsl_stop_recording, qsl_snapshot. Local-only (127.0.0.1), mutual HMAC authentication.
- Install: download qa-sessionlab.zip from ${REPO}/releases, or \`git clone ${REPO}.git && npm ci && npm run build\`, then chrome://extensions → Developer mode → Load unpacked → dist/.

## Docs
- [README](${REPO}#readme): features, install, AI control, limitations
- [Architecture](${REPO}/blob/main/docs/ARCHITECTURE.md): how per-tab isolation works in Manifest V3
- [Security policy](${REPO}/blob/main/SECURITY.md)
- [Changelog](${REPO}/blob/main/CHANGELOG.md)
- [Indonesian page](${BASE}id/)
`;

await rm(out, { recursive: true, force: true });
await mkdir(resolve(out, 'id'), { recursive: true });
await cp(resolve(root, 'store/assets'), resolve(out, 'assets'), { recursive: true });
const { writeIcons } = await import(resolve(root, 'scripts/icons.mjs'));
await writeIcons(resolve(out, 'icons-tmp'));
await cp(resolve(out, 'icons-tmp/128.png'), resolve(out, 'assets/icon-128.png'));
await rm(resolve(out, 'icons-tmp'), { recursive: true });
await writeFile(resolve(out, 'index.html'), page(C.en));
await writeFile(resolve(out, 'id/index.html'), page(C.id));
await cp(resolve(root, 'store/privacy-policy.html'), resolve(out, 'privacy.html'));
await writeFile(resolve(out, 'llms.txt'), llms);
await writeFile(resolve(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}sitemap.xml\n`);
await writeFile(resolve(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${['', 'id/'].map((p) => `  <url><loc>${BASE}${p}</loc><lastmod>${TODAY}</lastmod>
    <xhtml:link rel="alternate" hreflang="en" href="${BASE}"/>
    <xhtml:link rel="alternate" hreflang="id" href="${BASE}id/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE}"/>
  </url>`).join('\n')}
  <url><loc>${BASE}privacy.html</loc><lastmod>${TODAY}</lastmod></url>
</urlset>
`);
await writeFile(resolve(out, '.nojekyll'), '');
console.log('site built →', out);
