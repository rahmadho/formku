/**
 * /api/forms/[id]/analytics — hasil & analitik form (Creator, F16).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm.
 *  - GET → { form, analytics: { summary, questions, hardest } }
 *
 * Ringkasan: total/submitted/in_progress, rata-rata skor & persen, pass-rate,
 * rata-rata durasi, distribusi skor 10 bucket; statistik per soal + soal
 * tersulit (akurasi terendah).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { handleAuthError } from '$lib/server/auth.js';
import { authTenant, buildAnalytics, ownedForm } from '$lib/server/m7-util.js';
import { parseIdParam } from '$lib/server/forms-util.js';

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const form = await ownedForm(tenant.id, parseIdParam(event.params.id, 'id form'));
		const analytics = await buildAnalytics(form);

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
			analytics
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
