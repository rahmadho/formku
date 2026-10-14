/**
 * POST /api/public/forms/[slug]/submit — kirim jawaban, hitung skor, simpan.
 *
 * Body: { response_id: number, answers: [{question_id, value}, ...] }
 * Balasan: { score, max_score, percent, passed, show_score, ... }
 *
 * Alur (dalam SATU transaksi DB):
 *   1. Validasi sesi: ada, milik form, status `in_progress` (belum submit).
 *   2. Muat soal LENGKAP (termasuk correct_json) — hanya di server.
 *   3. Validasi tiap jawaban terhadap tipe + aturan `required`.
 *   4. Nilai jawaban terhadap kunci (util/score.ts) → skor & max_score.
 *   5. Simpan answers + update responses (score, submitted_at, duration, status).
 *
 * ⚠️ KEAMANAN:
 *   - `correct_json` hanya dipakai di server untuk menilai; TIDAK dikirim balik.
 *   - `show_score=false` → skor disembunyikan dari responden (balasan tanpa angka).
 *   - Idempoten-aman: sesi yang sudah `submitted` ditolak (409) agar tak dobel.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, handleAuthError, rateLimit } from '$lib/server/auth.js';
import { tx } from '$lib/server/db.js';
import { gradeSubmission, isPassed } from '$lib/util/score.js';
import { validateAnswer } from '$lib/util/validate.js';
import type { AnswerInput, QuestionLike } from '$lib/types.js';
import { getOpenForm, getResponseForForm, loadFormBundle } from '../../../_lib.js';

/** Satu jawaban masuk dari klien. */
interface IncomingAnswer {
	question_id: number;
	value: unknown;
}

/** Selidiki & normalisasi array `answers` dari body. */
function parseAnswers(raw: unknown): IncomingAnswer[] {
	if (raw === undefined || raw === null) return [];
	if (!Array.isArray(raw)) throw new ApiError(400, 'answers harus berupa array');
	if (raw.length > 1000) throw new ApiError(400, 'terlalu banyak jawaban');
	const out: IncomingAnswer[] = [];
	const seen = new Set<number>();
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i];
		if (typeof item !== 'object' || item === null) {
			throw new ApiError(400, `answers[${i}] harus objek`);
		}
		const qid = (item as Record<string, unknown>).question_id;
		if (typeof qid !== 'number' || !Number.isInteger(qid) || qid <= 0) {
			throw new ApiError(400, `answers[${i}].question_id tidak valid`);
		}
		if (seen.has(qid)) throw new ApiError(400, `jawaban duplikat untuk question_id ${qid}`);
		seen.add(qid);
		out.push({ question_id: qid, value: (item as Record<string, unknown>).value });
	}
	return out;
}

