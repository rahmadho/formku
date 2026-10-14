/**
 * store.svelte.ts — State pusat UI Builder (Modul M5).
 *
 * Satu sumber kebenaran untuk: metadata form, pohon section+soal, pilihan yang
 * sedang aktif (section/soal), status penyimpanan, dan pesan galat. Dikonsumsi
 * oleh semua panel editor lewat konteks Svelte (lihat BuilderShell).
 *
 * Prinsip desain:
 *  - MUTASI OPTIMISTIS: UI diubah lebih dulu, lalu disinkronkan ke server; jika
 *    server menolak, state lokal dikembalikan (rollback) + galat ditampilkan.
 *  - SIMPAN TERTUNDA (debounce) untuk pengeditan teks agar tidak membanjiri API.
 *  - ID sementara (`tmp-…`) untuk entitas yang belum tersimpan, diganti id asli
 *    setelah respons server.
 *
 * Modul ini memakai runes (`$state`, `$derived`) sehingga HARUS berekstensi
 * `.svelte.ts` agar dikompilasi Svelte.
 */
import { CreatorApi, ApiClientError, type FormRow, type QuestionRow, type SectionRow, type QuestionOption, type CorrectJson } from './client.js';
import type { CreatorSession } from './session.js';
import type { FormMode, QuestionType } from '$lib/types.js';

/** Soal dalam store (selalu punya id; gunakan negatif untuk yang belum tersimpan). */
export interface BQ {
	id: number;
	section_id: number | null;
	type: QuestionType;
	label: string;
	help_text: string | null;
	required: boolean;
	points: number;
	options: QuestionOption[];
	correct: CorrectJson | null;
	settings: Record<string, unknown>;
	sort: number;
	/** true bila belum pernah tersimpan ke server. */
	pending?: boolean;
}

export interface BSection {
	id: number;
	title: string;
	description: string | null;
	sort: number;
	timer_seconds: number | null;
	questions: BQ[];
	pending?: boolean;
}

/** Status sinkronisasi ke server. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

let tmpSeq = -1;
const nextTmpId = () => tmpSeq--;

/** Ubah QuestionRow API → BQ store. */
function toBQ(q: QuestionRow): BQ {
	const s = (q.settings_json ?? {}) as Record<string, unknown>;
	return {
		id: q.id,
		section_id: q.section_id,
		type: q.type as QuestionType,
		label: q.label,
		help_text: q.help_text,
		required: q.required,
		points: q.points,
		options: Array.isArray(s.options) ? (s.options as QuestionOption[]) : [],
		correct: q.correct_json,
		settings: s,
		sort: q.sort
	};
}

export class BuilderStore {
	/** Kredensial & klien API. */
	readonly api: CreatorApi;
	readonly session: CreatorSession;

	/* ------------------------------ state ------------------------------ */
	form = $state<FormRow | null>(null);
	sections = $state<BSection[]>([]);
	unassigned = $state<BQ[]>([]);

	/** Muat awal. */
	loading = $state(true);
	/** Galat muat awal (fatal → tampilkan layar galat). */
	loadError = $state<string | null>(null);

	/** Status simpan otomatis. */
	save = $state<SaveState>('idle');
	/** Pesan galat simpan terakhir (non-fatal). */
	saveError = $state<string | null>(null);
	/** Info publish terakhir (bila sudah pernah dipublish di sesi ini). */
	publishInfo = $state<{ slug: string; status: string; access_token: string | null; url: string } | null>(null);

	/** Navigasi/panel. */
	selectedQuestionId = $state<number | null>(null);
	settingsOpen = $state(false);

