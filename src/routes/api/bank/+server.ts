/**
 * /api/bank — bank soal tenant (Creator, F12).
 *
 * Auth: `x-tenant` + `x-api-key`. Semua query difilter `tenant_id`.
 *  - GET  ?q=&type=&tag=&limit=&offset= → { questions:[...], total, limit, offset }
 *  - POST body {type,label,options?,correct?,points?,tags?} → buat soal bank.
 *
 * Soal bank dapat ditarik ke sebuah ujian (via bank_pick_count pada form) &
 * diimpor massal dari CSV (/api/bank/import-csv).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
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
import { readJsonBody } from '$lib/server/forms-util.js';
import { QUESTION_TYPES } from '$lib/types.js';
import { isOneOf } from '$lib/util/validate.js';

/* ------------------------------- GET ------------------------------- */

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const url = event.url;

		const where: string[] = ['tenant_id = $1'];
		const params: unknown[] = [tenant.id];

		const type = url.searchParams.get('type');
		if (type) {
			if (!isOneOf(type, QUESTION_TYPES)) {
				throw new ApiError(400, `type harus salah satu dari ${QUESTION_TYPES.join('|')}`);
			}
			params.push(type);
			where.push(`type = $${params.length}`);
		}

		const q = url.searchParams.get('q')?.trim();
		if (q) {
			params.push(`%${q}%`);
			where.push(`(label ILIKE $${params.length} OR tags ILIKE $${params.length})`);
		}

		const tag = url.searchParams.get('tag')?.trim();
		if (tag) {
			params.push(`%${tag}%`);
			where.push(`tags ILIKE $${params.length}`);
		}

		const limit = clamp(url.searchParams.get('limit'), 50, 1, 500);
		const offset = clamp(url.searchParams.get('offset'), 0, 0, 1_000_000);

		const totalRow = await one<{ n: number }>(
			`SELECT count(*)::int AS n FROM formku.bank_questions WHERE ${where.join(' AND ')}`,
			params
		);

		const rows = await many<BankQuestionRow>(
			`SELECT * FROM formku.bank_questions
			  WHERE ${where.join(' AND ')}
			  ORDER BY created_at DESC, id DESC
			  LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
			[...params, limit, offset]
		);

		return json({ questions: rows, total: totalRow?.n ?? 0, limit, offset });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------- POST ------------------------------ */

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const body = await readJsonBody(event.request);

		const type = bankType(body.type);
		const label = bankLabel(body.label);
		const options = buildBankOptions(type, body.options);
		const correct = buildBankCorrect(type, body.correct);
		const points = bankPoints(body.points);
		const tags = bankTags(body.tags);

		const created = await one<BankQuestionRow>(
			`INSERT INTO formku.bank_questions
			   (tenant_id, type, label, options_json, correct_json, points, tags)
			 VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
			 RETURNING *`,
			[
				tenant.id,
				type,
				label,
				options ? JSON.stringify(options) : null,
				correct ? JSON.stringify(correct) : null,
				points,
				tags
			]
		);

		return json(created, { status: 201 });
	} catch (e) {
		return handleAuthError(e);
	}
};

/** Integer dari string dengan default & rentang. */
function clamp(raw: string | null, fallback: number, min: number, max: number): number {
	if (raw === null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}
