/**
 * api.ts — Klien API browser untuk Modul M7 (Dasbor/Respons/Bank Soal).
 *
 * Menyimpan kredensial tenant (slug + api key) di localStorage dan mengirimnya
 * sebagai header `x-tenant` / `x-api-key` pada setiap permintaan (kontrak §4).
 *
 * Kredensial TIDAK pernah dikirim ke server lewat query/body — hanya header —
 * agar tidak bocor ke log/URL. Semua fungsi melempar `ApiClientError` berisi
 * status HTTP + pesan agar UI dapat menampilkannya dengan ramah.
 */

const LS_KEY = 'formku.credentials';

export interface Credentials {
	slug: string;
	apiKey: string;
}

/** Error API dengan status HTTP. */
export class ApiClientError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiClientError';
		this.status = status;
	}
}

/* ------------------------ Kredensial (localStorage) ------------------------ */

/** Baca kredensial tersimpan (null bila belum ada / localStorage tak tersedia). */
export function loadCredentials(): Credentials | null {
	try {
		const raw = localStorage.getItem(LS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<Credentials>;
		if (typeof parsed.slug === 'string' && typeof parsed.apiKey === 'string' && parsed.slug) {
			return { slug: parsed.slug, apiKey: parsed.apiKey };
		}
		return null;
	} catch {
		return null;
	}
}

/** Simpan kredensial. */
export function saveCredentials(creds: Credentials): void {
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(creds));
	} catch {
		/* localStorage bisa diblokir; abaikan. */
	}
}

/** Hapus kredensial (logout). */
export function clearCredentials(): void {
	try {
		localStorage.removeItem(LS_KEY);
	} catch {
		/* abaikan */
	}
}

/* --------------------------------- Fetch --------------------------------- */

interface RequestOptions {
	method?: string;
	body?: unknown;
	/** Bila true, kembalikan teks mentah (bukan JSON), mis. untuk CSV. */
	raw?: boolean;
	signal?: AbortSignal;
}

/** Lakukan permintaan API tenant. Melempar ApiClientError pada status >= 400. */
export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
	const creds = loadCredentials();
	if (!creds) {
		throw new ApiClientError(401, 'Belum masuk. Masukkan kredensial tenant di halaman Masuk.');
	}

	const headers: Record<string, string> = {
		'x-tenant': creds.slug,
		'x-api-key': creds.apiKey
	};

	let body: string | undefined;
	if (opts.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		body = JSON.stringify(opts.body);
	}

	let res: Response;
	try {
		res = await fetch(path, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
	} catch (e) {
		throw new ApiClientError(0, e instanceof Error ? e.message : 'koneksi gagal');
	}

	if (!res.ok) {
		let message = `Permintaan gagal (${res.status})`;
		try {
			const data = (await res.json()) as Record<string, unknown>;
			if (typeof data.error === 'string') message = data.error;
			else if (typeof data.message === 'string') message = data.message;
		} catch {
			/* respons non-JSON; pakai pesan default */
		}
		throw new ApiClientError(res.status, message);
	}

	if (opts.raw) return (await res.text()) as unknown as T;
	if (res.status === 204) return undefined as T;
	return (await res.json()) as T;
}

/* ------------------------------- Tipe data ------------------------------- */

export interface FormSummary {
	id: number;
	tenant_id: number;
	title: string;
	slug: string;
	description: string | null;
	mode: string;
	status: string;
	timer_seconds: number | null;
	passing_grade: number | null;
	show_score: boolean;
	question_count?: number;
	response_count?: number;
	created_at: string;
}

export interface ResponseItem {
	id: number;
	form_id: number;
	respondent_name: string | null;
	respondent_email: string | null;
	status: 'in_progress' | 'submitted' | 'locked';
	started_at: string;
	submitted_at: string | null;
	duration_seconds: number | null;
	score: number | null;
	max_score: number | null;
	answered_count?: number;
}

export interface BankQuestion {
	id: number;
	tenant_id: number;
	type: string;
	label: string;
	options_json: Array<{ label: string; value: string }> | null;
	correct_json: Record<string, unknown> | null;
	points: number;
	tags: string | null;
	created_at: string;
}

