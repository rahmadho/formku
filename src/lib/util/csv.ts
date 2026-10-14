/**
 * csv.ts — Utilitas CSV untuk FormKu (Modul M7).
 *
 * Dipakai dua arah:
 *  1. EKSPOR respons/soal  → `toCsv()` (RFC-4180, escaping aman).
 *  2. IMPOR soal massal    → `parseCsv()` (dukung kutip ganda, koma/kurung
 *     dalam sel, baris baru dalam sel, BOM, dan pemisah `,` atau `;`).
 *
 * ⚠️ KEAMANAN (dua arah):
 *  - EKSPOR: nilai yang diawali `=`, `+`, `-`, `@`, TAB, atau CR dinetralkan
 *    dengan prefiks apostrof (`'`) agar Excel/Sheets tidak menafsirkannya
 *    sebagai rumus (CSV/formula injection). Lihat `guardFormula`.
 *  - IMPOR: keluaran SELALU teks polos; tidak ada evaluasi. Batas jumlah baris
 *    & panjang sel ditegakkan agar file besar/berniat jahat tidak menghabiskan
 *    memori (anti-DoS).
 *
 * Modul ini MURNI (tanpa akses DB/jaringan) sehingga mudah diuji.
 */

/** Batas aman untuk impor (anti-DoS). */
export const CSV_LIMITS = {
	/** Panjang maksimum satu sel (karakter). */
	cell: 20_000,
	/** Jumlah maksimum baris data yang diproses dari satu unggahan. */
	rows: 10_000,
	/** Jumlah maksimum kolom per baris. */
	columns: 64,
	/** Ukuran maksimum teks CSV mentah (byte/karakter). */
	bytes: 5_000_000
} as const;

/* ------------------------------------------------------------------ */
/* EKSPOR                                                              */
/* ------------------------------------------------------------------ */

/**
 * Netralkan nilai yang bisa disalahartikan sebagai rumus oleh spreadsheet.
 * Excel/Google Sheets memperlakukan sel yang diawali = + - @ (dan TAB/CR)
 * sebagai formula. Kita prefiks dengan apostrof agar diperlakukan teks.
 */
export function guardFormula(value: string): string {
	if (value.length === 0) return value;
	const first = value[0];
	if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
		return `'${value}`;
	}
	return value;
}

/**
 * Ubah satu nilai menjadi sel CSV: konversi ke string, netralkan rumus,
 * lalu kutip bila mengandung koma, kutip, newline, atau spasi tepi.
 */
