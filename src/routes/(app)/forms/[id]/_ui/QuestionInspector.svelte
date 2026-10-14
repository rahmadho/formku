<script lang="ts">
	/**
	 * QuestionInspector.svelte — Editor detail satu soal (Modul M5).
	 *
	 * Menyesuaikan kontrol dengan tipe soal (metadata dari types-meta):
	 *  - teks/email/tanggal/angka: placeholder & batas numerik,
	 *  - pilihan (radio/checkbox/dropdown): daftar opsi + kunci jawaban,
	 *  - rating/skala: rentang min–max,
	 *  - file: keterangan batas unggahan (info).
	 *
	 * Semua perubahan memanggil store.patchQuestion; kunci jawaban hanya tampil
	 * untuk tipe yang dapat dinilai (isScorable).
	 */
	import Icon from './Icon.svelte';
	import Field from './Field.svelte';
	import Toggle from './Toggle.svelte';
	import { questionTypeMeta, questionTypeLabel } from '$lib/builder/types-meta.js';
	import type { BuilderStore, BQ } from '$lib/builder/store.svelte.js';
	import type { QuestionOption } from '$lib/builder/client.js';

	interface Props {
		store: BuilderStore;
		q: BQ;
	}
	let { store, q }: Props = $props();

	const meta = $derived(questionTypeMeta(q.type));

	/* ------------------------- Opsi (radio/checkbox/dropdown) ------------------------- */

	let newOption = $state('');

	function addOption() {
		const label = newOption.trim();
		if (!label) return;
		const value = uniqueValue(label, q.options);
		const options: QuestionOption[] = [...q.options, { label, value }];
		store.patchQuestion(q.id, { options, settings: { ...q.settings, options } }, true);
		newOption = '';
	}

	function uniqueValue(label: string, existing: QuestionOption[]): string {
		const base = label.slice(0, 40);
		let v = base;
		let n = 2;
		while (existing.some((o) => o.value === v)) v = `${base} ${n++}`;
		return v;
	}

	function updateOption(i: number, label: string) {
		const options = q.options.map((o, idx) => (idx === i ? { ...o, label } : o));
		// Bila label opsi yang jadi kunci berubah, jaga kunci tetap sinkron via value (value tak berubah).
		store.patchQuestion(q.id, { options, settings: { ...q.settings, options } }, false);
	}

	function removeOption(i: number) {
		const removed = q.options[i];
		const options = q.options.filter((_, idx) => idx !== i);
		// Bersihkan kunci bila opsi yang dihapus adalah kunci.
		let correct = q.correct;
		if (correct && removed) {
			if (Array.isArray(correct.values)) {
				const values = correct.values.map(String).filter((v) => v !== removed.value);
				correct = values.length ? { values } : null;
			} else if (String(correct.value) === removed.value) {
				correct = null;
			}
		}
		store.patchQuestion(
			q.id,
			{ options, settings: { ...q.settings, options }, correct },
			true
		);
	}

	/* ------------------------- Kunci jawaban ------------------------- */

	function isKeyed(value: string): boolean {
		const c = q.correct;
		if (!c) return false;
		if (Array.isArray(c.values)) return c.values.map(String).includes(value);
		return c.value !== undefined && c.value !== null && String(c.value) === value;
	}

	function toggleKey(value: string) {
		if (meta.multiKey) {
			const cur = (q.correct?.values ?? []).map(String);
			const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
			store.patchQuestion(q.id, { correct: next.length ? { values: next } : null }, true);
		} else {
			const next = isKeyed(value) ? null : { value };
			store.patchQuestion(q.id, { correct: next }, true);
		}
	}

	/* Kunci jawaban untuk tipe teks/angka/skala: input nilai. */
	function setScalarKey(raw: string) {
		let correct: BQ['correct'] = null;
		if (raw.trim() !== '') {
			correct = q.type === 'number' || q.type === 'scale' ? { value: Number(raw) } : { value: raw };
		}
		store.patchQuestion(q.id, { correct }, true);
	}

	/** Perbarui satu kunci settings_json (min/max/placeholder). */
	function setSetting(key: 'min' | 'max' | 'placeholder', raw: string) {
		const next = { ...q.settings };
		if (raw.trim() === '') {
			delete next[key];
		} else if (key === 'placeholder') {
			next.placeholder = raw.slice(0, 200);
		} else {
			const n = Number(raw);
			if (Number.isFinite(n)) next[key] = n;
		}
		store.patchQuestion(q.id, { settings: next }, true);
	}
