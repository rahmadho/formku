/**
 * respondent-types.ts — Tipe publik sisi-klien untuk UI isi form (Modul M6).
 *
 * Sengaja didefinisikan ULANG di sini (bukan mengimpor `$lib/server/...` route
 * M4) karena modul ini dipakai di BROWSER. SvelteKit melarang impor modul
 * `$lib/server/*` dari kode klien. Bentuk di bawah WAJIB tetap sinkron dengan
 * proyeksi `projectQuestionForPublic` di M4 (`routes/api/public/_lib.ts`) —
 * yaitu bentuk yang benar-benar diterima dari endpoint publik.
 *
 * Tidak ada kunci jawaban di sini; itu memang inti jaminan keamanannya.
 */
import type { QuestionType } from '../types.js';

export type { ConditionAction, ConditionOperator, QuestionType } from '../types.js';

/** Opsi pertanyaan (label + value) — aman dipublikasikan. */
export interface PublicQuestionSettings {
	options?: Array<{ label: string; value: string }>;
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	maxLength?: number;
}

/** Soal publik — TANPA `correct_json`. */
export interface PublicQuestion {
	id: number;
	section_id: number | null;
	type: QuestionType;
	label: string;
	help_text: string | null;
	required: boolean;
	points: number;
	settings: PublicQuestionSettings | null;
	sort: number;
}
