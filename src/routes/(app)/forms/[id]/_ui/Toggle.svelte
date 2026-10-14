<script lang="ts">
	let {
		checked = false,
		label = '',
		disabled = false,
		onchange = undefined
	}: {
		checked?: boolean;
		label?: string;
		disabled?: boolean;
		onchange?: (v: boolean) => void;
	} = $props();

	let id = `tg-${Math.random().toString(36).slice(2, 9)}`;
</script>

<label class="toggle" class:disabled for={id}>
	<input
		{id}
		type="checkbox"
		{checked}
		{disabled}
		onchange={(e) => onchange?.(e.currentTarget.checked)}
	/>
	<span class="track" aria-hidden="true"><span class="knob"></span></span>
	{#if label}<span class="txt">{label}</span>{/if}
</label>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
		cursor: pointer;
		user-select: none;
	}
	.toggle.disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.track {
		position: relative;
		width: 38px;
		height: 22px;
		border-radius: 999px;
		background: var(--line, #cfd6de);
		transition: background 0.18s ease;
		flex: none;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(16, 24, 40, 0.28);
		transition: transform 0.18s ease;
	}
	input:checked + .track {
		background: var(--accent, #2f5bd6);
	}
	input:checked + .track .knob {
		transform: translateX(16px);
	}
	input:focus-visible + .track {
		outline: 2px solid var(--accent, #2f5bd6);
		outline-offset: 2px;
	}
	.txt {
		font-size: 0.82rem;
		color: var(--ink-2, #39424f);
	}
	@media (prefers-reduced-motion: reduce) {
		.track,
		.knob {
			transition: none;
		}
	}
</style>
