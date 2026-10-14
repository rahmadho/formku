/**
 * sanitize.test.ts — Uji unit Modul M1: src/lib/util/sanitize.ts
 * Fokus: anti-XSS (buang tag), decode entitas, normalisasi, slug, koersi tipe.
 */
import { describe, it, expect } from 'vitest';
import {
	stripTags,
	normalizeWhitespace,
	sanitizeText,
	sanitizeMultiline,
	escapeHtml,
	slugify,
	toInt,
	toBool,
	sanitizeObjectKeys
} from '../src/lib/util/sanitize.js';

describe('stripTags (anti-XSS)', () => {
	it('membuang tag script beserta isinya', () => {
		expect(stripTags('<script>alert(1)</script>halo')).toBe('halo');
		expect(stripTags('a<script src="x.js"></script>b')).toBe('ab');
	});
	it('membuang tag style beserta isinya', () => {
		expect(stripTags('<style>body{}</style>ok')).toBe('ok');
	});
	it('membuang tag HTML umum', () => {
		expect(stripTags('<b>Tebal</b>')).toBe('Tebal');
		expect(stripTags('<img src=x onerror=alert(1)>')).toBe('');
		expect(stripTags('<a href="javascript:alert(1)">klik</a>')).toBe('klik');
	});
	it('membuang komentar HTML', () => {
		expect(stripTags('a<!-- rahasia -->b')).toBe('ab');
	});
	it('membuang tag cacat tanpa nama valid', () => {
		expect(stripTags('x<3y>z')).toBe('xz');
	});
	it('mendecode entitas HTML', () => {
		expect(stripTags('a &amp; b')).toBe('a & b');
		expect(stripTags('&lt;b&gt;')).toBe('<b>');
		expect(stripTags('&#65;&#x42;')).toBe('AB');
		expect(stripTags('&nbsp;x')).toBe(' x');
	});
	it('menangani payload XSS bersarang', () => {
		const evil = '<scr<script>ipt>alert(1)</scr</script>ipt>';
		const out = stripTags(evil);
		expect(out).not.toContain('<');
		expect(out).not.toContain('>');
	});
});

describe('normalizeWhitespace', () => {
	it('merapatkan spasi & trim', () => {
		expect(normalizeWhitespace('  a   b \t c  ')).toBe('a b c');
		expect(normalizeWhitespace('\n\nx\n')).toBe('x');
	});
});

describe('sanitizeText', () => {
	it('mengembalikan string kosong untuk null/undefined', () => {
		expect(sanitizeText(null)).toBe('');
		expect(sanitizeText(undefined)).toBe('');
	});
	it('buang HTML + rapikan spasi', () => {
		expect(sanitizeText('<b>  Halo  </b>')).toBe('Halo');
	});
	it('menghormati maxLength', () => {
		expect(sanitizeText('abcdefghij', { maxLength: 5 })).toBe('abcde');
	});
	it('koersi angka menjadi teks', () => {
		expect(sanitizeText(42)).toBe('42');
	});
	it('collapseWhitespace=false mempertahankan spasi internal', () => {
		expect(sanitizeText('a   b', { collapseWhitespace: false })).toBe('a   b');
	});
});

describe('sanitizeMultiline', () => {
	it('mempertahankan baris baru & merapikan tiap baris', () => {
		expect(sanitizeMultiline('baris 1\n\n\n\nbaris 2')).toBe('baris 1\n\nbaris 2');
	});
	it('normalisasi CRLF & buang HTML', () => {
		expect(sanitizeMultiline('<b>a</b>\r\nb')).toBe('a\nb');
	});
	it('menghormati maxLength', () => {
		expect(sanitizeMultiline('a\nb\nc', 3)).toBe('a\nb');
	});
});

describe('escapeHtml', () => {
	it('meng-escape karakter berbahaya', () => {
		expect(escapeHtml('<a "x" & \'y\'>')).toBe('&lt;a &quot;x&quot; &amp; &#39;y&#39;&gt;');
	});
	it('null → string kosong', () => {
		expect(escapeHtml(null)).toBe('');
	});
});

describe('slugify', () => {
	it('membuat slug dari teks biasa', () => {
		expect(slugify('Ujian Matematika 2024')).toBe('ujian-matematika-2024');
	});
	it('buang diakritik', () => {
		expect(slugify('Café Résumé')).toBe('cafe-resume');
	});
	it('kolaps tanda hubung & trim', () => {
		expect(slugify('  --a---b--  ')).toBe('a-b');
	});
	it('kosong bila tak ada karakter valid', () => {
		expect(slugify('!!!')).toBe('');
	});
	it('menghormati maxLength', () => {
		expect(slugify('abcdefghij', 4)).toBe('abcd');
	});
});

describe('toInt', () => {
	it('integer valid', () => {
		expect(toInt(5)).toBe(5);
		expect(toInt('42')).toBe(42);
		expect(toInt('-7')).toBe(-7);
	});
	it('menolak non-integer', () => {
		expect(toInt(1.5)).toBeNull();
		expect(toInt('1.5')).toBeNull();
		expect(toInt('abc')).toBeNull();
		expect(toInt('1e3')).toBeNull();
		expect(toInt(null)).toBeNull();
		expect(toInt(NaN)).toBeNull();
	});
});

describe('toBool', () => {
	it('boolean langsung', () => {
		expect(toBool(true)).toBe(true);
		expect(toBool(false)).toBe(false);
	});
	it('string yang diterima', () => {
		expect(toBool('true')).toBe(true);
		expect(toBool('YES')).toBe(true);
		expect(toBool('off')).toBe(false);
		expect(toBool('0')).toBe(false);
	});
	it('menolak nilai tak dikenal', () => {
		expect(toBool('mungkin')).toBeNull();
		expect(toBool(null)).toBeNull();
		expect(toBool(2)).toBeNull();
	});
});

describe('sanitizeObjectKeys (prototype pollution)', () => {
	it('membuang kunci berbahaya', () => {
		const out = sanitizeObjectKeys({ a: 1, __proto__: { hacked: true }, constructor: 2, prototype: 3 });
		expect(out).toEqual({ a: 1 });
		expect('__proto__' in out ? (out as Record<string, unknown>).__proto__ : undefined).not.toEqual({
			hacked: true
		});
	});
	it('mempertahankan kunci normal', () => {
		expect(sanitizeObjectKeys({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
	});
});
