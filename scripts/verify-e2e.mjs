#!/usr/bin/env node
/**
 * verify-e2e.mjs — Verifikasi mandiri end-to-end FormKu (M2+M3+M4).
 * Membuktikan: isolasi tenant, CRUD struktur, publish, pengacakan,
 * ANTI-KEBOCORAN kunci jawaban, penghitungan skor, dan audit anti-kecurangan.
 */
const BASE = 'http://localhost:3400';
const OP = process.env.OWNER_PASSWORD;
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
	if (cond) { pass++; console.log(`  ✅ ${name}`); }
	else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}
async function req(method, path, { headers = {}, body, raw } = {}) {
	const res = await fetch(BASE + path, {
		method,
		headers: { 'Content-Type': 'application/json', ...headers },
		body: body ? (raw ? body : JSON.stringify(body)) : undefined
	});
	const text = await res.text();
	let json; try { json = JSON.parse(text); } catch { json = null; }
	return { status: res.status, json, text };
}

const owner = { 'x-owner-password': OP };
const run = Date.now().toString(36);

console.log('\n=== [1] SETUP: owner buat 2 tenant ===');
let r = await req('POST', '/api/owner/tenants', { headers: owner, body: { slug: `a-${run}`, name: 'Tenant A' } });
check('buat tenant A → 200/201', r.status < 300, `status=${r.status}`);
const A = { 'x-tenant': `a-${run}`, 'x-api-key': r.json?.api_key ?? '' };
r = await req('POST', '/api/owner/tenants', { headers: owner, body: { slug: `b-${run}`, name: 'Tenant B' } });
const B = { 'x-tenant': `b-${run}`, 'x-api-key': r.json?.api_key ?? '' };
check('buat tenant B → 200/201', r.status < 300);

console.log('\n=== [2] M3: tenant A buat form (mode exam) ===');
r = await req('POST', '/api/forms', { headers: A, body: { title: 'Ujian Matematika Dasar', mode: 'exam' } });
check('buat form → 200/201', r.status < 300, `status=${r.status} ${r.text.slice(0,120)}`);
const formId = r.json?.form?.id ?? r.json?.id;

r = await req('PUT', `/api/forms/${formId}`, { headers: A, body: {
	mode: 'exam', timer_seconds: 600, timer_scope: 'form',
	shuffle_questions: true, shuffle_options: true, passing_grade: 60, show_score: true
} });
check('setel form (timer/acak/passing) → 200', r.status < 300, `status=${r.status}`);

console.log('\n=== [3] M3: buat section + 3 soal pilihan ganda ===');
r = await req('POST', '/api/sections', { headers: A, body: { form_id: formId, title: 'Bagian A', sort: 0 } });
const secId = r.json?.section?.id ?? r.json?.id;
check('buat section → 200/201', r.status < 300, `status=${r.status} ${r.text.slice(0,100)}`);

const qIds = [];
for (const [i, q] of [
	{ label: '2 + 2 = ?', correct: 'B', opts: ['3', '4', '5'], points: 10 },
	{ label: '5 × 3 = ?', correct: 'C', opts: ['8', '10', '15'], points: 10 },
	{ label: '10 - 4 = ?', correct: 'A', opts: ['6', '7', '8'], points: 10 }
].entries()) {
	const body = {
		form_id: formId, section_id: secId, type: 'radio', label: q.label,
		required: true, points: q.points, sort: i,
		options: q.opts.map((o, k) => ({ label: o, value: String.fromCharCode(65 + k) })),
		correct: { value: q.correct }
	};
	r = await req('POST', '/api/questions', { headers: A, body });
	const qid = r.json?.question?.id ?? r.json?.id;
	qIds.push(qid);
	check(`buat soal ${i + 1} (${q.label}) → 200/201`, r.status < 300, `status=${r.status} ${r.text.slice(0,100)}`);
}

r = await req('GET', `/api/forms/${formId}/structure`, { headers: A });
check('GET structure → ada 1 section & 3 soal',
	(r.json?.sections?.length ?? 0) === 1 && (r.json?.sections?.[0]?.questions?.length ?? 0) === 3,
	JSON.stringify(r.json).slice(0, 160));

console.log('\n=== [4] ISOLASI TENANT (keamanan) ===');
r = await req('GET', `/api/forms/${formId}`, { headers: B });
check('tenant B akses form A → 404', r.status === 404 || r.status === 403, `status=${r.status}`);
r = await req('GET', '/api/forms', { headers: B });
const bForms = r.json?.forms ?? r.json?.items ?? [];
check('daftar form tenant B kosong', Array.isArray(bForms) && bForms.length === 0, `len=${bForms?.length}`);

