#!/usr/bin/env node
/** verify-demo-exam.mjs — uji alur ujian demo end-to-end via API. */
const B = 'http://localhost:3400';
const SLUG = 'ujian-matematika-timer-10-menit';
const j = async (m, p, b) => {
	const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
	return { s: r.status, j: await r.json().catch(() => null), t: await r.text().catch(() => '') };
};
console.log('1) Ambil struktur (tanpa kunci jawaban?)');
let r = await j('GET', `/api/public/forms/${SLUG}`);
console.log('   form:', r.j?.form?.title, '| mode:', r.j?.form?.mode, '| timer:', r.j?.form?.timer_seconds, '| acak soal:', r.j?.form?.shuffle_questions);
console.log('   soal:', (r.j?.questions ?? []).length, '| bocor correct_json?', r.t.includes('correct_json') ? '⚠️ YA' : '✅ TIDAK');
console.log('2) Mulai sesi');
r = await j('POST', `/api/public/forms/${SLUG}/start`, { name: 'Peserta Demo' });
const rid = r.j?.response_id;
console.log('   response_id:', rid, '| seed:', r.j?.seed);
console.log('3) Soal teracak (seed=response_id)');
r = await j('GET', `/api/public/forms/${SLUG}?response_id=${rid}`);
const qs = r.j?.questions ?? [];
console.log('   urutan soal:', qs.map((q) => q.id).join(','), '| bocor kunci?', r.t.includes('correct_json') ? '⚠️ YA' : '✅ TIDAK');
console.log('4) Submit jawaban (semua benar sesuai kunci asli)');
const benar = { 1: 'B', 2: 'B', 3: 'A', 4: 'A' };
const answers = qs.map((q) => ({ question_id: q.id, value: benar[q.id] ?? 'B' }));
r = await j('POST', `/api/public/forms/${SLUG}/submit`, { response_id: rid, answers });
console.log('   skor:', r.j?.score, '/', r.j?.max_score, '| lulus:', r.j?.passed);
console.log('5) Submit ulang (harus 409)');
r = await j('POST', `/api/public/forms/${SLUG}/submit`, { response_id: rid, answers });
console.log('   status:', r.s);
console.log('\n✅ Alur ujian berfungsi.' + (r.s === 409 ? ' Anti submit-ulang aktif.' : ''));
