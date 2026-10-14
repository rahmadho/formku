<!--
	+page.svelte — Halaman isi form responden (Modul M6) untuk route /f/[slug].

	Mencakup:
	  - F10 Isi form (responden, tanpa login) + validasi wajib
	  - F4  Navigasi antar-section (next/prev) + progress
	  - F5  Timer (per-form ATAU per-section), auto-submit saat habis, sisa waktu
	  - F13 Token ujian (bila require_token)
	  - F14 Anti-kecurangan: deteksi blur/paste/copy → audit; kunci setelah submit
	  - F17 Logika kondisional (tampil/sembunyikan soal)
	  - F19 Halaman terima kasih (+ skor bila show_score)

	Semua data awal datang dari +page.server.ts yang SUDAH membuang kunci
	jawaban (correct_json). Komponen ini tidak pernah menerima kunci.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import QuestionInput from '$lib/components/QuestionInput.svelte';
	import {
		buildSectionViews,
		countAnswered,
		findValidationIssues,
		formDeadline,
		formatDuration,
		isQuestionVisible,
		remainingSeconds,
		sectionDeadline,
		toSubmitAnswers,
		TIMER_WARN_SECONDS,
		type AnswerMap,
		type AnswerValue,
		type PublicCondition,
		type PublicForm,
		type PublicQuestion,
		type PublicSection
	} from '$lib/form/respondent.js';

	const data = $derived(page.data);
	const form = $derived(data.form as PublicForm);
	const sections = $derived(data.sections as PublicSection[]);
	const questions = $derived(data.questions as PublicQuestion[]);
	const conditions = $derived(data.conditions as PublicCondition[]);
	const slug = $derived(data.form.slug as string);

	/* ---------------------------------------------------------------- */
	/* Fase halaman: intro → mengerjakan → selesai                      */
	/* ---------------------------------------------------------------- */
	type Phase = 'intro' | 'filling' | 'done';
	let phase = $state<Phase>('intro');

	/* Identitas responden (gate) */
	let respondentName = $state('');
	let respondentEmail = $state('');
	let tokenInput = $state('');
	let gateError = $state('');
	let starting = $state(false);

	/* Sesi */
	let responseId = $state<number | null>(null);

	/* Jawaban: peta question_id → nilai */
	let answers = $state<AnswerMap>({});

	/* Navigasi section */
	let currentIndex = $state(0);

	/* Timer */
	let startedAtMs = $state<number>(0);
	let sectionActivatedAtMs = $state<number>(0);
	let nowMs = $state<number>(0);
	let tick: ReturnType<typeof setInterval> | null = null;
	let autoSubmitting = $state(false);

	/* Submit & hasil */
	let submitting = $state(false);
	let submitError = $state('');
	let result = $state<{
		score?: number;
		max_score?: number;
		percent?: number;
		passed?: boolean;
		show_score: boolean;
		thanks_text: string | null;
	} | null>(null);

	/* Anti-kecurangan (F14) */
	let blurCount = $state(0);
	let pasteCount = $state(0);
	let copyCount = $state(0);
	let warning = $state('');

	/* ---------------------------------------------------------------- */
	/* Turunan                                                          */
	/* ---------------------------------------------------------------- */
	const sectionViews = $derived(buildSectionViews(sections, questions));
	const currentSection = $derived(sectionViews[Math.min(currentIndex, sectionViews.length - 1)]);
	const isLastSection = $derived(currentIndex >= sectionViews.length - 1);
	const progress = $derived(countAnswered(questions, answers, conditions));
	const visibleInSection = $derived(
		(currentSection?.questions ?? []).filter((q) => isQuestionVisible(q, answers, conditions))
	);

	const formDeadlineMs = $derived(formDeadline(form, startedAtMs));
	const sectionDeadlineMs = $derived(
		form.timer_scope === 'section' && currentSection
			? sectionDeadline(currentSection, sectionActivatedAtMs)
			: null
	);
	const effectiveDeadlineMs = $derived(
		form.timer_scope === 'section' ? sectionDeadlineMs : formDeadlineMs
	);
	const secondsLeft = $derived(
		effectiveDeadlineMs === null ? null : remainingSeconds(effectiveDeadlineMs, nowMs)
	);
	const timerActive = $derived(secondsLeft !== null);
	const timerWarn = $derived(secondsLeft !== null && secondsLeft <= TIMER_WARN_SECONDS);

	const hasTimer = $derived(
		(form.timer_scope === 'form' && !!form.timer_seconds) ||
			(form.timer_scope === 'section' && sectionViews.some((s) => !!s.timer_seconds))
	);

	/* Theme warna (F19) — hanya warna aman yang diterapkan, bukan CSS bebas. */
	const themeStyle = $derived.by(() => {
		const t = (form.theme ?? {}) as Record<string, unknown>;
		const out: string[] = [];
		const primary = typeof t.primary === 'string' ? t.primary : '';
		if (/^#[0-9a-f]{3,8}$/i.test(primary)) out.push(`--primary: ${primary}`);
		const font = typeof t.font === 'string' ? t.font : '';
		if (font && /^[\w\s,'-]+$/.test(font)) out.push(`--font-family: ${font}`);
		return out.join('; ');
	});

	/* ---------------------------------------------------------------- */
	/* Siklus hidup timer + anti-kecurangan                             */
	/* ---------------------------------------------------------------- */
	onMount(() => {
		tick = setInterval(() => {
			nowMs = Date.now();
		}, 250);

		// Anti-kecurangan berbasis visibilitas halaman.
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('blur', onWindowBlur);
		window.addEventListener('focus', onWindowFocus);
		window.addEventListener('beforeunload', onBeforeUnload);

		// Bila diarahkan dengan ?r= (lanjutkan sesi yang belum submit).
		const s = data.session as { response_id: number; status: string } | null;
		if (s && s.status === 'in_progress') {
			responseId = s.response_id;
			startedAtMs = Date.now();
			sectionActivatedAtMs = Date.now();
			phase = 'filling';
		}
	});

	onDestroy(() => {
		if (tick) clearInterval(tick);
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
		if (typeof window !== 'undefined') {
			window.removeEventListener('blur', onWindowBlur);
			window.removeEventListener('focus', onWindowFocus);
			window.removeEventListener('beforeunload', onBeforeUnload);
		}
	});

	function reportEvent(type: 'blur' | 'paste' | 'copy' | 'focus_return') {
		if (!responseId) return;
		// Kirim tanpa menunggu (fire-and-forget); kegagalan tak menghambat UX.
		void fetch(`/api/public/forms/${encodeURIComponent(slug)}/event`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ response_id: responseId, event_type: type })
		}).catch(() => {});
	}

	let hiddenAt = 0;
	function onVisibility() {
		if (phase !== 'filling') return;
		if (document.hidden) {
			hiddenAt = Date.now();
			blurCount++;
			reportEvent('blur');
		} else {
			reportEvent('focus_return');
			if (hiddenAt && Date.now() - hiddenAt > 1000) {
				warning = 'Anda terdeteksi meninggalkan halaman ujian. Aktivitas ini dicatat.';
			}
		}
	}

	function onWindowBlur() {
		if (phase !== 'filling') return;
		blurCount++;
		reportEvent('blur');
	}

	function onWindowFocus() {
		if (phase !== 'filling') return;
		reportEvent('focus_return');
	}

	function onBeforeUnload(e: BeforeUnloadEvent) {
		if (phase === 'filling') {
			e.preventDefault();
			e.returnValue = '';
		}
	}

	function onPaste() {
		if (phase !== 'filling') return;
		pasteCount++;
		warning = 'Menempelkan (paste) teks terdeteksi dan dicatat.';
		reportEvent('paste');
	}

	function onCopy() {
		if (phase !== 'filling') return;
		copyCount++;
		warning = 'Menyalin (copy) konten terdeteksi dan dicatat.';
		reportEvent('copy');
	}

	/* ---------------------------------------------------------------- */
	/* Timer habis → auto-submit                                        */
	/* ---------------------------------------------------------------- */
	let autoSubmitFired = false;
	function maybeAutoSubmit() {
		if (phase !== 'filling') return;
		if (secondsLeft !== 0) return;
		if (autoSubmitFired || autoSubmitting) return;
		if (form.timer_scope === 'section' && !isLastSection) {
			// Timer section habis → paksa maju ke section berikutnya.
			autoSubmitFired = false;
			advanceSection(true);
			return;
		}
		autoSubmitFired = true;
		autoSubmitting = true;
		warning = 'Waktu habis. Jawaban Anda dikirim otomatis.';
		void doSubmit(true);
	}

	// Reaktif: periksa auto-submit setiap kali `secondsLeft` berubah.
	$effect(() => {
		const s = secondsLeft;
		if (s === 0) maybeAutoSubmit();
	});

	/* ---------------------------------------------------------------- */
	/* Aksi                                                            */
	/* ---------------------------------------------------------------- */
	async function start() {
		gateError = '';
		if (form.require_token && !tokenInput.trim()) {
			gateError = 'Token ujian wajib diisi.';
			return;
		}
		starting = true;
		try {
			const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}/start`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: respondentName.trim() || undefined,
					email: respondentEmail.trim() || undefined,
					token: form.require_token ? tokenInput.trim() : undefined
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				gateError = body?.message ?? body?.error ?? `Gagal memulai (${res.status}).`;
				return;
			}
			responseId = body.response_id ?? null;
			startedAtMs = Date.now();
			sectionActivatedAtMs = Date.now();
			nowMs = Date.now();
			phase = 'filling';
			// Simpan response_id di URL agar refresh melanjutkan sesi yang sama
			// (urutan soal stabil, seed memakai response_id).
			if (responseId) {
				const url = new URL(location.href);
				url.searchParams.set('r', String(responseId));
				history.replaceState(null, '', url.toString());
			}
		} catch {
			gateError = 'Tidak dapat terhubung ke server. Coba lagi.';
		} finally {
			starting = false;
		}
	}

	function advanceSection(force = false) {
		if (!force && phase !== 'filling') return;
		if (isLastSection) return;
		currentIndex = Math.min(currentIndex + 1, sectionViews.length - 1);
		sectionActivatedAtMs = Date.now();
		nowMs = Date.now();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function prevSection() {
		if (currentIndex <= 0) return;
		currentIndex = Math.max(currentIndex - 1, 0);
		sectionActivatedAtMs = Date.now();
		nowMs = Date.now();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	async function submit() {
		submitError = '';
		const issues = findValidationIssues(questions, answers, conditions);
		if (issues.length) {
			// Loncat ke section yang bermasalah.
			const first = issues[0];
			if (first.section_id !== null) {
				const idx = sectionViews.findIndex((s) => s.id === first.section_id);
				if (idx >= 0) currentIndex = idx;
			}
			submitError = `${issues.length} pertanyaan wajib belum dijawab.`;
			return;
		}
		await doSubmit(false);
	}

	async function doSubmit(fromTimer: boolean) {
		if (submitting || !responseId) return;
		submitting = true;
		submitError = '';
		try {
			const payload = {
				response_id: responseId,
				answers: toSubmitAnswers(questions, answers, conditions)
			};
			const res = await fetch(`/api/public/forms/${encodeURIComponent(slug)}/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) {
				submitError = fromTimer
					? 'Waktu habis, tetapi pengiriman gagal. Coba muat ulang.'
					: body?.message ?? body?.error ?? `Gagal mengirim (${res.status}).`;
				autoSubmitting = false;
				autoSubmitFired = false;
				return;
			}
			result = {
				score: body.score,
				max_score: body.max_score,
				percent: body.percent,
				passed: body.passed,
				show_score: body.show_score ?? form.show_score,
				thanks_text: body.thanks_text ?? form.thanks_text
			};
			phase = 'done';
			if (tick) {
				clearInterval(tick);
				tick = null;
			}
			window.scrollTo({ top: 0, behavior: 'smooth' });
		} catch {
			submitError = 'Tidak dapat terhubung ke server saat mengirim. Coba lagi.';
			autoSubmitting = false;
			autoSubmitFired = false;
		} finally {
			submitting = false;
		}
	}

	function setAnswer(qid: number, v: AnswerValue) {
		answers = { ...answers, [qid]: v };
	}
