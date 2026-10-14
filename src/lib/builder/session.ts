/**
 * session.ts — Sesi Creator sisi-klien untuk UI Builder (Modul M5).
 *
 * Mengapa localStorage, bukan cookie/session server?
 *  - Kontrak (§3, §4) menetapkan Creator memakai header `x-tenant` + `x-api-key`
 *    pada SETIAP permintaan API. Belum ada lapisan sesi server (itu di luar
 *    lingkup M5). Menyimpan kredensial di localStorage lalu menyuntikkannya
 *    sebagai header adalah cara paling langsung & sesuai kontrak.
 *  - Kredensial hanya hidup di browser pembuat (Creator), tidak dikirim ke
 *    responden. Tetap: ini kredensial sensitif → kita batasi durasi & sediakan
 *    "keluar" yang menghapusnya.
 *
 * Catatan keamanan: TIDAK menyimpan kata sandi owner. Hanya slug tenant +
 * api key tenant yang memang dipakai untuk memanggil API Creator.
 */

const STORAGE_KEY = 'formku.creator.session.v1';

export interface CreatorSession {
	/** Slug tenant (header x-tenant). */
	tenant: string;
	/** Kunci API tenant (header x-api-key). */
	apiKey: string;
	/** Nama tampilan tenant (opsional, hasil /api/tenant/me). */
	name?: string;
	/** Stempel waktu dibuat (ms). */
	at: number;
}

/** Apakah kode berjalan di browser (guard untuk impor saat SSR). */
export function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** Baca sesi tersimpan (atau null). Aman dipanggil saat SSR → null. */
export function loadSession(): CreatorSession | null {
	if (!isBrowser()) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<CreatorSession>;
		if (
			typeof parsed?.tenant === 'string' &&
			parsed.tenant.trim() &&
			typeof parsed.apiKey === 'string' &&
			parsed.apiKey.trim()
		) {
			return {
				tenant: parsed.tenant.trim(),
				apiKey: parsed.apiKey.trim(),
				name: typeof parsed.name === 'string' ? parsed.name : undefined,
				at: typeof parsed.at === 'number' ? parsed.at : Date.now()
			};
		}
	} catch {
		/* data rusak → anggap tak ada sesi */
	}
	return null;
}

/** Simpan sesi Creator. */
export function saveSession(s: Omit<CreatorSession, 'at'>): CreatorSession {
	const full: CreatorSession = { ...s, at: Date.now() };
	if (isBrowser()) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
		} catch {
			/* mode privat / kuota penuh → sesi tetap hidup di memori pemanggil */
		}
	}
	return full;
}

/** Hapus sesi (keluar). */
export function clearSession(): void {
	if (!isBrowser()) return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* abaikan */
	}
}
