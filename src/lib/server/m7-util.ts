/**
 * m7-util.ts — Helper bersama Modul M7 (Dasbor, Respons, Analitik, Bank Soal).
 *
 * Tujuan: SENTRALISASI autentikasi tenant + isolasi `tenant_id` + normalisasi
 * baris respons/analitik, agar semua endpoint M7 memakai satu jalur aman.
 *
 * Aturan (KONTRAK-TEKNIS §3–§4, SPESIFIKASI §3, §7):
 *  - Semua endpoint M7 WAJIB lolos `requireTenant` (via `authTenant`).
 *  - Setiap akses form WAJIB lewat `getOwnedForm` (filter tenant_id) → 404 bila
 *    bukan milik tenant (hindari kebocoran keberadaan form tenant lain).
 *  - Bank soal difilter `tenant_id` pada SETIAP query.
 *  - Semua teks masuk lewat sanitasi (M1 util) & divalidasi bentuknya.
 *
 * Melempar `ApiError` (lihat auth.ts) agar handler cukup `handleAuthError(e)`.
 */
import { ApiError } from './auth.js';
import { many, one } from './db.js';
import { authTenant, getOwnedForm, type FormRow } from './forms-util.js';
import { sanitizeText, sanitizeMultiline } from '../util/sanitize.js';
import { isOneOf } from '../util/validate.js';
import {
	LIMITS,
	QUESTION_TYPES,
	isScorable,
	isMultiValue,
	hasOptions,
	type QuestionType
} from '../types.js';

/* ------------------------------------------------------------------ */
/* Bentuk baris DB                                                     */
/* ------------------------------------------------------------------ */

