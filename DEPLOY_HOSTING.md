# Panduan Upload & Hosting MKC CBT

Aplikasi **MKC CBT** menggunakan arsitektur **Standalone Full-Stack Node.js + SQLite (WAL Mode)** sehingga dapat diunggah langsung ke berbagai layanan hosting tanpa bergantung pada layanan cloud eksternal.

## 1. Persiapan Build Produksi
Jalankan perintah berikut secara lokal atau di server hosting:

```bash
npm install
npm run build:all
```

Perintah tersebut menghasilkan:
- `dist/` : berkas frontend statis hasil build Vite
- `dist-server/server.mjs` : server Express produksi yang telah di-bundle

## 2. Konfigurasi Variabel Lingkungan (`.env`)
Salin `.env.example` menjadi `.env` di server hosting dan atur nilai rahasia Anda:

```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=ganti_dengan_string_acak_minimal_32_karakter
API_KEY_ENC_SECRET=ganti_dengan_kunci_enkripsi_aes256_anda
ADMIN_PASSCODE=opsional_passcode_admin_utama
```

## 3. Menjalankan di Hosting

### A. VPS / Dedicated Server (PM2 + Nginx)
```bash
npm install --omit=dev
pm2 start dist-server/server.mjs --name mkc-cbt
pm2 save
```
Arahkan reverse proxy Nginx ke `http://127.0.0.1:3000`.

### B. cPanel (Setup Node.js App / Phusion Passenger)
1. Unggah seluruh berkas (`dist/`, `dist-server/`, `package.json`, `.env`).
2. Di **cPanel → Setup Node.js App**, pilih Node.js v20+ dan atur:
   - **Application startup file**: `dist-server/server.mjs`
   - **Environment variables**: tambahkan `NODE_ENV=production`, `SESSION_SECRET`, `API_KEY_ENC_SECRET`.
3. Klik **Run NPM Install** lalu **Restart**.

## 4. Folder Data Persisten
Pastikan folder berikut memiliki izin tulis (*read/write*) dan dibackup berkala:
- `data/mkc_cbt.db` (Database SQLite mode WAL untuk ribuan koneksi paralel)
- `uploads/` (Gambar soal, gambar hasil import Word, dan gambar slider login)
