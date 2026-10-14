/**
 * /+page.server.ts — Pengalihan root ke area pembuat form.
 *
 * Modul M5 menaruh titik masuk builder di `/forms` (grup `(app)`). Root
 * dialihkan ke sana agar alur kerja langsung sampai ke daftar form. Redirect
 * dilakukan server-side supaya tidak ada kedipan halaman.
 */
import { redirect } from '@sveltejs/kit';

export const load = () => {
	redirect(307, '/forms');
};
