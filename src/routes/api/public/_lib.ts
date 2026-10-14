/**
 * _lib.ts — Helper bersama Modul M4 (API publik /api/public/*).
 *
 * Modul M4 = sisi RESPONDEN (tanpa autentikasi). Karena itu aturan keamanan di
 * sini lebih ketat daripada M2/M3:
 *
 *   1. `correct_json` (kunci jawaban) TIDAK BOLEH keluar server sebelum submit.
 *      → SEMUA proyeksi soal publik WAJIB lewat `publicQuestion()` yang
 *        menghapus `correct_json` secara eksplisit. Jangan pernah
 *        `SELECT *` lalu kirim apa adanya.
 *   2. Token ujian (bila `require_token`) diverifikasi waktu `start`.
 *   3. Hanya form berstatus `open` yang dapat diisi responden.
 *   4. Semua endpoint publik dibatasi laju (rate limit) per IP.
 *   5. Input disanitasi & divalidasi server-side sebelum disimpan.
 *
 * Nama file diawali `_` supaya SvelteKit TIDAK memperlakukannya sebagai rute
 * (underscore = private module). Berada di dalam path milik M4 sesuai kontrak §3.
 */
import { ApiError } from '$lib/server/auth.js';
import { many, one } from '$lib/server/db.js';
import {
	isQuestionType,
	type AuditEventType,
	type CorrectJson,
	type FormMode,
	type QuestionOption,
	type QuestionSettings,
	type QuestionType,
	type TimerScope
} from '$lib/types.js';
import { sanitizeText } from '$lib/util/sanitize.js';
import { shuffleQuestions, shuffleWithSeed } from '$lib/util/shuffle.js';

/* ------------------------------------------------------------------ */
/* Bentuk baris DB (mirror formku.*, snake_case)                        */
/* ------------------------------------------------------------------ */

export interface PublicFormRow {
	id: number;
	tenant_id: number;
	title: string;
	slug: string;
	description: string | null;
	mode: FormMode;
	status: 'draft' | 'open' | 'closed';
	timer_seconds: number | null;
	timer_scope: TimerScope;
	shuffle_questions: boolean;
	shuffle_options: boolean;
	bank_pick_count: number | null;
	passing_grade: number | null;
	show_score: boolean;
	require_token: boolean;
	access_token: string | null;
	theme_json: Record<string, unknown> | null;
	thanks_text: string | null;
	created_at: string;
}

export interface PublicSectionRow {
	id: number;
	form_id: number;
	title: string;
	description: string | null;
	sort: number;
	timer_seconds: number | null;
}

/** Baris pertanyaan LENGKAP (termasuk correct_json) — hanya untuk internal. */
export interface PublicQuestionRow {
	id: number;
	form_id: number;
	section_id: number | null;
	type: string;
	label: string;
	help_text: string | null;
	required: boolean;
	points: number;
	correct_json: CorrectJson | null;
	settings_json: QuestionSettings | null;
	sort: number;
}

export interface PublicConditionRow {
	id: number;
	question_id: number;
	depends_on_question_id: number;
	operator: string;
	compare_value: string | null;
	action: string;
}

export interface PublicResponseRow {
	id: number;
	form_id: number;
	respondent_name: string | null;
	respondent_email: string | null;
	token_used: string | null;
	started_at: string;
	submitted_at: string | null;
	duration_seconds: number | null;
	score: number | null;
	max_score: number | null;
	status: 'in_progress' | 'submitted' | 'locked';
	ip: string | null;
}

/* ------------------------------------------------------------------ */
/* Proyeksi AMAN ke klien (anti-kebocoran kunci jawaban)               */
/* ------------------------------------------------------------------ */

/** Soal yang aman dikirim ke responden — TANPA `correct_json`. */
export interface PublicQuestion {
	id: number;
	section_id: number | null;
	type: QuestionType;
	label: string;
	help_text: string | null;
	required: boolean;
	/** Bobot poin; TIDAK mengungkap kunci. Berguna untuk UI "poin". */
	points: number;
	/** Setelan publik: options (label+value), min/max, placeholder, dll. */
	settings: PublicQuestionSettings | null;
	sort: number;
}

