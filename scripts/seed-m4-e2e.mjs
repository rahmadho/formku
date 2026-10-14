/**
 * seed-m4-e2e.mjs — Menyiapkan data uji nyata untuk Modul M4 (API publik).
 *
 * Membuat: 1 tenant, 1 form ber-mode 'exam' (status open, require_token), 1 section,
 * 3 soal dengan correct_json, plus 1 soal bank. Mencetak kredensial + slug agar
 * bisa dipakai curl E2E.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

// Muat .env manual (tanpa dependensi dotenv).
const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.startsWith('#'))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		})
);

const pool = new pg.Pool({
	host: env.PGHOST,
	port: Number(env.PGPORT || 5432),
	user: env.PGUSER,
	password: env.PGPASSWORD,
	database: env.PGDATABASE,
	ssl: { rejectUnauthorized: false }
});

function hashSecret(secret) {
	const salt = randomBytes(16);
	const hash = scryptSync(secret, salt, 64);
	return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const slug = 'e2e-m4-' + Date.now().toString(36);
const apiKey = 'fk_' + randomBytes(24).toString('base64url');
const formSlug = slug + '-form';
const examToken = 'TOKEN-RAHASIA-123';

const c = await pool.connect();
try {
	await c.query('BEGIN');

	const t = await c.query(
		`INSERT INTO formku.tenants (slug, name, owner_email, api_key_hash)
		 VALUES ($1,$2,$3,$4) RETURNING id`,
		[slug, 'Tenant E2E M4', 'e2e@example.test', hashSecret(apiKey)]
	);
	const tenantId = t.rows[0].id;

	const f = await c.query(
		`INSERT INTO formku.forms
		   (tenant_id, title, slug, description, mode, status, timer_seconds, timer_scope,
		    shuffle_questions, shuffle_options, bank_pick_count, passing_grade,
		    show_score, require_token, access_token, thanks_text, theme_json)
		 VALUES ($1,$2,$3,$4,'exam','open',600,'form',true,true,NULL,70,true,true,$5,$6,'{"primary":"#2563eb"}'::jsonb)
		 RETURNING id`,
		[tenantId, 'Ujian E2E M4', formSlug, 'Form uji kebocoran kunci', examToken, 'Terima kasih!']
	);
	const formId = f.rows[0].id;

	const s = await c.query(
		`INSERT INTO formku.sections (form_id, title, description, sort) VALUES ($1,$2,$3,0) RETURNING id`,
		[formId, 'Bagian A', 'bagian pertama']
	);
	const sectionId = s.rows[0].id;

	// Soal 1: radio (kunci A). Soal 2: checkbox (kunci A,C). Soal 3: short_text (kunci "Jakarta").
	await c.query(
		`INSERT INTO formku.questions (form_id, section_id, type, label, help_text, required, points, correct_json, settings_json, sort)
		 VALUES
		 ($1,$2,'radio','Ibu kota Indonesia?',NULL,true,10,'{"value":"A"}'::jsonb,
		    '{"options":[{"label":"Jakarta","value":"A"},{"label":"Bandung","value":"B"},{"label":"Surabaya","value":"C"}]}'::jsonb,0),
		 ($1,$2,'checkbox','Provinsi di Pulau Jawa?',NULL,false,10,'{"values":["A","C"]}'::jsonb,
		    '{"options":[{"label":"Jawa Barat","value":"A"},{"label":"Sumatera Utara","value":"B"},{"label":"Jawa Timur","value":"C"}]}'::jsonb,1),
		 ($1,$2,'short_text','Sebutkan ibu kota Indonesia (teks).',NULL,false,5,'{"value":"Jakarta"}'::jsonb,'{}'::jsonb,2)`,
		[formId, sectionId]
	);

	await c.query('COMMIT');

	console.log(JSON.stringify({ tenant: slug, apiKey, form: formSlug, examToken, formId, tenantId }, null, 2));
} catch (e) {
	await c.query('ROLLBACK');
	console.error('SEED ERR', e.message);
	process.exitCode = 1;
} finally {
	c.release();
	await pool.end();
}