/** Baris `formku.responses` (snake_case, mirror DB). */
export interface ResponseRow {
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

/** Baris `formku.answers`. */
export interface AnswerRow {
	id: number;
	response_id: number;
	question_id: number;
	value_json: unknown;
	is_correct: boolean | null;
	points_awarded: number | null;
}

/** Baris `formku.bank_questions`. */
export interface BankQuestionRow {
	id: number;
	tenant_id: number;
	type: string;
	label: string;
	options_json: unknown;
	correct_json: unknown;
	points: number;
	tags: string | null;
	created_at: string;
}

/* ------------------------------------------------------------------ */
/* Auth re-export                                                      */
/* ------------------------------------------------------------------ */

export { authTenant };

/**
 * Ambil form MILIK tenant (pembungkus eksplisit agar M7 jelas memakai isolasi).
 */
export async function ownedForm(tenantId: number, formId: number): Promise<FormRow> {
	return getOwnedForm(tenantId, formId);
}

/* ------------------------------------------------------------------ */
/* Parsing parameter daftar respons                                    */
/* ------------------------------------------------------------------ */

/** Opsi filter daftar respons. */
export interface ResponseListFilter {
	status?: 'in_progress' | 'submitted' | 'locked';
	q?: string;
	limit: number;
	offset: number;
	sort: 'newest' | 'oldest' | 'score_desc' | 'score_asc' | 'duration_desc';
}

const RESPONSE_STATUSES = ['in_progress', 'submitted', 'locked'] as const;
const SORTS = ['newest', 'oldest', 'score_desc', 'score_asc', 'duration_desc'] as const;

/** Parse & validasi query string daftar respons. */
export function parseResponseFilter(url: URL): ResponseListFilter {
	const rawStatus = url.searchParams.get('status');
	let status: ResponseListFilter['status'];
	if (rawStatus) {
		if (!isOneOf(rawStatus, RESPONSE_STATUSES)) {
			throw new ApiError(400, `status harus salah satu dari ${RESPONSE_STATUSES.join('|')}`);
		}
		status = rawStatus;
	}

	const q = url.searchParams.get('q')?.trim() || undefined;

	const limit = clampInt(url.searchParams.get('limit'), 50, 1, 500);
	const offset = clampInt(url.searchParams.get('offset'), 0, 0, 1_000_000);

	const rawSort = url.searchParams.get('sort') ?? 'newest';
	if (!isOneOf(rawSort, SORTS)) {
		throw new ApiError(400, `sort harus salah satu dari ${SORTS.join('|')}`);
	}

	return { status, q, limit, offset, sort: rawSort };
}

/** Integer dari string dengan default & rentang; nilai tak valid → default. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
	if (raw === null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/** Ubah kode `sort` menjadi klausa SQL ORDER BY (whitelist — tanpa input mentah). */
export function orderClauseForSort(sort: ResponseListFilter['sort']): string {
	switch (sort) {
		case 'oldest':
			return 'r.started_at ASC, r.id ASC';
		case 'score_desc':
			return 'r.score DESC NULLS LAST, r.id DESC';
		case 'score_asc':
			return 'r.score ASC NULLS LAST, r.id DESC';
		case 'duration_desc':
			return 'r.duration_seconds DESC NULLS LAST, r.id DESC';
		case 'newest':
		default:
			return 'r.started_at DESC, r.id DESC';
	}
}

/* ------------------------------------------------------------------ */
/* Bank soal                                                           */
/* ------------------------------------------------------------------ */

/**
 * Bangun `options_json` dari input (array opsi) untuk bank soal.
 * Tipe non-opsi → null. Tipe beropsi tanpa opsi → error (soal radio tanpa
 * pilihan tidak berguna).
 */
export function buildBankOptions(
	type: QuestionType,
	raw: unknown
): Array<{ label: string; value: string }> | null {
	if (!hasOptions(type)) return null;
	if (raw === undefined || raw === null) {
		throw new ApiError(400, `type '${type}' memerlukan field options`);
	}
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new ApiError(400, 'options harus array tidak kosong');
	}
	if (raw.length > LIMITS.options) {
		throw new ApiError(400, `options maksimum ${LIMITS.options}`);
	}
	const out: Array<{ label: string; value: string }> = [];
	const seen = new Set<string>();
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i];
		if (typeof item !== 'object' || item === null) {
			throw new ApiError(400, `options[${i}] harus objek {label,value}`);
		}
		const o = item as Record<string, unknown>;
		const label = sanitizeText(o.label, { maxLength: LIMITS.label });
		if (!label) throw new ApiError(400, `options[${i}].label wajib diisi`);
		const value = sanitizeText(o.value ?? o.label, { maxLength: LIMITS.optionValue });
		if (!value) throw new ApiError(400, `options[${i}].value tidak valid`);
		if (seen.has(value)) throw new ApiError(400, `options[${i}].value duplikat: ${value}`);
		seen.add(value);
		out.push({ label, value });
	}
	return out;
}

/**
 * Bangun `correct_json` dari input. Bentuk {value} (tunggal) atau {values:[...]}
 * (checkbox). Tipe tak-dinilai → null. Kunci kosong → null.
 */
export function buildBankCorrect(
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
			if (o.value !== undefined) {
				throw new ApiError(400, `correct untuk tipe '${type}' memakai {"values":[...]}`);
			}
			return null;
		}
		if (!Array.isArray(o.values) || o.values.some((x) => typeof x !== 'string')) {
			throw new ApiError(400, 'correct.values harus array string');
		}
		const values = (o.values as string[]).map((v) => v.trim()).filter(Boolean);
		return values.length ? { values } : null;
	}
	if (o.value === undefined) {
		if (o.values !== undefined) {
			throw new ApiError(400, `correct untuk tipe '${type}' memakai {"value": ...}`);
		}
		return null;
	}
	if (typeof o.value !== 'string' && typeof o.value !== 'number') {
		throw new ApiError(400, 'correct.value harus string atau angka');
	}
	return { value: o.value as string | number };
}

/** Sanitasi label soal bank (wajib). */
export function bankLabel(raw: unknown): string {
	const s = sanitizeText(raw, { maxLength: LIMITS.label });
	if (!s) throw new ApiError(400, 'label wajib diisi');
	return s;
}

