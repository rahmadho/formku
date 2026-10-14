/**
 * /api/questions — daftar & buat pertanyaan milik sebuah form (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`.
 *  - GET  → ?form_id=N [&section_id=M] → daftar pertanyaan (isolasi via getOwnedForm).
 *  - POST → body {form_id, type, label, help_text?, required?, points?,
 *                 section_id?, sort?, options?, correct?, settings?} → buat.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	buildCorrect,
	buildSettings,
	getOwnedForm,
	nextSort,
	optInt,
	optText,
	parseIdParam,
	readJsonBody,
	reqBool,
	reqText,
	resolveSectionId,
	type QuestionRow
} from '$lib/server/forms-util.js';
import { LIMITS, QUESTION_TYPES, type QuestionType } from '$lib/types.js';
import { isOneOf } from '$lib/util/validate.js';

/* ------------------------------- GET ------------------------------- */

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const rawForm = event.url.searchParams.get('form_id');
		if (!rawForm) throw new ApiError(400, 'parameter form_id wajib diisi');
		const form = await getOwnedForm(tenant.id, parseIdParam(rawForm, 'form_id'));

		const rawSection = event.url.searchParams.get('section_id');
		const params: unknown[] = [form.id];
		let filter = '';
		if (rawSection !== null) {
			const sid = parseIdParam(rawSection, 'section_id');
			params.push(sid);
			filter = ` AND section_id = $${params.length}`;
		}

		const questions = await many<QuestionRow>(
			`SELECT * FROM formku.questions
			  WHERE form_id = $1${filter}
			  ORDER BY sort ASC, id ASC`,
			params
		);
		return json({ questions });
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

		if (!isOneOf(body.type, QUESTION_TYPES)) {
			throw new ApiError(400, `type harus salah satu dari ${QUESTION_TYPES.join('|')}`);
		}
		const type = body.type as QuestionType;

		const label = reqText(body.label, LIMITS.label, 'label');
		const helpText = optText(body.help_text, LIMITS.helpText) ?? null;
		const required = reqBool(body.required, 'required') ?? false;
		const points = optInt(body.points, 0, 'points') ?? 0;

		const sectionId = await resolveSectionId(form.id, body.section_id);

		const settings = buildSettings(type, body);
		const correct = buildCorrect(type, body.correct);

		const sort = optInt(body.sort, 0, 'sort') ?? (await nextSort('questions', form.id));

		const created = await one<QuestionRow>(
			`INSERT INTO formku.questions
			   (form_id, section_id, type, label, help_text, required, points,
			    correct_json, settings_json, sort)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
			 RETURNING *`,
			[
				form.id,
				sectionId,
				type,
				label,
				helpText,
				required,
				points,
				correct ? JSON.stringify(correct) : null,
				settings ? JSON.stringify(settings) : null,
				sort
			]
		);
		return json(created, { status: 201 });
	} catch (e) {
		return handleAuthError(e);
	}
};
