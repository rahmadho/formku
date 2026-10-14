/**
 * score.test.ts — Uji unit Modul M1: src/lib/util/score.ts
 * Fokus: auto-scoring per tipe, skor total, persen, passing grade.
 */
import { describe, it, expect } from 'vitest';
import {
	gradeAnswer,
	gradeSubmission,
	percentOf,
	isPassed,
	maxScoreOf,
	makeCorrect
} from '../src/lib/util/score.js';
import type { QuestionLike } from '../src/lib/types.js';

function q(partial: Partial<QuestionLike> & Pick<QuestionLike, 'id' | 'type'>): QuestionLike {
	return { label: 'Q', points: 0, ...partial };
}

describe('gradeAnswer: skalar', () => {
	it('radio benar → poin penuh', () => {
		const question = q({ id: 1, type: 'radio', points: 10, correct: { value: 'A' } });
		const r = gradeAnswer(question, 'A');
		expect(r.isCorrect).toBe(true);
		expect(r.pointsAwarded).toBe(10);
	});
	it('radio salah → 0 poin', () => {
		const question = q({ id: 1, type: 'radio', points: 10, correct: { value: 'A' } });
		expect(gradeAnswer(question, 'B').pointsAwarded).toBe(0);
	});
	it('number: cocok longgar string vs angka', () => {
		const question = q({ id: 2, type: 'number', points: 5, correct: { value: 42 } });
		expect(gradeAnswer(question, '42').isCorrect).toBe(true);
		expect(gradeAnswer(question, 42).isCorrect).toBe(true);
		expect(gradeAnswer(question, 43).isCorrect).toBe(false);
	});
	it('short_text: cocok setelah trim', () => {
		const question = q({ id: 3, type: 'short_text', points: 3, correct: { value: 'Jakarta' } });
		expect(gradeAnswer(question, '  Jakarta ').isCorrect).toBe(true);
		expect(gradeAnswer(question, 'jakarta').isCorrect).toBe(false);
	});
	it('dropdown & scale', () => {
		expect(gradeAnswer(q({ id: 4, type: 'dropdown', points: 2, correct: { value: 'x' } }), 'x').isCorrect).toBe(true);
		expect(gradeAnswer(q({ id: 5, type: 'scale', points: 2, correct: { value: 4 } }), 4).isCorrect).toBe(true);
	});
});

describe('gradeAnswer: checkbox', () => {
	const question = q({ id: 1, type: 'checkbox', points: 10, correct: { values: ['A', 'C'] } });

	it('himpunan sama (urutan bebas) → penuh', () => {
		expect(gradeAnswer(question, ['C', 'A']).pointsAwarded).toBe(10);
		expect(gradeAnswer(question, ['A', 'C']).isCorrect).toBe(true);
	});
	it('subset → 0 (default all-or-nothing)', () => {
		expect(gradeAnswer(question, ['A']).pointsAwarded).toBe(0);
	});
	it('kelebihan pilihan → 0', () => {
		expect(gradeAnswer(question, ['A', 'C', 'D']).pointsAwarded).toBe(0);
	});
	it('allowPartialCheckbox: kredit proporsional dengan penalti', () => {
		// 1 benar dari 2, tanpa salah → ratio 0.5 → 5 poin.
		expect(gradeAnswer(question, ['A'], { allowPartialCheckbox: true }).pointsAwarded).toBe(5);
		// 1 benar + 1 salah dari 2 → (1-1)/2 = 0.
		expect(gradeAnswer(question, ['A', 'D'], { allowPartialCheckbox: true }).pointsAwarded).toBe(0);
		// 2 benar → 10.
		expect(gradeAnswer(question, ['A', 'C'], { allowPartialCheckbox: true }).pointsAwarded).toBe(10);
	});
});

