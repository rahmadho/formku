/**
 * types.ts — Tipe & konstanta bersama FormKu (Modul M1).
 * Sumber kebenaran: docs/KONTRAK-TEKNIS.md §2 & docs/SPESIFIKASI.md §5.
 *
 * Modul ini murni tipe + konstanta (NO runtime side-effect selain const).
 * Diimpor oleh M0–M7. Jangan ubah bentuk tanpa persetujuan (kontrak bersama).
 */

/* ------------------------------------------------------------------ *
 * Enum-like unions (sesuai CHECK domain di skema PostgreSQL)
 * ------------------------------------------------------------------ */

/** Mode form: form biasa, kuis interaktif, atau ujian formal. */
export type FormMode = 'form' | 'quiz' | 'exam';
export const FORM_MODES: readonly FormMode[] = ['form', 'quiz', 'exam'] as const;

/** Status publikasi form. */
export type FormStatus = 'draft' | 'open' | 'closed';
export const FORM_STATUSES: readonly FormStatus[] = ['draft', 'open', 'closed'] as const;

/** Cakupan timer: satu timer untuk seluruh form, atau per-section. */
export type TimerScope = 'form' | 'section';
export const TIMER_SCOPES: readonly TimerScope[] = ['form', 'section'] as const;

/** Status tenant (multi-tenant). */
export type TenantStatus = 'active' | 'suspended';
export const TENANT_STATUSES: readonly TenantStatus[] = ['active', 'suspended'] as const;

/** Tipe pertanyaan yang didukung (F3). */
export type QuestionType =
	| 'short_text'
	| 'long_text'
	| 'radio'
	| 'checkbox'
	| 'dropdown'
	| 'number'
	| 'date'
	| 'email'
	| 'rating'
	| 'scale'
	| 'file';
export const QUESTION_TYPES: readonly QuestionType[] = [
	'short_text',
	'long_text',
	'radio',
	'checkbox',
	'dropdown',
	'number',
	'date',
	'email',
	'rating',
	'scale',
	'file'
] as const;

/** Tipe pertanyaan yang memakai daftar opsi (settings.options). */
export const OPTION_QUESTION_TYPES: readonly QuestionType[] = [
	'radio',
	'checkbox',
	'dropdown'
] as const;

/** Tipe pertanyaan yang dapat dinilai otomatis (punya kunci jawaban). */
export const SCORABLE_QUESTION_TYPES: readonly QuestionType[] = [
	'radio',
	'checkbox',
	'dropdown',
	'number',
	'short_text',
	'scale'
] as const;

/** Tipe pertanyaan yang mendukung jawaban ganda (array). */
export const MULTI_VALUE_QUESTION_TYPES: readonly QuestionType[] = ['checkbox'] as const;

/** Status respons responden. */
export type ResponseStatus = 'in_progress' | 'submitted' | 'locked';
export const RESPONSE_STATUSES: readonly ResponseStatus[] = [
	'in_progress',
	'submitted',
	'locked'
] as const;

/** Operator logika kondisional (F17). */
export type ConditionOperator = 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt';
export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
	'equals',
	'not_equals',
	'contains',
	'gt',
	'lt'
] as const;

/** Aksi logika kondisional. */
export type ConditionAction = 'show' | 'hide';
export const CONDITION_ACTIONS: readonly ConditionAction[] = ['show', 'hide'] as const;

/** Jenis peristiwa audit anti-kecurangan (F14). */
export type AuditEventType = 'blur' | 'paste' | 'copy' | 'focus_return';
export const AUDIT_EVENT_TYPES: readonly AuditEventType[] = [
	'blur',
	'paste',
	'copy',
	'focus_return'
] as const;

/* ------------------------------------------------------------------ *
 * Batas & nilai default
 * ------------------------------------------------------------------ */

/** Batas maksimum panjang teks yang aman (anti abuse / DoS). */
export const LIMITS = {
	/** Panjang maksimum judul form/section. */
	title: 200,
	/** Panjang maksimum label pertanyaan. */
	label: 500,
	/** Panjang maksimum teks bantuan. */
	helpText: 500,
	/** Panjang maksimum deskripsi. */
	description: 2000,
	/** Panjang maksimum jawaban teks pendek. */
	shortText: 2000,
	/** Panjang maksimum jawaban teks panjang. */
	longText: 20000,
	/** Panjang maksimum nama responden. */
	respondentName: 120,
	/** Panjang maksimum email (RFC 5321 batas praktis). */
	email: 254,
	/** Jumlah maksimum opsi per pertanyaan. */
	options: 100,
	/** Panjang maksimum slug. */
	slug: 80,
	/** Panjang maksimum nilai opsi. */
	optionValue: 200
} as const;

/** Batas nilai numerik (number/rating/scale). */
export const NUMERIC_BOUNDS = {
	/** Min/max rating bintang. */
	rating: { min: 1, max: 10, defaultMax: 5 },
	/** Min/max skala Likert. */
	scale: { min: 1, max: 10, defaultMax: 5 },
	/** Batas umum nilai number. */
	number: { min: -1_000_000_000, max: 1_000_000_000 }
} as const;

