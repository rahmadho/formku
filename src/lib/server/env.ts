/**
 * env.ts — Akses environment yang ANDAL untuk FormKu (server-only).
 *
 * Mengapa tidak pakai modul env virtual SvelteKit (app/env/private atau
 * env/dynamic/private)? Pada SvelteKit 3.0.x (beta) modul env virtual
 * menghasilkan file generated KOSONG (0 byte) saat svelte-kit sync, sehingga
 * env.OWNER_PASSWORD selalu undefined saat runtime. Bukti:
 *   .svelte-kit/generated/[dev|build]/env/private/server.js berukuran 0 byte.
 *
 * Solusi: baca langsung dari process.env (adapter-node menjalankan kode di
 * Node, jadi selalu tersedia & tidak rapuh terhadap perubahan API beta).
 *
 * Muat dotenv di produksi:
 *   set -a && . ./.env && set +a && node build/index.js
 */

function read(key: string, fallback = ''): string {
	return process.env[key] ?? fallback;
}

export const env = {
	get PGHOST() {
		return read('PGHOST', 'postgresql_dev');
	},
	get PGPORT() {
		return read('PGPORT', '5432');
	},
	get PGUSER() {
		return read('PGUSER', 'vibe');
	},
	get PGPASSWORD() {
		return read('PGPASSWORD');
	},
	get PGDATABASE() {
		return read('PGDATABASE', 'vibe-undangan-nikah');
	},
	get PGSSL() {
		return read('PGSSL', 'true');
	},
	get PORT() {
		return read('PORT', '3400');
	},
	get OWNER_PASSWORD() {
		return read('OWNER_PASSWORD');
	}
};

export type AppEnv = typeof env;
