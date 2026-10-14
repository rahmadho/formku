/**
 * forms-util.ts — Helper bersama Modul M3 (API CRUD struktur form).
 *
 * Tujuan: SENTRALISASI autentikasi tenant + pemaksaan isolasi tenant_id, agar
 * setiap endpoint /api/forms, /api/sections, /api/questions memakai satu jalur
 * yang sama dan tidak ada query yang lupa memfilter tenant.
 *
 * Aturan keamanan (KONTRAK-TEKNIS §4 & SPESIFIKASI §3, §7):
 *  - Setiap operasi WAJIB lolos `requireTenant`.
 *  - Mengambil form WAJIB lewat `getOwnedForm` (filter tenant_id) → 404 bila
 *    form milik tenant lain (jangan 403, hindari kebocoran keberadaan).
 *  - Mengambil section/question WAJIB lewat `getOwnedSection`/`getOwnedQuestion`
 *    yang meng-JOIN ke forms dan memfilter tenant_id pemilik.
 *  - `correct_json` (kunci jawaban) boleh dikembalikan ke CREATOR (pemiliknya);
 *    yang dilarang membocorkannya ke responden (ditangani M4 /api/public/*).
 *
 * Semua helper melempar `ApiError` (lihat auth.ts) sehingga handler tinggal
 * memanggil `handleAuthError(e)` di blok catch.
 */
import { ApiError, requireTenant, type Tenant } from './auth.js';
import { one, many } from './db.js';
import {
	LIMITS,
	isScorable,
	isMultiValue,
	hasOptions,
	type FormStatus,
	type FormMode,
	type TimerScope,
	type QuestionType
} from '../types.js';
import { sanitizeText, sanitizeMultiline, slugify } from '../util/sanitize.js';
import { validateOptions, isOneOf } from '../util/validate.js';

/* ------------------------------------------------------------------ */
/* Bentuk baris DB                                                     */
/* ------------------------------------------------------------------ */

/** Baris `formku.forms` (snake_case, mirror DB). */
export interface FormRow {
	id: number;
	tenant_id: number;
	title: string;
	slug: string;
	description: string | null;
	mode: FormMode;
	status: FormStatus;
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

/** Baris `formku.sections`. */
export interface SectionRow {
	id: number;
	form_id: number;
	title: string;
	description: string | null;
	sort: number;
	timer_seconds: number | null;
}

/** Baris `formku.questions`. */
export interface QuestionRow {
	id: number;
	form_id: number;
	section_id: number | null;
	type: string;
	label: string;
	help_text: string | null;
	required: boolean;
	points: number;
	correct_json: unknown;
	settings_json: unknown;
	sort: number;
}

/* ------------------------------------------------------------------ */
/* Auth + isolasi tenant                                               */
/* ------------------------------------------------------------------ */

/** Autentikasi tenant (header x-tenant + x-api-key). Pembungkus tipis. */
export async function authTenant(event: { request: Request }): Promise<Tenant> {
	return requireTenant(event);
}

/**
 * Ambil form BERDASARKAN id MILIK tenant tertentu.
 * Query difilter `tenant_id` → form tenant lain dianggap tidak ada (404).
 */
export async function getOwnedForm(
	tenantId: number,
	formId: number
): Promise<FormRow> {
	if (!Number.isInteger(formId) || formId <= 0) {
		throw new ApiError(400, 'id form harus bilangan bulat positif');
	}
	const row = await one<FormRow>(
		`SELECT * FROM formku.forms WHERE id = $1 AND tenant_id = $2`,
		[formId, tenantId]
	);
	if (!row) throw new ApiError(404, `form id=${formId} tidak ditemukan`);
	return row;
}

/**
 * Ambil section MILIK tenant (via JOIN ke forms) + kembalikan form-nya.
 * Mencegah tenant A mengubah section milik form tenant B.
 */
export async function getOwnedSection(
	tenantId: number,
	sectionId: number
): Promise<{ section: SectionRow; form: FormRow }> {
	if (!Number.isInteger(sectionId) || sectionId <= 0) {
		throw new ApiError(400, 'id section harus bilangan bulat positif');
	}
	const row = await one<
		SectionRow & { f_tenant_id: number; f_form: Record<string, unknown> }
	>(
		`SELECT s.*, f.tenant_id AS f_tenant_id, to_jsonb(f.*) AS f_form
		   FROM formku.sections s
		   JOIN formku.forms f ON f.id = s.form_id
		  WHERE s.id = $1 AND f.tenant_id = $2`,
		[sectionId, tenantId]
	);
	if (!row) throw new ApiError(404, `section id=${sectionId} tidak ditemukan`);
	const { f_tenant_id: _t, f_form, ...section } = row;
	return { section: section as SectionRow, form: f_form as unknown as FormRow };
}

/** Ambil question MILIK tenant (via JOIN ke forms) + form pemiliknya. */
export async function getOwnedQuestion(
	tenantId: number,
	questionId: number
): Promise<{ question: QuestionRow; form: FormRow }> {
	if (!Number.isInteger(questionId) || questionId <= 0) {
		throw new ApiError(400, 'id question harus bilangan bulat positif');
	}
	const row = await one<
		QuestionRow & { f_tenant_id: number; f_form: Record<string, unknown> }
	>(
		`SELECT q.*, f.tenant_id AS f_tenant_id, to_jsonb(f.*) AS f_form
		   FROM formku.questions q
		   JOIN formku.forms f ON f.id = q.form_id
		  WHERE q.id = $1 AND f.tenant_id = $2`,
		[questionId, tenantId]
	);
	if (!row) throw new ApiError(404, `question id=${questionId} tidak ditemukan`);
	const { f_tenant_id: _t, f_form, ...question } = row;
	return { question: question as QuestionRow, form: f_form as unknown as FormRow };
}

/* ------------------------------------------------------------------ */
/* Parsing body + util                                                 */
/* ------------------------------------------------------------------ */

/** Baca body JSON; lempar 400 bila bukan JSON valid. */
export async function readJsonBody(
	request: Request
): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new ApiError(400, 'body harus JSON valid');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new ApiError(400, 'body harus berupa objek JSON');
	}
	return body as Record<string, unknown>;
}

