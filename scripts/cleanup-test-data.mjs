#!/usr/bin/env node
/** cleanup-test-data.mjs — hapus tenant/form/bank hasil uji (schema formku). */
import pg from 'pg';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
	const m = l.match(/^([A-Z_]+)=(.*)$/);
	if (m) env[m[1]] = m[2];
}
const c = new pg.Client({
	host: env.PGHOST, port: +env.PGPORT, user: env.PGUSER,
	password: env.PGPASSWORD, database: env.PGDATABASE,
	ssl: { rejectUnauthorized: false }
});
await c.connect();
// Hapus tenant yang dibuat uji (slug berpola uji) — cascade ke form/section/soal/respons.
const del = await c.query(
	`DELETE FROM formku.tenants WHERE slug ~ '^(u|a|b)-' OR name ILIKE '%uji%' OR name ILIKE '%ui uji%'`
);
const t = await c.query('SELECT count(*)::int n FROM formku.tenants');
const f = await c.query('SELECT count(*)::int n FROM formku.forms');
const b = await c.query('SELECT count(*)::int n FROM formku.bank_questions');
console.log(`✅ Dibersihkan: ${del.rowCount} tenant uji. Sisa → tenant:${t.rows[0].n} form:${f.rows[0].n} bank:${b.rows[0].n}`);
await c.end();