</script>

<div class="qi">
	<!-- Kepala: tipe -->
	<div class="qi-head">
		<div class="qi-type-badge">{questionTypeLabel(q.type)}</div>
		{#if q.pending}<span class="hint">menyimpan…</span>{/if}
	</div>

	<Field label="Pertanyaan" id={`qi-label-${q.id}`}>
		<textarea
			id={`qi-label-${q.id}`}
			class="textarea"
			rows="2"
			value={q.label}
			placeholder="Tulis pertanyaan…"
			oninput={(e) => store.patchQuestion(q.id, { label: e.currentTarget.value })}
		></textarea>
	</Field>

	<Field label="Teks bantuan" hint="Muncul di bawah pertanyaan sebagai petunjuk." id={`qi-help-${q.id}`}>
		<input
			id={`qi-help-${q.id}`}
			class="input"
			value={q.help_text ?? ''}
			placeholder="mis. Pilih satu jawaban yang paling tepat"
			oninput={(e) => store.patchQuestion(q.id, { help_text: e.currentTarget.value })}
		/>
	</Field>

	<div class="row2">
		<Field label="Wajib dijawab">
			<Toggle
				checked={q.required}
				label="Wajib dijawab"
				onchange={(v) => store.patchQuestion(q.id, { required: v }, true)}
			/>
		</Field>
		<Field label="Poin" id={`qi-points-${q.id}`}>
			<input
				id={`qi-points-${q.id}`}
				class="input num"
				type="number"
				min="0"
				step="1"
				value={q.points}
				onchange={(e) => store.patchQuestion(q.id, { points: Number(e.currentTarget.value) || 0 }, true)}
			/>
		</Field>
	</div>

	<!-- ---------------- Kontrol per tipe ---------------- -->

	{#if meta.hasOptions}
		<hr class="dotted-rule" />
		<div class="group">
			<div class="group-head">
				<span class="group-title">Opsi jawaban</span>
				<span class="hint">{q.options.length} opsi</span>
			</div>

			{#if meta.multiKey}
				<p class="keynote"><Icon name="key" size={13} /> Centang opsi yang jadi kunci (boleh lebih dari satu).</p>
			{:else}
				<p class="keynote"><Icon name="key" size={13} /> Tandai satu opsi sebagai kunci jawaban.</p>
			{/if}

			<ul class="opt-list">
				{#each q.options as opt, i (opt.value)}
					<li class="opt-row" class:keyed={isKeyed(opt.value)}>
						<button
							class="key-btn"
							type="button"
							aria-pressed={isKeyed(opt.value)}
							title={isKeyed(opt.value) ? 'Kunci jawaban' : 'Jadikan kunci'}
							onclick={() => toggleKey(opt.value)}
						>
							<Icon name="check" size={13} />
						</button>
						<input
							class="opt-input"
							value={opt.label}
							aria-label="Label opsi {i + 1}"
							oninput={(e) => updateOption(i, e.currentTarget.value)}
						/>
						<button
							class="opt-del"
							type="button"
							aria-label="Hapus opsi {i + 1}"
							onclick={() => removeOption(i)}
						>
							<Icon name="trash" size={14} />
						</button>
					</li>
				{/each}
			</ul>

			<div class="opt-add">
				<input
					class="input"
					bind:value={newOption}
					placeholder="Tambah opsi…"
					aria-label="Opsi baru"
					onkeydown={(e) => {
						if (e.key === 'Enter') { e.preventDefault(); addOption(); }
					}}
				/>
				<button class="btn btn--sm" type="button" onclick={addOption} disabled={!newOption.trim()}>
					<Icon name="plus" size={14} /> Tambah
				</button>
			</div>
		</div>
	{:else if meta.singleKey && (q.type === 'number' || q.type === 'short_text' || q.type === 'scale')}
		<hr class="dotted-rule" />
		<div class="group">
			<div class="group-head"><span class="group-title">Kunci jawaban</span></div>
			<p class="keynote"><Icon name="key" size={13} /> Jawaban dianggap benar bila cocok dengan nilai ini.</p>
			<input
				class="input"
				value={q.correct?.value ?? ''}
				placeholder={q.type === 'number' ? 'mis. 42' : 'mis. Jakarta'}
				aria-label="Kunci jawaban"
				onchange={(e) => setScalarKey(e.currentTarget.value)}
			/>
		</div>
	{/if}

	{#if meta.hasRange}
		<hr class="dotted-rule" />
		<div class="group">
			<div class="group-head"><span class="group-title">Rentang nilai</span></div>
			<div class="row2">
				<Field label="Minimum" id={`qi-min-${q.id}`}>
					<input
						id={`qi-min-${q.id}`}
						class="input num"
						type="number"
						value={q.settings.min ?? ''}
						placeholder={q.type === 'scale' ? '1' : '0'}
						onchange={(e) => setSetting('min', e.currentTarget.value)}
					/>
				</Field>
				<Field label="Maksimum" id={`qi-max-${q.id}`}>
					<input
						id={`qi-max-${q.id}`}
						class="input num"
						type="number"
						value={q.settings.max ?? ''}
						placeholder={q.type === 'rating' ? '5' : '10'}
						onchange={(e) => setSetting('max', e.currentTarget.value)}
					/>
				</Field>
			</div>
			{#if q.type === 'scale' || q.type === 'rating'}
				<p class="hint">
					Rating/skala menampilkan {numOr(q.settings.min, q.type === 'scale' ? 1 : 1)} hingga
					{numOr(q.settings.max, 5)} pilihan.
				</p>
			{/if}
		</div>
	{/if}

	{#if q.type === 'short_text' || q.type === 'long_text'}
		<hr class="dotted-rule" />
		<Field label="Placeholder" id={`qi-ph-${q.id}`}>
			<input
				id={`qi-ph-${q.id}`}
				class="input"
				value={(q.settings.placeholder as string) ?? ''}
				placeholder="Teks contoh di dalam kotak jawaban"
				oninput={(e) => setSetting('placeholder', e.currentTarget.value)}
			/>
		</Field>
	{/if}

	{#if q.type === 'file'}
		<hr class="dotted-rule" />
		<p class="note">
			<Icon name="alert" size={14} />
			Unggahan berkas berjalan sebagai referensi teks pada tahap ini; integrasi penyimpanan
			berkas ditangani modul terpisah.
		</p>
	{/if}
</div>

<script lang="ts" module>
	/** Baca angka aman atau fallback. */
	export function numOr(v: unknown, fallback: number): number {
		const n = Number(v);
		return Number.isFinite(n) && v !== undefined && v !== null && v !== '' ? n : fallback;
	}
</script>

<style>
	.qi {
		display: flex;
		flex-direction: column;
		gap: var(--sp-4);
	}
	.qi-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.qi-type-badge {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-ink);
		font-size: 12px;
		font-weight: 700;
		border: 1px solid var(--accent-line);
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
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--sp-3);
	}
	.group-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.group-title {
		font-size: 12.5px;
		font-weight: 700;
		color: var(--ink-2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.keynote {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--ink-3);
		background: var(--surface-2);
		border-radius: var(--r-sm);
		padding: 6px 9px;
	}
	.opt-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.opt-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.key-btn {
		flex: 0 0 auto;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--ink-faint);
		transition: all var(--dur) var(--ease);
	}
	.key-btn:hover {
		border-color: var(--open);
		color: var(--open);
	}
	.opt-row.keyed .key-btn {
		background: var(--open);
		border-color: var(--open);
		color: #fff;
	}
	.opt-input {
		flex: 1;
		min-width: 0;
		padding: 7px 10px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--surface);
	}
	.opt-input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.opt-row.keyed .opt-input {
		border-color: #bfe6c9;
		background: var(--open-soft);
	}
	.opt-del {
		flex: 0 0 auto;
		width: 26px;
		height: 26px;
		display: grid;
		place-items: center;
		border: 0;
		background: transparent;
		border-radius: var(--r-sm);
		color: var(--ink-faint);
	}
	.opt-del:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.opt-add {
		display: flex;
		gap: 6px;
	}
	.opt-add .input {
		flex: 1;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		font-size: 12.5px;
		color: var(--ink-3);
		background: var(--draft-soft);
		border: 1px solid #f2ddb6;
		border-radius: var(--r-sm);
		padding: 8px 10px;
		line-height: 1.45;
	}
</style>
