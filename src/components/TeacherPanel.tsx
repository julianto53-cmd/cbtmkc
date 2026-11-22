import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  ImagePlus,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiDownload, apiFetch } from '../lib/api';
import { AuthUser, ExamItem, ParsedWordQuestion, QuestionBank, QuestionItem, QuestionType } from '../types';
import { ItemAnalysisView } from './ItemAnalysisView';

interface TeacherPanelProps {
  user: AuthUser;
}

type TeacherTab = 'banks' | 'exams' | 'grading' | 'analysis';

export function TeacherPanel({ user }: TeacherPanelProps) {
  const [activeTab, setActiveTab] = useState<TeacherTab>('banks');
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [encryptionStatus, setEncryptionStatus] = useState<{ configured: boolean; algorithm: string; label: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Create Bank form
  const [showNewBank, setShowNewBank] = useState(false);
  const [bankTitle, setBankTitle] = useState('');
  const [bankSubject, setBankSubject] = useState('');
  const [bankGrade, setBankGrade] = useState('XII');

  // Word Import Preview State
  const [previewItems, setPreviewItems] = useState<ParsedWordQuestion[] | null>(null);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string>>(new Set());
  const [importingWord, setImportingWord] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);

  // Manual Question Form
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [qType, setQType] = useState<QuestionType>('PG');
  const [qPrompt, setQPrompt] = useState('');
  const [qImageUrl, setQImageUrl] = useState('');
  const [qMaxScore, setQMaxScore] = useState(10);
  const [qPgOptions, setQPgOptions] = useState([
    { id: 'A', text: '' },
    { id: 'B', text: '' },
    { id: 'C', text: '' },
    { id: 'D', text: '' },
    { id: 'E', text: '' },
  ]);
  const [qPgCorrect, setQPgCorrect] = useState('A');
  const [qPgkCorrect, setQPgkCorrect] = useState<string[]>(['A', 'B']);
  const [qBsStatements, setQBsStatements] = useState([
    { id: '1', statement: '' },
    { id: '2', statement: '' },
  ]);
  const [qBsCorrect, setQBsCorrect] = useState<Record<string, string>>({ '1': 'B', '2': 'S' });
  const [qJodohLeft, setQJodohLeft] = useState([
    { id: 'L1', text: '' },
    { id: 'L2', text: '' },
  ]);
  const [qJodohRight, setQJodohRight] = useState([
    { id: 'R1', text: '' },
    { id: 'R2', text: '' },
  ]);
  const [qJodohPairs, setQJodohPairs] = useState<Record<string, string>>({ L1: 'R1', L2: 'R2' });
  const [qIsianAccepted, setQIsianAccepted] = useState('');
  const [qEsaiRef, setQEsaiRef] = useState('');

  // Create Exam Form
  const [showNewExam, setShowNewExam] = useState(false);
  const [examTitle, setExamTitle] = useState('');
  const [examBankId, setExamBankId] = useState<number | ''>('');
  const [examDuration, setExamDuration] = useState(60);
  const [examMaxViolations, setExamMaxViolations] = useState(3);
  const [examShuffle, setExamShuffle] = useState(true);
  const [examShowResult, setExamShowResult] = useState(true);
  const [examStartAt, setExamStartAt] = useState('');
  const [examEndAt, setExamEndAt] = useState('');
  const [examAllClasses, setExamAllClasses] = useState(true);
  const [examSelectedClasses, setExamSelectedClasses] = useState<string[]>([]);
  const [availableClasses, setAvailableClasses] = useState<Array<{ class_name: string; student_count: number }>>([]);

  // Edit Exam Schedule & Classes Form
  const [editingExamId, setEditingExamId] = useState<number | null>(null);
  const [editStartAt, setEditStartAt] = useState('');
  const [editEndAt, setEditEndAt] = useState('');
  const [editAllClasses, setEditAllClasses] = useState(true);
  const [editSelectedClasses, setEditSelectedClasses] = useState<string[]>([]);

  // Grading State
  const [gradingExamId, setGradingExamId] = useState<number | null>(null);
  const [gradingData, setGradingData] = useState<{ exam: any; sessions: any[]; questions: any[] } | null>(null);
  const [inspectingSession, setInspectingSession] = useState<{ session: any; questions: any[] } | null>(null);
  const [manualEdits, setManualEdits] = useState<Record<number, { score: string; note: string; useAuto: boolean }>>({});
  const [sessionAdjustment, setSessionAdjustment] = useState('0');

  const toLocalInput = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const toIsoOrEmpty = (localVal: string) => {
    if (!localVal) return '';
    const d = new Date(localVal);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  };

  const formatScheduleTime = (iso?: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  };

  const loadBanksAndExams = useCallback(async () => {
    try {
      const [bData, eData, encData, cData] = await Promise.all([
        apiFetch<{ banks: QuestionBank[] }>('/api/teacher/banks'),
        apiFetch<{ exams: ExamItem[] }>('/api/teacher/exams'),
        apiFetch<any>('/api/teacher/encryption-status'),
        apiFetch<{ classes: Array<{ class_name: string; student_count: number }> }>('/api/teacher/classes'),
      ]);
      setBanks(bData.banks || []);
      setExams(eData.exams || []);
      setEncryptionStatus(encData);
      setAvailableClasses(cData.classes || []);
      if (bData.banks?.length > 0 && !selectedBankId) {
        setSelectedBankId(bData.banks[0].id);
      }
      if (eData.exams?.length > 0 && !gradingExamId) {
        setGradingExamId(eData.exams[0].id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat data guru.');
    }
  }, [gradingExamId, selectedBankId]);

  const loadBankDetail = useCallback(async (bankId: number) => {
    try {
      const data = await apiFetch<{ bank: QuestionBank; questions: QuestionItem[] }>(`/api/teacher/banks/${bankId}`);
      setQuestions(data.questions || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat isi bank soal.');
    }
  }, []);

  useEffect(() => {
    loadBanksAndExams();
  }, [loadBanksAndExams]);

  useEffect(() => {
    if (selectedBankId) loadBankDetail(selectedBankId);
  }, [selectedBankId, loadBankDetail]);

  const loadGradingList = useCallback(async (examId: number) => {
    try {
      const data = await apiFetch<any>(`/api/teacher/exams/${examId}/grading`);
      setGradingData(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat daftar nilai.');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'grading' && gradingExamId) {
      loadGradingList(gradingExamId);
    }
  }, [activeTab, gradingExamId, loadGradingList]);

  const handleCreateBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const data = await apiFetch<{ id: number }>('/api/teacher/banks', {
        method: 'POST',
        body: JSON.stringify({ title: bankTitle, subject: bankSubject, gradeLevel: bankGrade }),
      });
      setBankTitle('');
      setBankSubject('');
      setShowNewBank(false);
      setStatusMsg('Bank soal baru berhasil dibuat (khusus akun Anda).');
      await loadBanksAndExams();
      setSelectedBankId(data.id);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleUploadImage = async (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await apiFetch<{ imageUrl: string }>('/api/teacher/questions/upload-image', {
      method: 'POST',
      body: fd,
    });
    setQImageUrl(data.imageUrl);
  };

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBankId) return;
    setErrorMsg('');

    let options: any = {};
    let answerKey: any = {};
    if (qType === 'PG') {
      options = qPgOptions.filter((o) => o.text.trim());
      answerKey = { correct: qPgCorrect };
    } else if (qType === 'PGK') {
      options = qPgOptions.filter((o) => o.text.trim());
      answerKey = { correct: qPgkCorrect, partialCredit: true };
    } else if (qType === 'BS') {
      options = qBsStatements.filter((s) => s.statement.trim());
      answerKey = { correct: qBsCorrect };
    } else if (qType === 'JODOH') {
      options = {
        left: qJodohLeft.filter((l) => l.text.trim()),
        right: qJodohRight.filter((r) => r.text.trim()),
      };
      answerKey = { pairs: qJodohPairs };
    } else if (qType === 'ISIAN') {
      options = { caseSensitive: false };
      answerKey = { accepted: qIsianAccepted.split('|').map((s) => s.trim()).filter(Boolean) };
    } else {
      options = { rubric: 'Penilaian manual guru' };
      answerKey = { referenceAnswer: qEsaiRef };
    }

    try {
      await apiFetch(`/api/teacher/banks/${selectedBankId}/questions`, {
        method: 'POST',
        body: JSON.stringify({
          qType,
          promptText: qPrompt,
          imageUrl: qImageUrl,
          options,
          answerKey,
          maxScore: qMaxScore,
        }),
      });
      setQPrompt('');
      setQImageUrl('');
      setShowNewQuestion(false);
      setStatusMsg('Soal berhasil ditambahkan ke bank soal.');
      await loadBankDetail(selectedBankId);
      await loadBanksAndExams();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDeleteQuestion = async (qId: number) => {
    if (!selectedBankId) return;
    await apiFetch(`/api/teacher/questions/${qId}`, { method: 'DELETE' });
    await loadBankDetail(selectedBankId);
    await loadBanksAndExams();
  };

  const handleWordUploadPreview = async (file: File) => {
    setErrorMsg('');
    setImportingWord(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiFetch<{ previewQuestions: ParsedWordQuestion[] }>('/api/teacher/import-word/preview', {
        method: 'POST',
        body: fd,
      });
      setPreviewItems(data.previewQuestions || []);
      setSelectedPreviewIds(new Set((data.previewQuestions || []).map((q) => q.tempId)));
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memproses file Word.');
    } finally {
      setImportingWord(false);
    }
  };

  const handleSaveWordPreview = async () => {
    if (!selectedBankId || !previewItems) return;
    const chosen = previewItems.filter((p) => selectedPreviewIds.has(p.tempId));
    if (chosen.length === 0) return;

    setSavingPreview(true);
    try {
      const resp = await apiFetch<{ insertedCount: number }>(`/api/teacher/banks/${selectedBankId}/questions`, {
        method: 'POST',
        body: JSON.stringify({ questions: chosen }),
      });
      setPreviewItems(null);
      setStatusMsg(`${resp.insertedCount} soal dari Word berhasil diperiksa dan disimpan ke bank soal.`);
      await loadBankDetail(selectedBankId);
      await loadBanksAndExams();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSavingPreview(false);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!examAllClasses && examSelectedClasses.length === 0) {
      setErrorMsg('Pilih minimal 1 kelas peserta atau centang Semua Kelas.');
      return;
    }
    const targetClasses = examAllClasses ? 'ALL' : examSelectedClasses.join(', ');
    try {
      const data = await apiFetch<{ id: number; tokenCode: string }>('/api/teacher/exams', {
        method: 'POST',
        body: JSON.stringify({
          bankId: examBankId || selectedBankId,
          title: examTitle,
          durationMinutes: examDuration,
          maxViolations: examMaxViolations,
          shuffleQuestions: examShuffle,
          showResultToStudent: examShowResult,
          startAt: toIsoOrEmpty(examStartAt),
          endAt: toIsoOrEmpty(examEndAt),
          targetClasses,
          status: 'ACTIVE',
        }),
      });
      setShowNewExam(false);
      setExamTitle('');
      setExamStartAt('');
      setExamEndAt('');
      setExamAllClasses(true);
      setExamSelectedClasses([]);
      setStatusMsg(`Jadwal ujian aktif dibuat dengan token: ${data.tokenCode}`);
      await loadBanksAndExams();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveExamSchedule = async (examId: number) => {
    setErrorMsg('');
    if (!editAllClasses && editSelectedClasses.length === 0) {
      setErrorMsg('Pilih minimal 1 kelas peserta atau aktifkan Semua Kelas.');
      return;
    }
    try {
      await apiFetch(`/api/teacher/exams/${examId}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify({
          startAt: toIsoOrEmpty(editStartAt),
          endAt: toIsoOrEmpty(editEndAt),
          targetClasses: editAllClasses ? 'ALL' : editSelectedClasses.join(', '),
        }),
      });
      setEditingExamId(null);
      setStatusMsg('Jadwal dan target kelas ujian berhasil diperbarui.');
      await loadBanksAndExams();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleInspectStudent = async (sessionId: number) => {
    try {
      const data = await apiFetch<{ session: any; questions: any[] }>(`/api/teacher/sessions/${sessionId}/answers`);
      setInspectingSession(data);
      setSessionAdjustment(String(data.session.manual_score_adjustment || 0));
      const initEdits: Record<number, { score: string; note: string; useAuto: boolean }> = {};
      for (const q of data.questions) {
        initEdits[q.id] = {
          score: q.is_manually_graded && q.manual_score !== null ? String(q.manual_score) : String(q.auto_score ?? 0),
          note: q.teacher_note || '',
          useAuto: !q.is_manually_graded,
        };
      }
      setManualEdits(initEdits);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveManualGrades = async () => {
    if (!inspectingSession) return;
    const grades = inspectingSession.questions.map((q) => {
      const ed = manualEdits[q.id];
      return {
        questionId: q.id,
        manualScore: Number(ed?.score) || 0,
        teacherNote: ed?.note || '',
        useAutoScore: Boolean(ed?.useAuto),
      };
    });
    const resp = await apiFetch<{ finalScore: number }>(`/api/teacher/sessions/${inspectingSession.session.id}/grade`, {
      method: 'POST',
      body: JSON.stringify({
        grades,
        manualScoreAdjustment: Number(sessionAdjustment) || 0,
      }),
    });
    setStatusMsg(`Nilai peserta diperbarui. Nilai akhir sekarang: ${resp.finalScore}`);
    setInspectingSession(null);
    if (gradingExamId) await loadGradingList(gradingExamId);
  };

  const selectedBank = banks.find((b) => b.id === selectedBankId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Ruang Guru & Bank Soal</h1>
          <p className="text-sm text-slate-600 mt-1">
            {user.role === 'guru'
              ? 'Bank soal dan ujian terisolasi khusus untuk akun guru Anda.'
              : 'Kelola seluruh bank soal, import Word, penilaian manual, dan analisis butir soal.'}
          </p>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {[
            { id: 'banks', label: 'Bank Soal & Word', icon: BookOpen },
            { id: 'exams', label: 'Jadwal Ujian', icon: ClipboardCheck },
            { id: 'grading', label: 'Koreksi Nilai', icon: CheckCircle2 },
            { id: 'analysis', label: 'Analisis Butir & Excel', icon: FileSpreadsheet },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as TeacherTab)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm flex items-center justify-between">
          <span>{statusMsg}</span>
          <button type="button" onClick={() => setStatusMsg('')} className="text-xs underline">Tutup</button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg('')} className="text-xs underline">Tutup</button>
        </div>
      )}

      {/* TAB 1: BANK SOAL & WORD IMPORT */}
      {activeTab === 'banks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 4 cols: Bank list */}
          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-bold text-sm text-slate-900">Bank Soal Saya</h2>
                <button
                  type="button"
                  onClick={() => setShowNewBank((v) => !v)}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Bank Baru</span>
                </button>
              </div>

              {showNewBank && (
                <form onSubmit={handleCreateBank} className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                  <input
                    type="text"
                    required
                    placeholder="Judul Bank Soal"
                    value={bankTitle}
                    onChange={(e) => setBankTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Mata Pelajaran"
                      value={bankSubject}
                      onChange={(e) => setBankSubject(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white"
                    />
                    <input
                      type="text"
                      placeholder="Kelas (cth: XII)"
                      value={bankGrade}
                      onChange={(e) => setBankGrade(e.target.value)}
                      className="w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white"
                    />
                  </div>
                  <button type="submit" className="w-full py-2 rounded bg-emerald-800 text-white text-xs font-medium">
                    Simpan Bank Soal
                  </button>
                </form>
              )}

              <div className="space-y-2">
                {banks.length === 0 ? (
                  <div className="text-xs text-slate-500 py-4 text-center">Belum ada bank soal. Buat bank soal pertama Anda.</div>
                ) : (
                  banks.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBankId(b.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedBankId === b.id
                          ? 'border-emerald-700 bg-emerald-50/70'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-sm font-semibold text-slate-900">{b.title}</div>
                      <div className="text-xs text-slate-500 mt-1 flex items-center justify-between">
                        <span>{b.subject} · {b.grade_level || 'Umum'}</span>
                        <span className="font-mono font-semibold text-slate-700 tabular-nums">{b.question_count} Soal</span>
                      </div>
                      {user.role === 'admin' && b.owner_name && (
                        <div className="text-[11px] text-slate-400 mt-1">Pemilik: {b.owner_name}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Security & Encrypted API Key Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-2">
              <div className="font-display font-bold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                <span>Keamanan Bank & Kunci API</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Isolasi guru aktif: guru lain tidak dapat melihat atau membuka bank soal Anda.
              </p>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-slate-700">
                <span>Kunci API Terenkripsi:</span>
                <span className="font-mono font-semibold text-emerald-700">
                  {encryptionStatus?.configured ? encryptionStatus.algorithm : 'Belum Diatur Admin'}
                </span>
              </div>
            </div>
          </div>

          {/* Right 8 cols: Questions & Word Import */}
          <div className="lg:col-span-8 space-y-4">
            {selectedBank ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="text-xs text-slate-500">{selectedBank.subject} · Kelas {selectedBank.grade_level}</div>
                      <h2 className="font-display text-lg font-bold text-slate-900">{selectedBank.title}</h2>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => apiDownload('/api/teacher/word-template', 'Template_Soal_MKC_CBT.docx')}
                        className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Template Word (.docx)</span>
                      </button>

                      <label className="px-3 py-2 rounded-lg border border-emerald-700 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{importingWord ? 'Memproses Word...' : 'Import Word (.docx)'}</span>
                        <input
                          type="file"
                          accept=".docx"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleWordUploadPreview(f);
                            e.target.value = '';
                          }}
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => setShowNewQuestion((v) => !v)}
                        className="px-3.5 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Tambah Soal</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Word Import Preview Workbench (MUST review before saving!) */}
                {previewItems && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-amber-700" />
                          <span>Pratinjau Hasil Import Word ({previewItems.length} Soal Ditemukan)</span>
                        </h3>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Periksa dan edit teks, gambar, kunci jawaban, serta bobot nilai terlebih dahulu sebelum disimpan ke bank soal.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewItems(null)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700"
                        >
                          Batalkan
                        </button>
                        <button
                          type="button"
                          disabled={savingPreview}
                          onClick={handleSaveWordPreview}
                          className="px-4 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium"
                        >
                          {savingPreview ? 'Menyimpan...' : `Simpan (${selectedPreviewIds.size}) ke Bank Soal`}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                      {previewItems.map((item, idx) => {
                        const checked = selectedPreviewIds.has(item.tempId);
                        return (
                          <div key={item.tempId} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(selectedPreviewIds);
                                    if (checked) next.delete(item.tempId);
                                    else next.add(item.tempId);
                                    setSelectedPreviewIds(next);
                                  }}
                                />
                                <span>Soal #{idx + 1} · Tipe {item.qType}</span>
                              </label>
                              <div className="flex items-center gap-2 text-xs">
                                <span>Bobot:</span>
                                <input
                                  type="number"
                                  min={1}
                                  value={item.maxScore}
                                  onChange={(e) => {
                                    const val = Number(e.target.value) || 10;
                                    setPreviewItems((prev) =>
                                      prev ? prev.map((x) => (x.tempId === item.tempId ? { ...x, maxScore: val } : x)) : null
                                    );
                                  }}
                                  className="w-16 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                                />
                              </div>
                            </div>

                            {item.warnings.length > 0 && (
                              <div className="p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                <span>Perlu diperiksa: {item.warnings.join('; ')}</span>
                              </div>
                            )}

                            <textarea
                              rows={2}
                              value={item.promptText}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPreviewItems((prev) =>
                                  prev ? prev.map((x) => (x.tempId === item.tempId ? { ...x, promptText: val } : x)) : null
                                );
                              }}
                              className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
                            />

                            {item.imageUrl && (
                              <img
                                src={item.imageUrl}
                                alt="Gambar hasil import Word"
                                referrerPolicy="no-referrer"
                                className="max-h-36 rounded border border-slate-200 object-contain"
                              />
                            )}

                            <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 font-mono">
                              Kunci terdeteksi: {JSON.stringify(item.answerKey)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Manual Question Creator Form */}
                {showNewQuestion && (
                  <form onSubmit={handleCreateQuestion} className="rounded-xl border border-emerald-200 bg-white p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <h3 className="font-display font-bold text-sm text-slate-900">Buat Soal Baru (Semua Tipe & Gambar)</h3>
                      <div className="flex items-center gap-2">
                        <select
                          value={qType}
                          onChange={(e) => setQType(e.target.value as QuestionType)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium bg-white"
                        >
                          <option value="PG">PG (Pilihan Ganda)</option>
                          <option value="PGK">PGK (PG Kompleks)</option>
                          <option value="BS">BS (Benar / Salah)</option>
                          <option value="JODOH">JODOH (Menjodohkan)</option>
                          <option value="ISIAN">ISIAN (Isian Singkat)</option>
                          <option value="ESAI">ESAI (Uraian)</option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={qMaxScore}
                          onChange={(e) => setQMaxScore(Number(e.target.value) || 10)}
                          className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                          title="Bobot Skor"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Pertanyaan / Stimulus Soal</label>
                      <textarea
                        rows={3}
                        required
                        placeholder="Tulis pertanyaan soal di sini..."
                        value={qPrompt}
                        onChange={(e) => setQPrompt(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>

                    {/* Optional Image Upload */}
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer">
                        <ImagePlus className="w-4 h-4" />
                        <span>{qImageUrl ? 'Ganti Gambar Soal' : 'Unggah Gambar Soal'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUploadImage(f);
                          }}
                        />
                      </label>
                      {qImageUrl && (
                        <div className="flex items-center gap-2">
                          <img src={qImageUrl} alt="Preview gambar soal" referrerPolicy="no-referrer" className="h-12 rounded border border-slate-200" />
                          <button type="button" onClick={() => setQImageUrl('')} className="text-xs text-red-600 underline">
                            Hapus
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Type-Specific Option & Answer Key Builders */}
                    {(qType === 'PG' || qType === 'PGK') && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-700">
                          Opsi Jawaban & Kunci ({qType === 'PG' ? 'Pilih 1 Kunci' : 'Centang Beberapa Kunci'})
                        </div>
                        {qPgOptions.map((opt, idx) => (
                          <div key={opt.id} className="flex items-center gap-2">
                            {qType === 'PG' ? (
                              <input
                                type="radio"
                                name="pg-correct"
                                checked={qPgCorrect === opt.id}
                                onChange={() => setQPgCorrect(opt.id)}
                              />
                            ) : (
                              <input
                                type="checkbox"
                                checked={qPgkCorrect.includes(opt.id)}
                                onChange={() =>
                                  setQPgkCorrect((prev) =>
                                    prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
                                  )
                                }
                              />
                            )}
                            <span className="font-mono text-xs font-bold w-5">{opt.id}.</span>
                            <input
                              type="text"
                              placeholder={`Teks opsi ${opt.id}`}
                              value={opt.text}
                              onChange={(e) =>
                                setQPgOptions((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x))
                                )
                              }
                              className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {qType === 'BS' && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-700">Daftar Pernyataan & Kunci (B/S)</div>
                        {qBsStatements.map((st, idx) => (
                          <div key={st.id} className="flex items-center gap-2">
                            <span className="font-mono text-xs w-6">{st.id})</span>
                            <input
                              type="text"
                              placeholder="Tulis pernyataan..."
                              value={st.statement}
                              onChange={(e) =>
                                setQBsStatements((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, statement: e.target.value } : x))
                                )
                              }
                              className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-xs"
                            />
                            <select
                              value={qBsCorrect[st.id] || 'B'}
                              onChange={(e) => setQBsCorrect((prev) => ({ ...prev, [st.id]: e.target.value }))}
                              className="px-2 py-1.5 rounded border border-slate-300 text-xs font-mono"
                            >
                              <option value="B">Benar (B)</option>
                              <option value="S">Salah (S)</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {qType === 'JODOH' && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-700">Pasangan Kiri & Kanan</div>
                        {qJodohLeft.map((l, idx) => (
                          <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                            <input
                              type="text"
                              placeholder={`Kiri (${l.id})`}
                              value={l.text}
                              onChange={(e) =>
                                setQJodohLeft((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x))
                                )
                              }
                              className="col-span-5 px-3 py-1.5 rounded border border-slate-300 text-xs"
                            />
                            <span className="col-span-1 text-center text-xs text-slate-400">→</span>
                            <input
                              type="text"
                              placeholder={`Kanan (R${idx + 1})`}
                              value={qJodohRight[idx]?.text || ''}
                              onChange={(e) =>
                                setQJodohRight((prev) =>
                                  prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x))
                                )
                              }
                              className="col-span-4 px-3 py-1.5 rounded border border-slate-300 text-xs"
                            />
                            <select
                              value={qJodohPairs[l.id] || `R${idx + 1}`}
                              onChange={(e) => setQJodohPairs((prev) => ({ ...prev, [l.id]: e.target.value }))}
                              className="col-span-2 px-2 py-1.5 rounded border border-slate-300 text-xs font-mono"
                            >
                              {qJodohRight.map((r) => (
                                <option key={r.id} value={r.id}>{r.id}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}

                    {qType === 'ISIAN' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Kunci Jawaban Diterima (pisahkan variasi jawaban dengan tanda |)
                        </label>
                        <input
                          type="text"
                          placeholder="Contoh: HTTPS | https"
                          value={qIsianAccepted}
                          onChange={(e) => setQIsianAccepted(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-300 text-xs"
                        />
                      </div>
                    )}

                    {qType === 'ESAI' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Pedoman / Referensi Jawaban Esai</label>
                        <textarea
                          rows={2}
                          placeholder="Pedoman penilaian untuk koreksi manual..."
                          value={qEsaiRef}
                          onChange={(e) => setQEsaiRef(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-300 text-xs"
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowNewQuestion(false)}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700"
                      >
                        Batal
                      </button>
                      <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-800 text-white text-xs font-medium">
                        Simpan Soal
                      </button>
                    </div>
                  </form>
                )}

                {/* Existing Questions List */}
                <div className="space-y-3">
                  {questions.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                      Bank soal ini masih kosong. Tambahkan soal secara manual atau import dari file Word (.docx).
                    </div>
                  ) : (
                    questions.map((q, idx) => (
                      <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-2 flex-1">
                            <div className="text-xs text-slate-500 font-mono">
                              No. {idx + 1} · {q.q_type} · Bobot {q.max_score}
                            </div>
                            <div className="text-sm text-slate-900 whitespace-pre-line">{q.prompt_text}</div>
                            {q.image_url && (
                              <img
                                src={q.image_url}
                                alt={`Gambar soal ${idx + 1}`}
                                referrerPolicy="no-referrer"
                                className="max-h-40 rounded border border-slate-200 object-contain"
                              />
                            )}
                            <div className="text-xs text-slate-500 font-mono bg-slate-50 px-2.5 py-1.5 rounded border border-slate-100">
                              Kunci: {q.answer_key_json}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuestion(q.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                            title="Hapus soal"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                Pilih atau buat bank soal di sebelah kiri untuk mulai menyusun soal.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: JADWAL UJIAN */}
      {activeTab === 'exams' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <h2 className="font-display font-bold text-base text-slate-900">Daftar Jadwal Ujian</h2>
            <button
              type="button"
              onClick={() => setShowNewExam((v) => !v)}
              className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Buat Ujian Baru</span>
            </button>
          </div>

          {showNewExam && (
            <form onSubmit={handleCreateExam} className="rounded-xl border border-slate-200 bg-white p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul Ujian</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Penilaian Tengah Semester"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Pilih Bank Soal</label>
                <select
                  required
                  value={examBankId || selectedBankId || ''}
                  onChange={(e) => setExamBankId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} ({b.question_count} soal)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Durasi (Menit)</label>
                  <input
                    type="number"
                    min={5}
                    value={examDuration}
                    onChange={(e) => setExamDuration(Number(e.target.value) || 60)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Batas Pelanggaran (N)</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={examMaxViolations}
                    onChange={(e) => setExamMaxViolations(Number(e.target.value) || 3)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Jadwal Tanggal & Jam Mulai s.d. Selesai */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal & Jam Mulai</label>
                <input
                  type="datetime-local"
                  value={examStartAt}
                  onChange={(e) => setExamStartAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal & Jam Selesai</label>
                <input
                  type="datetime-local"
                  value={examEndAt}
                  onChange={(e) => setExamEndAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono bg-white"
                />
              </div>
              <div className="flex items-end">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Kosongkan tanggal mulai/selesai bila jadwal ujian bersifat fleksibel tanpa batas waktu buka-tutup.
                </p>
              </div>

              {/* Pemilihan Kelas Sesuai Daftar Pengguna */}
              <div className="md:col-span-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">Target Kelas Peserta (Sesuai Daftar Pengguna)</span>
                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="create-exam-classes"
                        checked={examAllClasses}
                        onChange={() => setExamAllClasses(true)}
                      />
                      <span>Semua Kelas</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="create-exam-classes"
                        checked={!examAllClasses}
                        onChange={() => setExamAllClasses(false)}
                      />
                      <span>Pilih Kelas Tertentu</span>
                    </label>
                  </div>
                </div>

                {!examAllClasses && (
                  availableClasses.length === 0 ? (
                    <div className="text-xs text-amber-700">
                      Belum ada kelas siswa terdaftar di daftar pengguna. Tambahkan akun siswa dengan kolom Kelas terlebih dahulu.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {availableClasses.map((cls) => {
                        const checked = examSelectedClasses.includes(cls.class_name);
                        return (
                          <label
                            key={cls.class_name}
                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                              checked
                                ? 'border-emerald-700 bg-emerald-50 text-emerald-950 font-medium'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setExamSelectedClasses((prev) =>
                                    checked ? prev.filter((c) => c !== cls.class_name) : [...prev, cls.class_name]
                                  )
                                }
                              />
                              <span className="truncate">{cls.class_name}</span>
                            </span>
                            <span className="font-mono text-[11px] text-slate-500 shrink-0">{cls.student_count}</span>
                          </label>
                        );
                      })}
                    </div>
                  )
                )}
              </div>

              <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                <div className="flex items-center gap-6 text-xs text-slate-700">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={examShuffle} onChange={(e) => setExamShuffle(e.target.checked)} />
                    <span>Acak Urutan Soal</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={examShowResult} onChange={(e) => setExamShowResult(e.target.checked)} />
                    <span>Tampilkan Nilai ke Siswa Setelah Selesai</span>
                  </label>
                </div>
                <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-800 text-white text-xs font-medium">
                  Terbitkan Ujian Aktif
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {exams.map((ex) => {
              const isEditing = editingExamId === ex.id;
              return (
                <div key={ex.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>{ex.subject} · {ex.duration_minutes} Menit</span>
                      <span className="font-mono font-bold text-emerald-800">Token: {ex.token_code}</span>
                    </div>
                    <h3 className="font-display font-bold text-base text-slate-900">{ex.title}</h3>
                    <div className="mt-2.5 text-xs text-slate-600 space-y-1">
                      <div>
                        <span className="text-slate-500">Jadwal:</span>{' '}
                        {ex.start_at || ex.end_at ? (
                          <span className="font-mono text-slate-800">
                            {formatScheduleTime(ex.start_at)} s.d. {formatScheduleTime(ex.end_at)}
                          </span>
                        ) : (
                          <span>Fleksibel (Tanpa batas jam)</span>
                        )}
                      </div>
                      <div>
                        <span className="text-slate-500">Target Kelas:</span>{' '}
                        <span className="font-medium text-slate-800">
                          {!ex.target_classes || ex.target_classes === 'ALL' ? 'Semua Kelas' : ex.target_classes}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                      <span>Kunci setelah <strong className="font-mono">{ex.max_violations}x</strong> pelanggaran</span>
                      <span className="font-mono">Selesai: {ex.submitted_count ?? 0}</span>
                      <span className="font-mono text-red-700">Terkunci: {ex.locked_count ?? 0}</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-3 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">Mulai</label>
                          <input
                            type="datetime-local"
                            value={editStartAt}
                            onChange={(e) => setEditStartAt(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">Selesai</label>
                          <input
                            type="datetime-local"
                            value={editEndAt}
                            onChange={(e) => setEditEndAt(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white font-mono text-xs"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              checked={editAllClasses}
                              onChange={() => setEditAllClasses(true)}
                            />
                            <span>Semua Kelas</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              checked={!editAllClasses}
                              onChange={() => setEditAllClasses(false)}
                            />
                            <span>Pilih Kelas</span>
                          </label>
                        </div>
                        {!editAllClasses && (
                          <div className="flex flex-wrap gap-1.5">
                            {availableClasses.map((cls) => {
                              const checked = editSelectedClasses.includes(cls.class_name);
                              return (
                                <label
                                  key={cls.class_name}
                                  className={`px-2.5 py-1 rounded border cursor-pointer flex items-center gap-1.5 ${
                                    checked ? 'border-emerald-700 bg-emerald-50 text-emerald-950' : 'border-slate-300 bg-white'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() =>
                                      setEditSelectedClasses((prev) =>
                                        checked ? prev.filter((c) => c !== cls.class_name) : [...prev, cls.class_name]
                                      )
                                    }
                                  />
                                  <span>{cls.class_name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingExamId(null)}
                          className="px-3 py-1.5 rounded border border-slate-300 bg-white text-slate-700 font-medium"
                        >
                          Batal
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveExamSchedule(ex.id)}
                          className="px-3 py-1.5 rounded bg-emerald-800 text-white font-medium"
                        >
                          Simpan Jadwal
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${ex.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-500'}`}>
                      Status: {ex.status}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingExamId(null);
                          } else {
                            setEditingExamId(ex.id);
                            setEditStartAt(toLocalInput(ex.start_at));
                            setEditEndAt(toLocalInput(ex.end_at));
                            const isAll = !ex.target_classes || ex.target_classes.toUpperCase() === 'ALL';
                            setEditAllClasses(isAll);
                            setEditSelectedClasses(
                              isAll
                                ? []
                                : ex.target_classes.split(',').map((s) => s.trim()).filter(Boolean)
                            );
                          }
                        }}
                        className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Ubah Jadwal & Kelas
                      </button>
                      {ex.status !== 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/teacher/exams/${ex.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'ACTIVE' }),
                            });
                            loadBanksAndExams();
                          }}
                          className="px-3 py-1.5 rounded bg-emerald-800 text-white text-xs font-medium whitespace-nowrap"
                        >
                          Aktifkan
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/teacher/exams/${ex.id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'CLOSED' }),
                            });
                            loadBanksAndExams();
                          }}
                          className="px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 whitespace-nowrap"
                        >
                          Tutup Ujian
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: KOREKSI OTOMATIS & MANUAL */}
      {activeTab === 'grading' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-slate-600">Pilih Ujian:</label>
              <select
                value={gradingExamId || ''}
                onChange={(e) => setGradingExamId(Number(e.target.value))}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium"
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.title}</option>
                ))}
              </select>
            </div>

            {gradingExamId && (
              <button
                type="button"
                onClick={async () => {
                  const res = await apiFetch<{ regradedSessions: number }>(`/api/teacher/exams/${gradingExamId}/regrade-auto`, {
                    method: 'POST',
                  });
                  setStatusMsg(`Berhasil menghitung ulang nilai otomatis untuk ${res.regradedSessions} peserta.`);
                  loadGradingList(gradingExamId);
                }}
                className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Hitung Ulang Nilai Otomatis</span>
              </button>
            )}
          </div>

          {inspectingSession ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="font-display font-bold text-lg text-slate-900">
                    Koreksi Manual & Otomatis: {inspectingSession.session.full_name}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {inspectingSession.session.username} · {inspectingSession.session.class_name} · Nilai Saat Ini:{' '}
                    <span className="font-mono font-bold text-slate-900">{inspectingSession.session.final_score}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setInspectingSession(null)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium"
                  >
                    Kembali
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveManualGrades}
                    className="px-4 py-1.5 rounded-lg bg-emerald-800 text-white text-xs font-medium"
                  >
                    Simpan Koreksi & Hitung Total
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {inspectingSession.questions.map((q: any, idx: number) => {
                  const ed = manualEdits[q.id] || { score: '0', note: '', useAuto: true };
                  return (
                    <div key={q.id} className="rounded-lg border border-slate-200 p-4 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-800">
                          No. {idx + 1} · {q.q_type} (Maks Bobot: {q.max_score})
                        </span>
                        <span className="font-mono">Skor Otomatis Sistem: {q.auto_score ?? 0}</span>
                      </div>
                      <div className="text-sm text-slate-900">{q.prompt_text}</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
                          <div className="font-semibold text-slate-700 mb-1">Jawaban Peserta:</div>
                          <div className="font-mono text-slate-900 break-words">{q.answer_json || '(Kosong)'}</div>
                        </div>
                        <div className="p-2.5 rounded bg-emerald-50/50 border border-emerald-200">
                          <div className="font-semibold text-emerald-900 mb-1">Kunci / Referensi Guru:</div>
                          <div className="font-mono text-emerald-900 break-words">{q.answer_key_json}</div>
                        </div>
                      </div>

                      <div className="pt-2 flex flex-wrap items-center gap-4 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!ed.useAuto}
                            onChange={(e) =>
                              setManualEdits((prev) => ({
                                ...prev,
                                [q.id]: { ...ed, useAuto: !e.target.checked },
                              }))
                            }
                          />
                          <span className="font-medium text-slate-800">Gunakan Nilai Manual Guru</span>
                        </label>
                        {!ed.useAuto && (
                          <div className="flex items-center gap-2">
                            <span>Skor Butir:</span>
                            <input
                              type="number"
                              min={0}
                              max={q.max_score}
                              step="0.5"
                              value={ed.score}
                              onChange={(e) =>
                                setManualEdits((prev) => ({
                                  ...prev,
                                  [q.id]: { ...ed, score: e.target.value },
                                }))
                              }
                              className="w-20 px-2 py-1 rounded border border-slate-300 font-mono"
                            />
                          </div>
                        )}
                        <input
                          type="text"
                          placeholder="Catatan koreksi guru (opsional)"
                          value={ed.note}
                          onChange={(e) =>
                            setManualEdits((prev) => ({
                              ...prev,
                              [q.id]: { ...ed, note: e.target.value },
                            }))
                          }
                          className="flex-1 min-w-[200px] px-3 py-1 rounded border border-slate-300"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs">
                  <label className="font-medium text-slate-700">Penyesuaian Nilai Akhir Manual (+/-):</label>
                  <input
                    type="number"
                    step="0.5"
                    value={sessionAdjustment}
                    onChange={(e) => setSessionAdjustment(e.target.value)}
                    className="w-24 px-2.5 py-1.5 rounded border border-slate-300 font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveManualGrades}
                  className="px-5 py-2 rounded-lg bg-emerald-800 text-white text-xs font-medium"
                >
                  Simpan Semua Koreksi
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Peserta</th>
                    <th className="text-left px-3 py-2.5 font-medium">Kelas</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status Koreksi</th>
                    <th className="text-right px-3 py-2.5 font-medium">Nilai Otomatis</th>
                    <th className="text-right px-3 py-2.5 font-medium">Nilai Akhir</th>
                    <th className="text-right px-4 py-2.5 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!gradingData || gradingData.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                        Belum ada peserta yang mengikuti ujian ini.
                      </td>
                    </tr>
                  ) : (
                    gradingData.sessions.map((s: any) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{s.full_name}</div>
                          <div className="text-xs font-mono text-slate-500">{s.username}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-600">{s.class_name}</td>
                        <td className="px-3 py-3 text-xs">
                          {s.status === 'LOCKED' ? (
                            <span className="text-red-700 font-medium inline-flex items-center gap-1">
                              <Lock className="w-3.5 h-3.5" /> Terkunci
                            </span>
                          ) : s.grading_status === 'NEEDS_REVIEW' ? (
                            <span className="text-amber-700 font-medium">Perlu Koreksi Esai</span>
                          ) : (
                            <span className="text-emerald-700 font-medium">Selesai Dinilai</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">{s.auto_score}</td>
                        <td className="px-3 py-3 text-right font-mono text-sm font-bold text-slate-900 tabular-nums">
                          {s.final_score}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleInspectStudent(s.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-800"
                          >
                            Periksa & Koreksi
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ANALISIS BUTIR SOAL & EKSPOR EXCEL */}
      {activeTab === 'analysis' && <ItemAnalysisView exams={exams} />}
    </div>
  );
}
