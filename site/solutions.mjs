// Solution pages: one page per real testing problem people search for (Google) or ask AI assistants.
// Each page = direct answer + numbered steps (HowTo) + why + FAQ. Keep claims factual.

export const SOLUTIONS = [
  {
    slug: 'multiple-accounts-same-site',
    en: {
      title: 'How to log in to multiple accounts on the same website in Chrome',
      metaDesc: 'Stay logged in to several accounts of the same site at once in Chrome, side by side in normal tabs — no extra profiles or incognito. Step-by-step for testers.',
      answer: 'Install QA SessionLab (free, open source), create one session per account and open the site in each session tab. Each session has its own cookies, localStorage and IndexedDB, so every account stays logged in at the same time in one window.',
      steps: [
        ['Install the extension', 'Download qa-sessionlab.zip, unzip it, open chrome://extensions, enable Developer mode and choose “Load unpacked”.'],
        ['Create a session per account', 'Click the QA SessionLab icon, type a name such as “Admin” and press Open. Repeat for “Customer”, “Guest” and so on.'],
        ['Log in once in each tab', 'Log in normally in every session tab. Cookies and storage are separated per session, so logging in one tab never logs out another.'],
        ['Keep working side by side', 'Links, pop-ups and window.open from a session tab stay in that session; coloured tab groups and a [Role] title prefix show which account each tab uses.'],
      ],
      why: [
        'Chrome profiles need a separate window per account; incognito only gives you one extra session.',
        'Websites store the login in cookies and browser storage that every tab normally shares — so the last login wins.',
        'QA SessionLab replaces the Cookie header per tab and namespaces page storage, so each tab behaves like a separate browser.',
      ],
      faq: [
        ['Does it work with Google, Microsoft or SSO logins?', 'Yes for normal cookie-based logins, including OAuth redirects, because every request of the tab carries that session’s cookies. HTTP Basic Auth is the exception: the browser shares it between tabs.'],
        ['Is my normal browsing affected?', 'No. Your normal profile’s cookies are never sent from session tabs and session logins never leak back into it.'],
      ],
    },
    id: {
      title: 'Cara login banyak akun di website yang sama di Chrome',
      metaDesc: 'Tetap login ke beberapa akun di situs yang sama sekaligus di Chrome, berdampingan di tab biasa — tanpa profil tambahan atau incognito. Panduan untuk tester.',
      answer: 'Pasang QA SessionLab (gratis, open source), buat satu sesi per akun lalu buka situsnya di setiap tab sesi. Setiap sesi punya cookie, localStorage dan IndexedDB sendiri, sehingga semua akun tetap login bersamaan di satu jendela.',
      steps: [
        ['Pasang ekstensinya', 'Unduh qa-sessionlab.zip, ekstrak, buka chrome://extensions, aktifkan Developer mode lalu pilih “Load unpacked”.'],
        ['Buat satu sesi per akun', 'Klik ikon QA SessionLab, ketik nama seperti “Admin” lalu tekan Buka. Ulangi untuk “Customer”, “Guest” dan seterusnya.'],
        ['Login sekali di setiap tab', 'Login seperti biasa di setiap tab sesi. Cookie dan storage dipisah per sesi, jadi login di satu tab tidak pernah membuat tab lain logout.'],
        ['Kerja berdampingan', 'Link, pop-up dan window.open dari tab sesi tetap di sesi itu; tab group berwarna dan prefix judul [Role] menunjukkan akun yang dipakai tiap tab.'],
      ],
      why: [
        'Profil Chrome butuh jendela terpisah per akun; incognito hanya memberi satu sesi tambahan.',
        'Website menyimpan login di cookie dan storage browser yang biasanya dipakai bersama semua tab — sehingga login terakhir yang menang.',
        'QA SessionLab mengganti header Cookie per tab dan memisahkan storage halaman, sehingga setiap tab berperilaku seperti browser terpisah.',
      ],
      faq: [
        ['Apakah bisa dengan login Google, Microsoft atau SSO?', 'Bisa untuk login berbasis cookie, termasuk redirect OAuth, karena setiap request tab membawa cookie sesinya. Pengecualiannya HTTP Basic Auth yang dipakai bersama oleh browser.'],
        ['Apakah browsing biasa saya terpengaruh?', 'Tidak. Cookie profil normal tidak pernah dikirim dari tab sesi dan login sesi tidak pernah bocor ke profil normal.'],
      ],
    },
  },
  {
    slug: 'test-user-roles-permissions-rbac',
    en: {
      title: 'How to test user roles and permissions (RBAC) side by side',
      metaDesc: 'Check what Admin, Staff, Customer and Guest can see and do on the same page at once. A fast, repeatable way to test role-based access control in the browser.',
      answer: 'Create one QA SessionLab session per role, log in once in each, then open the Role matrix: it opens the same URL as every role in tiled windows and lets you navigate, reload or go back in all of them together, so permission differences are visible immediately.',
      steps: [
        ['Create the roles', 'In the side panel use “+ RBAC set” (Admin, Staff, Customer, Guest) or add your own role names.'],
        ['Log in once per role', 'Open your app in each session tab and log in with that role’s test account. Use Snapshots to save the logged-in state.'],
        ['Open the Role matrix', 'Pick the roles, enter the URL to check and choose “Open side by side”. Each role opens in its own tiled window.'],
        ['Drive all roles together', 'Navigate, reload or go back in every role at once and compare buttons, menus, data and error pages.'],
        ['Record what is wrong', 'Press Alt+Shift+R in the tab that misbehaves; QA SessionLab writes a Markdown bug report with steps, console errors and failed requests.'],
      ],
      why: [
        'Permission bugs hide in differences between roles: a button that should not be there, data from another tenant, a 403 that should be a 200.',
        'Logging out and in again between roles is slow and makes it easy to miss differences.',
        'Seeing all roles at the same moment turns RBAC testing into a visual comparison.',
      ],
      faq: [
        ['Can an AI agent run the comparison?', 'Yes. The qsl_compare_roles MCP tool opens a URL as several sessions and returns what each role sees, so an AI assistant can report permission differences objectively.'],
        ['How do I reset data after destructive tests?', 'Save a Snapshot (cookies, localStorage, IndexedDB) before the test and restore it afterwards.'],
      ],
    },
    id: {
      title: 'Cara menguji role dan izin user (RBAC) secara berdampingan',
      metaDesc: 'Cek apa yang bisa dilihat dan dilakukan Admin, Staff, Customer dan Guest di halaman yang sama sekaligus. Cara cepat dan berulang untuk menguji RBAC di browser.',
      answer: 'Buat satu sesi QA SessionLab per role, login sekali di masing-masing, lalu buka Matriks role: URL yang sama dibuka sebagai setiap role di jendela berjajar dan semuanya bisa dinavigasi, dimuat ulang atau kembali bersamaan, sehingga perbedaan izin langsung terlihat.',
      steps: [
        ['Buat role-nya', 'Di panel samping pakai “+ Set RBAC” (Admin, Staff, Customer, Guest) atau tambahkan nama role sendiri.'],
        ['Login sekali per role', 'Buka aplikasi di setiap tab sesi dan login dengan akun uji role itu. Pakai Snapshot untuk menyimpan state login.'],
        ['Buka Matriks role', 'Pilih role, isi URL yang dicek lalu pilih “Buka berdampingan”. Setiap role terbuka di jendelanya sendiri.'],
        ['Kendalikan semua role bersamaan', 'Navigasi, muat ulang atau kembali di semua role sekaligus lalu bandingkan tombol, menu, data dan halaman error.'],
        ['Rekam yang salah', 'Tekan Alt+Shift+R di tab yang bermasalah; QA SessionLab menulis laporan bug Markdown berisi langkah, error console dan request gagal.'],
      ],
      why: [
        'Bug izin bersembunyi di perbedaan antar role: tombol yang seharusnya tidak ada, data tenant lain, 403 yang seharusnya 200.',
        'Logout dan login ulang antar role lambat dan membuat perbedaan mudah terlewat.',
        'Melihat semua role di saat yang sama mengubah uji RBAC menjadi perbandingan visual.',
      ],
      faq: [
        ['Apakah agen AI bisa menjalankan perbandingannya?', 'Bisa. Tool MCP qsl_compare_roles membuka URL sebagai beberapa sesi dan mengembalikan apa yang dilihat tiap role, sehingga asisten AI bisa melaporkan perbedaan izin secara objektif.'],
        ['Bagaimana mengembalikan data setelah tes yang merusak?', 'Simpan Snapshot (cookie, localStorage, IndexedDB) sebelum tes lalu pulihkan sesudahnya.'],
      ],
    },
  },
  {
    slug: 'playwright-storagestate-from-manual-login',
    en: {
      title: 'Reuse a manual browser login in Playwright (storageState)',
      metaDesc: 'Log in once by hand — even with MFA or SSO — and export that session as Playwright storageState JSON for automated tests, or import one into a tab.',
      answer: 'Log in manually in a QA SessionLab session (MFA, SSO and captchas included), then use “⤓ Playwright storageState” to export its cookies and localStorage as a storageState JSON file that Playwright can load with browser.newContext({ storageState }).',
      steps: [
        ['Create a session and log in by hand', 'Open your app in a new session tab and complete the login, including any MFA or SSO step.'],
        ['Export storageState', 'In the session’s details choose “⤓ Playwright storageState” (or “Copy JSON”).'],
        ['Load it in Playwright', 'Use the file with browser.newContext({ storageState: \'admin.storageState.json\' }) or test.use({ storageState }).'],
        ['Go the other way', 'Use “⤒ Import” in the Sessions panel to turn any storageState JSON into a live session you can inspect by hand.'],
      ],
      why: [
        'Scripting MFA or third-party SSO in tests is fragile; a captured state is reliable.',
        'Exported state contains only that role’s cookies and storage, not your personal browser profile.',
      ],
      faq: [
        ['Does it include HttpOnly cookies?', 'Yes. QA SessionLab captures Set-Cookie headers itself, so HttpOnly session cookies are included in the export.'],
        ['Is it safe to commit the file?', 'No — it contains live login cookies. Keep it out of version control or use short-lived test accounts.'],
      ],
    },
    id: {
      title: 'Pakai ulang login manual browser di Playwright (storageState)',
      metaDesc: 'Login sekali secara manual — termasuk MFA atau SSO — lalu ekspor sesinya sebagai storageState Playwright untuk tes otomatis. Atau impor storageState ke tab.',
      answer: 'Login manual di sesi QA SessionLab (MFA, SSO dan captcha termasuk), lalu pakai “⤓ storageState Playwright” untuk mengekspor cookie dan localStorage-nya sebagai file storageState yang bisa dimuat Playwright lewat browser.newContext({ storageState }).',
      steps: [
        ['Buat sesi dan login manual', 'Buka aplikasi di tab sesi baru dan selesaikan login, termasuk langkah MFA atau SSO.'],
        ['Ekspor storageState', 'Di detail sesi pilih “⤓ storageState Playwright” (atau “Salin JSON”).'],
        ['Muat di Playwright', 'Pakai file itu dengan browser.newContext({ storageState: \'admin.storageState.json\' }) atau test.use({ storageState }).'],
        ['Arah sebaliknya', 'Pakai “⤒ Impor” di panel Sesi untuk mengubah storageState apa pun menjadi sesi hidup yang bisa diperiksa manual.'],
      ],
      why: [
        'Membuat skrip MFA atau SSO pihak ketiga di tes itu rapuh; state yang ditangkap lebih andal.',
        'State yang diekspor hanya berisi cookie dan storage role itu, bukan profil browser pribadi Anda.',
      ],
      faq: [
        ['Apakah cookie HttpOnly ikut?', 'Ya. QA SessionLab menangkap header Set-Cookie sendiri, jadi cookie sesi HttpOnly ikut terekspor.'],
        ['Amankah file itu di-commit?', 'Tidak — isinya cookie login aktif. Jangan masukkan ke version control atau pakai akun uji berumur pendek.'],
      ],
    },
  },
  {
    slug: 'ai-agent-browser-testing-mcp',
    en: {
      title: 'Let an AI agent test your web app as multiple users (MCP)',
      metaDesc: 'Give Claude, Cursor or any MCP client real browser sessions per role: create users, open pages, click, type, compare roles, get bug reports.',
      answer: 'QA SessionLab ships a zero-dependency MCP server. Register it in your AI client with the token from Settings → AI control, and the assistant gets 27 tools to create isolated sessions, open pages as a role, read/click/type, compare roles and record bug reports in your real Chrome.',
      steps: [
        ['Copy the token', 'Open the QA SessionLab side panel → Settings → AI control and copy the token.'],
        ['Register the MCP server', 'claude mcp add qa-sessionlab -e QSL_TOKEN=<token> -- node /path/to/qa-sessionlab/tools/mcp/qsl-mcp.mjs (other clients: run the same command with QSL_TOKEN).'],
        ['Ask for a role test', '“Create Admin and Customer, log in to http://localhost:3000 as each, compare /orders and report permission differences.”'],
        ['Review the evidence', 'The assistant returns what each role saw, screenshots and Markdown bug reports with console errors and failed requests.'],
      ],
      why: [
        'Generic browser automation gives an AI one identity; role testing needs several isolated logins at once.',
        'qsl_compare_roles returns structured, comparable results instead of screenshots to interpret.',
        'The bridge listens on 127.0.0.1 only and uses mutual HMAC authentication; the token never crosses the socket.',
      ],
      faq: [
        ['Which AI clients work?', 'Any MCP client: Claude Code, Claude Desktop, Cursor and others that can start a stdio MCP server.'],
        ['Does the AI see my normal browsing?', 'Only what you ask it to open through the tools; your normal profile is not part of any session.'],
      ],
    },
    id: {
      title: 'Biarkan agen AI menguji aplikasi web Anda sebagai banyak user (MCP)',
      metaDesc: 'Beri Claude, Cursor atau klien MCP lain sesi browser per role: buat user, buka halaman, klik, ketik, bandingkan role dan dapat laporan bug.',
      answer: 'QA SessionLab menyertakan server MCP tanpa dependensi. Daftarkan di klien AI Anda dengan token dari Pengaturan → Kontrol AI, dan asisten mendapat 27 tools untuk membuat sesi terisolasi, membuka halaman sebagai role, membaca/klik/ketik, membandingkan role dan merekam laporan bug di Chrome Anda.',
      steps: [
        ['Salin token', 'Buka panel samping QA SessionLab → Pengaturan → Kontrol AI lalu salin token.'],
        ['Daftarkan server MCP', 'claude mcp add qa-sessionlab -e QSL_TOKEN=<token> -- node /path/ke/qa-sessionlab/tools/mcp/qsl-mcp.mjs (klien lain: jalankan perintah yang sama dengan QSL_TOKEN).'],
        ['Minta uji role', '“Buat Admin dan Customer, login masing-masing di http://localhost:3000, bandingkan /orders dan laporkan perbedaan izinnya.”'],
        ['Tinjau buktinya', 'Asisten mengembalikan apa yang dilihat tiap role, screenshot dan laporan bug Markdown berisi error console dan request gagal.'],
      ],
      why: [
        'Otomasi browser biasa memberi AI satu identitas; uji role butuh beberapa login terisolasi sekaligus.',
        'qsl_compare_roles mengembalikan hasil terstruktur yang bisa dibandingkan, bukan screenshot yang harus ditafsirkan.',
        'Bridge hanya mendengarkan 127.0.0.1 dan memakai autentikasi HMAC dua arah; token tidak pernah lewat socket.',
      ],
      faq: [
        ['Klien AI apa saja yang bisa?', 'Semua klien MCP: Claude Code, Claude Desktop, Cursor dan lainnya yang bisa menjalankan server MCP stdio.'],
        ['Apakah AI melihat browsing biasa saya?', 'Hanya yang Anda minta dibuka lewat tools; profil normal Anda bukan bagian dari sesi mana pun.'],
      ],
    },
  },
  {
    slug: 'bug-report-console-network-chrome',
    en: {
      title: 'Write complete bug reports from Chrome automatically',
      metaDesc: 'Record steps, console errors, failed network requests and screenshots while you reproduce a bug, then paste a ready Markdown report into Jira, GitHub or Linear.',
      answer: 'Press Alt+Shift+R in QA SessionLab, reproduce the bug, and press it again. You get a Markdown report with environment, numbered steps (passwords masked), console errors, failed or 4xx/5xx requests and screenshots, ready to paste into Jira, GitHub or Linear.',
      steps: [
        ['Start recording', 'Press Alt+Shift+R (or “● Record bug” in the popup) on the tab with the problem.'],
        ['Reproduce the bug', 'Click and type as usual. Add notes or extra screenshots from the side panel if needed.'],
        ['Stop and review', 'Press Alt+Shift+R again. Edit the title, check the steps, errors and failed requests.'],
        ['Share', 'Copy the Markdown report, or download it with the JSON data and screenshots.'],
      ],
      why: [
        'Developers fix bugs faster with exact steps, the environment and the first console error.',
        'Writing that by hand takes minutes per bug and details get lost.',
      ],
      faq: [
        ['Are passwords recorded?', 'No. Password, OTP and card fields are masked by default.'],
        ['Does it work in normal tabs too?', 'Yes, the recorder works in any tab, isolated session or not.'],
      ],
    },
    id: {
      title: 'Tulis laporan bug lengkap dari Chrome secara otomatis',
      metaDesc: 'Rekam langkah, error console, request gagal dan screenshot saat mereproduksi bug, lalu tempel laporan Markdown ke Jira, GitHub atau Linear.',
      answer: 'Tekan Alt+Shift+R di QA SessionLab, reproduksi bug-nya, lalu tekan lagi. Anda mendapat laporan Markdown berisi lingkungan, langkah bernomor (password dimasking), error console, request gagal atau 4xx/5xx dan screenshot, siap tempel ke Jira, GitHub atau Linear.',
      steps: [
        ['Mulai rekam', 'Tekan Alt+Shift+R (atau “● Rekam bug” di popup) di tab yang bermasalah.'],
        ['Reproduksi bug', 'Klik dan ketik seperti biasa. Tambah catatan atau screenshot dari panel samping bila perlu.'],
        ['Stop dan tinjau', 'Tekan Alt+Shift+R lagi. Ubah judul, cek langkah, error dan request gagal.'],
        ['Bagikan', 'Salin laporan Markdown, atau unduh bersama data JSON dan screenshot.'],
      ],
      why: [
        'Developer memperbaiki bug lebih cepat dengan langkah persis, lingkungan dan error console pertama.',
        'Menulisnya manual butuh beberapa menit per bug dan detail mudah hilang.',
      ],
      faq: [
        ['Apakah password terekam?', 'Tidak. Kolom password, OTP dan kartu dimasking secara default.'],
        ['Apakah bisa di tab biasa juga?', 'Bisa, perekam bekerja di tab mana pun, sesi terisolasi atau bukan.'],
      ],
    },
  },
  {
    slug: 'test-different-devices-locales-network',
    en: {
      title: 'Test one web app as different devices, locales and networks at once',
      metaDesc: 'Give each test session its own device viewport, language, timezone, dark mode, geolocation or 3G/offline network — and compare them side by side in Chrome.',
      answer: 'In QA SessionLab every session can carry an environment preset: iPhone/Android/iPad/desktop viewport, offline/3G/4G throttling, locale and Accept-Language, timezone (including JavaScript Date math), dark mode, reduced motion and geolocation. Open the same page in several sessions to compare them.',
      steps: [
        ['Open a session’s details', 'Side panel → Sessions → expand a session → Environment emulation.'],
        ['Pick the environment', 'Choose device, network, locale, timezone, colour scheme and geolocation.'],
        ['Open the page', 'The preset applies to that session’s tabs and survives reloads and navigation.'],
        ['Compare', 'Use the Role matrix to open the same URL in several differently-configured sessions.'],
      ],
      why: [
        'Timezone, locale and slow-network bugs rarely show on a developer’s machine.',
        'Per-session presets let you keep one “Jakarta, Bahasa, 3G” user next to a “New York, English, desktop” user.',
      ],
      faq: [
        ['Why does Chrome show “started debugging”?', 'Device size, network throttling and colour scheme use Chrome’s debugger API, which always shows that bar. Locale, timezone and geolocation are emulated in-page without it.'],
      ],
    },
    id: {
      title: 'Uji satu aplikasi web sebagai perangkat, bahasa dan jaringan berbeda sekaligus',
      metaDesc: 'Beri setiap sesi uji viewport perangkat, bahasa, zona waktu, dark mode, geolokasi atau jaringan 3G/offline sendiri — dan bandingkan berdampingan di Chrome.',
      answer: 'Di QA SessionLab setiap sesi bisa membawa preset lingkungan: viewport iPhone/Android/iPad/desktop, throttling offline/3G/4G, locale dan Accept-Language, zona waktu (termasuk perhitungan Date JavaScript), dark mode, reduced motion dan geolokasi. Buka halaman yang sama di beberapa sesi untuk membandingkannya.',
      steps: [
        ['Buka detail sesi', 'Panel samping → Sesi → buka sebuah sesi → Emulasi lingkungan.'],
        ['Pilih lingkungannya', 'Pilih perangkat, jaringan, locale, zona waktu, skema warna dan geolokasi.'],
        ['Buka halamannya', 'Preset berlaku untuk tab sesi itu dan bertahan saat reload dan navigasi.'],
        ['Bandingkan', 'Pakai Matriks role untuk membuka URL yang sama di beberapa sesi dengan konfigurasi berbeda.'],
      ],
      why: [
        'Bug zona waktu, bahasa dan jaringan lambat jarang muncul di mesin developer.',
        'Preset per sesi memungkinkan user “Jakarta, Bahasa, 3G” berdampingan dengan user “New York, English, desktop”.',
      ],
      faq: [
        ['Kenapa Chrome menampilkan “started debugging”?', 'Ukuran perangkat, throttling jaringan dan skema warna memakai API debugger Chrome yang selalu menampilkan bar itu. Locale, zona waktu dan geolokasi diemulasi di halaman tanpa bar tersebut.'],
      ],
    },
  },
];

