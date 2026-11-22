import compression from 'compression';
import crypto from 'crypto';
import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import {
  AuthTokenPayload,
  decryptSecret,
  encryptSecret,
  hashPassword,
  maskSecret,
  signAuthToken,
  verifyAuthToken,
  verifyPasswordAsync,
} from './server/crypto.js';
import { db, getUplDirs, initDatabase, seedInitialSimulationData } from './server/db.js';
import { gradeQuestionAnswer, QuestionType } from './server/grading.js';
import { buildExamGradingExcel, buildItemAnalysisExcel, computeExamItemAnalysis } from './server/itemAnalysis.js';
import { generateWordTemplateBuffer, parseWordDocx } from './server/wordImport.js';

initDatabase();

const { UPLOADS_DIR, QUESTION_UPLOADS_DIR, SLIDER_UPLOADS_DIR } = getUplDirs();

interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}

// ============================================================================
// High-Concurrency In-Memory Exam Payload Cache (1000+ concurrent students)
// ============================================================================
interface CachedExamQuestion {
  id: number;
  qType: QuestionType;
  promptText: string;
  imageUrl: string;
  options: any;
  maxScore: number;
  sortOrder: number;
}

interface CachedExam {
  id: number;
  bankId: number;
  ownerId: number;
  title: string;
  tokenCode: string;
  durationMinutes: number;
  maxViolations: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showResultToStudent: boolean;
  status: string;
  targetClasses: string;
  startAt: string;
  endAt: string;
  questions: CachedExamQuestion[];
}

const examCache = new Map<number, CachedExam>();

function invalidateExamCacheByExamId(examId: number) {
  examCache.delete(examId);
}

function invalidateExamCacheByBankId(bankId: number) {
  const rows = db.prepare('SELECT id FROM exams WHERE bank_id = ?').all(bankId) as Array<{ id: number }>;
  for (const r of rows) {
    examCache.delete(r.id);
  }
}

function getCachedExam(examId: number): CachedExam | null {
  const hit = examCache.get(examId);
  if (hit) return hit;

  const examRow = db.prepare(`
    SELECT id, bank_id, owner_id, title, token_code, duration_minutes, max_violations,
           shuffle_questions, shuffle_options, show_result_to_student, status, target_classes, start_at, end_at
    FROM exams WHERE id = ?
  `).get(examId) as any;

  if (!examRow) return null;

  const qRows = db.prepare(`
    SELECT id, q_type, prompt_text, image_url, options_json, max_score, sort_order
    FROM questions
    WHERE bank_id = ?
    ORDER BY sort_order ASC, id ASC
  `).all(examRow.bank_id) as any[];

  const cached: CachedExam = {
    id: examRow.id,
    bankId: examRow.bank_id,
    ownerId: examRow.owner_id,
    title: examRow.title,
    tokenCode: examRow.token_code,
    durationMinutes: examRow.duration_minutes,
    maxViolations: examRow.max_violations,
    shuffleQuestions: Boolean(examRow.shuffle_questions),
    shuffleOptions: Boolean(examRow.shuffle_options),
    showResultToStudent: Boolean(examRow.show_result_to_student),
    status: examRow.status,
    targetClasses: examRow.target_classes,
    startAt: examRow.start_at || '',
    endAt: examRow.end_at || '',
    questions: qRows.map((q) => {
      let parsedOpts: any = {};
      try { parsedOpts = JSON.parse(q.options_json || '{}'); } catch { parsedOpts = {}; }
      return {
        id: q.id,
        qType: q.q_type as QuestionType,
        promptText: q.prompt_text,
        imageUrl: q.image_url || '',
        options: parsedOpts,
        maxScore: q.max_score,
        sortOrder: q.sort_order,
      };
    }),
  };

  examCache.set(examId, cached);
  return cached;
}

// Helper: recalculate total session score cleanly
function recalculateSessionScore(sessionId: number) {
  const session = db.prepare('SELECT exam_id, manual_score_adjustment FROM exam_sessions WHERE id = ?').get(sessionId) as {
    exam_id: number;
    manual_score_adjustment: number;
  } | undefined;
  if (!session) return 0;

  const exam = db.prepare('SELECT bank_id FROM exams WHERE id = ?').get(session.exam_id) as { bank_id: number } | undefined;
  if (!exam) return 0;

  const totalMaxRow = db.prepare('SELECT COALESCE(SUM(max_score), 0) as totalMax FROM questions WHERE bank_id = ?').get(exam.bank_id) as {
    totalMax: number;
  };
  const totalMax = totalMaxRow.totalMax || 100;

  const answers = db.prepare(`
    SELECT a.auto_score, a.manual_score, a.is_manually_graded, q.q_type
    FROM student_answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.session_id = ?
  `).all(sessionId) as Array<{
    auto_score: number;
    manual_score: number | null;
    is_manually_graded: number;
    q_type: string;
  }>;

  let earnedTotal = 0;
  let ungradedEssay = false;

  for (const a of answers) {
    if (a.is_manually_graded && a.manual_score !== null) {
      earnedTotal += a.manual_score;
    } else {
      earnedTotal += a.auto_score;
      if (a.q_type === 'ESAI') {
        ungradedEssay = true;
      }
    }
  }

  // Also check if bank has ESAI questions not yet answered
  const essayCount = (db.prepare("SELECT COUNT(*) as c FROM questions WHERE bank_id = ? AND q_type = 'ESAI'").get(exam.bank_id) as { c: number }).c;
  const gradedEssayCount = (db.prepare(`
    SELECT COUNT(*) as c FROM student_answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.session_id = ? AND q.q_type = 'ESAI' AND a.is_manually_graded = 1
  `).get(sessionId) as { c: number }).c;

  if (essayCount > gradedEssayCount) ungradedEssay = true;

  const autoPct = Number(((earnedTotal / totalMax) * 100).toFixed(2));
  const finalPct = Math.max(0, Math.min(100, Number((autoPct + (session.manual_score_adjustment || 0)).toFixed(2))));
  const gradingStatus = ungradedEssay ? 'NEEDS_REVIEW' : 'GRADED';

  db.prepare(`
    UPDATE exam_sessions
    SET auto_score = ?, final_score = ?, grading_status = ?
    WHERE id = ?
  `).run(autoPct, finalPct, gradingStatus, sessionId);

  return finalPct;
}

