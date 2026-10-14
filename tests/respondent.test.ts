/**
 * respondent.test.ts — Uji logika murni UI isi form (Modul M6).
 *
 * Menguji tanpa DOM/DB: visibilitas kondisi (F17), pengelompokan section (F4),
 * perhitungan timer (F5), dan validasi wajib sebelum kirim.
 */
import { describe, it, expect } from 'vitest';
import {
	buildSectionViews,
	countAnswered,
	findValidationIssues,
	formDeadline,
	formatDuration,
	isEmptyAnswer,
	isQuestionVisible,
	matchesCondition,
	remainingSeconds,
	sectionDeadline,
	toSubmitAnswers,
	visibleQuestionIds,
	type AnswerMap,
	type PublicCondition,
	type PublicForm,
	type PublicQuestion,
	type PublicSection
} from '../src/lib/form/respondent.js';

/* ------------------------------------------------------------------ */
/* Fixture pembantu                                                    */
/* ------------------------------------------------------------------ */

function q(id: number, over: Partial<PublicQuestion> = {}): PublicQuestion {
	return {
		id,
		section_id: over.section_id ?? null,
		type: over.type ?? 'short_text',
		label: over.label ?? `Soal ${id}`,
		help_text: over.help_text ?? null,
		required: over.required ?? false,
		points: over.points ?? 0,
		settings: over.settings ?? null,
		sort: over.sort ?? id
	};
}

function cond(over: Partial<PublicCondition>): PublicCondition {
	return {
		question_id: over.question_id ?? 1,
		depends_on_question_id: over.depends_on_question_id ?? 1,
		operator: over.operator ?? 'equals',
		compare_value: over.compare_value ?? null,
		action: over.action ?? 'show'
	};
}

/* ------------------------------------------------------------------ */
/* isEmptyAnswer / matchesCondition                                    */
/* ------------------------------------------------------------------ */

describe('isEmptyAnswer', () => {
	it('anggap null/undefined/string kosong/array kosong sebagai kosong', () => {
		expect(isEmptyAnswer(null)).toBe(true);
		expect(isEmptyAnswer(undefined)).toBe(true);
		expect(isEmptyAnswer('')).toBe(true);
		expect(isEmptyAnswer('   ')).toBe(true);
		expect(isEmptyAnswer([])).toBe(true);
	});
	it('anggap nilai berisi sebagai tidak kosong', () => {
		expect(isEmptyAnswer('a')).toBe(false);
		expect(isEmptyAnswer(0)).toBe(false);
		expect(isEmptyAnswer(['x'])).toBe(false);
	});
});

describe('matchesCondition', () => {
	it('equals/not_equals untuk nilai tunggal', () => {
		expect(matchesCondition('equals', 'A', 'A')).toBe(true);
		expect(matchesCondition('equals', 'B', 'A')).toBe(false);
		expect(matchesCondition('not_equals', 'B', 'A')).toBe(true);
	});
	it('contains substring', () => {
		expect(matchesCondition('contains', 'halo dunia', 'dunia')).toBe(true);
		expect(matchesCondition('contains', 'halo', 'x')).toBe(false);
	});
	it('gt/lt numerik', () => {
		expect(matchesCondition('gt', 10, '5')).toBe(true);
		expect(matchesCondition('gt', 3, '5')).toBe(false);
		expect(matchesCondition('lt', 3, '5')).toBe(true);
		// Nilai non-numerik tidak boleh dianggap cocok.
		expect(matchesCondition('gt', 'abc', '5')).toBe(false);
	});
	it('checkbox (array) cocok bila ada anggota yang sama', () => {
		expect(matchesCondition('equals', ['A', 'B'], 'B')).toBe(true);
		expect(matchesCondition('equals', ['A'], 'C')).toBe(false);
		expect(matchesCondition('not_equals', ['A'], 'C')).toBe(true);
		expect(matchesCondition('contains', ['A', 'B'], 'A')).toBe(true);
	});
	it('gt/lt pada array memakai anggota maks/min', () => {
		expect(matchesCondition('gt', [1, 9], '5')).toBe(true);
		expect(matchesCondition('lt', [1, 9], '5')).toBe(true);
	});
});

