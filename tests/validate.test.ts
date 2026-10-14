/**
 * validate.test.ts — Uji unit Modul M1: src/lib/util/validate.ts
 */
import { describe, it, expect } from 'vitest';
import {
	ok,
	fail,
	isNonEmptyString,
	isValidSlug,
	isValidEmail,
	isValidDate,
	isNumberInRange,
	isWithinLength,
	isOneOf,
	validateTenant,
	validateForm,
	validateQuestion,
	validateOptions,
	validateCondition,
	validateAnswer,
	validateResponseStatus,
	validateTenantStatus
} from '../src/lib/util/validate.js';

describe('helper dasar', () => {
	it('ok/fail membentuk hasil', () => {
		expect(ok(1)).toEqual({ ok: true, value: 1 });
		expect(fail('e')).toEqual({ ok: false, errors: ['e'] });
	});
	it('isNonEmptyString', () => {
		expect(isNonEmptyString(' a ')).toBe(true);
		expect(isNonEmptyString('   ')).toBe(false);
		expect(isNonEmptyString(5)).toBe(false);
	});
	it('isWithinLength', () => {
		expect(isWithinLength('abc', 3)).toBe(true);
		expect(isWithinLength('abcd', 3)).toBe(false);
	});
	it('isOneOf', () => {
		expect(isOneOf('a', ['a', 'b'] as const)).toBe(true);
		expect(isOneOf('c', ['a', 'b'] as const)).toBe(false);
	});
	it('isNumberInRange', () => {
		expect(isNumberInRange(5, 1, 10)).toBe(true);
		expect(isNumberInRange(11, 1, 10)).toBe(false);
		expect(isNumberInRange(NaN, 1, 10)).toBe(false);
	});
});

describe('isValidSlug', () => {
	it('menerima slug valid', () => {
		expect(isValidSlug('ujian-2024')).toBe(true);
	});
	it('menolak slug salah & terlalu panjang', () => {
		expect(isValidSlug('Bad Slug')).toBe(false);
		expect(isValidSlug('a'.repeat(81))).toBe(false);
		expect(isValidSlug(123)).toBe(false);
	});
});

describe('isValidEmail', () => {
	it('menerima email valid', () => {
		expect(isValidEmail('guru@sekolah.sch.id')).toBe(true);
		expect(isValidEmail('  a@b.co ')).toBe(true);
	});
	it('menolak email salah/terlalu panjang', () => {
		expect(isValidEmail('no-at')).toBe(false);
		expect(isValidEmail('a@b')).toBe(false);
		expect(isValidEmail('a b@c.com')).toBe(false);
		expect(isValidEmail('x@y.com'.padEnd(300, 'm'))).toBe(false);
	});
});

describe('isValidDate', () => {
	it('menerima tanggal kalender valid', () => {
		expect(isValidDate('2024-02-29')).toBe(true); // kabisat
		expect(isValidDate('2024-12-31')).toBe(true);
	});
	it('menolak tanggal mustahil & format salah', () => {
		expect(isValidDate('2023-02-29')).toBe(false);
		expect(isValidDate('2024-13-01')).toBe(false);
		expect(isValidDate('2024-00-10')).toBe(false);
		expect(isValidDate('2024-04-31')).toBe(false);
		expect(isValidDate('31-12-2024')).toBe(false);
		expect(isValidDate('2024/12/31')).toBe(false);
	});
});

describe('validateTenant', () => {
	it('menerima payload valid', () => {
		const r = validateTenant({ slug: 'sekolah-a', name: 'Sekolah A', owner_email: 'a@b.co' });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.slug).toBe('sekolah-a');
			expect(r.value.owner_email).toBe('a@b.co');
		}
	});
	it('owner_email opsional', () => {
		const r = validateTenant({ slug: 'sekolah-a', name: 'Sekolah A' });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.owner_email).toBeNull();
	});
	it('menolak slug/name/email salah', () => {
		expect(validateTenant({ slug: 'Bad', name: '' }).ok).toBe(false);
		expect(validateTenant({ slug: 'ok', name: 'X', owner_email: 'bad' }).ok).toBe(false);
		expect(validateTenant(null).ok).toBe(false);
	});
});

