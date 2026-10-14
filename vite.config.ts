import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SvelteKit 3 menghapus alias bawaan `$lib`. Pertahankan `$lib` agar sesuai
			// KONTRAK-TEKNIS (M0 memakai `$lib/server/*`). Alternatifnya migrasi ke `#lib`.
			alias: {
				$lib: 'src/lib'
			},

			// Kontrak FormKu: adapter-node, port 3400.
			adapter: adapter()
		})
	]
});
