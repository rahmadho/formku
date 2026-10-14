/**
 * POST /api/public/forms/[slug]/event — catat peristiwa audit anti-kecurangan (F14).
 *
 * Body: { response_id: number, event_type: 'blur'|'paste'|'copy'|'focus_return' }
 * Balasan: { ok: true, recorded: string }
 *
 * Dipakai halaman responden (M6) untuk melaporkan sinyal mencurigakan:
 *  - blur         : jendela kehilangan fokus (responden berpindah tab/aplikasi)
 *  - paste/copy   : tempel/salin (indikasi menyalin soal keluar atau jawaban masuk)
 *  - focus_return : kembali fokus ke jendela
 *
 * ⚠️ KEAMANAN: hanya `response_id` yang masih `in_progress` yang dicatat; event
 * untuk sesi yang sudah submit/locked diabaikan (tidak error) agar tidak bisa
 * dipakai menulis baris liar. Rate limit longgar (event wajar sering).
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, handleAuthError, rateLimit } from '$lib/server/auth.js';
import { run } from '$lib/server/db.js';
import { getOpenForm, getResponseForForm, normalizeAuditEvent } from '../../../_lib.js';

export const POST: RequestHandler = async (event) => {
	try {
		// Event audit boleh sering; batasi tetap ada (300/menit/IP).
		rateLimit(event, { key: 'public-event', limit: 300, windowSec: 60 });

		const slug = event.params.slug ?? '';
		const form = await getOpenForm(slug);

		let body: Record<string, unknown>;
		try {
			const raw = await event.request.json();
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('bad');
			body = raw as Record<string, unknown>;
		} catch {
			throw new ApiError(400, 'body harus JSON valid');
		}

		const responseId = Number(body.response_id);
		if (!Number.isInteger(responseId) || responseId <= 0) {
			throw new ApiError(400, 'response_id wajib berupa bilangan bulat positif');
		}

		// Validasi tipe event (whitelist) sebelum menyentuh DB.
		const eventType = normalizeAuditEvent(body.event_type);

		// Pastikan sesi ada & milik form ini.
		const resp = await getResponseForForm(responseId, form.id);

		// Hanya catat untuk sesi yang masih berjalan. Sesi selesai/locked → diamkan.
		if (resp.status !== 'in_progress') {
			return json({ ok: true, recorded: null, note: 'sesi tidak lagi berjalan' });
		}

		await run(
			`INSERT INTO formku.audit_events (response_id, event_type) VALUES ($1, $2)`,
			[responseId, eventType]
		);

		return json({ ok: true, recorded: eventType });
	} catch (e) {
		return handleAuthError(e);
	}
};