describe('validateForm', () => {
	it('menerima form minimal', () => {
		const r = validateForm({ title: 'Kuis', mode: 'quiz' });
		expect(r.ok).toBe(true);
	});
	it('menolak mode invalid', () => {
		expect(validateForm({ title: 'X', mode: 'ujian' }).ok).toBe(false);
	});
	it('validasi timer_seconds integer >= 0', () => {
		expect(validateForm({ title: 'X', mode: 'exam', timer_seconds: 60 }).ok).toBe(true);
		expect(validateForm({ title: 'X', mode: 'exam', timer_seconds: -1 }).ok).toBe(false);
		expect(validateForm({ title: 'X', mode: 'exam', timer_seconds: 1.5 }).ok).toBe(false);
		expect(validateForm({ title: 'X', mode: 'exam', timer_seconds: null }).ok).toBe(true);
	});
	it('validasi timer_scope', () => {
		expect(validateForm({ title: 'X', mode: 'exam', timer_scope: 'section' }).ok).toBe(true);
		expect(validateForm({ title: 'X', mode: 'exam', timer_scope: 'x' }).ok).toBe(false);
	});
	it('validasi passing_grade 0–100', () => {
		expect(validateForm({ title: 'X', mode: 'quiz', passing_grade: 70 }).ok).toBe(true);
		expect(validateForm({ title: 'X', mode: 'quiz', passing_grade: 101 }).ok).toBe(false);
	});
	it('validasi bank_pick_count >= 1', () => {
		expect(validateForm({ title: 'X', mode: 'exam', bank_pick_count: 10 }).ok).toBe(true);
		expect(validateForm({ title: 'X', mode: 'exam', bank_pick_count: 0 }).ok).toBe(false);
	});
	it('validasi boolean field', () => {
		expect(validateForm({ title: 'X', mode: 'form', shuffle_questions: true }).ok).toBe(true);
		expect(validateForm({ title: 'X', mode: 'form', shuffle_questions: 'yes' }).ok).toBe(false);
	});
	it('partial=true → field opsional', () => {
		expect(validateForm({}, true).ok).toBe(true);
		expect(validateForm({ title: '' }, true).ok).toBe(false);
	});
	it('menolak body bukan objek', () => {
		expect(validateForm('x').ok).toBe(false);
	});
});

describe('validateQuestion', () => {
	it('menerima pertanyaan valid', () => {
		const r = validateQuestion({ type: 'radio', label: 'Pilih', points: 10 });
		expect(r.ok).toBe(true);
	});
	it('menolak tipe invalid', () => {
		expect(validateQuestion({ type: 'telepathy', label: 'X' }).ok).toBe(false);
	});
	it('validasi points integer >= 0', () => {
		expect(validateQuestion({ type: 'radio', label: 'X', points: -1 }).ok).toBe(false);
		expect(validateQuestion({ type: 'radio', label: 'X', points: 2.5 }).ok).toBe(false);
	});
	it('validasi section_id', () => {
		expect(validateQuestion({ type: 'radio', label: 'X', section_id: 3 }).ok).toBe(true);
		expect(validateQuestion({ type: 'radio', label: 'X', section_id: 0 }).ok).toBe(false);
	});
	it('partial mendukung update', () => {
		expect(validateQuestion({ label: 'Baru' }, true).ok).toBe(true);
	});
});

describe('validateOptions', () => {
	it('mengisi value dari label bila kosong', () => {
		const r = validateOptions([{ label: 'Merah' }], 'radio');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([{ label: 'Merah', value: 'Merah' }]);
	});
	it('menolak opsi duplikat', () => {
		const r = validateOptions(
			[
				{ label: 'A', value: 'x' },
				{ label: 'B', value: 'x' }
			],
			'radio'
		);
		expect(r.ok).toBe(false);
	});
	it('menolak array kosong untuk tipe opsi', () => {
		expect(validateOptions([], 'radio').ok).toBe(false);
	});
	it('mengabaikan opsi untuk tipe non-opsi', () => {
		expect(validateOptions([], 'short_text')).toEqual({ ok: true, value: [] });
		expect(validateOptions(undefined, 'long_text')).toEqual({ ok: true, value: [] });
	});
	it('menolak non-array untuk tipe opsi', () => {
		expect(validateOptions('x', 'dropdown').ok).toBe(false);
	});
});

