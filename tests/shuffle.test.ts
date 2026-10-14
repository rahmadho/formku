/**
 * shuffle.test.ts — Uji unit Modul M1: src/lib/util/shuffle.ts
 * Fokus: determinisme seed, permutasi valid, imutabilitas, pengambilan N soal.
 */
import { describe, it, expect } from 'vitest';
import {
	hashSeed,
	makeRng,
	shuffle,
	shuffleWithSeed,
	pickRandom,
	pickRandomWithSeed,
	shuffleOptions,
	shuffleQuestions
} from '../src/lib/util/shuffle.js';

describe('hashSeed', () => {
	it('deterministik untuk input sama', () => {
		expect(hashSeed('abc')).toBe(hashSeed('abc'));
		expect(hashSeed(123)).toBe(hashSeed('123'));
	});
	it('berbeda untuk input berbeda', () => {
		expect(hashSeed('a')).not.toBe(hashSeed('b'));
	});
	it('menghasilkan uint32', () => {
		const h = hashSeed('nilai');
		expect(h).toBeGreaterThanOrEqual(0);
		expect(h).toBeLessThanOrEqual(0xffffffff);
		expect(Number.isInteger(h)).toBe(true);
	});
});

describe('makeRng', () => {
	it('deterministik: seed sama → urutan sama', () => {
		const r1 = makeRng(42);
		const r2 = makeRng(42);
		const a = [r1(), r1(), r1()];
		const b = [r2(), r2(), r2()];
		expect(a).toEqual(b);
	});
	it('menghasilkan nilai di [0,1)', () => {
		const r = makeRng('seed');
		for (let i = 0; i < 1000; i++) {
			const v = r();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});
	it('seed berbeda → urutan berbeda (kemungkinan sangat tinggi)', () => {
		const a = [makeRng(1)(), makeRng(1)()];
		const b = [makeRng(2)(), makeRng(2)()];
		expect(a).not.toEqual(b);
	});
});

describe('shuffle', () => {
	it('mempertahankan elemen (permutasi)', () => {
		const arr = [1, 2, 3, 4, 5];
		const out = shuffle(arr);
		expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
		expect(out).toHaveLength(5);
	});
	it('TIDAK mengubah array input (imutabel)', () => {
		const arr = [1, 2, 3, 4, 5];
		const copy = arr.slice();
		shuffle(arr);
		expect(arr).toEqual(copy);
	});
	it('array kosong & satu elemen aman', () => {
		expect(shuffle([])).toEqual([]);
		expect(shuffle([1])).toEqual([1]);
	});
	it('rng kustom dipakai', () => {
		// rng mengembalikan 0 selalu → tiap elemen ditukar dengan indeks 0 di tiap i.
		const out = shuffle([1, 2, 3], () => 0);
		expect(out.slice().sort()).toEqual([1, 2, 3]);
	});
});

describe('shuffleWithSeed', () => {
	it('deterministik: seed sama → hasil sama', () => {
		const arr = Array.from({ length: 20 }, (_, i) => i);
		expect(shuffleWithSeed(arr, 7)).toEqual(shuffleWithSeed(arr, 7));
	});
	it('permutasi valid (tak ada elemen hilang/berlebih)', () => {
		const arr = Array.from({ length: 20 }, (_, i) => i);
		const out = shuffleWithSeed(arr, 'x');
		expect(out.slice().sort((a, b) => a - b)).toEqual(arr);
	});
	it('seed berbeda umumnya memberi urutan berbeda', () => {
		const arr = Array.from({ length: 20 }, (_, i) => i);
		expect(shuffleWithSeed(arr, 1)).not.toEqual(shuffleWithSeed(arr, 2));
	});
});

describe('pickRandom', () => {
	it('mengambil tepat count elemen unik', () => {
		const arr = [1, 2, 3, 4, 5];
		const out = pickRandom(arr, 3);
		expect(out).toHaveLength(3);
		expect(new Set(out).size).toBe(3);
		for (const v of out) expect(arr).toContain(v);
	});
	it('count >= panjang → seluruh elemen', () => {
		const arr = [1, 2, 3];
		expect(pickRandom(arr, 10).slice().sort()).toEqual([1, 2, 3]);
	});
	it('count <= 0 → kosong', () => {
		expect(pickRandom([1, 2, 3], 0)).toEqual([]);
		expect(pickRandom([1, 2, 3], -1)).toEqual([]);
	});
	it('array kosong → kosong', () => {
		expect(pickRandom([], 3)).toEqual([]);
	});
});

describe('pickRandomWithSeed', () => {
	it('deterministik', () => {
		const arr = Array.from({ length: 50 }, (_, i) => i);
		expect(pickRandomWithSeed(arr, 10, 'r1')).toEqual(pickRandomWithSeed(arr, 10, 'r1'));
	});
	it('responden berbeda → subset berbeda', () => {
		const arr = Array.from({ length: 50 }, (_, i) => i);
		expect(pickRandomWithSeed(arr, 10, 'r1')).not.toEqual(pickRandomWithSeed(arr, 10, 'r2'));
	});
});

describe('shuffleOptions (F7)', () => {
	it('enabled=false → salinan tanpa perubahan', () => {
		const opts = ['A', 'B', 'C'];
		const out = shuffleOptions(opts, false);
		expect(out).toEqual(opts);
		expect(out).not.toBe(opts); // salinan baru
	});
	it('enabled=true → permutasi valid', () => {
		const opts = ['A', 'B', 'C', 'D'];
		const out = shuffleOptions(opts, true);
		expect(out.slice().sort()).toEqual(['A', 'B', 'C', 'D']);
	});
	it('dengan seed → deterministik', () => {
		const opts = ['A', 'B', 'C', 'D'];
		expect(shuffleOptions(opts, true, 5)).toEqual(shuffleOptions(opts, true, 5));
	});
});

describe('shuffleQuestions (F6)', () => {
	const qs = [
		{ id: 1, section_id: 1 },
		{ id: 2, section_id: 1 },
		{ id: 3, section_id: 2 },
		{ id: 4, section_id: 2 },
		{ id: 5, section_id: null }
	];
	const getSection = (q: { section_id: number | null }) => q.section_id;

	it('enabled=false → salinan apa adanya', () => {
		expect(shuffleQuestions(qs, false, getSection, false)).toEqual(qs);
	});
	it('acak global → permutasi valid', () => {
		const out = shuffleQuestions(qs, true, getSection, false, 3);
		expect(out.map((q) => q.id).sort()).toEqual([1, 2, 3, 4, 5]);
	});
	it('per-section → section tetap berurutan, soal di dalam diacak', () => {
		const out = shuffleQuestions(qs, true, getSection, true, 3);
		const ids = out.map((q) => q.id);
		expect(ids.sort()).toEqual([1, 2, 3, 4, 5]);
		// Section 1 (id 1,2) tetap sebelum section 2 (id 3,4), item null (id 5) terakhir.
		const posOf = (id: number) => out.findIndex((q) => q.id === id);
		expect(Math.max(posOf(1), posOf(2))).toBeLessThan(Math.min(posOf(3), posOf(4)));
		expect(posOf(5)).toBe(4);
	});
	it('per-section deterministik dengan seed', () => {
		expect(shuffleQuestions(qs, true, getSection, true, 's')).toEqual(
			shuffleQuestions(qs, true, getSection, true, 's')
		);
	});
});
