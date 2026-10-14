#!/usr/bin/env node
/**
 * seed-demo.mjs — Buat akun demo FormKu + 3 form contoh (form, quiz, exam)
 * agar pengguna bisa langsung mencoba dari internet.
 */
const BASE = process.env.BASE || 'http://localhost:3400';
const OP = process.env.OWNER_PASSWORD;
const SLUG = 'demo';
const API_KEY = 'demo-formku-2026';

async function j(method, path, { headers = {}, body } = {}) {
	const res = await fetch(BASE + path, {
		method, headers: { 'Content-Type': 'application/json', ...headers },
		body: body ? JSON.stringify(body) : undefined
	});
	const t = await res.text();
	let x; try { x = JSON.parse(t); } catch { x = null; }
	return { status: res.status, json: x, text: t };
}

const owner = { 'x-owner-password': OP };

console.log('1) Buat tenant demo (bersihkan yang lama dulu)');
// Hapus tenant demo lama bila ada, agar kunci mentah baru didapat & tercatat.
const list0 = await j('GET', '/api/owner/tenants', { headers: owner });
const old = (list0.json?.tenants ?? []).find((t) => t.slug === SLUG);
if (old) {
	await j('DELETE', `/api/owner/tenants?id=${old.id}`, { headers: owner });
	console.log('   tenant demo lama dihapus (id', old.id + ')');
}
let r = await j('POST', '/api/owner/tenants', { headers: owner, body: { slug: SLUG, name: 'Demo FormKu' } });
if (r.status >= 300) {
	console.log('   ⚠️ gagal buat tenant:', r.text.slice(0, 200));
	process.exit(2);
}
const KEY = r.json?.api_key;
console.log('   dibuat. api_key =', KEY);
const H = { 'x-tenant': SLUG, 'x-api-key': KEY };

console.log('2) Buat form contoh A: FORM pendaftaran');
r = await j('POST', '/api/forms', { headers: H, body: { title: 'Pendaftaran Kelas Online', mode: 'form', description: 'Isi data untuk mengikuti kelas.' } });
const formA = r.json?.form?.id ?? r.json?.id;
await j('POST', '/api/questions', { headers: H, body: { form_id: formA, type: 'short_text', label: 'Nama lengkap', required: true, sort: 0 } });
await j('POST', '/api/questions', { headers: H, body: { form_id: formA, type: 'email', label: 'Email aktif', required: true, sort: 1 } });
await j('POST', '/api/questions', { headers: H, body: { form_id: formA, type: 'dropdown', label: 'Pilih kelas', required: true, sort: 2, options: [{ label: 'Dasar', value: 'dasar' }, { label: 'Lanjutan', value: 'lanjutan' }] } });
await j('POST', '/api/questions', { headers: H, body: { form_id: formA, type: 'long_text', label: 'Motivasi mengikuti kelas', required: false, sort: 3 } });
r = await j('POST', `/api/forms/${formA}/publish`, { headers: H, body: {} });
console.log('   →', r.json?.slug ?? r.json?.public_path);

console.log('3) Buat form contoh B: QUIZ pengetahuan umum');
r = await j('POST', '/api/forms', { headers: H, body: { title: 'Kuis Pengetahuan Umum', mode: 'quiz', description: 'Uji wawasanmu!' } });
const formB = r.json?.form?.id ?? r.json?.id;
await j('PUT', `/api/forms/${formB}`, { headers: H, body: { mode: 'quiz', show_score: true, passing_grade: 60, shuffle_options: true } });
r = await j('POST', '/api/sections', { headers: H, body: { form_id: formB, title: 'Bagian 1 — Umum', sort: 0 } });
const secB1 = r.json?.section?.id ?? r.json?.id;
r = await j('POST', '/api/sections', { headers: H, body: { form_id: formB, title: 'Bagian 2 — Sains', sort: 1 } });
const secB2 = r.json?.section?.id ?? r.json?.id;
const qB = [
	[secB1, 'Ibu kota Indonesia adalah?', ['Bandung', 'Jakarta', 'Surabaya'], 'B'],
	[secB1, 'Berapa jumlah provinsi Indonesia (2024)?', ['34', '38', '40'], 'B'],
	[secB2, 'Planet terdekat dengan Matahari?', ['Venus', 'Merkurius', 'Mars'], 'B'],
	[secB2, 'Air membeku pada suhu?', ['0°C', '10°C', '-10°C'], 'A']
];
for (const [i, [sid, label, opts, cor]] of qB.entries()) {
	await j('POST', '/api/questions', { headers: H, body: {
		form_id: formB, section_id: sid, type: 'radio', label, required: true, points: 25, sort: i,
		options: opts.map((o, k) => ({ label: o, value: String.fromCharCode(65 + k) })), correct: { value: cor }
	} });
}
r = await j('POST', `/api/forms/${formB}/publish`, { headers: H, body: {} });
console.log('   →', r.json?.slug ?? r.json?.public_path);

console.log('4) Buat form contoh C: EXAM dengan timer + acak');
r = await j('POST', '/api/forms', { headers: H, body: { title: 'Ujian Matematika (Timer 10 menit)', mode: 'exam', description: 'Ujian berwaktu. Soal & jawaban diacak.' } });
const formC = r.json?.form?.id ?? r.json?.id;
await j('PUT', `/api/forms/${formC}`, { headers: H, body: {
	mode: 'exam', timer_seconds: 600, timer_scope: 'form',
	shuffle_questions: true, shuffle_options: true, show_score: true, passing_grade: 70
} });
r = await j('POST', '/api/sections', { headers: H, body: { form_id: formC, title: 'Bagian Tunggal', sort: 0 } });
const secC = r.json?.section?.id ?? r.json?.id;
const qC = [
	['12 × 12 = ?', ['124', '144', '134'], 'B', 20],
	['Akar kuadrat dari 81 = ?', ['8', '9', '7'], 'B', 20],
	['15% dari 200 = ?', ['30', '20', '15'], 'A', 30],
	['Jika x + 5 = 12, maka x = ?', ['7', '8', '6'], 'A', 30]
];
for (const [i, [label, opts, cor, pts]] of qC.entries()) {
	await j('POST', '/api/questions', { headers: H, body: {
		form_id: formC, section_id: secC, type: 'radio', label, required: true, points: pts, sort: i,
		options: opts.map((o, k) => ({ label: o, value: String.fromCharCode(65 + k) })), correct: { value: cor }
	} });
}
// tambah 1 soal ke bank soal + token ujian
await j('POST', '/api/bank', { headers: H, body: { type: 'radio', label: 'Contoh soal bank: 5² = ?', options: [{ label: '10', value: 'A' }, { label: '25', value: 'B' }], correct: { value: 'B' }, points: 10, tags: 'matematika' } });
r = await j('POST', `/api/forms/${formC}/publish`, { headers: H, body: {} });
console.log('   →', r.json?.slug ?? r.json?.public_path);

console.log('\n✅ Selesai. Akun demo: slug=demo, kunci=' + API_KEY);