	/* --------------------------- derived state ------------------------- */
	/** Semua soal (section + belum terpasang), urut. */
	allQuestions = $derived.by<BQ[]>(() => {
		const out: BQ[] = [];
		for (const s of this.sections) out.push(...s.questions);
		out.push(...this.unassigned);
		return out;
	});
	questionCount = $derived(this.allQuestions.length);
	sectionCount = $derived(this.sections.length);
	/** Jumlah soal yang punya kunci jawaban. */
	keyedCount = $derived(this.allQuestions.filter((q) => hasKey(q)).length);
	/** Total poin maksimum. */
	maxScore = $derived(this.allQuestions.reduce((a, q) => a + (q.points || 0), 0));
	isExam = $derived(this.form?.mode === 'exam' || this.form?.mode === 'quiz');
	selectedQuestion = $derived<BQ | null>(
		this.selectedQuestionId === null
			? null
			: this.allQuestions.find((q) => q.id === this.selectedQuestionId) ?? null
	);

	constructor(session: CreatorSession, formId: number) {
		this.session = session;
		this.api = new CreatorApi(session);
		this.formId = formId;
	}

	readonly formId: number;

	/* ------------------------------------------------------------------ */
	/* Muat                                                                 */
	/* ------------------------------------------------------------------ */

	async load(): Promise<void> {
		this.loading = true;
		this.loadError = null;
		try {
			const data = await this.api.getStructure(this.formId);
			this.form = data.form;
			this.publishInfo =
				data.form.status !== 'draft'
					? {
							slug: data.form.slug,
							status: data.form.status,
							access_token: data.form.require_token ? data.form.access_token : null,
							url: `/f/${data.form.slug}`
						}
					: null;
			this.sections = data.sections.map((s) => ({
				id: s.id,
				title: s.title,
				description: s.description,
				sort: s.sort,
				timer_seconds: s.timer_seconds,
				questions: s.questions.map(toBQ)
			}));
			this.unassigned = data.unassigned_questions.map(toBQ);
		} catch (e) {
			this.loadError = errText(e);
		} finally {
			this.loading = false;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Simpan metadata form (debounce untuk teks)                          */
	/* ------------------------------------------------------------------ */

	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingPatch: Record<string, unknown> = {};

	/** Ubah metadata form di UI lalu simpan ke server (ter-*debounce*). */
	patchForm(patch: Partial<FormRow>, opts: { immediate?: boolean } = {}): void {
		if (!this.form) return;
		Object.assign(this.form, patch);
		Object.assign(this.pendingPatch, patch);
		this.scheduleSave(opts.immediate === true);
	}

	/** Simpan metadata form segera (mis. saat menekan Enter / rata kontrol). */
	private scheduleSave(immediate: boolean): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.save = 'saving';
		const run = async () => {
			const patch = this.pendingPatch;
			this.pendingPatch = {};
			if (Object.keys(patch).length === 0) {
				this.save = 'idle';
				return;
			}
			try {
				const updated = await this.api.updateForm(this.formId, patch);
				if (this.form) Object.assign(this.form, updated);
				this.save = 'saved';
				this.saveError = null;
				setTimeout(() => {
					if (this.save === 'saved') this.save = 'idle';
				}, 1600);
			} catch (e) {
				this.save = 'error';
				this.saveError = errText(e);
			}
		};
		if (immediate) void run();
		else this.saveTimer = setTimeout(() => void run(), 600);
	}

	/* ------------------------------------------------------------------ */
	/* Sections                                                             */
	/* ------------------------------------------------------------------ */

	async addSection(title = 'Bagian baru'): Promise<void> {
		const sort = this.sections.length;
		const tmp: BSection = {
			id: nextTmpId(),
			title,
			description: null,
			sort,
			timer_seconds: null,
			questions: [],
			pending: true
		};
		this.sections = [...this.sections, tmp];
		try {
			const created = await this.api.createSection({ form_id: this.formId, title, sort });
			this.replaceSectionId(tmp.id, created.id);
			this.mutate((s) => {
				const found = s.find((x) => x.id === created.id);
				if (found) Object.assign(found, { description: created.description, timer_seconds: created.timer_seconds, pending: false });
			});
			this.flashSaved();
		} catch (e) {
			this.sections = this.sections.filter((s) => s.id !== tmp.id);
			this.fail(e);
		}
	}

	patchSection(id: number, patch: Partial<BSection>, immediate = false): void {
		this.mutate((s) => {
			const found = s.find((x) => x.id === id);
			if (found) Object.assign(found, patch);
		});
		const s = this.sections.find((x) => x.id === id);
		if (!s || s.pending) return;
		const body: Record<string, unknown> = {};
		if (patch.title !== undefined) body.title = patch.title;
		if (patch.description !== undefined) body.description = patch.description;
		if (patch.timer_seconds !== undefined) body.timer_seconds = patch.timer_seconds;
		if (Object.keys(body).length === 0) return;
		this.debouncedSectionSave(id, body, immediate);
	}

	private sectionTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private sectionPatches = new Map<number, Record<string, unknown>>();

	private debouncedSectionSave(id: number, body: Record<string, unknown>, immediate: boolean): void {
		const merged = { ...(this.sectionPatches.get(id) ?? {}), ...body };
		this.sectionPatches.set(id, merged);
		const prev = this.sectionTimers.get(id);
		if (prev) clearTimeout(prev);
		this.save = 'saving';
		const run = async () => {
			const patch = this.sectionPatches.get(id) ?? {};
			this.sectionPatches.delete(id);
			try {
				await this.api.updateSection(id, patch);
				this.flashSaved();
			} catch (e) {
				this.fail(e);
			}
		};
		if (immediate) void run();
		else this.sectionTimers.set(id, setTimeout(() => void run(), 600));
	}

	async deleteSection(id: number): Promise<void> {
		const snapshot = this.sections;
		this.sections = this.sections.filter((s) => s.id !== id);
		if (id < 0) return; // belum tersimpan
		try {
			await this.api.deleteSection(id);
			this.flashSaved();
		} catch (e) {
			this.sections = snapshot;
			this.fail(e);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Questions                                                            */
	/* ------------------------------------------------------------------ */

	async addQuestion(sectionId: number | null, label = 'Soal baru'): Promise<BQ | null> {
		const siblings = sectionId === null ? this.unassigned : this.sections.find((s) => s.id === sectionId)?.questions ?? [];
		const sort = siblings.length;
		const tmpId = nextTmpId();
		const draft: BQ = {
			id: tmpId,
			section_id: sectionId,
			type: 'short_text',
			label,
			help_text: null,
			required: false,
			points: 0,
			options: [],
			correct: null,
			settings: {},
			sort,
			pending: true
		};
		this.insertQuestion(draft);
		this.selectedQuestionId = tmpId;
		try {
			const created = await this.api.createQuestion({
				form_id: this.formId,
				section_id: sectionId,
				type: draft.type,
				label: draft.label,
				sort
			});
			const bq = toBQ(created);
			this.mutateQuestions((list) => {
				const i = list.findIndex((q) => q.id === tmpId);
				if (i >= 0) list[i] = bq;
			});
			if (this.selectedQuestionId === tmpId) this.selectedQuestionId = created.id;
			this.flashSaved();
			return bq;
		} catch (e) {
			this.removeQuestionLocal(tmpId);
			this.fail(e);
			return null;
		}
	}

	/**
	 * Ubah satu soal di UI. Field tipe/opsi/kunci memicu PUT penuh; field teks
	 * di-*debounce*. Perubahan tipe mengubah bentuk payload (options/correct).
	 */
	patchQuestion(id: number, patch: Partial<BQ>, immediate = false): void {
		this.mutateQuestions((list) => {
			const q = list.find((x) => x.id === id);
			if (q) Object.assign(q, patch);
		});
		const q = this.allQuestions.find((x) => x.id === id);
		if (!q || q.pending) return;
		const body = questionPatchBody(q, patch);
		if (Object.keys(body).length === 0) return;
		this.debouncedQuestionSave(id, body, immediate);
	}

	private qTimers = new Map<number, ReturnType<typeof setTimeout>>();
	private qPatches = new Map<number, Record<string, unknown>>();

	private debouncedQuestionSave(id: number, body: Record<string, unknown>, immediate: boolean): void {
		const merged = { ...(this.qPatches.get(id) ?? {}), ...body };
		this.qPatches.set(id, merged);
		const prev = this.qTimers.get(id);
		if (prev) clearTimeout(prev);
		this.save = 'saving';
		const run = async () => {
			const patch = this.qPatches.get(id) ?? {};
			this.qPatches.delete(id);
			try {
				await this.api.updateQuestion(id, patch);
				this.flashSaved();
			} catch (e) {
				this.fail(e);
			}
		};
		if (immediate) void run();
		else this.qTimers.set(id, setTimeout(() => void run(), 600));
	}

	async deleteQuestion(id: number): Promise<void> {
		const snapshot = { sections: this.sections, unassigned: this.unassigned };
		this.removeQuestionLocal(id);
		if (this.selectedQuestionId === id) this.selectedQuestionId = null;
		if (id < 0) return;
		try {
			await this.api.deleteQuestion(id);
			this.flashSaved();
		} catch (e) {
			this.sections = snapshot.sections;
			this.unassigned = snapshot.unassigned;
			this.fail(e);
		}
	}

	/** Pindahkan soal ke section lain (atau ke luar section). */
	async moveQuestion(id: number, toSectionId: number | null): Promise<void> {
		const q = this.allQuestions.find((x) => x.id === id);
		if (!q) return;
		if (q.section_id === toSectionId) return;
		const from = q.section_id;
		// Ambil soal dari wadah lama.
		this.removeQuestionLocal(id);
		const moved: BQ = { ...q, section_id: toSectionId };
		this.insertQuestion(moved);
		if (id < 0) return;
		try {
			await this.api.updateQuestion(id, { section_id: toSectionId });
			this.flashSaved();
		} catch (e) {
			// rollback
			this.removeQuestionLocal(id);
			this.insertQuestion({ ...q, section_id: from });
			this.fail(e);
		}
	}

	/** Geser soal satu langkah naik/turun DI DALAM wadahnya. */
	async shiftQuestion(id: number, dir: -1 | 1): Promise<void> {
		const q = this.allQuestions.find((x) => x.id === id);
		if (!q) return;
		const list = q.section_id === null ? this.unassigned : this.sections.find((s) => s.id === q.section_id)?.questions;
		if (!list) return;
		const idx = list.findIndex((x) => x.id === id);
		const target = idx + dir;
		if (target < 0 || target >= list.length) return;
		const order = [...list];
		[order[idx], order[target]] = [order[target], order[idx]];
		order.forEach((x, i) => (x.sort = i));
		await this.persistOrder(order);
	}

	/** Simpan urutan satu wadah ke server. */
	private async persistOrder(list: BQ[]): Promise<void> {
		const order = list.filter((x) => x.id > 0).map((x, i) => ({ id: x.id, sort: i }));
		try {
			if (order.length) await this.api.reorderQuestions(this.formId, order);
			this.flashSaved();
		} catch (e) {
			this.fail(e);
		}
	}

	/* ------------------------------------------------------------------ */
	/* Publish                                                              */
	/* ------------------------------------------------------------------ */

	async publish(opts: { slug?: string; access_token?: string } = {}): Promise<boolean> {
		if (!this.form) return false;
		this.save = 'saving';
		try {
			const info = await this.api.publishForm(this.formId, opts);
			this.form.status = info.status;
			this.form.slug = info.slug;
			this.form.require_token = info.require_token;
			this.form.access_token = info.access_token;
			this.publishInfo = {
				slug: info.slug,
				status: info.status,
				access_token: info.access_token,
				url: info.url
			};
			this.save = 'saved';
			return true;
		} catch (e) {
			this.fail(e);
			return false;
		}
	}

	async setStatus(status: 'draft' | 'open' | 'closed'): Promise<boolean> {
		try {
			const updated = await this.api.updateForm(this.formId, { status });
			if (this.form) Object.assign(this.form, updated);
			if (this.publishInfo) this.publishInfo.status = status;
			this.flashSaved();
			return true;
		} catch (e) {
			this.fail(e);
			return false;
		}
	}

	/* ------------------------------------------------------------------ */
	/* Util internal                                                        */
	/* ------------------------------------------------------------------ */

	private insertQuestion(q: BQ): void {
		if (q.section_id === null) {
			this.unassigned = [...this.unassigned, q];
		} else {
			this.mutate((s) => {
				const sec = s.find((x) => x.id === q.section_id);
				if (sec) sec.questions = [...sec.questions, q];
			});
		}
	}

	private removeQuestionLocal(id: number): void {
		this.unassigned = this.unassigned.filter((q) => q.id !== id);
		this.mutate((s) => {
			for (const sec of s) sec.questions = sec.questions.filter((q) => q.id !== id);
		});
	}

	private mutate(fn: (sections: BSection[]) => void): void {
		fn(this.sections);
		this.sections = [...this.sections];
	}

	private mutateQuestions(fn: (all: BQ[]) => void): void {
		// Terapkan pada referensi nyata agar perubahan objek terlihat.
		fn(this.unassigned);
		for (const sec of this.sections) fn(sec.questions);
		this.sections = [...this.sections];
		this.unassigned = [...this.unassigned];
	}

	private replaceSectionId(oldId: number, newId: number): void {
		this.mutate((s) => {
			const sec = s.find((x) => x.id === oldId);
			if (sec) sec.id = newId;
		});
	}

	private flashSaved(): void {
		this.save = 'saved';
		this.saveError = null;
		setTimeout(() => {
			if (this.save === 'saved') this.save = 'idle';
		}, 1600);
	}

	private fail(e: unknown): void {
		this.save = 'error';
		this.saveError = errText(e);
	}
}

/* -------------------------------------------------------------------- */
/* Helper murni                                                          */
/* -------------------------------------------------------------------- */

/** Apakah soal punya kunci jawaban terisi. */
export function hasKey(q: BQ): boolean {
	if (!q.correct) return false;
	if (Array.isArray(q.correct.values)) return q.correct.values.length > 0;
	return q.correct.value !== undefined && q.correct.value !== null && q.correct.value !== '';
}

/** Ambil pesan galat siap tampil dari error apa pun. */
export function errText(e: unknown): string {
	if (e instanceof ApiClientError) return e.message;
	if (e instanceof Error) return e.message;
	return 'Terjadi kesalahan tak terduga.';
}

/**
 * Susun body PUT untuk soal berdasarkan field yang berubah.
 * Aturan dari API M3: `options` wajib dikirim untuk tipe beropsi (bila berubah),
 * `correct` memakai {value} / {values[]} sesuai tipe.
 */
export function questionPatchBody(q: BQ, patch: Partial<BQ>): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	if (patch.label !== undefined) body.label = q.label;
	if (patch.help_text !== undefined) body.help_text = q.help_text;
	if (patch.required !== undefined) body.required = q.required;
	if (patch.points !== undefined) body.points = q.points;
	if (patch.type !== undefined) body.type = q.type;

	// Tipe beropsi: sertakan options + settings (min/max/placeholder).
	if (patch.type !== undefined || patch.options !== undefined || patch.settings !== undefined) {
		const opts = q.options ?? [];
		// Server menolak tipe beropsi tanpa options → jangan kirim options kosong.
		if (opts.length > 0) body.options = opts;
		body.settings = q.settings ?? {};
	}

	if (patch.correct !== undefined || patch.type !== undefined) {
		const c = q.correct;
		if (c && (Array.isArray(c.values) ? c.values.length > 0 : c.value !== undefined && c.value !== null && c.value !== '')) {
			body.correct = c;
		}
	}
	return body;
}
