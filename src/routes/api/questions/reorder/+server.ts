/**
 * /api/questions/reorder — urutkan ulang pertanyaan secara massal (Creator).
 *
 * Auth: `x-tenant` + `x-api-key`.
 *  - POST → body {form_id, order:[{id, sort, section_id?}, ...]} → set `sort`
 *           (dan opsional `section_id`) untuk banyak soal sekaligus dalam 1 transaksi.
 *
 * Isolasi: setiap id diverifikasi milik form (yang milik tenant). Bila ada id di
 * luar form, seluruh transaksi dibatalkan (400) — mencegah IDOR lintas tenant/form.
 *
 * Catatan: rute statis `/api/questions/reorder` diprioritaskan SvelteKit di atas
 * `/api/questions/[id]`, jadi tidak bentrok.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { ApiError, handleAuthError } from '$lib/server/auth.js';
import { tx } from '$lib/server/db.js';
import { authTenant, getOwnedForm, parseIdParam, readJsonBody } from '$lib/server/forms-util.js';

export const POST: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const body = await readJsonBody(event.request);

		const formId = parseIdParam(
			body.form_id === undefined ? undefined : String(body.form_id),
			'form_id'
		);
		const form = await getOwnedForm(tenant.id, formId);

		const order = body.order;
		if (!Array.isArray(order) || order.length === 0) {
			throw new ApiError(400, 'order harus array tidak kosong');
		}
		if (order.length > 1000) throw new ApiError(400, 'order maksimal 1000 item');

		const items: { id: number; sort: number; sectionId: number | null | undefined }[] = [];
		const seen = new Set<number>();
		for (let i = 0; i < order.length; i++) {
			const it = order[i];
			if (typeof it !== 'object' || it === null) {
				throw new ApiError(400, `order[${i}] harus objek {id, sort}`);
			}
			const o = it as Record<string, unknown>;
			const qid = parseIdParam(String(o.id), `order[${i}].id`);
			if (seen.has(qid)) throw new ApiError(400, `order[${i}].id duplikat: ${qid}`);
			seen.add(qid);

			const sortRaw = o.sort === undefined ? i : Number(o.sort);
			if (!Number.isInteger(sortRaw)) throw new ApiError(400, `order[${i}].sort harus integer`);

			let sectionId: number | null | undefined = undefined;
			if (o.section_id !== undefined) {
				sectionId =
					o.section_id === null || o.section_id === ''
						? null
						: parseIdParam(String(o.section_id), `order[${i}].section_id`);
			}
			items.push({ id: qid, sort: sortRaw, sectionId });
		}

		const updated = await tx(async (c) => {
			const ids = items.map((it) => it.id);
			const owned = await c.query<{ id: number }>(
				`SELECT id FROM formku.questions WHERE form_id = $1 AND id = ANY($2::int[])`,
				[form.id, ids]
			);
			const ownedSet = new Set(owned.rows.map((r) => r.id));
			const missing = ids.filter((id) => !ownedSet.has(id));
			if (missing.length) {
				throw new ApiError(400, `id bukan milik form ini: ${missing.join(', ')}`);
			}

			const secIds = [
				...new Set(
					items
						.map((it) => it.sectionId)
						.filter((x): x is number => typeof x === 'number')
				)
			];
			if (secIds.length) {
				const secRows = await c.query<{ id: number }>(
					`SELECT id FROM formku.sections WHERE form_id = $1 AND id = ANY($2::int[])`,
					[form.id, secIds]
				);
				const secSet = new Set(secRows.rows.map((r) => r.id));
				const badSec = secIds.filter((id) => !secSet.has(id));
				if (badSec.length) {
					throw new ApiError(400, `section_id bukan milik form ini: ${badSec.join(', ')}`);
				}
			}

			for (const it of items) {
				if (it.sectionId === undefined) {
					await c.query(
						`UPDATE formku.questions SET sort = $1 WHERE id = $2 AND form_id = $3`,
						[it.sort, it.id, form.id]
					);
				} else {
					await c.query(
						`UPDATE formku.questions SET sort = $1, section_id = $2 WHERE id = $3 AND form_id = $4`,
						[it.sort, it.sectionId, it.id, form.id]
					);
				}
			}
			return items.length;
		});

		return json({ reordered: true, count: updated });
	} catch (e) {
		return handleAuthError(e);
	}
};
