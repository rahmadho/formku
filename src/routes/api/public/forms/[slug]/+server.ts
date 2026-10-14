/**
 * GET /api/public/forms/[slug] — struktur form publik untuk responden.
 *
 * TANPA autentikasi. Mengembalikan:
 *   { form, sections, questions, conditions?, session? }
 *
 * ⚠️ JAMINAN KEAMANAN (kontrak §4):
 *   `correct_json` (kunci jawaban) TIDAK PERNAH dikirim di sini — tidak peduli
 *   apakah form ber-mode `exam`, `quiz`, atau `form`. Proyeksi lewat
 *   `projectQuestionForPublic` (lihat ../_lib.ts) hanya memuat field aman.
 *   Uji nyata: `curl /api/public/forms/<slug>` tidak boleh mengandung "correct".
 *
 * Pengacakan (F6/F7) deterministik memakai seed:
 *   - bila `?response_id=` valid → seed = response_id (urutan STABIL per sesi).
 *   - bila belum ada sesi        → seed = `visit:<IP>` (stabil selama sesi isi).
 * Ini menjamin soal/opsi tak "melompat" saat reload, namun berbeda antar responden.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, handleAuthError, rateLimit } from '$lib/server/auth.js';
import { clientIp } from '$lib/server/auth.js';
import { one } from '$lib/server/db.js';
import {
	applyShuffle,
	getOpenForm,
	getResponseForForm,
	loadFormBundle
} from '../../_lib.js';

export const GET: RequestHandler = async (event) => {
	try {
		// Rate limit endpoint publik: 120 permintaan / menit / IP.
		rateLimit(event, { key: 'public-get-form', limit: 120, windowSec: 60 });

		const slug = event.params.slug ?? '';
		const form = await getOpenForm(slug);

		const { sections, questions, conditions } = await loadFormBundle(form.id);

		// Seed acak: response_id (sesi) bila ada, kalau tidak per-IP.
		const url = event.url;
		const rawRid = url.searchParams.get('response_id');
		let seed: string;
		let session: Record<string, unknown> | null = null;

		if (rawRid) {
			const rid = Number(rawRid);
			if (Number.isInteger(rid) && rid > 0) {
				const resp = await getResponseForForm(rid, form.id);
				seed = `r:${resp.id}`;
				session = {
					response_id: resp.id,
					status: resp.status,
					started_at: resp.started_at,
					submitted_at: resp.submitted_at,
					respondent_name: resp.respondent_name
				};
			} else {
				seed = `ip:${clientIp(event)}`;
			}
		} else {
			seed = `ip:${clientIp(event)}`;
		}

		// Soal publik (aman, teracak). correct_json TIDAK ada di objek ini.
		const publicQuestions = applyShuffle(form, questions, seed);

		// Hitung timer efektif untuk tampilan (bila scope='section', timer ada di section).
		const timerScope = form.timer_scope ?? 'form';

		return json({
			form: {
				title: form.title,
				slug: form.slug,
				description: form.description,
				mode: form.mode,
				timer_seconds: form.timer_seconds,
				timer_scope: timerScope,
				shuffle_questions: form.shuffle_questions,
				shuffle_options: form.shuffle_options,
				require_token: form.require_token,
				show_score: form.show_score,
				// passing_grade hanya relevan bila skor ditampilkan; tetap aman diungkap.
				passing_grade: form.show_score ? form.passing_grade : null,
				theme: form.theme_json ?? null,
				thanks_text: form.thanks_text
			},
			sections: sections.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description,
				sort: s.sort,
				timer_seconds: timerScope === 'section' ? s.timer_seconds : null
			})),
			questions: publicQuestions,
			conditions: conditions.map((c) => ({
				question_id: c.question_id,
				depends_on_question_id: c.depends_on_question_id,
				operator: c.operator,
				compare_value: c.compare_value,
				action: c.action
			})),
			session
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
