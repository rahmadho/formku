/**
 * respondent.ts — Logika murni UI isi form (Modul M6).
 *
 * Semua fungsi di sini BEBAS efek samping & BEBAS akses DOM/jaringan sehingga
 * dapat diuji unit (tests/respondent.test.ts). Komponen Svelte memakainya untuk
 * menentukan: soal mana yang tampil, section mana yang aktif, sisa timer, dan
 * apakah form boleh dikirim.
 *
 * Penting: file ini TIDAK memuat kunci jawaban. Hanya bekerja dengan bentuk
 * publik `PublicQuestion` (proyeksi M4 yang sudah membuang `correct_json`).
 */
import type { ConditionAction, ConditionOperator, PublicQuestion } from './respondent-types.js';

/* ------------------------------------------------------------------ *
 * Bentuk data publik yang dipakai UI (mirror balasan GET publik M4)  *
 * ------------------------------------------------------------------ */

export type { PublicQuestion, PublicQuestionSettings } from './respondent-types.js';

/** Kondisi logika (F17) seperti dikirim GET publik. */
export interface PublicCondition {
	question_id: number;
	depends_on_question_id: number;
	operator: ConditionOperator;
	compare_value: string | null;
	action: ConditionAction;
}

/** Section publik seperti dikirim GET publik. */
export interface PublicSection {
	id: number;
	title: string;
	description: string | null;
	sort: number;
	timer_seconds: number | null;
}

/** Meta form publik (tanpa kunci jawaban). */
export interface PublicForm {
	title: string;
	slug: string;
	description: string | null;
	mode: string;
	timer_seconds: number | null;
	timer_scope: 'form' | 'section';
	shuffle_questions: boolean;
	shuffle_options: boolean;
	require_token: boolean;
	show_score: boolean;
	passing_grade: number | null;
	theme: Record<string, unknown> | null;
	thanks_text: string | null;
}

/** Nilai jawaban satu soal (bentuk bergantung tipe). */
export type AnswerValue = string | number | Array<string | number> | null;

/** Peta jawaban: question_id → nilai. */
export type AnswerMap = Record<number, AnswerValue>;

/* ------------------------------------------------------------------ *
 * Normalisasi nilai jawaban                                          *
 * ------------------------------------------------------------------ */

/** Apakah nilai dianggap "kosong" (belum dijawab)? Selaras validateAnswer server. */
export function isEmptyAnswer(value: AnswerValue | undefined): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/**
 * Bandingkan nilai jawaban dengan `compare_value` (string dari kondisi) memakai
 * operator F17. Nilai array (checkbox) dianggap cocok bila ADA satu anggota
 * yang cocok untuk `equals`/`contains`.
 */
export function matchesCondition(
	operator: ConditionOperator,
	value: AnswerValue | undefined,
	compareValue: string | null
): boolean {
	const cmp = compareValue ?? '';
	const asStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

	if (Array.isArray(value)) {
		// checkbox: "berisi" bila salah satu anggota cocok.
		const arr = value.map(asStr);
		switch (operator) {
			case 'equals':
			case 'contains':
				return arr.includes(cmp);
			case 'not_equals':
				return !arr.includes(cmp);
			case 'gt':
			case 'lt': {
				// Bandingkan secara numerik terhadap anggota terbesar/terkecil.
				const nums = arr.map(Number).filter((n) => Number.isFinite(n));
				if (!nums.length) return false;
				const target = Number(cmp);
				if (!Number.isFinite(target)) return false;
				return operator === 'gt' ? Math.max(...nums) > target : Math.min(...nums) < target;
			}
		}
	}

	const s = asStr(value);
	switch (operator) {
		case 'equals':
			return s === cmp;
		case 'not_equals':
			return s !== cmp;
		case 'contains':
			return s.includes(cmp);
		case 'gt': {
			const a = Number(s);
			const b = Number(cmp);
			return Number.isFinite(a) && Number.isFinite(b) && a > b;
		}
		case 'lt': {
			const a = Number(s);
			const b = Number(cmp);
			return Number.isFinite(a) && Number.isFinite(b) && a < b;
		}
		default:
			return false;
	}
}

