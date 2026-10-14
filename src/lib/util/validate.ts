/**
 * validate.ts — Validasi input FormKu (Modul M1).
 *
 * Dipakai server-side SEBELUM simpan (contrat §4 "Semua input divalidasi &
 * disanitasi server-side"). Fungsi mengembalikan hasil terstruktur (tidak throw),
 * agar pemanggil dapat memetakan ke respons HTTP 400.
 *
 * Fokus: validasi BENTUK & BATAS. Sanitasi teks ada di util/sanitize.ts.
 */

import {
	CONDITION_ACTIONS,
	CONDITION_OPERATORS,
	FORM_MODES,
	FORM_STATUSES,
	LIMITS,
	MULTI_VALUE_QUESTION_TYPES,
	NUMERIC_BOUNDS,
	OPTION_QUESTION_TYPES,
	QUESTION_TYPES,
	RESPONSE_STATUSES,
	SLUG_RE,
	TIMER_SCOPES,
	TENANT_STATUSES,
	type ConditionAction,
	type ConditionOperator,
	type FormMode,
	type FormStatus,
	type QuestionOption,
	type QuestionType,
	type ResponseStatus,
	type TimerScope
} from '../types.js';
import { EMAIL_RE } from '../types.js';

/** Hasil validasi generik. */
export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: string[] };

/** Helper sukses. */
export function ok<T>(value: T): ValidationResult<T> {
	return { ok: true, value };
}

/** Helper gagal. */
export function fail<T = never>(...errors: string[]): ValidationResult<T> {
	return { ok: false, errors };
}

/* ------------------------------------------------------------------ *
 * Validator primitif
 * ------------------------------------------------------------------ */

/** Cek string tak kosong (setelah trim). */
export function isNonEmptyString(v: unknown): v is string {
	return typeof v === 'string' && v.trim().length > 0;
}

/** Validasi slug (lowercase, angka, tanda hubung, batas panjang). */
export function isValidSlug(v: unknown): boolean {
	return typeof v === 'string' && v.length > 0 && v.length <= LIMITS.slug && SLUG_RE.test(v);
}

/** Validasi email (bentuk dasar + batas panjang). */
export function isValidEmail(v: unknown): boolean {
	if (typeof v !== 'string') return false;
	const t = v.trim();
	return t.length > 0 && t.length <= LIMITS.email && EMAIL_RE.test(t);
}

/** Validasi tanggal ISO `YYYY-MM-DD` yang benar-benar ada di kalender. */
export function isValidDate(v: unknown): boolean {
	if (typeof v !== 'string') return false;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
	if (!m) return false;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const d = new Date(Date.UTC(year, month - 1, day));
	return (
		d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
	);
}