</script>

<svelte:head>
	<title>{form.title} — FormKu</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="page" style={themeStyle} data-phase={phase}>
	{#if phase === 'intro'}
		<!-- ============ GATE / INTRO ============ -->
		<div class="card intro">
			<p class="eyebrow">FormKu · {form.mode === 'exam' ? 'Ujian' : form.mode === 'quiz' ? 'Kuis' : 'Formulir'}</p>
			<h1>{form.title}</h1>
			{#if form.description}
				<p class="desc">{form.description}</p>
			{/if}

			<ul class="meta">
				<li>{questions.length} pertanyaan</li>
				{#if sectionViews.length > 1}
					<li>{sectionViews.length} bagian</li>
				{/if}
				{#if hasTimer}
					<li>
						{form.timer_scope === 'section' ? 'Timer per bagian' : `Waktu ${formatDuration(form.timer_seconds ?? 0)}`}
					</li>
				{/if}
				{#if form.shuffle_questions}<li>Soal diacak</li>{/if}
			</ul>

			<div class="gate">
				<label>
					<span>Nama Anda</span>
					<input type="text" bind:value={respondentName} placeholder="Nama lengkap" maxlength="120" />
				</label>
				<label>
					<span>Email <em>(opsional)</em></span>
					<input type="email" bind:value={respondentEmail} placeholder="nama@contoh.com" />
				</label>
				{#if form.require_token}
					<label>
						<span>Token ujian <b class="req">*</b></span>
						<input
							type="text"
							bind:value={tokenInput}
							placeholder="Masukkan token dari pengawas"
							autocomplete="off"
						/>
					</label>
				{/if}
			</div>

			{#if gateError}
				<p class="alert error" role="alert">{gateError}</p>
			{/if}

			<button class="btn primary big" onclick={start} disabled={starting}>
				{starting ? 'Memulai…' : 'Mulai Mengerjakan'}
			</button>
			{#if hasTimer}
				<p class="hint center">Waktu mulai berjalan setelah Anda menekan tombol di atas.</p>
			{/if}
		</div>
	{:else if phase === 'filling'}
		<!-- ============ MENGERJAKAN ============ -->
		<header class="bar">
			<div class="bar-left">
				<h1 class="bar-title">{form.title}</h1>
				{#if sectionViews.length > 1}
					<p class="bar-sub">
						Bagian {Math.min(currentIndex + 1, sectionViews.length)} dari {sectionViews.length}
					</p>
				{/if}
			</div>
			{#if timerActive}
				<div class="timer" class:warn={timerWarn} aria-live="polite" aria-label="Sisa waktu">
					<span class="timer-ico" aria-hidden="true">⏱</span>
					<span class="timer-val">{formatDuration(secondsLeft ?? 0)}</span>
				</div>
			{/if}
		</header>

		<div class="progress-track" aria-hidden="true">
			<div
				class="progress-fill"
				style="width: {progress.total ? (progress.answered / progress.total) * 100 : 0}%"
			></div>
		</div>
		<p class="progress-text">
			{progress.answered} / {progress.total} terjawab
			{#if sectionViews.length > 1}
				· {sectionViews.length} bagian
			{/if}
		</p>

		{#if warning}
			<div class="alert warn" role="alert">
				<span>⚠</span> {warning}
				<button class="alert-close" onclick={() => (warning = '')} aria-label="Tutup peringatan">×</button>
			</div>
		{/if}

		{#if currentSection}
			<section class="card section" aria-labelledby="sec-title">
				{#if currentSection.title}
					<h2 id="sec-title">{currentSection.title}</h2>
				{/if}
				{#if currentSection.description}
					<p class="desc">{currentSection.description}</p>
				{/if}

				{#if visibleInSection.length === 0}
					<p class="empty">Tidak ada pertanyaan pada bagian ini.</p>
				{/if}

				{#each visibleInSection as q (q.id)}
					<div class="question" class:has-error={submitError && q.required && !answers[q.id]}>
						<div class="q-head">
							<p class="q-label">
								{q.label}
								{#if q.required}<b class="req" title="Wajib dijawab">*</b>{/if}
							</p>
							{#if q.points > 0}
								<span class="q-points">{q.points} poin</span>
							{/if}
						</div>
						{#if q.help_text}
							<p class="q-help">{q.help_text}</p>
						{/if}
						<QuestionInput
							question={q}
							value={answers[q.id]}
							name={`q-${q.id}`}
							onchange={(v) => setAnswer(q.id, v)}
							onpaste={onPaste}
							oncopy={onCopy}
						/>
					</div>
				{/each}
			</section>
		{/if}

		{#if submitError}
			<p class="alert error" role="alert">{submitError}</p>
		{/if}

		<nav class="nav">
			<button class="btn ghost" onclick={prevSection} disabled={currentIndex === 0}>← Sebelumnya</button>
			{#if isLastSection}
				<button class="btn primary" onclick={submit} disabled={submitting || autoSubmitting}>
					{submitting ? 'Mengirim…' : 'Kirim Jawaban'}
				</button>
			{:else}
				<button class="btn primary" onclick={() => advanceSection(false)}>Berikutnya →</button>
			{/if}
		</nav>
	{:else}
		<!-- ============ TERIMA KASIH ============ -->
		<div class="card thanks">
			<div class="check" aria-hidden="true">✓</div>
			<h1>Terima Kasih</h1>
			{#if result?.thanks_text}
				<p class="desc">{result.thanks_text}</p>
			{:else}
				<p class="desc">Jawaban Anda telah tersimpan.</p>
			{/if}

			{#if result?.show_score && typeof result.score === 'number'}
				<div class="scorecard">
					<p class="score-big">
						{result.score}<span class="score-slash">/</span>{result.max_score}
					</p>
					{#if typeof result.percent === 'number'}
						<p class="score-pct">{result.percent}%</p>
					{/if}
					{#if typeof result.passed === 'boolean'}
						<p class="verdict" class:pass={result.passed} class:fail={!result.passed}>
							{result.passed ? '✓ LULUS' : '✗ BELUM LULUS'}
						</p>
					{/if}
				</div>
			{/if}

			<p class="hint center">Jendela ini dapat ditutup.</p>
		</div>
	{/if}
</div>

<style>
	.page {
		--primary: #4f46e5;
		--border: #cbd5e1;
		--muted: #64748b;
		--bg: #f8fafc;
		--field-bg: #ffffff;
		min-height: 100vh;
		background: var(--bg);
		color: #0f172a;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.85rem;
		font-family: var(--font-family, system-ui, -apple-system, Segoe UI, Roboto, sans-serif);
	}
	.card {
		width: 100%;
		max-width: 640px;
		background: #fff;
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 1.6rem;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
	}
	.eyebrow {
		margin: 0 0 0.35rem;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--primary);
	}
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.6rem;
		line-height: 1.25;
	}
	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.2rem;
	}
	.desc {
		margin: 0 0 1rem;
		color: #334155;
		line-height: 1.55;
		white-space: pre-wrap;
	}
	.meta {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0;
		margin: 0 0 1.4rem;
	}
	.meta li {
		font-size: 0.8rem;
		background: #eef2ff;
		color: #3730a3;
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
	}
	.gate {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin-bottom: 1.2rem;
	}
	.gate label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.9rem;
		font-weight: 600;
	}
	.gate label em {
		font-weight: 400;
		font-style: normal;
		color: var(--muted);
	}
	.gate input {
		padding: 0.7rem 0.9rem;
		border: 1.5px solid var(--border);
		border-radius: 10px;
		font: inherit;
		font-weight: 400;
	}
	.gate input:focus-visible {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent);
	}
	.req {
		color: #dc2626;
	}
	.btn {
		font: inherit;
		font-weight: 600;
		border-radius: 10px;
		padding: 0.7rem 1.2rem;
		cursor: pointer;
		border: 1.5px solid transparent;
		transition: transform 0.08s ease, background 0.15s ease, opacity 0.15s ease;
	}
	.btn:active {
		transform: translateY(1px);
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.btn.primary {
		background: var(--primary);
		color: #fff;
	}
	.btn.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--primary) 88%, #000);
	}
	.btn.ghost {
		background: #fff;
		border-color: var(--border);
		color: #334155;
	}
	.btn.ghost:hover:not(:disabled) {
		border-color: var(--primary);
		color: var(--primary);
	}
	.btn.big {
		width: 100%;
		padding: 0.9rem;
		font-size: 1.05rem;
	}
	.hint {
		font-size: 0.82rem;
		color: var(--muted);
		margin: 0.7rem 0 0;
	}
	.center {
		text-align: center;
	}
	.alert {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 10px;
		padding: 0.7rem 0.9rem;
		font-size: 0.9rem;
		margin: 0 0 0.9rem;
	}
	.alert.error {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
	}
	.alert.warn {
		background: #fffbeb;
		color: #92400e;
		border: 1px solid #fde68a;
		width: 100%;
		max-width: 640px;
	}
	.alert-close {
		margin-left: auto;
		background: none;
		border: none;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		color: inherit;
	}
	.bar {
		width: 100%;
		max-width: 640px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.bar-title {
		margin: 0;
		font-size: 1.05rem;
	}
	.bar-sub {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	.timer {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		background: #eef2ff;
		color: #3730a3;
		padding: 0.45rem 0.8rem;
		border-radius: 10px;
	}
	.timer.warn {
		background: #fef2f2;
		color: #b91c1c;
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.timer.warn {
			animation: none;
		}
	}
	.progress-track {
		width: 100%;
		max-width: 640px;
		height: 6px;
		background: #e2e8f0;
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: var(--primary);
		border-radius: 999px;
		transition: width 0.3s ease;
	}
	.progress-text {
		width: 100%;
		max-width: 640px;
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.section {
		padding: 1.4rem 1.6rem;
	}
	.empty {
		color: var(--muted);
		font-style: italic;
	}
	.question {
		padding: 0.9rem 0;
		border-bottom: 1px solid #f1f5f9;
	}
	.question:last-child {
		border-bottom: none;
	}
	.q-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}
	.q-label {
		margin: 0 0 0.55rem;
		font-weight: 600;
		line-height: 1.45;
	}
	.q-points {
		flex: none;
		font-size: 0.72rem;
		color: var(--muted);
		background: #f1f5f9;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
	}
	.q-help {
		margin: -0.2rem 0 0.6rem;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.nav {
		width: 100%;
		max-width: 640px;
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
	}
	.thanks {
		text-align: center;
		padding: 2.2rem 1.6rem;
	}
	.check {
		width: 64px;
		height: 64px;
		margin: 0 auto 1rem;
		border-radius: 50%;
		background: #dcfce7;
		color: #16a34a;
		font-size: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
	}
	.scorecard {
		margin: 1.2rem auto 0;
		padding: 1.2rem;
		background: #f8fafc;
		border: 1px solid var(--border);
		border-radius: 14px;
		max-width: 320px;
	}
	.score-big {
		margin: 0;
		font-size: 2.2rem;
		font-weight: 800;
		color: var(--primary);
	}
	.score-slash {
		color: var(--muted);
		font-weight: 400;
		margin: 0 0.15rem;
	}
	.score-pct {
		margin: 0.2rem 0;
		font-size: 1.1rem;
		font-weight: 600;
	}
	.verdict {
		margin: 0.6rem 0 0;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.verdict.pass {
		color: #16a34a;
	}
	.verdict.fail {
		color: #dc2626;
	}
	@media (max-width: 480px) {
		.page {
			padding: 0.75rem;
		}
		.card {
			padding: 1.2rem;
		}
	}
</style>
