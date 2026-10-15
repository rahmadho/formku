<script lang="ts">
	/**
	 * /forms/[id] — Editor/perakit form (Modul M5, halaman inti builder).
	 *
	 * Halaman ini TIDAK dibuat sub-agent M5 (kehabisan tool-call) sehingga klik
	 * form di daftar gagal. Dibangun ulang oleh integrator.
	 *
	 * Tata letak: [daftar bagian+soal] + [inspektur bertab] (kolom kanan, sticky).
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from './_ui/Icon.svelte';
	import Inspector from './_ui/Inspector.svelte';
	import { BuilderStore, type BSection, type BQ } from '$lib/builder/store.svelte.js';
	import { loadSession } from '$lib/builder/session.js';
	import { MODE_LABEL } from '$lib/builder/types-meta.js';

	let store = $state<BuilderStore | null>(null);
	let inspectorMode = $state<'auto' | 'settings' | 'publish'>('auto');
	let dragging = $state<number | null>(null);
	let copiedSlug = $state(false);

	const formId = $derived(Number(page.params.id));

	onMount(() => {
		const session = loadSession();
		if (!session) {
			goto('/forms', { replaceState: true });
			return;
		}
		const s = new BuilderStore(session, formId);
		store = s;
		void s.load();
	});

	// Ringkasan status simpan untuk bilah status.
	const saveLabel = $derived.by(() => {
		if (!store) return '';
		switch (store.save) {
			case 'saving':
				return 'Menyimpan…';
			case 'saved':
				return 'Tersimpan';
			case 'error':
				return 'Gagal menyimpan';
			default:
				return 'Siap';
		}
	});

	async function copySlug(slug: string) {
		try {
			await navigator.clipboard.writeText(slug);
			copiedSlug = true;
			setTimeout(() => (copiedSlug = false), 1400);
		} catch {
			/* abaikan */
		}
	}

	function openPreview() {
		const slug = store?.form?.slug;
		if (slug) window.open(`/f/${slug}`, '_blank');
	}

	/* -------------------------- seret-lepas soal -------------------------- */
	function onDragStart(id: number) {
		dragging = id;
	}
	async function dropOnSection(sec: BSection | null) {
		if (dragging === null || !store) return;
		const id = dragging;
		dragging = null;
		const toId = sec ? sec.id : null;
		await store.moveQuestion(id, toId);
	}
</script>

<svelte:head>
	<title>{store?.form?.title ? `${store.form.title} — FormKu` : 'FormKu'}</title>
</svelte:head>