/** Fair comparison of the usual ways to use several logins at once. */
export const COMPARE = {
  slug: 'compare',
  en: {
    title: 'Chrome profiles vs incognito vs separate browsers vs QA SessionLab',
    metaDesc: 'Honest comparison of ways to use several logins on one site for testing: Chrome profiles, incognito, separate browsers and QA SessionLab.',
    intro: 'There are several ways to be logged in as more than one user at the same time. Each has trade-offs; this table compares them for software testing.',
    cols: ['', 'Chrome profiles', 'Incognito', 'Separate browsers', 'QA SessionLab'],
    rows: [
      ['Sessions at once', 'Many (one window each)', '1 extra', '1 per browser', 'Unlimited, as tabs'],
      ['Same window', 'No', 'No', 'No', 'Yes'],
      ['Side-by-side role matrix', 'Manual', 'Manual', 'Manual', 'Built in'],
      ['Save / restore login state', 'No', 'No', 'No', 'Snapshots (cookies, storage, IndexedDB)'],
      ['Playwright storageState', 'No', 'No', 'No', 'Export & import'],
      ['Bug report with console & network', 'No', 'No', 'No', 'Built in'],
      ['AI agent control (MCP)', 'No', 'No', 'No', 'Built in, 27 tools'],
      ['Cost', 'Free', 'Free', 'Free', 'Free, open source (MIT)'],
    ],
    note: 'Limitations of QA SessionLab are listed openly in the README (for example HTTP Basic Auth is shared, and Firefox is not supported yet).',
  },
  id: {
    title: 'Profil Chrome vs incognito vs browser terpisah vs QA SessionLab',
    metaDesc: 'Perbandingan jujur cara memakai banyak login di satu situs untuk testing: profil Chrome, incognito, browser terpisah dan QA SessionLab.',
    intro: 'Ada beberapa cara untuk login sebagai lebih dari satu user sekaligus. Masing-masing punya kelebihan dan kekurangan; tabel ini membandingkannya untuk pengujian software.',
    cols: ['', 'Profil Chrome', 'Incognito', 'Browser terpisah', 'QA SessionLab'],
    rows: [
      ['Sesi sekaligus', 'Banyak (satu jendela per profil)', '1 tambahan', '1 per browser', 'Tanpa batas, sebagai tab'],
      ['Jendela yang sama', 'Tidak', 'Tidak', 'Tidak', 'Ya'],
      ['Matriks role berdampingan', 'Manual', 'Manual', 'Manual', 'Bawaan'],
      ['Simpan / pulihkan state login', 'Tidak', 'Tidak', 'Tidak', 'Snapshot (cookie, storage, IndexedDB)'],
      ['storageState Playwright', 'Tidak', 'Tidak', 'Tidak', 'Ekspor & impor'],
      ['Laporan bug dengan console & jaringan', 'Tidak', 'Tidak', 'Tidak', 'Bawaan'],
      ['Kontrol agen AI (MCP)', 'Tidak', 'Tidak', 'Tidak', 'Bawaan, 27 tools'],
      ['Biaya', 'Gratis', 'Gratis', 'Gratis', 'Gratis, open source (MIT)'],
    ],
    note: 'Batasan QA SessionLab dicantumkan terbuka di README (misalnya HTTP Basic Auth dipakai bersama, dan Firefox belum didukung).',
  },
};