/** Subset setelan yang aman dipublikasikan (tanpa apa pun yang membocorkan kunci). */
export interface PublicQuestionSettings {
	options?: QuestionOption[];
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	maxLength?: number;
}

/**
 * Ubah baris pertanyaan DB menjadi bentuk publik SEGAR.
 *
 * ⚠️ INTI JAMINAN KEAMANAN: fungsi ini TIDAK menyalin `correct_json` — kunci
 * jawaban dibuang di sini. Uji `tests/public-leak.test.ts` mengunci perilaku ini.
 * Field apa pun yang tidak di-whitelist secara eksplisit otomatis TIDAK terkirim.
 */
export function projectQuestionForPublic(row: PublicQuestionRow): PublicQuestion {
	const type: QuestionType = isQuestionType(row.type) ? row.type : 'short_text';
	const src = (row.settings_json ?? null) as QuestionSettings | null;

	// Whitelist HANYA field setelan yang aman. Sengaja dibangun manual (bukan
	// spread) supaya kunci baru yang tak dikenal tidak ikut bocor.
	let settings: PublicQuestionSettings | null = null;
	if (src && typeof src === 'object') {
		const out: PublicQuestionSettings = {};
		if (Array.isArray(src.options)) {
			out.options = src.options.map((o) => ({ label: String(o.label), value: String(o.value) }));
		}
		if (typeof src.min === 'number') out.min = src.min;
		if (typeof src.max === 'number') out.max = src.max;
		if (typeof src.step === 'number') out.step = src.step;
		if (typeof src.placeholder === 'string') out.placeholder = src.placeholder;
		if (typeof src.maxLength === 'number') out.maxLength = src.maxLength;
		settings = Object.keys(out).length ? out : null;
	}

	return {
		id: row.id,
		section_id: row.section_id,
		type,
		label: row.label,
		help_text: row.help_text,
		required: row.required,
		points: row.points,
		settings,
		sort: row.sort
	};
}

/* ------------------------------------------------------------------ */
/* Pengambilan data                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ambil form publik berdasarkan slug. Hanya mengembalikan form yang boleh
 * diisi (status `open`) — form draft/closed dianggap tidak ada (404),
 * agar publik tak bisa mengintip form yang belum dibuka.
 */
export async function getOpenForm(slug: string): Promise<PublicFormRow> {
	const clean = (slug ?? '').trim().toLowerCase();
	if (!clean) throw new ApiError(400, 'slug wajib diisi');
	const row = await one<PublicFormRow>(
		`SELECT * FROM formku.forms WHERE slug = $1 AND status = 'open'`,
		[clean]
	);
	if (!row) throw new ApiError(404, `form '${clean}' tidak ditemukan atau belum dibuka`);
	return row;
}

/**
 * Ambil form + sections + questions + conditions LENGKAP (internal M4).
 * Selalu baca `correct_json` di sini untuk penilaian; JANGAN kirim baris mentah
 * ke klien — gunakan `projectQuestionForPublic`.
 */
export async function loadFormBundle(formId: number): Promise<{
	sections: PublicSectionRow[];
	questions: PublicQuestionRow[];
	conditions: PublicConditionRow[];
}> {
	const [sections, questions] = await Promise.all([
		many<PublicSectionRow>(
			`SELECT * FROM formku.sections WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[formId]
		),
		many<PublicQuestionRow>(
			`SELECT * FROM formku.questions WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[formId]
		)
	]);

	let conditions: PublicConditionRow[] = [];
	if (questions.length) {
		const ids = questions.map((q) => q.id);
		conditions = await many<PublicConditionRow>(
			`SELECT * FROM formku.conditions WHERE question_id = ANY($1::int[])`,
			[ids]
		);
	}
	return { sections, questions, conditions };
}

/** Ambil respons milik form tertentu (isolasi: jika bukan milik form → 404). */
export async function getResponseForForm(
	responseId: number,
	formId: number
): Promise<PublicResponseRow> {
	if (!Number.isInteger(responseId) || responseId <= 0) {
		throw new ApiError(400, 'response_id harus bilangan bulat positif');
	}
	const row = await one<PublicResponseRow>(
		`SELECT * FROM formku.responses WHERE id = $1 AND form_id = $2`,
		[responseId, formId]
	);
	if (!row) throw new ApiError(404, 'sesi respons tidak ditemukan untuk form ini');
	return row;
}