export function csvCell(value: unknown, opts: { guard?: boolean } = {}): string {
	const guard = opts.guard ?? true;
	let s: string;
	if (value === null || value === undefined) s = '';
	else if (typeof value === 'string') s = value;
	else if (typeof value === 'number') s = Number.isFinite(value) ? String(value) : '';
	else if (typeof value === 'boolean') s = value ? 'true' : 'false';
	else if (typeof value === 'object') {
		// Objek/array (mis. value_json jawaban) → JSON rapi satu baris.
		try {
			s = JSON.stringify(value);
		} catch {
			s = '';
		}
	} else s = String(value);

	if (guard) s = guardFormula(s);

	const mustQuote = /[",\r\n]/.test(s) || /^\s|\s$/.test(s);
	if (!mustQuote) return s;
	return `"${s.replace(/"/g, '""')}"`;
}

/** Opsi ekspor CSV. */
export interface ToCsvOptions {
	/** Pemisah kolom. Default ','. */
	delimiter?: string;
	/** Akhiran baris. Default '\r\n' (RFC-4180). */
	eol?: string;
	/** BOM UTF-8 di depan (agar Excel mengenali encoding). Default true. */
	bom?: boolean;
	/** Netralkan formula (default true). Matikan hanya untuk data tepercaya. */
	guard?: boolean;
}

/**
 * Bangun teks CSV dari header + baris.
 * `rows` boleh array of array (posisi) — pemanggil yang memetakan urutan kolom.
 */
export function toCsv(
	headers: readonly string[],
	rows: readonly (readonly unknown[])[],
	options: ToCsvOptions = {}
): string {
	const delimiter = options.delimiter ?? ',';
	const eol = options.eol ?? '\r\n';
	const guard = options.guard ?? true;

	const lines: string[] = [];
	lines.push(headers.map((h) => csvCell(h, { guard })).join(delimiter));
	for (const row of rows) {
		lines.push(row.map((c) => csvCell(c, { guard })).join(delimiter));
	}
	const body = lines.join(eol) + eol;
	// BOM membantu Excel mendeteksi UTF-8 (mis. aksen/emoji).
	return (options.bom ?? true) ? '\uFEFF' + body : body;
}

/* ------------------------------------------------------------------ */
/* IMPOR                                                               */
/* ------------------------------------------------------------------ */

/** Hasil parse CSV: header + baris (array sel), plus meta deteksi. */
export interface ParsedCsv {
	/** Nama kolom (baris pertama), sudah dinormalisasi (trim, tanpa BOM). */
	headers: string[];
	/** Baris data; tiap baris array string sepanjang header (dipangkas/diisi ''). */
	rows: string[][];
	/** Pemisah yang terdeteksi dipakai. */
	delimiter: string;
	/** Jumlah baris data yang diabaikan karena melebihi batas. */
	truncated: number;
}

/**
 * Deteksi pemisah: bandingkan jumlah `,` vs `;` vs TAB pada baris pertama yang
 * mengandung pemisah (di luar tanda kutip). Default ','.
 */
export function detectDelimiter(text: string): string {
	// Ambil beberapa baris awal untuk voting yang stabil.
	const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
	const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
	let inQuotes = false;
	for (let i = 0; i < sample.length; i++) {
		const ch = sample[i];
		if (ch === '"') {
			if (inQuotes && sample[i + 1] === '"') i++;
			else inQuotes = !inQuotes;
			continue;
		}
		if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++;
	}
	let best = ',';
	let bestCount = 0;
	for (const d of [',', ';', '\t']) {
		if (counts[d] > bestCount) {
			best = d;
			bestCount = counts[d];
		}
	}
	return best;
}

/**
 * Urai teks CSV menjadi header + baris. Tahan terhadap:
 *  - BOM UTF-8 di awal berkas,
 *  - sel berkutip ganda dengan koma/baris-baru/kutip-ter-escape ("") di dalamnya,
 *  - CRLF maupun LF,
 *  - pemisah ',' atau ';' (auto-deteksi bila `delimiter` tidak diberikan).
 *
 * Batas CSV_LIMITS ditegakkan (panjang sel, jumlah kolom, jumlah baris, ukuran).
 * Melempar `Error` dengan pesan berbahasa Indonesia bila melebihi batas.
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
	if (typeof text !== 'string') throw new Error('CSV harus berupa teks');
	// Buang BOM di awal.
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	if (text.length > CSV_LIMITS.bytes) {
		throw new Error(`berkas CSV terlalu besar (maksimum ${CSV_LIMITS.bytes} karakter)`);
	}

	const sep = delimiter ?? detectDelimiter(text);

	const records: string[][] = [];
	let field = '';
	let record: string[] = [];
	let inQuotes = false;
	let fieldStarted = false;

	const pushField = () => {
		if (field.length > CSV_LIMITS.cell) {
			throw new Error(`sel CSV terlalu panjang (maksimum ${CSV_LIMITS.cell} karakter)`);
		}
		record.push(field);
		field = '';
		fieldStarted = false;
	};
	const pushRecord = () => {
		pushField();
		// Abaikan baris kosong total (satu sel kosong).
		if (!(record.length === 1 && record[0] === '')) {
			if (record.length > CSV_LIMITS.columns) {
				throw new Error(`terlalu banyak kolom (maksimum ${CSV_LIMITS.columns})`);
			}
			records.push(record);
		}
		record = [];
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i];

		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}

		if (ch === '"' && !fieldStarted) {
			inQuotes = true;
			fieldStarted = true;
			i++;
			continue;
		}
		if (ch === sep) {
			pushField();
			i++;
			continue;
		}
		if (ch === '\r') {
			// CRLF atau CR tunggal → akhir baris.
			pushRecord();
			i += text[i + 1] === '\n' ? 2 : 1;
			continue;
		}
		if (ch === '\n') {
			pushRecord();
			i++;
			continue;
		}
		field += ch;
		fieldStarted = true;
		i++;
	}
	// Baris terakhir (tanpa newline penutup).
	if (field !== '' || record.length > 0) pushRecord();

	if (records.length === 0) {
		return { headers: [], rows: [], delimiter: sep, truncated: 0 };
	}

	const rawHeaders = records[0].map((h) => h.trim());
	const dataRecords = records.slice(1);
	const truncated = Math.max(0, dataRecords.length - CSV_LIMITS.rows);
	const limited = dataRecords.slice(0, CSV_LIMITS.rows);

	// Normalisasi lebar tiap baris ke jumlah kolom header.
	const width = rawHeaders.length;
	const rows = limited.map((r) => {
		const out = r.slice(0, width);
		while (out.length < width) out.push('');
		return out;
	});

	return { headers: rawHeaders, rows, delimiter: sep, truncated };
}

/**
 * Ubah ParsedCsv menjadi array objek {header: nilai}. Header kosong/duplikat
 * diberi nama unik agar tidak saling menimpa.
 */
export function csvToObjects(parsed: ParsedCsv): Array<Record<string, string>> {
	const seen = new Set<string>();
	const headers = parsed.headers.map((h, idx) => {
		let key = h.trim() || `kolom_${idx + 1}`;
		if (seen.has(key)) {
			let n = 2;
			while (seen.has(`${key}_${n}`)) n++;
			key = `${key}_${n}`;
		}
		seen.add(key);
		return key;
	});
	return parsed.rows.map((r) => {
		const obj: Record<string, string> = {};
		headers.forEach((h, idx) => (obj[h] = r[idx] ?? ''));
		return obj;
	});
}