/** Default timer (detik): tanpa timer. */
export const DEFAULT_TIMER_SECONDS = null;

/** Batas atas timer (detik): 24 jam — mencegah nilai tak masuk akal. */
export const MAX_TIMER_SECONDS = 24 * 60 * 60;

/** Default passing grade (persen) bila mode quiz/exam. */
export const DEFAULT_PASSING_GRADE = 70;

/** Regex slug yang diizinkan (lowercase, angka, tanda hubung). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Regex email sederhana namun aman (validasi lanjutan via util/validate.ts). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ *
 * Bentuk data (mirror baris DB — camelCase dikonversi oleh pemanggil)
 * ------------------------------------------------------------------ */

/** Kunci jawaban tersimpan di `questions.correct_json` / `bank_questions.correct_json`. */
export interface CorrectJson {
	/** Jawaban tunggal (radio/dropdown/number/short_text/scale). */
	value?: string | number | null;
	/** Jawaban ganda (checkbox). */
	values?: Array<string | number>;
}

/** Opsi pertanyaan. */
export interface QuestionOption {
	label: string;
	value: string;
}

/** Setelan pertanyaan tersimpan di `questions.settings_json`. */
export interface QuestionSettings {
	options?: QuestionOption[];
	min?: number;
	max?: number;
	/** Langkah kenaikan (untuk number/rating/scale). */
	step?: number;
	/** Placeholder input. */
	placeholder?: string;
	/** Batas panjang untuk tipe teks. */
	maxLength?: number;
}

/** Definisi pertanyaan (subset kolom relevan untuk util M1). */
export interface QuestionLike {
	id: number;
	type: QuestionType;
	label: string;
	required?: boolean;
	points?: number;
	correct?: CorrectJson | null;
	settings?: QuestionSettings | null;
	sort?: number;
	section_id?: number | null;
}

/** Jawaban responden terhadap satu pertanyaan. */
export interface AnswerInput {
	question_id: number;
	/** Nilai jawaban; bentuk bergantung tipe pertanyaan. */
	value: unknown;
}

/** Konteks penilaian satu jawaban. */
export interface ScoreResult {
	/** Total poin diperoleh. */
	score: number;
	/** Total poin maksimum yang tersedia. */
	maxScore: number;
	/** Persentase 0–100 (dibulatkan ke bilangan bulat). */
	percent: number;
	/** Jumlah pertanyaan dinilai. */
	graded: number;
	/** Rincian per pertanyaan. */
	details: AnswerScore[];
}

/** Rincian penilaian satu jawaban. */
export interface AnswerScore {
	question_id: number;
	isCorrect: boolean;
	/** Poin diperoleh (0 bila salah / tak dinilai). */
	pointsAwarded: number;
	/** Poin maksimum pertanyaan. */
	maxPoints: number;
}

/* ------------------------------------------------------------------ *
 * Guard tipe (runtime — aman dipakai di server & klien)
 * ------------------------------------------------------------------ */

/** Cek apakah sebuah nilai string termasuk FormMode. */
export function isFormMode(v: unknown): v is FormMode {
	return typeof v === 'string' && (FORM_MODES as readonly string[]).includes(v);
}

/** Cek apakah sebuah nilai string termasuk FormStatus. */
export function isFormStatus(v: unknown): v is FormStatus {
	return typeof v === 'string' && (FORM_STATUSES as readonly string[]).includes(v);
}

/** Cek apakah sebuah nilai string termasuk TimerScope. */
export function isTimerScope(v: unknown): v is TimerScope {
	return typeof v === 'string' && (TIMER_SCOPES as readonly string[]).includes(v);
}

/** Cek apakah sebuah nilai string termasuk QuestionType. */
export function isQuestionType(v: unknown): v is QuestionType {
	return typeof v === 'string' && (QUESTION_TYPES as readonly string[]).includes(v);
}

/** Cek apakah sebuah nilai string termasuk ResponseStatus. */
export function isResponseStatus(v: unknown): v is ResponseStatus {
	return typeof v === 'string' && (RESPONSE_STATUSES as readonly string[]).includes(v);
}

/** Cek apakah sebuah nilai string termasuk AuditEventType. */
export function isAuditEventType(v: unknown): v is AuditEventType {
	return typeof v === 'string' && (AUDIT_EVENT_TYPES as readonly string[]).includes(v);
}

/** Cek apakah tipe pertanyaan memakai daftar opsi. */
export function hasOptions(type: QuestionType): boolean {
	return (OPTION_QUESTION_TYPES as readonly string[]).includes(type);
}

/** Cek apakah tipe pertanyaan dapat dinilai otomatis. */
export function isScorable(type: QuestionType): boolean {
	return (SCORABLE_QUESTION_TYPES as readonly string[]).includes(type);
}

/** Cek apakah tipe pertanyaan mendukung jawaban ganda (array). */
export function isMultiValue(type: QuestionType): boolean {
	return (MULTI_VALUE_QUESTION_TYPES as readonly string[]).includes(type);
}
