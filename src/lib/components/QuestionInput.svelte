<!--
	QuestionInput.svelte — Renderer satu soal untuk halaman isi form (Modul M6).

	Menangani SEMUA 11 tipe pertanyaan (F3): short_text, long_text, radio,
	checkbox, dropdown, number, date, email, rating, scale, file.

	Komponen ini "terkendali" (controlled): menerima `value` dan memancarkan
	`change` dengan nilai baru. Bentuk nilai per tipe:
	  - short_text / long_text / email / date / dropdown / radio / file → string
	  - number / rating / scale → number
	  - checkbox → string[]

	Anti-kecurangan: tipe teks memicu callback `onpaste` agar halaman dapat
	mencatat/memblokir tempel-menempel (F14).
-->
<script lang="ts">
	import type { AnswerValue, PublicQuestion } from '$lib/form/respondent.js';

	interface Props {
		question: PublicQuestion;
		value: AnswerValue | undefined;
		disabled?: boolean;
		/** Nama field unik untuk grouping radio/checkbox. */
		name: string;
		onchange: (value: AnswerValue) => void;
		/** Dipanggil saat pengguna menempel (paste) di input teks. */
		onpaste?: () => void;
		/** Dipanggil saat pengguna menyalin (copy) dari input teks. */
		oncopy?: () => void;
	}

	let { question, value, disabled = false, name, onchange, onpaste, oncopy }: Props = $props();

	const settings = $derived(question.settings ?? {});
	const options = $derived(settings.options ?? []);

	// Batas rating/scale.
	const scaleMin = $derived(settings.min ?? 1);
	const scaleMax = $derived(settings.max ?? 5);
	const scaleValues = $derived(
		Array.from({ length: Math.max(0, scaleMax - scaleMin + 1) }, (_, i) => scaleMin + i)
	);

	const strValue = $derived(typeof value === 'string' ? value : '');
	const arrValue = $derived(Array.isArray(value) ? value : []);
	const numValue = $derived(typeof value === 'number' ? value : '');

	function setStr(v: string) {
		onchange(v);
	}
	function setNum(v: string) {
		onchange(v === '' ? null : Number(v));
	}
	function toggleCheckbox(optValue: string) {
		const cur = arrValue.slice();
		const idx = cur.indexOf(optValue);
		if (idx >= 0) cur.splice(idx, 1);
		else cur.push(optValue);
		onchange(cur);
	}
</script>