/**
 * Tentukan apakah sebuah soal harus TAMPIL berdasarkan kondisi F17.
 *
 * Aturan (default-buka untuk mencegah soal "menghilang" karena salah konfigurasi):
 *   - Tanpa kondisi untuk soal ini → tampil.
 *   - action='show' → tampil HANYA bila SEMUA kondisi show terpenuhi.
 *   - action='hide' → sembunyikan bila ADA kondisi hide terpenuhi.
 */
export function isQuestionVisible(
	question: PublicQuestion,
	answers: AnswerMap,
	conditions: readonly PublicCondition[]
): boolean {
	const own = conditions.filter((c) => c.question_id === question.id);
	if (!own.length) return true;

	const showConds = own.filter((c) => c.action === 'show');
	const hideConds = own.filter((c) => c.action === 'hide');

	// Aturan hide menang: cukup satu yang terpenuhi → sembunyikan.
	for (const c of hideConds) {
		if (matchesCondition(c.operator, answers[c.depends_on_question_id], c.compare_value)) {
			return false;
		}
	}

	// Bila ada aturan show, wajib semuanya terpenuhi.
	if (showConds.length) {
		return showConds.every((c) =>
			matchesCondition(c.operator, answers[c.depends_on_question_id], c.compare_value)
		);
	}

	return true;
}

/**
 * Sekumpulan id soal yang saat ini tampil (lolos kondisi). Dipakai untuk
 * menentukan `required` hanya pada soal yang benar-benar terlihat.
 */
export function visibleQuestionIds(
	questions: readonly PublicQuestion[],
	answers: AnswerMap,
	conditions: readonly PublicCondition[]
): Set<number> {
	const out = new Set<number>();
	for (const q of questions) {
		if (isQuestionVisible(q, answers, conditions)) out.add(q.id);
	}
	return out;
}

/* ------------------------------------------------------------------ *
 * Pengelompokan section (F4)                                          *
 * ------------------------------------------------------------------ */

/** Satu langkah/bagian dalam form: section berisi soal, atau "tanpa section". */
export interface SectionView {
	/** id section, atau null untuk soal tanpa section. */
	id: number | null;
	title: string;
	description: string | null;
	/** Detik timer untuk section ini (bila scope='section'), jika ada. */
	timer_seconds: number | null;
	questions: PublicQuestion[];
}

/**
 * Susun daftar soal menjadi urutan section untuk navigasi.
 *
 * - Soal dikelompokkan menurut `section_id`, mempertahankan urutan soal
 *   (yang mungkin sudah teracak oleh server).
 * - Section kosong (tanpa soal) dipertahankan agar deskripsi/petunjuknya tampil.
 * - Soal tanpa section diletakkan dalam satu grup pembuka bila ada.
 * - Bila `sections` kosong (form tanpa section), seluruh soal jadi satu bagian.
 */
export function buildSectionViews(
	sections: readonly PublicSection[],
	questions: readonly PublicQuestion[]
): SectionView[] {
	const bySection = new Map<number, PublicQuestion[]>();
	const orphans: PublicQuestion[] = [];

	for (const q of questions) {
		if (q.section_id === null || q.section_id === undefined) {
			orphans.push(q);
			continue;
		}
		const list = bySection.get(q.section_id);
		if (list) list.push(q);
		else bySection.set(q.section_id, [q]);
	}

	const views: SectionView[] = [];

	// Soal tanpa section → bagian pembuka (judul "Bagian 1" bila tak ada section lain).
	if (orphans.length) {
		views.push({
			id: null,
			title: sections.length ? 'Pertanyaan Umum' : 'Formulir',
			description: null,
			timer_seconds: null,
			questions: orphans
		});
	}

	const ordered = [...sections].sort((a, b) => a.sort - b.sort || a.id - b.id);
	for (const s of ordered) {
		views.push({
			id: s.id,
			title: s.title,
			description: s.description,
			timer_seconds: s.timer_seconds,
			questions: bySection.get(s.id) ?? []
		});
	}

	// Tidak ada section & tidak ada orphan (form kosong) → satu bagian kosong.
	if (!views.length) {
		views.push({
			id: null,
			title: 'Formulir',
			description: null,
			timer_seconds: null,
			questions: []
		});
	}

	return views;
}

