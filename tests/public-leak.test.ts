/**
 * public-leak.test.ts — UJI KEAMANAN KRITIS Modul M4.
 *
 * Mengunci jaminan inti: `correct_json` (kunci jawaban) TIDAK BOLEH bocor ke
 * klien sebelum submit. Uji ini memverifikasi bahwa proyeksi soal publik
 * (`projectQuestionForPublic`) MENGHAPUS kunci jawaban secara eksplisit, apa pun
 * isi baris DB-nya — termasuk kunci yang bersarang di settings_json.
 *
 * Catatan: mengimpor ../src/routes/api/public/_lib.js menarik db.ts (pg). Pool
 * pg dibuat malas (lazy connect), jadi tak ada koneksi saat impor — uji murni.
 */
import { describe, it, expect } from 'vitest';
import {
	projectQuestionForPublic,
	applyShuffle,
	type PublicQuestionRow
} from '../src/routes/api/public/_lib.js';

/** Baris soal lengkap dengan kunci jawaban (seperti hasil `SELECT *`). */
function rowWithKey(): PublicQuestionRow {
	return {
		id: 42,
		form_id: 7,
		section_id: 3,
		type: 'radio',
		label: 'Ibu kota Indonesia?',
		help_text: 'pilih satu',
		required: true,
		points: 5,
		correct_json: { value: 'A' },
		settings_json: {
			options: [
				{ label: 'Jakarta', value: 'A' },
				{ label: 'Bandung', value: 'B' },
				{ label: 'Surabaya', value: 'C' }
			],
			placeholder: 'ketik'
		},
		sort: 1
	};
}

describe('projectQuestionForPublic — anti-kebocoran correct_json', () => {
	it('TIDAK memuat properti `correct_json` sama sekali', () => {
		const pub = projectQuestionForPublic(rowWithKey());
		expect('correct_json' in pub).toBe(false);
		expect((pub as unknown as Record<string, unknown>).correct_json).toBeUndefined();
	});

	it('hasil serialisasi JSON tidak mengandung kata "correct"', () => {
		const pub = projectQuestionForPublic(rowWithKey());
		const json = JSON.stringify(pub);
		expect(json).not.toContain('correct');
		// Nilai kunci mentahnya juga tak boleh muncul sebagai properti.
		expect(Object.prototype.hasOwnProperty.call(pub, 'correct')).toBe(false);
	});

	it('mempertahankan field aman (label, opsi, poin, required)', () => {
		const pub = projectQuestionForPublic(rowWithKey());
		expect(pub.id).toBe(42);
		expect(pub.label).toBe('Ibu kota Indonesia?');
		expect(pub.points).toBe(5);
		expect(pub.required).toBe(true);
		expect(pub.settings?.options).toHaveLength(3);
		expect(pub.settings?.options?.[0]).toEqual({ label: 'Jakarta', value: 'A' });
	});

	it('hanya menyalin kunci setelan yang di-whitelist (kunci asing dibuang)', () => {
		const row = rowWithKey();
		// Sisipkan field jahat/penyusup ke settings_json.
		(row.settings_json as Record<string, unknown>).answer_key = 'A';
		(row.settings_json as Record<string, unknown>).correct = { value: 'A' };
		(row.settings_json as Record<string, unknown>).secret_note = 'rahasia';
		const pub = projectQuestionForPublic(row);
		const json = JSON.stringify(pub.settings);
		expect(json).not.toContain('answer_key');
		expect(json).not.toContain('secret_note');
		expect(json).not.toContain('correct');
	});

	it('checkbox multi-kunci juga tidak bocor', () => {
		const row: PublicQuestionRow = {
			...rowWithKey(),
			type: 'checkbox',
			correct_json: { values: ['A', 'C'] }
		};
		const pub = projectQuestionForPublic(row);
		expect('correct_json' in pub).toBe(false);
		expect(JSON.stringify(pub)).not.toContain('correct');
	});

	it('tipe tak dikenal dinormalisasi ke short_text (tanpa crash)', () => {
		const row = { ...rowWithKey(), type: 'unknown_type' } as unknown as PublicQuestionRow;
		const pub = projectQuestionForPublic(row);
		expect(pub.type).toBe('short_text');
	});

	it('settings tanpa kunci aman → null', () => {
		const row = { ...rowWithKey(), settings_json: null };
		expect(projectQuestionForPublic(row).settings).toBeNull();
	});
});

describe('applyShuffle — acak + subset, tanpa kebocoran', () => {
	const mkQ = (id: number, section: number | null): PublicQuestionRow => ({
		id,
		form_id: 1,
		section_id: section,
		type: 'radio',
		label: `Q${id}`,
		help_text: null,
		required: false,
		points: 1,
		correct_json: { value: 'A' },
		settings_json: { options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }] },
		sort: id
	});

	it('tak ada correct_json di seluruh hasil', () => {
		const qs = [mkQ(1, 1), mkQ(2, 1), mkQ(3, 2)];
		const out = applyShuffle(
			{ shuffle_questions: true, shuffle_options: true, bank_pick_count: null },
			qs,
			'r1'
		);
		for (const q of out) {
			expect('correct_json' in q).toBe(false);
		}
		expect(JSON.stringify(out)).not.toContain('correct');
	});

	it('deterministik: seed sama → urutan sama', () => {
		const qs = [mkQ(1, 1), mkQ(2, 1), mkQ(3, 2), mkQ(4, 2)];
		const cfg = { shuffle_questions: true, shuffle_options: true, bank_pick_count: null };
		const a = applyShuffle(cfg, qs, 'r1').map((q) => q.id);
		const b = applyShuffle(cfg, qs, 'r1').map((q) => q.id);
		expect(a).toEqual(b);
	});

	it('responden berbeda → urutan (umumnya) berbeda', () => {
		const qs = Array.from({ length: 12 }, (_, i) => mkQ(i + 1, i < 6 ? 1 : 2));
		const cfg = { shuffle_questions: true, shuffle_options: false, bank_pick_count: null };
		const a = applyShuffle(cfg, qs, 'r1').map((q) => q.id);
		const b = applyShuffle(cfg, qs, 'r2').map((q) => q.id);
		expect(a).not.toEqual(b);
	});

	it('bank_pick_count menarik tepat N soal', () => {
		const qs = Array.from({ length: 10 }, (_, i) => mkQ(i + 1, null));
		const out = applyShuffle(
			{ shuffle_questions: false, shuffle_options: false, bank_pick_count: 4 },
			qs,
			'r1'
		);
		expect(out).toHaveLength(4);
		// semua id berasal dari himpunan asal & unik.
		expect(new Set(out.map((q) => q.id)).size).toBe(4);
	});

	it('shuffle_options mengacak urutan opsi tapi nilai tetap lengkap', () => {
		const qs = [mkQ(1, null), mkQ(2, null), mkQ(3, null)];
		const out = applyShuffle(
			{ shuffle_questions: false, shuffle_options: true, bank_pick_count: null },
			qs,
			'r1'
		);
		for (const q of out) {
			const vals = (q.settings?.options ?? []).map((o) => o.value).sort();
			expect(vals).toEqual(['A', 'B']);
		}
	});

	it('shuffle_questions=false → urutan asli dipertahankan', () => {
		const qs = [mkQ(5, null), mkQ(1, null), mkQ(9, null)];
		const out = applyShuffle(
			{ shuffle_questions: false, shuffle_options: false, bank_pick_count: null },
			qs,
			'r1'
		);
		expect(out.map((q) => q.id)).toEqual([5, 1, 9]);
	});
});
