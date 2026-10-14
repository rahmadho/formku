<script lang="ts">
	/**
	 * /forms — Daftar form milik Creator (Modul M5, titik masuk builder).
	 *
	 * Halaman ini SENGAJA berada di grup `(app)/forms` agar tidak bentrok dengan
	 * dasbor milik Modul M7 (`(app)/+page.svelte`). Fungsinya: memilih form untuk
	 * dibuka di builder, dan membuat form baru dengan pemilih mode.
	 *
	 * Tanpa sesi → tampilkan gerbang masuk (kredensial tenant). Ini menjaga M5
	 * mandiri & dapat diuji walau dasbor M7 belum ada.
	 */
	import { goto } from '$app/navigation';
	import { CreatorApi, ApiClientError, type FormRow } from '$lib/builder/client';
	import { loadSession, saveSession, clearSession, type CreatorSession } from '$lib/builder/session';
	import Icon from './[id]/_ui/Icon.svelte';
	import { MODE_LABEL, MODE_HINT } from '$lib/builder/types-meta.js';
	import { FORM_MODES, type FormMode, type FormStatus } from '$lib/types.js';
	import { STATUS_LABEL } from '$lib/builder/types-meta.js';

	type Listed = FormRow & { question_count: number; response_count: number };

	let session = $state<CreatorSession | null>(null);
	let ready = $state(false);
	let forms = $state<Listed[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let query = $state('');

	/* Formulir masuk (bila belum ada sesi). */
	let tenantInput = $state('');
	let keyInput = $state('');
	let showKey = $state(false);
	let gateBusy = $state(false);
	let gateError = $state<string | null>(null);

	/* Pembuat form baru. */
	let creating = $state(false);
	let newTitle = $state('');
	let newMode = $state<FormMode>('form');
	let createBusy = $state(false);

	$effect(() => {
		if (ready) return;
		const s = loadSession();
		session = s;
		ready = true;
		if (s) void refresh(s);
	});

	async function refresh(s: CreatorSession = session!) {
		loading = true;
		error = null;
		try {
			const res = await new CreatorApi(s).listForms();
			forms = res.forms;
		} catch (e) {
			if (e instanceof ApiClientError && (e.status === 401 || e.status === 403)) {
				// Sesi kedaluwarsa/ditolak → paksa masuk ulang.
				clearSession();
				session = null;
				gateError = 'Sesi tidak lagi valid. Silakan masuk kembali.';
			} else {
				error = e instanceof Error ? e.message : 'Gagal memuat daftar form.';
			}
		} finally {
			loading = false;
		}
	}

	async function login(e: SubmitEvent) {
		e.preventDefault();
		gateBusy = true;
		gateError = null;
		try {
			const cand: CreatorSession = { tenant: tenantInput.trim(), apiKey: keyInput.trim(), at: Date.now() };
			const me = await new CreatorApi(cand).me();
			session = saveSession({ tenant: cand.tenant, apiKey: cand.apiKey, name: me.tenant?.name });
			await refresh(session);
		} catch (err) {
			gateError = err instanceof Error ? err.message : 'Kredensial ditolak.';
		} finally {
			gateBusy = false;
		}
	}

	async function createForm() {
		if (!session || createBusy) return;
		const title = newTitle.trim() || 'Form tanpa judul';
		createBusy = true;
		error = null;
		try {
			const created = await new CreatorApi(session).createForm({ title, mode: newMode });
			await goto(`/forms/${created.id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Gagal membuat form.';
			createBusy = false;
		}
	}

	async function openForm(id: number) {
		await goto(`/forms/${id}`);
	}

	async function removeForm(f: Listed) {
		if (!session) return;
		if (!confirm(`Hapus form "${f.title}"? Semua respons ikut terhapus.`)) return;
		try {
			await new CreatorApi(session).deleteForm(f.id);
			forms = forms.filter((x) => x.id !== f.id);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Gagal menghapus.';
		}
	}

	function logout() {
		clearSession();
		session = null;
		forms = [];
	}

	const filtered = $derived(
		query.trim()
			? forms.filter((f) =>
					`${f.title} ${f.slug}`.toLowerCase().includes(query.trim().toLowerCase())
				)
			: forms
	);
</script>

<svelte:head><title>Form saya — FormKu</title></svelte:head>

<div class="page">
	{#if !ready}
		<div class="center"><Icon name="spinner" size={22} /></div>
	{:else if !session}
		<!-- Gerbang masuk -->
		<div class="center">
			<form class="login card" onsubmit={login}>
				<div class="brand">
					<div class="brand-mark"><Icon name="form" size={22} /></div>
					<div>
						<div class="brand-name">FormKu</div>
						<div class="brand-sub">Pembuat Form · Kuis · Ujian</div>
					</div>
				</div>
				<h1>Masuk sebagai Creator</h1>
				<p class="hint">Gunakan slug tenant dan kunci API Anda.</p>
				<div class="field">
					<label for="t">Slug tenant</label>
					<input id="t" class="input mono" bind:value={tenantInput} placeholder="mis. sekolah-nusantara" autocomplete="username" />
				</div>
				<div class="field">
					<label for="k">Kunci API</label>
					<div class="key-row">
						<input id="k" class="input mono" type={showKey ? 'text' : 'password'} bind:value={keyInput} placeholder="fk_…" autocomplete="current-password" />
						<button class="btn btn--sm" type="button" onclick={() => (showKey = !showKey)}>
							{showKey ? 'Sembunyikan' : 'Tampilkan'}
						</button>
					</div>
				</div>
				{#if gateError}<p class="toast toast--err" role="alert"><Icon name="alert" size={15} /> {gateError}</p>{/if}
				<button class="btn btn--primary submit" type="submit" disabled={gateBusy || !tenantInput.trim() || !keyInput.trim()}>
					{#if gateBusy}<Icon name="spinner" size={16} /> Memverifikasi…{:else}Masuk{/if}
				</button>
			</form>
		</div>
	{:else}
		<!-- Dasbor form M5 -->
		<header class="topbar">
			<div class="top-id">
				<div class="brand-mark brand-mark--sm"><Icon name="form" size={18} /></div>
				<div>
					<div class="top-name">Form saya</div>
					<div class="top-tenant mono">{session.name ?? session.tenant}</div>
				</div>
			</div>
			<div class="top-actions">
				<button class="btn btn--sm btn--ghost" type="button" onclick={() => refresh()} disabled={loading}>
					<Icon name="spinner" size={15} class={loading ? '' : 'hidden'} /> Muat ulang
				</button>
				<button class="btn btn--sm btn--ghost" type="button" onclick={logout}>
					<Icon name="logout" size={15} /> Keluar
				</button>
			</div>
		</header>

		<main class="content">
			<div class="toolbar">
				<div class="search">
					<input class="input" bind:value={query} placeholder="Cari form…" aria-label="Cari form" />
				</div>
				<button class="btn btn--primary" type="button" onclick={() => (creating = !creating)}>
					<Icon name={creating ? 'back' : 'plus'} size={16} /> {creating ? 'Batal' : 'Buat form baru'}
				</button>
			</div>

			{#if creating}
				<div class="create card">
					<div class="create-main">
						<label class="label" for="newtitle">Judul form baru</label>
						<input
							id="newtitle"
							class="input"
							bind:value={newTitle}
							placeholder="mis. Ujian Akhir Semester"
							onkeydown={(e) => { if (e.key === 'Enter') createForm(); }}
						/>
						<div class="mode-grid">
							{#each FORM_MODES as m (m)}
								<button
									class="mode-opt"
									class:active={newMode === m}
									type="button"
									aria-pressed={newMode === m}
									onclick={() => (newMode = m)}
								>
									<span class="mode-name">{MODE_LABEL[m]}</span>
									<span class="mode-hint">{MODE_HINT[m]}</span>
								</button>
							{/each}
						</div>
					</div>
					<button class="btn btn--primary create-go" type="button" onclick={createForm} disabled={createBusy}>
						{#if createBusy}<Icon name="spinner" size={16} /> Membuat…{:else}<Icon name="plus" size={16} /> Buat &amp; buka{/if}
					</button>
				</div>
			{/if}

			{#if error}
				<p class="toast toast--err" role="alert"><Icon name="alert" size={15} /> {error}</p>
			{/if}

			{#if loading && forms.length === 0}
				<div class="center tall"><Icon name="spinner" size={22} /> <span class="hint">Memuat…</span></div>
			{:else if filtered.length === 0}
				<div class="empty card">
					<Icon name="form" size={30} />
					<h2>{forms.length === 0 ? 'Belum ada form' : 'Tidak ada yang cocok'}</h2>
					<p class="hint">
						{forms.length === 0 ? 'Buat form pertama Anda untuk mulai menyusun soal.' : 'Coba kata kunci lain.'}
					</p>
					{#if forms.length === 0}
						<button class="btn btn--primary" type="button" onclick={() => (creating = true)}>
							<Icon name="plus" size={16} /> Buat form baru
						</button>
					{/if}
				</div>
			{:else}
				<ul class="form-list">
					{#each filtered as f (f.id)}
						<li class="form-row card">
							<button class="form-open" type="button" onclick={() => openForm(f.id)}>
								<div class="form-thumb" aria-hidden="true">
									<Icon name="form" size={20} />
								</div>
								<div class="form-info">
									<div class="form-top">
										<span class="form-title">{f.title}</span>
										<span class="badge badge--{f.status}">{STATUS_LABEL[f.status as FormStatus]}</span>
										<span class="badge badge--mode">{MODE_LABEL[f.mode as FormMode]}</span>
									</div>
									<div class="form-meta mono">/f/{f.slug}</div>
									<div class="form-stats">
										<span><Icon name="section" size={13} /> {f.question_count} soal</span>
										<span><Icon name="check" size={13} /> {f.response_count} respons</span>
									</div>
								</div>
								<Icon name="chevron" size={18} class="form-chev" />
							</button>
							<button class="form-del" type="button" aria-label="Hapus form {f.title}" title="Hapus" onclick={() => removeForm(f)}>
								<Icon name="trash" size={15} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</main>
	{/if}
</div>

<style>
	.page {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: var(--paper);
	}
	.center {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: var(--sp-3);
		padding: var(--sp-6);
		color: var(--ink-3);
		background: radial-gradient(60% 50% at 20% 0%, var(--accent-soft), transparent 70%);
	}
	.center.tall {
		min-height: 260px;
	}
	/* Login */
	.login {
		width: 100%;
		max-width: 420px;
		padding: var(--sp-6);
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
		box-shadow: var(--shadow-3);
	}
	.login h1 {
		font-size: 19px;
		font-weight: 720;
		letter-spacing: -0.01em;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.brand-mark {
		width: 42px;
		height: 42px;
		border-radius: var(--r);
		display: grid;
		place-items: center;
		background: var(--accent);
		color: #fff;
		flex: 0 0 auto;
	}
	.brand-mark--sm {
		width: 34px;
		height: 34px;
		border-radius: var(--r-sm);
	}
	.brand-name {
		font-weight: 750;
		font-size: 17px;
	}
	.brand-sub {
		font-size: 12.5px;
		color: var(--ink-3);
	}
	.key-row {
		display: flex;
		gap: var(--sp-2);
	}
	.key-row .input {
		flex: 1;
	}
	.submit {
		padding: 11px;
	}

	/* Topbar */
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
		padding: 10px var(--sp-5);
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	.top-id {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}
	.top-name {
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.top-tenant {
		font-size: 12px;
		color: var(--ink-3);
	}
	.top-actions {
		display: flex;
		gap: var(--sp-2);
	}

	.content {
		flex: 1;
		width: 100%;
		max-width: 880px;
		margin: 0 auto;
		padding: var(--sp-5);
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.toolbar {
		display: flex;
		gap: var(--sp-3);
		align-items: center;
	}
	.search {
		flex: 1;
	}

	.create {
		display: flex;
		align-items: flex-end;
		gap: var(--sp-4);
		padding: var(--sp-4);
	}
	.create-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.create-go {
		flex: 0 0 auto;
	}
	.mode-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--sp-2);
		margin-top: var(--sp-1);
	}
	.mode-opt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		padding: 9px 11px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		transition: all var(--dur) var(--ease);
	}
	.mode-opt:hover {
		border-color: var(--ink-faint);
	}
	.mode-opt.active {
		border-color: var(--accent);
		background: var(--accent-soft);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.mode-name {
		font-size: 13px;
		font-weight: 650;
	}
	.mode-opt.active .mode-name {
		color: var(--accent-ink);
	}
	.mode-hint {
		font-size: 11px;
		color: var(--ink-3);
		line-height: 1.35;
	}

	/* List */
	.form-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.form-row {
		display: flex;
		align-items: stretch;
		overflow: hidden;
		transition: box-shadow var(--dur) var(--ease), border-color var(--dur) var(--ease);
	}
	.form-row:hover {
		border-color: var(--accent-line);
		box-shadow: var(--shadow-2);
	}
	.form-open {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--sp-4);
		padding: var(--sp-4);
		background: transparent;
		border: 0;
		text-align: left;
	}
	.form-thumb {
		width: 46px;
		height: 46px;
		border-radius: var(--r-sm);
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		color: var(--accent-ink);
		border: 1px solid var(--accent-line);
		flex: 0 0 auto;
	}
	.form-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.form-top {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.form-title {
		font-size: 15px;
		font-weight: 680;
		letter-spacing: -0.01em;
	}
	.form-meta {
		font-size: 12px;
		color: var(--ink-3);
	}
	.form-stats {
		display: flex;
		gap: var(--sp-4);
		font-size: 12px;
		color: var(--ink-2);
	}
	.form-stats span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.form-chev {
		color: var(--ink-faint);
		flex: 0 0 auto;
	}
	.form-del {
		flex: 0 0 auto;
		width: 46px;
		border: 0;
		border-left: 1px solid var(--line);
		background: transparent;
		color: var(--ink-faint);
	}
	.form-del:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.empty {
		text-align: center;
		padding: var(--sp-6);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-3);
		color: var(--ink-2);
	}
	.empty h2 {
		font-size: 18px;
	}

	:global(.hidden) {
		display: none;
	}

	@media (max-width: 720px) {
		.mode-grid {
			grid-template-columns: 1fr;
		}
		.create {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
