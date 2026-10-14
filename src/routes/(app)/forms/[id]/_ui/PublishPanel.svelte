<script lang="ts">
	/**
	 * PublishPanel.svelte — Publikasi & tautan publik (Modul M5).
	 *
	 * Alur: Draf → Terbitkan (status 'open', slug final, token bila perlu) →
	 * salin tautan / buka pratinjau → tutup (status 'closed') atau kembalikan
	 * ke draf. Menampilkan hasil publish nyata dari API (bukan klaim UI).
	 */
	import Icon from './Icon.svelte';
	import { STATUS_LABEL } from '$lib/builder/types-meta.js';
	import type { BuilderStore } from '$lib/builder/store.svelte.js';

	interface Props {
		store: BuilderStore;
	}
	let { store }: Props = $props();

	let busy = $state(false);
	let copied = $state<'url' | 'token' | null>(null);
	let actionError = $state<string | null>(null);
	let confirmUnpublish = $state(false);

	/** URL absolut publik (dibentuk di klien). */
	const publicUrl = $derived(
		typeof window !== 'undefined' && store.publishInfo
			? `${window.location.origin}${store.publishInfo.url}`
			: store.publishInfo?.url ?? ''
	);
	const status = $derived(store.form?.status ?? 'draft');
	const isLive = $derived(status === 'open');

	async function doPublish() {
		busy = true;
		actionError = null;
		const ok = await store.publish();
		busy = false;
		if (!ok) actionError = store.saveError ?? 'Publikasi gagal.';
	}

	async function setStatus(s: 'draft' | 'open' | 'closed') {
		busy = true;
		actionError = null;
		const ok = await store.setStatus(s);
		busy = false;
		if (!ok) actionError = store.saveError ?? 'Perubahan status gagal.';
		confirmUnpublish = false;
	}

	async function copy(text: string, which: 'url' | 'token') {
		try {
			await navigator.clipboard.writeText(text);
			copied = which;
			setTimeout(() => (copied = null), 1600);
		} catch {
			actionError = 'Peramban menolak akses clipboard. Salin manual.';
		}
	}

	/** Peringatan kesiapan sebelum publikasi. */
	const warnings = $derived.by(() => {
		const w: string[] = [];
		if (store.questionCount === 0) w.push('Form belum memiliki soal.');
		if (store.isExam && store.keyedCount < store.questionCount)
			w.push(`${store.questionCount - store.keyedCount} soal belum punya kunci jawaban.`);
		if (store.form?.timer_seconds && store.form.timer_scope === 'section')
			w.push('Timer per bagian aktif — pastikan setiap bagian punya durasinya.');
		return w;
	});
</script>