/* ------------------------------------------------------------------ *
 * Timer (F5)                                                          *
 * ------------------------------------------------------------------ */

/**
 * Hitung sisa detik pada waktu `nowMs` untuk deadline absolut `deadlineMs`.
 * Mengembalikan integer >= 0 (dibulatkan KE ATAS agar 0.4 dtk tetap "1").
 */
export function remainingSeconds(deadlineMs: number, nowMs: number): number {
	return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** Format detik menjadi `MM:SS` (atau `HH:MM:SS` bila > 1 jam). */
export function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const pad = (n: number) => String(n).padStart(2, '0');
	return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Ambang peringatan (detik) → UI berubah merah + getar. */
export const TIMER_WARN_SECONDS = 60;

/**
 * Hitung deadline absolut (epoch ms) untuk scope tertentu.
 *
 * - scope='form'    → deadline = startedAtMs + form.timer_seconds*1000.
 * - scope='section' → BUKAN di sini; tiap section punya timer sendiri
 *                     (dihitung saat section aktif, lihat `sectionDeadline`).
 *
 * Mengembalikan null bila tanpa timer.
 */
export function formDeadline(
	form: Pick<PublicForm, 'timer_scope' | 'timer_seconds'>,
	startedAtMs: number
): number | null {
	if (form.timer_scope !== 'form') return null;
	if (!form.timer_seconds || form.timer_seconds <= 0) return null;
	return startedAtMs + form.timer_seconds * 1000;
}

/** Deadline section = waktu section diaktifkan + timer section (bila ada). */
export function sectionDeadline(
	section: Pick<SectionView, 'timer_seconds'>,
	activatedAtMs: number
): number | null {
	if (!section.timer_seconds || section.timer_seconds <= 0) return null;
	return activatedAtMs + section.timer_seconds * 1000;
}

/* ------------------------------------------------------------------ *
 * Validasi sebelum kirim (server tetap memvalidasi ulang)             *
 * ------------------------------------------------------------------ */

/** Rincian satu pelanggaran validasi. */
export interface ValidationIssue {
	question_id: number;
	section_id: number | null;
	message: string;
}

/**
 * Periksa apakah jawaban saat ini memenuhi semua soal WAJIB yang TERLIHAT.
 * Ini cek kilat di klien untuk pengalaman pengguna; server tetap memvalidasi
 * ulang (kontrak §4) — klien tidak boleh dipercaya.
 */
export function findValidationIssues(
	questions: readonly PublicQuestion[],
	answers: AnswerMap,
	conditions: readonly PublicCondition[]
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const q of questions) {
		if (!q.required) continue;
		if (!isQuestionVisible(q, answers, conditions)) continue;
		if (isEmptyAnswer(answers[q.id])) {
			issues.push({
				question_id: q.id,
				section_id: q.section_id ?? null,
				message: 'Pertanyaan ini wajib dijawab'
			});
		}
	}
	return issues;
}

/** Jumlah soal terjawab (hanya soal yang terlihat). */
export function countAnswered(
	questions: readonly PublicQuestion[],
	answers: AnswerMap,
	conditions: readonly PublicCondition[]
): { answered: number; total: number } {
	let answered = 0;
	let total = 0;
	for (const q of questions) {
		if (!isQuestionVisible(q, answers, conditions)) continue;
		total++;
		if (!isEmptyAnswer(answers[q.id])) answered++;
	}
	return { answered, total };
}

/**
 * Ubah peta jawaban menjadi array `answers[]` untuk endpoint submit.
 * Hanya menyertakan soal yang terlihat & tidak kosong, agar payload ramping.
 */
export function toSubmitAnswers(
	questions: readonly PublicQuestion[],
	answers: AnswerMap,
	conditions: readonly PublicCondition[]
): Array<{ question_id: number; value: AnswerValue }> {
	const out: Array<{ question_id: number; value: AnswerValue }> = [];
	for (const q of questions) {
		if (!isQuestionVisible(q, answers, conditions)) continue;
		const v = answers[q.id];
		if (isEmptyAnswer(v)) continue;
		out.push({ question_id: q.id, value: v });
	}
	return out;
}
