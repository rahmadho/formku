/**
 * sanitize.ts — Sanitasi input (anti-XSS, normalisasi) untuk FormKu.
 * Modul M1. Semua teks dari pengguna WAJIB lewat sini sebelum disimpan/ditampilkan.
 *
 * Strategi: kanonikalisasi ke teks polos (buang seluruh tag HTML). Ini lebih aman
 * daripada mencoba men-*parse* HTML. Keluaran SELALU teks polos — aman untuk
 * disimpan di DB dan dirender sebagai teks (bukan innerHTML).
 */

import { LIMITS } from '../types.js';

/** Entitas HTML umum → karakter asli. */
const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&#x27;': "'",
	'&apos;': "'",
	'&nbsp;': ' '
};

/** Decode entitas HTML (terbatas, cukup untuk pembersihan teks). */
function decodeEntities(input: string): string {
	return input
		.replace(/&#(\d+);/g, (_, dec: string) => {
			const code = Number(dec);
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
			const code = parseInt(hex, 16);
			return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
		})
		.replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

/**
 * Buang seluruh tag HTML dan script/style beserta isinya, lalu decode entitas.
 * Ini menjamin keluaran tidak mengandung markah eksekusi apa pun.
 */
export function stripTags(input: string): string {
	let s = input;
	// Buang blok <script>...</script> dan <style>...</style> lengkap dengan isinya.
	s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
	// Buang komentar HTML.
	s = s.replace(/<!--[\s\S]*?-->/g, '');
	// Buang tag pembuka/penutup/self-closing apa pun.
	s = s.replace(/<\/?[a-z][^>]*>/gi, '');
	// Buang sisa "<...>" (mis. tag cacat / payload tanpa nama tag valid).
	s = s.replace(/<[^>]*>/g, '');
	return decodeEntities(s);
}

/** Normalisasi spasi: rapikan spasi/tab berlebih, buang spasi di ujung. */
export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, ' ').trim();
}

/** Opsi sanitasi. */
export interface SanitizeTextOptions {
	/** Pangkas ke panjang maksimum (default: tak ada batas). */
	maxLength?: number;
	/** Rapatkan spasi (default: true). */
	collapseWhitespace?: boolean;
	/** Perbolehkan string kosong setelah sanitasi (default: true). */
	allowEmpty?: boolean;
}

/**
 * Sanitasi teks umum: buang HTML, decode entitas, normalisasi spasi, batasi panjang.
 * Mengembalikan string (never throws).
 */
export function sanitizeText(input: unknown, options: SanitizeTextOptions = {}): string {
	const { maxLength, collapseWhitespace = true, allowEmpty = true } = options;
	if (input === null || input === undefined) return '';
	let s = typeof input === 'string' ? input : String(input);
	s = stripTags(s);
	s = collapseWhitespace ? normalizeWhitespace(s) : s.trim();
	if (typeof maxLength === 'number' && maxLength >= 0 && s.length > maxLength) {
		s = s.slice(0, maxLength).trimEnd();
	}
	if (!allowEmpty && s === '') return '';
	return s;
}

/** Sanitasi teks panjang: pertahankan baris baru, buang HTML, batasi panjang. */
export function sanitizeMultiline(input: unknown, maxLength: number = LIMITS.longText): string {
	if (input === null || input === undefined) return '';
	let s = typeof input === 'string' ? input : String(input);
	s = stripTags(s);
	// Normalisasi CRLF → LF, rapikan spasi horizontal berlebih per baris.
	s = s.replace(/\r\n?/g, '\n');
	s = s
		.split('\n')
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n');
	// Maksimum dua baris kosong berturut-turut.
	s = s.replace(/\n{3,}/g, '\n\n').trim();
	if (s.length > maxLength) s = s.slice(0, maxLength).trimEnd();
	return s;
}

/** Escape karakter HTML untuk keluaran aman di konteks innerHTML/atribut. */
export function escapeHtml(input: unknown): string {
	if (input === null || input === undefined) return '';
	return String(input)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Ubah teks menjadi slug URL-aman (lowercase, tanda hubung). */
export function slugify(input: unknown, maxLength: number = LIMITS.slug): string {
	if (input === null || input === undefined) return '';
	const s = String(input)
		.normalize('NFKD')
		// Buang diakritik.
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
	return s.slice(0, maxLength).replace(/-+$/g, '');
}

/** Urai integer aman dari input tak dikenal. Mengembalikan null bila tak valid. */
export function toInt(input: unknown): number | null {
	if (typeof input === 'number') {
		return Number.isFinite(input) && Number.isInteger(input) ? input : null;
	}
	if (typeof input === 'string') {
		const t = input.trim();
		if (!/^-?\d+$/.test(t)) return null;
		const n = Number(t);
		return Number.isSafeInteger(n) ? n : null;
	}
	return null;
}

/** Urai boolean aman dari input tak dikenal. */
export function toBool(input: unknown): boolean | null {
	if (typeof input === 'boolean') return input;
	if (typeof input === 'string') {
		const t = input.trim().toLowerCase();
		if (['true', '1', 'yes', 'on'].includes(t)) return true;
		if (['false', '0', 'no', 'off'].includes(t)) return false;
	}
	if (typeof input === 'number') {
		if (input === 1) return true;
		if (input === 0) return false;
	}
	return null;
}

/**
 * Buang kunci berbahaya dari objek (prototype pollution): __proto__, constructor, prototype.
 * Mengembalikan objek baru (shallow) tanpa kunci berbahaya.
 */
export function sanitizeObjectKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
		out[k] = v;
	}
	return out;
}