/** Sanitasi tags (teks pendek, dipisah koma). Mengembalikan null bila kosong. */
export function bankTags(raw: unknown): string | null {
	if (raw === undefined || raw === null || raw === '') return null;
	if (Array.isArray(raw)) {
		const joined = raw.map((t) => sanitizeText(t, { maxLength: 40 })).filter(Boolean).join(',');
		return joined || null;
	}
	const s = sanitizeMultiline(raw, 500).replace(/\n+/g, ',').replace(/,+/g, ',');
	const trimmed = s.replace(/^,|,$/g, '').trim();
	return trimmed || null;
}

/** Poin soal bank: integer >= 0 (default 1). */
export function bankPoints(raw: unknown, fallback = 1): number {
	if (raw === undefined || raw === null || raw === '') return fallback;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isInteger(n) || n < 0) {
		throw new ApiError(400, 'points harus bilangan bulat >= 0');
	}
	return n;
}

/** Validasi tipe soal bank (whitelist QUESTION_TYPES). */
export function bankType(raw: unknown): QuestionType {
	if (!isOneOf(raw, QUESTION_TYPES)) {
		throw new ApiError(400, `type harus salah satu dari ${QUESTION_TYPES.join('|')}`);
	}
	return raw;
}

/* ------------------------------------------------------------------ */
/* Analitik                                                            */
/* ------------------------------------------------------------------ */

/** Ringkasan agregat respons sebuah form. */
export interface FormAnalyticsSummary {
	total: number;
	submitted: number;
	in_progress: number;
	locked: number;
	avg_score: number | null;
	avg_percent: number | null;
	pass_rate: number | null;
	avg_duration_seconds: number | null;
	min_score: number | null;
	max_score: number | null;
	score_distribution: Array<{ bucket: number; count: number }>;
}

/** Statistik per soal (untuk "soal tersulit"). */
export interface QuestionStat {
	question_id: number;
	label: string;
	type: string;
	points: number;
	answered: number;
	correct: number;
	wrong: number;
	/** Persentase benar (0–100), null bila tak ada jawaban dinilai. */
	accuracy: number | null;
}

/** Bentuk lengkap respons analitik. */
export interface FormAnalytics {
	form_id: number;
	title: string;
	mode: string;
	passing_grade: number | null;
	show_score: boolean;
	summary: FormAnalyticsSummary;
	questions: QuestionStat[];
	/** Soal tersulit (akurasi terendah, minimal 1 jawaban dinilai). */
	hardest: QuestionStat[];
}

/** Query ringkasan agregat respons untuk sebuah form. */
export async function loadResponseSummary(formId: number): Promise<FormAnalyticsSummary> {
	const agg = await one<{
		total: number;
		submitted: number;
		in_progress: number;
		locked: number;
		avg_score: string | null;
		avg_percent: string | null;
		avg_duration: string | null;
		min_score: number | null;
		max_score: number | null;
	}>(
		`SELECT
		   count(*)::int AS total,
		   count(*) FILTER (WHERE status = 'submitted')::int AS submitted,
		   count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
		   count(*) FILTER (WHERE status = 'locked')::int AS locked,
		   avg(score) FILTER (WHERE status = 'submitted') AS avg_score,
		   avg( CASE WHEN status = 'submitted' AND max_score > 0
		             THEN (score::numeric / max_score) * 100 END ) AS avg_percent,
		   avg(duration_seconds) FILTER (WHERE submitted_at IS NOT NULL) AS avg_duration,
		   min(score) FILTER (WHERE status = 'submitted') AS min_score,
		   max(score) FILTER (WHERE status = 'submitted') AS max_score
		   FROM formku.responses
		  WHERE form_id = $1`,
		[formId]
	);

	// Distribusi skor dalam 10 persen-bucket (0–9,10–19,...90–100).
	const distRows = await many<{ bucket: number; count: number }>(
		`SELECT
		   LEAST(9, GREATEST(0,
		     CASE WHEN max_score > 0
		          THEN floor((score::numeric / max_score) * 100 / 10)::int
		          ELSE 0 END)) AS bucket,
		   count(*)::int AS count
		   FROM formku.responses
		  WHERE form_id = $1 AND status = 'submitted'
		  GROUP BY bucket
		  ORDER BY bucket`,
		[formId]
	);
	const distMap = new Map(distRows.map((r) => [r.bucket, r.count]));
	const score_distribution = Array.from({ length: 10 }, (_, i) => ({
		bucket: i * 10,
		count: distMap.get(i) ?? 0
	}));

	const submitted = agg?.submitted ?? 0;

	// pass_rate: proporsi lulus bila ada passing_grade & max_score>0.
	let pass_rate: number | null = null;
	if (submitted > 0) {
		const form = await one<{ passing_grade: number | null; max_score_known: number | null }>(
			`SELECT passing_grade, NULL::int AS max_score_known FROM formku.forms WHERE id = $1`,
			[formId]
		);
		const pg = form?.passing_grade ?? null;
		if (pg !== null) {
			const passed = await one<{ n: number }>(
				`SELECT count(*)::int AS n FROM formku.responses
				  WHERE form_id = $1 AND status = 'submitted' AND max_score > 0
				    AND (score::numeric / max_score) * 100 >= $2`,
				[formId, pg]
			);
			pass_rate = Math.round(((passed?.n ?? 0) / submitted) * 100);
		}
	}

	return {
		total: agg?.total ?? 0,
		submitted,
		in_progress: agg?.in_progress ?? 0,
		locked: agg?.locked ?? 0,
		avg_score: round2(agg?.avg_score),
		avg_percent: round2(agg?.avg_percent),
		pass_rate,
		avg_duration_seconds: round2(agg?.avg_duration),
		min_score: agg?.min_score ?? null,
		max_score: agg?.max_score ?? null,
		score_distribution
	};
}

