import compression from 'compression';
import crypto from 'crypto';
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
} from './crypto.js';
import {
  db,
  getUploadedFile,
  getUplDirs,
  initDatabase,
  nowIso,
  parseDbDateMs,
  saveUploadedFile,
  seedInitialSimulationData,
} from './db.js';
import { gradeQuestionAnswer, QuestionType } from './grading.js';
import { buildExamGradingExcel, buildItemAnalysisExcel, computeExamItemAnalysis } from './itemAnalysis.js';
import { generateWordTemplateBuffer, parseWordDocx } from './wordImport.js';

const { UPLOADS_DIR } = getUplDirs();

export interface AuthenticatedRequest extends Request {
  user?: AuthTokenPayload;
}

// Express 4 async wrapper so rejected promises always route to Express error middleware
type AsyncHandler = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void> | void;
const ah = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// ============================================================================
// High-Concurrency In-Memory Exam Payload Cache
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

async function invalidateExamCacheByBankId(bankId: number) {
  const rows = await db.all<{ id: number }>('SELECT id FROM exams WHERE bank_id = ?', [bankId]);
  for (const r of rows) {
    examCache.delete(r.id);
  }
}

async function getCachedExam(examId: number): Promise<CachedExam | null> {
  const hit = examCache.get(examId);
  if (hit) return hit;

  const examRow = await db.get<any>(
    `
    SELECT id, bank_id, owner_id, title, token_code, duration_minutes, max_violations,
           shuffle_questions, shuffle_options, show_result_to_student, status, target_classes, start_at, end_at
    FROM exams WHERE id = ?
  `,
    [examId]
  );

  if (!examRow) return null;

  const qRows = await db.all<any>(
    `
    SELECT id, q_type, prompt_text, image_url, options_json, max_score, sort_order
    FROM questions
    WHERE bank_id = ?
    ORDER BY sort_order ASC, id ASC
  `,
    [examRow.bank_id]
  );

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
      try {
        parsedOpts = JSON.parse(q.options_json || '{}');
      } catch {
        parsedOpts = {};
      }
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
async function recalculateSessionScore(sessionId: number): Promise<number> {
  const session = await db.get<{ exam_id: number; manual_score_adjustment: number }>(
    'SELECT exam_id, manual_score_adjustment FROM exam_sessions WHERE id = ?',
    [sessionId]
  );
  if (!session) return 0;

  const exam = await db.get<{ bank_id: number }>('SELECT bank_id FROM exams WHERE id = ?', [session.exam_id]);
  if (!exam) return 0;

  const totalMaxRow = await db.get<{ totalmax?: number; totalMax?: number }>(
    'SELECT COALESCE(SUM(max_score), 0) as totalMax FROM questions WHERE bank_id = ?',
    [exam.bank_id]
  );
  const totalMax = Number(totalMaxRow?.totalMax ?? totalMaxRow?.totalmax ?? 100) || 100;

  const answers = await db.all<{
    auto_score: number;
    manual_score: number | null;
    is_manually_graded: number;
    q_type: string;
  }>(
    `
    SELECT a.auto_score, a.manual_score, a.is_manually_graded, q.q_type
    FROM student_answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.session_id = ?
  `,
    [sessionId]
  );

  let earnedTotal = 0;
  let ungradedEssay = false;

  for (const a of answers) {
    if (a.is_manually_graded && a.manual_score !== null) {
      earnedTotal += Number(a.manual_score);
    } else {
      earnedTotal += Number(a.auto_score || 0);
      if (a.q_type === 'ESAI') {
        ungradedEssay = true;
      }
    }
  }

  const essayCountRow = await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM questions WHERE bank_id = ? AND q_type = 'ESAI'",
    [exam.bank_id]
  );
  const gradedEssayRow = await db.get<{ c: number }>(
    `
    SELECT COUNT(*) as c FROM student_answers a
    JOIN questions q ON q.id = a.question_id
    WHERE a.session_id = ? AND q.q_type = 'ESAI' AND a.is_manually_graded = 1
  `,
    [sessionId]
  );

  if ((essayCountRow?.c ?? 0) > (gradedEssayRow?.c ?? 0)) ungradedEssay = true;

  const autoPct = Number(((earnedTotal / totalMax) * 100).toFixed(2));
  const finalPct = Math.max(0, Math.min(100, Number((autoPct + Number(session.manual_score_adjustment || 0)).toFixed(2))));
  const gradingStatus = ungradedEssay ? 'NEEDS_REVIEW' : 'GRADED';

  await db.run(
    `
    UPDATE exam_sessions
    SET auto_score = ?, final_score = ?, grading_status = ?
    WHERE id = ?
  `,
    [autoPct, finalPct, gradingStatus, sessionId]
  );

  return finalPct;
}

// ============================================================================
// Multer Memory-Storage Upload Configuration (Serverless-Safe for Vercel + Neon)
// ============================================================================
const ALLOWED_IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const uploadImageMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya berkas gambar (PNG, JPG, WEBP, GIF) yang diizinkan'));
  },
});

