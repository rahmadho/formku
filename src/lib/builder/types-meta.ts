/**
 * types-meta.ts — Metadata tipe pertanyaan untuk UI Builder (Modul M5).
 *
 * Menerjemahkan `QuestionType` (kontrak M1, `$lib/types.ts`) menjadi label
 * manusia, kelompok menu, serta sifat yang menentukan kontrol editor mana yang
 * tampil (opsi? kunci jawaban? batas numerik?). Ini memusatkan pengetahuan
 * "tipe X → editor Y" agar panel soal tetap ringkas & konsisten.
 *
 * Fungsi di sini MURNI (tanpa DOM/jaringan) → mudah diuji.
 */
import {
	hasOptions,
	isMultiValue,
	isScorable,
	type QuestionType
} from '$lib/types.js';

/** Kelompok tipe di menu "Tambah soal". */
export type TypeGroup = 'teks' | 'pilihan' | 'angka' | 'lain';

export interface QuestionTypeMeta {
	type: QuestionType;
	/** Label manusia (Bahasa Indonesia). */
	label: string;
	/** Keterangan singkat di menu. */
	hint: string;
	/** Kelompok menu. */
	group: TypeGroup;
	/** Punya daftar opsi (radio/checkbox/dropdown). */
	hasOptions: boolean;
	/** Kunci jawaban tunggal (value). */
	singleKey: boolean;
	/** Kunci jawaban ganda (values[]). */
	multiKey: boolean;
	/** Punya batas min/max (number/rating/scale). */
	hasRange: boolean;
}

const META: Record<QuestionType, Omit<QuestionTypeMeta, 'hasOptions' | 'singleKey' | 'multiKey' | 'hasRange'> & { hasRange: boolean }> = {
	short_text: { type: 'short_text', label: 'Teks pendek', hint: 'Jawaban satu baris', group: 'teks', hasRange: false },
	long_text: { type: 'long_text', label: 'Teks panjang', hint: 'Uraian / paragraf', group: 'teks', hasRange: false },
	radio: { type: 'radio', label: 'Pilihan ganda', hint: 'Satu jawaban benar', group: 'pilihan', hasRange: false },
	checkbox: { type: 'checkbox', label: 'Kotak centang', hint: 'Banyak jawaban', group: 'pilihan', hasRange: false },
	dropdown: { type: 'dropdown', label: 'Menu dropdown', hint: 'Pilih dari daftar', group: 'pilihan', hasRange: false },
	number: { type: 'number', label: 'Angka', hint: 'Nilai numerik', group: 'angka', hasRange: true },
	date: { type: 'date', label: 'Tanggal', hint: 'Pemilih tanggal', group: 'lain', hasRange: false },
	email: { type: 'email', label: 'Email', hint: 'Alamat surel', group: 'teks', hasRange: false },
	rating: { type: 'rating', label: 'Rating bintang', hint: 'Skor bintang', group: 'angka', hasRange: true },
	scale: { type: 'scale', label: 'Skala', hint: 'Skala Likert 1–N', group: 'angka', hasRange: true },
	file: { type: 'file', label: 'Unggah berkas', hint: 'Lampiran berkas', group: 'lain', hasRange: false }
};

/** Metadata lengkap satu tipe (menggabungkan sifat dari `$lib/types.ts`). */
export function questionTypeMeta(type: QuestionType): QuestionTypeMeta {
	const base = META[type];
	return {
		...base,
		hasOptions: hasOptions(type),
		singleKey: isScorable(type) && !isMultiValue(type),
		multiKey: isScorable(type) && isMultiValue(type),
		hasRange: base.hasRange
	};
}

/** Label manusia untuk tipe (fallback: tipe mentah bila tak dikenal). */
export function questionTypeLabel(type: string): string {
	return (META as Record<string, { label: string }>)[type]?.label ?? type;
}

/** Urutan tampil tipe di menu (kelompok: teks → pilihan → angka → lain). */
export const TYPE_MENU: QuestionType[] = [
	'short_text',
	'long_text',
	'email',
	'radio',
	'checkbox',
	'dropdown',
	'number',
	'rating',
	'scale',
	'date',
	'file'
];

/** Label manusia untuk kelompok menu. */
export const GROUP_LABEL: Record<TypeGroup, string> = {
	teks: 'Teks',
	pilihan: 'Pilihan',
	angka: 'Angka & skala',
	lain: 'Lainnya'
};

/** Label mode form. */
export const MODE_LABEL = { form: 'Form', quiz: 'Kuis', exam: 'Ujian' } as const;

/** Label status form. */
export const STATUS_LABEL = { draft: 'Draf', open: 'Terbuka', closed: 'Ditutup' } as const;

/** Keterangan singkat tiap mode (untuk pemilih mode). */
export const MODE_HINT = {
	form: 'Formulir biasa: pendaftaran, survei, kontak.',
	quiz: 'Kuis interaktif dengan skor langsung.',
	exam: 'Ujian formal: timer, acak, kunci jawaban, token.'
} as const;

/** Format detik → "1j 30m" / "45m" / "30d". null → "tanpa timer". */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined) return 'tanpa timer';
	if (seconds === 0) return '0 detik';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts: string[] = [];
	if (h) parts.push(`${h}j`);
	if (m) parts.push(`${m}m`);
	if (s && !h) parts.push(`${s}d`);
	return parts.join(' ') || '0 detik';
}

/** Detik → nilai menit (bulat) untuk kontrol input cepat. */
export function secondsToMinutes(seconds: number | null | undefined): number | null {
	if (seconds === null || seconds === undefined) return null;
	return Math.round(seconds / 60);
}