/** Ambil id numerik dari parameter rute `[id]`. */
export function parseIdParam(raw: string | undefined, label = 'id'): number {
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		throw new ApiError(400, `${label} harus bilangan bulat positif`);
	}
	return n;
}

/** Integer opsional (>= min). `undefined` → undefined; null/'' → null; invalid → 400. */
export function optInt(
	v: unknown,
	min: number,
	label: string
): number | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === '') return null;
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isInteger(n) || n < min) {
		throw new ApiError(400, `${label} harus bilangan bulat >= ${min} atau null`);
	}
	return n;
}

/** Boolean opsional; nilai tak valid → 400. `undefined` diteruskan apa adanya. */
export function optBool(v: unknown, label: string): boolean | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'boolean') throw new ApiError(400, `${label} harus boolean`);
	return v;
}

/** Mode/status/scope opsional dengan whitelist enum. */
export function optEnum<T extends string>(
	v: unknown,
	allowed: readonly T[],
	label: string
): T | undefined {
	if (v === undefined) return undefined;
	if (!isOneOf(v, allowed)) {
		throw new ApiError(400, `${label} harus salah satu dari ${allowed.join('|')}`);
	}
	return v;
}

/** Sanitasi judul/nama (teks polos, batas panjang). Wajib non-kosong. */
export function reqText(v: unknown, max: number, label: string): string {
	const s = sanitizeText(v, { maxLength: max });
	if (!s) throw new ApiError(400, `${label} wajib diisi`);
	return s;
}

/** Sanitasi teks opsional multiline (boleh null). */
export function optMultiline(v: unknown, max: number): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === '') return null;
	return sanitizeMultiline(v, max) || null;
}

/** Sanitasi teks opsional satu baris (boleh null). */
export function optText(v: unknown, max: number): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === '') return null;
	return sanitizeText(v, { maxLength: max }) || null;
}

/**
 * Pastikan slug form unik global (forms.slug UNIQUE). Bila bentrok, tambahkan
 * sufiks angka. `excludeId` untuk update (jangan anggap diri sendiri bentrok).
 */
