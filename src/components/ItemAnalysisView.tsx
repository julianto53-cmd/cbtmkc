import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Download, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiDownload, apiFetch } from '../lib/api';

interface ItemAnalysisViewProps {
  exams: any[];
}

export function ItemAnalysisView({ exams }: ItemAnalysisViewProps) {
  const [selectedExamId, setSelectedExamId] = useState<number | null>(exams[0]?.id || null);
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!selectedExamId && exams.length > 0) {
      setSelectedExamId(exams[0].id);
    }
  }, [exams, selectedExamId]);

  useEffect(() => {
    if (!selectedExamId) return;
    setLoading(true);
    setErrorMsg('');
    apiFetch<{ report: any }>(`/api/teacher/exams/${selectedExamId}/analysis`)
      .then((d) => setReport(d.report))
      .catch((err) => setErrorMsg(err.message || 'Gagal menghitung analisis butir soal.'))
      .finally(() => setLoading(false));
  }, [selectedExamId]);

  const handleExportExcel = async () => {
    if (!selectedExamId) return;
    setExporting(true);
    try {
      await apiDownload(
        `/api/teacher/exams/${selectedExamId}/analysis/excel`,
        `Analisis_Butir_Soal_Ujian_${selectedExamId}.xlsx`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengekspor Excel.');
    } finally {
      setExporting(false);
    }
  };

  if (exams.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Buat jadwal ujian dan pastikan ada peserta yang mengumpulkan jawaban untuk melihat analisis butir soal.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-600 whitespace-nowrap">Pilih Ujian:</label>
          <select
            value={selectedExamId || ''}
            onChange={(e) => setSelectedExamId(Number(e.target.value))}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-900"
          >
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.title} ({ex.submitted_count ?? 0} Selesai)
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={!report || exporting}
          onClick={handleExportExcel}
          className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium inline-flex items-center gap-2 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>{exporting ? 'Menyiapkan Excel...' : 'Ekspor Analisis ke Excel (.xlsx)'}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">{errorMsg}</div>
      )}

      {loading ? (
        <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />
      ) : report ? (
        <>
          {/* Psychometric Summary Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Reliabilitas (Alpha)</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-800 tabular-nums">
                {report.reliabilityAlpha}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">{report.reliabilityCategory}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Peserta / Butir</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {report.participantCount} / {report.questionCount}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">r-Tabel: {report.rTableCritical}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Rata-Rata / SD</div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
                {report.meanScore} <span className="text-xs font-normal text-slate-500">± {report.stdDevScore}</span>
              </div>
              <div className="text-xs text-slate-600 mt-0.5 tabular-nums">
                Min {report.minScore} · Maks {report.maxScore}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Butir Diterima</div>
              <div className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {report.summaryCounts.accepted} Soal
              </div>
              <div className="text-xs text-slate-600 mt-0.5">Layak Bank Soal</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Revisi / Dibuang</div>
              <div className="mt-1 font-mono text-xl font-bold text-amber-700 tabular-nums">
                {report.summaryCounts.revise} / {report.summaryCounts.discard}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">Perlu Tindak Lanjut</div>
            </div>
          </div>

          {/* Item-by-Item Psychometric Table (Supports ALL 6 Types) */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display font-bold text-sm text-slate-900">
                Rincian Analisis Butir Soal (Semua Tipe)
              </h3>
              <span className="text-xs text-slate-500">Klik baris soal untuk melihat sebaran jawaban & pengecoh</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 text-center font-medium w-12">No</th>
                    <th className="px-3 py-2.5 text-left font-medium w-20">Tipe</th>
                    <th className="px-3 py-2.5 text-left font-medium">Cuplikan Soal</th>
                    <th className="px-3 py-2.5 text-right font-medium">Kesukaran (P)</th>
                    <th className="px-3 py-2.5 text-right font-medium">Daya Pembeda (D)</th>
                    <th className="px-3 py-2.5 text-right font-medium">Validitas (rxy)</th>
                    <th className="px-3 py-2.5 text-left font-medium">Rekomendasi</th>
                    <th className="px-3 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.items.map((item: any) => {
                    const isOpen = expandedItemId === item.questionId;
                    return (
                      <>
                        <tr
                          key={item.questionId}
                          onClick={() => setExpandedItemId(isOpen ? null : item.questionId)}
                          className="hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="px-3 py-3 text-center font-mono text-xs font-semibold tabular-nums">
                            {item.number}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-slate-700">{item.qType}</td>
                          <td className="px-3 py-3 text-xs text-slate-800 max-w-xs truncate">{item.promptSnippet}</td>
                          <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                            <span className="font-semibold text-slate-900">{item.difficultyP}</span>{' '}
                            <span className="text-slate-500">({item.difficultyCategory})</span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                            <span className="font-semibold text-slate-900">{item.discriminationD}</span>{' '}
                            <span className="text-slate-500">({item.discriminationCategory})</span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                            <span className={item.isValid ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                              {item.validityR}
                            </span>{' '}
                            <span className="text-slate-500">({item.isValid ? 'Valid' : 'Tdk Valid'})</span>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            {item.recommendation === 'DITERIMA' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Diterima
                              </span>
                            ) : item.recommendation === 'REVISI' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                                <AlertCircle className="w-3.5 h-3.5" /> Revisi
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                                <XCircle className="w-3.5 h-3.5" /> Dibuang
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-slate-400">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr key={`${item.questionId}-detail`} className="bg-slate-50/80">
                            <td colSpan={8} className="px-5 py-4">
                              <div className="text-xs text-slate-700 mb-3">
                                <span className="font-semibold">Catatan Rekomendasi:</span> {item.recommendationNote} ·{' '}
                                <span className="font-mono">Kosong: {item.blankCount} ({item.blankPercentage}%)</span>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {item.distribution.map((d: any) => (
                                  <div key={d.optionId} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                                    <div className="flex items-center justify-between gap-2 font-medium text-slate-900">
                                      <span>
                                        {d.optionId} {d.isCorrect ? '(Kunci)' : ''}
                                      </span>
                                      <span className="font-mono tabular-nums">
                                        {d.count} ({d.percentage}%)
                                      </span>
                                    </div>
                                    <div className="text-slate-500 truncate mt-0.5">{d.label}</div>
                                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                      <div
                                        className={`h-full ${d.isCorrect ? 'bg-emerald-600' : 'bg-slate-400'}`}
                                        style={{ width: `${Math.min(100, d.percentage)}%` }}
                                      />
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                                      <span className="font-mono tabular-nums">Atas: {d.upperCount} · Bawah: {d.lowerCount}</span>
                                      <span className={d.status === 'Efektif' || d.status === 'Kunci' ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                                        {d.status}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
