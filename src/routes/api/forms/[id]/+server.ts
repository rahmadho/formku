/**
 * /api/forms/[id] — detail, ubah, hapus satu form (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm (filter tenant_id).
 *  - GET    → detail form + sections + questions (urutan sort).
 *  - PUT    → ubah metadata form (partial; hanya field yang dikirim).
 *  - DELETE → hapus form (cascade sections/questions/responses).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	boolOr,
	getOwnedForm,
	loadStructure,
	optEnum,
	optInt,
	optMultiline,
	parseIdParam,
	readJsonBody,
	reqText,
	uniqueFormSlug,
	type FormRow
} from '$lib/server/forms-util.js';
import {
	FORM_MODES,
	FORM_STATUSES,
	LIMITS,
	MAX_TIMER_SECONDS,
	TIMER_SCOPES,
	type FormMode,
	type FormStatus,
	type TimerScope
} from '$lib/types.js';

/* ------------------------------- GET ------------------------------- */

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id form');
		const form = await getOwnedForm(tenant.id, id);
		const { sections, questions } = await loadStructure(form.id);
		return json({ form, sections, questions });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------- PUT ------------------------------- */

export const PUT: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id form');
		const form = await getOwnedForm(tenant.id, id);
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

		if (body.slug !== undefined) {
			if (typeof body.slug !== 'string' || !body.slug.trim()) {
				throw new ApiError(400, 'slug tidak valid');
			}
			push('slug', await uniqueFormSlug(body.slug, form.id));
		}

		if (body.mode !== undefined)
			push('mode', optEnum<FormMode>(body.mode, FORM_MODES, 'mode') as FormMode);
		if (body.status !== undefined)
			push('status', optEnum<FormStatus>(body.status, FORM_STATUSES, 'status') as FormStatus);

		if (body.timer_seconds !== undefined) {
			const t = optInt(body.timer_seconds, 0, 'timer_seconds') ?? null;
			if (t !== null && t > MAX_TIMER_SECONDS)
				throw new ApiError(400, `timer_seconds maksimum ${MAX_TIMER_SECONDS}`);
			push('timer_seconds', t);
		}
		if (body.timer_scope !== undefined)
			push('timer_scope', optEnum<TimerScope>(body.timer_scope, TIMER_SCOPES, 'timer_scope'));

		for (const b of ['shuffle_questions', 'shuffle_options', 'show_score', 'require_token'] as const) {
			if (body[b] !== undefined) push(b, boolOr(boolField(body[b], b), false));
		}

		if (body.bank_pick_count !== undefined)
			push('bank_pick_count', optInt(body.bank_pick_count, 1, 'bank_pick_count') ?? null);
		if (body.passing_grade !== undefined) {
			const p = optInt(body.passing_grade, 0, 'passing_grade') ?? null;
			if (p !== null && p > 100) throw new ApiError(400, 'passing_grade harus 0–100 atau null');
			push('passing_grade', p);
		}
		if (body.thanks_text !== undefined)
			push('thanks_text', optMultiline(body.thanks_text, LIMITS.description) ?? null);
		if (body.theme_json !== undefined) push('theme_json', sanitizeTheme(body.theme_json));
		if (body.access_token !== undefined)
			push('access_token', optStringOrNull(body.access_token, 200));

		if (set.length === 0) throw new ApiError(400, 'tidak ada field yang diubah');

		params.push(form.id, tenant.id);
		const updated = await one<FormRow>(
			`UPDATE formku.forms
			    SET ${set.join(', ')}
			  WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
			  RETURNING *`,
			params
		);
		if (!updated) throw new ApiError(404, `form id=${id} tidak ditemukan`);
		return json(updated);
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------ DELETE ----------------------------- */

export const DELETE: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id form');
		await getOwnedForm(tenant.id, id);

		const del = await one<{ id: number }>(
			`DELETE FROM formku.forms WHERE id = $1 AND tenant_id = $2 RETURNING id`,
			[id, tenant.id]
		);
		if (!del) throw new ApiError(404, `form id=${id} tidak ditemukan`);
		return json({ deleted: true, id: del.id });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------ util ------------------------------- */

function boolField(v: unknown, label: string): boolean | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'boolean') throw new ApiError(400, `${label} harus boolean`);
	return v;
}

function optStringOrNull(v: unknown, max: number): string | null {
	if (v === null || v === '') return null;
	if (typeof v !== 'string') throw new ApiError(400, 'nilai harus string atau null');
	return v.slice(0, max);
}

function sanitizeTheme(v: unknown): Record<string, string> | null {
	if (v === null) return null;
	if (typeof v !== 'object' || Array.isArray(v)) {
		throw new ApiError(400, 'theme_json harus objek atau null');
	}
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		if (/^[a-zA-Z0-9_]{1,32}$/.test(k) && typeof val === 'string') {
			out[k] = val.slice(0, 100);
		}
	}
	return Object.keys(out).length ? out : null;
}