<div class="pp">
	<!-- Status saat ini -->
	<div class="status-card status-card--{status}">
		<div class="status-top">
			<span class="badge badge--{status}">{STATUS_LABEL[status]}</span>
			{#if isLive}
				<span class="live-dot" aria-hidden="true"></span>
				<span class="live-text">Tautan aktif</span>
			{/if}
		</div>
		{#if isLive && publicUrl}
			<p class="status-hint">Form dapat diisi lewat tautan publik di bawah.</p>
		{:else if status === 'closed'}
			<p class="status-hint">Form ditutup: responden tidak dapat mengirim jawaban baru.</p>
		{:else}
			<p class="status-hint">Form masih draf. Terbitkan untuk membuka akses responden.</p>
		{/if}
	</div>

	<!-- Kesiapan -->
	{#if warnings.length > 0 && !isLive}
		<div class="warn">
			<div class="warn-head"><Icon name="alert" size={15} /> Periksa sebelum terbit</div>
			<ul>
				{#each warnings as w (w)}
					<li>{w}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Aksi utama -->
	<div class="actions">
		{#if !isLive}
			<button class="btn btn--primary pub-btn" type="button" onclick={doPublish} disabled={busy}>
				{#if busy}<Icon name="spinner" size={16} /> Menerbitkan…{:else}<Icon name="megaphone" size={16} /> Terbitkan form{/if}
			</button>
		{:else}
			<button class="btn btn--primary pub-btn" type="button" onclick={() => copy(publicUrl, 'url')}>
				<Icon name={copied === 'url' ? 'check' : 'copy'} size={16} />
				{copied === 'url' ? 'Tersalin!' : 'Salin tautan publik'}
			</button>
			<a class="btn pub-btn" href={store.publishInfo?.url ?? '#'} target="_blank" rel="noopener">
				<Icon name="external" size={16} /> Buka pratinjau
			</a>
		{/if}
	</div>

	<!-- Tautan & token -->
	{#if isLive && store.publishInfo}
		<div class="detail">
			<div class="detail-label">Tautan publik</div>
			<div class="detail-value">
				<a class="url mono" href={store.publishInfo.url} target="_blank" rel="noopener">{publicUrl}</a>
			</div>

			{#if store.form?.require_token && store.publishInfo.access_token}
				<div class="detail-label token-label">
					<Icon name="key" size={13} /> Token ujian
				</div>
				<div class="token-box">
					<code class="token">{store.publishInfo.access_token}</code>
					<button class="btn btn--sm btn--ghost" type="button" aria-label="Salin token" onclick={() => copy(store.publishInfo?.access_token ?? '', 'token')}>
						<Icon name={copied === 'token' ? 'check' : 'copy'} size={14} />
					</button>
				</div>
				<p class="hint">Bagikan token ini terpisah dari tautan (mis. di ruang ujian).</p>
			{/if}
		</div>
	{/if}

	<!-- Kontrol status lanjutan -->
	{#if isLive || status === 'closed'}
		<hr class="dotted-rule" />
		<div class="status-actions">
			{#if isLive}
				{#if confirmUnpublish}
					<div class="confirm">
						<span class="hint">Tutup form? Responden tak bisa lagi mengirim.</span>
						<div class="confirm-btns">
							<button class="btn btn--sm btn--danger" type="button" onclick={() => setStatus('closed')} disabled={busy}>Tutup sekarang</button>
							<button class="btn btn--sm btn--ghost" type="button" onclick={() => (confirmUnpublish = false)}>Batal</button>
						</div>
					</div>
				{:else}
					<button class="btn btn--sm" type="button" onclick={() => (confirmUnpublish = true)}>
						<Icon name="alert" size={14} /> Tutup form
					</button>
				{/if}
			{:else}
				<button class="btn btn--sm btn--primary" type="button" onclick={() => setStatus('open')} disabled={busy}>
					<Icon name="megaphone" size={14} /> Buka kembali
				</button>
			{/if}
			<button class="btn btn--sm btn--ghost" type="button" onclick={() => setStatus('draft')} disabled={busy}>
				Jadikan draf
			</button>
		</div>
	{/if}

	{#if actionError}
		<p class="toast toast--err" role="alert"><Icon name="alert" size={15} /> {actionError}</p>
	{/if}
</div>

<style>
	.pp {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.status-card {
		border: 1px solid var(--line);
		border-radius: var(--r);
		padding: var(--sp-4);
		background: var(--surface-2);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.status-card--open {
		background: var(--open-soft);
		border-color: #bfe6c9;
	}
	.status-card--closed {
		background: var(--closed-soft);
		border-color: #f4c6d0;
	}
	.status-top {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.live-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--open);
		box-shadow: 0 0 0 3px rgba(21, 128, 61, 0.18);
	}
	.live-text {
		font-size: 12.5px;
		font-weight: 650;
		color: var(--open);
	}
	.status-hint {
		font-size: 13px;
		color: var(--ink-2);
		line-height: 1.5;
	}
	.warn {
		border: 1px solid #f2ddb6;
		background: var(--draft-soft);
		border-radius: var(--r);
		padding: var(--sp-3) var(--sp-4);
	}
	.warn-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		font-weight: 700;
		color: var(--draft);
		margin-bottom: 6px;
	}
	.warn ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.warn li {
		font-size: 12.5px;
		color: var(--ink-2);
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}
	.pub-btn {
		width: 100%;
		padding: 11px;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border: 1px dashed var(--line-strong);
		border-radius: var(--r);
		padding: var(--sp-3);
	}
	.detail-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--ink-3);
	}
	.token-label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-top: var(--sp-2);
	}
	.url {
		font-size: 12.5px;
		word-break: break-all;
		line-height: 1.4;
	}
	.token-box {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		background: var(--ink);
		border-radius: var(--r-sm);
		padding: 8px 8px 8px 12px;
	}
	.token {
		flex: 1;
		color: #fff;
		font-size: 15px;
		letter-spacing: 0.14em;
		font-weight: 600;
	}
	.token-box :global(.btn) {
		color: #cbd5e1;
	}
	.token-box :global(.btn:hover) {
		background: rgba(255, 255, 255, 0.12);
	}
	.status-actions {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
		justify-content: space-between;
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.confirm-btns {
		display: flex;
		gap: 6px;
	}
</style>
