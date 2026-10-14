<script lang="ts">
	/**
	 * SettingsPanel.svelte — Pengaturan form (Modul M5, panel inspektur).
	 *
	 * Mengelompokkan setelan berdasarkan konsekuensi, bukan urutan kolom DB:
	 *  1. Identitas publik (judul, deskripsi, slug) — apa yang dilihat responden.
	 *  2. Mode & penilaian — form/kuis/ujian, passing grade, tampilkan skor.
	 *  3. Waktu — timer form; scope per-form / per-bagian.
	 *  4. Pengacakan & keamanan — acak soal/opsi, token ujian.
	 *  5. Penutup — teks terima kasih.
	 *
	 * Setiap kontrol memanggil store.patchForm (autosave).
	 */
	import Icon from './Icon.svelte';
	import Field from './Field.svelte';
	import Toggle from './Toggle.svelte';
	import { MODE_LABEL, MODE_HINT, formatDuration } from '$lib/builder/types-meta.js';
	import { slugify } from '$lib/util/sanitize.js';
	import { FORM_MODES, type FormMode } from '$lib/types.js';
	import type { BuilderStore } from '$lib/builder/store.svelte.js';

	interface Props {
		store: BuilderStore;
	}
	let { store }: Props = $props();

	/** Timer di UI dikelola dalam MENIT (lebih ramah), disimpan sebagai detik. */
	let timerEnabled = $state((store.form?.timer_seconds ?? null) !== null);
	let timerMinutes = $state(
		store.form?.timer_seconds ? Math.max(1, Math.round(store.form.timer_seconds / 60)) : 30
	);

	// Sinkronkan bila form dimuat ulang (mis. setelah load()).
	$effect(() => {
		const secs = store.form?.timer_seconds ?? null;
		timerEnabled = secs !== null;
		if (secs) timerMinutes = Math.max(1, Math.round(secs / 60));
	});

	function applyTimer() {
		store.patchForm(
			{ timer_seconds: timerEnabled ? Math.max(1, timerMinutes) * 60 : null },
			{ immediate: true }
		);
	}

	function setMode(m: FormMode) {
		store.patchForm({ mode: m }, { immediate: true });
	}

	function setSlug(raw: string) {
		store.patchForm({ slug: slugify(raw) || store.form?.slug || 'form' }, { immediate: true });
	}

	function regenToken() {
		const rand = crypto.getRandomValues(new Uint8Array(9));
		const token = Array.from(rand, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
		store.patchForm({ access_token: token }, { immediate: true });
	}

	const form = $derived(store.form);
</script>

{#if form}
	<div class="sp">
		<!-- 1. Identitas publik -->
		<section class="block">
			<h3 class="block-title"><Icon name="link" size={15} /> Identitas publik</h3>
			<Field label="Judul form" id="set-title">
				<input
					id="set-title"
					class="input"
					value={form.title}
					oninput={(e) => store.patchForm({ title: e.currentTarget.value })}
				/>
			</Field>
			<Field label="Deskripsi" id="set-desc">
				<textarea
					id="set-desc"
					class="textarea"
					rows="2"
					value={form.description ?? ''}
					oninput={(e) => store.patchForm({ description: e.currentTarget.value })}
				></textarea>
			</Field>
			<Field label="Slug tautan publik" hint="Alamat: /f/&lt;slug&gt;" id="set-slug">
				<input
					id="set-slug"
					class="input mono"
					value={form.slug}
					spellcheck="false"
					onchange={(e) => setSlug(e.currentTarget.value)}
				/>
			</Field>
		</section>

		<hr class="dotted-rule" />

		<!-- 2. Mode & penilaian -->
		<section class="block">
			<h3 class="block-title"><Icon name="form" size={15} /> Mode & penilaian</h3>
			<div class="mode-grid" role="radiogroup" aria-label="Mode form">
				{#each FORM_MODES as m (m)}
					<button
						type="button"
						class="mode-opt"
						class:active={form.mode === m}
						role="radio"
						aria-checked={form.mode === m}
						onclick={() => setMode(m)}
					>
						<span class="mode-name">{MODE_LABEL[m]}</span>
						<span class="mode-hint">{MODE_HINT[m]}</span>
					</button>
				{/each}
			</div>

			{#if store.isExam}
				<div class="row2">
					<Field label="Passing grade (%)" hint="Ambang lulus 0–100." id="set-pass">
						<input
							id="set-pass"
							class="input num"
							type="number"
							min="0"
							max="100"
							value={form.passing_grade ?? ''}
							placeholder="mis. 70"
							onchange={(e) => {
								const v = e.currentTarget.value.trim();
								store.patchForm({ passing_grade: v === '' ? null : Math.max(0, Math.min(100, Number(v))) }, { immediate: true });
							}}
						/>
					</Field>
					<Field label="Tampilkan skor ke responden">
						<Toggle
							checked={form.show_score}
							label="Tampilkan skor"
							onchange={(v) => store.patchForm({ show_score: v }, { immediate: true })}
						/>
					</Field>
				</div>
			{/if}
		</section>

		<hr class="dotted-rule" />

		<!-- 3. Waktu -->
		<section class="block">
			<h3 class="block-title"><Icon name="calendar" size={15} /> Waktu</h3>
			<div class="toggle-row">
				<div>
					<div class="tr-title">Aktifkan timer</div>
					<div class="hint">Batas waktu pengerjaan; habis → otomatis dikirim.</div>
				</div>
				<Toggle checked={timerEnabled} label="Aktifkan timer" onchange={(v) => { timerEnabled = v; applyTimer(); }} />
			</div>

			{#if timerEnabled}
				<div class="row2">
					<Field label="Durasi (menit)" id="set-timer">
						<input
							id="set-timer"
							class="input num"
							type="number"
							min="1"
							value={timerMinutes}
							onchange={(e) => { timerMinutes = Math.max(1, Number(e.currentTarget.value) || 1); applyTimer(); }}
						/>
					</Field>
					<Field label="Cakupan timer">
						<select
							class="select"
							value={form.timer_scope}
							aria-label="Cakupan timer"
							onchange={(e) => store.patchForm({ timer_scope: e.currentTarget.value as 'form' | 'section' }, { immediate: true })}
						>
							<option value="form">Seluruh form</option>
							<option value="section">Per bagian</option>
						</select>
					</Field>
				</div>
				<p class="hint">
					Timer aktif: <strong>{formatDuration(timerEnabled ? timerMinutes * 60 : null)}</strong>
					{form.timer_scope === 'section'
						? '· hitungan berjalan per bagian (setel di tiap bagian).'
						: '· satu hitungan untuk seluruh form.'}
				</p>
			{/if}
		</section>

		<hr class="dotted-rule" />

		<!-- 4. Pengacakan & keamanan -->
		<section class="block">
			<h3 class="block-title"><Icon name="key" size={15} /> Pengacakan & keamanan</h3>
			<div class="toggle-row">
				<div>
					<div class="tr-title">Acak urutan soal</div>
					<div class="hint">Urutan berbeda untuk setiap responden.</div>
				</div>
				<Toggle
					checked={form.shuffle_questions}
					label="Acak urutan soal"
					onchange={(v) => store.patchForm({ shuffle_questions: v }, { immediate: true })}
				/>
			</div>
			<div class="toggle-row">
				<div>
					<div class="tr-title">Acak urutan opsi</div>
					<div class="hint">Urutan pilihan jawaban diacak per responden.</div>
				</div>
				<Toggle
					checked={form.shuffle_options}
					label="Acak urutan opsi"
					onchange={(v) => store.patchForm({ shuffle_options: v }, { immediate: true })}
				/>
			</div>
			<div class="toggle-row">
				<div>
					<div class="tr-title">Wajib token</div>
					<div class="hint">Responden harus memasukkan token sebelum mulai.</div>
				</div>
				<Toggle
					checked={form.require_token}
					label="Wajib token"
					onchange={(v) => store.patchForm({ require_token: v }, { immediate: true })}
				/>
			</div>
			{#if form.require_token}
				<Field label="Token ujian" hint="Dibagikan ke responden. Dibuat otomatis saat publikasi bila kosong." id="set-token">
					<div class="token-row">
						<input
							id="set-token"
							class="input mono"
							value={form.access_token ?? ''}
							placeholder="mis. UJIAN2026"
							spellcheck="false"
							onchange={(e) => store.patchForm({ access_token: e.currentTarget.value.trim() || null }, { immediate: true })}
						/>
						<button class="btn btn--sm" type="button" onclick={regenToken}>Acak</button>
					</div>
				</Field>
			{/if}
		</section>

		<hr class="dotted-rule" />

		<!-- 5. Penutup -->
		<section class="block">
			<h3 class="block-title"><Icon name="check" size={15} /> Halaman terima kasih</h3>
			<Field label="Teks penutup" hint="Ditampilkan setelah responden mengirim jawaban." id="set-thanks">
				<textarea
					id="set-thanks"
					class="textarea"
					rows="3"
					value={form.thanks_text ?? ''}
					placeholder="Terima kasih telah mengisi formulir ini."
					oninput={(e) => store.patchForm({ thanks_text: e.currentTarget.value })}
				></textarea>
			</Field>
		</section>
	</div>
{:else}
	<p class="hint">Memuat pengaturan…</p>
{/if}

<style>
	.sp {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.block-title {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 13px;
		font-weight: 700;
		color: var(--ink);
		letter-spacing: -0.01em;
	}
	.block-title :global(svg) {
		color: var(--accent);
	}
	.row2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-3);
		align-items: start;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.mode-grid {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mode-opt {
		display: flex;
		flex-direction: column;
		gap: 1px;
		text-align: left;
		padding: 9px 12px;
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
		font-size: 13.5px;
		font-weight: 650;
	}
	.mode-opt.active .mode-name {
		color: var(--accent-ink);
	}
	.mode-hint {
		font-size: 11.5px;
		color: var(--ink-3);
	}
	.toggle-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-3);
	}
	.tr-title {
		font-size: 13px;
		font-weight: 550;
	}
	.token-row {
		display: flex;
		gap: 6px;
		width: 100%;
	}
	.token-row .input {
		flex: 1;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
</style>
