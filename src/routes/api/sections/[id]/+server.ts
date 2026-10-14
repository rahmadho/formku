/**
 * /api/sections/[id] — ubah / hapus section (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedSection (JOIN ke forms,
 * filter tenant_id) → section milik tenant lain = 404.
 *  - PUT    → ubah title/description/sort/timer_seconds (partial).
 *  - DELETE → hapus section; questions.section_id di-set NULL via ON DELETE SET NULL.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	getOwnedSection,
	optInt,
	optMultiline,
	parseIdParam,
	readJsonBody,
	reqText,
	type SectionRow
} from '$lib/server/forms-util.js';
import { LIMITS, MAX_TIMER_SECONDS } from '$lib/types.js';

export const PUT: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id section');
		const { section, form } = await getOwnedSection(tenant.id, id);
		const body = await readJsonBody(event.request);

		const set: string[] = [];
		const params: unknown[] = [];
		const push = (col: string, value: unknown) => {
			params.push(value);
			set.push(`${col} = $${params.length}`);
		};

		if (body.title !== undefined) push('title', reqText(body.title, LIMITS.title, 'title'));
		if (body.description !== undefined)
			push('description', optMultiline(body.description, LIMITS.description) ?? null);
		if (body.sort !== undefined) push('sort', optInt(body.sort, 0, 'sort') ?? 0);
		if (body.timer_seconds !== undefined) {
			const t = optInt(body.timer_seconds, 0, 'timer_seconds') ?? null;
			if (t !== null && t > MAX_TIMER_SECONDS)
				throw new ApiError(400, `timer_seconds maksimum ${MAX_TIMER_SECONDS}`);
			push('timer_seconds', t);
		}

		if (set.length === 0) throw new ApiError(400, 'tidak ada field yang diubah');

		params.push(section.id, form.id);
		const updated = await one<SectionRow>(
			`UPDATE formku.sections
			    SET ${set.join(', ')}
			  WHERE id = $${params.length - 1} AND form_id = $${params.length}
			  RETURNING *`,
			params
		);
		if (!updated) throw new ApiError(404, `section id=${id} tidak ditemukan`);
		return json(updated);
	} catch (e) {
		return handleAuthError(e);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id section');
		const { form } = await getOwnedSection(tenant.id, id);

		const del = await one<{ id: number }>(
			`DELETE FROM formku.sections WHERE id = $1 AND form_id = $2 RETURNING id`,
			[id, form.id]
		);
		if (!del) throw new ApiError(404, `section id=${id} tidak ditemukan`);
		return json({ deleted: true, id: del.id });
	} catch (e) {
		return handleAuthError(e);
	}
};
