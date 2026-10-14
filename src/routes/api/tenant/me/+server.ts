/**
 * /api/tenant/me — info tenant yang sedang diautentikasi.
 *
 * Auth: header `x-tenant: <slug>` + `x-api-key: <kunci>` (lihat requireTenant).
 * Mengembalikan identitas tenant + ringkasan jumlah form/respons miliknya.
 * Berguna untuk UI dasbor & verifikasi kredensial tenant.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { one } from '$lib/server/db.js';
import { handleAuthError, requireTenant } from '$lib/server/auth.js';

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await requireTenant(event);

		const stats = await one<{ forms: number; responses: number }>(
			`SELECT
			   (SELECT count(*)::int FROM formku.forms f WHERE f.tenant_id = $1) AS forms,
			   (SELECT count(*)::int
			      FROM formku.responses r
			      JOIN formku.forms f2 ON f2.id = r.form_id
			     WHERE f2.tenant_id = $1) AS responses`,
			[tenant.id]
		);

		return json({
			tenant,
			stats: stats ?? { forms: 0, responses: 0 }
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