export const POST: RequestHandler = async (event) => {
	try {
		// Rate limit submit: 20 / menit / IP.
		rateLimit(event, { key: 'public-submit', limit: 20, windowSec: 60 });

		const slug = event.params.slug ?? '';
		const form = await getOpenForm(slug);

		let body: Record<string, unknown>;
		try {
			const raw = await event.request.json();
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
				throw new Error('bad');
			}
			body = raw as Record<string, unknown>;
		} catch {
			throw new ApiError(400, 'body harus JSON valid');
		}

		const responseId = Number(body.response_id);
		if (!Number.isInteger(responseId) || responseId <= 0) {
			throw new ApiError(400, 'response_id wajib berupa bilangan bulat positif');
		}

		// (1) Validasi sesi (milik form ini).
		const resp = await getResponseForForm(responseId, form.id);
		if (resp.status === 'submitted') {
			throw new ApiError(409, 'sesi ini sudah dikirim sebelumnya');
		}
		if (resp.status === 'locked') {
			throw new ApiError(423, 'sesi ini terkunci dan tidak dapat dikirim');
		}
		if (resp.status !== 'in_progress') {
			throw new ApiError(409, `status sesi tidak valid: ${resp.status}`);
		}

		// (2) Muat soal lengkap (dengan kunci) — server-side saja.
		const { questions } = await loadFormBundle(form.id);
		const byId = new Map<number, (typeof questions)[number]>();
		for (const q of questions) byId.set(q.id, q);

		// (3) Validasi jawaban (bentuk + wajib) terhadap soal form ini.
		const incoming = parseAnswers(body.answers);
		const validAnswers: AnswerInput[] = [];

		for (const a of incoming) {
			const q = byId.get(a.question_id);
			if (!q) {
				// Question di luar form (mis. soal bank tak dipakai) → abaikan, jangan
				// percayai klien. Tidak masuk penilaian.
				continue;
			}
			const ctx = {
				type: q.type as QuestionLike['type'],
				required: q.required,
				settings: q.settings_json
			};
			const res = validateAnswer(a.value, ctx);
			if (!res.ok) {
				throw new ApiError(400, `jawaban tidak valid untuk soal ${q.id}: ${res.errors.join(', ')}`);
			}
			validAnswers.push({ question_id: q.id, value: res.value });
		}

		// Pastikan seluruh soal `required` benar-benar terjawab.
		const answered = new Set(validAnswers.filter((a) => a.value !== null).map((a) => a.question_id));
		const missing: number[] = [];
		for (const q of questions) {
			if (q.required && !answered.has(q.id)) missing.push(q.id);
		}
		if (missing.length) {
			throw new ApiError(400, `soal wajib belum dijawab: ${missing.join(', ')}`);
		}

		// (4) Nilai. Bentuk QuestionLike untuk util/score.
		const forGrading: QuestionLike[] = questions.map((q) => ({
			id: q.id,
			type: q.type as QuestionLike['type'],
			label: q.label,
			required: q.required,
			points: q.points,
			correct: q.correct_json,
			settings: q.settings_json,
			sort: q.sort,
			section_id: q.section_id
		}));
		const result = gradeSubmission(forGrading, validAnswers);
		const passed = isPassed(result.score, result.maxScore, form.passing_grade);

		// (5) Persist dalam transaksi.
		const now = new Date();
		const startedAt = new Date(resp.started_at);
		const durationSec = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 1000));

		const detailById = new Map(result.details.map((d) => [d.question_id, d]));

		await tx(async (c) => {
			// Guard anti-dobel: hanya update bila masih in_progress.
			const upd = await c.query(
				`UPDATE formku.responses
				    SET status = 'submitted',
				        submitted_at = now(),
				        duration_seconds = $2,
				        score = $3,
				        max_score = $4
				  WHERE id = $1 AND status = 'in_progress'
				  RETURNING id`,
				[responseId, durationSec, result.score, result.maxScore]
			);
			if (upd.rowCount === 0) {
				throw new ApiError(409, 'sesi ini sudah dikirim sebelumnya');
			}

			// Hapus jawaban lama (bila ada residu) lalu simpan yang baru.
			await c.query(`DELETE FROM formku.answers WHERE response_id = $1`, [responseId]);

			for (const a of validAnswers) {
				const d = detailById.get(a.question_id);
				const isCorrect = d ? d.isCorrect : null;
				const pts = d ? d.pointsAwarded : 0;
				await c.query(
					`INSERT INTO formku.answers
					   (response_id, question_id, value_json, is_correct, points_awarded)
					 VALUES ($1, $2, $3::jsonb, $4, $5)`,
					[responseId, a.question_id, JSON.stringify(a.value ?? null), isCorrect, pts]
				);
			}
		});

		// Balasan: sembunyikan skor bila show_score=false (kecuali memang tak ada skor).
		const showScore = form.show_score;
		const payload: Record<string, unknown> = {
			response_id: responseId,
			submitted_at: now.toISOString(),
			duration_seconds: durationSec,
			show_score: showScore,
			thanks_text: form.thanks_text
		};
		if (showScore) {
			payload.score = result.score;
			payload.max_score = result.maxScore;
			payload.percent = result.percent;
			payload.passed = passed;
			payload.graded = result.graded;
		}
		return json(payload);
	} catch (e) {
		return handleAuthError(e);
	}
};
