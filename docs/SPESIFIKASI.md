# SPESIFIKASI SISTEM — "FormKu" (Form Builder + Quiz + Exam Platform)

> **Status**: DRAFT v1.0 — disusun sebagai acuan tunggal untuk implementasi.
> **Peran dokumen**: System Analyst + Quality Gate. Setiap sub-agent WAJIB mengikuti
> dokumen ini. Perubahan di luar dokumen harus disetujui (dicatat di §9).

---

## 1. Ringkasan Produk

**FormKu** = platform SaaS multi-tenant untuk membuat:
- **Form** — pendaftaran, survei, kontak (seperti Tally/Google Forms)
- **Quiz** — kuis interaktif dengan skor langsung
- **Exam** — ujian formal: timer, acak soal, acak jawaban, anti-kecurangan

Inspirasi: Tally.so (kemudahan), Google Forms (kesederhanaan), CBT sekolah (fitur ujian).

**Pengguna:**
1. **Owner** (super admin) — mengelola semua akun & paket
2. **Creator** (pembuat form) — membuat/mengelola form, lihat respons
3. **Responden** — mengisi form via link publik (tanpa akun)

---

## 2. Ruang Lingkup

### 2.1 In-Scope (WAJIB dibangun)
| # | Fitur | Catatan |
|---|---|---|
| F1 | Multi-tenant: owner + creator | Auth header-based (konsisten dgn proyek lain) |
| F2 | Builder form | Tambah/edit/hapus/urut pertanyaan |
| F3 | Tipe pertanyaan | short text, long text, pilihan ganda, checkbox, dropdown, angka, tanggal, email, rating, skala, file upload |
| F4 | **Section** | Form dibagi bagian; navigasi next/prev; section bisa punya deskripsi |
| F5 | **Timer** | Per-form ATAU per-section; auto-submit saat habis; sisa waktu tampil |
| F6 | **Acak soal** | Urutan soal diacak per responden (opsi: acak per-section) |
| F7 | **Acak jawaban** | Urutan opsi diacak per responden |
| F8 | **Mode quiz/exam** | Kunci jawaban, poin per soal, skor otomatis, passing grade |
| F9 | Publish & link publik | Slug unik; form draft/buka/tutup |
| F10 | Isi form (responden) | Tanpa login; validasi wajib; submit |
| F11 | Lihat respons | Tabel, detail, ekspor CSV |
| F12 | **Bank soal** | Simpan soal; tarik acak N soal ke sebuah ujian |
| F13 | **Token ujian** | Responden butuh token untuk mulai |
| F14 | **Anti-kecurangan** | Deteksi pindah tab, larang copy-paste, kunci setelah submit |
| F15 | **Impor soal massal** | Dari CSV |
| F16 | **Hasil & analitik** | Skor rata-rata, soal tersulit, waktu pengerjaan |
| F17 | **Logika kondisional** | Tampilkan soal B jika jawaban A |
| F18 | **Kalkulator** | Nilai otomatis dari jawaban |
| F19 | Desain | Tema warna/font, custom CSS, halaman terima kasih |
| F20 | Notifikasi | Email (opsional) + Webhook |

### 2.2 Out-of-Scope (fase lanjut)
- Pembayaran/checkout
- Multi-bahasa penuh (i18n)
- Aplikasi mobile native
- SSO/OAuth

---

## 3. Aktor & Hak Akses

| Aktor | Auth | Bisa |
|---|---|---|
| Owner | header `x-owner-password` | Semua akun, paket, aktif/nonaktif |
| Creator | header `x-tenant: <slug>` + `x-api-key` | CRUD form miliknya, lihat respons |
| Responden | — (link publik) | Isi form, lihat hasil (bila diizinkan) |

**Isolasi tenant = `tenant_id`.** Semua tabel bisnis punya `tenant_id`. Query WAJIB difilter `tenant_id` (defense-in-depth: validasi di server).

---

## 4. Arsitektur Teknis