/** Statistik per soal: dijawab, benar, salah, akurasi. */
export async function loadQuestionStats(formId: number): Promise<QuestionStat[]> {
	const rows = await many<{
		question_id: number;
		label: string;
		type: string;
		points: number;
		answered: number;
		correct: number;
		wrong: number;
	}>(
		`SELECT
		   q.id AS question_id,
		   q.label,
		   q.type,
		   q.points,
		   count(a.id)::int AS answered,
		   count(*) FILTER (WHERE a.is_correct IS TRUE)::int AS correct,
		   count(*) FILTER (WHERE a.is_correct IS FALSE)::int AS wrong
		   FROM formku.questions q
		   LEFT JOIN formku.answers a ON a.question_id = q.id
		  WHERE q.form_id = $1
		  GROUP BY q.id, q.label, q.type, q.points, q.sort
		  ORDER BY q.sort ASC, q.id ASC`,
		[formId]
	);

	return rows.map((r) => {
		const graded = r.correct + r.wrong;
		return {
			question_id: r.question_id,
			label: r.label,
			type: r.type,
			points: r.points,
			answered: r.answered,
			correct: r.correct,
			wrong: r.wrong,
			accuracy: graded > 0 ? Math.round((r.correct / graded) * 100) : null
		};
	});
}

/** Bangun objek analitik lengkap untuk sebuah form. */
export async function buildAnalytics(form: FormRow): Promise<FormAnalytics> {
	const [summary, questions] = await Promise.all([
		loadResponseSummary(form.id),
		loadQuestionStats(form.id)
	]);

	const gradable = questions.filter((q) => q.accuracy !== null && q.points > 0);
	const hardest = gradable
		.slice()
		.sort((a, b) => (a.accuracy as number) - (b.accuracy as number))
		.slice(0, 5);

	return {
		form_id: form.id,
		title: form.title,
		mode: form.mode,
		passing_grade: form.passing_grade,
		show_score: form.show_score,
		summary,
		questions,
		hardest
	};
}

/* ------------------------------------------------------------------ */
/* util                                                                */
/* ------------------------------------------------------------------ */

/** Bulatkan nilai numerik (string dari pg) ke 2 desimal; null bila kosong. */
export function round2(v: string | number | null | undefined): number | null {
	if (v === null || v === undefined) return null;
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n)) return null;
	return Math.round(n * 100) / 100;
}

/** Ambil nilai JSONB yang mungkin berupa string JSON → objek/array. */
export function asJson<T = unknown>(v: unknown): T | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'string') {
		try {
			return JSON.parse(v) as T;
		} catch {
			return null;
		}
	}
	return v as T;
}