export async function uniqueFormSlug(
	base: string,
	excludeId?: number
): Promise<string> {
	const slug = slugify(base, LIMITS.slug) || 'form';
	for (let i = 0; i < 50; i++) {
		const candidate = i === 0 ? slug : `${slug}-${i + 1}`.slice(0, LIMITS.slug);
		const clash = await one<{ id: number }>(
			`SELECT id FROM formku.forms WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)`,
			[candidate, excludeId ?? null]
		);
		if (!clash) return candidate;
	}
	return `${slug.slice(0, 60)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** JSONB → objek aman (atau null). Dipakai untuk theme_json/correct/settings. */
export function asObject(v: unknown): Record<string, unknown> | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
	if (typeof v === 'string') {
		try {
			const parsed = JSON.parse(v);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			/* bukan JSON */
		}
	}
	return null;
}

/** Ambil daftar section + question milik form (dipakai /forms/[id] & /structure). */
export async function loadStructure(formId: number): Promise<{
	sections: SectionRow[];
	questions: QuestionRow[];
}> {
	const [sections, questions] = await Promise.all([
		many<SectionRow>(
			`SELECT * FROM formku.sections WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[formId]
		),
		many<QuestionRow>(
			`SELECT * FROM formku.questions WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[formId]
		)
	]);
	return { sections, questions };
}

/** Hitung sort berikutnya untuk child baru pada sebuah form. */
export async function nextSort(
	table: 'sections' | 'questions',
	formId: number
): Promise<number> {
	const row = await one<{ next: number }>(
		`SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM formku.${table} WHERE form_id = $1`,
		[formId]
	);
	return row?.next ?? 0;
}

/** Normalisasi boolean input agar konsisten (true/false) bila disediakan. */
export function boolOr(v: boolean | undefined, fallback: boolean): boolean {
	return v === undefined ? fallback : v;
}

/* ------------------------------------------------------------------ */
/* Helper pertanyaan (dipakai /api/questions & /api/questions/[id])     */
/* ------------------------------------------------------------------ */

/** Boolean opsional dari body → 400 bila bukan boolean. */
export function reqBool(v: unknown, label: string): boolean | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'boolean') throw new ApiError(400, `${label} harus boolean`);
	return v;
}

/**
 * Bangun settings_json: validasi options (untuk tipe beropsi) + salin
 * min/max/step/placeholder/maxLength yang aman. Mengembalikan null bila kosong.
 */
export function buildSettings(
	type: QuestionType,
	body: Record<string, unknown>
): Record<string, unknown> | null {
	const settingsIn =
		body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)
			? (body.settings as Record<string, unknown>)
			: {};

	const out: Record<string, unknown> = {};

	// Opsi: boleh di body.options atau body.settings.options.
	const rawOptions = body.options ?? settingsIn.options;
	if (rawOptions !== undefined) {
		const res = validateOptions(rawOptions, type);
		if (!res.ok) throw new ApiError(400, res.errors.join('; '));
		out.options = res.value;
	} else if (hasOptions(type)) {
		// Tipe beropsi tanpa options → tolak (cegah soal radio tanpa pilihan).
		throw new ApiError(400, `type '${type}' memerlukan field options`);
	}

	for (const key of ['min', 'max', 'step'] as const) {
		if (settingsIn[key] !== undefined && settingsIn[key] !== null) {
			const n = Number(settingsIn[key]);
			if (!Number.isFinite(n)) throw new ApiError(400, `settings.${key} harus angka`);
			out[key] = n;
		}
	}
	if (typeof settingsIn.placeholder === 'string') {
		out.placeholder = settingsIn.placeholder.slice(0, 200);
	}
	if (settingsIn.maxLength !== undefined && settingsIn.maxLength !== null) {
		const n = Number(settingsIn.maxLength);
		if (!Number.isInteger(n) || n < 1)
			throw new ApiError(400, 'settings.maxLength harus integer >= 1');
		out.maxLength = n;
	}

	return Object.keys(out).length ? out : null;
}

/**
 * Bangun correct_json (kunci jawaban) bila tipe dapat dinilai (F8).
 * Bentuk: {value} untuk tunggal, {values:[]} untuk checkbox.
 * Tipe tak-dinilai atau tanpa kunci → null.
 */
export function buildCorrect(
	type: QuestionType,
	raw: unknown
): Record<string, unknown> | null {
	if (!isScorable(type)) return null;
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		throw new ApiError(400, 'correct harus objek, mis. {"value":"A"} atau {"values":["A","C"]}');
	}
	const o = raw as Record<string, unknown>;

	if (isMultiValue(type)) {
		if (o.values === undefined) {
			if (o.value !== undefined)
				throw new ApiError(400, `correct untuk tipe '${type}' memakai {"values":[...]}`);
			return null;
		}
		if (!Array.isArray(o.values) || o.values.some((x) => typeof x !== 'string')) {
			throw new ApiError(400, 'correct.values harus array string');
		}
		return { values: o.values as string[] };
	}

	if (o.value === undefined) {
		if (o.values !== undefined)
			throw new ApiError(400, `correct untuk tipe '${type}' memakai {"value": ...}`);
		return null;
	}
	if (typeof o.value !== 'string' && typeof o.value !== 'number') {
		throw new ApiError(400, 'correct.value harus string atau angka');
	}
	return { value: o.value as string | number };
}

/** Pastikan section_id (bila ada) milik form yang sama. Mengembalikan id|null. */
export async function resolveSectionId(
	formId: number,
	raw: unknown
): Promise<number | null> {
	if (raw === undefined || raw === null || raw === '') return null;
	const sectionId = parseIdParam(String(raw), 'section_id');
	const sec = await one<{ id: number }>(
		`SELECT id FROM formku.sections WHERE id = $1 AND form_id = $2`,
		[sectionId, formId]
	);
	if (!sec) throw new ApiError(400, 'section_id bukan milik form ini');
	return sectionId;
}
