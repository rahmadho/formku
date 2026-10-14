# KONTRAK TEKNIS — FormKu (acuan WAJIB sub-agent)

> Semua sub-agent WAJIB mengikuti kontrak ini persis (nama tabel, kolom, tipe, endpoint).
> Jangan mengubah nama/tipe tanpa persetujuan. Ini mencegah bentrok saat kerja paralel.

---

## 1. Konfigurasi Proyek

- **Path**: `/opt/data/workspace/formku`
- **Port dev/produksi**: `3400`
- **Adapter**: `@sveltejs/adapter-node`
- **Style**: Svelte 5 runes (`$state`, `$derived`, `$props`), TypeScript
- **DB**: PostgreSQL, env `DATABASE_URL` (fallback var terpisah)
- **Env** (`.env`, JANGAN commit):
  ```
  PGHOST=postgresql_dev
  PGPORT=5432
  PGUSER=vibe
  PGPASSWORD=<lihat .env proyek undangan>
  PGDATABASE=vibe-undangan-nikah
  PGSSL=true
  PORT=3400
  OWNER_PASSWORD=<rahasia>
  ```
  > **PENTING**: user `vibe` TIDAK punya izin `CREATE DATABASE`. Jadi FormKu memakai
  > database yang sudah ada (`vibe-undangan-nikah`) dengan **schema terpisah `formku`**
  > → isolasi penuh dari tabel proyek undangan. Migrasi sudah diterapkan (9 tabel).
  > Jalankan ulang: `node scripts/db-setup.mjs`

---

## 2. Skema Database (schema `formku`)

