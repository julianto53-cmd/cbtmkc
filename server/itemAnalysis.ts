import * as XLSX from 'xlsx';
import { db } from './db.js';
import { QuestionType } from './grading.js';

export interface DistractorStat {
  optionId: string;
  label: string;
  isCorrect: boolean;
  count: number;
  percentage: number;
  upperCount: number;
  lowerCount: number;
  status: 'Kunci' | 'Efektif' | 'Pasif (<5%)' | 'Menyesatkan (Atas > Bawah)';
}

export interface ItemAnalysisRow {
  questionId: number;
  number: number;
  qType: QuestionType;
  promptSnippet: string;
  maxScore: number;
  avgScore: number;
  difficultyP: number;
  difficultyCategory: 'Sukar' | 'Sedang' | 'Mudah';
  discriminationD: number;
  discriminationCategory: 'Sangat Baik' | 'Baik' | 'Cukup' | 'Jelek';
  validityR: number;
  rTable: number;
  isValid: boolean;
  distribution: DistractorStat[];
  blankCount: number;
  blankPercentage: number;
  recommendation: 'DITERIMA' | 'REVISI' | 'DIBUANG';
  recommendationNote: string;
}

export interface StudentScoreRow {
  sessionId: number;
  username: string;
  fullName: string;
  className: string;
  autoScore: number;
  manualAdjustment: number;
  finalScore: number;
  violationCount: number;
  gradingStatus: string;
  submittedAt: string | null;
}

export interface ExamAnalysisReport {
  examId: number;
  examTitle: string;
  bankTitle: string;
  participantCount: number;
  questionCount: number;
  reliabilityAlpha: number;
  reliabilityCategory: string;
  meanScore: number;
  stdDevScore: number;
  minScore: number;
  maxScore: number;
  rTableCritical: number;
  summaryCounts: {
    accepted: number;
    revise: number;
    discard: number;
  };
  items: ItemAnalysisRow[];
  students: StudentScoreRow[];
}

function getCriticalR(n: number): number {
  if (n <= 3) return 0.95;
  const table: Record<number, number> = {
    4: 0.95, 5: 0.878, 6: 0.811, 7: 0.754, 8: 0.707, 9: 0.666, 10: 0.632,
    12: 0.576, 15: 0.514, 20: 0.444, 25: 0.396, 30: 0.361, 40: 0.312, 50: 0.279,
    70: 0.235, 100: 0.197, 200: 0.139, 500: 0.088, 1000: 0.062,
  };
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length; i++) {
    if (n <= keys[i]) return table[keys[i]];
  }
  // Approximate t-critical = 1.96 for df = n - 2
  const df = Math.max(2, n - 2);
  const t = 1.96;
  return Number(Math.sqrt((t * t) / (t * t + df)).toFixed(3));
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return Number((num / den).toFixed(3));
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
}

