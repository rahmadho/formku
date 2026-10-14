/**
 * /api/forms — daftar & buat form (Creator/tenant).
 *
 * Auth: header `x-tenant: <slug>` + `x-api-key: *** (requireTenant).
 *  - GET  → daftar form MILIK tenant (opsional ?status=&mode=&q=), + jumlah soal.
 *  - POST → body {title, mode?, description?, ...opsi} → buat form draft baru.
 *
 * Isolasi: SETIAP query difilter `tenant_id`. Kontrak §4.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	boolOr,
	optEnum,
	optInt,
	optMultiline,
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
		const url = event.url;

		const status = url.searchParams.get('status');
		const mode = url.searchParams.get('mode');
		const q = url.searchParams.get('q')?.trim();

		const where: string[] = ['f.tenant_id = $1'];
		const params: unknown[] = [tenant.id];

		if (status) {
			if (!(FORM_STATUSES as readonly string[]).includes(status)) {
				throw new ApiError(400, `status harus salah satu dari ${FORM_STATUSES.join('|')}`);
			}
			params.push(status);
			where.push(`f.status = $${params.length}`);
		}
		if (mode) {
			if (!(FORM_MODES as readonly string[]).includes(mode)) {
				throw new ApiError(400, `mode harus salah satu dari ${FORM_MODES.join('|')}`);
			}
			params.push(mode);
			where.push(`f.mode = $${params.length}`);
		}
		if (q) {
			params.push(`%${q}%`);
			where.push(`(f.title ILIKE $${params.length} OR f.slug ILIKE $${params.length})`);
		}

		const rows = await many<FormRow & { question_count: number; response_count: number }>(
			`SELECT f.*,
			        (SELECT count(*)::int FROM formku.questions qq WHERE qq.form_id = f.id) AS question_count,
			        (SELECT count(*)::int FROM formku.responses r WHERE r.form_id = f.id) AS response_count
			   FROM formku.forms f
			  WHERE ${where.join(' AND ')}
			  ORDER BY f.created_at DESC, f.id DESC`,
			params
		);

		return json({ forms: rows });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------- POST ------------------------------ */

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const body = await readJsonBody(event.request);

		const title = reqText(body.title, LIMITS.title, 'title');
		const description = optMultiline(body.description, LIMITS.description) ?? null;
		const mode = (optEnum<FormMode>(body.mode, FORM_MODES, 'mode') ?? 'form') as FormMode;
		const status = (optEnum<FormStatus>(body.status, FORM_STATUSES, 'status') ??
			'draft') as FormStatus;

		const timerSeconds = optInt(body.timer_seconds, 0, 'timer_seconds') ?? null;
		if (timerSeconds !== null && timerSeconds > MAX_TIMER_SECONDS) {
			throw new ApiError(400, `timer_seconds maksimum ${MAX_TIMER_SECONDS}`);
		}
		const timerScope = (optEnum<TimerScope>(body.timer_scope, TIMER_SCOPES, 'timer_scope') ??
			'form') as TimerScope;

		const shuffleQuestions = boolOr(boolField(body.shuffle_questions, 'shuffle_questions'), false);
		const shuffleOptions = boolOr(boolField(body.shuffle_options, 'shuffle_options'), false);
		const showScore = boolOr(boolField(body.show_score, 'show_score'), true);
		const requireToken = boolOr(boolField(body.require_token, 'require_token'), false);

		const bankPickCount = optInt(body.bank_pick_count, 1, 'bank_pick_count') ?? null;
		const passingGrade = optInt(body.passing_grade, 0, 'passing_grade') ?? null;
		if (passingGrade !== null && passingGrade > 100) {
			throw new ApiError(400, 'passing_grade harus 0–100 atau null');
		}

		const thanksText = optMultiline(body.thanks_text, LIMITS.description) ?? null;
		const theme =
			body.theme_json === undefined || body.theme_json === null
				? null
				: sanitizeTheme(body.theme_json);

		// Slug publik: dari title bila belum ada (draft boleh punya slug pra-publish).
		const baseSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : title;
		const slug = await uniqueFormSlug(baseSlug);

		const created = await one<FormRow>(
			`INSERT INTO formku.forms
			   (tenant_id, title, slug, description, mode, status, timer_seconds, timer_scope,
			    shuffle_questions, shuffle_options, bank_pick_count, passing_grade,
			    show_score, require_token, theme_json, thanks_text)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
			 RETURNING *`,
			[
				tenant.id,
				title,
				slug,
				description,
				mode,
				status,
				timerSeconds,
				timerScope,
				shuffleQuestions,
				shuffleOptions,
				bankPickCount,
				passingGrade,
				showScore,
				requireToken,
				theme ? JSON.stringify(theme) : null,
				thanksText
			]
		);

		return json(created, { status: 201 });
	} catch (e) {
		return handleAuthError(e);
	}
};

/* ------------------------------ util ------------------------------- */

/** Baca boolean opsional dari body → lempar 400 bila bukan boolean. */
function boolField(v: unknown, label: string): boolean | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'boolean') throw new ApiError(400, `${label} harus boolean`);
	return v;
}

/** Sanitasi theme_json: simpan hanya kunci string pendek (primary,font,...). */
function sanitizeTheme(v: unknown): Record<string, string> | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) {
		throw new ApiError(400, 'theme_json harus objek');
	}
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
		if (/^[a-zA-Z0-9_]{1,32}$/.test(k) && typeof val === 'string') {
			out[k] = val.slice(0, 100);
		}
	}
	return Object.keys(out).length ? out : null;
}