```sql
CREATE SCHEMA IF NOT EXISTS formku;

CREATE TABLE formku.tenants (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_email TEXT,
  api_key_hash TEXT NOT NULL,       -- scrypt$salt$hash
  status TEXT NOT NULL DEFAULT 'active',   -- active|suspended
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE formku.forms (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES formku.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  mode TEXT NOT NULL DEFAULT 'form',      -- form|quiz|exam
  status TEXT NOT NULL DEFAULT 'draft',   -- draft|open|closed
  timer_seconds INT,                       -- NULL = tanpa timer
  timer_scope TEXT DEFAULT 'form',         -- form|section
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  bank_pick_count INT,                     -- NULL = pakai soal yang ada
  passing_grade INT,                       -- NULL = tak ada ambang
  show_score BOOLEAN NOT NULL DEFAULT true,
  require_token BOOLEAN NOT NULL DEFAULT false,
  access_token TEXT,                       -- token ujian (bila require_token)
  theme_json JSONB,                        -- {primary,font,...}
  thanks_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE formku.sections (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0,
  timer_seconds INT                          -- dipakai bila timer_scope='section'
);

CREATE TABLE formku.questions (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  section_id INT REFERENCES formku.sections(id) ON DELETE SET NULL,
  type TEXT NOT NULL,     -- short_text|long_text|radio|checkbox|dropdown|number|date|email|rating|scale|file
  label TEXT NOT NULL,
  help_text TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  points INT NOT NULL DEFAULT 0,
  correct_json JSONB,     -- kunci jawaban (mis. {"value":"A"} / {"values":["A","C"]})
  settings_json JSONB,    -- {min,max,options:[{label,value}],...}
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE formku.conditions (
  id SERIAL PRIMARY KEY,
  question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  depends_on_question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  operator TEXT NOT NULL,     -- equals|not_equals|contains|gt|lt
  compare_value TEXT,
  action TEXT NOT NULL DEFAULT 'show'   -- show|hide
);

CREATE TABLE formku.responses (
  id SERIAL PRIMARY KEY,
  form_id INT NOT NULL REFERENCES formku.forms(id) ON DELETE CASCADE,
  respondent_name TEXT,
  respondent_email TEXT,
  token_used TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  duration_seconds INT,
  score INT,
  max_score INT,
  status TEXT NOT NULL DEFAULT 'in_progress',  -- in_progress|submitted|locked
  ip TEXT
);

CREATE TABLE formku.answers (
  id SERIAL PRIMARY KEY,
  response_id INT NOT NULL REFERENCES formku.responses(id) ON DELETE CASCADE,
  question_id INT NOT NULL REFERENCES formku.questions(id) ON DELETE CASCADE,
  value_json JSONB,
  is_correct BOOLEAN,
  points_awarded INT DEFAULT 0
);

CREATE TABLE formku.bank_questions (
  id SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES formku.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  options_json JSONB,
  correct_json JSONB,
  points INT NOT NULL DEFAULT 1,
  tags TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE formku.audit_events (
  id SERIAL PRIMARY KEY,
  response_id INT NOT NULL REFERENCES formku.responses(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,   -- blur|paste|copy|focus_return
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 3. Modul & Pemilik File (hindari bentrok)

Setiap modul = satu sub-agent. **Jangan menyentuh file milik modul lain.**

| Modul | File utama | Isi |
|---|---|---|
| **M0 Fondasi** | `src/lib/server/db.ts`, `schema.ts`, `migrate.ts`, `auth.ts`, `hash.ts`, `svelte.config.js`, `.env` | Pool PG, migrasi, scrypt, helper auth |
| **M1 Tipe/Util** | `src/lib/types.ts`, `src/lib/util/*.ts` | Tipe bersama, validasi, sanitasi, shuffle |
| **M2 API Tenant/Owner** | `src/routes/api/owner/*`, `api/tenant/*` | CRUD tenant, auth |
| **M3 API Forms** | `src/routes/api/forms/*`, `api/sections/*`, `api/questions/*` | CRUD struktur form |
| **M4 API Publish/Isi** | `src/routes/api/public/*` | Ambil form publik, submit respons, skor, token, audit |
| **M5 UI Builder** | `src/routes/(app)/forms/[id]/*` | Antarmuka pembuat form |
| **M6 UI Isi Form** | `src/routes/f/[slug]/*` | Halaman responden (timer, acak, section) |
| **M7 UI Dasbor/Respons** | `src/routes/(app)/*` (dasbor, respons, bank soal) | Dasbor, tabel respons, ekspor CSV, bank soal, impor CSV |

> **M0 & M1 harus selesai lebih dulu** (dependensi). M2–M7 boleh paralel setelahnya.

---

## 4. Kontrak API (ringkas)

### Owner
- `POST /api/owner/tenants` body `{slug,name,owner_email}` → `{id,slug,api_key}` (api_key hanya sekali tampil)
- `GET /api/owner/tenants` (header `x-owner-password`)
- `DELETE /api/owner/tenants?id=N`

### Tenant (Creator) — header `x-tenant: <slug>` + `x-api-key: <key>`
- `GET/POST /api/forms` — daftar/buat form
- `GET/PUT/DELETE /api/forms/:id`
- `POST /api/forms/:id/publish` → set `status='open'`, hasilkan `slug`
- `GET/POST/PUT/DELETE /api/sections`, `/api/questions`
- `GET /api/forms/:id/responses` — daftar respons
- `GET /api/forms/:id/responses.csv` — ekspor
- `GET/POST /api/bank`, `POST /api/bank/import-csv`

### Publik (tanpa auth)
- `GET /api/public/forms/:slug` → struktur form (TANPA `correct_json` bila mode exam & belum submit)
- `POST /api/public/forms/:slug/start` body `{name,email,token?}` → `{response_id}`
- `POST /api/public/forms/:slug/submit` body `{response_id,answers[]}` → `{score,max_score,passed}`
- `POST /api/public/forms/:slug/event` body `{response_id,event_type}` → catat audit

**Aturan keamanan API:**
- `correct_json` **TIDAK BOLEH** terkirim ke klien sebelum submit (kebocoran kunci jawaban!).
- Semua input divalidasi & disanitasi server-side.
- Rate limit endpoint publik & login.
- Semua query tenant difilter `tenant_id`.

---

## 5. Aturan Umum untuk Sub-agent

1. **Batasan proyek**: HANYA di `/opt/data/workspace/formku`. JANGAN sentuh proyek lain (wedding-invitation, laundry-app, school-app, shiftsync).
2. **Selalu** `git status` sebelum & sesudah kerja.
3. JANGAN commit (agent utama yang commit).
4. JANGAN ubah `.env`.
5. Verifikasi sendiri: `npm run check` (0 error) + `npm run build` (sukses).
6. Laporkan: file yang diubah, bukti uji nyata (curl/DOM), hasil check & build.
7. Jangan pakai `&` di pesan (bash), jangan backtick dalam komentar SQL.
