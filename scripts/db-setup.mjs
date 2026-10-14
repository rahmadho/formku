/**
 * scripts/db-setup.mjs — Buat database (bila belum ada) + jalankan skema FormKu.
 * Pakai: node scripts/db-setup.mjs
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

// muat .env sederhana
const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m) env[m[1]] = m[2];
}

const base = {
	host: env.PGHOST, port: Number(env.PGPORT), user: env.PGUSER,
	password: env.PGPASSWORD, ssl: { rejectUnauthorized: false }
};
const dbName = env.PGDATABASE || 'vibe-formku';

// 1) Buat database bila belum ada (konek ke 'postgres')
{
	const c = new pg.Client({ ...base, database: 'postgres' });
	await c.connect();
	const exists = await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [dbName]);
	if (exists.rowCount === 0) {
		await c.query(`CREATE DATABASE "${dbName}"`);
		console.log('✅ Database dibuat:', dbName);
	} else {
		console.log('ℹ️  Database sudah ada:', dbName);
	}
	await c.end();
}

// 2) Jalankan DDL skema
const { SCHEMA_SQL } = await import('../src/lib/server/schema.ts').catch(async () => {
	// fallback: baca file & ambil literal (hindari TS loader)
	const src = readFileSync(new URL('../src/lib/server/schema.ts', import.meta.url), 'utf8');
	const m = src.match(/SCHEMA_SQL = `([\s\S]*?)`;/);
	return { SCHEMA_SQL: m ? m[1] : '' };
});

const c2 = new pg.Client({ ...base, database: dbName });
await c2.connect();
await c2.query(SCHEMA_SQL);
const t = await c2.query(
	`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='formku'`
);
console.log('✅ Skema diterapkan. Tabel di schema formku:', t.rows[0].n);
await c2.end();
