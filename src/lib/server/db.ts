/**
 * db.ts — Pool PostgreSQL + helper query untuk FormKu.
 * Semua akses DB lewat sini. SSL wajib (rejectUnauthorized:false).
 */
import pg from 'pg';
import { env } from '$env/dynamic/private';

const useSsl = (env.PGSSL ?? 'true') !== 'false';

const pool = new pg.Pool({
	host: env.PGHOST ?? 'postgresql_dev',
	port: Number(env.PGPORT ?? 5432),
	user: env.PGUSER ?? 'vibe',
	password: env.PGPASSWORD ?? '',
	database: env.PGDATABASE ?? 'vibe-formku',
	max: 10,
	ssl: useSsl ? { rejectUnauthorized: false } : false
});

export async function many<T = Record<string, unknown>>(
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	const r = await pool.query(sql, params);
	return r.rows as T[];
}

export async function one<T = Record<string, unknown>>(
	sql: string,
	params: unknown[] = []
): Promise<T | null> {
	const r = await pool.query(sql, params);
	return (r.rows[0] as T) ?? null;
}

export async function run(sql: string, params: unknown[] = []) {
	return pool.query(sql, params);
}

/** Jalankan beberapa pernyataan dalam satu transaksi. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
	const c = await pool.connect();
	try {
		await c.query('BEGIN');
		const out = await fn(c);
		await c.query('COMMIT');
		return out;
	} catch (e) {
		await c.query('ROLLBACK').catch(() => {});
		throw e;
	} finally {
		c.release();
	}
}

export { pool };