/* ------------------------------------------------------------------ */
/* isQuestionVisible / visibleQuestionIds                              */
/* ------------------------------------------------------------------ */

describe('isQuestionVisible (F17)', () => {
	it('tanpa kondisi → selalu tampil', () => {
		expect(isQuestionVisible(q(2), {}, [])).toBe(true);
	});
	it('aturan show → hanya tampil bila syarat terpenuhi', () => {
		const c = [cond({ question_id: 2, depends_on_question_id: 1, action: 'show', compare_value: 'Ya' })];
		expect(isQuestionVisible(q(2), { 1: 'Ya' }, c)).toBe(true);
		expect(isQuestionVisible(q(2), { 1: 'Tidak' }, c)).toBe(false);
		expect(isQuestionVisible(q(2), {}, c)).toBe(false);
	});
	it('aturan hide → sembunyi bila syarat terpenuhi', () => {
		const c = [cond({ question_id: 2, depends_on_question_id: 1, action: 'hide', compare_value: 'Ya' })];
		expect(isQuestionVisible(q(2), { 1: 'Ya' }, c)).toBe(false);
		expect(isQuestionVisible(q(2), { 1: 'Tidak' }, c)).toBe(true);
	});
	it('beberapa aturan show → wajib SEMUA terpenuhi', () => {
		const c = [
			cond({ question_id: 3, depends_on_question_id: 1, action: 'show', compare_value: 'A' }),
			cond({ question_id: 3, depends_on_question_id: 2, action: 'show', compare_value: 'B' })
		];
		expect(isQuestionVisible(q(3), { 1: 'A', 2: 'B' }, c)).toBe(true);
		expect(isQuestionVisible(q(3), { 1: 'A', 2: 'X' }, c)).toBe(false);
	});
	it('hide menang atas show', () => {
		const c = [
			cond({ question_id: 3, depends_on_question_id: 1, action: 'show', compare_value: 'A' }),
			cond({ question_id: 3, depends_on_question_id: 1, action: 'hide', compare_value: 'A' })
		];
		expect(isQuestionVisible(q(3), { 1: 'A' }, c)).toBe(false);
	});
});

describe('visibleQuestionIds', () => {
	it('kembalikan hanya soal yang lolos kondisi', () => {
		const questions = [q(1), q(2), q(3)];
		const conds = [cond({ question_id: 3, depends_on_question_id: 1, action: 'show', compare_value: 'Ya' })];
		const ids = visibleQuestionIds(questions, { 1: 'Tidak' }, conds);
		expect(ids.has(1)).toBe(true);
		expect(ids.has(2)).toBe(true);
		expect(ids.has(3)).toBe(false);
	});
});

/* ------------------------------------------------------------------ */
/* buildSectionViews (F4)                                              */
/* ------------------------------------------------------------------ */

describe('buildSectionViews', () => {
	const sections: PublicSection[] = [
		{ id: 10, title: 'Bagian A', description: 'A', sort: 0, timer_seconds: 120 },
		{ id: 20, title: 'Bagian B', description: null, sort: 1, timer_seconds: 300 }
	];

	it('kelompokkan soal ke section-nya, hormati urutan sort', () => {
		const questions = [
			q(1, { section_id: 20 }),
			q(2, { section_id: 10 }),
			q(3, { section_id: 20 })
		];
		const views = buildSectionViews(sections, questions);
		expect(views.map((v) => v.id)).toEqual([10, 20]);
		expect(views[0].questions.map((x) => x.id)).toEqual([2]);
		expect(views[1].questions.map((x) => x.id)).toEqual([1, 3]);
		expect(views[0].timer_seconds).toBe(120);
	});

	it('pertahankan section kosong (agar deskripsi tampil)', () => {
		const views = buildSectionViews(sections, [q(1, { section_id: 10 })]);
		expect(views).toHaveLength(2);
		expect(views[1].questions).toHaveLength(0);
	});

	it('soal tanpa section → bagian pembuka', () => {
		const views = buildSectionViews(sections, [q(1), q(2, { section_id: 10 })]);
		expect(views[0].id).toBeNull();
		expect(views[0].questions.map((x) => x.id)).toEqual([1]);
		expect(views[1].id).toBe(10);
	});

	it('tanpa section sama sekali → satu bagian "Formulir"', () => {
		const views = buildSectionViews([], [q(1), q(2)]);
		expect(views).toHaveLength(1);
		expect(views[0].id).toBeNull();
		expect(views[0].title).toBe('Formulir');
		expect(views[0].questions).toHaveLength(2);
	});

	it('form kosong → tetap satu bagian kosong', () => {
		const views = buildSectionViews([], []);
		expect(views).toHaveLength(1);
		expect(views[0].questions).toHaveLength(0);
	});
});

