/**
 * POST /api/public/forms/[slug]/start — mulai sesi pengisian form.
 *
 * Body: { name?: string, email?: string, token?: string }
 * Balasan: { response_id, started_at, resumed: boolean, timer_seconds, timer_scope }
 *
 * Perilaku:
 *  - Form harus `open` (kalau tidak → 404).
 *  - Bila `require_token`, `token` wajib & harus cocok (waktu-konstan).
 *  - Membuat baris `responses` baru (status `in_progress`) dengan ip + started_at.
 *  - Anti-abuse: rate limit ketat (mis. 10 sesi/menit/IP).
 *
 * Catatan: TIDAK mengembalikan kunci jawaban apa pun (tak menyentuh correct_json).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, clientIp, handleAuthError, rateLimit } from '$lib/server/auth.js';
import { one } from '$lib/server/db.js';
import {
	assertAccessToken,
	cleanRespondentName,
	getOpenForm,
	type PublicResponseRow
} from '../../../_lib.js';
import { isValidEmail } from '$lib/util/validate.js';

export const POST: RequestHandler = async (event) => {
	try {
		// Rate limit sesi baru: 10 mulai / menit / IP (cegah spam respons).
		rateLimit(event, { key: 'public-start', limit: 10, windowSec: 60 });

		const slug = event.params.slug ?? '';
		const form = await getOpenForm(slug);

		let body: Record<string, unknown> = {};
		try {
			const raw = await event.request.json();
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
				body = raw as Record<string, unknown>;
			}
		} catch {
			throw new ApiError(400, 'body harus JSON valid');
		}

		// Verifikasi token ujian (bila diwajibkan). Dibandingkan waktu-konstan.
		assertAccessToken(form, body.token);

		// Sanitasi identitas responden (opsional).
		const name = cleanRespondentName(body.name);
		let email: string | null = null;
		if (body.email !== undefined && body.email !== null && body.email !== '') {
			if (!isValidEmail(body.email)) throw new ApiError(400, 'email tidak valid');
			email = String(body.email).trim();
		}

		const ip = clientIp(event);

		const created = await one<PublicResponseRow>(
			`INSERT INTO formku.responses
			   (form_id, respondent_name, respondent_email, token_used, ip, status)
			 VALUES ($1, $2, $3, $4, $5, 'in_progress')
			 RETURNING *`,
			[
				form.id,
				name,
				email,
				form.require_token ? String(body.token).trim() : null,
				ip
			]
		);
		if (!created) throw new ApiError(500, 'gagal membuat sesi respons');

		return json(
			{
				response_id: created.id,
				started_at: created.started_at,
				resumed: false,
				timer_seconds: form.timer_seconds,
				timer_scope: form.timer_scope ?? 'form'
			},
			{ status: 201 }
		);
	} catch (e) {
		return handleAuthError(e);
	}
};