console.log('\n=== [5] M3: publish ===');
r = await req('POST', `/api/forms/${formId}/publish`, { headers: A, body: {} });
const pubSlug = r.json?.slug ?? r.json?.public_path?.split('/').pop();
check('publish → slug + open', r.status < 300 && !!pubSlug, `status=${r.status} slug=${pubSlug}`);

console.log('\n=== [6] M4: KEAMANAN — kunci jawaban TIDAK boleh bocor ===');
r = await req('GET', `/api/public/forms/${pubSlug}`);
check('GET publik → 200', r.status === 200, `status=${r.status}`);
const leakFields = ['correct_json', 'correct', 'answer_key', 'answer'];
const leaked = leakFields.filter((f) => r.text.includes(`"${f}"`));
check('struktur publik TIDAK memuat kunci jawaban', leaked.length === 0, `bocor=${leaked}`);

console.log('\n=== [7] M4: start sesi ===');
r = await req('POST', `/api/public/forms/${pubSlug}/start`, { body: { name: 'Peserta Uji' } });
const respId = r.json?.response_id ?? r.json?.id;
const seed = r.json?.seed;
check('start → response_id', r.status < 300 && !!respId, `status=${r.status} ${r.text.slice(0,120)}`);

console.log('\n=== [8] M4: ambil soal teracak (from GET dengan response_id) ===');
r = await req('GET', `/api/public/forms/${pubSlug}?response_id=${respId}`);
const qtext = r.text;
const qcount = (r.json?.questions ?? []).length;
check('questions → 3 soal', qcount === 3, `count=${qcount} status=${r.status}`);
const leaked2 = leakFields.filter((f) => qtext.includes(`"${f}"`));
check('soal teracak TIDAK memuat kunci jawaban', leaked2.length === 0, `bocor=${leaked2}`);
const opts = r.json?.questions?.[0]?.settings?.options ?? r.json?.questions?.[0]?.options;
check('opsi jawaban tersedia (3 opsi)', (opts?.length ?? 0) === 3, JSON.stringify(opts).slice(0, 120));

console.log('\n=== [9] M4: submit & hitung skor (2 benar dari 3) ===');
const idByLabel = {};
for (const q of (r.json?.questions ?? [])) idByLabel[q.label] = q.id;
const answers = [
	{ question_id: idByLabel['2 + 2 = ?'] ?? qIds[0], value: 'B' },
	{ question_id: idByLabel['5 × 3 = ?'] ?? qIds[1], value: 'C' },
	{ question_id: idByLabel['10 - 4 = ?'] ?? qIds[2], value: 'C' }
];
r = await req('POST', `/api/public/forms/${pubSlug}/submit`, { body: { response_id: respId, answers } });
check('submit → 200', r.status < 300, `status=${r.status} ${r.text.slice(0,150)}`);
const score = r.json?.score, maxScore = r.json?.max_score;
check(`skor benar (2×10=20 dari 30)`, score === 20 && maxScore === 30, `score=${score} max=${maxScore}`);
check('lulus/tidak dihitung (passing 60%)', r.json?.passed === false || r.json?.passed === true, `passed=${r.json?.passed}`);

console.log('\n=== [10] M4: submit ULANG harus ditolak ===');
r = await req('POST', `/api/public/forms/${pubSlug}/submit`, { body: { response_id: respId, answers } });
check('submit ulang → 409', r.status === 409, `status=${r.status}`);

console.log('\n=== [11] M4: audit anti-kecurangan ===');
r = await req('POST', `/api/public/forms/${pubSlug}/event`, { body: { response_id: respId, event_type: 'blur' } });
check('catat event blur → 200', r.status < 300, `status=${r.status}`);
r = await req('POST', `/api/public/forms/${pubSlug}/event`, { body: { response_id: respId, event_type: 'ngawur' } });
check('event_type asing ditolak', r.status >= 400, `status=${r.status}`);

console.log('\n=== [12] Bersih-bersih (hapus tenant uji via DB) ===');
console.log(JSON.stringify({ cleanupSlugs: [`a-${run}`, `b-${run}`] }));

console.log(`\n═══ HASIL: ${pass} lulus, ${fail} gagal ═══\n`);
process.exit(fail > 0 ? 1 : 0);