// ============================================================================
// Multer Upload Configuration (Images & Word .docx)
// ============================================================================
const ALLOWED_IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function createImageUploader(targetDir: string) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, targetDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ALLOWED_IMG_EXT.has(ext) ? ext : '.png';
        cb(null, `${crypto.randomUUID()}${safeExt}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Hanya berkas gambar (PNG, JPG, WEBP, GIF) yang diizinkan'));
    },
  });
}

const uploadQuestionImage = createImageUploader(QUESTION_UPLOADS_DIR);
const uploadSlideImage = createImageUploader(SLIDER_UPLOADS_DIR);
const uploadDocx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ============================================================================
// Auth Middlewares
// ============================================================================
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk terlebih dahulu.' });
    return;
  }
  const token = header.slice(7).trim();
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token sesi kedaluwarsa atau tidak valid.' });
    return;
  }
  req.user = payload;
  next();
}

function requireRole(...roles: Array<AuthTokenPayload['role']>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Akses ditolak: peran akun tidak memiliki izin untuk halaman ini.' });
      return;
    }
    next();
  };
}

// ============================================================================
// Express App Setup
// ============================================================================
async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  // Serve uploaded images safely
  app.use('/uploads', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  }, express.static(UPLOADS_DIR));

  // --------------------------------------------------------------------------
  // Public Endpoints (Health, Login Slides, Auth Status & Login)
  // --------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'MKC CBT', timestamp: new Date().toISOString() });
  });

  app.get('/api/public/bootstrap', (_req, res) => {
    const slides = db.prepare(`
      SELECT id, title, subtitle, badge_label, image_url, sort_order
      FROM login_slides
      WHERE is_active = 1
      ORDER BY sort_order ASC, id ASC
    `).all();
    const schoolRow = db.prepare("SELECT value FROM system_settings WHERE key = 'school_name'").get() as { value: string } | undefined;
    const eventRow = db.prepare("SELECT value FROM system_settings WHERE key = 'exam_event_title'").get() as { value: string } | undefined;
    const yearRow = db.prepare("SELECT value FROM system_settings WHERE key = 'academic_year'").get() as { value: string } | undefined;
    const logoRow = db.prepare("SELECT value FROM system_settings WHERE key = 'school_logo_url'").get() as { value: string } | undefined;
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    const envAdminSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
    res.json({
      schoolName: schoolRow?.value || 'SMK Teknologi MKC',
      examEventTitle: eventRow?.value || 'Tes Akhir Semester',
      academicYear: yearRow?.value || 'Tahun Pelajaran 2026/2027',
      schoolLogoUrl: logoRow?.value || '',
      needsAdminSetup: adminCount === 0 && !envAdminSet,
      slides,
    });
  });

  // One-time atomic first-run admin claim when no admin exists & ADMIN_PASSCODE is unset
  app.post('/api/auth/setup-admin', (req, res) => {
    const envAdminSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
    if (envAdminSet) {
      res.status(403).json({ error: 'Setup awal dinonaktifkan karena ADMIN_PASSCODE telah dikonfigurasi di server.' });
      return;
    }
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    if (adminCount > 0) {
      res.status(409).json({ error: 'Akun Admin sudah aktif.' });
      return;
    }

    const { fullName, schoolName, adminPassword, includeSimulationData, demoUsersPassword } = req.body || {};
    if (!adminPassword || String(adminPassword).length < 6) {
      res.status(400).json({ error: 'Kata sandi Admin minimal 6 karakter.' });
      return;
    }
    if (includeSimulationData && (!demoUsersPassword || String(demoUsersPassword).length < 4)) {
      res.status(400).json({ error: 'Kata sandi akun simulasi minimal 4 karakter.' });
      return;
    }

    const cleanSchool = String(schoolName || 'SMK Teknologi MKC').trim().slice(0, 120);
    const cleanName = String(fullName || 'Administrator MKC').trim().slice(0, 120);
    const passHash = hashPassword(String(adminPassword));

    db.prepare(`
      INSERT INTO users (username, full_name, role, class_name, password_hash, is_active)
      VALUES ('admin', ?, 'admin', 'Operator Utama', ?, 1)
    `).run(cleanName, passHash);

    db.prepare(`
      INSERT INTO system_settings (key, value, is_encrypted)
      VALUES ('school_name', ?, 0)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(cleanSchool);

    if (includeSimulationData) {
      seedInitialSimulationData(String(demoUsersPassword));
    }

    const adminUser = db.prepare("SELECT id, username, full_name, role, class_name FROM users WHERE username = 'admin'").get() as any;
    const token = signAuthToken({
      userId: adminUser.id,
      username: adminUser.username,
      role: 'admin',
      fullName: adminUser.full_name,
      className: adminUser.class_name,
    });

    res.json({
      token,
      user: {
        id: adminUser.id,
        username: adminUser.username,
        fullName: adminUser.full_name,
        role: adminUser.role,
        className: adminUser.class_name,
      },
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username dan kata sandi wajib diisi.' });
      return;
    }

    const cleanUser = String(username).trim();
    const rawPass = String(password);

    // Check process.env.ADMIN_PASSCODE override for username 'admin'
    const envAdminPass = process.env.ADMIN_PASSCODE?.trim();
    if (cleanUser.toLowerCase() === 'admin' && envAdminPass) {
      if (rawPass === envAdminPass) {
        let adminRow = db.prepare("SELECT id, username, full_name, role, class_name FROM users WHERE username = 'admin'").get() as any;
        if (!adminRow) {
          const newId = Number(
            db.prepare(`
              INSERT INTO users (username, full_name, role, class_name, password_hash, is_active)
              VALUES ('admin', 'Administrator MKC', 'admin', 'Operator Utama', ?, 1)
            `).run(hashPassword(envAdminPass)).lastInsertRowid
          );
          adminRow = { id: newId, username: 'admin', full_name: 'Administrator MKC', role: 'admin', class_name: 'Operator Utama' };
        }
        const token = signAuthToken({
          userId: adminRow.id,
          username: adminRow.username,
          role: 'admin',
          fullName: adminRow.full_name,
          className: adminRow.class_name,
        });
        res.json({
          token,
          user: {
            id: adminRow.id,
            username: adminRow.username,
            fullName: adminRow.full_name,
            role: adminRow.role,
            className: adminRow.class_name,
          },
        });
        return;
      }
      res.status(401).json({ error: 'Username atau kata sandi salah.' });
      return;
    }

    const user = db.prepare(`
      SELECT id, username, full_name, role, class_name, password_hash, is_active
      FROM users WHERE username = ?
    `).get(cleanUser) as any;

    if (!user || !user.is_active || !(await verifyPasswordAsync(rawPass, user.password_hash))) {
      res.status(401).json({ error: 'Username atau kata sandi salah.' });
      return;
    }

    const token = signAuthToken({
      userId: user.id,
      username: user.username,
      role: user.role,
      fullName: user.full_name,
      className: user.class_name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        className: user.class_name,
      },
    });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // --------------------------------------------------------------------------
  // Admin Routes (Slider Config, Users, Encrypted API Key, Simulation & Hosting)
  // --------------------------------------------------------------------------
  app.get('/api/admin/slides', requireAuth, requireRole('admin'), (_req, res) => {
    const slides = db.prepare('SELECT * FROM login_slides ORDER BY sort_order ASC, id ASC').all();
    res.json({ slides });
  });

  app.post('/api/admin/slides/upload', requireAuth, requireRole('admin'), uploadSlideImage.single('image'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas gambar tidak ditemukan.' });
      return;
    }
    res.json({ imageUrl: `/uploads/slides/${req.file.filename}` });
  });

  app.post('/api/admin/slides', requireAuth, requireRole('admin'), (req, res) => {
    const { title, subtitle, badge_label, image_url, sort_order, is_active } = req.body || {};
    if (!title || !subtitle || !image_url) {
      res.status(400).json({ error: 'Judul, deskripsi, dan URL gambar slide wajib diisi.' });
      return;
    }
    const id = Number(
      db.prepare(`
        INSERT INTO login_slides (title, subtitle, badge_label, image_url, sort_order, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        String(title).trim(),
        String(subtitle).trim(),
        String(badge_label || 'MKC CBT').trim(),
        String(image_url).trim(),
        Number(sort_order) || 1,
        is_active === false || is_active === 0 ? 0 : 1
      ).lastInsertRowid
    );
    res.json({ id });
  });

  app.put('/api/admin/slides/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const { title, subtitle, badge_label, image_url, sort_order, is_active } = req.body || {};
    db.prepare(`
      UPDATE login_slides
      SET title = ?, subtitle = ?, badge_label = ?, image_url = ?, sort_order = ?, is_active = ?
      WHERE id = ?
    `).run(
      String(title || '').trim(),
      String(subtitle || '').trim(),
      String(badge_label || 'MKC CBT').trim(),
      String(image_url || '').trim(),
      Number(sort_order) || 1,
      is_active === false || is_active === 0 ? 0 : 1,
      id
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/slides/:id', requireAuth, requireRole('admin'), (req, res) => {
    db.prepare('DELETE FROM login_slides WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // User Management
  app.get('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
    const roleFilter = String(req.query.role || '');
    const users = roleFilter
      ? db.prepare('SELECT id, username, full_name, role, class_name, is_active, created_at FROM users WHERE role = ? ORDER BY id DESC').all(roleFilter)
      : db.prepare('SELECT id, username, full_name, role, class_name, is_active, created_at FROM users ORDER BY role ASC, id DESC').all();
    res.json({ users });
  });

  app.post('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
    const { username, fullName, role, className, password } = req.body || {};
    if (!username || !fullName || !role || !password) {
      res.status(400).json({ error: 'Username, nama lengkap, peran, dan kata sandi wajib diisi.' });
      return;
    }
    if (!['admin', 'guru', 'pengawas', 'siswa'].includes(role)) {
      res.status(400).json({ error: 'Peran tidak valid.' });
      return;
    }
    try {
      const id = Number(
        db.prepare(`
          INSERT INTO users (username, full_name, role, class_name, password_hash, is_active)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(String(username).trim(), String(fullName).trim(), role, String(className || '').trim(), hashPassword(String(password))).lastInsertRowid
      );
      res.json({ id });
    } catch (err: any) {
      res.status(409).json({ error: 'Username sudah terdaftar.' });
    }
  });

  app.post('/api/admin/users/bulk-students', requireAuth, requireRole('admin'), (req, res) => {
    const { prefix, count, className, password } = req.body || {};
    const total = Math.min(1000, Math.max(1, Number(count) || 10));
    if (!prefix || !password) {
      res.status(400).json({ error: 'Prefix username dan kata sandi bawaan wajib diisi.' });
      return;
    }
    const passHash = hashPassword(String(password));
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (username, full_name, role, class_name, password_hash, is_active)
      VALUES (?, ?, 'siswa', ?, ?, 1)
    `);
    let created = 0;
    const tx = db.transaction(() => {
      for (let i = 1; i <= total; i++) {
        const uname = `${String(prefix).trim()}${String(i).padStart(4, '0')}`;
        const info = insert.run(uname, `Peserta ${uname}`, String(className || 'XII').trim(), passHash);
        created += info.changes;
      }
    });
    tx();
    res.json({ created });
  });

  app.delete('/api/admin/users/:id', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (id === req.user?.userId) {
      res.status(400).json({ error: 'Tidak dapat menghapus akun Anda sendiri.' });
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // System Settings & AES-256-GCM Encrypted API Key
  app.get('/api/admin/settings', requireAuth, requireRole('admin'), (_req, res) => {
    const rows = db.prepare('SELECT key, value, is_encrypted, updated_at FROM system_settings').all() as Array<{
      key: string;
      value: string;
      is_encrypted: number;
      updated_at: string;
    }>;
    const map: Record<string, any> = {};
    for (const r of rows) {
      if (r.is_encrypted) {
        const decrypted = decryptSecret(r.value);
        map[r.key] = {
          configured: Boolean(r.value),
          masked: decrypted ? maskSecret(decrypted) : '•••••••• (Terenkripsi AES-256-GCM)',
          updatedAt: r.updated_at,
        };
      } else {
        map[r.key] = r.value;
      }
    }
    res.json({
      schoolName: map.school_name || 'SMK Teknologi MKC',
      examEventTitle: map.exam_event_title || 'Tes Akhir Semester',
      academicYear: map.academic_year || 'Tahun Pelajaran 2026/2027',
      schoolLogoUrl: map.school_logo_url || '',
      encryptedApiKey: map.encrypted_api_key || { configured: false, masked: '', updatedAt: null },
      apiProviderLabel: map.api_provider_label || 'Integrasi Eksternal / Sinkronisasi CBT',
    });
  });

  app.post('/api/admin/settings', requireAuth, requireRole('admin'), (req, res) => {
    const { schoolName, examEventTitle, academicYear, schoolLogoUrl, apiProviderLabel, newApiKey } = req.body || {};
    const upsert = db.prepare(`
      INSERT INTO system_settings (key, value, is_encrypted, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_encrypted = excluded.is_encrypted, updated_at = datetime('now')
    `);

    if (schoolName !== undefined) {
      upsert.run('school_name', String(schoolName).trim(), 0);
    }
    if (examEventTitle !== undefined) {
      upsert.run('exam_event_title', String(examEventTitle).trim(), 0);
    }
    if (academicYear !== undefined) {
      upsert.run('academic_year', String(academicYear).trim(), 0);
    }
    if (schoolLogoUrl !== undefined) {
      upsert.run('school_logo_url', String(schoolLogoUrl).trim(), 0);
    }
    if (apiProviderLabel !== undefined) {
      upsert.run('api_provider_label', String(apiProviderLabel).trim(), 0);
    }
    if (newApiKey && String(newApiKey).trim().length > 0) {
      const encrypted = encryptSecret(String(newApiKey).trim());
      upsert.run('encrypted_api_key', encrypted, 1);
    }

    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Teacher / Admin Routes — Question Banks (Strict Teacher Isolation!)
  // --------------------------------------------------------------------------
  app.get('/api/teacher/banks', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const banks = user.role === 'admin'
      ? db.prepare(`
          SELECT qb.*, u.full_name as owner_name, u.username as owner_username,
                 (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count
          FROM question_banks qb
          JOIN users u ON u.id = qb.owner_id
          ORDER BY qb.id DESC
        `).all()
      : db.prepare(`
          SELECT qb.*, u.full_name as owner_name, u.username as owner_username,
                 (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count
          FROM question_banks qb
          JOIN users u ON u.id = qb.owner_id
          WHERE qb.owner_id = ?
          ORDER BY qb.id DESC
        `).all(user.userId);
    res.json({ banks });
  });

  app.post('/api/teacher/banks', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const { title, subject, gradeLevel, description } = req.body || {};
    if (!title || !subject) {
      res.status(400).json({ error: 'Judul bank soal dan mata pelajaran wajib diisi.' });
      return;
    }
    const id = Number(
      db.prepare(`
        INSERT INTO question_banks (owner_id, title, subject, grade_level, description)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        req.user!.userId,
        String(title).trim(),
        String(subject).trim(),
        String(gradeLevel || '').trim(),
        String(description || '').trim()
      ).lastInsertRowid
    );
    res.json({ id });
  });

  // Helper to verify ownership of a bank
  function assertBankAccess(bankId: number, user: AuthTokenPayload, res: Response): any | null {
    const bank = db.prepare('SELECT * FROM question_banks WHERE id = ?').get(bankId) as any;
    if (!bank) {
      res.status(404).json({ error: 'Bank soal tidak ditemukan.' });
      return null;
    }
    if (user.role !== 'admin' && bank.owner_id !== user.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat membuka bank soal milik guru lain.' });
      return null;
    }
    return bank;
  }

  app.get('/api/teacher/banks/:bankId', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const bankId = Number(req.params.bankId);
    const bank = assertBankAccess(bankId, req.user!, res);
    if (!bank) return;

    const questions = db.prepare(`
      SELECT id, bank_id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, difficulty_tag, explanation, sort_order
      FROM questions WHERE bank_id = ? ORDER BY sort_order ASC, id ASC
    `).all(bankId);
    res.json({ bank, questions });
  });

  app.delete('/api/teacher/banks/:bankId', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const bankId = Number(req.params.bankId);
    const bank = assertBankAccess(bankId, req.user!, res);
    if (!bank) return;
    invalidateExamCacheByBankId(bankId);
    db.prepare('DELETE FROM question_banks WHERE id = ?').run(bankId);
    res.json({ ok: true });
  });

  // Upload question image
  app.post('/api/teacher/questions/upload-image', requireAuth, requireRole('guru', 'admin'), uploadQuestionImage.single('image'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Berkas gambar tidak valid.' });
      return;
    }
    res.json({ imageUrl: `/uploads/questions/${req.file.filename}` });
  });

  // Add single or batch questions (used both for manual creator and after Word import preview confirmation)
  app.post('/api/teacher/banks/:bankId/questions', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const bankId = Number(req.params.bankId);
    const bank = assertBankAccess(bankId, req.user!, res);
    if (!bank) return;

    const items = Array.isArray(req.body?.questions) ? req.body.questions : [req.body];
    if (items.length === 0) {
      res.status(400).json({ error: 'Tidak ada soal untuk disimpan.' });
      return;
    }

    const maxSortRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM questions WHERE bank_id = ?').get(bankId) as { m: number };
    let nextSort = maxSortRow.m + 1;

    const insert = db.prepare(`
      INSERT INTO questions (bank_id, owner_id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, difficulty_tag, explanation, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertedIds: number[] = [];
    const tx = db.transaction(() => {
      for (const item of items) {
        const qType = String(item.qType || item.q_type || 'PG').toUpperCase();
        if (!['PG', 'PGK', 'BS', 'JODOH', 'ISIAN', 'ESAI'].includes(qType)) continue;
        const promptText = String(item.promptText || item.prompt_text || '').trim();
        if (!promptText) continue;

        const optsJson = typeof item.options === 'string' ? item.options : JSON.stringify(item.options ?? {});
        const keyJson = typeof item.answerKey === 'string' ? item.answerKey : JSON.stringify(item.answerKey ?? {});
        const newId = Number(
          insert.run(
            bankId,
            bank.owner_id,
            qType,
            promptText,
            String(item.imageUrl || item.image_url || ''),
            optsJson,
            keyJson,
            Number(item.maxScore || item.max_score) || 10,
            String(item.difficultyTag || item.difficulty_tag || 'Sedang'),
            String(item.explanation || ''),
            nextSort++
          ).lastInsertRowid
        );
        insertedIds.push(newId);
      }
      db.prepare("UPDATE question_banks SET updated_at = datetime('now') WHERE id = ?").run(bankId);
    });
    tx();
    invalidateExamCacheByBankId(bankId);
    res.json({ insertedCount: insertedIds.length, insertedIds });
  });

  app.put('/api/teacher/questions/:questionId', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const qId = Number(req.params.questionId);
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(qId) as any;
    if (!q) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && q.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat mengubah soal milik guru lain.' });
      return;
    }

    const { qType, promptText, imageUrl, options, answerKey, maxScore, difficultyTag, explanation } = req.body || {};
    db.prepare(`
      UPDATE questions
      SET q_type = ?, prompt_text = ?, image_url = ?, options_json = ?, answer_key_json = ?, max_score = ?, difficulty_tag = ?, explanation = ?
      WHERE id = ?
    `).run(
      String(qType || q.q_type),
      String(promptText || q.prompt_text),
      String(imageUrl ?? q.image_url),
      options !== undefined ? JSON.stringify(options) : q.options_json,
      answerKey !== undefined ? JSON.stringify(answerKey) : q.answer_key_json,
      Number(maxScore) || q.max_score,
      String(difficultyTag || q.difficulty_tag),
      String(explanation ?? q.explanation),
      qId
    );
    invalidateExamCacheByBankId(q.bank_id);
    res.json({ ok: true });
  });

  app.delete('/api/teacher/questions/:questionId', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const qId = Number(req.params.questionId);
    const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(qId) as any;
    if (!q) {
      res.status(404).json({ error: 'Soal tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && q.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }
    db.prepare('DELETE FROM questions WHERE id = ?').run(qId);
    invalidateExamCacheByBankId(q.bank_id);
    res.json({ ok: true });
  });

  // Download Word Template (.docx)
  app.get('/api/teacher/word-template', requireAuth, requireRole('guru', 'admin'), async (_req, res) => {
    try {
      const buf = await generateWordTemplateBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="Template_Soal_MKC_CBT.docx"');
      res.send(buf);
    } catch (err: any) {
      res.status(500).json({ error: 'Gagal membuat template Word.' });
    }
  });

  // Parse Word (.docx) and return preview array WITHOUT saving to DB yet!
  app.post('/api/teacher/import-word/preview', requireAuth, requireRole('guru', 'admin'), uploadDocx.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Silakan pilih berkas Microsoft Word (.docx).' });
      return;
    }
    try {
      const parsed = await parseWordDocx(req.file.buffer, QUESTION_UPLOADS_DIR);
      res.json({ previewQuestions: parsed });
    } catch (err: any) {
      res.status(400).json({ error: 'Gagal membaca berkas .docx. Pastikan format dokumen Word valid.' });
    }
  });

  // Teacher Encrypted API Key Status (read-only masked info for teacher)
  app.get('/api/teacher/encryption-status', requireAuth, requireRole('guru', 'admin'), (_req, res) => {
    const row = db.prepare("SELECT value, updated_at FROM system_settings WHERE key = 'encrypted_api_key'").get() as any;
    const labelRow = db.prepare("SELECT value FROM system_settings WHERE key = 'api_provider_label'").get() as any;
    res.json({
      configured: Boolean(row?.value),
      label: labelRow?.value || 'Integrasi Sistem',
      updatedAt: row?.updated_at || null,
      algorithm: 'AES-256-GCM',
    });
  });

  // --------------------------------------------------------------------------
  // Teacher / Admin Routes — Exams, Classes, Grading & Item Analysis
  // --------------------------------------------------------------------------
  app.get('/api/teacher/classes', requireAuth, requireRole('guru', 'admin'), (_req, res) => {
    const classes = db.prepare(`
      SELECT TRIM(class_name) as class_name, COUNT(*) as student_count
      FROM users
      WHERE role = 'siswa' AND is_active = 1 AND TRIM(class_name) != ''
      GROUP BY TRIM(class_name)
      ORDER BY TRIM(class_name) ASC
    `).all();
    res.json({ classes });
  });

  app.get('/api/teacher/exams', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const query = user.role === 'admin'
      ? `SELECT e.*, qb.title as bank_title, qb.subject, u.full_name as owner_name,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id) as session_count,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count
         FROM exams e
         JOIN question_banks qb ON qb.id = e.bank_id
         JOIN users u ON u.id = e.owner_id
         ORDER BY e.id DESC`
      : `SELECT e.*, qb.title as bank_title, qb.subject, u.full_name as owner_name,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id) as session_count,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count,
                (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count
         FROM exams e
         JOIN question_banks qb ON qb.id = e.bank_id
         JOIN users u ON u.id = e.owner_id
         WHERE e.owner_id = ?
         ORDER BY e.id DESC`;
    const exams = user.role === 'admin' ? db.prepare(query).all() : db.prepare(query).all(user.userId);
    res.json({ exams });
  });

  app.post('/api/teacher/exams', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const {
      bankId,
      title,
      tokenCode,
      durationMinutes,
      maxViolations,
      shuffleQuestions,
      shuffleOptions,
      showResultToStudent,
      status,
      targetClasses,
      startAt,
      endAt,
    } = req.body || {};
    const bank = assertBankAccess(Number(bankId), req.user!, res);
    if (!bank) return;

    const cleanStart = String(startAt || '').trim();
    const cleanEnd = String(endAt || '').trim();
    if (cleanStart && cleanEnd && new Date(cleanEnd).getTime() <= new Date(cleanStart).getTime()) {
      res.status(400).json({ error: 'Tanggal & jam selesai ujian harus lebih akhir dari waktu mulai.' });
      return;
    }

    const qCount = (db.prepare('SELECT COUNT(*) as c FROM questions WHERE bank_id = ?').get(bank.id) as { c: number }).c;
    if (qCount === 0) {
      res.status(400).json({ error: 'Bank soal masih kosong. Tambahkan minimal 1 soal sebelum membuat ujian.' });
      return;
    }

    const token = String(tokenCode || crypto.randomBytes(3).toString('hex')).toUpperCase().slice(0, 10);
    const id = Number(
      db.prepare(`
        INSERT INTO exams (bank_id, owner_id, title, token_code, duration_minutes, max_violations, shuffle_questions, shuffle_options, show_result_to_student, status, target_classes, start_at, end_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        bank.id,
        bank.owner_id,
        String(title || `Ujian ${bank.title}`).trim(),
        token,
        Math.max(5, Number(durationMinutes) || 60),
        Math.max(1, Number(maxViolations) || 3),
        shuffleQuestions ? 1 : 0,
        shuffleOptions ? 1 : 0,
        showResultToStudent !== false ? 1 : 0,
        ['DRAFT', 'ACTIVE', 'CLOSED'].includes(status) ? status : 'ACTIVE',
        String(targetClasses || 'ALL').trim() || 'ALL',
        cleanStart,
        cleanEnd
      ).lastInsertRowid
    );
    res.json({ id, tokenCode: token });
  });

  app.patch('/api/teacher/exams/:examId/schedule', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const { startAt, endAt, targetClasses, durationMinutes, maxViolations } = req.body || {};
    const cleanStart = String(startAt ?? exam.start_at ?? '').trim();
    const cleanEnd = String(endAt ?? exam.end_at ?? '').trim();
    if (cleanStart && cleanEnd && new Date(cleanEnd).getTime() <= new Date(cleanStart).getTime()) {
      res.status(400).json({ error: 'Tanggal & jam selesai ujian harus lebih akhir dari waktu mulai.' });
      return;
    }

    const cleanClasses = String(targetClasses ?? exam.target_classes ?? 'ALL').trim() || 'ALL';
    const cleanDuration = durationMinutes !== undefined ? Math.max(5, Number(durationMinutes) || 60) : exam.duration_minutes;
    const cleanMaxVio = maxViolations !== undefined ? Math.max(1, Number(maxViolations) || 3) : exam.max_violations;

    db.prepare(`
      UPDATE exams
      SET start_at = ?, end_at = ?, target_classes = ?, duration_minutes = ?, max_violations = ?
      WHERE id = ?
    `).run(cleanStart, cleanEnd, cleanClasses, cleanDuration, cleanMaxVio, examId);

    invalidateExamCacheByExamId(examId);
    res.json({ ok: true });
  });

  app.patch('/api/teacher/exams/:examId/status', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }
    const { status } = req.body || {};
    if (!['DRAFT', 'ACTIVE', 'CLOSED'].includes(status)) {
      res.status(400).json({ error: 'Status tidak valid.' });
      return;
    }
    db.prepare('UPDATE exams SET status = ? WHERE id = ?').run(status, examId);
    invalidateExamCacheByExamId(examId);
    res.json({ ok: true });
  });

  app.delete('/api/teacher/exams/:examId', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT id, owner_id FROM exams WHERE id = ?').get(examId) as { id: number; owner_id: number } | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Jadwal ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak berhak menghapus jadwal ujian guru lain.' });
      return;
    }

    db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
    invalidateExamCacheByExamId(examId);
    res.json({ ok: true });
  });

  // Manual & Automatic Grading View for an Exam
  app.get('/api/teacher/exams/:examId/grading', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki akses ke hasil ujian guru lain.' });
      return;
    }

    const sessions = db.prepare(`
      SELECT es.*, u.username, u.full_name, u.class_name
      FROM exam_sessions es
      JOIN users u ON u.id = es.student_id
      WHERE es.exam_id = ?
      ORDER BY es.submitted_at DESC, es.id DESC
    `).all(examId);

    const questions = db.prepare(`
      SELECT id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, sort_order
      FROM questions WHERE bank_id = ? ORDER BY sort_order ASC, id ASC
    `).all(exam.bank_id);

    res.json({ exam, sessions, questions });
  });

  app.get('/api/teacher/exams/:examId/grading/excel', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT id, owner_id, title FROM exams WHERE id = ?').get(examId) as
      | { id: number; owner_id: number; title: string }
      | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki akses ke hasil ujian guru lain.' });
      return;
    }

    const buf = buildExamGradingExcel(examId);
    if (!buf) {
      res.status(404).json({ error: 'Data nilai ujian tidak ditemukan.' });
      return;
    }
    const safeTitle = exam.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Rekap_Nilai_${safeTitle}.xlsx"`);
    res.send(buf);
  });

  app.get('/api/teacher/sessions/:sessionId/answers', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare(`
      SELECT es.*, e.owner_id, e.bank_id, e.title as exam_title, u.username, u.full_name, u.class_name
      FROM exam_sessions es
      JOIN exams e ON e.id = es.exam_id
      JOIN users u ON u.id = es.student_id
      WHERE es.id = ?
    `).get(sessionId) as any;

    if (!session) {
      res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && session.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const questions = db.prepare(`
      SELECT q.*, a.id as answer_id, a.answer_json, a.auto_score, a.manual_score, a.teacher_note, a.is_manually_graded
      FROM questions q
      LEFT JOIN student_answers a ON a.question_id = q.id AND a.session_id = ?
      WHERE q.bank_id = ?
      ORDER BY q.sort_order ASC, q.id ASC
    `).all(sessionId, session.bank_id);

    res.json({ session, questions });
  });

  // Teacher manually grades or overrides score for ANY question type + optional session adjustment
  app.post('/api/teacher/sessions/:sessionId/grade', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare(`
      SELECT es.*, e.owner_id, e.bank_id
      FROM exam_sessions es
      JOIN exams e ON e.id = es.exam_id
      WHERE es.id = ?
    `).get(sessionId) as any;

    if (!session) {
      res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && session.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const { grades, manualScoreAdjustment } = req.body || {};
    const tx = db.transaction(() => {
      if (Array.isArray(grades)) {
        const upsertManual = db.prepare(`
          INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, auto_score, manual_score, teacher_note, is_manually_graded, updated_at)
          VALUES (?, ?, ?, ?, 'null', 0, ?, ?, 1, datetime('now'))
          ON CONFLICT(session_id, question_id) DO UPDATE SET
            manual_score = excluded.manual_score,
            teacher_note = excluded.teacher_note,
            is_manually_graded = 1,
            updated_at = datetime('now')
        `);
        const resetManual = db.prepare(`
          UPDATE student_answers
          SET manual_score = NULL, is_manually_graded = 0, teacher_note = ?, updated_at = datetime('now')
          WHERE session_id = ? AND question_id = ?
        `);
        for (const g of grades) {
          if (g.useAutoScore) {
            resetManual.run(String(g.teacherNote || ''), sessionId, Number(g.questionId));
          } else {
            upsertManual.run(
              sessionId,
              session.exam_id,
              session.student_id,
              Number(g.questionId),
              Math.max(0, Number(g.manualScore) || 0),
              String(g.teacherNote || '')
            );
          }
        }
      }
      if (manualScoreAdjustment !== undefined) {
        db.prepare('UPDATE exam_sessions SET manual_score_adjustment = ? WHERE id = ?')
          .run(Number(manualScoreAdjustment) || 0, sessionId);
      }
    });
    tx();

    const newFinal = recalculateSessionScore(sessionId);
    res.json({ ok: true, finalScore: newFinal });
  });

  // Re-run automatic grading for all sessions in an exam (useful if key was fixed)
  app.post('/api/teacher/exams/:examId/regrade-auto', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(examId) as any;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const questions = db.prepare('SELECT id, q_type, options_json, answer_key_json, max_score FROM questions WHERE bank_id = ?').all(exam.bank_id) as any[];
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const sessions = db.prepare("SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'SUBMITTED'").all(examId) as Array<{ id: number }>;

    const tx = db.transaction(() => {
      const updateAns = db.prepare('UPDATE student_answers SET auto_score = ? WHERE id = ?');
      for (const sess of sessions) {
        const answers = db.prepare('SELECT id, question_id, answer_json FROM student_answers WHERE session_id = ?').all(sess.id) as any[];
        for (const a of answers) {
          const q = qMap.get(a.question_id);
          if (!q) continue;
          let parsed: unknown = null;
          try { parsed = JSON.parse(a.answer_json); } catch { parsed = null; }
          const score = gradeQuestionAnswer(q.q_type, q.options_json, q.answer_key_json, q.max_score, parsed);
          updateAns.run(score, a.id);
        }
        recalculateSessionScore(sess.id);
      }
    });
    tx();
    res.json({ ok: true, regradedSessions: sessions.length });
  });

  // Item Analysis (JSON + Excel Export)
  app.get('/api/teacher/exams/:examId/analysis', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT owner_id FROM exams WHERE id = ?').get(examId) as { owner_id: number } | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat melihat analisis ujian guru lain.' });
      return;
    }

    const report = computeExamItemAnalysis(examId);
    res.json({ report });
  });

  app.get('/api/teacher/exams/:examId/analysis/excel', requireAuth, requireRole('guru', 'admin'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT owner_id, title FROM exams WHERE id = ?').get(examId) as { owner_id: number; title: string } | undefined;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const report = computeExamItemAnalysis(examId);
    if (!report) {
      res.status(404).json({ error: 'Data analisis tidak tersedia.' });
      return;
    }
    const buf = buildItemAnalysisExcel(report);
    const safeTitle = exam.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Analisis_Butir_${safeTitle}.xlsx"`);
    res.send(buf);
  });

  // --------------------------------------------------------------------------
  // Proctor Routes (Live Monitoring, Violation Logs, Unlock Locked Exams)
  // --------------------------------------------------------------------------
  app.get('/api/proctor/exams', requireAuth, requireRole('pengawas', 'admin', 'guru'), (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const exams = user.role === 'guru'
      ? db.prepare(`
          SELECT e.id, e.title, e.token_code, e.status, e.max_violations, e.duration_minutes,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'IN_PROGRESS') as active_count,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count
          FROM exams e WHERE e.owner_id = ? ORDER BY e.id DESC
        `).all(user.userId)
      : db.prepare(`
          SELECT e.id, e.title, e.token_code, e.status, e.max_violations, e.duration_minutes,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'IN_PROGRESS') as active_count,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count,
                 (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count
          FROM exams e ORDER BY e.id DESC
        `).all();
    res.json({ exams });
  });

  app.get('/api/proctor/exams/:examId/monitor', requireAuth, requireRole('pengawas', 'admin', 'guru'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const exam = db.prepare('SELECT id, title, owner_id, max_violations, token_code, status FROM exams WHERE id = ?').get(examId) as any;
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }
    if (req.user!.role === 'guru' && exam.owner_id !== req.user!.userId) {
      res.status(403).json({ error: 'Akses ditolak.' });
      return;
    }

    const sessions = db.prepare(`
      SELECT es.id, es.student_id, es.status, es.violation_count, es.unlock_count, es.locked_reason,
             es.started_at, es.last_sync_at, es.submitted_at, es.final_score,
             u.username, u.full_name, u.class_name,
             (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = es.id AND sa.answer_json != 'null' AND sa.answer_json != '""') as answered_count
      FROM exam_sessions es
      JOIN users u ON u.id = es.student_id
      WHERE es.exam_id = ?
      ORDER BY CASE es.status WHEN 'LOCKED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, es.last_sync_at DESC
    `).all(examId);

    const recentViolations = db.prepare(`
      SELECT v.*, u.username, u.full_name, u.class_name
      FROM violation_logs v
      JOIN users u ON u.id = v.student_id
      WHERE v.exam_id = ?
      ORDER BY v.id DESC
      LIMIT 60
    `).all(examId);

    res.json({ exam, sessions, recentViolations });
  });

  // Unlock a locked student exam session — ONLY Proctor or Admin!
  app.post('/api/proctor/sessions/:sessionId/unlock', requireAuth, requireRole('pengawas', 'admin'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId) as any;
    if (!session) {
      res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
      return;
    }
    if (session.status !== 'LOCKED') {
      res.status(400).json({ error: 'Sesi ini tidak dalam kondisi terkunci.' });
      return;
    }

    const { resetViolations } = req.body || {};
    db.prepare(`
      UPDATE exam_sessions
      SET status = 'IN_PROGRESS',
          violation_count = ?,
          unlock_count = unlock_count + 1,
          locked_reason = '',
          unlocked_by = ?,
          last_sync_at = datetime('now')
      WHERE id = ?
    `).run(resetViolations ? 0 : Math.max(0, session.violation_count - 1), req.user!.userId, sessionId);

    db.prepare(`
      INSERT INTO violation_logs (session_id, exam_id, student_id, violation_type, detail)
      VALUES (?, ?, ?, 'PROCTOR_UNLOCK', ?)
    `).run(sessionId, session.exam_id, session.student_id, `Dibuka kembali oleh pengawas: ${req.user!.fullName}`);

    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Student Exam Routes (High-Concurrency Cached Delivery & Batched Sync)
  // --------------------------------------------------------------------------
  function isClassAllowed(targetClasses: string, studentClass: string): boolean {
    const cleanTarget = (targetClasses || 'ALL').trim();
    if (!cleanTarget || cleanTarget.toUpperCase() === 'ALL') return true;
    const allowedList = cleanTarget
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return allowedList.includes((studentClass || '').trim().toLowerCase());
  }

  function computeScheduleState(startAt: string, endAt: string): 'UPCOMING' | 'OPEN' | 'EXPIRED' {
    const now = Date.now();
    if (startAt) {
      const sMs = new Date(startAt).getTime();
      if (!Number.isNaN(sMs) && now < sMs) return 'UPCOMING';
    }
    if (endAt) {
      const eMs = new Date(endAt).getTime();
      if (!Number.isNaN(eMs) && now > eMs) return 'EXPIRED';
    }
    return 'OPEN';
  }

  app.get('/api/student/exams', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
    const studentId = req.user!.userId;
    const studentClass = req.user!.className || '';
    const rawExams = db.prepare(`
      SELECT e.id, e.title, e.duration_minutes, e.max_violations, e.show_result_to_student, e.status, e.target_classes, e.start_at, e.end_at,
             qb.subject,
             (SELECT COUNT(*) FROM questions q WHERE q.bank_id = e.bank_id) as question_count,
             es.id as session_id, es.status as session_status, es.violation_count, es.final_score, es.submitted_at
      FROM exams e
      JOIN question_banks qb ON qb.id = e.bank_id
      LEFT JOIN exam_sessions es ON es.exam_id = e.id AND es.student_id = ?
      WHERE e.status = 'ACTIVE' OR es.id IS NOT NULL
      ORDER BY e.id DESC
    `).all(studentId) as any[];

    const exams = rawExams
      .filter((ex) => ex.session_id !== null || isClassAllowed(ex.target_classes, studentClass))
      .map((ex) => ({
        ...ex,
        schedule_state: computeScheduleState(ex.start_at || '', ex.end_at || ''),
      }));

    res.json({ exams });
  });

  // Start or resume exam: returns full exam questions ONCE (served from RAM cache!)
  app.post('/api/student/exams/:examId/start', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
    const examId = Number(req.params.examId);
    const studentId = req.user!.userId;
    const { tokenCode } = req.body || {};

    const cached = getCachedExam(examId);
    if (!cached) {
      res.status(404).json({ error: 'Ujian tidak ditemukan.' });
      return;
    }

    let session = db.prepare('SELECT * FROM exam_sessions WHERE exam_id = ? AND student_id = ?').get(examId, studentId) as any;

    if (!session) {
      if (cached.status !== 'ACTIVE') {
        res.status(403).json({ error: 'Ujian belum aktif atau sudah ditutup.' });
        return;
      }
      if (!isClassAllowed(cached.targetClasses, req.user!.className || '')) {
        res.status(403).json({ error: `Ujian ini hanya diperuntukkan bagi kelas: ${cached.targetClasses}.` });
        return;
      }
      const schedState = computeScheduleState(cached.startAt, cached.endAt);
      if (schedState === 'UPCOMING') {
        res.status(403).json({ error: 'Jadwal ujian belum dimulai. Silakan tunggu sesuai waktu mulai.' });
        return;
      }
      if (schedState === 'EXPIRED') {
        res.status(403).json({ error: 'Batas jadwal pelaksanaan ujian sudah berakhir.' });
        return;
      }
      if (String(tokenCode || '').trim().toUpperCase() !== cached.tokenCode.toUpperCase()) {
        res.status(403).json({ error: 'Token ujian tidak sesuai. Periksa kembali token dari pengawas.' });
        return;
      }

      const qIds = cached.questions.map((q) => q.id);
      if (cached.shuffleQuestions) {
        for (let i = qIds.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [qIds[i], qIds[j]] = [qIds[j], qIds[i]];
        }
      }

      const sessId = Number(
        db.prepare(`
          INSERT INTO exam_sessions (exam_id, student_id, status, question_order_json, started_at, last_sync_at)
          VALUES (?, ?, 'IN_PROGRESS', ?, datetime('now'), datetime('now'))
        `).run(examId, studentId, JSON.stringify(qIds)).lastInsertRowid
      );

      session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessId);
    }

    // Order questions according to student's assigned sequence (never exposes answerKey!)
    let orderIds: number[] = [];
    try { orderIds = JSON.parse(session.question_order_json || '[]'); } catch { orderIds = []; }
    const qMap = new Map(cached.questions.map((q) => [q.id, q]));
    const orderedQuestions = orderIds.length > 0
      ? orderIds.map((id) => qMap.get(id)).filter(Boolean)
      : cached.questions;

    // Fetch any previously saved answers if resuming
    const savedRows = db.prepare('SELECT question_id, answer_json FROM student_answers WHERE session_id = ?').all(session.id) as Array<{
      question_id: number;
      answer_json: string;
    }>;
    const savedAnswers: Record<number, unknown> = {};
    for (const r of savedRows) {
      try { savedAnswers[r.question_id] = JSON.parse(r.answer_json); } catch { /* ignore */ }
    }

    // Compute remaining seconds based on started_at and optional exam endAt cutoff
    const startedMs = new Date(session.started_at + 'Z').getTime();
    const elapsedSec = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    let remainingSeconds = Math.max(0, cached.durationMinutes * 60 - elapsedSec);
    if (cached.endAt) {
      const endMs = new Date(cached.endAt).getTime();
      if (!Number.isNaN(endMs)) {
        const untilEndSec = Math.max(0, Math.floor((endMs - Date.now()) / 1000));
        remainingSeconds = Math.min(remainingSeconds, untilEndSec);
      }
    }

    res.json({
      session: {
        id: session.id,
        examId: cached.id,
        status: session.status,
        violationCount: session.violation_count,
        maxViolations: cached.maxViolations,
        lockedReason: session.locked_reason,
        remainingSeconds,
        durationMinutes: cached.durationMinutes,
        title: cached.title,
        showResultToStudent: cached.showResultToStudent,
        finalScore: session.final_score,
      },
      questions: orderedQuestions,
      savedAnswers,
    });
  });

  // Check unlock status while student screen is locked (lightweight polling)
  app.get('/api/student/sessions/:sessionId/status', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare(`
      SELECT es.id, es.student_id, es.status, es.violation_count, es.locked_reason, e.max_violations
      FROM exam_sessions es
      JOIN exams e ON e.id = es.exam_id
      WHERE es.id = ?
    `).get(sessionId) as any;

    if (!session || session.student_id !== req.user!.userId) {
      res.status(404).json({ error: 'Sesi tidak ditemukan.' });
      return;
    }

    res.json({
      status: session.status,
      violationCount: session.violation_count,
      maxViolations: session.max_violations,
      lockedReason: session.locked_reason,
    });
  });

  // Batched Answer & Violation Sync (Atomic Single-Transaction SQLite Write)
  const upsertAnswerStmt = db.prepare(`
    INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, question_id) DO UPDATE SET
      answer_json = excluded.answer_json,
      updated_at = datetime('now')
  `);
  const insertViolationStmt = db.prepare(`
    INSERT INTO violation_logs (session_id, exam_id, student_id, violation_type, detail)
    VALUES (?, ?, ?, ?, ?)
  `);

  app.post('/api/student/sessions/:sessionId/sync', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.student_id !== req.user!.userId) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    if (session.status === 'SUBMITTED') {
      res.json({ ok: true, status: 'SUBMITTED', violationCount: session.violation_count });
      return;
    }

    const cached = getCachedExam(session.exam_id);
    const maxViolations = cached?.maxViolations ?? 3;

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const violations = Array.isArray(req.body?.violations) ? req.body.violations : [];

    let newStatus = session.status;
    let newViolationCount = session.violation_count;
    let lockedReason = session.locked_reason || '';

    const tx = db.transaction(() => {
      // Only persist answers if session is NOT locked
      if (session.status === 'IN_PROGRESS') {
        for (const item of answers) {
          const qId = Number(item.questionId);
          if (!qId) continue;
          upsertAnswerStmt.run(
            sessionId,
            session.exam_id,
            session.student_id,
            qId,
            JSON.stringify(item.answer ?? null)
          );
        }
      }

      if (violations.length > 0 && session.status !== 'SUBMITTED') {
        for (const v of violations) {
          const vType = String(v.type || 'VIOLATION').slice(0, 40);
          const vDetail = String(v.detail || '').slice(0, 200);
          insertViolationStmt.run(sessionId, session.exam_id, session.student_id, vType, vDetail);
          newViolationCount++;
          lockedReason = vDetail || vType;
        }
      }

      if (newViolationCount >= maxViolations && newStatus === 'IN_PROGRESS') {
        newStatus = 'LOCKED';
        lockedReason = `Melebihi batas ${maxViolations} pelanggaran (${lockedReason}). Hubungi pengawas untuk membuka kunci.`;
      }

      db.prepare(`
        UPDATE exam_sessions
        SET status = ?, violation_count = ?, locked_reason = ?, last_sync_at = datetime('now')
        WHERE id = ?
      `).run(newStatus, newViolationCount, lockedReason, sessionId);
    });

    tx();

    res.json({
      ok: true,
      status: newStatus,
      violationCount: newViolationCount,
      maxViolations,
      lockedReason,
      syncedAnswers: session.status === 'IN_PROGRESS' ? answers.length : 0,
    });
  });

  // Final Submit Exam (grades all objective items automatically in one fast transaction!)
  app.post('/api/student/sessions/:sessionId/submit', requireAuth, requireRole('siswa'), (req: AuthenticatedRequest, res) => {
    const sessionId = Number(req.params.sessionId);
    const session = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(sessionId) as any;
    if (!session || session.student_id !== req.user!.userId) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
      return;
    }

    if (session.status === 'LOCKED') {
      res.status(403).json({ error: 'Ujian sedang terkunci karena pelanggaran. Pengawas harus membuka kunci terlebih dahulu.' });
      return;
    }

    if (session.status === 'SUBMITTED') {
      res.json({ ok: true, finalScore: session.final_score, status: 'SUBMITTED' });
      return;
    }

    const exam = db.prepare('SELECT bank_id, show_result_to_student FROM exams WHERE id = ?').get(session.exam_id) as any;
    const questions = db.prepare('SELECT id, q_type, options_json, answer_key_json, max_score FROM questions WHERE bank_id = ?').all(exam.bank_id) as any[];
    const qMap = new Map(questions.map((q) => [q.id, q]));

    const finalAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    const tx = db.transaction(() => {
      for (const item of finalAnswers) {
        const qId = Number(item.questionId);
        if (!qId) continue;
        upsertAnswerStmt.run(sessionId, session.exam_id, session.student_id, qId, JSON.stringify(item.answer ?? null));
      }

      const savedAnswers = db.prepare('SELECT id, question_id, answer_json FROM student_answers WHERE session_id = ?').all(sessionId) as any[];
      const updateAuto = db.prepare('UPDATE student_answers SET auto_score = ? WHERE id = ?');

      for (const sa of savedAnswers) {
        const q = qMap.get(sa.question_id);
        if (!q) continue;
        let parsed: unknown = null;
        try { parsed = JSON.parse(sa.answer_json); } catch { parsed = null; }
        const score = gradeQuestionAnswer(q.q_type, q.options_json, q.answer_key_json, q.max_score, parsed);
        updateAuto.run(score, sa.id);
      }

      db.prepare(`
        UPDATE exam_sessions
        SET status = 'SUBMITTED', submitted_at = datetime('now'), last_sync_at = datetime('now')
        WHERE id = ?
      `).run(sessionId);
    });

    tx();
    const finalScore = recalculateSessionScore(sessionId);

    res.json({
      ok: true,
      status: 'SUBMITTED',
      showResultToStudent: Boolean(exam.show_result_to_student),
      finalScore: exam.show_result_to_student ? finalScore : null,
    });
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Dist (Production Hosting)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = app.listen(PORT, '0.0.0.0', 2048, () => {
    console.log(`MKC CBT Server berjalan pada http://0.0.0.0:${PORT}`);
  });
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  httpServer.requestTimeout = 60000;
}

startServer().catch((err) => {
  console.error('Gagal memulai server MKC CBT:', err);
  process.exit(1);
});