| Lapisan | Teknologi | Alasan |
|---|---|---|
| Frontend | **SvelteKit + Svelte 5 (runes)** | Konsisten dgn proyek utama pengguna |
| Backend | SvelteKit server routes | Satu codebase, sederhana |
| DB | **PostgreSQL** | Kuat, sudah dipakai pengguna |
| ORM | SQL langsung (`pg`) | Ringan, transparan |
| Adapter | `@sveltejs/adapter-node` | Deploy fleksibel |
| Port | **3400** (hindari bentrok 3300) | — |

---

## 5. Model Data (Skema Inti)

```
tenants        (id, slug UNIQUE, name, owner_email, api_key_hash, status, created_at)
forms          (id, tenant_id, title, slug UNIQUE, description, mode[form|quiz|exam],
                status[draft|open|closed], timer_seconds, timer_scope[form|section],
                shuffle_questions, shuffle_options, passing_grade, show_score,
                theme_json, thanks_text, created_at)
sections       (id, form_id, title, description, sort, timer_seconds)
questions      (id, form_id, section_id, type, label, help_text, required,
                points, correct_json, settings_json, sort)
options        (id, question_id, label, value, sort)
conditions     (id, question_id, depends_on_question_id, operator, compare_value, action)
responses      (id, form_id, respondent_name, respondent_email, token_used,
                started_at, submitted_at, duration_seconds, score, status[in_progress|submitted|locked])
answers        (id, response_id, question_id, value_json, is_correct, points_awarded)
bank_questions (id, tenant_id, type, label, options_json, correct_json, points, tags)
audit_events   (id, response_id, event_type[blur|paste|copy], at)
```

**Aturan penting:**
- `slug` form & tenant unik global.
- `forms.timer_scope = 'section'` → pakai `sections.timer_seconds`.
- `status = 'locked'` → tidak bisa diubah setelah submit (anti-kecurangan).

---

## 6. Alur Utama (User Journey)

### 6.1 Creator membuat ujian
1. Login → dasbor → "Buat form baru" → pilih **Exam**
2. Setel: judul, timer (mis. 60 menit), acak soal ✅, acak jawaban ✅, passing grade 70
3. Tambah **Section** ("Bagian A: Pilihan Ganda") → tambah soal + kunci + poin
4. (Opsional) tarik soal dari **Bank Soal** atau **impor CSV**
5. **Publish** → dapat link publik + token

### 6.2 Responden mengerjakan
1. Buka link → masukkan nama + **token** (bila diaktifkan)
2. Soal tampil (acak bila disetel), timer berjalan
3. Navigasi antar-section; jawaban tersimpan
4. Timer habis **atau** submit → sistem hitung skor → tampil hasil (bila `show_score`)

### 6.3 Creator melihat hasil
Dasbor form → **Respons** → tabel + skor + waktu → **ekspor CSV**

---

## 7. Non-Functional Requirements

| Aspek | Target |
|---|---|
| Keamanan | Password/key **scrypt hash**; rate limit; whitelist enum; sanitasi input; SQL parameterized |
| Isolasi tenant | Setiap query wajib `tenant_id` |
| Performa | Halaman isi form < 200 KB; submit < 1 dtk |
| Aksesibilitas | Kontras WCAG AA; `prefers-reduced-motion`; label form benar |
| Anti-XSS | Semua teks lolos sanitasi (buang HTML) |
| Anti-kecurangan | Deteksi blur/paste/copy → `audit_events`; kunci setelah submit |

---

## 8. Kriteria Penerimaan (Quality Gate)

Sebuah pekerjaan dinyatakan **LULUS** hanya bila:
1. `npm run check` → **0 error**
2. `npm run build` → **sukses**
3. Ada **bukti uji nyata** (curl/DOM), bukan klaim
4. Tidak ada regresi fitur lain
5. Sesuai spesifikasi §2.1 (tidak menambah/mengurangi tanpa persetujuan)

> **Catatan**: laporan sub-agent = *self-report*, bukan fakta. Verifikasi mandiri wajib.

---

## 9. Catatan Perubahan
| Tgl | Perubahan | Alasan |
|---|---|---|
| (dibuat) | v1.0 draf awal | Permintaan pengguna |
