/**
 * /api/forms/[id]/structure — pohon struktur form lengkap (Creator / UI Builder M5).
 *
 * Auth: `x-tenant` + `x-api-key`. Isolasi: getOwnedForm.
 *  - GET → { form, sections:[{...,questions:[...]}], unassigned_questions,
 *            conditions, counts } siap dirender builder.
 *
 * Mengembalikan `correct_json` juga — creator adalah PEMILIK kunci jawaban.
 * (Pembocoran ke responden dijaga di M4 /api/public/*.)
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { many } from '$lib/server/db.js';
import { handleAuthError } from '$lib/server/auth.js';
import {
	authTenant,
	getOwnedForm,
	loadStructure,
	parseIdParam,
	type QuestionRow,
	type SectionRow
} from '$lib/server/forms-util.js';

interface ConditionRow {
	id: number;
	question_id: number;
	depends_on_question_id: number;
	operator: string;
	compare_value: string | null;
	action: string;
}

export const GET: RequestHandler = async (event) => {
	try {
		const tenant = await authTenant(event);
		const id = parseIdParam(event.params.id, 'id form');
		const form = await getOwnedForm(tenant.id, id);

		const { sections, questions } = await loadStructure(form.id);

		const conditions = await many<ConditionRow>(
			`SELECT c.*
			   FROM formku.conditions c
			   JOIN formku.questions q ON q.id = c.question_id
			  WHERE q.form_id = $1
			  ORDER BY c.id ASC`,
			[form.id]
		);
		const condByQuestion = new Map<number, ConditionRow[]>();
		for (const c of conditions) {
			const list = condByQuestion.get(c.question_id) ?? [];
			list.push(c);
			condByQuestion.set(c.question_id, list);
		}

		const withConds = (q: QuestionRow) => ({
			...q,
			conditions: condByQuestion.get(q.id) ?? []
		});

		const bySection = new Map<number | null, ReturnType<typeof withConds>[]>();
		for (const q of questions) {
			const key = q.section_id ?? null;
			const list = bySection.get(key) ?? [];
			list.push(withConds(q));
			bySection.set(key, list);
		}

		const tree = sections.map((s: SectionRow) => ({
			...s,
			questions: bySection.get(s.id) ?? []
		}));

		return json({
			form,
			sections: tree,
			unassigned_questions: bySection.get(null) ?? [],
			conditions,
			counts: {
				sections: sections.length,
				questions: questions.length,
				conditions: conditions.length
			}
		});
	} catch (e) {
		return handleAuthError(e);
	}
};
