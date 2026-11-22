import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { hashPassword } from './crypto.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
const QUESTION_UPLOADS_DIR = path.join(UPLOADS_DIR, 'questions');
const SLIDER_UPLOADS_DIR = path.join(UPLOADS_DIR, 'slides');

export function ensureDirectories() {
  for (const dir of [DATA_DIR, UPLOADS_DIR, QUESTION_UPLOADS_DIR, SLIDER_UPLOADS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

ensureDirectories();

const DB_PATH = path.join(DATA_DIR, 'mkc_cbt.db');
export const db = new Database(DB_PATH);

// High-concurrency SQLite tuning for 1000+ simultaneous exam connections
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 15000');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -64000');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'guru', 'pengawas', 'siswa')),
      class_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      badge_label TEXT NOT NULL DEFAULT 'MKC CBT',
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_encrypted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS question_banks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      grade_level TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      q_type TEXT NOT NULL CHECK(q_type IN ('PG', 'PGK', 'BS', 'JODOH', 'ISIAN', 'ESAI')),
      prompt_text TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      options_json TEXT NOT NULL DEFAULT '{}',
      answer_key_json TEXT NOT NULL DEFAULT '{}',
      max_score REAL NOT NULL DEFAULT 1,
      difficulty_tag TEXT NOT NULL DEFAULT 'Sedang',
      explanation TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      token_code TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      max_violations INTEGER NOT NULL DEFAULT 3,
      shuffle_questions INTEGER NOT NULL DEFAULT 1,
      shuffle_options INTEGER NOT NULL DEFAULT 0,
      show_result_to_student INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
      target_classes TEXT NOT NULL DEFAULT 'ALL',
      start_at TEXT NOT NULL DEFAULT '',
      end_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS', 'LOCKED', 'SUBMITTED')),
      violation_count INTEGER NOT NULL DEFAULT 0,
      unlock_count INTEGER NOT NULL DEFAULT 0,
      locked_reason TEXT NOT NULL DEFAULT '',
      unlocked_by INTEGER REFERENCES users(id),
      question_order_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sync_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_at TEXT,
      auto_score REAL NOT NULL DEFAULT 0,
      manual_score_adjustment REAL NOT NULL DEFAULT 0,
      final_score REAL NOT NULL DEFAULT 0,
      grading_status TEXT NOT NULL DEFAULT 'AUTO' CHECK(grading_status IN ('AUTO', 'NEEDS_REVIEW', 'GRADED')),
      UNIQUE(exam_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS student_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      answer_json TEXT NOT NULL DEFAULT 'null',
      auto_score REAL NOT NULL DEFAULT 0,
      manual_score REAL,
      teacher_note TEXT NOT NULL DEFAULT '',
      is_manually_graded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS violation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      violation_type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_sessions_exam ON exam_sessions(exam_id, status);
    CREATE INDEX IF NOT EXISTS idx_answers_session ON student_answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_answers_exam ON student_answers(exam_id, question_id);
    CREATE INDEX IF NOT EXISTS idx_violations_exam ON violation_logs(exam_id, created_at);
  `);

  // Safe migration for existing databases adding exam schedule columns
  const examCols = db.prepare("PRAGMA table_info(exams)").all() as Array<{ name: string }>;
  const examColNames = new Set(examCols.map((c) => c.name));
  if (!examColNames.has('start_at')) {
    db.exec("ALTER TABLE exams ADD COLUMN start_at TEXT NOT NULL DEFAULT ''");
  }
  if (!examColNames.has('end_at')) {
    db.exec("ALTER TABLE exams ADD COLUMN end_at TEXT NOT NULL DEFAULT ''");
  }

  // Seed default login slides if empty
  const slideCount = (db.prepare('SELECT COUNT(*) as c FROM login_slides').get() as { c: number }).c;
  if (slideCount === 0) {
    const insertSlide = db.prepare(`
      INSERT INTO login_slides (title, subtitle, badge_label, image_url, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    insertSlide.run(
      'Evaluasi Digital Terintegrasi & Berintegritas',
      'Platform MKC CBT menghadirkan ujian berbasis layar penuh dengan pemantauan pengawas secara langsung dan sinkronisasi jawaban anti-putus koneksi.',
      'Sistem Ujian MKC',
      '/src/assets/images/slider_campus_digital_1795305217271.jpg',
      1
    );
    insertSlide.run(
      'Ringan untuk Ratusan Hingga 1.000 Peserta Serentak',
      'Paket soal dikirim sekali ke peramban dengan cache lokal cerdas dan pengiriman jawaban berkelompok agar tetap stabil di jaringan sekolah.',
      'Arsitektur Berkecepatan Tinggi',
      '/src/assets/images/slider_exam_focus_1795305218316.jpg',
      2
    );
    insertSlide.run(
      'Analisis Butir Soal Psikometrik Lengkap',
      'Evaluasi otomatis tingkat kesukaran, daya pembeda, validitas, efektivitas pengecoh, dan reliabilitas dengan ekspor Excel instan.',
      'Analisis Mutu Akademik',
      '/src/assets/images/slider_petal_motif_1795305217686.jpg',
      3
    );
  }

  // Default school identity & exam event settings
  const insertDefaultSetting = db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value, is_encrypted)
    VALUES (?, ?, 0)
  `);
  insertDefaultSetting.run('school_name', 'SMK Teknologi MKC');
  insertDefaultSetting.run('exam_event_title', 'Tes Akhir Semester');
  insertDefaultSetting.run('academic_year', 'Tahun Pelajaran 2026/2027');
}

export function seedInitialSimulationData(demoPassword: string) {
  const tx = db.transaction(() => {
    const existingGuru = db.prepare("SELECT id FROM users WHERE username = 'guru_rpl'").get();
    if (existingGuru) return;

    const passHash = hashPassword(demoPassword);
    const insertUser = db.prepare(`
      INSERT INTO users (username, full_name, role, class_name, password_hash, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    const guru1Id = Number(insertUser.run('guru_rpl', 'Budi Santoso, S.Kom.', 'guru', 'Pengampu Informatika', passHash).lastInsertRowid);
    const guru2Id = Number(insertUser.run('guru_mtk', 'Siti Rahmawati, M.Pd.', 'guru', 'Pengampu Matematika', passHash).lastInsertRowid);
    insertUser.run('pengawas1', 'Agus Wijaya, S.Pd.', 'pengawas', 'Tim Pengawas Ruang 1', passHash);

    const studentIds: number[] = [];
    const sampleNames = [
      'Ahmad Fauzi', 'Putri Lestari', 'Rizky Pratama', 'Nadia Salsabila', 'Dimas Saputra',
      'Aulia Rahman', 'Citra Dewi', 'Bagas Kurniawan', 'Intan Permata', 'Fajar Nugroho',
      'Salsa Amelia', 'Rendi Hidayat', 'Melati Kusuma', 'Yoga Mahendra', 'Tari Oktaviani',
    ];
    for (let i = 0; i < sampleNames.length; i++) {
      const uname = `siswa${String(i + 1).padStart(2, '0')}`;
      const cls = i < 8 ? 'XII TKJ 1' : 'XII RPL 1';
      const sid = Number(insertUser.run(uname, sampleNames[i], 'siswa', cls, passHash).lastInsertRowid);
      studentIds.push(sid);
    }

    // Guru 1 Bank Soal (with all 6 question types)
    const bank1Id = Number(
      db.prepare(`
        INSERT INTO question_banks (owner_id, title, subject, grade_level, description)
        VALUES (?, 'Sumatif Akhir Semester Jaringan & Sistem Digital', 'Informatika & TKJ', 'XII', 'Paket evaluasi lengkap 6 tipe soal standar MKC CBT.')
      `).run(guru1Id).lastInsertRowid
    );

    const insertQ = db.prepare(`
      INSERT INTO questions (bank_id, owner_id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, difficulty_tag, explanation, sort_order)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)
    `);

    const q1Id = Number(insertQ.run(
      bank1Id, guru1Id, 'PG',
      'Protokol lapisan transport yang menjamin pengiriman paket data secara andal dengan mekanisme handshake dan acknowledgment adalah...',
      JSON.stringify([
        { id: 'A', text: 'UDP (User Datagram Protocol)' },
        { id: 'B', text: 'TCP (Transmission Control Protocol)' },
        { id: 'C', text: 'ICMP (Internet Control Message Protocol)' },
        { id: 'D', text: 'ARP (Address Resolution Protocol)' },
        { id: 'E', text: 'DHCP (Dynamic Host Configuration Protocol)' },
      ]),
      JSON.stringify({ correct: 'B' }),
      10, 'Mudah', 'TCP bersifat connection-oriented dan menjamin integritas pengiriman data.', 1
    ).lastInsertRowid);

    const q2Id = Number(insertQ.run(
      bank1Id, guru1Id, 'PG',
      'Jika sebuah jaringan lokal menggunakan subnet mask 255.255.255.224 (/27), berapakah jumlah host yang dapat digunakan secara valid pada satu subnet?',
      JSON.stringify([
        { id: 'A', text: '14 host' },
        { id: 'B', text: '30 host' },
        { id: 'C', text: '32 host' },
        { id: 'D', text: '62 host' },
        { id: 'E', text: '254 host' },
      ]),
      JSON.stringify({ correct: 'B' }),
      10, 'Sedang', 'Prefix /27 menyisakan 5 bit host: (2^5) - 2 = 30 alamat host valid.', 2
    ).lastInsertRowid);

    const q3Id = Number(insertQ.run(
      bank1Id, guru1Id, 'PGK',
      'Manakah di antara pernyataan berikut yang termasuk prinsip keamanan informasi dalam triad CIA dan praktik pengamanan server? (Pilih lebih dari satu jawaban benar)',
      JSON.stringify([
        { id: 'A', text: 'Confidentiality — menjaga kerahasiaan data dengan enkripsi' },
        { id: 'B', text: 'Integrity — memastikan data tidak dimodifikasi secara tidak sah' },
        { id: 'C', text: 'Availability — memastikan layanan tetap dapat diakses pengguna berwenang' },
        { id: 'D', text: 'Menyimpan kata sandi dalam bentuk teks biasa agar mudah dibaca' },
      ]),
      JSON.stringify({ correct: ['A', 'B', 'C'], partialCredit: true }),
      15, 'Sedang', 'Triad CIA terdiri dari Confidentiality, Integrity, dan Availability.', 3
    ).lastInsertRowid);

    const q4Id = Number(insertQ.run(
      bank1Id, guru1Id, 'BS',
      'Tentukan nilai kebenaran dari setiap pernyataan mengenai arsitektur HTTP dan caching peramban berikut:',
      JSON.stringify([
        { id: '1', statement: 'HTTPS menggunakan enkripsi TLS untuk melindungi komunikasi antara klien dan server.' },
        { id: '2', statement: 'Metode HTTP GET sebaiknya digunakan untuk mengirim kata sandi pengguna dalam URL.' },
        { id: '3', statement: 'Penyimpanan lokal di peramban memungkinkan aplikasi ujian menyimpan jawaban sementara saat koneksi terputus.' },
      ]),
      JSON.stringify({ correct: { '1': 'B', '2': 'S', '3': 'B' } }),
      15, 'Sedang', 'HTTPS mengenkripsi transport dengan TLS, sedangkan kata sandi tidak boleh dikirim via query URL GET.', 4
    ).lastInsertRowid);

    const q5Id = Number(insertQ.run(
      bank1Id, guru1Id, 'JODOH',
      'Pasangkan port standar layanan jaringan di sebelah kiri dengan nama protokol yang sesuai di sebelah kanan:',
      JSON.stringify({
        left: [
          { id: 'L1', text: 'Port 22' },
          { id: 'L2', text: 'Port 80' },
          { id: 'L3', text: 'Port 443' },
        ],
        right: [
          { id: 'R1', text: 'HTTPS (HTTP Secure)' },
          { id: 'R2', text: 'SSH (Secure Shell)' },
          { id: 'R3', text: 'HTTP (Hypertext Transfer Protocol)' },
        ],
      }),
      JSON.stringify({ pairs: { L1: 'R2', L2: 'R3', L3: 'R1' } }),
      15, 'Sedang', 'SSH menggunakan port 22, HTTP port 80, dan HTTPS port 443.', 5
    ).lastInsertRowid);

    const q6Id = Number(insertQ.run(
      bank1Id, guru1Id, 'ISIAN',
      'Apa kepanjangan singkatan dari DNS dalam sistem penamaan domain internet? (Tulis dalam bahasa Inggris)',
      JSON.stringify({ caseSensitive: false }),
      JSON.stringify({ accepted: ['domain name system', 'domain name server'] }),
      10, 'Mudah', 'DNS adalah singkatan dari Domain Name System.', 6
    ).lastInsertRowid);

    const q7Id = Number(insertQ.run(
      bank1Id, guru1Id, 'ESAI',
      'Jelaskan langkah-langkah mitigasi yang harus dilakukan administrator sekolah ketika terjadi lonjakan koneksi bersamaan dari ratusan peserta ujian CBT!',
      JSON.stringify({ rubric: 'Sebutkan caching soal, pengiriman jawaban bertahap (batch), mode WAL/pooling database, dan cadangan offline lokal.' }),
      JSON.stringify({ referenceAnswer: 'Mengirim paket soal sekali dan memanfaatkan cache browser, melakukan batching pengiriman jawaban, mengoptimalkan koneksi/WAL database, serta menyediakan penyimpanan offline otomatis.' }),
      25, 'Sukar', 'Penilaian esai mengacu pada kelengkapan aspek caching, batching, dan reliabilitas database.', 7
    ).lastInsertRowid);

    // Guru 2 Isolated Bank Soal (proves Guru 1 cannot view/open Guru 2's bank!)
    const bank2Id = Number(
      db.prepare(`
        INSERT INTO question_banks (owner_id, title, subject, grade_level, description)
        VALUES (?, 'Bank Soal Matematika Terapan — Khusus Guru Matematika', 'Matematika', 'XII', 'Bank soal privat milik Ibu Siti Rahmawati (terisolasi dari guru lain).')
      `).run(guru2Id).lastInsertRowid
    );
    insertQ.run(
      bank2Id, guru2Id, 'PG',
      'Jika fungsi f(x) = 3x^2 - 4x + 2, berapakah nilai turunan pertama f\'(2)?',
      JSON.stringify([
        { id: 'A', text: '4' },
        { id: 'B', text: '8' },
        { id: 'C', text: '10' },
        { id: 'D', text: '12' },
        { id: 'E', text: '16' },
      ]),
      JSON.stringify({ correct: 'B' }),
      10, 'Sedang', 'f\'(x) = 6x - 4, maka f\'(2) = 12 - 4 = 8.', 1
    );

    // Create 1 Active Exam for Guru 1
    const exam1Id = Number(
      db.prepare(`
        INSERT INTO exams (bank_id, owner_id, title, token_code, duration_minutes, max_violations, shuffle_questions, shuffle_options, show_result_to_student, status, target_classes)
        VALUES (?, ?, 'Ujian Sumatif Informatika XII (Demo Lengkap)', 'MKC2026', 90, 3, 1, 0, 1, 'ACTIVE', 'ALL')
      `).run(bank1Id, guru1Id).lastInsertRowid
    );

    // Populate 12 realistic completed student submissions so Item Analysis & Manual Grading work immediately!
    // Leave siswa13, siswa14, siswa15 ready to take the exam fresh!
    const insertSession = db.prepare(`
      INSERT INTO exam_sessions (exam_id, student_id, status, violation_count, question_order_json, started_at, submitted_at, auto_score, manual_score_adjustment, final_score, grading_status)
      VALUES (?, ?, 'SUBMITTED', ?, ?, datetime('now', '-45 minutes'), datetime('now', '-5 minutes'), ?, 0, ?, ?)
    `);
    const insertAns = db.prepare(`
      INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, auto_score, manual_score, is_manually_graded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const qOrder = JSON.stringify([q1Id, q2Id, q3Id, q4Id, q5Id, q6Id, q7Id]);
    const totalMax = 100;

    for (let i = 0; i < 12; i++) {
      const sid = studentIds[i];
      // Ability gradient from high (i=0..3) to medium (i=4..7) to low (i=8..11) for authentic discrimination statistics!
      const tier = i < 4 ? 'high' : i < 8 ? 'mid' : 'low';
      const ans1 = tier === 'high' ? 'B' : tier === 'mid' ? (i % 2 === 0 ? 'B' : 'A') : (i % 3 === 0 ? 'B' : i % 2 === 0 ? 'C' : 'A');
      const s1 = ans1 === 'B' ? 10 : 0;

      const ans2 = tier === 'high' ? 'B' : tier === 'mid' ? (i === 5 ? 'C' : 'B') : (i === 9 ? 'B' : i % 2 === 0 ? 'A' : 'D');
      const s2 = ans2 === 'B' ? 10 : 0;

      const ans3 = tier === 'high' ? ['A', 'B', 'C'] : tier === 'mid' ? ['A', 'B'] : ['A', 'D'];
      const s3 = tier === 'high' ? 15 : tier === 'mid' ? 10 : 2.5;

      const ans4 = tier === 'high'
        ? { '1': 'B', '2': 'S', '3': 'B' }
        : tier === 'mid'
          ? { '1': 'B', '2': 'B', '3': 'B' }
          : { '1': 'S', '2': 'B', '3': 'B' };
      const s4 = tier === 'high' ? 15 : tier === 'mid' ? 10 : 5;

      const ans5 = tier === 'high'
        ? { L1: 'R2', L2: 'R3', L3: 'R1' }
        : tier === 'mid'
          ? { L1: 'R2', L2: 'R1', L3: 'R3' }
          : { L1: 'R1', L2: 'R2', L3: 'R3' };
      const s5 = tier === 'high' ? 15 : tier === 'mid' ? 5 : 0;

      const ans6 = tier === 'high' ? 'Domain Name System' : tier === 'mid' ? (i % 2 === 0 ? 'domain name system' : 'Data Name Server') : 'Dynamic Network';
      const s6 = ans6.toLowerCase() === 'domain name system' ? 10 : 0;

      const ans7 = tier === 'high'
        ? 'Mengirim soal sekali dengan cache peramban, mengirim jawaban secara berkelompok (batch), mengaktifkan SQLite WAL, dan menyediakan antrean offline.'
        : tier === 'mid'
          ? 'Memakai cache di browser dan menyimpan jawaban jika internet putus.'
          : 'Memperbesar bandwidth wifi ruang lab.';
      const manualEsai = i < 9 ? (tier === 'high' ? 23 : tier === 'mid' ? 15 : 8) : null;
      const isGraded = manualEsai !== null ? 1 : 0;
      const earnedSum = s1 + s2 + s3 + s4 + s5 + s6 + (manualEsai ?? 0);
      const finalPct = Number(((earnedSum / totalMax) * 100).toFixed(2));
      const gradingStatus = isGraded ? 'GRADED' : 'NEEDS_REVIEW';

      const sessId = Number(
        insertSession.run(exam1Id, sid, i === 10 ? 1 : 0, qOrder, finalPct, finalPct, gradingStatus).lastInsertRowid
      );

      insertAns.run(sessId, exam1Id, sid, q1Id, JSON.stringify(ans1), s1, null, 0);
      insertAns.run(sessId, exam1Id, sid, q2Id, JSON.stringify(ans2), s2, null, 0);
      insertAns.run(sessId, exam1Id, sid, q3Id, JSON.stringify(ans3), s3, null, 0);
      insertAns.run(sessId, exam1Id, sid, q4Id, JSON.stringify(ans4), s4, null, 0);
      insertAns.run(sessId, exam1Id, sid, q5Id, JSON.stringify(ans5), s5, null, 0);
      insertAns.run(sessId, exam1Id, sid, q6Id, JSON.stringify(ans6), s6, null, 0);
      insertAns.run(sessId, exam1Id, sid, q7Id, JSON.stringify(ans7), 0, manualEsai, isGraded);
    }
  });

  tx();
}

export function getUplDirs() {
  return { UPLOADS_DIR, QUESTION_UPLOADS_DIR, SLIDER_UPLOADS_DIR };
}
