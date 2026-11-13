# QA SessionLab

**Banyak login di situs yang sama, berdampingan, di tab biasa — dibuat untuk QA.**

Ekstensi Chrome / Edge (Manifest V3) yang mengubah tab menjadi sesi terisolasi, sehingga Anda bisa menjadi Admin,
Customer dan Guest di aplikasi yang sama secara bersamaan — plus matriks role, snapshot state, emulasi
perangkat/locale/jaringan, perekam bug yang menuliskan laporan untuk Anda, alat data uji, dan bridge MCP agar agen AI
bisa menguji dengannya.

[English](README.md) · [Arsitektur](docs/ARCHITECTURE.md) · [Kontribusi](CONTRIBUTING.md) · [Keamanan](SECURITY.md)

## Fitur

| | |
|---|---|
| **Sesi terisolasi per tab** | Setiap sesi punya cookie jar sendiri + `localStorage`, IndexedDB, Cache Storage dan BroadcastChannel ter-namespace — juga di dalam Web Worker bila CSP situs mengizinkan. Profil normal Anda tidak pernah tersentuh. Tab diberi tab group berwarna, badge, dan prefix judul `[Role]`. |
| **Aturan cookie seperti browser asli** | Pencocokan RFC 6265, `HttpOnly`, `Secure` (termasuk `localhost`), dan `SameSite` untuk request lintas situs. |
| **Pewarisan** | `target=_blank`, klik-tengah dan `window.open` tetap di sesi; tab baru biasa tetap di profil normal. |
| **Matriks role** | Buka satu URL sebagai beberapa role di jendela berjajar dan kendalikan bersamaan — cara tercepat menguji RBAC. |
| **Snapshot** | Simpan state login (cookie, localStorage, IndexedDB) lalu pulihkan setelah tes yang merusak data. |
| **Berbagi & otomasi** | Berbagi sesi terenkripsi ke tim (AES-256-GCM + passphrase), export/import `storageState` Playwright, salin login profil normal ke role, backup/restore lengkap. |
| **Emulasi lingkungan** | Viewport iPhone/Android/iPad/desktop, offline/3G/4G, locale + `Accept-Language`, zona waktu (termasuk aritmetika `Date`), dark mode, reduced motion, geolokasi — per sesi. |
| **Perekam bug** | Merekam langkah (password dimasking), error console, request gagal dan screenshot, lalu menulis laporan Markdown siap tempel. |
| **Data uji** | Email unik, nomor HP +62, alamat, NIK/NPWP palsu, kartu uji sandbox, 28 edge case; isi seluruh form dari menu klik kanan. |
| **Kontrol AI (MCP)** | 27 tools untuk Claude Code, Claude Desktop, Cursor atau klien MCP lain. |
| **6 bahasa** | English, Bahasa Indonesia, Español, Português (BR), 日本語, 简体中文 — mengikuti browser atau dipilih di Pengaturan. |
| **Privat** | Tanpa server, tanpa analitik, tanpa kode jarak jauh. |

## Instalasi

```bash
git clone https://github.com/adyfk/qa-sessionlab.git
cd qa-sessionlab
npm ci
npm run build
```

Buka `chrome://extensions`, aktifkan **Developer mode**, klik **Load unpacked**, pilih folder `dist/`.
Atau unduh `qa-sessionlab.zip` dari [Releases](https://github.com/adyfk/qa-sessionlab/releases).

## Cara pakai singkat

1. Buka situs yang diuji → klik ikon → ketik nama role (mis. *Admin*) → **+ Buka**. Login di tab itu.
2. Ulangi untuk *Customer*, *Guest*… (atau **Panel → Role cepat → + Set RBAC**).
3. **Panel → Matriks** → pilih role → **Buka berdampingan**.
4. Temukan bug? `Alt+Shift+R`, reproduksi, `Alt+Shift+R` lagi → **Salin laporan**.

## Kontrol oleh AI (MCP)

1. **Panel → Pengaturan → Kontrol AI** → salin **Token** (fitur ini aktif secara default, dilindungi token).
2. Daftarkan server MCP (tanpa dependensi, Node ≥ 18):
   ```bash
   claude mcp add qa-sessionlab -e QSL_TOKEN=<token> -- node /path/ke/qa-sessionlab/tools/mcp/qsl-mcp.mjs
   ```
3. Status berubah menjadi **● terhubung**.

Contoh perintah ke AI: *"Buat role Admin dan Customer, login masing-masing di http://localhost:3000, lalu bandingkan
halaman /orders untuk kedua role dan laporkan perbedaan izinnya."*

## Cara kerja isolasi & batasan

Lihat [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) untuk detail teknis dan [README.md](README.md#known-limitations)
untuk daftar batasan yang diketahui.

## Menerbitkan ke Chrome Web Store / Edge Add-ons

1. `npm run package` → `qa-sessionlab.zip`.
2. Daftar akun developer: Chrome Web Store (sekali bayar US$5) dan/atau Edge Add-ons (gratis).
3. Upload ZIP, salin teks dari `store/LISTING.md` (ringkasan, deskripsi, justifikasi izin, pengungkapan data).
4. Gambar ada di `store/assets/`; kebijakan privasi otomatis terbit di https://adyfk.github.io/qa-sessionlab/privacy.html.
5. Karena memakai izin `debugger` dan `<all_urls>`, review pertama biasanya beberapa hari.

## Pengembangan

```bash
npm run dev     # watch build
npm run check   # typecheck + unit test + build + semua suite e2e (yang dijalankan CI)
```

## Lisensi

[MIT](LICENSE)
