/**
 * /api/sections — daftar & buat section milik sebuah form (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`.
 *  - GET  → ?form_id=N → daftar section form (isolasi via getOwnedForm).
 *  - POST → body {form_id, title, description?, timer_seconds?, sort?} → buat.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	getOwnedForm,
	nextSort,
	optInt,
	optMultiline,
	parseIdParam,
	readJsonBody,
	reqText,
	type SectionRow
} from '$lib/server/forms-util.js';
import { LIMITS, MAX_TIMER_SECONDS } from '$lib/types.js';

/* ------------------------------- GET ------------------------------- */

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const raw = event.url.searchParams.get('form_id');
		if (!raw) throw new ApiError(400, 'parameter form_id wajib diisi');
		const form = await getOwnedForm(tenant.id, parseIdParam(raw, 'form_id'));

		const sections = await many<SectionRow>(
			`SELECT * FROM formku.sections WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[form.id]
		);
		return json({ sections });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------- POST ------------------------------ */

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const body = await readJsonBody(event.request);

		const formId = parseIdParam(
			body.form_id === undefined ? undefined : String(body.form_id),
			'form_id'
		);
		const form = await getOwnedForm(tenant.id, formId);

		const title = reqText(body.title, LIMITS.title, 'title');
		const description = optMultiline(body.description, LIMITS.description) ?? null;

		const timerSeconds = optInt(body.timer_seconds, 0, 'timer_seconds') ?? null;
		if (timerSeconds !== null && timerSeconds > MAX_TIMER_SECONDS) {
			throw new ApiError(400, `timer_seconds maksimum ${MAX_TIMER_SECONDS}`);
		}
		const sort = optInt(body.sort, 0, 'sort') ?? (await nextSort('sections', form.id));

		const created = await one<SectionRow>(
			`INSERT INTO formku.sections (form_id, title, description, sort, timer_seconds)
			 VALUES ($1,$2,$3,$4,$5)
			 RETURNING *`,
			[form.id, title, description, sort, timerSeconds]
		);
		return json(created, { status: 201 });
	} catch (e) {
		return handleAuthError(e);
	}
};