const uploadDocx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function buildSafeImageFilename(originalName: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  const safeExt = ALLOWED_IMG_EXT.has(ext) ? ext : '.png';
  return `${crypto.randomUUID()}${safeExt}`;
}

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

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  // Ensure database schema + default seeds exist before handling API or upload requests (cold-start safe for Vercel)
  app.use(['/api', '/uploads'], ah(async (_req, _res, next) => {
    await initDatabase();
    next();
  }));

  // Serve uploaded images safely from DB (persists across Neon/Vercel serverless) with local disk fallback
  app.get(
    '/uploads/:bucket/:filename',
    ah(async (req, res) => {
      const bucket = String(req.params.bucket || '');
      const filename = String(req.params.filename || '');
      if ((bucket !== 'questions' && bucket !== 'slides') || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
        res.status(404).end();
        return;
      }

      const dbFile = await getUploadedFile(bucket, filename);
      if (dbFile) {
        res.setHeader('Content-Type', dbFile.mimeType);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(dbFile.buffer);
        return;
      }

      // Local filesystem fallback for pre-existing disk files
      const diskPath = path.resolve(UPLOADS_DIR, bucket, filename);
      if (diskPath.startsWith(path.resolve(UPLOADS_DIR, bucket) + path.sep) && fs.existsSync(diskPath)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(diskPath);
        return;
      }

      res.status(404).end();
    })
  );

  // --------------------------------------------------------------------------
  // Public Endpoints (Health, Login Slides, Auth Status & Login)
  // --------------------------------------------------------------------------
  app.get('/api/health', ah(async (_req, res) => {
    await db.get('SELECT 1 as ok');
    res.json({
      ok: true,
      app: 'MKC CBT',
      database: db.isPostgres ? 'postgresql' : 'sqlite',
      timestamp: new Date().toISOString(),
    });
  }));

  app.get(
    '/api/public/bootstrap',
    ah(async (_req, res) => {
      const slides = await db.all(`
        SELECT id, title, subtitle, badge_label, image_url, sort_order
        FROM login_slides
        WHERE is_active = 1
        ORDER BY sort_order ASC, id ASC
      `);
      const schoolRow = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'school_name'");
      const eventRow = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'exam_event_title'");
      const yearRow = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'academic_year'");
      const logoRow = await db.get<{ value: string }>("SELECT value FROM system_settings WHERE key = 'school_logo_url'");
      const adminCountRow = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE role = 'admin'");
      const adminCount = Number(adminCountRow?.c ?? 0);
      const envAdminSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
      res.json({
        schoolName: schoolRow?.value || 'SMK Teknologi MKC',
        examEventTitle: eventRow?.value || 'Tes Akhir Semester',
        academicYear: yearRow?.value || 'Tahun Pelajaran 2026/2027',
        schoolLogoUrl: logoRow?.value || '',
        needsAdminSetup: adminCount === 0 && !envAdminSet,
        slides,
      });
    })
  );

  // One-time atomic first-run admin claim when no admin exists & ADMIN_PASSCODE is unset
  app.post(
    '/api/auth/setup-admin',
    ah(async (req, res) => {
      const envAdminSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
      if (envAdminSet) {
        res.status(403).json({ error: 'Setup awal dinonaktifkan karena ADMIN_PASSCODE telah dikonfigurasi di server.' });
        return;
      }
      const adminCountRow = await db.get<{ c: number }>("SELECT COUNT(*) as c FROM users WHERE role = 'admin'");
      if (Number(adminCountRow?.c ?? 0) > 0) {
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
      const now = nowIso();

      await db.insertReturningId(
        `
        INSERT INTO users (username, full_name, role, class_name, password_hash, is_active, created_at)
        VALUES ('admin', ?, 'admin', 'Operator Utama', ?, 1, ?)
      `,
        [cleanName, passHash, now]
      );

      await db.run(
        `
        INSERT INTO system_settings (key, value, is_encrypted, updated_at)
        VALUES ('school_name', ?, 0, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `,
        [cleanSchool, now]
      );

      if (includeSimulationData) {
        await seedInitialSimulationData(String(demoUsersPassword));
      }

      const adminUser = await db.get<any>("SELECT id, username, full_name, role, class_name FROM users WHERE LOWER(username) = LOWER('admin')");
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
    })
  );

  app.post(
    '/api/auth/login',
    ah(async (req, res) => {
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
          let adminRow = await db.get<any>(
            "SELECT id, username, full_name, role, class_name FROM users WHERE LOWER(username) = LOWER('admin')"
          );
          if (!adminRow) {
            const newId = await db.insertReturningId(
              `
              INSERT INTO users (username, full_name, role, class_name, password_hash, is_active, created_at)
              VALUES ('admin', 'Administrator MKC', 'admin', 'Operator Utama', ?, 1, ?)
            `,
              [hashPassword(envAdminPass), nowIso()]
            );
            adminRow = {
              id: newId,
              username: 'admin',
              full_name: 'Administrator MKC',
              role: 'admin',
              class_name: 'Operator Utama',
            };
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

      const user = await db.get<any>(
        `
        SELECT id, username, full_name, role, class_name, password_hash, is_active
        FROM users WHERE LOWER(username) = LOWER(?)
      `,
        [cleanUser]
      );

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
    })
  );

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // --------------------------------------------------------------------------
  // Admin Routes (Slider Config, Users, Encrypted API Key, Simulation & Hosting)
  // --------------------------------------------------------------------------
  app.get(
    '/api/admin/slides',
    requireAuth,
    requireRole('admin'),
    ah(async (_req, res) => {
      const slides = await db.all('SELECT * FROM login_slides ORDER BY sort_order ASC, id ASC');
      res.json({ slides });
    })
  );

  app.post(
    '/api/admin/slides/upload',
    requireAuth,
    requireRole('admin'),
    uploadImageMem.single('image'),
    ah(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Berkas gambar tidak ditemukan.' });
        return;
      }
      const filename = buildSafeImageFilename(req.file.originalname);
      const imageUrl = await saveUploadedFile('slides', filename, req.file.mimetype || 'image/png', req.file.buffer);
      res.json({ imageUrl });
    })
  );

  app.post(
    '/api/admin/slides',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const { title, subtitle, badge_label, image_url, sort_order, is_active } = req.body || {};
      if (!title || !subtitle || !image_url) {
        res.status(400).json({ error: 'Judul, deskripsi, dan URL gambar slide wajib diisi.' });
        return;
      }
      const id = await db.insertReturningId(
        `
        INSERT INTO login_slides (title, subtitle, badge_label, image_url, sort_order, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          String(title).trim(),
          String(subtitle).trim(),
          String(badge_label || 'MKC CBT').trim(),
          String(image_url).trim(),
          Number(sort_order) || 1,
          is_active === false || is_active === 0 ? 0 : 1,
          nowIso(),
        ]
      );
      res.json({ id });
    })
  );

  app.put(
    '/api/admin/slides/:id',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const id = Number(req.params.id);
      const { title, subtitle, badge_label, image_url, sort_order, is_active } = req.body || {};
      await db.run(
        `
        UPDATE login_slides
        SET title = ?, subtitle = ?, badge_label = ?, image_url = ?, sort_order = ?, is_active = ?
        WHERE id = ?
      `,
        [
          String(title || '').trim(),
          String(subtitle || '').trim(),
          String(badge_label || 'MKC CBT').trim(),
          String(image_url || '').trim(),
          Number(sort_order) || 1,
          is_active === false || is_active === 0 ? 0 : 1,
          id,
        ]
      );
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/admin/slides/:id',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      await db.run('DELETE FROM login_slides WHERE id = ?', [Number(req.params.id)]);
      res.json({ ok: true });
    })
  );

  // User Management
  app.get(
    '/api/admin/users',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const roleFilter = String(req.query.role || '');
      const users = roleFilter
        ? await db.all('SELECT id, username, full_name, role, class_name, is_active, created_at FROM users WHERE role = ? ORDER BY id DESC', [
            roleFilter,
          ])
        : await db.all('SELECT id, username, full_name, role, class_name, is_active, created_at FROM users ORDER BY role ASC, id DESC');
      res.json({ users });
    })
  );

  app.post(
    '/api/admin/users',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
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
        const id = await db.insertReturningId(
          `
          INSERT INTO users (username, full_name, role, class_name, password_hash, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)
        `,
          [String(username).trim(), String(fullName).trim(), role, String(className || '').trim(), hashPassword(String(password)), nowIso()]
        );
        res.json({ id });
      } catch {
        res.status(409).json({ error: 'Username sudah terdaftar.' });
      }
    })
  );

  app.post(
    '/api/admin/users/bulk-students',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const { prefix, count, className, password } = req.body || {};
      const total = Math.min(1000, Math.max(1, Number(count) || 10));
      if (!prefix || !password) {
        res.status(400).json({ error: 'Prefix username dan kata sandi bawaan wajib diisi.' });
        return;
      }
      const passHash = hashPassword(String(password));
      const cleanClass = String(className || 'XII').trim();
      const now = nowIso();
      let created = 0;

      await db.transaction(async (tx) => {
        for (let i = 1; i <= total; i++) {
          const uname = `${String(prefix).trim()}${String(i).padStart(4, '0')}`;
          const info = await tx.run(
            `
            INSERT INTO users (username, full_name, role, class_name, password_hash, is_active, created_at)
            VALUES (?, ?, 'siswa', ?, ?, 1, ?)
            ON CONFLICT DO NOTHING
          `,
            [uname, `Peserta ${uname}`, cleanClass, passHash, now]
          );
          created += info.changes;
        }
      });

      res.json({ created });
    })
  );

  app.delete(
    '/api/admin/users/:id',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const id = Number(req.params.id);
      if (id === req.user?.userId) {
        res.status(400).json({ error: 'Tidak dapat menghapus akun Anda sendiri.' });
        return;
      }
      await db.run('DELETE FROM users WHERE id = ?', [id]);
      res.json({ ok: true });
    })
  );

  // System Settings & AES-256-GCM Encrypted API Key
  app.get(
    '/api/admin/settings',
    requireAuth,
    requireRole('admin'),
    ah(async (_req, res) => {
      const rows = await db.all<{
        key: string;
        value: string;
        is_encrypted: number;
        updated_at: string;
      }>('SELECT key, value, is_encrypted, updated_at FROM system_settings');

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
    })
  );

  app.post(
    '/api/admin/settings',
    requireAuth,
    requireRole('admin'),
    ah(async (req, res) => {
      const { schoolName, examEventTitle, academicYear, schoolLogoUrl, apiProviderLabel, newApiKey } = req.body || {};
      const upsertSql = `
        INSERT INTO system_settings (key, value, is_encrypted, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_encrypted = excluded.is_encrypted, updated_at = excluded.updated_at
      `;
      const now = nowIso();

      if (schoolName !== undefined) {
        await db.run(upsertSql, ['school_name', String(schoolName).trim(), 0, now]);
      }
      if (examEventTitle !== undefined) {
        await db.run(upsertSql, ['exam_event_title', String(examEventTitle).trim(), 0, now]);
      }
      if (academicYear !== undefined) {
        await db.run(upsertSql, ['academic_year', String(academicYear).trim(), 0, now]);
      }
      if (schoolLogoUrl !== undefined) {
        await db.run(upsertSql, ['school_logo_url', String(schoolLogoUrl).trim(), 0, now]);
      }
      if (apiProviderLabel !== undefined) {
        await db.run(upsertSql, ['api_provider_label', String(apiProviderLabel).trim(), 0, now]);
      }
      if (newApiKey && String(newApiKey).trim().length > 0) {
        const encrypted = encryptSecret(String(newApiKey).trim());
        await db.run(upsertSql, ['encrypted_api_key', encrypted, 1, now]);
      }

      res.json({ ok: true });
    })
  );

  // --------------------------------------------------------------------------
  // Teacher / Admin Routes — Question Banks (Strict Teacher Isolation!)
  // --------------------------------------------------------------------------
  app.get(
    '/api/teacher/banks',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const user = req.user!;
      const banks =
        user.role === 'admin'
          ? await db.all(`
              SELECT qb.*, u.full_name as owner_name, u.username as owner_username,
                     (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count
              FROM question_banks qb
              JOIN users u ON u.id = qb.owner_id
              ORDER BY qb.id DESC
            `)
          : await db.all(
              `
              SELECT qb.*, u.full_name as owner_name, u.username as owner_username,
                     (SELECT COUNT(*) FROM questions q WHERE q.bank_id = qb.id) as question_count
              FROM question_banks qb
              JOIN users u ON u.id = qb.owner_id
              WHERE qb.owner_id = ?
              ORDER BY qb.id DESC
            `,
              [user.userId]
            );
      res.json({ banks });
    })
  );

  app.post(
    '/api/teacher/banks',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const { title, subject, gradeLevel, description } = req.body || {};
      if (!title || !subject) {
        res.status(400).json({ error: 'Judul bank soal dan mata pelajaran wajib diisi.' });
        return;
      }
      const now = nowIso();
      const id = await db.insertReturningId(
        `
        INSERT INTO question_banks (owner_id, title, subject, grade_level, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          req.user!.userId,
          String(title).trim(),
          String(subject).trim(),
          String(gradeLevel || '').trim(),
          String(description || '').trim(),
          now,
          now,
        ]
      );
      res.json({ id });
    })
  );

  async function assertBankAccess(bankId: number, user: AuthTokenPayload, res: Response): Promise<any | null> {
    const bank = await db.get<any>('SELECT * FROM question_banks WHERE id = ?', [bankId]);
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

  app.get(
    '/api/teacher/banks/:bankId',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const bankId = Number(req.params.bankId);
      const bank = await assertBankAccess(bankId, req.user!, res);
      if (!bank) return;

      const questions = await db.all(
        `
        SELECT id, bank_id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, difficulty_tag, explanation, sort_order
        FROM questions WHERE bank_id = ? ORDER BY sort_order ASC, id ASC
      `,
        [bankId]
      );
      res.json({ bank, questions });
    })
  );

  app.delete(
    '/api/teacher/banks/:bankId',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const bankId = Number(req.params.bankId);
      const bank = await assertBankAccess(bankId, req.user!, res);
      if (!bank) return;
      await invalidateExamCacheByBankId(bankId);
      await db.run('DELETE FROM question_banks WHERE id = ?', [bankId]);
      res.json({ ok: true });
    })
  );

  // Upload question image
  app.post(
    '/api/teacher/questions/upload-image',
    requireAuth,
    requireRole('guru', 'admin'),
    uploadImageMem.single('image'),
    ah(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Berkas gambar tidak valid.' });
        return;
      }
      const filename = buildSafeImageFilename(req.file.originalname);
      const imageUrl = await saveUploadedFile('questions', filename, req.file.mimetype || 'image/png', req.file.buffer);
      res.json({ imageUrl });
    })
  );

  // Add single or batch questions (used both for manual creator and after Word import preview confirmation)
  app.post(
    '/api/teacher/banks/:bankId/questions',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const bankId = Number(req.params.bankId);
      const bank = await assertBankAccess(bankId, req.user!, res);
      if (!bank) return;

      const items = Array.isArray(req.body?.questions) ? req.body.questions : [req.body];
      if (items.length === 0) {
        res.status(400).json({ error: 'Tidak ada soal untuk disimpan.' });
        return;
      }

      const maxSortRow = await db.get<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) as m FROM questions WHERE bank_id = ?', [bankId]);
      let nextSort = Number(maxSortRow?.m ?? 0) + 1;
      const now = nowIso();

      const insertedIds: number[] = [];
      await db.transaction(async (tx) => {
        for (const item of items) {
          const qType = String(item.qType || item.q_type || 'PG').toUpperCase();
          if (!['PG', 'PGK', 'BS', 'JODOH', 'ISIAN', 'ESAI'].includes(qType)) continue;
          const promptText = String(item.promptText || item.prompt_text || '').trim();
          if (!promptText) continue;

          const optsJson = typeof item.options === 'string' ? item.options : JSON.stringify(item.options ?? {});
          const keyJson = typeof item.answerKey === 'string' ? item.answerKey : JSON.stringify(item.answerKey ?? {});
          const newId = await tx.insertReturningId(
            `
            INSERT INTO questions (bank_id, owner_id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, difficulty_tag, explanation, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
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
              nextSort++,
              now,
            ]
          );
          insertedIds.push(newId);
        }
        await tx.run('UPDATE question_banks SET updated_at = ? WHERE id = ?', [now, bankId]);
      });

      await invalidateExamCacheByBankId(bankId);
      res.json({ insertedCount: insertedIds.length, insertedIds });
    })
  );

  app.put(
    '/api/teacher/questions/:questionId',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const qId = Number(req.params.questionId);
      const q = await db.get<any>('SELECT * FROM questions WHERE id = ?', [qId]);
      if (!q) {
        res.status(404).json({ error: 'Soal tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && q.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat mengubah soal milik guru lain.' });
        return;
      }

      const { qType, promptText, imageUrl, options, answerKey, maxScore, difficultyTag, explanation } = req.body || {};
      await db.run(
        `
        UPDATE questions
        SET q_type = ?, prompt_text = ?, image_url = ?, options_json = ?, answer_key_json = ?, max_score = ?, difficulty_tag = ?, explanation = ?
        WHERE id = ?
      `,
        [
          String(qType || q.q_type),
          String(promptText || q.prompt_text),
          String(imageUrl ?? q.image_url),
          options !== undefined ? JSON.stringify(options) : q.options_json,
          answerKey !== undefined ? JSON.stringify(answerKey) : q.answer_key_json,
          Number(maxScore) || q.max_score,
          String(difficultyTag || q.difficulty_tag),
          String(explanation ?? q.explanation),
          qId,
        ]
      );
      await invalidateExamCacheByBankId(q.bank_id);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/teacher/questions/:questionId',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const qId = Number(req.params.questionId);
      const q = await db.get<any>('SELECT * FROM questions WHERE id = ?', [qId]);
      if (!q) {
        res.status(404).json({ error: 'Soal tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && q.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }
      await db.run('DELETE FROM questions WHERE id = ?', [qId]);
      await invalidateExamCacheByBankId(q.bank_id);
      res.json({ ok: true });
    })
  );

  // Download Word Template (.docx)
  app.get(
    '/api/teacher/word-template',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (_req, res) => {
      try {
        const buf = await generateWordTemplateBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="Template_Soal_MKC_CBT.docx"');
        res.send(buf);
      } catch {
        res.status(500).json({ error: 'Gagal membuat template Word.' });
      }
    })
  );

  // Parse Word (.docx) and return preview array WITHOUT saving to DB yet!
  app.post(
    '/api/teacher/import-word/preview',
    requireAuth,
    requireRole('guru', 'admin'),
    uploadDocx.single('file'),
    ah(async (req, res) => {
      if (!req.file) {
        res.status(400).json({ error: 'Silakan pilih berkas Microsoft Word (.docx).' });
        return;
      }
      try {
        const parsed = await parseWordDocx(req.file.buffer, (filename, mimeType, buf) =>
          saveUploadedFile('questions', filename, mimeType, buf)
        );
        res.json({ previewQuestions: parsed });
      } catch {
        res.status(400).json({ error: 'Gagal membaca berkas .docx. Pastikan format dokumen Word valid.' });
      }
    })
  );

  // Teacher Encrypted API Key Status (read-only masked info for teacher)
  app.get(
    '/api/teacher/encryption-status',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (_req, res) => {
      const row = await db.get<any>("SELECT value, updated_at FROM system_settings WHERE key = 'encrypted_api_key'");
      const labelRow = await db.get<any>("SELECT value FROM system_settings WHERE key = 'api_provider_label'");
      res.json({
        configured: Boolean(row?.value),
        label: labelRow?.value || 'Integrasi Sistem',
        updatedAt: row?.updated_at || null,
        algorithm: 'AES-256-GCM',
      });
    })
  );

  // --------------------------------------------------------------------------
  // Teacher / Admin Routes — Exams, Classes, Grading & Item Analysis
  // --------------------------------------------------------------------------
  app.get(
    '/api/teacher/classes',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (_req, res) => {
      const classes = await db.all(`
        SELECT TRIM(class_name) as class_name, COUNT(*) as student_count
        FROM users
        WHERE role = 'siswa' AND is_active = 1 AND TRIM(class_name) != ''
        GROUP BY TRIM(class_name)
        ORDER BY TRIM(class_name) ASC
      `);
      res.json({ classes });
    })
  );

  app.get(
    '/api/teacher/exams',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const user = req.user!;
      const exams =
        user.role === 'admin'
          ? await db.all(`
              SELECT e.*, qb.title as bank_title, qb.subject, u.full_name as owner_name,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id) as session_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count
              FROM exams e
              JOIN question_banks qb ON qb.id = e.bank_id
              JOIN users u ON u.id = e.owner_id
              ORDER BY e.id DESC
            `)
          : await db.all(
              `
              SELECT e.*, qb.title as bank_title, qb.subject, u.full_name as owner_name,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id) as session_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count
              FROM exams e
              JOIN question_banks qb ON qb.id = e.bank_id
              JOIN users u ON u.id = e.owner_id
              WHERE e.owner_id = ?
              ORDER BY e.id DESC
            `,
              [user.userId]
            );
      res.json({ exams });
    })
  );

  app.post(
    '/api/teacher/exams',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
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
      const bank = await assertBankAccess(Number(bankId), req.user!, res);
      if (!bank) return;

      const cleanStart = String(startAt || '').trim();
      const cleanEnd = String(endAt || '').trim();
      if (cleanStart && cleanEnd && new Date(cleanEnd).getTime() <= new Date(cleanStart).getTime()) {
        res.status(400).json({ error: 'Tanggal & jam selesai ujian harus lebih akhir dari waktu mulai.' });
        return;
      }

      const qCountRow = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM questions WHERE bank_id = ?', [bank.id]);
      if ((qCountRow?.c ?? 0) === 0) {
        res.status(400).json({ error: 'Bank soal masih kosong. Tambahkan minimal 1 soal sebelum membuat ujian.' });
        return;
      }

      const token = String(tokenCode || crypto.randomBytes(3).toString('hex')).toUpperCase().slice(0, 10);
      const id = await db.insertReturningId(
        `
        INSERT INTO exams (bank_id, owner_id, title, token_code, duration_minutes, max_violations, shuffle_questions, shuffle_options, show_result_to_student, status, target_classes, start_at, end_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
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
          cleanEnd,
          nowIso(),
        ]
      );
      res.json({ id, tokenCode: token });
    })
  );

  app.patch(
    '/api/teacher/exams/:examId/schedule',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<any>('SELECT * FROM exams WHERE id = ?', [examId]);
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

      await db.run(
        `
        UPDATE exams
        SET start_at = ?, end_at = ?, target_classes = ?, duration_minutes = ?, max_violations = ?
        WHERE id = ?
      `,
        [cleanStart, cleanEnd, cleanClasses, cleanDuration, cleanMaxVio, examId]
      );

      invalidateExamCacheByExamId(examId);
      res.json({ ok: true });
    })
  );

  app.patch(
    '/api/teacher/exams/:examId/status',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<any>('SELECT * FROM exams WHERE id = ?', [examId]);
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
      await db.run('UPDATE exams SET status = ? WHERE id = ?', [status, examId]);
      invalidateExamCacheByExamId(examId);
      res.json({ ok: true });
    })
  );

  app.delete(
    '/api/teacher/exams/:examId',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<{ id: number; owner_id: number }>('SELECT id, owner_id FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Jadwal ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak: Anda tidak berhak menghapus jadwal ujian guru lain.' });
        return;
      }

      await db.run('DELETE FROM exams WHERE id = ?', [examId]);
      invalidateExamCacheByExamId(examId);
      res.json({ ok: true });
    })
  );

  // Manual & Automatic Grading View for an Exam
  app.get(
    '/api/teacher/exams/:examId/grading',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<any>('SELECT * FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki akses ke hasil ujian guru lain.' });
        return;
      }

      const sessions = await db.all(
        `
        SELECT es.*, u.username, u.full_name, u.class_name
        FROM exam_sessions es
        JOIN users u ON u.id = es.student_id
        WHERE es.exam_id = ?
        ORDER BY es.submitted_at DESC, es.id DESC
      `,
        [examId]
      );

      const questions = await db.all(
        `
        SELECT id, q_type, prompt_text, image_url, options_json, answer_key_json, max_score, sort_order
        FROM questions WHERE bank_id = ? ORDER BY sort_order ASC, id ASC
      `,
        [exam.bank_id]
      );

      res.json({ exam, sessions, questions });
    })
  );

  app.get(
    '/api/teacher/exams/:examId/grading/excel',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<{ id: number; owner_id: number; title: string }>('SELECT id, owner_id, title FROM exams WHERE id = ?', [
        examId,
      ]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak: Anda tidak memiliki akses ke hasil ujian guru lain.' });
        return;
      }

      const buf = await buildExamGradingExcel(examId);
      if (!buf) {
        res.status(404).json({ error: 'Data nilai ujian tidak ditemukan.' });
        return;
      }
      const safeTitle = exam.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Rekap_Nilai_${safeTitle}.xlsx"`);
      res.send(buf);
    })
  );

  app.get(
    '/api/teacher/sessions/:sessionId/answers',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>(
        `
        SELECT es.*, e.owner_id, e.bank_id, e.title as exam_title, u.username, u.full_name, u.class_name
        FROM exam_sessions es
        JOIN exams e ON e.id = es.exam_id
        JOIN users u ON u.id = es.student_id
        WHERE es.id = ?
      `,
        [sessionId]
      );

      if (!session) {
        res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && session.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }

      const questions = await db.all(
        `
        SELECT q.*, a.id as answer_id, a.answer_json, a.auto_score, a.manual_score, a.teacher_note, a.is_manually_graded
        FROM questions q
        LEFT JOIN student_answers a ON a.question_id = q.id AND a.session_id = ?
        WHERE q.bank_id = ?
        ORDER BY q.sort_order ASC, q.id ASC
      `,
        [sessionId, session.bank_id]
      );

      res.json({ session, questions });
    })
  );

  // Teacher manually grades or overrides score for ANY question type + optional session adjustment
  app.post(
    '/api/teacher/sessions/:sessionId/grade',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>(
        `
        SELECT es.*, e.owner_id, e.bank_id
        FROM exam_sessions es
        JOIN exams e ON e.id = es.exam_id
        WHERE es.id = ?
      `,
        [sessionId]
      );

      if (!session) {
        res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && session.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }

      const { grades, manualScoreAdjustment } = req.body || {};
      const now = nowIso();

      await db.transaction(async (tx) => {
        if (Array.isArray(grades)) {
          for (const g of grades) {
            if (g.useAutoScore) {
              await tx.run(
                `
                UPDATE student_answers
                SET manual_score = NULL, is_manually_graded = 0, teacher_note = ?, updated_at = ?
                WHERE session_id = ? AND question_id = ?
              `,
                [String(g.teacherNote || ''), now, sessionId, Number(g.questionId)]
              );
            } else {
              await tx.run(
                `
                INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, auto_score, manual_score, teacher_note, is_manually_graded, updated_at)
                VALUES (?, ?, ?, ?, 'null', 0, ?, ?, 1, ?)
                ON CONFLICT(session_id, question_id) DO UPDATE SET
                  manual_score = excluded.manual_score,
                  teacher_note = excluded.teacher_note,
                  is_manually_graded = 1,
                  updated_at = excluded.updated_at
              `,
                [
                  sessionId,
                  session.exam_id,
                  session.student_id,
                  Number(g.questionId),
                  Math.max(0, Number(g.manualScore) || 0),
                  String(g.teacherNote || ''),
                  now,
                ]
              );
            }
          }
        }
        if (manualScoreAdjustment !== undefined) {
          await tx.run('UPDATE exam_sessions SET manual_score_adjustment = ? WHERE id = ?', [
            Number(manualScoreAdjustment) || 0,
            sessionId,
          ]);
        }
      });

      const newFinal = await recalculateSessionScore(sessionId);
      res.json({ ok: true, finalScore: newFinal });
    })
  );

  // Re-run automatic grading for all sessions in an exam
  app.post(
    '/api/teacher/exams/:examId/regrade-auto',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<any>('SELECT * FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }

      const questions = await db.all<any>('SELECT id, q_type, options_json, answer_key_json, max_score FROM questions WHERE bank_id = ?', [
        exam.bank_id,
      ]);
      const qMap = new Map(questions.map((q) => [q.id, q]));
      const sessions = await db.all<{ id: number }>("SELECT id FROM exam_sessions WHERE exam_id = ? AND status = 'SUBMITTED'", [examId]);

      await db.transaction(async (tx) => {
        for (const sess of sessions) {
          const answers = await tx.all<any>('SELECT id, question_id, answer_json FROM student_answers WHERE session_id = ?', [sess.id]);
          for (const a of answers) {
            const q = qMap.get(a.question_id);
            if (!q) continue;
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(a.answer_json);
            } catch {
              parsed = null;
            }
            const score = gradeQuestionAnswer(q.q_type, q.options_json, q.answer_key_json, q.max_score, parsed);
            await tx.run('UPDATE student_answers SET auto_score = ? WHERE id = ?', [score, a.id]);
          }
        }
      });

      for (const sess of sessions) {
        await recalculateSessionScore(sess.id);
      }

      res.json({ ok: true, regradedSessions: sessions.length });
    })
  );

  // Item Analysis (JSON + Excel Export)
  app.get(
    '/api/teacher/exams/:examId/analysis',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<{ owner_id: number }>('SELECT owner_id FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak: Anda tidak dapat melihat analisis ujian guru lain.' });
        return;
      }

      const report = await computeExamItemAnalysis(examId);
      res.json({ report });
    })
  );

  app.get(
    '/api/teacher/exams/:examId/analysis/excel',
    requireAuth,
    requireRole('guru', 'admin'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<{ owner_id: number; title: string }>('SELECT owner_id, title FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role !== 'admin' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }

      const report = await computeExamItemAnalysis(examId);
      if (!report) {
        res.status(404).json({ error: 'Data analisis tidak tersedia.' });
        return;
      }
      const buf = buildItemAnalysisExcel(report);
      const safeTitle = exam.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 40);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Analisis_Butir_${safeTitle}.xlsx"`);
      res.send(buf);
    })
  );

  // --------------------------------------------------------------------------
  // Proctor Routes (Live Monitoring, Violation Logs, Unlock Locked Exams)
  // --------------------------------------------------------------------------
  app.get(
    '/api/proctor/exams',
    requireAuth,
    requireRole('pengawas', 'admin', 'guru'),
    ah(async (req, res) => {
      const user = req.user!;
      const exams =
        user.role === 'guru'
          ? await db.all(
              `
              SELECT e.id, e.title, e.token_code, e.status, e.max_violations, e.duration_minutes,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'IN_PROGRESS') as active_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count
              FROM exams e WHERE e.owner_id = ? ORDER BY e.id DESC
            `,
              [user.userId]
            )
          : await db.all(`
              SELECT e.id, e.title, e.token_code, e.status, e.max_violations, e.duration_minutes,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'IN_PROGRESS') as active_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'LOCKED') as locked_count,
                     (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'SUBMITTED') as submitted_count
              FROM exams e ORDER BY e.id DESC
            `);
      res.json({ exams });
    })
  );

  app.get(
    '/api/proctor/exams/:examId/monitor',
    requireAuth,
    requireRole('pengawas', 'admin', 'guru'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const exam = await db.get<any>('SELECT id, title, owner_id, max_violations, token_code, status FROM exams WHERE id = ?', [examId]);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }
      if (req.user!.role === 'guru' && exam.owner_id !== req.user!.userId) {
        res.status(403).json({ error: 'Akses ditolak.' });
        return;
      }

      const sessions = await db.all(
        `
        SELECT es.id, es.student_id, es.status, es.violation_count, es.unlock_count, es.locked_reason,
               es.started_at, es.last_sync_at, es.submitted_at, es.final_score,
               u.username, u.full_name, u.class_name,
               (SELECT COUNT(*) FROM student_answers sa WHERE sa.session_id = es.id AND sa.answer_json != 'null' AND sa.answer_json != '""') as answered_count
        FROM exam_sessions es
        JOIN users u ON u.id = es.student_id
        WHERE es.exam_id = ?
        ORDER BY CASE es.status WHEN 'LOCKED' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, es.last_sync_at DESC
      `,
        [examId]
      );

      const recentViolations = await db.all(
        `
        SELECT v.*, u.username, u.full_name, u.class_name
        FROM violation_logs v
        JOIN users u ON u.id = v.student_id
        WHERE v.exam_id = ?
        ORDER BY v.id DESC
        LIMIT 60
      `,
        [examId]
      );

      res.json({ exam, sessions, recentViolations });
    })
  );

  // Unlock a locked student exam session — ONLY Proctor or Admin!
  app.post(
    '/api/proctor/sessions/:sessionId/unlock',
    requireAuth,
    requireRole('pengawas', 'admin'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>('SELECT * FROM exam_sessions WHERE id = ?', [sessionId]);
      if (!session) {
        res.status(404).json({ error: 'Sesi peserta tidak ditemukan.' });
        return;
      }
      if (session.status !== 'LOCKED') {
        res.status(400).json({ error: 'Sesi ini tidak dalam kondisi terkunci.' });
        return;
      }

      const { resetViolations } = req.body || {};
      const now = nowIso();
      await db.run(
        `
        UPDATE exam_sessions
        SET status = 'IN_PROGRESS',
            violation_count = ?,
            unlock_count = unlock_count + 1,
            locked_reason = '',
            unlocked_by = ?,
            last_sync_at = ?
        WHERE id = ?
      `,
        [resetViolations ? 0 : Math.max(0, Number(session.violation_count) - 1), req.user!.userId, now, sessionId]
      );

      await db.run(
        `
        INSERT INTO violation_logs (session_id, exam_id, student_id, violation_type, detail, created_at)
        VALUES (?, ?, ?, 'PROCTOR_UNLOCK', ?, ?)
      `,
        [sessionId, session.exam_id, session.student_id, `Dibuka kembali oleh pengawas: ${req.user!.fullName}`, now]
      );

      res.json({ ok: true });
    })
  );

  // --------------------------------------------------------------------------
  // Student Exam Routes (High-Concurrency Cached Delivery & Batched Sync)
  // --------------------------------------------------------------------------
  app.get(
    '/api/student/exams',
    requireAuth,
    requireRole('siswa'),
    ah(async (req, res) => {
      const studentId = req.user!.userId;
      const studentClass = req.user!.className || '';
      const rawExams = await db.all<any>(
        `
        SELECT e.id, e.title, e.duration_minutes, e.max_violations, e.show_result_to_student, e.status, e.target_classes, e.start_at, e.end_at,
               qb.subject,
               (SELECT COUNT(*) FROM questions q WHERE q.bank_id = e.bank_id) as question_count,
               es.id as session_id, es.status as session_status, es.violation_count, es.final_score, es.submitted_at
        FROM exams e
        JOIN question_banks qb ON qb.id = e.bank_id
        LEFT JOIN exam_sessions es ON es.exam_id = e.id AND es.student_id = ?
        WHERE e.status = 'ACTIVE' OR es.id IS NOT NULL
        ORDER BY e.id DESC
      `,
        [studentId]
      );

      const exams = rawExams
        .filter((ex) => ex.session_id !== null || isClassAllowed(ex.target_classes, studentClass))
        .map((ex) => ({
          ...ex,
          schedule_state: computeScheduleState(ex.start_at || '', ex.end_at || ''),
        }));

      res.json({ exams });
    })
  );

  // Start or resume exam: returns full exam questions ONCE (served from RAM cache!)
  app.post(
    '/api/student/exams/:examId/start',
    requireAuth,
    requireRole('siswa'),
    ah(async (req, res) => {
      const examId = Number(req.params.examId);
      const studentId = req.user!.userId;
      const { tokenCode } = req.body || {};

      const cached = await getCachedExam(examId);
      if (!cached) {
        res.status(404).json({ error: 'Ujian tidak ditemukan.' });
        return;
      }

      let session = await db.get<any>('SELECT * FROM exam_sessions WHERE exam_id = ? AND student_id = ?', [examId, studentId]);

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

        const now = nowIso();
        const sessId = await db.insertReturningId(
          `
          INSERT INTO exam_sessions (exam_id, student_id, status, question_order_json, started_at, last_sync_at)
          VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?)
        `,
          [examId, studentId, JSON.stringify(qIds), now, now]
        );

        session = await db.get<any>('SELECT * FROM exam_sessions WHERE id = ?', [sessId]);
      }

      let orderIds: number[] = [];
      try {
        orderIds = JSON.parse(session.question_order_json || '[]');
      } catch {
        orderIds = [];
      }
      const qMap = new Map(cached.questions.map((q) => [q.id, q]));
      const orderedQuestions = orderIds.length > 0 ? orderIds.map((id) => qMap.get(id)).filter(Boolean) : cached.questions;

      const savedRows = await db.all<{ question_id: number; answer_json: string }>(
        'SELECT question_id, answer_json FROM student_answers WHERE session_id = ?',
        [session.id]
      );
      const savedAnswers: Record<number, unknown> = {};
      for (const r of savedRows) {
        try {
          savedAnswers[r.question_id] = JSON.parse(r.answer_json);
        } catch {
          /* ignore */
        }
      }

      const startedMs = parseDbDateMs(session.started_at);
      const elapsedSec = !Number.isNaN(startedMs) ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000)) : 0;
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
    })
  );

  // Check unlock status while student screen is locked (lightweight polling)
  app.get(
    '/api/student/sessions/:sessionId/status',
    requireAuth,
    requireRole('siswa'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>(
        `
        SELECT es.id, es.student_id, es.status, es.violation_count, es.locked_reason, e.max_violations
        FROM exam_sessions es
        JOIN exams e ON e.id = es.exam_id
        WHERE es.id = ?
      `,
        [sessionId]
      );

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
    })
  );

  // Batched Answer & Violation Sync (Atomic Single-Transaction Write)
  app.post(
    '/api/student/sessions/:sessionId/sync',
    requireAuth,
    requireRole('siswa'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>('SELECT * FROM exam_sessions WHERE id = ?', [sessionId]);
      if (!session || session.student_id !== req.user!.userId) {
        res.status(404).json({ error: 'Sesi ujian tidak ditemukan.' });
        return;
      }

      if (session.status === 'SUBMITTED') {
        res.json({ ok: true, status: 'SUBMITTED', violationCount: session.violation_count });
        return;
      }

      const cached = await getCachedExam(session.exam_id);
      const maxViolations = cached?.maxViolations ?? 3;

      const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const violations = Array.isArray(req.body?.violations) ? req.body.violations : [];

      let newStatus = session.status;
      let newViolationCount = Number(session.violation_count || 0);
      let lockedReason = session.locked_reason || '';
      const now = nowIso();

      await db.transaction(async (tx) => {
        if (session.status === 'IN_PROGRESS') {
          for (const item of answers) {
            const qId = Number(item.questionId);
            if (!qId) continue;
            await tx.run(
              `
              INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(session_id, question_id) DO UPDATE SET
                answer_json = excluded.answer_json,
                updated_at = excluded.updated_at
            `,
              [sessionId, session.exam_id, session.student_id, qId, JSON.stringify(item.answer ?? null), now]
            );
          }
        }

        if (violations.length > 0 && session.status !== 'SUBMITTED') {
          for (const v of violations) {
            const vType = String(v.type || 'VIOLATION').slice(0, 40);
            const vDetail = String(v.detail || '').slice(0, 200);
            await tx.run(
              `
              INSERT INTO violation_logs (session_id, exam_id, student_id, violation_type, detail, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
              [sessionId, session.exam_id, session.student_id, vType, vDetail, now]
            );
            newViolationCount++;
            lockedReason = vDetail || vType;
          }
        }

        if (newViolationCount >= maxViolations && newStatus === 'IN_PROGRESS') {
          newStatus = 'LOCKED';
          lockedReason = `Melebihi batas ${maxViolations} pelanggaran (${lockedReason}). Hubungi pengawas untuk membuka kunci.`;
        }

        await tx.run(
          `
          UPDATE exam_sessions
          SET status = ?, violation_count = ?, locked_reason = ?, last_sync_at = ?
          WHERE id = ?
        `,
          [newStatus, newViolationCount, lockedReason, now, sessionId]
        );
      });

      res.json({
        ok: true,
        status: newStatus,
        violationCount: newViolationCount,
        maxViolations,
        lockedReason,
        syncedAnswers: session.status === 'IN_PROGRESS' ? answers.length : 0,
      });
    })
  );

  // Final Submit Exam
  app.post(
    '/api/student/sessions/:sessionId/submit',
    requireAuth,
    requireRole('siswa'),
    ah(async (req, res) => {
      const sessionId = Number(req.params.sessionId);
      const session = await db.get<any>('SELECT * FROM exam_sessions WHERE id = ?', [sessionId]);
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

      const exam = await db.get<any>('SELECT bank_id, show_result_to_student FROM exams WHERE id = ?', [session.exam_id]);
      const questions = await db.all<any>(
        'SELECT id, q_type, options_json, answer_key_json, max_score FROM questions WHERE bank_id = ?',
        [exam.bank_id]
      );
      const qMap = new Map(questions.map((q) => [q.id, q]));

      const finalAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
      const now = nowIso();

      await db.transaction(async (tx) => {
        for (const item of finalAnswers) {
          const qId = Number(item.questionId);
          if (!qId) continue;
          await tx.run(
            `
            INSERT INTO student_answers (session_id, exam_id, student_id, question_id, answer_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, question_id) DO UPDATE SET
              answer_json = excluded.answer_json,
              updated_at = excluded.updated_at
          `,
            [sessionId, session.exam_id, session.student_id, qId, JSON.stringify(item.answer ?? null), now]
          );
        }

        const savedAnswers = await tx.all<any>('SELECT id, question_id, answer_json FROM student_answers WHERE session_id = ?', [
          sessionId,
        ]);

        for (const sa of savedAnswers) {
          const q = qMap.get(sa.question_id);
          if (!q) continue;
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(sa.answer_json);
          } catch {
            parsed = null;
          }
          const score = gradeQuestionAnswer(q.q_type, q.options_json, q.answer_key_json, q.max_score, parsed);
          await tx.run('UPDATE student_answers SET auto_score = ? WHERE id = ?', [score, sa.id]);
        }

        await tx.run(
          `
          UPDATE exam_sessions
          SET status = 'SUBMITTED', submitted_at = ?, last_sync_at = ?
          WHERE id = ?
        `,
          [now, now, sessionId]
        );
      });

      const finalScore = await recalculateSessionScore(sessionId);

      res.json({
        ok: true,
        status: 'SUBMITTED',
        showResultToStudent: Boolean(exam.show_result_to_student),
        finalScore: exam.show_result_to_student ? finalScore : null,
      });
    })
  );

  // Express global error handler (never leaks stack traces to browser)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('MKC CBT API Error:', err?.message || err);
    if (err instanceof multer.MulterError) {
      res.status(400).json({ error: `Kesalahan unggah berkas: ${err.message}` });
      return;
    }
    res.status(500).json({ error: err?.message || 'Terjadi kesalahan pada server.' });
  });

  return app;
}