describe('validateCondition', () => {
	it('menerima kondisi valid', () => {
		const r = validateCondition({
			depends_on_question_id: 1,
			operator: 'equals',
			compare_value: 'A',
			action: 'show'
		});
		expect(r.ok).toBe(true);
	});
	it('menolak operator/action invalid', () => {
		expect(validateCondition({ depends_on_question_id: 1, operator: 'x', action: 'show' }).ok).toBe(false);
		expect(validateCondition({ depends_on_question_id: 1, operator: 'equals', action: 'x' }).ok).toBe(false);
	});
});

describe('validateAnswer (per tipe)', () => {
	const withOptions = {
		type: 'radio' as const,
		settings: { options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }] }
	};

	it('kosong + required → gagal', () => {
		expect(validateAnswer('', { type: 'short_text', required: true }).ok).toBe(false);
		expect(validateAnswer(null, { type: 'short_text', required: true }).ok).toBe(false);
	});
	it('kosong + tidak required → ok(null)', () => {
		expect(validateAnswer('', { type: 'short_text' })).toEqual({ ok: true, value: null });
	});
	it('short_text & long_text', () => {
		expect(validateAnswer('halo', { type: 'short_text' }).ok).toBe(true);
		expect(validateAnswer('x'.repeat(20001), { type: 'long_text' }).ok).toBe(false);
	});
	it('email', () => {
		expect(validateAnswer('a@b.co', { type: 'email' }).ok).toBe(true);
		expect(validateAnswer('bad', { type: 'email' }).ok).toBe(false);
	});
	it('date', () => {
		expect(validateAnswer('2024-01-01', { type: 'date' }).ok).toBe(true);
		expect(validateAnswer('2024-02-30', { type: 'date' }).ok).toBe(false);
	});
	it('number dengan batas settings', () => {
		expect(validateAnswer(5, { type: 'number', settings: { min: 1, max: 10 } }).ok).toBe(true);
		expect(validateAnswer(11, { type: 'number', settings: { min: 1, max: 10 } }).ok).toBe(false);
		expect(validateAnswer('5', { type: 'number' }).ok).toBe(false);
	});
	it('rating/scale integer dalam batas', () => {
		expect(validateAnswer(3, { type: 'rating' }).ok).toBe(true);
		expect(validateAnswer(3.5, { type: 'rating' }).ok).toBe(false);
		expect(validateAnswer(11, { type: 'scale', settings: { min: 1, max: 10 } }).ok).toBe(false);
	});
	it('radio/dropdown harus salah satu opsi', () => {
		expect(validateAnswer('A', withOptions).ok).toBe(true);
		expect(validateAnswer('C', withOptions).ok).toBe(false);
	});
	it('checkbox: array unik & valid', () => {
		const ctx = {
			type: 'checkbox' as const,
			settings: { options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }, { label: 'C', value: 'C' }] }
		};
		expect(validateAnswer(['A', 'C'], ctx).ok).toBe(true);
		expect(validateAnswer(['A', 'A'], ctx).ok).toBe(false);
		expect(validateAnswer(['A', 'Z'], ctx).ok).toBe(false);
		expect(validateAnswer('A', ctx).ok).toBe(false);
	});
	it('file: referensi teks', () => {
		expect(validateAnswer('lampiran.pdf', { type: 'file' }).ok).toBe(true);
		expect(validateAnswer(123, { type: 'file' }).ok).toBe(false);
	});
});

describe('validateResponseStatus & validateTenantStatus', () => {
	it('status respons valid', () => {
		expect(validateResponseStatus('submitted').ok).toBe(true);
		expect(validateResponseStatus('done').ok).toBe(false);
	});
	it('status tenant valid', () => {
		expect(validateTenantStatus('active').ok).toBe(true);
		expect(validateTenantStatus('suspended').ok).toBe(true);
		expect(validateTenantStatus('x').ok).toBe(false);
	});
});