export async function computeExamItemAnalysis(examId: number): Promise<ExamAnalysisReport | null> {
  const exam = await db.get<{ id: number; title: string; bank_id: number; bank_title: string }>(
    `
    SELECT e.id, e.title, e.bank_id, qb.title as bank_title
    FROM exams e
    JOIN question_banks qb ON qb.id = e.bank_id
    WHERE e.id = ?
  `,
    [examId]
  );

  if (!exam) return null;

  const questions = await db.all<{
    id: number;
    q_type: QuestionType;
    prompt_text: string;
    options_json: string;
    answer_key_json: string;
    max_score: number;
    sort_order: number;
  }>(
    `
    SELECT id, q_type, prompt_text, options_json, answer_key_json, max_score, sort_order
    FROM questions
    WHERE bank_id = ?
    ORDER BY sort_order ASC, id ASC
  `,
    [exam.bank_id]
  );

  const sessions = await db.all<{
    session_id: number;
    student_id: number;
    auto_score: number;
    manual_score_adjustment: number;
    final_score: number;
    violation_count: number;
    grading_status: string;
    submitted_at: string | null;
    username: string;
    full_name: string;
    class_name: string;
  }>(
    `
    SELECT es.id as session_id, es.student_id, es.auto_score, es.manual_score_adjustment, es.final_score,
           es.violation_count, es.grading_status, es.submitted_at,
           u.username, u.full_name, u.class_name
    FROM exam_sessions es
    JOIN users u ON u.id = es.student_id
    WHERE es.exam_id = ? AND es.status = 'SUBMITTED'
    ORDER BY es.final_score DESC
  `,
    [examId]
  );

  const allAnswers = await db.all<{
    session_id: number;
    question_id: number;
    answer_json: string;
    auto_score: number;
    manual_score: number | null;
    is_manually_graded: number;
  }>(
    `
    SELECT session_id, question_id, answer_json, auto_score, manual_score, is_manually_graded
    FROM student_answers
    WHERE exam_id = ?
  `,
    [examId]
  );

  const answerMap = new Map<string, { raw: unknown; earned: number }>();
  for (const ans of allAnswers) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(ans.answer_json || 'null');
    } catch {
      parsed = null;
    }
    const earned = ans.is_manually_graded && ans.manual_score !== null
      ? ans.manual_score
      : ans.auto_score;
    answerMap.set(`${ans.session_id}:${ans.question_id}`, { raw: parsed, earned });
  }

  const N = sessions.length;
  const K = questions.length;
  const rTable = getCriticalR(N);

  // Build raw score matrix: itemScores[qIdx][sIdx] and totalScores[sIdx]
  const totalScores = sessions.map((s) => s.final_score);
  const upperCountSize = N >= 2 ? Math.max(1, Math.round(N * 0.27)) : 0;
  const upperSessionIds = new Set(sessions.slice(0, upperCountSize).map((s) => s.session_id));
  const lowerSessionIds = new Set(sessions.slice(Math.max(0, N - upperCountSize)).map((s) => s.session_id));

  let sumItemVariances = 0;
  const rawTotalsPerStudent = sessions.map(() => 0);

  const itemScoreVectors: number[][] = questions.map((q) => {
    const vec = sessions.map((s, sIdx) => {
      const entry = answerMap.get(`${s.session_id}:${q.id}`);
      const val = entry ? entry.earned : 0;
      rawTotalsPerStudent[sIdx] += val;
      return val;
    });
    sumItemVariances += variance(vec);
    return vec;
  });

  const totalRawVar = variance(rawTotalsPerStudent);
  let reliabilityAlpha = 0;
  if (K > 1 && totalRawVar > 0) {
    reliabilityAlpha = Number(((K / (K - 1)) * (1 - sumItemVariances / totalRawVar)).toFixed(3));
  }
  const reliabilityCategory =
    reliabilityAlpha >= 0.9 ? 'Sangat Tinggi'
      : reliabilityAlpha >= 0.7 ? 'Tinggi'
        : reliabilityAlpha >= 0.4 ? 'Cukup'
          : 'Rendah';

  const items: ItemAnalysisRow[] = questions.map((q, qIdx) => {
    const vec = itemScoreVectors[qIdx];
    const maxScore = q.max_score || 1;
    const avgScore = N > 0 ? Number((vec.reduce((a, b) => a + b, 0) / N).toFixed(2)) : 0;
    const difficultyP = N > 0 ? Number((avgScore / maxScore).toFixed(3)) : 0;
    const difficultyCategory: 'Sukar' | 'Sedang' | 'Mudah' =
      difficultyP < 0.3 ? 'Sukar' : difficultyP <= 0.7 ? 'Sedang' : 'Mudah';

    let upperSum = 0;
    let lowerSum = 0;
    sessions.forEach((s, idx) => {
      const p = vec[idx] / maxScore;
      if (upperSessionIds.has(s.session_id)) upperSum += p;
      if (lowerSessionIds.has(s.session_id)) lowerSum += p;
    });
    const upperMean = upperCountSize > 0 ? upperSum / upperCountSize : 0;
    const lowerMean = upperCountSize > 0 ? lowerSum / upperCountSize : 0;
    const discriminationD = N >= 2 ? Number((upperMean - lowerMean).toFixed(3)) : 0;

    const discriminationCategory: 'Sangat Baik' | 'Baik' | 'Cukup' | 'Jelek' =
      discriminationD >= 0.4 ? 'Sangat Baik'
        : discriminationD >= 0.3 ? 'Baik'
          : discriminationD >= 0.2 ? 'Cukup'
            : 'Jelek';

    const validityR = pearsonCorrelation(vec, rawTotalsPerStudent);
    const isValid = N >= 4 ? validityR >= rTable : validityR >= 0.3;

    // Distribution & Distractor Effectiveness
    let optsObj: any = {};
    let keyObj: any = {};
    try { optsObj = JSON.parse(q.options_json || '{}'); } catch { optsObj = {}; }
    try { keyObj = JSON.parse(q.answer_key_json || '{}'); } catch { keyObj = {}; }

    let blankCount = 0;
    const distribution: DistractorStat[] = [];

    if (q.q_type === 'PG' || q.q_type === 'PGK') {
      const opts: Array<{ id: string; text: string }> = Array.isArray(optsObj) ? optsObj : [];
      const correctSet = new Set<string>(
        q.q_type === 'PG'
          ? [String(keyObj.correct ?? '').toUpperCase()]
          : (Array.isArray(keyObj.correct) ? keyObj.correct.map((x: any) => String(x).toUpperCase()) : [])
      );

      const counts = new Map<string, { total: number; upper: number; lower: number }>();
      for (const o of opts) counts.set(o.id.toUpperCase(), { total: 0, upper: 0, lower: 0 });

      sessions.forEach((s) => {
        const entry = answerMap.get(`${s.session_id}:${q.id}`);
        const raw = entry?.raw;
        const picks: string[] = q.q_type === 'PG'
          ? (typeof raw === 'string' && raw ? [raw.toUpperCase()] : [])
          : (Array.isArray(raw) ? raw.map((x: any) => String(x).toUpperCase()) : []);
        if (picks.length === 0) {
          blankCount++;
        } else {
          for (const p of picks) {
            const bucket = counts.get(p);
            if (bucket) {
              bucket.total++;
              if (upperSessionIds.has(s.session_id)) bucket.upper++;
              if (lowerSessionIds.has(s.session_id)) bucket.lower++;
            }
          }
        }
      });

      for (const o of opts) {
        const oid = o.id.toUpperCase();
        const isCorrect = correctSet.has(oid);
        const bucket = counts.get(oid) || { total: 0, upper: 0, lower: 0 };
        const pct = N > 0 ? Number(((bucket.total / N) * 100).toFixed(1)) : 0;
        let status: DistractorStat['status'] = 'Efektif';
        if (isCorrect) {
          status = 'Kunci';
        } else if (pct < 5) {
          status = 'Pasif (<5%)';
        } else if (bucket.upper > bucket.lower) {
          status = 'Menyesatkan (Atas > Bawah)';
        }
        distribution.push({
          optionId: oid,
          label: o.text.slice(0, 60),
          isCorrect,
          count: bucket.total,
          percentage: pct,
          upperCount: bucket.upper,
          lowerCount: bucket.lower,
          status,
        });
      }
    } else if (q.q_type === 'BS') {
      const statements: Array<{ id: string; statement: string }> = Array.isArray(optsObj) ? optsObj : [];
      const correctMap: Record<string, string> = keyObj.correct || {};
      const counts: Record<string, { b: number; s: number; uB: number; lB: number; uS: number; lS: number }> = {};
      for (const st of statements) counts[st.id] = { b: 0, s: 0, uB: 0, lB: 0, uS: 0, lS: 0 };

      sessions.forEach((sess) => {
        const entry = answerMap.get(`${sess.session_id}:${q.id}`);
        const raw = (entry?.raw && typeof entry.raw === 'object' ? entry.raw : {}) as Record<string, string>;
        if (!entry?.raw || Object.keys(raw).length === 0) {
          blankCount++;
        }
        for (const st of statements) {
          const val = String(raw[st.id] || '').toUpperCase();
          if (val === 'B') {
            counts[st.id].b++;
            if (upperSessionIds.has(sess.session_id)) counts[st.id].uB++;
            if (lowerSessionIds.has(sess.session_id)) counts[st.id].lB++;
          } else if (val === 'S') {
            counts[st.id].s++;
            if (upperSessionIds.has(sess.session_id)) counts[st.id].uS++;
            if (lowerSessionIds.has(sess.session_id)) counts[st.id].lS++;
          }
        }
      });

      for (const st of statements) {
        const expected = String(correctMap[st.id] || 'B').toUpperCase();
        const c = counts[st.id];
        const bPct = N > 0 ? Number(((c.b / N) * 100).toFixed(1)) : 0;
        const sPct = N > 0 ? Number(((c.s / N) * 100).toFixed(1)) : 0;
        distribution.push({
          optionId: `P${st.id}-B`,
          label: `Pernyataan ${st.id}: Benar`,
          isCorrect: expected === 'B',
          count: c.b,
          percentage: bPct,
          upperCount: c.uB,
          lowerCount: c.lB,
          status: expected === 'B' ? 'Kunci' : bPct < 5 ? 'Pasif (<5%)' : 'Efektif',
        });
        distribution.push({
          optionId: `P${st.id}-S`,
          label: `Pernyataan ${st.id}: Salah`,
          isCorrect: expected === 'S',
          count: c.s,
          percentage: sPct,
          upperCount: c.uS,
          lowerCount: c.lS,
          status: expected === 'S' ? 'Kunci' : sPct < 5 ? 'Pasif (<5%)' : 'Efektif',
        });
      }
    } else {
      // JODOH, ISIAN, ESAI: categorize performance tiers
      let full = 0, partial = 0, zero = 0;
      let uFull = 0, lFull = 0, uPart = 0, lPart = 0, uZero = 0, lZero = 0;
      sessions.forEach((sess, idx) => {
        const entry = answerMap.get(`${sess.session_id}:${q.id}`);
        const raw = entry?.raw;
        const isBlank = raw === null || raw === undefined || raw === '' || (typeof raw === 'object' && Object.keys(raw as object).length === 0);
        if (isBlank) blankCount++;
        const earned = vec[idx];
        const isUp = upperSessionIds.has(sess.session_id);
        const isLow = lowerSessionIds.has(sess.session_id);
        if (earned >= maxScore * 0.99) {
          full++;
          if (isUp) uFull++;
          if (isLow) lFull++;
        } else if (earned > 0) {
          partial++;
          if (isUp) uPart++;
          if (isLow) lPart++;
        } else {
          zero++;
          if (isUp) uZero++;
          if (isLow) lZero++;
        }
      });

      const pct = (c: number) => (N > 0 ? Number(((c / N) * 100).toFixed(1)) : 0);
      distribution.push(
        { optionId: 'TUNTAS', label: 'Skor Penuh (>=99%)', isCorrect: true, count: full, percentage: pct(full), upperCount: uFull, lowerCount: lFull, status: 'Kunci' },
        { optionId: 'PARSIAL', label: 'Skor Sebagian (1-98%)', isCorrect: false, count: partial, percentage: pct(partial), upperCount: uPart, lowerCount: lPart, status: 'Efektif' },
        { optionId: 'NOL', label: 'Skor Nol / Salah', isCorrect: false, count: zero, percentage: pct(zero), upperCount: uZero, lowerCount: lZero, status: zero > 0 ? 'Efektif' : 'Pasif (<5%)' }
      );
    }

    // Recommendation logic
    let recommendation: 'DITERIMA' | 'REVISI' | 'DIBUANG' = 'DITERIMA';
    let recommendationNote = 'Butir soal berfungsi baik dengan daya pembeda dan validitas memadai.';

    if (N < 3) {
      recommendation = 'REVISI';
      recommendationNote = 'Jumlah peserta belum mencukupi (minimal 3 peserta selesai) untuk kesimpulan statistik.';
    } else if (discriminationD < 0.1 && !isValid) {
      recommendation = 'DIBUANG';
      recommendationNote = 'Daya pembeda sangat rendah/negatif dan tidak berkorelasi valid dengan skor total.';
    } else if (!isValid || discriminationD < 0.2 || difficultyP < 0.15 || difficultyP > 0.9) {
      recommendation = 'REVISI';
      const reasons: string[] = [];
      if (!isValid) reasons.push('validitas di bawah r-tabel');
      if (discriminationD < 0.2) reasons.push('daya pembeda rendah');
      if (difficultyP < 0.15) reasons.push('terlalu sukar');
      if (difficultyP > 0.9) reasons.push('terlalu mudah');
      recommendationNote = `Perlu perbaikan pada: ${reasons.join(', ')}.`;
    } else {
      const badDistractors = distribution.filter((d) => !d.isCorrect && d.status !== 'Efektif');
      if (q.q_type === 'PG' && badDistractors.length >= 2) {
        recommendation = 'REVISI';
        recommendationNote = `Soal valid, namun ${badDistractors.length} pengecoh kurang berfungsi efektif.`;
      }
    }

    return {
      questionId: q.id,
      number: qIdx + 1,
      qType: q.q_type,
      promptSnippet: q.prompt_text.replace(/\s+/g, ' ').slice(0, 120),
      maxScore,
      avgScore,
      difficultyP,
      difficultyCategory,
      discriminationD,
      discriminationCategory,
      validityR,
      rTable,
      isValid,
      distribution,
      blankCount,
      blankPercentage: N > 0 ? Number(((blankCount / N) * 100).toFixed(1)) : 0,
      recommendation,
      recommendationNote,
    };
  });

  const meanScore = N > 0 ? Number((totalScores.reduce((a, b) => a + b, 0) / N).toFixed(2)) : 0;
  const stdDevScore = N > 0 ? Number(Math.sqrt(variance(totalScores)).toFixed(2)) : 0;
  const minScore = N > 0 ? Math.min(...totalScores) : 0;
  const maxScore = N > 0 ? Math.max(...totalScores) : 0;

  return {
    examId: exam.id,
    examTitle: exam.title,
    bankTitle: exam.bank_title,
    participantCount: N,
    questionCount: K,
    reliabilityAlpha,
    reliabilityCategory,
    meanScore,
    stdDevScore,
    minScore,
    maxScore,
    rTableCritical: rTable,
    summaryCounts: {
      accepted: items.filter((i) => i.recommendation === 'DITERIMA').length,
      revise: items.filter((i) => i.recommendation === 'REVISI').length,
      discard: items.filter((i) => i.recommendation === 'DIBUANG').length,
    },
    items,
    students: sessions.map((s) => ({
      sessionId: s.session_id,
      username: s.username,
      fullName: s.full_name,
      className: s.class_name,
      autoScore: s.auto_score,
      manualAdjustment: s.manual_score_adjustment,
      finalScore: s.final_score,
      violationCount: s.violation_count,
      gradingStatus: s.grading_status,
      submittedAt: s.submitted_at,
    })),
  };
}