/** Validasi angka dalam rentang (inklusif). */
export function isNumberInRange(v: unknown, min: number, max: number): boolean {
	return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Batas panjang string. */
export function isWithinLength(v: unknown, max: number): boolean {
	return typeof v === 'string' && v.length <= max;
}

/** Termasuk (whitelist) salah satu nilai. */
export function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
	return typeof v === 'string' && (allowed as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * Validator entitas
 * ------------------------------------------------------------------ */

/** Payload tenant baru. */
export interface TenantInput {
	slug: string;
	name: string;
	owner_email?: string | null;
}

/** Validasi payload pembuatan tenant. */
export function validateTenant(input: unknown): ValidationResult<TenantInput> {
	const errors: string[] = [];
	if (typeof input !== 'object' || input === null) return fail('Body harus berupa objek');
	const o = input as Record<string, unknown>;
	if (!isValidSlug(o.slug)) errors.push('slug tidak valid (lowercase, angka, tanda hubung)');
	if (!isNonEmptyString(o.name)) errors.push('name wajib diisi');
	else if (!isWithinLength(o.name, LIMITS.title)) errors.push(`name maksimum ${LIMITS.title} karakter`);
	let email: string | null | undefined;
	if (o.owner_email !== undefined && o.owner_email !== null && o.owner_email !== '') {
		if (!isValidEmail(o.owner_email)) errors.push('owner_email tidak valid');
		else email = (o.owner_email as string).trim();
	}
	if (errors.length) return fail(...errors);
	return ok({
		slug: (o.slug as string).trim(),
		name: String(o.name).trim(),
		owner_email: email ?? null
	});
}

/** Payload form baru/update. */
export interface FormInput {
	title: string;
	description?: string | null;
	mode: FormMode;
	status?: FormStatus;
	timer_seconds?: number | null;
	timer_scope?: TimerScope;
	shuffle_questions?: boolean;
	shuffle_options?: boolean;
	bank_pick_count?: number | null;
	passing_grade?: number | null;
	show_score?: boolean;
	require_token?: boolean;
	thanks_text?: string | null;
}

/** Validasi payload form. `partial=true` untuk update (semua field opsional). */
export function validateForm(input: unknown, partial = false): ValidationResult<FormInput> {
	const errors: string[] = [];
	if (typeof input !== 'object' || input === null) return fail('Body harus berupa objek');
	const o = input as Record<string, unknown>;

	if (!partial || o.title !== undefined) {
		if (!isNonEmptyString(o.title)) errors.push('title wajib diisi');
		else if (!isWithinLength(o.title, LIMITS.title)) errors.push(`title maksimum ${LIMITS.title} karakter`);
	}
	if (o.description !== undefined && o.description !== null) {
		if (!isWithinLength(o.description, LIMITS.description))
			errors.push(`description maksimum ${LIMITS.description} karakter`);
	}
	if (!partial || o.mode !== undefined) {
		if (!isOneOf(o.mode, FORM_MODES)) errors.push(`mode harus salah satu dari ${FORM_MODES.join('|')}`);
	}
	if (o.status !== undefined && !isOneOf(o.status, FORM_STATUSES))
		errors.push(`status harus salah satu dari ${FORM_STATUSES.join('|')}`);
	if (o.timer_seconds !== undefined && o.timer_seconds !== null) {
		if (typeof o.timer_seconds !== 'number' || !Number.isInteger(o.timer_seconds) || o.timer_seconds < 0)
			errors.push('timer_seconds harus integer >= 0 atau null');
	}
	if (o.timer_scope !== undefined && !isOneOf(o.timer_scope, TIMER_SCOPES))
		errors.push(`timer_scope harus salah satu dari ${TIMER_SCOPES.join('|')}`);
	if (o.bank_pick_count !== undefined && o.bank_pick_count !== null) {
		if (
			typeof o.bank_pick_count !== 'number' ||
			!Number.isInteger(o.bank_pick_count) ||
			o.bank_pick_count < 1
		)
			errors.push('bank_pick_count harus integer >= 1 atau null');
	}
	if (o.passing_grade !== undefined && o.passing_grade !== null) {
		if (!isNumberInRange(o.passing_grade, 0, 100))
			errors.push('passing_grade harus 0–100 atau null');
	}
	for (const b of ['shuffle_questions', 'shuffle_options', 'show_score', 'require_token'] as const) {
		if (o[b] !== undefined && typeof o[b] !== 'boolean') errors.push(`${b} harus boolean`);
	}
	if (o.thanks_text !== undefined && o.thanks_text !== null) {
		if (!isWithinLength(o.thanks_text, LIMITS.description))
			errors.push(`thanks_text maksimum ${LIMITS.description} karakter`);
	}
	if (errors.length) return fail(...errors);
	return { ok: true, value: o as unknown as FormInput };
}

/** Payload pertanyaan. */
export interface QuestionInput {
	type: QuestionType;
	label: string;
	help_text?: string | null;
	required?: boolean;
	points?: number;
	section_id?: number | null;
	sort?: number;
}

/** Validasi payload pertanyaan. `partial=true` untuk update. */
export function validateQuestion(input: unknown, partial = false): ValidationResult<QuestionInput> {
	const errors: string[] = [];
	if (typeof input !== 'object' || input === null) return fail('Body harus berupa objek');
	const o = input as Record<string, unknown>;

	if (!partial || o.type !== undefined) {
		if (!isOneOf(o.type, QUESTION_TYPES))
			errors.push(`type harus salah satu dari ${QUESTION_TYPES.join('|')}`);
	}
	if (!partial || o.label !== undefined) {
		if (!isNonEmptyString(o.label)) errors.push('label wajib diisi');
		else if (!isWithinLength(o.label, LIMITS.label)) errors.push(`label maksimum ${LIMITS.label} karakter`);
	}
	if (o.help_text !== undefined && o.help_text !== null) {
		if (!isWithinLength(o.help_text, LIMITS.helpText))
			errors.push(`help_text maksimum ${LIMITS.helpText} karakter`);
	}
	if (o.required !== undefined && typeof o.required !== 'boolean') errors.push('required harus boolean');
	if (o.points !== undefined) {
		if (typeof o.points !== 'number' || !Number.isInteger(o.points) || o.points < 0)
			errors.push('points harus integer >= 0');
	}
	if (o.section_id !== undefined && o.section_id !== null) {
		if (typeof o.section_id !== 'number' || !Number.isInteger(o.section_id) || o.section_id < 1)
			errors.push('section_id harus integer >= 1 atau null');
	}
	if (o.sort !== undefined && (typeof o.sort !== 'number' || !Number.isInteger(o.sort)))
		errors.push('sort harus integer');
	if (errors.length) return fail(...errors);
	return { ok: true, value: o as unknown as QuestionInput };
}

/** Validasi daftar opsi pertanyaan. */
export function validateOptions(
	options: unknown,
	type: QuestionType
): ValidationResult<QuestionOption[]> {
	if (!OPTION_QUESTION_TYPES.includes(type)) {
		// Tipe non-opsi: boleh kosong.
		return ok([]);
	}
	if (!Array.isArray(options)) return fail('options harus berupa array');
	if (options.length === 0) return fail('options tidak boleh kosong untuk tipe ini');
	if (options.length > LIMITS.options) return fail(`options maksimum ${LIMITS.options}`);
	const out: QuestionOption[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < options.length; i++) {
		const raw = options[i];
		if (typeof raw !== 'object' || raw === null) return fail(`options[${i}] harus objek`);
		const r = raw as Record<string, unknown>;
		if (!isNonEmptyString(r.label)) return fail(`options[${i}].label wajib diisi`);
		if (!isWithinLength(r.label, LIMITS.label)) return fail(`options[${i}].label terlalu panjang`);
		const value = r.value === undefined || r.value === null ? r.label : r.value;
		if (typeof value !== 'string' || !isWithinLength(value, LIMITS.optionValue))
			return fail(`options[${i}].value tidak valid`);
		if (seen.has(value)) return fail(`options[${i}].value duplikat: ${value}`);
		seen.add(value);
		out.push({ label: String(r.label).trim(), value });
	}
	return ok(out);
}

/** Validasi satu kondisi logika (F17). */
export interface ConditionInput {
	depends_on_question_id: number;
	operator: ConditionOperator;
	compare_value?: string | null;
	action: ConditionAction;
}

/** Validasi payload kondisi. */
export function validateCondition(input: unknown): ValidationResult<ConditionInput> {
	const errors: string[] = [];
	if (typeof input !== 'object' || input === null) return fail('Body harus berupa objek');
	const o = input as Record<string, unknown>;
	if (typeof o.depends_on_question_id !== 'number' || !Number.isInteger(o.depends_on_question_id))
		errors.push('depends_on_question_id harus integer');
	if (!isOneOf(o.operator, CONDITION_OPERATORS))
		errors.push(`operator harus salah satu dari ${CONDITION_OPERATORS.join('|')}`);
	if (!isOneOf(o.action, CONDITION_ACTIONS))
		errors.push(`action harus salah satu dari ${CONDITION_ACTIONS.join('|')}`);
	if (o.compare_value !== undefined && o.compare_value !== null && typeof o.compare_value !== 'string')
		errors.push('compare_value harus string atau null');
	if (errors.length) return fail(...errors);
	return {
		ok: true,
		value: {
			depends_on_question_id: o.depends_on_question_id as number,
			operator: o.operator as ConditionOperator,
			compare_value: (o.compare_value as string | null | undefined) ?? null,
			action: o.action as ConditionAction
		}
	};
}

/** Konteks validasi jawaban satu pertanyaan. */
export interface AnswerValidationContext {
	type: QuestionType;
	required?: boolean;
	settings?: { options?: QuestionOption[]; min?: number; max?: number } | null;
}

/**
 * Validasi bentuk jawaban terhadap tipe pertanyaan + aturan wajib.
 * Mengembalikan `ok` bila bentuk valid (bukan pemeriksaan kunci jawaban).
 * Nilai `null`/`undefined`/string kosong dianggap "tidak dijawab".
 *
 * @param value nilai mentah jawaban
 * @param ctx konteks pertanyaan
 */
export function validateAnswer(
	value: unknown,
	ctx: AnswerValidationContext
): ValidationResult<unknown> {
	const isEmpty =
		value === null ||
		value === undefined ||
		(typeof value === 'string' && value.trim() === '') ||
		(Array.isArray(value) && value.length === 0);

	if (isEmpty) {
		if (ctx.required) return fail('Pertanyaan ini wajib dijawab');
		return ok(null);
	}

	const type = ctx.type;
	const opts = ctx.settings?.options ?? [];
	const validValues = new Set(opts.map((o) => o.value));

	switch (type) {
		case 'short_text': {
			if (typeof value !== 'string') return fail('Jawaban harus berupa teks');
			if (!isWithinLength(value, LIMITS.shortText)) return fail('Jawaban terlalu panjang');
			return ok(value);
		}
		case 'long_text': {
			if (typeof value !== 'string') return fail('Jawaban harus berupa teks');
			if (!isWithinLength(value, LIMITS.longText)) return fail('Jawaban terlalu panjang');
			return ok(value);
		}
		case 'email': {
			if (!isValidEmail(value)) return fail('Format email tidak valid');
			return ok((value as string).trim());
		}
		case 'date': {
			if (!isValidDate(value)) return fail('Format tanggal harus YYYY-MM-DD yang valid');
			return ok(value);
		}
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Jawaban harus berupa angka');
			const min = ctx.settings?.min ?? NUMERIC_BOUNDS.number.min;
			const max = ctx.settings?.max ?? NUMERIC_BOUNDS.number.max;
			if (!isNumberInRange(value, min, max)) return fail(`Nilai harus antara ${min} dan ${max}`);
			return ok(value);
		}
		case 'rating':
		case 'scale': {
			if (typeof value !== 'number' || !Number.isInteger(value)) return fail('Jawaban harus bilangan bulat');
			const min = ctx.settings?.min ?? NUMERIC_BOUNDS[type].min;
			const max = ctx.settings?.max ?? NUMERIC_BOUNDS[type].defaultMax;
			if (!isNumberInRange(value, min, max)) return fail(`Nilai harus antara ${min} dan ${max}`);
			return ok(value);
		}
		case 'radio':
		case 'dropdown': {
			if (typeof value !== 'string') return fail('Jawaban harus salah satu opsi');
			if (validValues.size && !validValues.has(value)) return fail('Jawaban bukan opsi yang valid');
			return ok(value);
		}
		case 'checkbox': {
			if (!Array.isArray(value)) return fail('Jawaban harus berupa array opsi');
			const out: string[] = [];
			const seen = new Set<string>();
			for (const v of value) {
				if (typeof v !== 'string') return fail('Setiap opsi harus berupa teks');
				if (validValues.size && !validValues.has(v)) return fail(`Opsi tidak valid: ${v}`);
				if (seen.has(v)) return fail(`Opsi duplikat: ${v}`);
				seen.add(v);
				out.push(v);
			}
			return ok(out);
		}
		case 'file': {
			// Jawaban file: referensi string (mis. nama/URL aman). Validasi bentuk saja.
			if (typeof value !== 'string') return fail('Jawaban file harus berupa referensi teks');
			if (!isWithinLength(value, LIMITS.shortText)) return fail('Referensi file terlalu panjang');
			return ok(value);
		}
		default:
			return fail(`Tipe pertanyaan tak didukung: ${type}`);
	}
}

/** Validasi status respons. */
export function validateResponseStatus(v: unknown): ValidationResult<ResponseStatus> {
	if (!isOneOf(v, RESPONSE_STATUSES))
		return fail(`status harus salah satu dari ${RESPONSE_STATUSES.join('|')}`);
	return ok(v);
}

/** Cek apakah jawaban bertipe multi-value (checkbox). */
export function isMultiValueAnswer(value: unknown): boolean {
	return MULTI_VALUE_QUESTION_TYPES.length > 0 && Array.isArray(value);
}

/** Validasi status tenant. */
export function validateTenantStatus(v: unknown): ValidationResult<'active' | 'suspended'> {
	if (!isOneOf(v, TENANT_STATUSES))
		return fail(`status harus salah satu dari ${TENANT_STATUSES.join('|')}`);
	return ok(v);
}