describe('gradeAnswer: netral & tepi', () => {
	it('tipe tak dapat dinilai → netral (isCorrect true, 0 poin)', () => {
		const r = gradeAnswer(q({ id: 1, type: 'file', points: 10 }), 'x');
		expect(r.isCorrect).toBe(true);
		expect(r.pointsAwarded).toBe(0);
	});
	it('tanpa kunci → netral', () => {
		const r = gradeAnswer(q({ id: 1, type: 'radio', points: 10 }), 'A');
		expect(r.isCorrect).toBe(true);
		expect(r.pointsAwarded).toBe(0);
	});
	it('jawaban kosong dengan kunci → salah (0)', () => {
		const question = q({ id: 1, type: 'radio', points: 10, correct: { value: 'A' } });
		expect(gradeAnswer(question, '').isCorrect).toBe(false);
		expect(gradeAnswer(question, null).isCorrect).toBe(false);
		expect(gradeAnswer(question, []).isCorrect).toBe(false);
	});
	it('checkbox kunci satu nilai via value', () => {
		const question = q({ id: 1, type: 'checkbox', points: 5, correct: { value: 'A' } });
		expect(gradeAnswer(question, ['A']).isCorrect).toBe(true);
	});
});

describe('gradeSubmission', () => {
	const questions: QuestionLike[] = [
		q({ id: 1, type: 'radio', points: 10, correct: { value: 'A' } }),
		q({ id: 2, type: 'checkbox', points: 20, correct: { values: ['X', 'Y'] } }),
		q({ id: 3, type: 'short_text', points: 10, correct: { value: 'benar' } }),
		q({ id: 4, type: 'file', points: 0 })
	];

	it('menghitung skor & maxScore', () => {
		const r = gradeSubmission(questions, [
			{ question_id: 1, value: 'A' },
			{ question_id: 2, value: ['X', 'Y'] },
			{ question_id: 3, value: 'benar' }
		]);
		expect(r.score).toBe(40);
		expect(r.maxScore).toBe(40);
		expect(r.percent).toBe(100);
		expect(r.details).toHaveLength(4);
	});
	it('pertanyaan tak dijawab → 0 poin', () => {
		const r = gradeSubmission(questions, [{ question_id: 1, value: 'A' }]);
		expect(r.score).toBe(10);
		expect(r.maxScore).toBe(40);
		expect(r.percent).toBe(25);
	});
	it('jawaban salah sebagian → persen sesuai', () => {
		const r = gradeSubmission(questions, [
			{ question_id: 1, value: 'Z' },
			{ question_id: 2, value: ['X', 'Y'] }
		]);
		expect(r.score).toBe(20);
		expect(r.percent).toBe(50);
	});
	it('jawaban untuk pertanyaan tak dikenal → diabaikan', () => {
		const r = gradeSubmission(questions, [
			{ question_id: 1, value: 'A' },
			{ question_id: 999, value: 'x' }
		]);
		expect(r.score).toBe(10);
		expect(r.maxScore).toBe(40);
	});
	it('maxScore 0 → percent 0', () => {
		const r = gradeSubmission([q({ id: 1, type: 'long_text', points: 0 })], []);
		expect(r.maxScore).toBe(0);
		expect(r.percent).toBe(0);
	});
});

describe('percentOf', () => {
	it('menghitung & membulatkan', () => {
		expect(percentOf(70, 100)).toBe(70);
		expect(percentOf(1, 3)).toBe(33);
		expect(percentOf(2, 3)).toBe(67);
	});
	it('maxScore 0 / negatif → 0', () => {
		expect(percentOf(5, 0)).toBe(0);
		expect(percentOf(5, -1)).toBe(0);
	});
	it('nilai tak valid → 0', () => {
		expect(percentOf(NaN, 100)).toBe(0);
		expect(percentOf(5, NaN)).toBe(0);
	});
});

describe('isPassed', () => {
	it('passing null/undefined → selalu lulus', () => {
		expect(isPassed(0, 100, null)).toBe(true);
		expect(isPassed(0, 100, undefined)).toBe(true);
	});
	it('ambang batas inklusif', () => {
		expect(isPassed(70, 100, 70)).toBe(true);
		expect(isPassed(69, 100, 70)).toBe(false);
	});
});

describe('maxScoreOf & makeCorrect', () => {
	it('menjumlahkan poin', () => {
		expect(
			maxScoreOf([q({ id: 1, type: 'radio', points: 5 }), q({ id: 2, type: 'radio', points: 7 })])
		).toBe(12);
	});
	it('makeCorrect: 1 nilai → value', () => {
		expect(makeCorrect(['A'])).toEqual({ value: 'A' });
	});
	it('makeCorrect: banyak nilai → values', () => {
		expect(makeCorrect(['A', 'B'])).toEqual({ values: ['A', 'B'] });
	});
	it('makeCorrect: kosong → value null', () => {
		expect(makeCorrect([])).toEqual({ value: null });
	});
});