/* ------------------------------------------------------------------ */
/* Pengacakan deterministik per-respons                               */
/* ------------------------------------------------------------------ */

/**
 * Terapkan pengacakan (F6/F7) secara DETERMINISTIK memakai `response_id`
 * sebagai seed. Determinisme penting: urutan soal/opsi harus STABIL bila
 * responden memuat ulang halaman atau mengirim ulang — kalau tidak, indeks
 * jawaban klien bisa bergeser dan skor jadi kacau.
 *
 * - `shuffle_questions` : acak urutan soal (global; section tetap diurutkan ulang
 *   di klien sesuai `section_id`, jadi cukup acak penuh di sini).
 * - `bank_pick_count`   : bila diset, tarik N soal acak (subset) setelah acak.
 * - `shuffle_options`   : acak opsi tiap soal (label+value ikut berpindah bersama).
 *
 * @returns daftar soal publik (sudah aman & teracak) + id soal terpilih
 */
export function applyShuffle(
	form: Pick<PublicFormRow, 'shuffle_questions' | 'shuffle_options' | 'bank_pick_count'>,
	questions: readonly PublicQuestionRow[],
	seed: number | string
): PublicQuestion[] {
	let working = questions.slice();

	// (1) Acak urutan soal (global) bila diminta.
	if (form.shuffle_questions) {
		working = shuffleQuestions(
			working,
			true,
			() => null, // global: abaikan pengelompokan section
			false,
			`q:${seed}`
		);
	}

	// (2) Tarik subset N soal dari Bank/daftar (F12) bila bank_pick_count diisi.
	const pick = form.bank_pick_count;
	if (typeof pick === 'number' && pick > 0 && pick < working.length) {
		working = shuffleWithSeed(working, `pick:${seed}`).slice(0, pick);
	}

	// (3) Proyeksi ke bentuk publik yang aman (buang correct_json).
	let out = working.map(projectQuestionForPublic);

	// (4) Acak OPSI per soal dengan seed unik per (responden, soal) → stabil.
	if (form.shuffle_options) {
		out = out.map((q) => {
			if (!q.settings?.options?.length) return q;
			const shuffled = shuffleWithSeed(q.settings.options, `opt:${seed}:${q.id}`);
			return { ...q, settings: { ...q.settings, options: shuffled } };
		});
	}

	return out;
}

/* ------------------------------------------------------------------ */
/* Util validasi                                                        */
/* ------------------------------------------------------------------ */

/** Sanitasi + validasi token ujian (waktu start). */
export function assertAccessToken(form: PublicFormRow, supplied: unknown): void {
	if (!form.require_token) return;
	const expected = (form.access_token ?? '').trim();
	if (!expected) {
		// require_token=true tapi token kosong: konfigurasi cacat → tolak, jangan bypass.
		throw new ApiError(500, 'form mewajibkan token tetapi token belum disetel');
	}
	const given = typeof supplied === 'string' ? supplied.trim() : '';
	if (!given || !timingSafeStrEqual(given, expected)) {
		throw new ApiError(403, 'token ujian salah atau tidak disertakan');
	}
}

/** Sanitasi nama responden (opsional). */
export function cleanRespondentName(v: unknown): string | null {
	if (v === null || v === undefined) return null;
	const s = sanitizeText(v, { maxLength: 120 });
	return s || null;
}

/** Perbandingan string waktu-konstan (cegah kebocoran lewat timing). */
export function timingSafeStrEqual(a: string, b: string): boolean {
	const len = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i++) {
		diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return diff === 0;
}

/** Cek apakah string termasuk AuditEventType yang diizinkan (F14). */
export function normalizeAuditEvent(v: unknown): AuditEventType {
	const allowed: readonly AuditEventType[] = ['blur', 'paste', 'copy', 'focus_return'];
	const s = typeof v === 'string' ? v.trim() : '';
	if (!(allowed as readonly string[]).includes(s)) {
		throw new ApiError(400, 'event_type harus salah satu dari blur|paste|copy|focus_return');
	}
	return s as AuditEventType;
}
