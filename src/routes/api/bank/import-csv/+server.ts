/**
 * /api/bank/import-csv — impor soal massal dari CSV ke bank soal (Creator, F15).
 *
 * Auth: `x-tenant` + `x-api-key`.
 *
 * Body: CSV mentah (Content-Type text/csv / text/plain) ATAU JSON
 *       { csv: "<teks csv>" }.
 *
 * Kolom CSV yang dikenali (header, tak peka huruf besar/kecil, urutan bebas):
 *   label        (WAJIB)  teks soal
 *   type         (opsional, default 'radio') — salah satu QUESTION_TYPES
 *   options      (wajib utk radio/checkbox/dropdown) — dipisah '|'
 *   correct      kunci jawaban; untuk checkbox dipisah '|'
 *   points       (default 1) bilangan bulat >= 0
 *   tags         (opsional) dipisah '|' atau ','
 *
 * Alias header yang diterima: 'soal'→label, 'tipe'→type, 'pilihan'/'opsi'→options,
 * 'kunci'/'jawaban'→correct, 'poin'/'nilai'→points, 'tag'→tags.
 *
 * Perilaku:
 *  - Transaksional: SATU transaksi. Bila ada baris gagal → SELURUH impor dibatalkan
 *    (all-or-nothing) & dikembalikan daftar error per baris agar creator memperbaiki.
 *  - Batas aman (CSV_LIMITS) menolak berkas raksasa / sel terlalu panjang.
 *  - Semua teks disanitasi; format jawaban divalidasi terhadap tipe.
 *
 * Respons sukses: { imported: N, total: M, questions: [...] }
 * Respons gagal validasi: 422 { error, imported:0, errors:[{row,message}], total: M }
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import { tx } from '$lib/server/db.js';
import {
	authTenant,
	bankLabel,
	bankPoints,
	bankTags,
	bankType,
	buildBankCorrect,
	buildBankOptions,
	type BankQuestionRow
} from '$lib/server/m7-util.js';
import { CSV_LIMITS, csvToObjects, parseCsv } from '$lib/util/csv.js';
import { isQuestionType, QUESTION_TYPES, type QuestionType } from '$lib/types.js';

/** Baris gagal (indeks baris = nomor baris data, mulai 1). */
interface RowError {
	row: number;
	message: string;
}

interface PreparedRow {
	type: QuestionType;
	label: string;
	options: Array<{ label: string; value: string }> | null;
	correct: Record<string, unknown> | null;
	points: number;
	tags: string | null;
}

/** Normalisasi nama header → kunci kanonik. */
const HEADER_ALIASES: Record<string, string> = {
	label: 'label',
	soal: 'label',
	pertanyaan: 'label',
	type: 'type',
	tipe: 'type',
	options: 'options',
	option: 'options',
	pilihan: 'options',
	opsi: 'options',
	correct: 'correct',
	kunci: 'correct',
	jawaban: 'correct',
	points: 'points',
	poin: 'points',
	nilai: 'points',
	tags: 'tags',
	tag: 'tags'
};

function canonicalize(obj: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(obj)) {
		const key = HEADER_ALIASES[k.trim().toLowerCase()] ?? k.trim().toLowerCase();
		// Jangan timpa nilai yang sudah ada (header pertama menang).
		if (!(key in out)) out[key] = v;
	}
	return out;
}

