/**
 * /api/forms/[id]/responses — daftar respons form (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm (404 bila bukan milik).
 *  - GET ?status=&q=&sort=&limit=&offset=
 *      → { form, responses:[{...,nama,email,skor,durasi,status,answered}],
 *          total, limit, offset }
 *
 * Query WAJIB difilter `form_id` (form sudah divalidasi milik tenant). `q`
 * mencari pada nama/email responden (parameterized → aman dari injeksi).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { handleAuthError } from '$lib/server/auth.js';
import { authTenant, ownedForm, orderClauseForSort, parseResponseFilter } from '$lib/server/m7-util.js';
import { parseIdParam } from '$lib/server/forms-util.js';

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const form = await ownedForm(tenant.id, parseIdParam(event.params.id, 'id form'));
		const filter = parseResponseFilter(event.url);

		const where: string[] = ['r.form_id = $1'];
		const params: unknown[] = [form.id];

		if (filter.status) {
			params.push(filter.status);
			where.push(`r.status = $${params.length}`);
		}
		if (filter.q) {
			params.push(`%${filter.q}%`);
			where.push(
				`(r.respondent_name ILIKE $${params.length} OR r.respondent_email ILIKE $${params.length})`
			);
		}

		const totalRow = await one<{ n: number }>(
			`SELECT count(*)::int AS n FROM formku.responses r WHERE ${where.join(' AND ')}`,
			params
		);

		const limitParams = [...params, filter.limit, filter.offset];
		const rows = await many(
			`SELECT r.*,
			        (SELECT count(*)::int FROM formku.answers a WHERE a.response_id = r.id) AS answered_count
			   FROM formku.responses r
			  WHERE ${where.join(' AND ')}
			  ORDER BY ${orderClauseForSort(filter.sort)}
			  LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
			limitParams
		);

		return json({
			form: {
				id: form.id,
				title: form.title,
				slug: form.slug,
				mode: form.mode,
				status: form.status,
				passing_grade: form.passing_grade,
				show_score: form.show_score
			},
			responses: rows,
			total: totalRow?.n ?? 0,
			limit: filter.limit,
			offset: filter.offset
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
