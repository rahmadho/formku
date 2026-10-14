/**
 * score.ts — Penilaian otomatis FormKu (Modul M1, fitur F8).
 *
 * Menghitung skor dari jawaban responden terhadap kunci jawaban (correct_json).
 * Mendukung tipe: radio, dropdown, checkbox, number, short_text, scale.
 *
 * Semantik:
 * - radio/dropdown/short_text/scale/number : cocok bila `value` sama dengan kunci.
 * - checkbox : skor PENUH bila himpunan jawaban persis sama dengan himpunan kunci
 *   (partial credit TIDAK diberikan secara default; lihat `allowPartialCheckbox`).
 *
 * Semua fungsi murni (pure) & deterministik — mudah diuji.
 */

import type {
	AnswerInput,
	AnswerScore,
	CorrectJson,
	QuestionLike,
	ScoreResult
} from '../types.js';
import { isScorable } from '../types.js';

/** Normalisasi nilai skalar untuk perbandingan (string/number). */
function normalizeScalar(v: unknown): string | number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string') {
		const t = v.trim();
		if (t === '') return null;
		// Bandingkan angka sebagai angka bila kedua sisi numerik.
		return t;
	}
	return String(v);
}

/** Bandingkan dua nilai skalar (angka dibandingkan longgar: "5" == 5). */
function scalarsEqual(a: unknown, b: unknown): boolean {
	const na = normalizeScalar(a);
	const nb = normalizeScalar(b);
	if (na === null || nb === null) return false;
	if (typeof na === 'number' || typeof nb === 'number') {
		const fa = Number(na);
		const fb = Number(nb);
		if (Number.isFinite(fa) && Number.isFinite(fb)) return fa === fb;
	}
	return String(na) === String(nb);
}

/** Bandingkan dua himpunan jawaban (urutan tak penting, tanpa duplikat). */
function setsEqual(a: unknown, b: unknown): boolean {
	const sa = new Set((Array.isArray(a) ? a : []).map((x) => String(x)));
	const sb = new Set((Array.isArray(b) ? b : []).map((x) => String(x)));
	if (sa.size !== sb.size) return false;
	for (const v of sa) if (!sb.has(v)) return false;
	return true;
}

/** Opsi tambahan penilaian. */
export interface ScoreOptions {
	/**
	 * Checkbox: bila true, beri kredit proporsional berdasarkan irisan benar
	 * dikurangi penalti pilihan salah (tak turun di bawah 0). Default: false
	 * (skor semua-atau-tidak-sama-sekali).
	 */
	allowPartialCheckbox?: boolean;
}

/**
 * Nilai SATU jawaban terhadap kunci. Mengembalikan objek rinci.
 * Pertanyaan tanpa kunci (correct kosong) → tidak dinilai (points 0, isCorrect true
 * hanya bila tak ada kunci? Tidak — dianggap NETRAL: isCorrect=true, poin sesuai
 * `points`). Untuk mode form (poin 0) ini tak berpengaruh.
 */
export function gradeAnswer(
	question: QuestionLike,
	answer: unknown,
	options: ScoreOptions = {}
): AnswerScore {
	const maxPoints = Math.max(0, question.points ?? 0);
	const base: AnswerScore = {
		question_id: question.id,
		isCorrect: false,
		pointsAwarded: 0,
		maxPoints
	};

	// Tipe yang tidak dapat dinilai otomatis → netral (tak salah, 0 poin).
	if (!isScorable(question.type)) {
		return { ...base, isCorrect: true, pointsAwarded: 0 };
	}

	const correct = question.correct ?? null;
	if (!correct || (correct.value === undefined && correct.values === undefined)) {
		// Tak ada kunci → netral (jangan salahkan responden).
		return { ...base, isCorrect: true, pointsAwarded: 0 };
	}

	// Array kosong / null → salah (bila ada kunci & required semantics: tetap salah).
	if (answer === null || answer === undefined || (typeof answer === 'string' && answer.trim() === '')) {
		return base;
	}
	if (Array.isArray(answer) && answer.length === 0) return base;

	if (question.type === 'checkbox') {
		const key = (correct.values ?? (correct.value !== undefined ? [correct.value] : [])) as unknown[];
		const given = Array.isArray(answer) ? answer : [answer];
		const exact = setsEqual(given, key);
		if (exact) {
			return { ...base, isCorrect: true, pointsAwarded: maxPoints };
		}
		if (options.allowPartialCheckbox) {
			const keySet = new Set(key.map((x) => String(x)));
			const givenSet = new Set(given.map((x) => String(x)));
			let hits = 0;
			for (const v of givenSet) if (keySet.has(v)) hits++;
			let wrong = 0;
			for (const v of givenSet) if (!keySet.has(v)) wrong++;
			const denom = keySet.size || 1;
			const ratio = Math.max(0, Math.min(1, (hits - wrong) / denom));
			return {
				question_id: question.id,
				isCorrect: ratio >= 1,
				pointsAwarded: Math.round(ratio * maxPoints),
				maxPoints
			};
		}
		return base;
	}

	// Skalar (radio/dropdown/number/short_text/scale).
	const keyValue = correct.value !== undefined ? correct.value : correct.values?.[0];
	if (scalarsEqual(answer, keyValue)) {
		return { ...base, isCorrect: true, pointsAwarded: maxPoints };
	}
	return base;
}

/**
 * Nilai SELURUH jawaban responden terhadap daftar pertanyaan.
 * `answers` boleh berisi sebagian pertanyaan (yang tidak dijawab → salah/0),
 * atau pertanyaan tambahan yang tidak dikenal (diabaikan dari maxScore).
 */
export function gradeSubmission(
	questions: readonly QuestionLike[],
	answers: readonly AnswerInput[],
	options: ScoreOptions = {}
): ScoreResult {
	const answerMap = new Map<number, unknown>();
	for (const a of answers) {
		if (a && typeof a.question_id === 'number') answerMap.set(a.question_id, a.value);
	}

	const details: AnswerScore[] = [];
	let score = 0;
	let maxScore = 0;
	let graded = 0;

	for (const q of questions) {
		const points = Math.max(0, q.points ?? 0);
		maxScore += points;
		const hasAnswer = answerMap.has(q.id);
		const raw = hasAnswer ? answerMap.get(q.id) : null;
		const result = gradeAnswer(q, raw, options);
		details.push(result);
		score += result.pointsAwarded;
		if (isScorable(q.type)) graded++;
	}

	return { score, maxScore, percent: percentOf(score, maxScore), graded, details };
}

/** Persentase skor (dibulatkan) terhadap maxScore. maxScore 0 → 0. */
export function percentOf(score: number, maxScore: number): number {
	if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return 0;
	const pct = (score / maxScore) * 100;
	return Math.round(pct);
}

/** Cek lulus berdasarkan passing grade (persen). passing null → selalu true. */
export function isPassed(score: number, maxScore: number, passingGrade: number | null | undefined): boolean {
	if (passingGrade === null || passingGrade === undefined) return true;
	return percentOf(score, maxScore) >= passingGrade;
}

/**
 * Jumlahkan poin maksimum seluruh pertanyaan yang dapat dinilai (untuk tampilan).
 */
export function maxScoreOf(questions: readonly QuestionLike[]): number {
	return questions.reduce((sum, q) => sum + Math.max(0, q.points ?? 0), 0);
}

/** Bangun CorrectJson dari daftar nilai (helper untuk bank soal / impor CSV). */
export function makeCorrect(values: Array<string | number>): CorrectJson {
	if (values.length <= 1) return { value: values[0] ?? null };
	return { values: values.slice() };
}