/** Pisah string daftar dengan '|' (utama) atau ',' → array bersih. */
function splitList(raw: string | undefined): string[] {
	if (!raw) return [];
	const sep = raw.includes('|') ? '|' : ',';
	return raw
		.split(sep)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** Ubah baris CSV (objek) menjadi PreparedRow; melempar Error berpesan jelas. */
function prepareRow(obj: Record<string, string>): PreparedRow {
	const typeRaw = (obj.type ?? '').trim() || 'radio';
	if (!isQuestionType(typeRaw)) {
		throw new Error(`type '${typeRaw}' tidak dikenal (pilihan: ${QUESTION_TYPES.join('|')})`);
	}
	const type = bankType(typeRaw);

	const label = bankLabel(obj.label ?? '');

	// Options: array label; value = label (kunci memakai teks label).
	const optionLabels = splitList(obj.options);
	const options =
		type === 'radio' || type === 'checkbox' || type === 'dropdown'
			? buildBankOptions(
					type,
					optionLabels.map((l) => ({ label: l, value: l }))
				)
			: buildBankOptions(type, undefined);

	// Kunci: untuk checkbox bisa multi ('|' / ','). Cocokkan ke value (== label).
	let correct: Record<string, unknown> | null = null;
	const keyValues = splitList(obj.correct);
	if (keyValues.length) {
		if (!options && keyValues.length) {
			// Tipe tak beropsi (mis. short_text/number): kunci tunggal.
			correct = buildBankCorrect(type, { value: keyValues[0] });
		} else {
			// Pastikan kunci merujuk opsi yang ada.
			const valid = new Set((options ?? []).map((o) => o.value));
			for (const kv of keyValues) {
				if (!valid.has(kv)) {
					throw new Error(`kunci '${kv}' tidak ada dalam options`);
				}
			}
			correct =
				type === 'checkbox'
					? buildBankCorrect(type, { values: keyValues })
					: buildBankCorrect(type, { value: keyValues[0] });
		}
	} else {
		correct = buildBankCorrect(type, undefined);
	}

	const points = bankPoints(obj.points, 1);
	const tags = bankTags(obj.tags);

	return { type, label, options, correct, points, tags };
}

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);

		// Ambil teks CSV dari body (raw atau JSON).
		const contentType = (event.request.headers.get('content-type') ?? '').toLowerCase();
		let csvText = '';
		if (contentType.includes('application/json')) {
			let body: unknown;
			try {
				body = await event.request.json();
			} catch {
				throw new ApiError(400, 'body JSON tidak valid');
			}
			if (typeof body !== 'object' || body === null || Array.isArray(body)) {
				throw new ApiError(400, 'body harus objek { csv: "..." }');
			}
			const csvField = (body as Record<string, unknown>).csv;
			if (typeof csvField !== 'string' || !csvField.trim()) {
				throw new ApiError(400, 'field "csv" wajib diisi (teks CSV)');
			}
			csvText = csvField;
		} else {
			csvText = await event.request.text();
		}

		if (!csvText.trim()) {
			throw new ApiError(400, 'berkas CSV kosong');
		}
		if (csvText.length > CSV_LIMITS.bytes) {
			throw new ApiError(413, `berkas CSV terlalu besar (maksimum ${CSV_LIMITS.bytes} karakter)`);
		}

		let parsed;
		try {
			parsed = parseCsv(csvText);
		} catch (err) {
			throw new ApiError(400, err instanceof Error ? err.message : 'CSV tidak valid');
		}

		if (parsed.headers.length === 0 || parsed.rows.length === 0) {
			throw new ApiError(400, 'CSV tidak memiliki header/data');
		}

		const objects = csvToObjects(parsed);
		const prepared: PreparedRow[] = [];
		const errors: RowError[] = [];

		objects.forEach((rawObj, idx) => {
			const obj = canonicalize(rawObj);
			try {
				prepared.push(prepareRow(obj));
			} catch (err) {
				errors.push({
					row: idx + 1,
					message: err instanceof Error ? err.message : 'baris tidak valid'
				});
			}
		});

		if (errors.length) {
			// All-or-nothing: laporkan semua baris bermasalah, jangan impor apa pun.
			return json(
				{
					error: `impor dibatalkan: ${errors.length} dari ${objects.length} baris tidak valid`,
					imported: 0,
					total: objects.length,
					errors,
					truncated: parsed.truncated
				},
				{ status: 422 }
			);
		}

		// Simpan dalam SATU transaksi.
		const inserted = await tx(async (c) => {
			const out: BankQuestionRow[] = [];
			for (const p of prepared) {
				const r = await c.query<BankQuestionRow>(
					`INSERT INTO formku.bank_questions
					   (tenant_id, type, label, options_json, correct_json, points, tags)
					 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
					 RETURNING *`,
					[
						tenant.id,
						p.type,
						p.label,
						p.options ? JSON.stringify(p.options) : null,
						p.correct ? JSON.stringify(p.correct) : null,
						p.points,
						p.tags
					]
				);
				out.push(r.rows[0]);
			}
			return out;
		});

		return json(
			{
				imported: inserted.length,
				total: objects.length,
				truncated: parsed.truncated,
				questions: inserted
			},
			{ status: 201 }
		);
	} catch (e) {
		return handleAuthError(e);
	}
};
