/**
 * /api/forms/[id]/publish — terbitkan form (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm.
 *  - POST → set status='open'; hasilkan slug final (unik) & access_token bila
 *           require_token=true.
 *
 * Kontrak §4: POST /api/forms/:id/publish → set status='open', hasilkan slug.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import { makeApiKey } from '$lib/server/hash.js';
import {
	authTenant,
	getOwnedForm,
	parseIdParam,
	uniqueFormSlug,
	type FormRow
} from '$lib/server/forms-util.js';

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id form');
		const form = await getOwnedForm(tenant.id, id);

		// Body opsional: {slug?, access_token?} untuk override saat publish.
		let body: Record<string, unknown> = {};
		const raw = await event.request.text();
		if (raw && raw.trim()) {
			try {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					body = parsed as Record<string, unknown>;
				}
			} catch {
				throw new ApiError(400, 'body harus JSON valid atau kosong');
			}
		}

		const baseSlug =
			typeof body.slug === 'string' && body.slug.trim() ? body.slug : form.slug || form.title;
		const slug = await uniqueFormSlug(baseSlug, form.id);

		let accessToken = form.access_token;
		if (typeof body.access_token === 'string' && body.access_token.trim()) {
			accessToken = body.access_token.trim().slice(0, 200);
		} else if (form.require_token && !accessToken) {
			accessToken = makeApiKey();
		}

		const updated = await one<FormRow>(
			`UPDATE formku.forms
			    SET status = 'open', slug = $1, access_token = $2
			  WHERE id = $3 AND tenant_id = $4
			  RETURNING *`,
			[slug, accessToken, form.id, tenant.id]
		);
		if (!updated) throw new ApiError(404, `form id=${id} tidak ditemukan`);

		return json({
			published: true,
			id: updated.id,
			slug: updated.slug,
			status: updated.status,
			require_token: updated.require_token,
			access_token: updated.require_token ? updated.access_token : null,
			url: `/f/${updated.slug}`
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
