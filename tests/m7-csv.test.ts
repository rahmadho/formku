/**
 * csv.test.ts — Uji util CSV Modul M7 (parser ekspor/impor).
 *
 * Mengunci: pembentukan sel RFC-4180, netralisasi formula-injection dua arah
 * (ekspor & deteksi), auto-deteksi pemisah, penanganan kutip/newline/BOM,
 * normalisasi lebar baris, dan penegakan batas anti-DoS.
 */
import { describe, it, expect } from 'vitest';
import {
	CSV_LIMITS,
	csvCell,
	csvToObjects,
	detectDelimiter,
	guardFormula,
	parseCsv,
	toCsv
} from '../src/lib/util/csv.js';

describe('csvCell — pembentukan sel aman', () => {
	it('null/undefined → string kosong', () => {
		expect(csvCell(null)).toBe('');
		expect(csvCell(undefined)).toBe('');
	});

	it('angka & boolean → teks', () => {
		expect(csvCell(42)).toBe('42');
		expect(csvCell(0)).toBe('0');
		expect(csvCell(true)).toBe('true');
		expect(csvCell(false)).toBe('false');
	});

	it('mengutip nilai yang mengandung koma/kutip/newline', () => {
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('kata "kutip"')).toBe('"kata ""kutip"""');
		expect(csvCell('baris1\nbaris2')).toBe('"baris1\nbaris2"');
	});

	it('mengutip nilai dengan spasi tepi', () => {
		expect(csvCell(' pad ')).toBe('" pad "');
	});

	it('objek/array → JSON', () => {
		expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
		expect(csvCell(['A', 'C'])).toBe('"[""A"",""C""]"');
	});
});

describe('guardFormula — anti formula-injection', () => {
	it('menetralkan awalan = + - @ TAB CR', () => {
		expect(guardFormula('=SUM(A1)')).toBe("'=SUM(A1)");
		expect(guardFormula('+1234')).toBe("'+1234");
		expect(guardFormula('-1234')).toBe("'-1234");
		expect(guardFormula('@cmd')).toBe("'@cmd");
		expect(guardFormula('\tx')).toBe("'\tx");
	});

	it('membiarkan teks biasa apa adanya', () => {
		expect(guardFormula('Jakarta')).toBe('Jakarta');
		expect(guardFormula('')).toBe('');
	});

	it('csvCell menetralkan formula & mengutip bila perlu', () => {
		expect(csvCell('=1+1')).toBe("'=1+1");
		expect(csvCell('=a,b')).toBe(`"'=a,b"`);
	});

	it('guard bisa dimatikan untuk data tepercaya', () => {
		expect(csvCell('=1+1', { guard: false })).toBe('=1+1');
	});
});

describe('toCsv — ekspor', () => {
	it('membangun header + baris dengan CRLF & BOM', () => {
		const out = toCsv(['a', 'b'], [[1, 2], [3, 4]]);
		expect(out.charCodeAt(0)).toBe(0xfeff);
		const body = out.slice(1);
		expect(body).toBe('a,b\r\n1,2\r\n3,4\r\n');
	});

	it('BOM dapat dimatikan', () => {
		const out = toCsv(['a'], [['x']], { bom: false });
		expect(out.charCodeAt(0)).not.toBe(0xfeff);
		expect(out).toBe('a\r\nx\r\n');
	});

	it('mendukung pemisah titik-koma', () => {
		const out = toCsv(['a', 'b'], [[1, 2]], { bom: false, delimiter: ';' });
		expect(out).toBe('a;b\r\n1;2\r\n');
	});

	it('meng-escape sel ber-koma & kutip', () => {
		const out = toCsv(['x'], [['a,"b"']], { bom: false });
		expect(out).toBe('x\r\n"a,""b"""\r\n');
	});
});

