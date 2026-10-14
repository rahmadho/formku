/**
 * /api/forms/[id]/responses.csv — ekspor respons form ke CSV (Creator, F11).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm.
 *  - GET → text/csv (attachment). Kolom:
 *      id, nama, email, status, mulai, dikirim, durasi_detik, skor, skor_maks,
 *      persen, lulus, jumlah_event, <label soal 1..N>
 *
 * Keamanan:
 *  - Setiap sel dinetralkan dari formula-injection (util/csv.ts `guardFormula`).
 *  - `q`/`status` filter opsional mengikuti daftar respons.
 *  - Batas ekspor (anti-DoS) agar satu permintaan tidak menarik seluruh DB.
 */
import { error, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import { authTenant, ownedForm, parseResponseFilter } from '$lib/server/m7-util.js';
import { parseIdParam } from '$lib/server/forms-util.js';
import { toCsv } from '$lib/util/csv.js';

/** Batas maksimum baris yang diekspor dalam satu permintaan. */
const EXPORT_MAX = 5000;

interface ExportQuestion {
	id: number;
	label: string;
}

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const form = await ownedForm(tenant.id, parseIdParam(event.params.id, 'id form'));
		const filter = parseResponseFilter(event.url);

		const where: string[] = ['r.form_id = $1'];
		const params: unknown[] = [form.id];
		if (filter.status) {
			params.push(filter.status);
			where.push(`r.status = $${params.length}`);
		}
		if (filter.q) {
			params.push(`%${filter.q}%`);
			where.push(
				`(r.respondent_name ILIKE $${params.length} OR r.respondent_email ILIKE $${params.length})`
			);
		}

		// Soal form ini, terurut — menjadi kolom jawaban.
		const questions = await many<ExportQuestion>(
			`SELECT id, label FROM formku.questions WHERE form_id = $1 ORDER BY sort ASC, id ASC`,
			[form.id]
		);

		// Respons + jumlah event audit.
		const responses = await many<{
			id: number;
			respondent_name: string | null;
			respondent_email: string | null;
			status: string;
			started_at: string;
			submitted_at: string | null;
			duration_seconds: number | null;
			score: number | null;
			max_score: number | null;
			event_count: number;
		}>(
			`SELECT r.id, r.respondent_name, r.respondent_email, r.status,
			        r.started_at, r.submitted_at, r.duration_seconds, r.score, r.max_score,
			        (SELECT count(*)::int FROM formku.audit_events e WHERE e.response_id = r.id) AS event_count
			   FROM formku.responses r
			  WHERE ${where.join(' AND ')}
			  ORDER BY r.started_at DESC, r.id DESC
			  LIMIT ${EXPORT_MAX + 1}`,
			params
		);

		if (responses.length > EXPORT_MAX) {
			throw new ApiError(
				413,
				`terlalu banyak respons untuk diekspor (${EXPORT_MAX} baris pasti terlewati). Gunakan filter status.`
			);
		}

		// Jawaban: satu kanvas map per respons untuk menghindari N+1 berat.
		const responseIds = responses.map((r) => r.id);
		const answerMap = new Map<number, Map<number, unknown>>();
		if (responseIds.length) {
			const answers = await many<{
				response_id: number;
				question_id: number;
				value_json: unknown;
			}>(
				`SELECT response_id, question_id, value_json
				   FROM formku.answers
				  WHERE response_id = ANY($1::int[])`,
				[responseIds]
			);
			for (const a of answers) {
				let m = answerMap.get(a.response_id);
				if (!m) {
					m = new Map();
					answerMap.set(a.response_id, m);
				}
				m.set(a.question_id, a.value_json);
			}
		}

		const headers = [
			'id',
			'nama',
			'email',
			'status',
			'mulai',
			'dikirim',
			'durasi_detik',
			'skor',
			'skor_maks',
			'persen',
			'lulus',
			'jumlah_event',
			...questions.map((q) => q.label)
		];

		const rows = responses.map((r) => {
			const m = answerMap.get(r.id);
			const percent =
				r.max_score && r.max_score > 0 && r.score !== null
					? Math.round((r.score / r.max_score) * 100)
					: '';
			const passed =
				form.passing_grade === null || r.max_score === null || r.max_score === 0
					? ''
					: (r.score ?? 0) / r.max_score * 100 >= form.passing_grade
						? 'ya'
						: 'tidak';
			return [
				r.id,
				r.respondent_name ?? '',
				r.respondent_email ?? '',
				r.status,
				r.started_at,
				r.submitted_at ?? '',
				r.duration_seconds ?? '',
				r.score ?? '',
				r.max_score ?? '',
				percent,
				passed,
				r.event_count,
				...questions.map((q) => formatAnswer(m?.get(q.id)))
			];
		});

		const csv = toCsv(headers, rows);
		const safeSlug = (form.slug || `form-${form.id}`).replace(/[^a-z0-9-]/gi, '-');
		const filename = `respons-${safeSlug}.csv`;

		return new Response(csv, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store'
			}
		});
	} catch (e) {
		if (e instanceof ApiError) {
			return error(e.status, e.message);
		}
		return handleAuthError(e);
	}
};

/** Ubah nilai jawaban (JSONB) menjadi teks satu sel CSV yang manusiawi. */
function formatAnswer(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) return value.map((v) => String(v)).join('; ');
	if (typeof value === 'object') {
		// Objek tak terduga → JSON ringkas.
		try {
			return JSON.stringify(value);
		} catch {
			return '';
		}
	}
	return String(value);
}