<div class="q-field" class:disabled>
	{#if question.type === 'short_text'}
		<input
			type="text"
			class="input"
			placeholder={settings.placeholder ?? ''}
			maxlength={settings.maxLength ?? undefined}
			{disabled}
			{name}
			value={strValue}
			oninput={(e) => setStr((e.currentTarget as HTMLInputElement).value)}
			onpaste={onpaste}
			oncopy={oncopy}
		/>
	{:else if question.type === 'long_text'}
		<textarea
			class="input textarea"
			placeholder={settings.placeholder ?? ''}
			maxlength={settings.maxLength ?? undefined}
			{disabled}
			{name}
			rows="5"
			value={strValue}
			oninput={(e) => setStr((e.currentTarget as HTMLTextAreaElement).value)}
			onpaste={onpaste}
			oncopy={oncopy}
		></textarea>
	{:else if question.type === 'email'}
		<input
			type="email"
			class="input"
			placeholder={settings.placeholder ?? 'nama@contoh.com'}
			{disabled}
			{name}
			value={strValue}
			oninput={(e) => setStr((e.currentTarget as HTMLInputElement).value)}
			onpaste={onpaste}
			oncopy={oncopy}
		/>
	{:else if question.type === 'date'}
		<input
			type="date"
			class="input"
			{disabled}
			{name}
			value={strValue}
			oninput={(e) => setStr((e.currentTarget as HTMLInputElement).value)}
		/>
	{:else if question.type === 'number'}
		<input
			type="number"
			class="input"
			placeholder={settings.placeholder ?? ''}
			min={settings.min ?? undefined}
			max={settings.max ?? undefined}
			step={settings.step ?? undefined}
			{disabled}
			{name}
			value={numValue}
			oninput={(e) => setNum((e.currentTarget as HTMLInputElement).value)}
		/>
	{:else if question.type === 'radio'}
		<div class="opts" role="radiogroup" aria-label={question.label}>
			{#each options as opt (opt.value)}
				<label class="opt" class:selected={strValue === opt.value}>
					<input
						type="radio"
						name={name}
						value={opt.value}
						checked={strValue === opt.value}
						{disabled}
						onchange={() => setStr(opt.value)}
					/>
					<span>{opt.label}</span>
				</label>
			{/each}
		</div>
	{:else if question.type === 'checkbox'}
		<div class="opts">
			{#each options as opt (opt.value)}
				<label class="opt" class:selected={arrValue.includes(opt.value)}>
					<input
						type="checkbox"
						name={name}
						value={opt.value}
						checked={arrValue.includes(opt.value)}
						{disabled}
						onchange={() => toggleCheckbox(opt.value)}
					/>
					<span>{opt.label}</span>
				</label>
			{/each}
		</div>
	{:else if question.type === 'dropdown'}
		<select
			class="input"
			{disabled}
			{name}
			value={strValue}
			onchange={(e) => setStr((e.currentTarget as HTMLSelectElement).value)}
		>
			<option value="" disabled={question.required} selected={strValue === ''}>
				— pilih jawaban —
			</option>
			{#each options as opt (opt.value)}
				<option value={opt.value} selected={strValue === opt.value}>{opt.label}</option>
			{/each}
		</select>
	{:else if question.type === 'rating'}
		<div class="rating" role="radiogroup" aria-label={question.label}>
			{#each scaleValues as n (n)}
				<button
					type="button"
					class="star"
					class:on={(typeof value === 'number' ? value : 0) >= n}
					aria-label={`${n} dari ${scaleMax}`}
					aria-pressed={(typeof value === 'number' ? value : 0) === n}
					{disabled}
					onclick={() => onchange(n)}
				>
					★
				</button>
			{/each}
		</div>
	{:else if question.type === 'scale'}
		<div class="scale" role="radiogroup" aria-label={question.label}>
			{#each scaleValues as n (n)}
				<button
					type="button"
					class="scale-btn"
					class:on={value === n}
					aria-pressed={value === n}
					{disabled}
					onclick={() => onchange(n)}
				>
					{n}
				</button>
			{/each}
		</div>
	{:else if question.type === 'file'}
		<input
			type="file"
			class="input"
			{disabled}
			{name}
			onchange={(e) => {
				const f = (e.currentTarget as HTMLInputElement).files?.[0];
				onchange(f ? f.name : null);
			}}
		/>
		<p class="hint">Nama berkas akan dicatat. Unggahan berkas sesungguhnya belum tersedia.</p>
	{:else}
		<input
			type="text"
			class="input"
			{disabled}
			{name}
			value={strValue}
			oninput={(e) => setStr((e.currentTarget as HTMLInputElement).value)}
		/>
	{/if}
</div>

<style>
	.q-field {
		display: block;
	}
	.disabled {
		opacity: 0.6;
		pointer-events: none;
	}
	.input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.7rem 0.9rem;
		border: 1.5px solid var(--border, #cbd5e1);
		border-radius: 10px;
		font: inherit;
		background: var(--field-bg, #fff);
		color: inherit;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
	}
	.input:focus-visible {
		outline: none;
		border-color: var(--primary, #4f46e5);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #4f46e5) 25%, transparent);
	}
	.textarea {
		resize: vertical;
		min-height: 6rem;
	}
	.opts {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 0.85rem;
		border: 1.5px solid var(--border, #cbd5e1);
		border-radius: 10px;
		cursor: pointer;
		transition: border-color 0.15s ease, background 0.15s ease;
	}
	.opt:hover {
		border-color: var(--primary, #4f46e5);
	}
	.opt.selected {
		border-color: var(--primary, #4f46e5);
		background: color-mix(in srgb, var(--primary, #4f46e5) 8%, transparent);
	}
	.opt input {
		accent-color: var(--primary, #4f46e5);
	}
	.rating {
		display: flex;
		gap: 0.25rem;
	}
	.star {
		background: none;
		border: none;
		font-size: 2rem;
		line-height: 1;
		cursor: pointer;
		color: var(--border, #cbd5e1);
		padding: 0.1rem;
		transition: color 0.12s ease, transform 0.12s ease;
	}
	.star:hover {
		transform: scale(1.12);
	}
	.star.on {
		color: #f59e0b;
	}
	.scale {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.scale-btn {
		min-width: 2.6rem;
		padding: 0.5rem 0.7rem;
		border: 1.5px solid var(--border, #cbd5e1);
		border-radius: 8px;
		background: var(--field-bg, #fff);
		color: inherit;
		cursor: pointer;
		font: inherit;
	}
	.scale-btn:hover {
		border-color: var(--primary, #4f46e5);
	}
	.scale-btn.on {
		background: var(--primary, #4f46e5);
		border-color: var(--primary, #4f46e5);
		color: #fff;
	}
	.hint {
		margin: 0.4rem 0 0;
		font-size: 0.82rem;
		color: var(--muted, #64748b);
	}
</style>
