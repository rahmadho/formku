/**
 * client.ts — Klien API Creator untuk UI Builder (Modul M5, sisi-klien).
 *
 * Membungkus pemanggilan endpoint M3/M4 (kontrak §4) dengan:
 *  - penyuntikan header auth otomatis (`x-tenant` + `x-api-key`),
 *  - tipe balikan yang jelas (FormRow, SectionRow, QuestionRow, …),
 *  - normalisasi galat → `ApiClientError` (pesan siap tampil ke Creator).
 *
 * Modul ini HANYA memanggil API milik modul yang sudah ada; tidak mengubah
 * skema/endpoint. Dipakai oleh store builder (`store.svelte.ts`) dan halaman.
 */
import type { CreatorSession } from './session.js';
import type { FormMode, FormStatus, TimerScope } from '$lib/types.js';

/* ------------------------------------------------------------------ */
/* Bentuk baris (mirror balikan API — snake_case)                       */
/* ------------------------------------------------------------------ */

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

export interface SectionRow {
	id: number;
	form_id: number;
	title: string;
	description: string | null;
	sort: number;
	timer_seconds: number | null;
}

export interface QuestionOption {
	label: string;
	value: string;
}

export interface QuestionSettings {
	options?: QuestionOption[];
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	maxLength?: number;
}

export interface CorrectJson {
	value?: string | number | null;
	values?: Array<string | number>;
}

export interface QuestionRow {
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

export interface ConditionRow {
	id: number;
	question_id: number;
	depends_on_question_id: number;
	operator: string;
	compare_value: string | null;
	action: string;
}

export interface QuestionWithConditions extends QuestionRow {
	conditions: ConditionRow[];
}

export interface SectionWithQuestions extends SectionRow {
	questions: QuestionWithConditions[];
}

export interface FormStructure {
	form: FormRow;
	sections: SectionWithQuestions[];
	unassigned_questions: QuestionWithConditions[];
	conditions: ConditionRow[];
	counts: { sections: number; questions: number; conditions: number };
}

export interface PublishedInfo {
	published: boolean;
	id: number;
	slug: string;
	status: FormStatus;
	require_token: boolean;
	access_token: string | null;
	url: string;
}

/** Galat API dengan status HTTP + pesan siap tampil. */
export class ApiClientError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiClientError';
		this.status = status;
	}
}

/* ------------------------------------------------------------------ */
/* Klien                                                                */
/* ------------------------------------------------------------------ */

/** Helper fetch ber-Auth: menyuntikkan header tenant & menormalkan galat. */
async function apiFetch(
	session: CreatorSession,
	path: string,
	init: RequestInit = {}
): Promise<Response> {
	const headers = new Headers(init.headers);
	if (init.body !== undefined && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	headers.set('x-tenant', session.tenant);
	headers.set('x-api-key', session.apiKey);

	let res: Response;
	try {
		res = await fetch(path, { ...init, headers });
	} catch {
		throw new ApiClientError(0, 'Tidak dapat menghubungi server. Periksa koneksi Anda.');
	}
	return res;
}

/** Parse Response → JSON; lempar ApiClientError bila status bukan 2xx. */
async function parse<T>(res: Response): Promise<T> {
	const text = await res.text();
	let data: unknown = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
	}
	if (!res.ok) {
		const msg =
			data && typeof data === 'object' && 'error' in data
				? String((data as { error: unknown }).error)
				: `Permintaan gagal (HTTP ${res.status})`;
		throw new ApiClientError(res.status, msg);
	}
	return data as T;
}

export interface CreateFormInput {
	title: string;
	mode?: FormMode;
	description?: string | null;
	template?: 'form' | 'quiz' | 'exam';
}

/**
 * Klien API Creator. Dibuat per-sesi; tak menyimpan state selain kredensial.
 * Semua metode mengembalikan tipe tegas & melempar ApiClientError saat gagal.
 */
export class CreatorApi {
	constructor(private session: CreatorSession) {}

	/* -------------------------- Tenant -------------------------- */