/* ------------------------------------------------------------------ */
/* Timer (F5)                                                          */
/* ------------------------------------------------------------------ */

describe('timer', () => {
	it('remainingSeconds membulatkan ke atas & tak negatif', () => {
		expect(remainingSeconds(10_000, 9_600)).toBe(1); // sisa 400ms → 1
		expect(remainingSeconds(10_000, 10_000)).toBe(0);
		expect(remainingSeconds(10_000, 12_000)).toBe(0);
		expect(remainingSeconds(70_000, 10_000)).toBe(60);
	});

	it('formatDuration mm:ss dan hh:mm:ss', () => {
		expect(formatDuration(0)).toBe('00:00');
		expect(formatDuration(59)).toBe('00:59');
		expect(formatDuration(60)).toBe('01:00');
		expect(formatDuration(3599)).toBe('59:59');
		expect(formatDuration(3600)).toBe('01:00:00');
		expect(formatDuration(-5)).toBe('00:00');
	});

	it('formDeadline hanya untuk scope=form', () => {
		const form: Pick<PublicForm, 'timer_scope' | 'timer_seconds'> = {
			timer_scope: 'form',
			timer_seconds: 600
		};
		expect(formDeadline(form, 1000)).toBe(1000 + 600_000);
		expect(formDeadline({ timer_scope: 'section', timer_seconds: 600 }, 1000)).toBeNull();
		expect(formDeadline({ timer_scope: 'form', timer_seconds: null }, 1000)).toBeNull();
	});

	it('sectionDeadline dihitung dari waktu aktivasi', () => {
		expect(sectionDeadline({ timer_seconds: 120 }, 5000)).toBe(5000 + 120_000);
		expect(sectionDeadline({ timer_seconds: null }, 5000)).toBeNull();
	});
});

/* ------------------------------------------------------------------ */
/* Validasi & payload submit                                           */
/* ------------------------------------------------------------------ */

describe('findValidationIssues / countAnswered / toSubmitAnswers', () => {
	const questions = [
		q(1, { required: true }),
		q(2, { required: true }),
		q(3, { required: false })
	];

	it('menandai soal wajib yang belum dijawab', () => {
		const answers: AnswerMap = { 1: 'ok' };
		const issues = findValidationIssues(questions, answers, []);
		expect(issues.map((i) => i.question_id)).toEqual([2]);
		expect(issues[0].message).toContain('wajib');
	});

	it('soal wajib yang tersembunyi TIDAK dianggap masalah', () => {
		const conds = [cond({ question_id: 2, depends_on_question_id: 1, action: 'show', compare_value: 'Ya' })];
		const issues = findValidationIssues(questions, { 1: 'Tidak' }, conds);
		expect(issues.map((i) => i.question_id)).toEqual([]);
	});

	it('countAnswered hanya menghitung soal terlihat', () => {
		const conds = [cond({ question_id: 3, depends_on_question_id: 1, action: 'hide', compare_value: 'a' })];
		const { answered, total } = countAnswered(questions, { 1: 'a' }, conds);
		expect(total).toBe(2); // soal 3 disembunyikan
		expect(answered).toBe(1);
	});

	it('toSubmitAnswers membuang jawaban kosong & soal tersembunyi', () => {
		const conds = [cond({ question_id: 3, depends_on_question_id: 1, action: 'hide', compare_value: 'a' })];
		const out = toSubmitAnswers(questions, { 1: 'a', 2: '', 3: 'z' }, conds);
		expect(out).toEqual([{ question_id: 1, value: 'a' }]);
	});
});
