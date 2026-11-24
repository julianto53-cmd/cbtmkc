import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudOff,
  Lock,
  Maximize2,
  RefreshCw,
  Send,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { clearExamLocalState, loadExamLocalState, saveExamLocalState } from '../lib/examCache';
import { AuthUser, StudentExamCard } from '../types';

interface StudentPortalProps {
  user: AuthUser;
  prefillTokenCode?: string;
  onExamLockChange: (inExam: boolean) => void;
}

interface ActiveExamSession {
  id: number;
  examId: number;
  status: 'IN_PROGRESS' | 'LOCKED' | 'SUBMITTED';
  violationCount: number;
  maxViolations: number;
  lockedReason: string;
  remainingSeconds: number;
  durationMinutes: number;
  title: string;
  showResultToStudent: boolean;
  finalScore: number | null;
}

export function StudentPortal({ user, prefillTokenCode = '', onExamLockChange }: StudentPortalProps) {
  const [exams, setExams] = useState<StudentExamCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokenInputs, setTokenInputs] = useState<Record<number, string>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [startingId, setStartingId] = useState<number | null>(null);

  // Active exam runner state
  const [activeSession, setActiveSession] = useState<ActiveExamSession | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ exams: StudentExamCard[] }>('/api/student/exams');
      const list = data.exams || [];
      setExams(list);
      if (prefillTokenCode) {
        setTokenInputs((prev) => {
          const next = { ...prev };
          for (const ex of list) {
            if (!ex.session_id && !next[ex.id]) {
              next[ex.id] = prefillTokenCode;
            }
          }
          return next;
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat daftar ujian.');
    } finally {
      setLoading(false);
    }
  }, [prefillTokenCode]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  const handleStartExam = async (examCard: StudentExamCard) => {
    setErrorMsg('');
    setStartingId(examCard.id);
    try {
      // Request fullscreen immediately on user gesture
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }

      const data = await apiFetch<{
        session: ActiveExamSession;
        questions: any[];
        savedAnswers: Record<number, unknown>;
      }>(`/api/student/exams/${examCard.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ tokenCode: tokenInputs[examCard.id] || '' }),
      });

      const cacheKey = `exam_${examCard.id}_student_${user.id}`;
      const localCached = await loadExamLocalState(cacheKey);

      // Merge any unsynced offline answers from device cache if same session
      const mergedAnswers: Record<number, unknown> = { ...(data.savedAnswers || {}) };
      if (localCached && localCached.sessionId === data.session.id) {
        for (const qid of localCached.pendingAnswerIds || []) {
          if (localCached.answers[qid] !== undefined) {
            mergedAnswers[qid] = localCached.answers[qid];
          }
        }
      }

      await saveExamLocalState({
        cacheKey,
        sessionId: data.session.id,
        examId: examCard.id,
        title: data.session.title,
        durationMinutes: data.session.durationMinutes,
        maxViolations: data.session.maxViolations,
        questions: data.questions,
        answers: mergedAnswers,
        pendingAnswerIds: localCached?.pendingAnswerIds || [],
        pendingViolations: localCached?.pendingViolations || [],
        updatedAt: Date.now(),
      });

      setQuestions(data.questions);
      setAnswers(mergedAnswers);
      setActiveSession(data.session);
      onExamLockChange(true);
    } catch (err: any) {
      setErrorMsg(err.message || 'Tidak dapat memulai ujian.');
    } finally {
      setStartingId(null);
    }
  };

  if (activeSession) {
    return (
      <StudentExamRunner
        user={user}
        initialSession={activeSession}
        questions={questions}
        initialAnswers={answers}
        onFinish={() => {
          setActiveSession(null);
          setQuestions([]);
          setAnswers({});
          onExamLockChange(false);
          if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
          loadExams();
        }}
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="text-xs font-medium text-emerald-800 mb-1">Portal Peserta Ujian</div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Daftar Ujian Tersedia</h1>
          <p className="text-sm text-slate-600 mt-1">
            {user.fullName} · {user.className || 'Peserta'} · {user.username}
          </p>
        </div>
        <button
          type="button"
          onClick={loadExams}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Muat Ulang</span>
        </button>
      </div>

      {errorMsg && (
        <div role="alert" className="mt-5 p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-xl border border-slate-200 bg-white p-6 animate-pulse" />
          ))}
        </div>
      ) : exams.length === 0 ? (
        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">Belum ada jadwal ujian aktif saat ini.</p>
          <p className="text-xs text-slate-500 mt-1">Silakan tunggu instruksi pengawas atau muat ulang halaman.</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-5">
          {exams.map((exam) => {
            const isSubmitted = exam.session_status === 'SUBMITTED';
            const isLocked = exam.session_status === 'LOCKED';
            const inProgress = exam.session_status === 'IN_PROGRESS';
            const isUpcoming = !exam.session_id && exam.schedule_state === 'UPCOMING';
            const isExpired = !exam.session_id && exam.schedule_state === 'EXPIRED';
            const fmtDt = (iso?: string) => {
              if (!iso) return '-';
              const d = new Date(iso);
              if (Number.isNaN(d.getTime())) return '-';
              return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
            };

            return (
              <div key={exam.id} className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-2">
                    <span>{exam.subject}</span>
                    <span className="tabular-nums">{exam.question_count} Soal · {exam.duration_minutes} Menit</span>
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900">{exam.title}</h2>
                  <div className="mt-2.5 text-xs text-slate-600 space-y-1">
                    {(exam.start_at || exam.end_at) && (
                      <div>
                        Jadwal: <span className="font-mono text-slate-800">{fmtDt(exam.start_at)}</span> s.d.{' '}
                        <span className="font-mono text-slate-800">{fmtDt(exam.end_at)}</span>
                      </div>
                    )}
                    <div>
                      Kelas: <span className="font-medium text-slate-800">{!exam.target_classes || exam.target_classes === 'ALL' ? 'Semua Kelas' : exam.target_classes}</span>
                      {' · '}Batas pelanggaran: <span className="font-mono font-semibold text-slate-700">{exam.max_violations}x</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100">
                  {isSubmitted ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Selesai Dikumpulkan</span>
                      </div>
                      {exam.show_result_to_student ? (
                        <div className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                          Nilai: {exam.final_score ?? 0}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500">Menunggu rilis nilai</div>
                      )}
                    </div>
                  ) : isUpcoming ? (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900">
                      Ujian belum dimulai. Dibuka pada <span className="font-mono font-semibold">{fmtDt(exam.start_at)}</span>.
                    </div>
                  ) : isExpired ? (
                    <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                      Batas jadwal ujian telah berakhir pada <span className="font-mono">{fmtDt(exam.end_at)}</span>.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {!exam.session_id && exam.requires_token !== false && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 mb-1">Token Ujian dari Pengawas</label>
                          <input
                            type="text"
                            placeholder="Masukkan token (cth: MKC2026)"
                            value={tokenInputs[exam.id] || ''}
                            onChange={(e) => setTokenInputs((prev) => ({ ...prev, [exam.id]: e.target.value.toUpperCase() }))}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          />
                        </div>
                      )}
                      {!exam.session_id && exam.requires_token === false && (
                        <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 text-xs text-emerald-900">
                          Ujian ini <strong>tanpa token</strong>. Klik tombol di bawah untuk langsung memulai.
                        </div>
                      )}

                      {isLocked && (
                        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
                          <Lock className="w-4 h-4 shrink-0" />
                          <span>Sesi terkunci oleh sistem. Masuk untuk melihat status pembukaan kunci pengawas.</span>
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={startingId === exam.id}
                        onClick={() => handleStartExam(exam)}
                        className="w-full py-2.5 px-4 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <Maximize2 className="w-4 h-4" />
                        <span>
                          {startingId === exam.id
                            ? 'Memuat Soal...'
                            : inProgress || isLocked
                              ? 'Lanjutkan Ujian (Layar Penuh)'
                              : 'Mulai Ujian (Layar Penuh)'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Secure Fullscreen Student Exam Runner (Offline Cache + Batched Sync + Anti-Cheat)
// ============================================================================
function StudentExamRunner({
  user,
  initialSession,
  questions,
  initialAnswers,
  onFinish,
}: {
  user: AuthUser;
  initialSession: ActiveExamSession;
  questions: any[];
  initialAnswers: Record<number, unknown>;
  onFinish: () => void;
}) {
  const cacheKey = `exam_${initialSession.examId}_student_${user.id}`;

  const [session, setSession] = useState<ActiveExamSession>(initialSession);
  const [answers, setAnswers] = useState<Record<number, unknown>>(initialAnswers);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingSec, setRemainingSec] = useState(initialSession.remainingSeconds);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncState, setSyncState] = useState<'synced' | 'pending' | 'syncing' | 'offline'>(
    navigator.onLine ? 'synced' : 'offline'
  );
  const [warningBanner, setWarningBanner] = useState<string>('');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<{ score: number | null; show: boolean } | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  const pendingAnswerIdsRef = useRef<Set<number>>(new Set());
  const pendingViolationsRef = useRef<Array<{ type: string; detail: string; timestamp: string }>>([]);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lastViolationTimeRef = useRef<number>(0);

  // Persist locally to IndexedDB immediately
  const persistLocal = useCallback(async () => {
    await saveExamLocalState({
      cacheKey,
      sessionId: sessionRef.current.id,
      examId: sessionRef.current.examId,
      title: sessionRef.current.title,
      durationMinutes: sessionRef.current.durationMinutes,
      maxViolations: sessionRef.current.maxViolations,
      questions,
      answers: answersRef.current,
      pendingAnswerIds: Array.from(pendingAnswerIdsRef.current),
      pendingViolations: pendingViolationsRef.current,
      updatedAt: Date.now(),
    });
  }, [cacheKey, questions]);

  // Flush batched answers & violations to server
  const flushSync = useCallback(async () => {
    const s = sessionRef.current;
    if (s.status === 'SUBMITTED') return;

    const dirtyIds = Array.from(pendingAnswerIdsRef.current);
    const dirtyViolations = [...pendingViolationsRef.current];
    if (dirtyIds.length === 0 && dirtyViolations.length === 0) return;

    if (!navigator.onLine) {
      setSyncState('offline');
      return;
    }

    setSyncState('syncing');
    const answerPayload = dirtyIds.map((qId) => ({
      questionId: qId,
      answer: answersRef.current[qId] ?? null,
    }));

    try {
      const resp = await apiFetch<{
        ok: boolean;
        status: 'IN_PROGRESS' | 'LOCKED' | 'SUBMITTED';
        violationCount: number;
        maxViolations: number;
        lockedReason: string;
      }>(`/api/student/sessions/${s.id}/sync`, {
        method: 'POST',
        body: JSON.stringify({
          answers: answerPayload,
          violations: dirtyViolations,
        }),
      });

      // Clear synced items from queues
      for (const id of dirtyIds) pendingAnswerIdsRef.current.delete(id);
      pendingViolationsRef.current = pendingViolationsRef.current.slice(dirtyViolations.length);

      setSession((prev) => ({
        ...prev,
        status: resp.status,
        violationCount: resp.violationCount,
        lockedReason: resp.lockedReason || prev.lockedReason,
      }));
      setSyncState(pendingAnswerIdsRef.current.size > 0 ? 'pending' : 'synced');
      await persistLocal();
    } catch {
      setSyncState('offline');
    }
  }, [persistLocal]);

  // Record a security violation (debounced 1200ms to prevent double-trigger from blur + visibilitychange)
  const recordViolation = useCallback(
    (type: string, detail: string) => {
      if (sessionRef.current.status !== 'IN_PROGRESS') return;
      const now = Date.now();
      if (now - lastViolationTimeRef.current < 1200) return;
      lastViolationTimeRef.current = now;

      pendingViolationsRef.current.push({
        type,
        detail,
        timestamp: new Date().toISOString(),
      });
      setWarningBanner(`Pelanggaran tercatat: ${detail}`);
      setSession((prev) => ({
        ...prev,
        violationCount: prev.violationCount + 1,
      }));
      persistLocal();
      flushSync();
    },
    [flushSync, persistLocal]
  );

  // Fullscreen enforcement + Anti-cheat listeners
  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs && sessionRef.current.status === 'IN_PROGRESS') {
        recordViolation('FULLSCREEN_EXIT', 'Keluar dari mode layar penuh saat ujian');
      }
    };

    const onVisibility = () => {
      if (document.hidden && sessionRef.current.status === 'IN_PROGRESS') {
        recordViolation('TAB_SWITCH', 'Berpindah tab atau meminimalkan jendela ujian');
      }
    };

    const onBlur = () => {
      if (sessionRef.current.status === 'IN_PROGRESS') {
        recordViolation('WINDOW_BLUR', 'Membuka aplikasi lain atau keluar dari fokus jendela ujian');
      }
    };

    const onCopyPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      recordViolation('COPY_PASTE', `Percobaan ${e.type === 'paste' ? 'menempel' : 'menyalin/memotong'} teks ujian`);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      recordViolation('RIGHT_CLICK', 'Menggunakan klik kanan di halaman ujian');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.key === 'PrintScreen' || (e.metaKey && e.shiftKey && key === 's') || (e.ctrlKey && e.shiftKey && key === 's')) {
        e.preventDefault();
        recordViolation('SCREENSHOT_ATTEMPT', 'Percobaan tangkapan layar (Screenshot)');
      } else if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'x', 'p', 'u', 'r'].includes(key)) {
        e.preventDefault();
        if (['c', 'v', 'x'].includes(key)) {
          recordViolation('COPY_PASTE', 'Pintasan keyboard salin/tempel');
        } else if (key === 'p') {
          recordViolation('SCREENSHOT_ATTEMPT', 'Percobaan cetak / tangkap halaman (Ctrl+P)');
        }
      } else if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(key))) {
        e.preventDefault();
        recordViolation('DEVTOOLS_SHORTCUT', 'Percobaan membuka alat pengembang (DevTools)');
      } else if (e.key === 'F5') {
        e.preventDefault();
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sessionRef.current.status === 'IN_PROGRESS') {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    // Block browser back button during active exam
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      if (sessionRef.current.status === 'IN_PROGRESS') {
        window.history.pushState(null, '', window.location.href);
        setWarningBanner('Anda tidak dapat meninggalkan halaman ujian sebelum mengumpulkan jawaban.');
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopyPaste);
    document.addEventListener('cut', onCopyPaste);
    document.addEventListener('paste', onCopyPaste);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);

    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopyPaste);
      document.removeEventListener('cut', onCopyPaste);
      document.removeEventListener('paste', onCopyPaste);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, [recordViolation]);

  // Network listeners + 10s Batched Answer Sync
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushSync();
    };
    const onOffline = () => {
      setIsOnline(false);
      setSyncState('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const syncInterval = setInterval(() => {
      flushSync();
    }, 10000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(syncInterval);
    };
  }, [flushSync]);

  // Poll unlock status when LOCKED
  useEffect(() => {
    if (session.status !== 'LOCKED') return;
    const poll = setInterval(async () => {
      try {
        const st = await apiFetch<{
          status: 'IN_PROGRESS' | 'LOCKED' | 'SUBMITTED';
          violationCount: number;
          lockedReason: string;
        }>(`/api/student/sessions/${session.id}/status`);
        if (st.status !== 'LOCKED') {
          setSession((prev) => ({
            ...prev,
            status: st.status,
            violationCount: st.violationCount,
            lockedReason: '',
          }));
          setWarningBanner('Ujian telah dibuka kembali oleh pengawas. Silakan lanjutkan.');
        }
      } catch {
        // Retry next interval
      }
    }, 4000);
    return () => clearInterval(poll);
  }, [session.id, session.status]);

  // Countdown Timer
  useEffect(() => {
    if (session.status !== 'IN_PROGRESS') return;
    const t = setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          handleFinalSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  const handleAnswerChange = (questionId: number, value: unknown) => {
    if (session.status !== 'IN_PROGRESS') return;
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    pendingAnswerIdsRef.current.add(questionId);
    setSyncState(navigator.onLine ? 'pending' : 'offline');
    persistLocal();
  };

  const handleFinalSubmit = async (autoTimeUp = false) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Send all answers in one final batch so zero answers are lost even after offline period
      const allPayload = questions.map((q) => ({
        questionId: q.id,
        answer: answersRef.current[q.id] ?? null,
      }));
      const resp = await apiFetch<{
        ok: boolean;
        finalScore: number | null;
        showResultToStudent: boolean;
      }>(`/api/student/sessions/${session.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ answers: allPayload, autoTimeUp }),
      });

      await clearExamLocalState(cacheKey);
      setSession((prev) => ({ ...prev, status: 'SUBMITTED' }));
      setSubmittedResult({ score: resp.finalScore, show: resp.showResultToStudent });
    } catch (err: any) {
      setWarningBanner(err.message || 'Gagal mengirim jawaban akhir. Pastikan koneksi internet aktif lalu coba lagi.');
      setConfirmSubmit(false);
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimer = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h > 0 ? `${String(h).padStart(2, '0')}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (submittedResult) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="font-display text-xl font-bold text-slate-900">Ujian Telah Dikumpulkan</h2>
          <p className="text-sm text-slate-600 mt-2">{session.title}</p>

          {submittedResult.show && submittedResult.score !== null ? (
            <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Nilai Otomatis Sementara</div>
              <div className="text-3xl font-mono font-bold text-emerald-800 mt-1 tabular-nums">
                {submittedResult.score}
              </div>
              <div className="text-xs text-slate-500 mt-1">Soal esai (jika ada) akan diperiksa oleh guru.</div>
            </div>
          ) : (
            <div className="mt-6 p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              Jawaban Anda tersimpan aman. Hasil nilai akan diumumkan oleh guru pengampu.
            </div>
          )}

          <button
            type="button"
            onClick={onFinish}
            className="mt-6 w-full py-2.5 px-4 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-medium"
          >
            Kembali ke Daftar Ujian
          </button>
        </div>
      </div>
    );
  }

  // Mandatory Lockout Screen when violations >= N
  if (session.status === 'LOCKED') {
    return (
      <div className="fixed inset-0 z-50 bg-slate-950 text-white flex items-center justify-center p-6 select-none">
        <div className="max-w-lg w-full rounded-2xl border border-red-500/40 bg-slate-900 p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-7 h-7" />
          </div>
          <h2 className="font-display text-2xl font-bold text-white">Ujian Dikunci Sementara</h2>
          <p className="text-sm text-slate-300 mt-3 leading-relaxed">
            {session.lockedReason || `Anda mencapai batas maksimal ${session.maxViolations} pelanggaran keamanan ujian.`}
          </p>
          <div className="mt-6 p-4 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 space-y-1.5">
            <div>Peserta: <span className="font-semibold text-white">{user.fullName}</span> ({user.username})</div>
            <div>Pelanggaran tercatat: <span className="font-mono font-bold text-red-400">{session.violationCount} / {session.maxViolations}</span></div>
            <div className="text-amber-300 pt-1">
              Hanya Pengawas ruang yang dapat membuka kembali sesi ujian Anda. Layar ini akan terbuka otomatis setelah pengawas menyetujui.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const answeredCount = questions.filter((q) => {
    const val = answers[q.id];
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val as object).length > 0;
    return true;
  }).length;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col select-none">
      {/* Mandatory Fullscreen Gate Overlay */}
      {!isFullscreen && (
        <div className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-6 text-white">
          <div className="max-w-md w-full rounded-xl border border-slate-700 bg-slate-900 p-7 text-center">
            <Maximize2 className="w-10 h-10 text-amber-400 mx-auto mb-3" />
            <h2 className="font-display text-xl font-bold">Mode Layar Penuh Diwajibkan</h2>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Demi integritas ujian, MKC CBT hanya dapat dikerjakan dalam mode layar penuh. Keluar dari layar penuh atau membuka aplikasi lain dicatat sebagai pelanggaran.
            </p>
            <button
              type="button"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
              className="mt-6 w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium flex items-center justify-center gap-2"
            >
              <Maximize2 className="w-4 h-4" />
              <span>Aktifkan Layar Penuh & Lanjutkan</span>
            </button>
          </div>
        </div>
      )}

      {/* Restricted Exam Header (NO Home / Logout navigation!) */}
      <header className="bg-white border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30">
        <div className="min-w-0">
          <div className="text-sm font-display font-bold text-slate-900 truncate">{session.title}</div>
          <div className="text-xs text-slate-500">
            {user.fullName} · {user.username} · {answeredCount}/{questions.length} Terjawab
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Live Sync & Offline Queue Indicator */}
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {!isOnline || syncState === 'offline' ? (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <CloudOff className="w-4 h-4" />
                <span>Offline · Tersimpan di Perangkat</span>
              </span>
            ) : syncState === 'syncing' ? (
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Mengirim Batch...</span>
              </span>
            ) : syncState === 'pending' ? (
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                <Wifi className="w-3.5 h-3.5 text-amber-600" />
                <span>Menunggu Sinkronisasi</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <Wifi className="w-3.5 h-3.5" />
                <span>Tersinkron</span>
              </span>
            )}
          </div>

          {/* Violation Counter */}
          <div
            className={`text-xs font-mono font-semibold tabular-nums flex items-center gap-1.5 ${
              session.violationCount > 0 ? 'text-red-700' : 'text-slate-600'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Pelanggaran: {session.violationCount}/{session.maxViolations}</span>
          </div>

          {/* Countdown */}
          <div
            className={`px-3 py-1.5 rounded-lg border font-mono text-sm font-bold tabular-nums flex items-center gap-1.5 ${
              remainingSec < 300 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{formatTimer(remainingSec)}</span>
          </div>

          <button
            type="button"
            onClick={() => setConfirmSubmit(true)}
            className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Kumpulkan Ujian</span>
          </button>
        </div>
      </header>

      {warningBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>{warningBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setWarningBanner('')}
            className="text-amber-800 underline shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Main 2-Zone Exam Stage */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Question Card (Left 8 cols) */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          {currentQ ? (
            <>
              <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100 text-xs text-slate-500">
                <span className="font-mono font-semibold text-slate-800">
                  Soal No. {currentIndex + 1} dari {questions.length}
                </span>
                <span>Tipe: {currentQ.qType} · Bobot {currentQ.maxScore}</span>
              </div>

              <div className="mt-5 text-base text-slate-900 leading-relaxed whitespace-pre-line">
                {currentQ.promptText}
              </div>

              {currentQ.imageUrl && (
                <div className="mt-4">
                  <img
                    src={currentQ.imageUrl}
                    alt={`Ilustrasi soal ${currentIndex + 1}`}
                    referrerPolicy="no-referrer"
                    onClick={() => setZoomImage(currentQ.imageUrl)}
                    className="max-h-72 rounded-lg border border-slate-200 object-contain cursor-zoom-in bg-slate-50"
                  />
                  <div className="text-xs text-slate-400 mt-1">Klik gambar untuk memperbesar</div>
                </div>
              )}

              {/* Answer Input by Question Type */}
              <div className="mt-6">
                <StudentQuestionInput
                  question={currentQ}
                  value={answers[currentQ.id]}
                  onChange={(val) => handleAnswerChange(currentQ.id, val)}
                />
              </div>

              {/* Navigation Footer */}
              <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Sebelumnya</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    flushSync();
                    if (currentIndex < questions.length - 1) {
                      setCurrentIndex((i) => i + 1);
                    } else {
                      setConfirmSubmit(true);
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium flex items-center gap-1.5"
                >
                  <span>{currentIndex < questions.length - 1 ? 'Simpan & Berikutnya' : 'Selesai & Kumpulkan'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Memuat soal...</div>
          )}
        </div>

        {/* Question Number Navigation Grid (Right 4 cols) */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-display font-bold text-slate-900 mb-3">Navigasi Nomor Soal</div>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((q, idx) => {
              const val = answers[q.id];
              const hasAnswer =
                val !== null &&
                val !== undefined &&
                val !== '' &&
                (!Array.isArray(val) || val.length > 0) &&
                (typeof val !== 'object' || Object.keys(val as object).length > 0);
              const isCurr = idx === currentIndex;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`h-10 rounded-lg font-mono text-xs font-semibold tabular-nums transition-colors border ${
                    isCurr
                      ? 'bg-emerald-800 text-white border-emerald-900'
                      : hasAnswer
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-600">
            <div className="flex items-center justify-between">
              <span>Terjawab</span>
              <span className="font-mono font-semibold tabular-nums">{answeredCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Belum dijawab</span>
              <span className="font-mono font-semibold tabular-nums">{questions.length - answeredCount}</span>
            </div>
            <button
              type="button"
              onClick={flushSync}
              className="mt-2 w-full py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
            >
              Sinkronkan Batch Sekarang
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Submit Modal */}
      {confirmSubmit && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-xl bg-white border border-slate-200 p-6">
            <h3 className="font-display text-lg font-bold text-slate-900">Kumpulkan Jawaban Ujian?</h3>
            <p className="text-sm text-slate-600 mt-2">
              Anda telah menjawab <span className="font-mono font-semibold">{answeredCount}</span> dari{' '}
              <span className="font-mono font-semibold">{questions.length}</span> soal. Setelah dikumpulkan, jawaban tidak dapat diubah lagi.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmSubmit(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Periksa Kembali
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleFinalSubmit(false)}
                className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium disabled:opacity-50"
              >
                {submitting ? 'Mengumpulkan...' : 'Ya, Kumpulkan Sekarang'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-6"
          onClick={() => setZoomImage(null)}
        >
          <img
            src={zoomImage}
            alt="Perbesaran gambar soal"
            referrerPolicy="no-referrer"
            className="max-w-full max-h-[90vh] rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

function StudentQuestionInput({
  question,
  value,
  onChange,
}: {
  question: any;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const opts = question.options || {};

  if (question.qType === 'PG') {
    const list: Array<{ id: string; text: string; imageUrl?: string }> = Array.isArray(opts) ? opts : [];
    const selected = typeof value === 'string' ? value : '';
    return (
      <div className="space-y-2.5">
        {list.map((o) => {
          const active = selected === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-start gap-3 ${
                active
                  ? 'border-emerald-700 bg-emerald-50/70 text-slate-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full border text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                  active ? 'bg-emerald-800 text-white border-emerald-800' : 'border-slate-300 text-slate-600'
                }`}
              >
                {o.id}
              </span>
              <div className="flex-1 text-sm leading-relaxed">
                <div>{o.text}</div>
                {o.imageUrl && (
                  <img src={o.imageUrl} alt={`Opsi ${o.id}`} referrerPolicy="no-referrer" className="mt-2 max-h-36 rounded border border-slate-200" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.qType === 'PGK') {
    const list: Array<{ id: string; text: string }> = Array.isArray(opts) ? opts : [];
    const selectedArr: string[] = Array.isArray(value) ? value : [];
    const toggle = (id: string) => {
      if (selectedArr.includes(id)) onChange(selectedArr.filter((x) => x !== id));
      else onChange([...selectedArr, id]);
    };
    return (
      <div className="space-y-2.5">
        <div className="text-xs text-slate-500 mb-1">Pilih satu atau lebih jawaban yang benar:</div>
        {list.map((o) => {
          const active = selectedArr.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className={`w-full text-left p-3.5 rounded-lg border transition-colors flex items-start gap-3 ${
                active
                  ? 'border-emerald-700 bg-emerald-50/70 text-slate-900'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
              }`}
            >
              <span
                className={`w-6 h-6 rounded border text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                  active ? 'bg-emerald-800 text-white border-emerald-800' : 'border-slate-300 text-slate-600'
                }`}
              >
                {active ? '✓' : o.id}
              </span>
              <span className="text-sm leading-relaxed">{o.text}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (question.qType === 'BS') {
    const statements: Array<{ id: string; statement: string }> = Array.isArray(opts) ? opts : [];
    const ansMap = (typeof value === 'object' && value !== null ? value : {}) as Record<string, string>;
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Pernyataan</th>
              <th className="w-24 text-center px-3 py-2.5 font-medium">Benar</th>
              <th className="w-24 text-center px-3 py-2.5 font-medium">Salah</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {statements.map((st) => (
              <tr key={st.id} className="bg-white">
                <td className="px-4 py-3 text-slate-800">{st.statement}</td>
                <td className="text-center px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onChange({ ...ansMap, [st.id]: 'B' })}
                    className={`px-3 py-1.5 rounded text-xs font-medium border ${
                      ansMap[st.id] === 'B'
                        ? 'bg-emerald-800 text-white border-emerald-800'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Benar
                  </button>
                </td>
                <td className="text-center px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onChange({ ...ansMap, [st.id]: 'S' })}
                    className={`px-3 py-1.5 rounded text-xs font-medium border ${
                      ansMap[st.id] === 'S'
                        ? 'bg-emerald-800 text-white border-emerald-800'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Salah
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (question.qType === 'JODOH') {
    const left: Array<{ id: string; text: string }> = Array.isArray(opts.left) ? opts.left : [];
    const right: Array<{ id: string; text: string }> = Array.isArray(opts.right) ? opts.right : [];
    const pairs = (typeof value === 'object' && value !== null ? value : {}) as Record<string, string>;
    return (
      <div className="space-y-3">
        <div className="text-xs text-slate-500">Pilih pasangan yang sesuai untuk setiap item di kolom kiri:</div>
        {left.map((l) => (
          <div key={l.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50/50">
            <div className="text-sm font-medium text-slate-900">
              <span className="font-mono text-xs text-slate-500 mr-2">{l.id}.</span>
              {l.text}
            </div>
            <select
              value={pairs[l.id] || ''}
              onChange={(e) => onChange({ ...pairs, [l.id]: e.target.value })}
              className="sm:w-72 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="">-- Pilih Pasangan --</option>
              {right.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}. {r.text}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  }

  if (question.qType === 'ISIAN') {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1.5">Jawaban Singkat</label>
        <input
          type="text"
          placeholder="Ketik jawaban singkat Anda di sini..."
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>
    );
  }

  // ESAI
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">Jawaban Uraian / Esai</label>
      <textarea
        rows={6}
        placeholder="Tulis jawaban uraian Anda secara lengkap dan jelas..."
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-lg border border-slate-300 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-600"
      />
    </div>
  );
}
