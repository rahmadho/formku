#!/usr/bin/env node
/**
 * verify-ui.mjs — Verifikasi mandiri UI + API modul gelombang 3 (M5/M6/M7).
 */
const BASE = 'http://localhost:3400';
const OP = process.env.OWNER_PASSWORD;
let pass = 0, fail = 0;
const check = (n, c, e = '') => { c ? (pass++, console.log(`  ✅ ${n}`)) : (fail++, console.log(`  ❌ ${n} ${e}`)); };
async function req(method, path, { headers = {}, body } = {}) {
	const res = await fetch(BASE + path, {
		method, headers: { 'Content-Type': 'application/json', ...headers },
		body: body ? JSON.stringify(body) : undefined, redirect: 'manual'
	});
	const text = await res.text();
	let json; try { json = JSON.parse(text); } catch { json = null; }
	return { status: res.status, json, text, headers: res.headers };
}
const owner = { 'x-owner-password': OP };
const run = Date.now().toString(36);

console.log('\n=== SETUP tenant + form exam ===');
let r = await req('POST', '/api/owner/tenants', { headers: owner, body: { slug: `u-${run}`, name: 'UI Uji' } });
const H = { 'x-tenant': `u-${run}`, 'x-api-key': r.json?.api_key ?? '' };
r = await req('POST', '/api/forms', { headers: H, body: { title: 'Kuis UI', mode: 'quiz' } });
const formId = r.json?.form?.id ?? r.json?.id;
await req('PUT', `/api/forms/${formId}`, { headers: H, body: { mode: 'quiz', passing_grade: 50, show_score: true, shuffle_questions: false } });
r = await req('POST', '/api/sections', { headers: H, body: { form_id: formId, title: 'Bagian 1' } });
const secId = r.json?.section?.id ?? r.json?.id;
for (const [i, q] of [{ l: 'Ibu kota Indonesia?', c: 'B', o: ['Bandung', 'Jakarta', 'Surabaya'] }, { l: '2+3?', c: 'A', o: ['5', '6', '4'] }].entries()) {
	await req('POST', '/api/questions', { headers: H, body: { form_id: formId, section_id: secId, type: 'radio', label: q.l, required: true, points: 10, sort: i, options: q.o.map((x, k) => ({ label: x, value: String.fromCharCode(65 + k) })), correct: { value: q.c } } });
}
r = await req('POST', `/api/forms/${formId}/publish`, { headers: H, body: {} });
const slug = r.json?.slug ?? r.json?.public_path?.split('/').pop();
check('setup form quiz + publish', !!slug, `slug=${slug}`);

console.log('\n=== M6: halaman isi form /f/[slug] ===');
r = await req('GET', `/f/${slug}`);
check('halaman /f/<slug> render 200', r.status === 200, `status=${r.status}`);
check('HTML tidak memuat kunci jawaban', !r.text.includes('correct_json') && !r.text.includes('"correct"'), '');

console.log('\n=== M7: API respons & analitik ===');
r = await req('GET', `/api/forms/${formId}/responses`, { headers: H });
check('GET responses → 200', r.status === 200, `status=${r.status}`);

// buat 1 respons via alur publik
r = await req('GET', `/api/public/forms/${slug}`);
const qs = r.json?.questions ?? [];
r = await req('POST', `/api/public/forms/${slug}/start`, { body: { name: 'Peserta' } });
const rid = r.json?.response_id;
await req('POST', `/api/public/forms/${slug}/submit`, { body: { response_id: rid, answers: qs.map((q, i) => ({ question_id: q.id, value: i === 0 ? 'B' : 'A' })) } });

r = await req('GET', `/api/forms/${formId}/responses`, { headers: H });
check('responses memuat 1 entri', (r.json?.responses?.length ?? r.json?.items?.length ?? 0) >= 1, JSON.stringify(r.json).slice(0, 120));

r = await req('GET', `/api/forms/${formId}/responses.csv`, { headers: H });
check('CSV → 200 + Content-Disposition', r.status === 200 && /attachment/i.test(r.headers.get('content-disposition') ?? ''), `status=${r.status} cd=${r.headers.get('content-disposition')}`);
check('CSV punya header kolom', /id|nama|score|skor/i.test(r.text.slice(0, 200)), r.text.slice(0, 80));

r = await req('GET', `/api/forms/${formId}/analytics`, { headers: H });
check('analytics → 200', r.status === 200, `status=${r.status}`);

console.log('\n=== M7: bank soal + impor CSV ===');
r = await req('POST', '/api/bank', { headers: H, body: { type: 'radio', label: 'Soal bank 1', options: [{ label: 'A', value: 'A' }, { label: 'B', value: 'B' }], correct: { value: 'A' }, points: 5, tags: 'matematika' } });
check('POST /api/bank → 200/201', r.status < 300, `status=${r.status} ${r.text.slice(0, 100)}`);
const csv = 'type,label,options,correct,points,tags\nradio,"Soal dari CSV","Ya|Tidak",Ya,3,umum\n';
r = await req('POST', '/api/bank/import-csv', { headers: H, body: { csv } });
check('impor CSV → ringkasan imported', r.status < 300 && (r.json?.imported ?? 0) >= 1, JSON.stringify(r.json).slice(0, 140));
r = await req('POST', '/api/bank/import-csv', { headers: H, body: { csv: 'rusak,tanpa,kolom\na,b\n' } });
check('CSV rusak → ditangani (tidak crash)', r.status < 500, `status=${r.status}`);

console.log(`\n═══ HASIL: ${pass} lulus, ${fail} gagal ═══\n`);
process.exit(fail > 0 ? 1 : 0);
