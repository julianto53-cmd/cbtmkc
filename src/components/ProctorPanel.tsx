import { AlertTriangle, CheckCircle2, Lock, RefreshCw, ShieldAlert, Unlock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { AuthUser } from '../types';

interface ProctorPanelProps {
  user: AuthUser;
}

export function ProctorPanel({ user }: ProctorPanelProps) {
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null);
  const [monitorData, setMonitorData] = useState<{
    exam: any;
    sessions: any[];
    recentViolations: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [unlockingId, setUnlockingId] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const canUnlock = user.role === 'pengawas' || user.role === 'admin';

  const loadExams = useCallback(async () => {
    try {
      const data = await apiFetch<{ exams: any[] }>('/api/proctor/exams');
      setExams(data.exams || []);
      if (data.exams?.length > 0 && !selectedExamId) {
        setSelectedExamId(data.exams[0].id);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [selectedExamId]);

  const loadMonitor = useCallback(async () => {
    if (!selectedExamId) return;
    try {
      const data = await apiFetch<any>(`/api/proctor/exams/${selectedExamId}/monitor`);
      setMonitorData(data);
    } catch {
      // Ignore
    }
  }, [selectedExamId]);

  useEffect(() => {
    loadExams();
  }, [loadExams]);

  useEffect(() => {
    loadMonitor();
    const timer = setInterval(loadMonitor, 5000);
    return () => clearInterval(timer);
  }, [loadMonitor]);

  const handleUnlock = async (sessionId: number, resetViolations: boolean) => {
    setUnlockingId(sessionId);
    setStatusMsg('');
    try {
      await apiFetch(`/api/proctor/sessions/${sessionId}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ resetViolations }),
      });
      setStatusMsg('Kunci ujian peserta berhasil dibuka kembali.');
      await loadMonitor();
    } catch (err: any) {
      setStatusMsg(err.message || 'Gagal membuka kunci ujian.');
    } finally {
      setUnlockingId(null);
    }
  };

  const lockedSessions = (monitorData?.sessions || []).filter((s) => s.status === 'LOCKED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Ruang Pengawas & Keamanan Ujian</h1>
          <p className="text-sm text-slate-600 mt-1">
            Pemantauan peserta langsung, catatan pelanggaran layar penuh, dan pembukaan kunci sesi ujian.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedExamId || ''}
            onChange={(e) => setSelectedExamId(Number(e.target.value))}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-800"
          >
            {exams.length === 0 && <option value="">Belum ada ujian</option>}
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.title} ({ex.token_code ? `Token: ${ex.token_code}` : 'Tanpa Token'})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { loadExams(); loadMonitor(); }}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm">
          {statusMsg}
        </div>
      )}

      {loading ? (
        <div className="h-40 rounded-xl border border-slate-200 bg-white animate-pulse" />
      ) : !monitorData ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Pilih jadwal ujian untuk memantau peserta.
        </div>
      ) : (
        <>
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Token Masuk Ujian</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tracking-wider">
                {monitorData.exam.token_code || 'Tanpa Token'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Sedang Mengerjakan</div>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                {monitorData.sessions.filter((s) => s.status === 'IN_PROGRESS').length}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Terkunci (Pelanggaran &ge; {monitorData.exam.max_violations})</div>
              <div className="mt-1 font-mono text-2xl font-bold text-red-700 tabular-nums">
                {lockedSessions.length}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Selesai Mengumpulkan</div>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {monitorData.sessions.filter((s) => s.status === 'SUBMITTED').length}
              </div>
            </div>
          </div>

          {/* Priority Alert: Locked Participants */}
          {lockedSessions.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-5">
              <div className="flex items-center gap-2 text-sm font-display font-bold text-red-900 mb-3">
                <Lock className="w-4 h-4 text-red-700" />
                <span>Peserta Terkunci Menunggu Persetujuan Pengawas ({lockedSessions.length})</span>
              </div>
              <div className="space-y-2.5">
                {lockedSessions.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-red-200 bg-white p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {s.full_name} <span className="font-mono text-xs text-slate-500">({s.username})</span> · {s.class_name}
                      </div>
                      <div className="text-xs text-red-700 mt-0.5">{s.locked_reason}</div>
                    </div>
                    {canUnlock ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={unlockingId === s.id}
                          onClick={() => handleUnlock(s.id, false)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Buka (+1 Toleransi)</span>
                        </button>
                        <button
                          type="button"
                          disabled={unlockingId === s.id}
                          onClick={() => handleUnlock(s.id, true)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Buka & Reset Pelanggaran</span>
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Hanya Pengawas/Admin dapat membuka kunci</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Participants Table + Violation Log */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="font-display font-bold text-sm text-slate-900">Daftar Peserta Sesi Ini</h2>
                <span className="text-xs text-slate-500 tabular-nums">{monitorData.sessions.length} Peserta</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Peserta</th>
                      <th className="text-left px-3 py-2.5 font-medium">Kelas</th>
                      <th className="text-left px-3 py-2.5 font-medium">Status</th>
                      <th className="text-right px-3 py-2.5 font-medium">Terjawab</th>
                      <th className="text-right px-3 py-2.5 font-medium">Pelanggaran</th>
                      <th className="text-right px-4 py-2.5 font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monitorData.sessions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                          Belum ada peserta yang memulai sesi ujian ini.
                        </td>
                      </tr>
                    ) : (
                      monitorData.sessions.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-900">{s.full_name}</div>
                            <div className="text-xs font-mono text-slate-500">{s.username}</div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{s.class_name || '-'}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {s.status === 'LOCKED' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-red-700">
                                <Lock className="w-3.5 h-3.5" /> Terkunci
                              </span>
                            ) : s.status === 'SUBMITTED' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <RefreshCw className="w-3.5 h-3.5" /> Aktif
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{s.answered_count}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                            <span className={s.violation_count > 0 ? 'text-red-700 font-semibold' : 'text-slate-600'}>
                              {s.violation_count}/{monitorData.exam.max_violations}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {s.status === 'LOCKED' && canUnlock ? (
                              <button
                                type="button"
                                onClick={() => handleUnlock(s.id, true)}
                                className="px-2.5 py-1 rounded bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium"
                              >
                                Buka Kunci
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live Violation Log */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <h2 className="font-display font-bold text-sm text-slate-900">Catatan Aktivitas Keamanan</h2>
              </div>
              <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
                {monitorData.recentViolations.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Belum ada catatan pelanggaran pada ujian ini.
                  </div>
                ) : (
                  monitorData.recentViolations.map((v) => (
                    <div key={v.id} className="px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{v.full_name}</span>
                        <span className="font-mono text-slate-400">{v.created_at?.slice(11, 19)}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-slate-600">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <span>{v.detail || v.violation_type}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
