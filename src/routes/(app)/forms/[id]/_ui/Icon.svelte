<script lang="ts" module>
	export type IconName =
		| 'form'
		| 'settings'
		| 'megaphone'
		| 'plus'
		| 'trash'
		| 'chevron'
		| 'check'
		| 'alert'
		| 'calendar'
		| 'external'
		| 'key'
		| 'link'
		| 'logout'
		| 'section'
		| 'spinner'
		| 'back'
		| 'copy';
</script>

<script lang="ts">
	let {
		name,
		size = 16,
		stroke = 1.75,
		class: cls = ''
	}: { name: IconName; size?: number; stroke?: number; class?: string } = $props();

	// Path sederhana (stroke-based). Semua original, tidak menyalin aset pihak lain.
	const paths: Record<IconName, string> = {
		form: 'M4 4h12v3H4zM4 10h12M4 14h8M4 18h10',
		settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2m12 0h2M12 4v2m0 12v2',
		megaphone: 'M4 10v4l2 1v4h2v-4l8 3V6L6 9H4zM18 9a3 3 0 0 1 0 6',
		plus: 'M12 5v14M5 12h14',
		trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
		chevron: 'M6 9l6 6 6-6',
		check: 'M5 12l5 5L19 7',
		alert: 'M12 4l9 16H3l9-16zM12 10v5M12 17h.01',
		calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
		external: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
		key: 'M15 7a4 4 0 1 1-3.5 5.9L9 15H7v2H5v2H3v-2l7-7A4 4 0 0 1 15 7z',
		link: 'M9 15l6-6M8 17H6a4 4 0 0 1 0-8h2m8 0h2a4 4 0 0 1 0 8h-2',
		logout: 'M15 12H4m4-4l-4 4 4 4M14 4h5v16h-5',
		section: 'M4 5h16v4H4zM4 13h16M4 17h10',
		spinner: 'M12 3a9 9 0 1 0 9 9',
		back: 'M15 6l-6 6 6 6',
		copy: 'M9 9h11v11H9zM5 15H4V4h11v1'
	};
</script>

<svg
	class={['icon', cls, name === 'spinner' ? 'spin' : ''].join(' ')}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={paths[name]} />
</svg>

<style>
	.icon {
		display: inline-block;
		vertical-align: -0.15em;
		flex: none;
	}
	.spin {
		animation: icon-spin 1.1s linear infinite;
		transform-origin: center;
	}
	@keyframes icon-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation-duration: 3s;
		}
	}
</style>
