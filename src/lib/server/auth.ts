/**
 * auth.ts — Helper autentikasi & otorisasi FormKu (Modul M2).
 *
 * Menyediakan:
 *  - requireOwner(event)  : validasi header `x-owner-password` terhadap env OWNER_PASSWORD.
 *  - requireTenant(event) : validasi header `x-tenant` (slug) + `x-api-key` (kunci mentah,
 *                           diverifikasi terhadap `formku.tenants.api_key_hash` via scrypt).
 *  - rateLimit(event, opts): pembatas laju in-memory sederhana per IP+kunci untuk endpoint
 *                           publik/login (kontrak §4 "Rate limit endpoint publik & login").
 *
 * Semua fungsi melempar `ApiError` (berisi status HTTP) sehingga handler dapat
 * menangkapnya dan mengembalikan `json({error}, {status})`. Untuk kemudahan,
 * sediakan pula `handleAuthError()` yang mengubah error itu menjadi Response.
 */
import { json } from '@sveltejs/kit';
import { env } from './env.js';
import { one } from './db.js';
import { verifySecret } from './hash.js';

/** Error yang membawa status HTTP, dipakai lintas modul API. */
export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

/** Ubah ApiError (atau error lain) menjadi Response JSON yang rapi. */
export function handleAuthError(e: unknown): Response {
	if (e instanceof ApiError) {
		return json({ error: e.message }, { status: e.status });
	}
	console.error('[auth] unhandled error:', e);
	return json({ error: 'kesalahan server internal' }, { status: 500 });
}

/* ------------------------------------------------------------------ */
/* Owner                                                               */
/* ------------------------------------------------------------------ */

/**
 * Validasi akses owner lewat header `x-owner-password`.
 * Bandingkan dengan waktu konstan terhadap env OWNER_PASSWORD.
 * Melempar ApiError 401 bila salah, 500 bila server belum dikonfigurasi.
 */
export function requireOwner(event: { request: Request }): void {
	const expected = env.OWNER_PASSWORD ?? '';
	if (!expected) {
		throw new ApiError(500, 'OWNER_PASSWORD belum dikonfigurasi di server');
	}
	const supplied = event.request.headers.get('x-owner-password') ?? '';
	if (!safeEqual(supplied, expected)) {
		throw new ApiError(401, 'owner password salah');
	}
}

/* ------------------------------------------------------------------ */
/* Tenant (Creator)                                                    */
/* ------------------------------------------------------------------ */

/** Baris tenant yang dipakai lintas modul. */
export interface Tenant {
	id: number;
	slug: string;
	name: string;
	owner_email: string | null;
	status: string;
	expires_at: string | null;
	created_at: string;
}

/**
 * Validasi tenant lewat header `x-tenant: <slug>` + `x-api-key: <kunci>`.
 * Kunci diverifikasi terhadap hash scrypt di DB (kolom api_key_hash TIDAK dikembalikan).
 * Melempar ApiError 400 (header kurang), 401 (kunci salah), 403 (nonaktif/kedaluwarsa).
 */
export async function requireTenant(event: {
	request: Request;
}): Promise<Tenant> {
	const slug = (event.request.headers.get('x-tenant') ?? '').trim();
	const apiKey = (event.request.headers.get('x-api-key') ?? '').trim();
	if (!slug || !apiKey) {
		throw new ApiError(400, 'header x-tenant dan x-api-key wajib diisi');
	}

	const row = await one<Tenant & { api_key_hash: string }>(
		`SELECT id, slug, name, owner_email, api_key_hash, status, expires_at, created_at
		   FROM formku.tenants
		  WHERE slug = $1`,
		[slug]
	);
	if (!row) {
		throw new ApiError(401, 'tenant atau api key tidak valid');
	}
	if (!verifySecret(apiKey, row.api_key_hash)) {
		throw new ApiError(401, 'tenant atau api key tidak valid');
	}
	if (row.status !== 'active') {
		throw new ApiError(403, `tenant berstatus '${row.status}'`);
	}
	if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
		throw new ApiError(403, 'langganan tenant sudah kedaluwarsa');
	}

	const { api_key_hash: _drop, ...tenant } = row;
	return tenant;
}

/* ------------------------------------------------------------------ */
/* Rate limit (in-memory)                                              */
/* ------------------------------------------------------------------ */

interface Bucket {
	count: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Pembersihan berkala agar Map tidak tumbuh tanpa batas. */
const SWEEP_MS = 60_000;
let lastSweep = Date.now();
function sweep(now: number) {
	if (now - lastSweep < SWEEP_MS) return;
	lastSweep = now;
	for (const [k, b] of buckets) {
		if (b.resetAt <= now) buckets.delete(k);
	}
}

export interface RateLimitOptions {
	/** Nama aksi/endpoint, dipakai sebagai bagian kunci bucket. */
	key: string;
	/** Jumlah maksimum permintaan per jendela. Default 60. */
	limit?: number;
	/** Panjang jendela dalam detik. Default 60. */
	windowSec?: number;
	/** Kunci tambahan (mis. slug form). Default: IP klien. */
	identifier?: string;
}

export interface RateLimitResult {
	remaining: number;
	resetAt: number;
}

/**
 * Pembatas laju fixed-window per (key, identifier) dalam memori proses.
 * Cocok untuk satu instance; untuk multi-instance produksi, ganti dengan Redis.
 * Melempar ApiError 429 saat melewati batas.
 */
export function rateLimit(
	event: { request: Request; getClientAddress?: () => string },
	opts: RateLimitOptions
): RateLimitResult {
	const limit = opts.limit ?? 60;
	const windowSec = opts.windowSec ?? 60;
	const id = opts.identifier ?? clientIp(event);
	const now = Date.now();
	sweep(now);

	const bucketKey = `${opts.key}:${id}`;
	let b = buckets.get(bucketKey);
	if (!b || b.resetAt <= now) {
		b = { count: 0, resetAt: now + windowSec * 1000 };
		buckets.set(bucketKey, b);
	}
	b.count += 1;

	if (b.count > limit) {
		const retry = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
		throw new ApiError(429, `terlalu banyak permintaan, coba lagi dalam ${retry} detik`);
	}
	return { remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

/** Ambil IP klien, dengan fallback ke header x-forwarded-for. */
export function clientIp(event: {
	request: Request;
	getClientAddress?: () => string;
}): string {
	try {
		if (typeof event.getClientAddress === 'function') {
			return event.getClientAddress();
		}
	} catch {
		/* getClientAddress bisa melempar bila adapter tak mendukung */
	}
	const xff = event.request.headers.get('x-forwarded-for');
	if (xff) return xff.split(',')[0].trim();
	return 'unknown';
}

/* ------------------------------------------------------------------ */
/* util                                                                */
/* ------------------------------------------------------------------ */

/** Perbandingan string waktu-konstan (hindari kebocoran lewat timing). */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		// tetap lakukan perbandingan atas panjang maksimum untuk meredam timing
		const len = Math.max(a.length, b.length);
		let diff = a.length ^ b.length;
		for (let i = 0; i < len; i++) {
			diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
		}
		return diff === 0;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
