<script lang="ts">
	/**
	 * Inspector.svelte — Panel inspektur kontekstual (kolom kanan, Modul M5).
	 *
	 * Tiga mode:
	 *   - "Soal"     : editor detail soal yang sedang terpilih (default saat memilih).
	 *   - "Setelan"  : pengaturan tingkat form.
	 *   - "Terbitkan": publikasi & tautan publik.
	 *
	 * Perilaku: memilih soal otomatis berpindah ke mode "Soal" (kecuali pengguna
	 * sedang berada di mode eksplisit). Panel ini sticky & dapat digulir sendiri.
	 */
	import Icon, { type IconName } from './Icon.svelte';
	import QuestionInspector from './QuestionInspector.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import PublishPanel from './PublishPanel.svelte';
	import { questionTypeLabel } from '$lib/builder/types-meta.js';
	import type { BuilderStore } from '$lib/builder/store.svelte.js';

	interface Props {
		store: BuilderStore;
		mode: 'auto' | 'settings' | 'publish';
	}
	let { store, mode = $bindable() }: Props = $props();

	/** Tab aktif yang diturunkan dari pilihan + mode eksplisit. */
	type Tab = 'question' | 'settings' | 'publish';

	// Saat pengguna memilih soal, tampilkan tab Soal (mode kembali 'auto').
	$effect(() => {
		if (store.selectedQuestionId !== null && mode === 'auto') {
			tab = 'question';
		}
	});

	// Saat mode diarahkan dari luar (mis. tombol pengaturan di kartu intro).
	$effect(() => {
		if (mode === 'settings') tab = 'settings';
		else if (mode === 'publish') tab = 'publish';
	});

	let tab = $state<Tab>(store.selectedQuestionId !== null ? 'question' : 'settings');

	/** Saat membuka pengaturan lewat store.settingsOpen (dari Canvas). */
	$effect(() => {
		if (store.settingsOpen) {
			tab = 'settings';
			store.settingsOpen = false;
		}
	});

	const q = $derived(store.selectedQuestion);

	function pick(t: Tab) {
		tab = t;
		mode = 'auto';
		if (t === 'question' && store.selectedQuestionId === null && store.questionCount > 0) {
			// Pilih soal pertama agar tab Soal tidak kosong.
			const first = store.allQuestions[0];
			if (first) store.selectedQuestionId = first.id;
		}
	}

	const TABS: { id: Tab; label: string; icon: IconName }[] = [
		{ id: 'question', label: 'Soal', icon: 'form' },
		{ id: 'settings', label: 'Setelan', icon: 'settings' },
		{ id: 'publish', label: 'Terbitkan', icon: 'megaphone' }
	];
</script>

<aside class="insp scroll" id="inspector" aria-label="Panel inspektur">
	<div class="tabs" role="tablist" aria-label="Panel inspektur">
		{#each TABS as t (t.id)}
			<button
				class="tab"
				class:active={tab === t.id}
				type="button"
				role="tab"
				aria-selected={tab === t.id}
				onclick={() => pick(t.id)}
			>
				<Icon name={t.icon} size={15} />
				<span>{t.label}</span>
			</button>
		{/each}
	</div>

	<div class="insp-body">
		{#if tab === 'question'}
			{#if q}
				<div class="ctx">
					<span class="ctx-label">Menyunting soal</span>
					<span class="ctx-type">{questionTypeLabel(q.type)}</span>
				</div>
				<QuestionInspector {store} {q} />
			{:else}
				<div class="empty-insp">
					<Icon name="form" size={24} />
					<p>Pilih sebuah soal di kanvas untuk menyuntingnya.</p>
					{#if store.questionCount === 0}
						<p class="hint">Belum ada soal. Tambahkan lewat tombol “Tambah soal”.</p>
					{/if}
				</div>
			{/if}
		{:else if tab === 'settings'}
			<div class="ctx">
				<span class="ctx-label">Pengaturan</span>
				<span class="ctx-type">Form</span>
			</div>
			<SettingsPanel {store} />
		{:else}
			<div class="ctx">
				<span class="ctx-label">Publikasi</span>
				<span class="ctx-type">Status &amp; tautan</span>
			</div>
			<PublishPanel {store} />
		{/if}
	</div>
</aside>

<style>
	.insp {
		background: var(--surface);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: var(--sp-2) var(--sp-2) 0;
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		background: var(--surface);
		z-index: 5;
	}
	.tab {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 9px 6px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--ink-3);
		font-size: 12.5px;
		font-weight: 650;
		margin-bottom: -1px;
		transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
	}
	.tab:hover {
		color: var(--ink);
	}
	.tab.active {
		color: var(--accent-ink);
		border-bottom-color: var(--accent);
	}
	.insp-body {
		padding: var(--sp-4);
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.ctx {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--sp-2);
	}
	.ctx-label {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		color: var(--ink-3);
	}
	.ctx-type {
		font-size: 11.5px;
		color: var(--ink-2);
		font-weight: 600;
	}
	.empty-insp {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-2);
		text-align: center;
		padding: var(--sp-6) var(--sp-4);
		color: var(--ink-3);
	}
	.empty-insp p {
		font-size: 13.5px;
		line-height: 1.5;
	}
</style>