export interface QuestionStat {
	question_id: number;
	label: string;
	type: string;
	points: number;
	answered: number;
	correct: number;
	wrong: number;
	accuracy: number | null;
}

export interface AnalyticsSummary {
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

export interface Analytics {
	form_id: number;
	title: string;
	mode: string;
	passing_grade: number | null;
	show_score: boolean;
	summary: AnalyticsSummary;
	questions: QuestionStat[];
	hardest: QuestionStat[];
}

/* ------------------------------ Endpoint M7 ------------------------------ */

/** Ringkasan tenant + statistik (dipakai dasbor & verifikasi kredensial). */
export interface TenantMe {
	tenant: { id: number; slug: string; name: string; status: string };
	stats: { forms: number; responses: number };
}

export function getTenantMe() {
	return apiFetch<TenantMe>('/api/tenant/me');
}

export function listForms(params: { status?: string; mode?: string; q?: string } = {}) {
	const qs = new URLSearchParams();
	if (params.status) qs.set('status', params.status);
	if (params.mode) qs.set('mode', params.mode);
	if (params.q) qs.set('q', params.q);
	const q = qs.toString();
	return apiFetch<{ forms: FormSummary[] }>(`/api/forms${q ? `?${q}` : ''}`);
}

export function listResponses(
	formId: number,
	params: { status?: string; q?: string; sort?: string; limit?: number; offset?: number } = {}
) {
	const qs = new URLSearchParams();
	if (params.status) qs.set('status', params.status);
	if (params.q) qs.set('q', params.q);
	if (params.sort) qs.set('sort', params.sort);
	if (params.limit !== undefined) qs.set('limit', String(params.limit));
	if (params.offset !== undefined) qs.set('offset', String(params.offset));
	const q = qs.toString();
	return apiFetch<{
		form: FormSummary;
		responses: ResponseItem[];
		total: number;
		limit: number;
		offset: number;
	}>(`/api/forms/${formId}/responses${q ? `?${q}` : ''}`);
}

export function getAnalytics(formId: number) {
	return apiFetch<{ form: FormSummary; analytics: Analytics }>(`/api/forms/${formId}/analytics`);
}

export function listBank(params: { q?: string; type?: string; tag?: string; limit?: number; offset?: number } = {}) {
	const qs = new URLSearchParams();
	if (params.q) qs.set('q', params.q);
	if (params.type) qs.set('type', params.type);
	if (params.tag) qs.set('tag', params.tag);
	if (params.limit !== undefined) qs.set('limit', String(params.limit));
	if (params.offset !== undefined) qs.set('offset', String(params.offset));
	const q = qs.toString();
	return apiFetch<{ questions: BankQuestion[]; total: number; limit: number; offset: number }>(
		`/api/bank${q ? `?${q}` : ''}`
	);
}

export function createBankQuestion(body: unknown) {
	return apiFetch<BankQuestion>('/api/bank', { method: 'POST', body });
}

export function updateBankQuestion(id: number, body: unknown) {
	return apiFetch<BankQuestion>(`/api/bank/${id}`, { method: 'PUT', body });
}

export function deleteBankQuestion(id: number) {
	return apiFetch<{ deleted: boolean; id: number }>(`/api/bank/${id}`, { method: 'DELETE' });
}

export interface ImportResult {
	imported: number;
	total: number;
	truncated?: number;
	errors?: Array<{ row: number; message: string }>;
	questions?: BankQuestion[];
}

export function importBankCsv(csv: string) {
	return apiFetch<ImportResult>('/api/bank/import-csv', { method: 'POST', body: { csv } });
}

/* --------------------------------- Util --------------------------------- */

/** Bangun URL ekspor CSV (diunduh langsung oleh browser; header via fetch di komponen). */
export function responsesCsvPath(formId: number, params: { status?: string; q?: string } = {}): string {
	const qs = new URLSearchParams();
	if (params.status) qs.set('status', params.status);
	if (params.q) qs.set('q', params.q);
	const q = qs.toString();
	return `/api/forms/${formId}/responses.csv${q ? `?${q}` : ''}`;
}

/** Format detik → "1m 20s" / "45s" / "—". */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return '—';
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const mm = m % 60;
	return mm ? `${h}j ${mm}m` : `${h}j`;
}

/** Format tanggal ISO → string lokal ringkas. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
