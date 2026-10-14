/**
 * /api/bank/[id] — soal bank tunggal (Creator, F12).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: SEMUA query difilter `tenant_id`
 * (soal milik tenant lain → 404, bukan 403, agar keberadaannya tak bocor).
 *  - GET    → ambil satu soal bank.
 *  - PUT    → perbarui (field opsional; bila `type` berubah, options/correct
 *             divalidasi ulang terhadap tipe baru).
 *  - DELETE → hapus.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one, run } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
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
import { parseIdParam, readJsonBody } from '$lib/server/forms-util.js';
import { isQuestionType } from '$lib/types.js';

/** Ambil soal bank MILIK tenant (else 404). */
async function getOwnedBankQuestion(
	tenantId: number,
	id: number
): Promise<BankQuestionRow> {
	const row = await one<BankQuestionRow>(
		`SELECT * FROM formku.bank_questions WHERE id = $1 AND tenant_id = $2`,
		[id, tenantId]
	);
	if (!row) throw new ApiError(404, `soal bank id=${id} tidak ditemukan`);
	return row;
}

/* ------------------------------- GET ------------------------------- */

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id soal bank');
		const row = await getOwnedBankQuestion(tenant.id, id);
		return json(row);
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------- PUT ------------------------------- */

export const PUT: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id soal bank');
		const existing = await getOwnedBankQuestion(tenant.id, id);
		const body = await readJsonBody(event.request);

		// Tentukan tipe efektif (boleh berubah).
		const type = body.type === undefined
			? (isQuestionType(existing.type) ? existing.type : bankType(existing.type))
			: bankType(body.type);

		const label = body.label === undefined ? existing.label : bankLabel(body.label);

		// Options/correct: bila salah satunya disediakan ATAU tipe berubah,
		// hitung ulang agar konsisten dengan tipe efektif. Bila tak disediakan
		// dan tipe tetap, pertahankan nilai lama.
		let optionsJson: string | null;
		let correctJson: string | null;
		const typeChanged = type !== existing.type;

		if (body.options !== undefined || typeChanged) {
			const opts = buildBankOptions(type, body.options);
			optionsJson = opts ? JSON.stringify(opts) : null;
		} else {
			optionsJson = existing.options_json ? JSON.stringify(existing.options_json) : null;
		}

		if (body.correct !== undefined || typeChanged) {
			const corr = buildBankCorrect(type, body.correct);
			correctJson = corr ? JSON.stringify(corr) : null;
		} else {
			correctJson = existing.correct_json ? JSON.stringify(existing.correct_json) : null;
		}

		const points = body.points === undefined ? existing.points : bankPoints(body.points);
		const tags = body.tags === undefined ? existing.tags : bankTags(body.tags);

		const updated = await one<BankQuestionRow>(
			`UPDATE formku.bank_questions
			    SET type = $1, label = $2, options_json = $3::jsonb,
			        correct_json = $4::jsonb, points = $5, tags = $6
			  WHERE id = $7 AND tenant_id = $8
			  RETURNING *`,
			[type, label, optionsJson, correctJson, points, tags, id, tenant.id]
		);
		if (!updated) throw new ApiError(404, `soal bank id=${id} tidak ditemukan`);
		return json(updated);
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------ DELETE ----------------------------- */

export const DELETE: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id soal bank');
		const res = await run(
			`DELETE FROM formku.bank_questions WHERE id = $1 AND tenant_id = $2`,
			[id, tenant.id]
		);
		if (res.rowCount === 0) throw new ApiError(404, `soal bank id=${id} tidak ditemukan`);
		return json({ deleted: true, id });
	} catch (e) {
		return handleAuthError(e);
	}
};