{#if !store || store.loading}
	<div class="center-state">
		<Icon name="spinner" size={22} />
		<p>Memuat perakit…</p>
	</div>
{:else if store.loadError}
	<div class="center-state err">
		<Icon name="alert" size={22} />
		<p>{store.loadError}</p>
		<a class="btn btn--primary" href="/forms">Kembali ke daftar</a>
	</div>
{:else if store.form}
	<div class="editor">
		<!-- ============================ BILAH ATAS ============================ -->
		<header class="topbar">
			<a class="back" href="/forms" aria-label="Kembali">
				<Icon name="back" size={17} />
				<span>Daftar form</span>
			</a>
			<div class="title-wrap">
				<input
					class="title-input"
					value={store.form.title}
					aria-label="Judul form"
					oninput={(e) => store!.patchForm({ title: e.currentTarget.value })}
				/>
				<div class="meta">
					<span class="chip mode-{store.form.mode}">{MODE_LABEL[store.form.mode] ?? store.form.mode}</span>
					<span class="chip">{store.questionCount} soal</span>
					<span class="chip">{store.maxScore} poin</span>
					{#if store.publishInfo || store.form.status !== 'draft'}
						<button class="chip slug" type="button" onclick={() => copySlug(store!.form!.slug)}>
							<Icon name={copiedSlug ? 'check' : 'link'} size={13} />
							{copiedSlug ? 'Tersalin' : '/' + store.form.slug}
						</button>
					{/if}
				</div>
			</div>
			<div class="actions">
				<span class="save-state" class:err={store.save === 'error'}>{saveLabel}</span>
				{#if store.form.status !== 'draft'}
					<button class="btn btn--ghost" type="button" onclick={openPreview}>
						<Icon name="external" size={15} /> Pratinjau
					</button>
				{/if}
				<button
					class="btn btn--primary"
					type="button"
					onclick={() => (inspectorMode = 'publish')}
				>
					<Icon name="megaphone" size={15} /> Terbitkan
				</button>
			</div>
		</header>

		<div class="cols">
			<!-- ======================= KOLOM KIRI: KANVAS ======================= -->
			<main class="canvas">
				{#if store.loadError === null && store.allQuestions.length === 0}
					<div class="empty">
						<Icon name="form" size={26} />
						<p>Belum ada soal. Mulai dengan menambah bagian atau soal pertama.</p>
					</div>
				{/if}

				{#each store.sections as sec (sec.id)}
					<section
						class="section-card"
						role="region"
						aria-label={sec.title}
						ondragover={(e) => e.preventDefault()}
						ondrop={() => dropOnSection(sec)}
					>
						<div class="sec-head">
							<input
								class="sec-title"
								value={sec.title}
								aria-label="Judul bagian"
								oninput={(e) => store!.patchSection(sec.id, { title: e.currentTarget.value })}
							/>
							<div class="sec-tools">
								<button
									class="icon-btn"
									type="button"
									title="Tambah soal ke bagian ini"
									aria-label="Tambah soal ke bagian ini"
									onclick={() => store!.addQuestion(sec.id)}
								>
									<Icon name="plus" size={16} />
								</button>
								<button
									class="icon-btn danger"
									type="button"
									title="Hapus bagian"
									aria-label="Hapus bagian"
									onclick={() => store!.deleteSection(sec.id)}
								>
									<Icon name="trash" size={16} />
								</button>
							</div>
						</div>

						<ul class="qlist">
							{#each sec.questions as q (q.id)}
								{@render questionRow(q)}
							{/each}
							{#if sec.questions.length === 0}
								<li class="drop-hint">Tarik soal ke sini, atau tekan + untuk membuat.</li>
							{/if}
						</ul>
					</section>
				{/each}

				{#if store.unassigned.length > 0}
					<section
						class="section-card loose"
						role="region"
						aria-label="Soal tanpa bagian"
						ondragover={(e) => e.preventDefault()}
						ondrop={() => dropOnSection(null)}
					>
						<div class="sec-head">
							<span class="sec-title static">Tanpa bagian</span>
						</div>
						<ul class="qlist">
							{#each store.unassigned as q (q.id)}
								{@render questionRow(q)}
							{/each}
						</ul>
					</section>
				{/if}

				<div class="add-row">
					<button class="btn btn--ghost" type="button" onclick={() => store!.addSection()}>
						<Icon name="section" size={15} /> Tambah bagian
					</button>
					<button class="btn btn--ghost" type="button" onclick={() => store!.addQuestion(null)}>
						<Icon name="plus" size={15} /> Tambah soal
					</button>
				</div>
			</main>

			<!-- ===================== KOLOM KANAN: INSPEKTUR ===================== -->
			<Inspector {store} bind:mode={inspectorMode} />
		</div>
	</div>
{/if}

{#snippet questionRow(q: BQ)}
	<li
		class="qrow"
		class:selected={store!.selectedQuestionId === q.id}
		draggable="true"
		ondragstart={() => onDragStart(q.id)}
	>
		<button class="q-main" type="button" onclick={() => (store!.selectedQuestionId = q.id)}>
			<span class="grip" aria-hidden="true">⋮⋮</span>
			<span class="q-label">{q.label || '(tanpa judul)'}</span>
			<span class="q-tags">
				{#if q.required}<span class="tag req">wajib</span>{/if}
				{#if q.points > 0}<span class="tag pts">{q.points} poin</span>{/if}
			</span>
		</button>
		<div class="q-tools">
			<button class="icon-btn" type="button" aria-label="Naik" title="Naik" onclick={() => store!.shiftQuestion(q.id, -1)}>
				<Icon name="chevron" size={15} class="up" />
			</button>
			<button class="icon-btn" type="button" aria-label="Turun" title="Turun" onclick={() => store!.shiftQuestion(q.id, 1)}>
				<Icon name="chevron" size={15} />
			</button>
			<button class="icon-btn danger" type="button" aria-label="Hapus soal" title="Hapus" onclick={() => store!.deleteQuestion(q.id)}>
				<Icon name="trash" size={15} />
			</button>
		</div>
	</li>
{/snippet}

<style>
	/* Tokens diambil dari app.css; semua warna punya fallback. */
	.center-state {
		min-height: 60vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		color: var(--ink-3, #6b7686);
	}
	.center-state.err {
		color: var(--danger, #b42318);
	}

	.editor {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--paper, #f7f8fa);
	}

	/* ------------------------------- topbar ------------------------------- */
	.topbar {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.65rem 1rem;
		background: var(--surface, #fff);
		border-bottom: 1px solid var(--line, #e3e7ec);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--ink-2, #39424f);
		text-decoration: none;
		font-size: 0.82rem;
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
	}
	.back:hover {
		background: var(--paper, #f2f4f7);
	}
	.title-wrap {
		flex: 1;
		min-width: 0;
	}
	.title-input {
		width: 100%;
		border: none;
		background: transparent;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--ink, #1c2430);
		padding: 0.1rem 0;
	}
	.title-input:focus-visible {
		outline: 2px solid var(--accent, #2f5bd6);
		outline-offset: 2px;
		border-radius: 6px;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.25rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--paper-2, #eef1f5);
		color: var(--ink-2, #39424f);
		border: none;
	}
	.chip.slug {
		cursor: pointer;
		background: var(--accent-soft, #e8eefc);
		color: var(--accent-ink, #1f3f9e);
	}
	.chip.mode-exam {
		background: #fbe9e7;
		color: #9a3412;
	}
	.chip.mode-quiz {
		background: #e7f6ec;
		color: #1a5d33;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.save-state {
		font-size: 0.72rem;
		color: var(--ink-3, #6b7686);
		min-width: 76px;
		text-align: right;
	}
	.save-state.err {
		color: var(--danger, #b42318);
	}

	/* ------------------------------ columns ------------------------------ */
	.cols {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 380px;
		gap: 1rem;
		padding: 1rem;
		align-items: start;
	}
	.canvas {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 2.5rem 1rem;
		text-align: center;
		color: var(--ink-3, #6b7686);
		background: var(--surface, #fff);
		border: 1px dashed var(--line, #d5dbe3);
		border-radius: 14px;
	}

	.section-card {
		background: var(--surface, #fff);
		border: 1px solid var(--line, #e3e7ec);
		border-radius: 14px;
		padding: 0.85rem;
	}
	.section-card.loose {
		border-style: dashed;
	}
	.sec-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.sec-title {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: 0.92rem;
		font-weight: 700;
		color: var(--ink, #1c2430);
		padding: 0.2rem 0.3rem;
		border-radius: 8px;
	}
	.sec-title.static {
		font-style: italic;
		color: var(--ink-3, #6b7686);
	}
	.sec-title:focus-visible {
		outline: 2px solid var(--accent, #2f5bd6);
		outline-offset: 1px;
	}
	.sec-tools {
		display: flex;
		gap: 0.25rem;
	}

	.qlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.qrow {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
		border: 1px solid var(--line, #e3e7ec);
		border-radius: 10px;
		background: var(--surface, #fff);
	}
	.qrow.selected {
		border-color: var(--accent, #2f5bd6);
		box-shadow: 0 0 0 3px var(--accent-ring, rgba(47, 91, 214, 0.15));
	}
	.q-main {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-align: left;
		background: transparent;
		border: none;
		padding: 0.55rem 0.6rem;
		cursor: pointer;
		border-radius: 10px 0 0 10px;
		min-width: 0;
	}
	.grip {
		color: var(--ink-4, #98a2b3);
		cursor: grab;
		font-size: 0.8rem;
	}
	.q-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.86rem;
		color: var(--ink, #1c2430);
	}
	.q-tags {
		display: flex;
		gap: 0.3rem;
	}
	.tag {
		font-size: 0.64rem;
		font-weight: 600;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.tag.req {
		background: #fef3c7;
		color: #92400e;
	}
	.tag.pts {
		background: var(--paper-2, #eef1f5);
		color: var(--ink-2, #39424f);
	}
	.q-tools {
		display: flex;
		align-items: center;
		gap: 0.1rem;
		padding-right: 0.3rem;
	}
	.drop-hint {
		font-size: 0.78rem;
		color: var(--ink-4, #98a2b3);
		padding: 0.6rem;
		text-align: center;
		border: 1px dashed var(--line, #d5dbe3);
		border-radius: 10px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: none;
		background: transparent;
		color: var(--ink-2, #39424f);
		border-radius: 8px;
		cursor: pointer;
	}
	.icon-btn:hover {
		background: var(--paper-2, #eef1f5);
	}
	.icon-btn.danger:hover {
		background: #fbe9e7;
		color: #b42318;
	}
	:global(.icon-btn .up) {
		transform: rotate(180deg);
	}

	.add-row {
		display: flex;
		gap: 0.5rem;
		padding-top: 0.25rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.5rem 0.85rem;
		border-radius: 10px;
		border: 1px solid transparent;
		cursor: pointer;
		text-decoration: none;
	}
	.btn--primary {
		background: var(--accent, #2f5bd6);
		color: #fff;
	}
	.btn--ghost {
		background: var(--surface, #fff);
		border-color: var(--line, #d5dbe3);
		color: var(--ink-2, #39424f);
	}
	.btn:focus-visible {
		outline: 2px solid var(--accent, #2f5bd6);
		outline-offset: 2px;
	}

	/* ----------------------------- responsive ----------------------------- */
	@media (max-width: 900px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none !important;
		}
	}
</style>
