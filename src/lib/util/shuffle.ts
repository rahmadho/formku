/**
 * shuffle.ts — Pengacakan soal/opsi (F6/F7) untuk FormKu. Modul M1.
 *
 * Desain:
 * - `shuffle(arr, rng)` : Fisher–Yates, mengembalikan SALINAN (tidak mengubah input).
 * - `makeRng(seed)`     : PRNG deterministik (mulberry32). Dipakai agar urutan soal
 *   stabil per-responden (tidak berubah saat re-render) dan dapat diuji.
 * - `hashSeed(str)`     : ubah seed apa pun (mis. response_id) jadi angka 32-bit.
 * - `shuffleWithSeed`   : gabungan — acak deterministik dari seed.
 */

/** Sumber angka acak di [0, 1). */
export type Rng = () => number;

/**
 * Hash string/angka menjadi integer 32-bit tak bertanda (untuk seed).
 * Algoritma FNV-1a sederhana — cepat & deterministik.
 */
export function hashSeed(input: string | number): number {
	const s = String(input);
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		// h *= 16777619 dengan aritmetika 32-bit.
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * PRNG deterministik mulberry32. Mengembalikan fungsi `rng()` di [0, 1).
 * Seed sama → urutan sama.
 */
export function makeRng(seed: number | string): Rng {
	let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
	return function rng(): number {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Fisher–Yates shuffle. Mengembalikan SALINAN baru; array input tidak diubah.
 * `rng` opsional; default Math.random (non-deterministik).
 */
export function shuffle<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
	const out = arr.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = out[i];
		out[i] = out[j];
		out[j] = tmp;
	}
	return out;
}

/** Acak deterministik berdasarkan seed. Seed sama → urutan sama. */
export function shuffleWithSeed<T>(arr: readonly T[], seed: number | string): T[] {
	return shuffle(arr, makeRng(seed));
}

/**
 * Ambil `count` elemen acak unik dari array (untuk Bank Soal / F12: tarik N soal).
 * Bila `count >= arr.length`, mengembalikan seluruh elemen yang telah diacak.
 * Bila `count <= 0`, mengembalikan array kosong.
 */
export function pickRandom<T>(arr: readonly T[], count: number, rng: Rng = Math.random): T[] {
	if (count <= 0 || arr.length === 0) return [];
	const n = Math.min(Math.floor(count), arr.length);
	return shuffle(arr, rng).slice(0, n);
}

/** Versi deterministik dari `pickRandom`. */
export function pickRandomWithSeed<T>(arr: readonly T[], count: number, seed: number | string): T[] {
	return pickRandom(arr, count, makeRng(seed));
}

/**
 * Acak opsi pertanyaan (F7). Bila `enabled` false, kembalikan salinan apa adanya.
 * `seed` opsional; bila diberikan, hasilnya deterministik per-responden.
 */
export function shuffleOptions<T>(
	options: readonly T[],
	enabled: boolean,
	seed?: number | string
): T[] {
	if (!enabled) return options.slice();
	return seed === undefined ? shuffle(options) : shuffleWithSeed(options, seed);
}

/**
 * Acak daftar soal per-section (F6) atau seluruh form.
 * Menjaga kelompok section tetap berurutan bila `perSection=true`, tapi urutan
 * soal di dalam tiap section diacak. Bila `perSection=false`, seluruh soal diacak
 * (section_urut diabaikan).
 *
 * `getSectionId` mengekstrak id section dari item (null = tanpa section).
 */
export function shuffleQuestions<T>(
	questions: readonly T[],
	enabled: boolean,
	getSectionId: (q: T) => number | null | undefined,
	perSection: boolean,
	seed?: number | string
): T[] {
	if (!enabled) return questions.slice();
	const rng = seed === undefined ? Math.random : makeRng(seed);
	if (!perSection) return shuffle(questions, rng);

	// Kelompokkan per section, pertahankan urutan kemunculan section pertama.
	const order: Array<number | null> = [];
	const groups = new Map<number | null, T[]>();
	for (const q of questions) {
		const key = getSectionId(q) ?? null;
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		(groups.get(key) as T[]).push(q);
	}
	const out: T[] = [];
	for (const key of order) {
		out.push(...shuffle(groups.get(key) as T[], rng));
	}
	return out;
}
