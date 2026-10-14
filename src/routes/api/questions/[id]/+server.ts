/**
 * /api/questions/[id] — ubah / hapus pertanyaan (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedQuestion (JOIN ke forms,
 * filter tenant_id) → soal milik tenant lain = 404.
 *  - PUT    → ubah type/label/help_text/required/points/section_id/sort/
 *             options/settings/correct (partial).
 *  - DELETE → hapus pertanyaan (cascade conditions & answers).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	asObject,
	buildCorrect,
	buildSettings,
	getOwnedQuestion,
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

export const PUT: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id question');
		const { question, form } = await getOwnedQuestion(tenant.id, id);
		const body = await readJsonBody(event.request);

		const set: string[] = [];
		const params: unknown[] = [];
		const push = (col: string, value: unknown) => {
			params.push(value);
			set.push(`${col} = $${params.length}`);
		};

		let type = question.type as QuestionType;
		if (body.type !== undefined) {
			if (!isOneOf(body.type, QUESTION_TYPES)) {
				throw new ApiError(400, `type harus salah satu dari ${QUESTION_TYPES.join('|')}`);
			}
			type = body.type as QuestionType;
			push('type', type);
		}

		if (body.label !== undefined) push('label', reqText(body.label, LIMITS.label, 'label'));
		if (body.help_text !== undefined)
			push('help_text', optText(body.help_text, LIMITS.helpText) ?? null);
		if (body.required !== undefined) push('required', reqBool(body.required, 'required') ?? false);
		if (body.points !== undefined) push('points', optInt(body.points, 0, 'points') ?? 0);
		if (body.sort !== undefined) push('sort', optInt(body.sort, 0, 'sort') ?? 0);

		if (body.section_id !== undefined) {
			push('section_id', await resolveSectionId(form.id, body.section_id));
		}

		// settings: dibangun ulang bila body memuat settings/options ATAU tipe berubah.
		// Tipe beropsi wajib punya options — pertahankan opsi lama bila tak dikirim ulang.
		if (body.settings !== undefined || body.options !== undefined || body.type !== undefined) {
			const prev = asObject(question.settings_json);
			const merged: Record<string, unknown> = {
				settings: body.settings ?? prev ?? {},
				options:
					body.options ??
					(body.type !== undefined ? (prev?.options ?? undefined) : undefined)
			};
			const settings = buildSettings(type, merged);
			push('settings_json', settings ? JSON.stringify(settings) : null);
		}

		if (body.correct !== undefined) {
			const correct = buildCorrect(type, body.correct);
			push('correct_json', correct ? JSON.stringify(correct) : null);
		}

		if (set.length === 0) throw new ApiError(400, 'tidak ada field yang diubah');

		params.push(question.id, form.id);
		const updated = await one<QuestionRow>(
			`UPDATE formku.questions
			    SET ${set.join(', ')}
			  WHERE id = $${params.length - 1} AND form_id = $${params.length}
			  RETURNING *`,
			params
		);
		if (!updated) throw new ApiError(404, `question id=${id} tidak ditemukan`);
		return json(updated);
	} catch (e) {
		return handleAuthError(e);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id question');
		const { form } = await getOwnedQuestion(tenant.id, id);

		const del = await one<{ id: number }>(
			`DELETE FROM formku.questions WHERE id = $1 AND form_id = $2 RETURNING id`,
			[id, form.id]
		);
		if (!del) throw new ApiError(404, `question id=${id} tidak ditemukan`);
		return json({ deleted: true, id: del.id });
	} catch (e) {
		return handleAuthError(e);
	}
};
