# Panduan Deploy & Hosting MKC CBT (Vercel + Neon PostgreSQL / VPS / cPanel)

Aplikasi **MKC CBT** mendukung dua mode database dan hosting secara otomatis:
1. **Cloud Serverless: Vercel (`vercel.com`) + Neon PostgreSQL (`neon.tech`)** — otomatis aktif saat variabel `DATABASE_URL` (atau `POSTGRES_URL`) diisi. Semua gambar (logo sekolah, gambar soal, gambar import Word `.docx`, dan slider login) disimpan langsung di tabel PostgreSQL `uploaded_files` sehingga tetap aman pada filesystem serverless Vercel yang *read-only*.
2. **Standalone Node.js: VPS / Dedicated / cPanel** — otomatis aktif memakai **SQLite (WAL Mode)** saat `DATABASE_URL` tidak diatur.

---

## Opsi 1: Deploy ke Vercel + Neon PostgreSQL (Direkomendasikan untuk Cloud Gratis/Skalabel)

### Langkah 1 — Buat Database di Neon (`neon.tech`)
1. Daftar atau masuk ke **[neon.tech](https://neon.tech)** dan buat proyek baru (misalnya `mkc-cbt`).
2. Di dashboard Neon, pilih **Connect** lalu aktifkan opsi **Connection pooling** (`-pooler`).
3. Salin URL koneksi PostgreSQL, contoh:
   ```text
   postgresql://neondb_owner:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

### Langkah 2 — Konfigurasi & Deploy di Vercel (`vercel.com`)
Proyek sudah dilengkapi **`vercel.json`** dan entrypoint serverless **`api/index.ts`**.
1. Push source code ke GitHub / GitLab / Bitbucket, lalu klik **Add New → Project** di **[vercel.com](https://vercel.com)** (atau gunakan Vercel CLI: `vercel --prod`).
2. Di **Project Settings → Environment Variables**, tambahkan variabel berikut untuk *Production* (dan *Preview* jika perlu):
   - `DATABASE_URL` = *(tempel connection string pooled dari Neon)*
   - `SESSION_SECRET` = *(isi string acak minimal 32 karakter)*
   - `API_KEY_ENC_SECRET` = *(isi string acak minimal 32 karakter)*
   - `ADMIN_PASSCODE` = *(opsional, password admin utama jika ingin di-override)*
3. Build settings otomatis terbaca dari `vercel.json`:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - Semua rute `/api/*` dan `/uploads/*` otomatis diarahkan ke `api/index.ts`.
4. Klik **Deploy**. Saat pertama kali diakses, tabel database PostgreSQL dan akun awal otomatis dibuat oleh aplikasi.

---

## Opsi 2: Deploy ke VPS / Dedicated Server / cPanel (Node.js + SQLite WAL)

### 1. Build Produksi
```bash
npm install
npm run build:all
```
Menghasilkan `dist/` (frontend Vite) dan `dist-server/server.mjs` (server Express).

### 2. Variabel Lingkungan (`.env`)
Salin `.env.example` menjadi `.env` di server (kosongkan `DATABASE_URL` agar memakai SQLite lokal, atau isi jika tetap ingin memakai Neon PostgreSQL):
```env
NODE_ENV=production
PORT=3000
DATABASE_URL=
SESSION_SECRET=ganti_dengan_string_acak_minimal_32_karakter
API_KEY_ENC_SECRET=ganti_dengan_kunci_enkripsi_aes256_anda
ADMIN_PASSCODE=
```

### 3. Menjalankan di VPS (PM2 + Nginx)
```bash
npm install --omit=dev
pm2 start dist-server/server.mjs --name mkc-cbt
pm2 save
```
Arahkan reverse proxy Nginx ke `http://127.0.0.1:3000`.

### 4. Menjalankan di cPanel (Setup Node.js App)
1. Unggah `dist/`, `dist-server/`, `package.json`, dan `.env`.
2. Di **cPanel → Setup Node.js App**, pilih Node.js v20+ dan atur **Application startup file** ke `dist-server/server.mjs`.
3. Klik **Run NPM Install** lalu **Restart**.
4. Pastikan folder `data/` dan `uploads/` memiliki izin baca/tulis (*read/write*).