	/** Profil tenant saat ini (validasi kredensial sekaligus). */
	async me(): Promise<{ tenant: { id: number; slug: string; name: string } }> {
		return parse(await apiFetch(this.session, '/api/tenant/me'));
	}

	/* --------------------------- Forms -------------------------- */

	async listForms(): Promise<{ forms: Array<FormRow & { question_count: number; response_count: number }> }> {
		return parse(await apiFetch(this.session, '/api/forms'));
	}

	async createForm(input: CreateFormInput): Promise<FormRow> {
		return parse(
			await apiFetch(this.session, '/api/forms', {
				method: 'POST',
				body: JSON.stringify(input)
			})
		);
	}

	async getForm(id: number): Promise<{ form: FormRow; sections: SectionRow[]; questions: QuestionRow[] }> {
		return parse(await apiFetch(this.session, `/api/forms/${id}`));
	}

	async getStructure(id: number): Promise<FormStructure> {
		return parse(await apiFetch(this.session, `/api/forms/${id}/structure`));
	}

	async updateForm(id: number, patch: Record<string, unknown>): Promise<FormRow> {
		return parse(
			await apiFetch(this.session, `/api/forms/${id}`, {
				method: 'PUT',
				body: JSON.stringify(patch)
			})
		);
	}

	async deleteForm(id: number): Promise<{ deleted: boolean; id: number }> {
		return parse(await apiFetch(this.session, `/api/forms/${id}`, { method: 'DELETE' }));
	}

	async publishForm(id: number, opts: { slug?: string; access_token?: string } = {}): Promise<PublishedInfo> {
		return parse(
			await apiFetch(this.session, `/api/forms/${id}/publish`, {
				method: 'POST',
				body: JSON.stringify(opts)
			})
		);
	}

	/* -------------------------- Sections ------------------------ */

	async createSection(input: {
		form_id: number;
		title: string;
		description?: string | null;
		timer_seconds?: number | null;
		sort?: number;
	}): Promise<SectionRow> {
		return parse(
			await apiFetch(this.session, '/api/sections', {
				method: 'POST',
				body: JSON.stringify(input)
			})
		);
	}

	async updateSection(id: number, patch: Record<string, unknown>): Promise<SectionRow> {
		return parse(
			await apiFetch(this.session, `/api/sections/${id}`, {
				method: 'PUT',
				body: JSON.stringify(patch)
			})
		);
	}

	async deleteSection(id: number): Promise<{ deleted: boolean; id: number }> {
		return parse(await apiFetch(this.session, `/api/sections/${id}`, { method: 'DELETE' }));
	}

	/* -------------------------- Questions ----------------------- */

	async createQuestion(input: {
		form_id: number;
		section_id?: number | null;
		type: string;
		label: string;
		help_text?: string | null;
		required?: boolean;
		points?: number;
		options?: QuestionOption[];
		correct?: CorrectJson;
		settings?: QuestionSettings;
		sort?: number;
	}): Promise<QuestionRow> {
		return parse(
			await apiFetch(this.session, '/api/questions', {
				method: 'POST',
				body: JSON.stringify(input)
			})
		);
	}

	async updateQuestion(id: number, patch: Record<string, unknown>): Promise<QuestionRow> {
		return parse(
			await apiFetch(this.session, `/api/questions/${id}`, {
				method: 'PUT',
				body: JSON.stringify(patch)
			})
		);
	}

	async deleteQuestion(id: number): Promise<{ deleted: boolean; id: number }> {
		return parse(await apiFetch(this.session, `/api/questions/${id}`, { method: 'DELETE' }));
	}

	/**
	 * Urutkan ulang soal secara massal. `order[i] = {id, sort, section_id?}`.
	 * satu transaksi di server → aman dari urutan parsial.
	 */
	async reorderQuestions(
		formId: number,
		order: Array<{ id: number; sort: number; section_id?: number | null }>
	): Promise<{ reordered: boolean; count: number }> {
		return parse(
			await apiFetch(this.session, '/api/questions/reorder', {
				method: 'POST',
				body: JSON.stringify({ form_id: formId, order })
			})
		);
	}
}