describe('detectDelimiter', () => {
	it('memilih koma untuk CSV koma', () => {
		expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
	});
	it('memilih titik-koma untuk CSV Eropa', () => {
		expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
	});
	it('mengabaikan pemisah di dalam tanda kutip', () => {
		// Hanya satu koma nyata (di luar kutip) dan dua titik-koma.
		expect(detectDelimiter('"a,b,c";x;y')).toBe(';');
	});
	it('default koma bila tak ada pemisah', () => {
		expect(detectDelimiter('single')).toBe(',');
	});
});

describe('parseCsv — parser', () => {
	it('mengurai header + baris sederhana', () => {
		const r = parseCsv('a,b,c\n1,2,3\n4,5,6');
		expect(r.headers).toEqual(['a', 'b', 'c']);
		expect(r.rows).toEqual([
			['1', '2', '3'],
			['4', '5', '6']
		]);
	});

	it('membuang BOM UTF-8 di awal', () => {
		const r = parseCsv('\uFEFFlabel,type\nx,y');
		expect(r.headers).toEqual(['label', 'type']);
	});

	it('menangani kutip ganda & koma di dalam sel', () => {
		const r = parseCsv('label,options\n"Jakarta, Bandung",A');
		expect(r.rows[0]).toEqual(['Jakarta, Bandung', 'A']);
	});

	it('menangani kutip ter-escape ("" → ")', () => {
		const r = parseCsv('a\n"kata ""kutip"""');
		expect(r.rows[0]).toEqual(['kata "kutip"']);
	});

	it('menangani baris baru di dalam sel berkutip', () => {
		const r = parseCsv('a,b\n"baris1\nbaris2",x');
		expect(r.rows[0]).toEqual(['baris1\nbaris2', 'x']);
	});

	it('mendukung CRLF dan CR tunggal', () => {
		expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']]);
		expect(parseCsv('a,b\r1,2').rows).toEqual([['1', '2']]);
	});

	it('normalisasi lebar baris ke jumlah kolom header', () => {
		const r = parseCsv('a,b,c\n1,2\n4,5,6,7');
		expect(r.rows[0]).toEqual(['1', '2', '']);
		expect(r.rows[1]).toEqual(['4', '5', '6']); // kelebihan dipangkas
	});

	it('mengabaikan baris kosong total', () => {
		const r = parseCsv('a,b\n1,2\n\n3,4\n');
		expect(r.rows).toEqual([
			['1', '2'],
			['3', '4']
		]);
	});

	it('auto-deteksi pemisah titik-koma', () => {
		const r = parseCsv('a;b\n1;2');
		expect(r.delimiter).toBe(';');
		expect(r.rows).toEqual([['1', '2']]);
	});

	it('menegakkan batas panjang sel (anti-DoS)', () => {
		const big = 'x'.repeat(CSV_LIMITS.cell + 10);
		expect(() => parseCsv(`a\n${big}`)).toThrow(/terlalu panjang/i);
	});

	it('menegakkan batas ukuran berkas', () => {
		const huge = 'a'.repeat(CSV_LIMITS.bytes + 1);
		expect(() => parseCsv(huge)).toThrow(/terlalu besar/i);
	});

	it('CSV kosong → header & baris kosong', () => {
		const r = parseCsv('');
		expect(r.headers).toEqual([]);
		expect(r.rows).toEqual([]);
	});
});

describe('csvToObjects', () => {
	it('memetakan header→nilai', () => {
		const r = parseCsv('label,type\nSoal,radio');
		expect(csvToObjects(r)).toEqual([{ label: 'Soal', type: 'radio' }]);
	});

	it('header duplikat diberi nama unik', () => {
		const parsed = parseCsv('a,a\n1,2');
		const objs = csvToObjects(parsed);
		expect(objs[0]).toEqual({ a: '1', a_2: '2' });
	});

	it('header kosong diberi nama default', () => {
		const parsed = parseCsv(',b\n1,2');
		expect(csvToObjects(parsed)[0]).toEqual({ kolom_1: '1', b: '2' });
	});
});
