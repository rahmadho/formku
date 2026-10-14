<script lang="ts">
	let {
		label,
		hint = '',
		id = undefined,
		children
	}: {
		label: string;
		hint?: string;
		id?: string;
		children?: import('svelte').Snippet;
	} = $props();

	const hintId = id ? `${id}-hint` : undefined;
</script>

<div class="field">
	<label class="lbl" for={id}>
		<span class="txt">{label}</span>
		{#if hint}<span class="hint" id={hintId}>{hint}</span>{/if}
	</label>
	<div class="ctl">
		{@render children?.()}
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.85rem;
	}
	.lbl {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}
	.txt {
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--ink, #1c2430);
	}
	.hint {
		font-size: 0.72rem;
		color: var(--ink-3, #6b7686);
		font-weight: 400;
	}
	.ctl {
		display: contents;
	}
</style>
