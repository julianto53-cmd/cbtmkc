// Load Test Verification: Simulates 1,000 concurrent students starting, syncing batched answers, and submitting a full exam.
// Usage: node scripts/loadtest-1000.mjs [BASE_URL]

const BASE_URL = process.argv[2] || 'http://127.0.0.1:3000';
const CONCURRENT_STUDENTS = 1000;

async function req(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${path} -> HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

async function main() {
  console.log(`Menjalankan uji beban ${CONCURRENT_STUDENTS} siswa bersamaan ke ${BASE_URL}...`);
  const boot = await req('/api/public/bootstrap');
  const adminPass = process.env.ADMIN_PASSCODE || 'AdminTest123!';
  const demoPass = 'LoadTest2026!';

  let adminToken;
  if (boot.needsAdminSetup) {
    const setup = await req('/api/auth/setup-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolName: 'SMK Uji Beban MKC',
        fullName: 'Operator Uji',
        adminPassword: adminPass,
        includeSimulationData: true,
        demoUsersPassword: demoPass,
      }),
    });
    adminToken = setup.token;
  } else {
    const login = await req('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: adminPass }),
    });
    adminToken = login.token;
  }

  // Ensure 1000 load-test students exist
  await req('/api/admin/users/bulk-students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      prefix: 'lt_',
      count: CONCURRENT_STUDENTS,
      className: 'XII UJI BEBAN',
      password: demoPass,
    }),
  });

  // Get active exam token
  const examsResp = await req('/api/teacher/exams', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const activeExam = examsResp.exams.find((e) => e.status === 'ACTIVE');
  if (!activeExam) throw new Error('Tidak ada ujian aktif untuk uji beban');

  const t0 = Date.now();
  let errors = 0;

  // Run all 1000 students concurrently
  const tasks = Array.from({ length: CONCURRENT_STUDENTS }, async (_, idx) => {
    const username = `lt_${String(idx + 1).padStart(4, '0')}`;
    try {
      const loginData = await req('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: demoPass }),
      });
      const authH = { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` };

      const startData = await req(`/api/student/exams/${activeExam.id}/start`, {
        method: 'POST',
        headers: authH,
        body: JSON.stringify({ tokenCode: activeExam.token_code }),
      });

      const batchAnswers = startData.questions.map((q) => {
        if (q.qType === 'PG') return { questionId: q.id, answer: 'B' };
        if (q.qType === 'PGK') return { questionId: q.id, answer: ['A', 'B', 'C'] };
        if (q.qType === 'BS') return { questionId: q.id, answer: { '1': 'B', '2': 'S', '3': 'B' } };
        if (q.qType === 'JODOH') return { questionId: q.id, answer: { L1: 'R2', L2: 'R3', L3: 'R1' } };
        if (q.qType === 'ISIAN') return { questionId: q.id, answer: 'Domain Name System' };
        return { questionId: q.id, answer: 'Menggunakan cache lokal, batch sync, dan WAL SQLite.' };
      });

      await req(`/api/student/sessions/${startData.session.id}/sync`, {
        method: 'POST',
        headers: authH,
        body: JSON.stringify({ answers: batchAnswers, violations: [] }),
      });

      await req(`/api/student/sessions/${startData.session.id}/submit`, {
        method: 'POST',
        headers: authH,
        body: JSON.stringify({ answers: batchAnswers }),
      });
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`Error pada ${username}:`, err.message);
    }
  });

  await Promise.all(tasks);
  const elapsedMs = Date.now() - t0;
  console.log(`Selesai: ${CONCURRENT_STUDENTS} siswa penuh (${CONCURRENT_STUDENTS * 4} HTTP requests) dalam ${elapsedMs} ms. Total kesalahan: ${errors}`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