export function buildItemAnalysisExcel(report: ExamAnalysisReport): Buffer {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Ringkasan Tes
  const summaryData = [
    ['LAPORAN ANALISIS BUTIR SOAL — MKC CBT'],
    ['Judul Ujian', report.examTitle],
    ['Bank Soal', report.bankTitle],
    ['Jumlah Peserta Selesai', report.participantCount],
    ['Jumlah Butir Soal', report.questionCount],
    ['Reliabilitas (Cronbach Alpha)', report.reliabilityAlpha, report.reliabilityCategory],
    ['Rata-Rata Nilai', report.meanScore],
    ['Simpangan Baku', report.stdDevScore],
    ['Nilai Tertinggi', report.maxScore],
    ['Nilai Terendah', report.minScore],
    ['Nilai Kritis r-Tabel (alpha 0.05)', report.rTableCritical],
    [],
    ['REKAP REKOMENDASI BUTIR SOAL'],
    ['Diterima (Baik)', report.summaryCounts.accepted],
    ['Perlu Revisi', report.summaryCounts.revise],
    ['Dibuang / Diganti', report.summaryCounts.discard],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 38 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Tes');

  // Sheet 2: Analisis Butir Soal
  const itemRows = report.items.map((item) => ({
    'No': item.number,
    'Tipe': item.qType,
    'Cuplikan Soal': item.promptSnippet,
    'Bobot Maks': item.maxScore,
    'Rata Skor': item.avgScore,
    'Kesukaran (P)': item.difficultyP,
    'Kategori Kesukaran': item.difficultyCategory,
    'Daya Pembeda (D)': item.discriminationD,
    'Kategori Daya Pembeda': item.discriminationCategory,
    'Validitas (rxy)': item.validityR,
    'r-Tabel': item.rTable,
    'Status Validitas': item.isValid ? 'Valid' : 'Tidak Valid',
    'Kosong (%)': item.blankPercentage,
    'Rekomendasi': item.recommendation,
    'Catatan Analisis': item.recommendationNote,
  }));
  const wsItems = XLSX.utils.json_to_sheet(itemRows);
  wsItems['!cols'] = [
    { wch: 5 }, { wch: 8 }, { wch: 44 }, { wch: 11 }, { wch: 11 },
    { wch: 13 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 14 },
    { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 45 },
  ];
  XLSX.utils.book_append_sheet(wb, wsItems, 'Analisis Butir Soal');

  // Sheet 3: Sebaran & Pengecoh
  const distRows: Array<Record<string, unknown>> = [];
  for (const item of report.items) {
    for (const d of item.distribution) {
      distRows.push({
        'No Soal': item.number,
        'Tipe': item.qType,
        'Opsi / Kategori': d.optionId,
        'Label': d.label,
        'Kunci?': d.isCorrect ? 'YA' : 'TIDAK',
        'Jumlah Pemilih': d.count,
        'Persentase (%)': d.percentage,
        'Kelompok Atas': d.upperCount,
        'Kelompok Bawah': d.lowerCount,
        'Efektivitas Pengecoh': d.status,
      });
    }
  }
  const wsDist = XLSX.utils.json_to_sheet(distRows);
  wsDist['!cols'] = [
    { wch: 9 }, { wch: 8 }, { wch: 15 }, { wch: 36 }, { wch: 8 },
    { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDist, 'Sebaran & Pengecoh');

  // Sheet 4: Rekap Nilai Siswa
  const studentRows = report.students.map((s, idx) => ({
    'No': idx + 1,
    'Username / NISN': s.username,
    'Nama Siswa': s.fullName,
    'Kelas': s.className,
    'Nilai Akhir': s.finalScore,
    'Penyesuaian Manual': s.manualAdjustment,
    'Pelanggaran': s.violationCount,
    'Status Koreksi': s.gradingStatus,
    'Waktu Selesai': s.submittedAt || '-',
  }));
  const wsStudents = XLSX.utils.json_to_sheet(studentRows);
  wsStudents['!cols'] = [
    { wch: 5 }, { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 12 },
    { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Rekap Nilai Siswa');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export async function buildExamGradingExcel(examId: number): Promise<Buffer | null> {
  const exam = await db.get<any>(
    `
    SELECT e.*, qb.title as bank_title, qb.subject
    FROM exams e
    JOIN question_banks qb ON qb.id = e.bank_id
    WHERE e.id = ?
  `,
    [examId]
  );

  if (!exam) return null;

  const questions = await db.all<{ id: number; q_type: string; max_score: number; sort_order: number }>(
    `
    SELECT id, q_type, max_score, sort_order
    FROM questions
    WHERE bank_id = ?
    ORDER BY sort_order ASC, id ASC
  `,
    [exam.bank_id]
  );

  const sessions = await db.all<any>(
    `
    SELECT es.*, u.username, u.full_name, u.class_name
    FROM exam_sessions es
    JOIN users u ON u.id = es.student_id
    WHERE es.exam_id = ?
    ORDER BY u.class_name ASC, u.full_name ASC, es.id ASC
  `,
    [examId]
  );

  const answers = await db.all<{
    session_id: number;
    question_id: number;
    auto_score: number;
    manual_score: number | null;
    is_manually_graded: number;
  }>(
    `
    SELECT session_id, question_id, auto_score, manual_score, is_manually_graded
    FROM student_answers
    WHERE exam_id = ?
  `,
    [examId]
  );

  const ansMap = new Map<string, number>();
  for (const a of answers) {
    const score = a.is_manually_graded && a.manual_score !== null ? a.manual_score : a.auto_score;
    ansMap.set(`${a.session_id}:${a.question_id}`, Number(score || 0));
  }

  const maxPossible = questions.reduce((acc, q) => acc + (Number(q.max_score) || 0), 0);
  const scores = sessions.map((s) => Number(s.final_score || 0));
  const avgScore = scores.length > 0 ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Rekap Nilai Peserta
  const headerBlock: (string | number)[][] = [
    ['REKAP NILAI PESERTA UJIAN - MKC CBT'],
    ['Judul Ujian', exam.title || '-'],
    ['Mata Pelajaran', exam.subject || '-'],
    ['Bank Soal', exam.bank_title || '-'],
    ['Token Ujian', exam.token_code || '-'],
    ['Jumlah Soal / Skor Maksimal', `${questions.length} Soal (${maxPossible} Poin)`],
    ['Jumlah Peserta Tercatat', sessions.length],
    ['Rata-Rata Nilai', avgScore],
    ['Nilai Tertinggi / Terendah', `${maxScore} / ${minScore}`],
    ['Tanggal Ekspor', new Date().toLocaleString('id-ID')],
    [],
    [
      'No',
      'Username / NIS',
      'Nama Lengkap',
      'Kelas',
      'Status Sesi',
      'Status Koreksi',
      'Pelanggaran',
      'Nilai Otomatis',
      'Penyesuaian Manual',
      'Nilai Akhir',
      'Waktu Mulai',
      'Waktu Selesai',
    ],
  ];

  sessions.forEach((s, idx) => {
    headerBlock.push([
      idx + 1,
      s.username || '',
      s.full_name || '',
      s.class_name || '',
      s.status || '',
      s.grading_status || '',
      Number(s.violation_count || 0),
      Number(s.auto_score || 0),
      Number(s.manual_score_adjustment || 0),
      Number(s.final_score || 0),
      s.started_at || '-',
      s.submitted_at || '-',
    ]);
  });

  const wsRekap = XLSX.utils.aoa_to_sheet(headerBlock);
  wsRekap['!cols'] = [
    { wch: 6 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 18 },
    { wch: 13 },
    { wch: 22 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsRekap, 'Rekap Nilai');

  // Sheet 2: Rincian Skor Per Soal
  const detailRows = sessions.map((s, idx) => {
    const row: Record<string, string | number> = {
      'No': idx + 1,
      'Username / NIS': s.username || '',
      'Nama Lengkap': s.full_name || '',
      'Kelas': s.class_name || '',
    };
    questions.forEach((q, qIdx) => {
      const colLabel = `S${qIdx + 1} (${q.q_type})`;
      row[colLabel] = ansMap.get(`${s.id}:${q.id}`) ?? 0;
    });
    row['Penyesuaian Manual'] = Number(s.manual_score_adjustment || 0);
    row['Nilai Akhir'] = Number(s.final_score || 0);
    return row;
  });

  const wsDetail = XLSX.utils.json_to_sheet(
    detailRows.length > 0
      ? detailRows
      : [{ Info: 'Belum ada peserta yang mengerjakan ujian ini.' }]
  );
  wsDetail['!cols'] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    ...questions.map(() => ({ wch: 11 })),
    { wch: 18 },
    { wch: 13 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Skor Per Soal');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

