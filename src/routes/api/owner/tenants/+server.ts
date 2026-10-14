/**
 * /api/owner/tenants — CRUD tenant (khusus owner).
 *
 * Auth: header `x-owner-password` (lihat requireOwner).
 *  - GET    → daftar tenant (tanpa api_key_hash)
 *  - POST   → body {slug,name,owner_email?} → {id,slug,api_key}  (api_key hanya tampil sekali)
 *  - DELETE → ?id=N (atau ?slug=xxx) → hapus tenant (cascade ke forms/responses)
 *
 * Kontrak: docs/KONTRAK-TEKNIS.md §4.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many, one } from '$lib/server/db.js';
import { hashSecret, makeApiKey } from '$lib/server/hash.js';
import { ApiError, handleAuthError, requireOwner } from '$lib/server/auth.js';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const GET: RequestHandler = async (event) => {
	try {
		requireOwner(event);
		const rows = await many(
			`SELECT id, slug, name, owner_email, status, expires_at, created_at
			   FROM formku.tenants
			  ORDER BY created_at DESC, id DESC`
		);
		return json({ tenants: rows });
	} catch (e) {
		return handleAuthError(e);
	}
};

export const POST: RequestHandler = async (event) => {
	try {
		requireOwner(event);

		let body: Record<string, unknown>;
		try {
			body = await event.request.json();
		} catch {
			throw new ApiError(400, 'body harus JSON valid');
		}

		const slug = String(body.slug ?? '').trim().toLowerCase();
		const name = String(body.name ?? '').trim();
		const ownerEmail = body.owner_email == null ? null : String(body.owner_email).trim();

		if (!slug || !SLUG_RE.test(slug)) {
			throw new ApiError(
				400,
				'slug wajib, huruf kecil/angka/tanda hubung, panjang 3–50, tidak diawali/diakhiri tanda hubung'
			);
		}
		if (!name) {
			throw new ApiError(400, 'name wajib diisi');
		}
		if (ownerEmail && !EMAIL_RE.test(ownerEmail)) {
			throw new ApiError(400, 'owner_email tidak valid');
		}

		const dup = await one<{ id: number }>(
			`SELECT id FROM formku.tenants WHERE slug = $1`,
			[slug]
		);
		if (dup) {
			throw new ApiError(409, `slug '${slug}' sudah dipakai`);
		}

		const apiKey = makeApiKey();
		const apiKeyHash = hashSecret(apiKey);

		const created = await one<{
			id: number;
			slug: string;
			name: string;
			owner_email: string | null;
			created_at: string;
		}>(
			`INSERT INTO formku.tenants (slug, name, owner_email, api_key_hash)
			 VALUES ($1, $2, $3, $4)
			 RETURNING id, slug, name, owner_email, created_at`,
			[slug, name, ownerEmail, apiKeyHash]
		);

		// api_key hanya dikembalikan SEKALI di sini; server hanya menyimpan hash-nya.
		return json({ ...created, api_key: apiKey }, { status: 201 });
	} catch (e) {
		return handleAuthError(e);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		requireOwner(event);

		const url = event.url;
		const idParam = url.searchParams.get('id');
		const slugParam = url.searchParams.get('slug');

		let id: number | null = null;
		if (idParam) {
			id = Number(idParam);
			if (!Number.isInteger(id) || id <= 0) {
				throw new ApiError(400, 'id harus bilangan bulat positif');
			}
		} else if (slugParam) {
			const row = await one<{ id: number }>(
				`SELECT id FROM formku.tenants WHERE slug = $1`,
				[slugParam.trim().toLowerCase()]
			);
			if (!row) throw new ApiError(404, `tenant '${slugParam}' tidak ditemukan`);
			id = row.id;
		} else {
			throw new ApiError(400, 'sertakan ?id=N atau ?slug=xxx');
		}

		const del = await one<{ id: number; slug: string }>(
			`DELETE FROM formku.tenants WHERE id = $1 RETURNING id, slug`,
			[id]
		);
		if (!del) {
			throw new ApiError(404, `tenant id=${id} tidak ditemukan`);
		}
		return json({ deleted: true, id: del.id, slug: del.slug });
	} catch (e) {
		return handleAuthError(e);
	}
};
