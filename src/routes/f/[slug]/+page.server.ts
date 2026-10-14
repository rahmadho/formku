/**
 * +page.server.ts — Muat data form publik untuk halaman isi form (Modul M6).
 *
 * Halaman responden: `/f/[slug]`. Tanpa login.
 *
 * ⚠️ JAMINAN KEAMANAN (kontrak KONTRAK-TEKNIS §4):
 *   `correct_json` (kunci jawaban) TIDAK BOLEH sampai ke browser. Di sini kita
 *   memproyeksikan soal lewat `projectQuestionForPublic` (milik M4) yang secara
 *   eksplisit MEMBUANG kunci jawaban. Jangan pernah mengirim baris DB mentah.
 *
 * Pengacakan deterministik (F6/F7) memakai seed:
 *   - bila `?r=` (response_id) valid → seed = `r:<id>` (urutan STABIL per-sesi).
 *   - bila belum ada sesi            → seed = `ip:<IP>` (stabil selama sesi isi).
 * Ini menjamin urutan soal/opsi tak "melompat" saat reload, namun berbeda
 * antar responden. Logika shuffle identik dengan endpoint publik M4.
 */
import { error, type RequestEvent } from '@sveltejs/kit';
import { clientIp } from '$lib/server/auth.js';
import { ApiError } from '$lib/server/auth.js';
import {
	applyShuffle,
	getOpenForm,
	getResponseForForm,
	loadFormBundle
} from '../../api/public/_lib.js';

export const load = async (event: RequestEvent) => {
	const slug = (event.params.slug ?? '').trim().toLowerCase();

	let form;
	try {
		form = await getOpenForm(slug);
	} catch (e) {
		if (e instanceof ApiError) throw error(e.status, e.message);
		throw e;
	}

	const { sections, questions, conditions } = await loadFormBundle(form.id);

	// Seed pengacakan: response_id (sesi) bila ada, kalau tidak per-IP.
	const rawRid = event.url.searchParams.get('r');
	let seed: string;
	let session: {
		response_id: number;
		status: string;
		respondent_name: string | null;
		started_at: string;
		submitted_at: string | null;
	} | null = null;

	const rid = rawRid ? Number(rawRid) : NaN;
	if (Number.isInteger(rid) && rid > 0) {
		try {
			const resp = await getResponseForForm(rid, form.id);
			seed = `r:${resp.id}`;
			session = {
				response_id: resp.id,
				status: resp.status,
				respondent_name: resp.respondent_name,
				started_at: resp.started_at,
				submitted_at: resp.submitted_at
			};
		} catch {
			// r tak valid / bukan milik form ini → perlakukan sebagai kunjungan baru.
			seed = `ip:${clientIp(event)}`;
		}
	} else {
		seed = `ip:${clientIp(event)}`;
	}

	// Proyeksi aman + teracak. correct_json TIDAK ada di hasil ini.
	const publicQuestions = applyShuffle(form, questions, seed);

	const timerScope = form.timer_scope ?? 'form';

	return {
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
	};
};
