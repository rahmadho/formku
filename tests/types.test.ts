/**
 * types.test.ts — Uji unit Modul M1: src/lib/types.ts
 */
import { describe, it, expect } from 'vitest';
import {
	FORM_MODES,
	FORM_STATUSES,
	TIMER_SCOPES,
	TENANT_STATUSES,
	QUESTION_TYPES,
	OPTION_QUESTION_TYPES,
	SCORABLE_QUESTION_TYPES,
	MULTI_VALUE_QUESTION_TYPES,
	RESPONSE_STATUSES,
	CONDITION_OPERATORS,
	CONDITION_ACTIONS,
	AUDIT_EVENT_TYPES,
	LIMITS,
	NUMERIC_BOUNDS,
	MAX_TIMER_SECONDS,
	SLUG_RE,
	EMAIL_RE,
	isFormMode,
	isFormStatus,
	isTimerScope,
	isQuestionType,
	isResponseStatus,
	isAuditEventType,
	hasOptions,
	isScorable,
	isMultiValue
} from '../src/lib/types.js';

describe('types: konstanta enum', () => {
	it('mendefinisikan mode form sesuai kontrak', () => {
		expect(FORM_MODES).toEqual(['form', 'quiz', 'exam']);
	});
	it('mendefinisikan status form', () => {
		expect(FORM_STATUSES).toEqual(['draft', 'open', 'closed']);
	});
	it('mendefinisikan timer scope', () => {
		expect(TIMER_SCOPES).toEqual(['form', 'section']);
	});
	it('mendefinisikan status tenant', () => {
		expect(TENANT_STATUSES).toEqual(['active', 'suspended']);
	});
	it('mendefinisikan 11 tipe pertanyaan sesuai F3', () => {
		expect(QUESTION_TYPES).toHaveLength(11);
		expect(QUESTION_TYPES).toContain('short_text');
		expect(QUESTION_TYPES).toContain('file');
	});
	it('mendefinisikan status respons', () => {
		expect(RESPONSE_STATUSES).toEqual(['in_progress', 'submitted', 'locked']);
	});
	it('mendefinisikan operator & aksi kondisi', () => {
		expect(CONDITION_OPERATORS).toContain('equals');
		expect(CONDITION_ACTIONS).toEqual(['show', 'hide']);
	});
	it('mendefinisikan tipe audit', () => {
		expect(AUDIT_EVENT_TYPES).toEqual(['blur', 'paste', 'copy', 'focus_return']);
	});
});

describe('types: batas & nilai default', () => {
	it('LIMITS wajar dan positif', () => {
		expect(LIMITS.title).toBeGreaterThan(0);
		expect(LIMITS.email).toBe(254);
		expect(LIMITS.options).toBeGreaterThan(0);
	});
	it('NUMERIC_BOUNDS rating/scale valid', () => {
		expect(NUMERIC_BOUNDS.rating.min).toBeLessThan(NUMERIC_BOUNDS.rating.max);
		expect(NUMERIC_BOUNDS.scale.defaultMax).toBe(5);
	});
	it('MAX_TIMER_SECONDS = 24 jam', () => {
		expect(MAX_TIMER_SECONDS).toBe(86400);
	});
});

describe('types: guard fungsi', () => {
	it('isFormMode', () => {
		expect(isFormMode('exam')).toBe(true);
		expect(isFormMode('nope')).toBe(false);
		expect(isFormMode(123)).toBe(false);
	});
	it('isFormStatus', () => {
		expect(isFormStatus('open')).toBe(true);
		expect(isFormStatus('draft')).toBe(true);
		expect(isFormStatus('')).toBe(false);
	});
	it('isTimerScope', () => {
		expect(isTimerScope('section')).toBe(true);
		expect(isTimerScope('form')).toBe(true);
		expect(isTimerScope('x')).toBe(false);
	});
	it('isQuestionType', () => {
		expect(isQuestionType('checkbox')).toBe(true);
		expect(isQuestionType('unknown')).toBe(false);
	});
	it('isResponseStatus', () => {
		expect(isResponseStatus('locked')).toBe(true);
		expect(isResponseStatus('done')).toBe(false);
	});
	it('isAuditEventType', () => {
		expect(isAuditEventType('paste')).toBe(true);
		expect(isAuditEventType('scroll')).toBe(false);
	});
	it('hasOptions benar untuk radio/checkbox/dropdown', () => {
		expect(hasOptions('radio')).toBe(true);
		expect(hasOptions('checkbox')).toBe(true);
		expect(hasOptions('dropdown')).toBe(true);
		expect(hasOptions('short_text')).toBe(false);
	});
	it('isScorable benar untuk tipe berpoin', () => {
		expect(isScorable('radio')).toBe(true);
		expect(isScorable('number')).toBe(true);
		expect(isScorable('file')).toBe(false);
		expect(isScorable('long_text')).toBe(false);
	});
	it('isMultiValue hanya checkbox', () => {
		expect(isMultiValue('checkbox')).toBe(true);
		expect(isMultiValue('radio')).toBe(false);
	});
	it('daftar opsi & multi-value konsisten dengan QUESTION_TYPES', () => {
		for (const t of OPTION_QUESTION_TYPES) expect(QUESTION_TYPES).toContain(t);
		for (const t of SCORABLE_QUESTION_TYPES) expect(QUESTION_TYPES).toContain(t);
		for (const t of MULTI_VALUE_QUESTION_TYPES) expect(QUESTION_TYPES).toContain(t);
	});
});

describe('types: regex', () => {
	it('SLUG_RE menerima slug valid & menolak yang salah', () => {
		expect(SLUG_RE.test('ujian-matematika-2024')).toBe(true);
		expect(SLUG_RE.test('abc')).toBe(true);
		expect(SLUG_RE.test('Abc')).toBe(false);
		expect(SLUG_RE.test('-abc')).toBe(false);
		expect(SLUG_RE.test('abc-')).toBe(false);
		expect(SLUG_RE.test('a--b')).toBe(false);
		expect(SLUG_RE.test('')).toBe(false);
	});
	it('EMAIL_RE dasar', () => {
		expect(EMAIL_RE.test('a@b.co')).toBe(true);
		expect(EMAIL_RE.test('bad')).toBe(false);
		expect(EMAIL_RE.test('a b@c.com')).toBe(false);
	});
});
