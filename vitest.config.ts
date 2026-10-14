import { defineConfig } from 'vitest/config';

/**
 * Konfigurasi Vitest khusus Modul M1 (tipe & util).
 *
 * Sengaja TERPISAH dari `vite.config.ts` (milik M0) agar tidak bentrok saat kerja
 * paralel. Vitest mengutamakan `vitest.config.ts` bila ada.
 *
 * Util M1 murni TypeScript (tanpa SvelteKit runtime), jadi tak perlu plugin
 * sveltekit. Alias `#lib` tetap disediakan agar cocok dengan kontrak proyek.
 *
 * Catatan: `tests/tsconfig.json` menyediakan konfigurasi TS mandiri sehingga
 * pengujian tidak bergantung pada `tsconfig.json` root (yang "extends"
 * `.svelte-kit/tsconfig.json` hasil `svelte-kit sync`).
 */
export default defineConfig({
	resolve: {
		alias: {
			'#lib': new URL('./src/lib/index.ts', import.meta.url).pathname
		}
	},
	test: {
		include: ['tests/**/*.{test,spec}.ts'],
		environment: 'node',
		globals: false
	}
});
