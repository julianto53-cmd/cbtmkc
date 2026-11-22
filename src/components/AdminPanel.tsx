import {
  BookOpen,
  Download,
  FileSpreadsheet,
  ImagePlus,
  KeyRound,
  Plus,
  Printer,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiDownload, apiFetch } from '../lib/api';
import { AuthUser, LoginSlide } from '../types';
import { MkcLogoMark } from './MkcLogo';
import { ProctorPanel } from './ProctorPanel';
import { TeacherPanel } from './TeacherPanel';

interface AdminPanelProps {
  user: AuthUser;
}

type AdminTab = 'slides' | 'users' | 'settings' | 'teacher' | 'proctor' | 'hosting';

export function AdminPanel({ user }: AdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('slides');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Slides State
  const [slides, setSlides] = useState<LoginSlide[]>([]);
  const [slideForm, setSlideForm] = useState({
    id: 0,
    title: '',
    subtitle: '',
    badge_label: 'MKC CBT',
    image_url: '/assets/images/slider_campus_digital_1795305217271.jpg',
    sort_order: 1,
    is_active: true,
  });

  // Users State
  const [users, setUsers] = useState<any[]>([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [newUser, setNewUser] = useState({
    username: '',
    fullName: '',
    role: 'siswa',
    className: '',
    password: '',
  });
  const [bulkForm, setBulkForm] = useState({
    prefix: 'ujian26_',
    count: 50,
    className: 'XII IPA 1',
    password: '',
  });

  // Settings & Encrypted API Key State
  const [schoolName, setSchoolName] = useState('');
  const [examEventTitle, setExamEventTitle] = useState('Tes Akhir Semester');
  const [academicYear, setAcademicYear] = useState('Tahun Pelajaran 2026/2027');
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [apiProviderLabel, setApiProviderLabel] = useState('');
  const [encryptedApiStatus, setEncryptedApiStatus] = useState<{ configured: boolean; masked: string; updatedAt: string | null }>({
    configured: false,
    masked: '',
    updatedAt: null,
  });
  const [newApiKeyInput, setNewApiKeyInput] = useState('');

  // Excel Import State
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelDefaultPass, setExcelDefaultPass] = useState('');
  const [excelDuplicateMode, setExcelDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [excelImporting, setExcelImporting] = useState(false);
  const [excelSummary, setExcelSummary] = useState<{
    created: number;
    updated: number;
    skipped: number;
    totalRows: number;
    errors: string[];
  } | null>(null);

  // Participant Cards Print Modal State
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardClassFilter, setCardClassFilter] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [cardClasses, setCardClasses] = useState<string[]>([]);
  const [cardSchool, setCardSchool] = useState({
    schoolName: 'SMK Teknologi MKC',
    examEventTitle: 'Tes Akhir Semester',
    academicYear: 'Tahun Pelajaran 2026/2027',
    schoolLogoUrl: '',
  });
  const [cardNote, setCardNote] = useState('Bawa kartu ini saat ujian berlangsung dan jaga kerahasiaan PIN.');
  const [cardsList, setCardsList] = useState<
    Array<{ id: number; username: string; fullName: string; className: string; pin: string }>
  >([]);
  const [pinResetBusy, setPinResetBusy] = useState(false);

  const loadSlides = useCallback(async () => {
    const data = await apiFetch<{ slides: LoginSlide[] }>('/api/admin/slides');
    setSlides(data.slides || []);
  }, []);

  const loadUsers = useCallback(async () => {
    const q = roleFilter ? `?role=${encodeURIComponent(roleFilter)}` : '';
    const data = await apiFetch<{ users: any[] }>(`/api/admin/users${q}`);
    setUsers(data.users || []);
  }, [roleFilter]);

  const loadSettings = useCallback(async () => {
    const data = await apiFetch<any>('/api/admin/settings');
    setSchoolName(data.schoolName || '');
    setExamEventTitle(data.examEventTitle || 'Tes Akhir Semester');
    setAcademicYear(data.academicYear || 'Tahun Pelajaran 2026/2027');
    setSchoolLogoUrl(data.schoolLogoUrl || '');
    setApiProviderLabel(data.apiProviderLabel || '');
    setEncryptedApiStatus(data.encryptedApiKey || { configured: false, masked: '', updatedAt: null });
  }, []);

  useEffect(() => {
    if (tab === 'slides') {
      loadSlides();
      loadSettings();
    }
    if (tab === 'users') loadUsers();
    if (tab === 'settings') loadSettings();
  }, [tab, loadSlides, loadUsers, loadSettings]);

  const handleUploadSlideImg = async (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await apiFetch<{ imageUrl: string }>('/api/admin/slides/upload', {
      method: 'POST',
      body: fd,
    });
    setSlideForm((prev) => ({ ...prev, image_url: data.imageUrl }));
  };

  const handleUploadSchoolLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    const data = await apiFetch<{ imageUrl: string }>('/api/admin/slides/upload', {
      method: 'POST',
      body: fd,
    });
    setSchoolLogoUrl(data.imageUrl);
  };

  const handleSaveSlide = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (slideForm.id) {
        await apiFetch(`/api/admin/slides/${slideForm.id}`, {
          method: 'PUT',
          body: JSON.stringify(slideForm),
        });
        setStatusMsg('Slide login berhasil diperbarui.');
      } else {
        await apiFetch('/api/admin/slides', {
          method: 'POST',
          body: JSON.stringify(slideForm),
        });
        setStatusMsg('Slide login baru berhasil ditambahkan.');
      }
      setSlideForm({
        id: 0,
        title: '',
        subtitle: '',
        badge_label: 'MKC CBT',
        image_url: '/assets/images/slider_campus_digital_1795305217271.jpg',
        sort_order: slides.length + 1,
        is_active: true,
      });
      await loadSlides();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      setNewUser({ username: '', fullName: '', role: 'siswa', className: '', password: '' });
      setStatusMsg('Akun pengguna berhasil dibuat.');
      await loadUsers();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleBulkStudents = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const res = await apiFetch<{ created: number }>('/api/admin/users/bulk-students', {
        method: 'POST',
        body: JSON.stringify(bulkForm),
      });
      setStatusMsg(`${res.created} akun peserta ujian berhasil dibuat sekaligus.`);
      await loadUsers();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await apiFetch('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({
          schoolName,
          examEventTitle,
          academicYear,
          schoolLogoUrl,
          apiProviderLabel,
          newApiKey: newApiKeyInput,
        }),
      });
      setNewApiKeyInput('');
      setStatusMsg('Identitas sekolah, tampilan halaman depan, dan pengaturan berhasil disimpan.');
      await loadSettings();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDownloadExcelTemplate = async () => {
    setErrorMsg('');
    try {
      await apiDownload('/api/admin/users/excel-template', 'Template_Import_Akun_MKC_CBT.xlsx');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengunduh template Excel.');
    }
  };

  const handleImportExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelFile) {
      setErrorMsg('Pilih berkas Excel (.xlsx, .xls, atau .csv) terlebih dahulu.');
      return;
    }
    setErrorMsg('');
    setStatusMsg('');
    setExcelImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', excelFile);
      fd.append('defaultPassword', excelDefaultPass);
      fd.append('duplicateMode', excelDuplicateMode);

      const res = await apiFetch<{
        created: number;
        updated: number;
        skipped: number;
        totalRows: number;
        errors: string[];
      }>('/api/admin/users/import-excel', {
        method: 'POST',
        body: fd,
      });

      setExcelSummary(res);
      setExcelFile(null);
      setStatusMsg(
        `Import Excel selesai: ${res.created} akun dibuat, ${res.updated} diperbarui, ${res.skipped} dilewati.`
      );
      await loadUsers();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengimpor berkas Excel.');
    } finally {
      setExcelImporting(false);
    }
  };

  const loadParticipantCards = useCallback(async (cls = cardClassFilter, q = cardSearch) => {
    setCardLoading(true);
    try {
      const params = new URLSearchParams();
      if (cls) params.set('className', cls);
      if (q.trim()) params.set('search', q.trim());
      const res = await apiFetch<{
        school: { schoolName: string; examEventTitle: string; academicYear: string; schoolLogoUrl: string };
        classes: string[];
        cards: Array<{ id: number; username: string; fullName: string; className: string; pin: string }>;
      }>(`/api/admin/users/participant-cards?${params.toString()}`);
      setCardSchool(res.school);
      setCardClasses(res.classes || []);
      setCardsList(res.cards || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat kartu peserta.');
    } finally {
      setCardLoading(false);
    }
  }, [cardClassFilter, cardSearch]);

  const openCardsModal = () => {
    setCardModalOpen(true);
    loadParticipantCards(cardClassFilter, cardSearch);
  };

  const handleResetMissingPins = async () => {
    setPinResetBusy(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ updated: number }>('/api/admin/users/reset-student-pins', {
        method: 'POST',
        body: JSON.stringify({ onlyMissing: true, className: cardClassFilter }),
      });
      setStatusMsg(
        res.updated > 0
          ? `${res.updated} peserta dibuatkan PIN 6-digit baru untuk kartu ujian.`
          : 'Semua peserta sudah memiliki PIN tersimpan.'
      );
      await loadParticipantCards(cardClassFilter, cardSearch);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal membuat PIN peserta.');
    } finally {
      setPinResetBusy(false);
    }
  };

  const handleDownloadCardsHtml = () => {
    const esc = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const logoHtml = cardSchool.schoolLogoUrl
      ? `<img src="${esc(new URL(cardSchool.schoolLogoUrl, window.location.origin).href)}" alt="Logo" style="width:36px;height:36px;border-radius:6px;object-fit:contain;background:#fff;padding:2px;" />`
      : `<div style="width:36px;height:36px;border-radius:6px;background:#fff;color:#065f46;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:12px;">CBT</div>`;

    const cardsHtml = cardsList
      .map(
        (c) => `
      <div class="card">
        <div class="card-head">
          ${logoHtml}
          <div>
            <div class="school">${esc(cardSchool.schoolName)}</div>
            <div class="event">${esc(cardSchool.examEventTitle)} &middot; ${esc(cardSchool.academicYear)}</div>
          </div>
        </div>
        <div class="card-title">KARTU PESERTA UJIAN CBT</div>
        <table class="info">
          <tr><td class="lbl">No. Peserta / Username</td><td class="val mono">${esc(c.username)}</td></tr>
          <tr><td class="lbl">Nama Lengkap</td><td class="val bold">${esc(c.fullName)}</td></tr>
          <tr><td class="lbl">Kelas / Ruang</td><td class="val">${esc(c.className)}</td></tr>
          <tr><td class="lbl">PIN / Kata Sandi</td><td class="val"><span class="pin">${esc(c.pin || 'Belum diatur')}</span></td></tr>
        </table>
        <div class="card-foot">
          <div class="note">${esc(cardNote)}</div>
          <div class="sign">Panitia Ujian</div>
        </div>
      </div>`
      )
      .join('');

    const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Kartu Peserta Ujian - ${esc(cardSchool.schoolName)}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; margin: 0; padding: 12px; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; padding:10px 14px; background:#f1f5f9; border-radius:8px; }
  .toolbar button { background:#009944; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .card { border: 1.5px solid #1e293b; border-radius: 8px; overflow: hidden; break-inside: avoid; page-break-inside: avoid; background: #fff; }
  .card-head { background: #009944; color: #fff; padding: 8px 10px; display: flex; align-items: center; gap: 8px; }
  .school { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; }
  .event { font-size: 10px; opacity: .95; margin-top: 2px; }
  .card-title { background: #fef3c7; color: #78350f; text-align: center; font-size: 10px; font-weight: 800; padding: 3px 6px; border-bottom: 1px solid #cbd5e1; letter-spacing: .6px; }
  table.info { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.info td { padding: 4px 10px; border-bottom: 1px dashed #e2e8f0; vertical-align: middle; }
  td.lbl { width: 42%; color: #475569; font-size: 10px; }
  td.val { color: #0f172a; }
  .bold { font-weight: 700; }
  .mono { font-family: monospace; font-weight: 700; font-size: 12px; }
  .pin { display: inline-block; font-family: monospace; font-weight: 800; font-size: 12px; background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 1px 8px; border-radius: 4px; }
  .card-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; padding: 7px 10px; background: #f8fafc; font-size: 9px; color: #475569; }
  .note { flex: 1; line-height: 1.3; }
  .sign { width: 80px; text-align: center; border-top: 1px solid #94a3b8; padding-top: 2px; font-weight: 700; color: #334155; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="toolbar">
    <div><strong>Kartu Peserta (${cardsList.length} peserta)</strong> — ${esc(cardSchool.schoolName)}</div>
    <button onclick="window.print()">Cetak / Simpan PDF</button>
  </div>
  <div class="grid">${cardsHtml}</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kartu_Peserta_${(cardClassFilter || 'Semua_Kelas').replace(/[^a-zA-Z0-9_-]/g, '_')}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
    <div className={cardModalOpen ? 'space-y-6 print:hidden' : 'space-y-6'}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">Konsol Administrator MKC CBT</h1>
          <p className="text-sm text-slate-600 mt-1">
            Atur slider halaman login, akun pengguna, enkripsi API Key, pemantauan ujian, serta kesiapan hosting.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {[
            { id: 'slides', label: 'Slider Login', icon: SlidersHorizontal },
            { id: 'users', label: 'Pengguna', icon: Users },
            { id: 'settings', label: 'API Terenkripsi', icon: KeyRound },
            { id: 'teacher', label: 'Semua Bank Soal', icon: BookOpen },
            { id: 'proctor', label: 'Pengawasan', icon: ShieldCheck },
            { id: 'hosting', label: 'Upload Hosting', icon: Server },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id as AdminTab)}
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

      {/* TAB 1: SLIDER HALAMAN LOGIN */}
      {tab === 'slides' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveSettings} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h2 className="font-display font-bold text-base text-slate-900">
                  Identitas Sekolah & Header Halaman Login
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ubah nama sekolah, judul kegiatan ujian, tahun pelajaran, atau logo yang tampil di halaman depan.
                </p>
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                Simpan Nama & Header
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Sekolah / Institusi</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: SDN 09 SADANIANG"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Judul Kegiatan Ujian</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Tes Akhir Semester"
                  value={examEventTitle}
                  onChange={(e) => setExamEventTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tahun Pelajaran</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Tahun Pelajaran 2026/2027"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">Logo Sekolah di Header Depan (Opsional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Kosongkan untuk memakai logo bawaan MKC"
                    value={schoolLogoUrl}
                    onChange={(e) => setSchoolLogoUrl(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                  <label className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 shrink-0">
                    <ImagePlus className="w-4 h-4" />
                    <span>Unggah Logo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadSchoolLogo(f);
                      }}
                    />
                  </label>
                  {schoolLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setSchoolLogoUrl('')}
                      className="px-2.5 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs text-slate-600 shrink-0"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form onSubmit={handleSaveSlide} className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-display font-bold text-base text-slate-900">
              {slideForm.id ? 'Ubah Slide Login' : 'Tambah Slide Login Baru'}
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Label Keterangan Atas</label>
              <input
                type="text"
                required
                value={slideForm.badge_label}
                onChange={(e) => setSlideForm((p) => ({ ...p, badge_label: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Judul Slide</label>
              <input
                type="text"
                required
                placeholder="Judul utama pada slider login"
                value={slideForm.title}
                onChange={(e) => setSlideForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Deskripsi Slide</label>
              <textarea
                rows={3}
                required
                placeholder="Penjelasan singkat pada halaman masuk..."
                value={slideForm.subtitle}
                onChange={(e) => setSlideForm((p) => ({ ...p, subtitle: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-700">Gambar Latar Slide</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  value={slideForm.image_url}
                  onChange={(e) => setSlideForm((p) => ({ ...p, image_url: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono"
                />
                <label className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 shrink-0">
                  <ImagePlus className="w-4 h-4" />
                  <span>Unggah</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadSlideImg(f);
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-center">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Urutan Tampil</label>
                <input
                  type="number"
                  min={1}
                  value={slideForm.sort_order}
                  onChange={(e) => setSlideForm((p) => ({ ...p, sort_order: Number(e.target.value) || 1 }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 pt-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slideForm.is_active}
                  onChange={(e) => setSlideForm((p) => ({ ...p, is_active: e.target.checked }))}
                />
                <span>Tampilkan di Halaman Login</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              {slideForm.id !== 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSlideForm({
                      id: 0,
                      title: '',
                      subtitle: '',
                      badge_label: 'MKC CBT',
                      image_url: '/assets/images/slider_campus_digital_1795305217271.jpg',
                      sort_order: slides.length + 1,
                      is_active: true,
                    })
                  }
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium"
                >
                  Batal Edit
                </button>
              )}
              <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-medium">
                {slideForm.id ? 'Simpan Perubahan Slide' : 'Tambahkan Slide'}
              </button>
            </div>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {slides.map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row gap-4">
                <img
                  src={s.image_url}
                  alt={s.title}
                  referrerPolicy="no-referrer"
                  className="w-full sm:w-40 h-24 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>Urutan #{s.sort_order} · {s.badge_label}</span>
                    <span className={s.is_active ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                      {s.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-sm text-slate-900 mt-1">{s.title}</h3>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">{s.subtitle}</p>
                  <div className="mt-3 flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setSlideForm({
                          id: s.id,
                          title: s.title,
                          subtitle: s.subtitle,
                          badge_label: s.badge_label,
                          image_url: s.image_url,
                          sort_order: s.sort_order,
                          is_active: Boolean(s.is_active),
                        })
                      }
                      className="font-medium text-emerald-800 hover:underline"
                    >
                      Ubah Isi Slide
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/slides/${s.id}`, { method: 'DELETE' });
                        loadSlides();
                      }}
                      className="font-medium text-red-600 hover:underline"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          </div>
        </div>
      )}

      {/* TAB 2: PENGGUNA, IMPORT EXCEL & CETAK KARTU PESERTA */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-5">
            {/* Import Excel + Download Template */}
            <form onSubmit={handleImportExcel} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display font-bold text-sm text-slate-900 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    <span>Import Akun dari Excel</span>
                  </h2>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Buat akun siswa atau guru massal langsung dari file Excel (.xlsx / .xls / .csv).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadExcelTemplate}
                className="w-full py-2 px-3 rounded-lg border border-emerald-700 bg-white hover:bg-emerald-50 text-emerald-800 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh Template Excel (.xlsx)</span>
              </button>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Pilih Berkas Excel / CSV
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-700 file:mr-2.5 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-xs file:font-medium hover:file:bg-slate-50"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">
                  Password Bawaan (opsional, jika kolom Password di Excel kosong)
                </label>
                <input
                  type="text"
                  placeholder="Kosongkan untuk auto-PIN 6 digit"
                  value={excelDefaultPass}
                  onChange={(e) => setExcelDefaultPass(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-600 mb-1">Jika Username Sudah Terdaftar</label>
                <select
                  value={excelDuplicateMode}
                  onChange={(e) => setExcelDuplicateMode(e.target.value as 'skip' | 'update')}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="skip">Lewati akun yang sudah ada</option>
                  <option value="update">Perbarui nama, kelas &amp; password akun</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={excelImporting}
                className="w-full py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{excelImporting ? 'Mengimpor Akun...' : 'Import Akun Excel'}</span>
              </button>

              {excelSummary && (
                <div className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] space-y-1.5">
                  <div className="font-semibold text-slate-900">
                    Hasil Import ({excelSummary.totalRows} baris):
                  </div>
                  <div className="flex flex-wrap gap-2 text-slate-700">
                    <span className="text-emerald-700 font-semibold">+{excelSummary.created} dibuat</span>
                    <span>·</span>
                    <span className="text-amber-700 font-semibold">{excelSummary.updated} diperbarui</span>
                    <span>·</span>
                    <span className="text-slate-500">{excelSummary.skipped} dilewati</span>
                  </div>
                  {excelSummary.errors.length > 0 && (
                    <ul className="list-disc pl-4 text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                      {excelSummary.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </form>

            <form onSubmit={handleCreateUser} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="font-display font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-emerald-700" />
                <span>Tambah Akun Satuan</span>
              </h2>
              <input
                type="text"
                required
                placeholder="Username / NISN / NIP"
                value={newUser.username}
                onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
              <input
                type="text"
                required
                placeholder="Nama Lengkap"
                value={newUser.fullName}
                onChange={(e) => setNewUser((p) => ({ ...p, fullName: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="siswa">Siswa</option>
                  <option value="guru">Guru</option>
                  <option value="pengawas">Pengawas</option>
                  <option value="admin">Admin</option>
                </select>
                <input
                  type="text"
                  placeholder="Kelas / Mapel"
                  value={newUser.className}
                  onChange={(e) => setNewUser((p) => ({ ...p, className: e.target.value }))}
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs"
                />
              </div>
              <input
                type="password"
                required
                placeholder="Kata Sandi"
                value={newUser.password}
                onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
              />
              <button type="submit" className="w-full py-2 rounded-lg bg-emerald-800 text-white text-xs font-medium">
                Simpan Akun
              </button>
            </form>

            <form onSubmit={handleBulkStudents} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h2 className="font-display font-bold text-sm text-slate-900">Buat Akun Siswa Massal (Hingga 1.000)</h2>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Prefix Username</label>
                  <input
                    type="text"
                    required
                    value={bulkForm.prefix}
                    onChange={(e) => setBulkForm((p) => ({ ...p, prefix: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-600 mb-1">Jumlah Akun</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={bulkForm.count}
                    onChange={(e) => setBulkForm((p) => ({ ...p, count: Number(e.target.value) || 10 }))}
                    className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs font-mono"
                  />
                </div>
              </div>
              <input
                type="text"
                placeholder="Kelas"
                value={bulkForm.className}
                onChange={(e) => setBulkForm((p) => ({ ...p, className: e.target.value }))}
                className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs"
              />
              <input
                type="text"
                required
                placeholder="Kata Sandi Awal Peserta"
                value={bulkForm.password}
                onChange={(e) => setBulkForm((p) => ({ ...p, password: e.target.value }))}
                className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs"
              />
              <button type="submit" className="w-full py-2 rounded-lg border border-emerald-800 text-emerald-900 hover:bg-emerald-50 text-xs font-medium">
                Generate Akun Siswa Massal
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display font-bold text-sm text-slate-900">Daftar Pengguna ({users.length})</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openCardsModal}
                  className="px-3 py-1.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak Kartu Peserta</span>
                </button>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                >
                  <option value="">Semua Peran</option>
                  <option value="admin">Admin</option>
                  <option value="guru">Guru</option>
                  <option value="pengawas">Pengawas</option>
                  <option value="siswa">Siswa</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Username</th>
                    <th className="text-left px-3 py-2.5 font-medium">Nama Lengkap</th>
                    <th className="text-left px-3 py-2.5 font-medium">Peran</th>
                    <th className="text-left px-3 py-2.5 font-medium">Kelas / Keterangan</th>
                    <th className="text-right px-4 py-2.5 font-medium">Hapus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-900">{u.username}</td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-900">{u.full_name}</td>
                      <td className="px-3 py-2.5 text-xs uppercase font-mono text-slate-600">{u.role}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{u.class_name || '-'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {u.id !== user.id && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
                              loadUsers();
                            }}
                            className="p-1.5 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: PENGATURAN SISTEM & API KEY TERENKRIPSI */}
      {tab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div>
            <h2 className="font-display font-bold text-lg text-slate-900">Identitas Sekolah & Kunci API Terenkripsi</h2>
            <p className="text-xs text-slate-600 mt-1">
              Kunci API integrasi yang Anda simpan dienkripsi di server menggunakan algoritma <span className="font-mono font-semibold">AES-256-GCM</span> dan tidak pernah dikirim balik dalam bentuk teks biasa ke peramban.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Nama Sekolah / Institusi</label>
            <input
              type="text"
              required
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Judul Kegiatan Ujian (Header Depan)</label>
              <input
                type="text"
                required
                placeholder="Contoh: Tes Akhir Semester"
                value={examEventTitle}
                onChange={(e) => setExamEventTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Tahun Pelajaran</label>
              <input
                type="text"
                required
                placeholder="Contoh: Tahun Pelajaran 2026/2027"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Label Layanan API Integrasi</label>
            <input
              type="text"
              value={apiProviderLabel}
              onChange={(e) => setApiProviderLabel(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800">Status Penyimpanan Kunci API</span>
              <span className="font-mono text-emerald-700 font-semibold">
                {encryptedApiStatus.configured ? `Terenkripsi (${encryptedApiStatus.masked})` : 'Belum Tersimpan'}
              </span>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Masukkan / Perbarui API Key Baru (Opsional)
              </label>
              <input
                type="password"
                placeholder="Tempel kunci API untuk dienkripsi dengan AES-256-GCM..."
                value={newApiKeyInput}
                onChange={(e) => setNewApiKeyInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-mono"
              />
            </div>
          </div>

          <button type="submit" className="px-5 py-2.5 rounded-lg bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-medium">
            Simpan Pengaturan & Enkripsi Kunci
          </button>
        </form>
      )}

      {/* TAB 4: SEMUA BANK SOAL (ADMIN) */}
      {tab === 'teacher' && <TeacherPanel user={user} />}

      {/* TAB 5: PENGAWASAN */}
      {tab === 'proctor' && <ProctorPanel user={user} />}

      {/* TAB 6: PANDUAN UPLOAD HOSTING */}
      {tab === 'hosting' && (
        <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 space-y-5 text-sm text-slate-700 leading-relaxed">
          <div>
            <h2 className="font-display font-bold text-lg text-slate-900">Panduan Deploy MKC CBT (Vercel + Neon &amp; Hosting Mandiri)</h2>
            <p className="text-xs text-slate-600 mt-1">
              Aplikasi mendukung penuh deployment serverless di <strong>Vercel (vercel.com)</strong> dengan database <strong>Neon PostgreSQL (neon.tech)</strong>, maupun hosting mandiri (VPS/cPanel) dengan SQLite WAL Mode.
            </p>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5">
            <div className="font-semibold text-emerald-950">Opsi 1: Deploy ke Vercel + Neon PostgreSQL</div>
            <ol className="list-decimal pl-5 text-xs space-y-1.5 text-slate-700">
              <li>Buat database di <span className="font-mono font-semibold">neon.tech</span>, lalu salin connection string <strong>Pooled</strong> (<span className="font-mono">-pooler</span>).</li>
              <li>Import repositori ke <span className="font-mono font-semibold">vercel.com</span> (konfigurasi <span className="font-mono">vercel.json</span> dan <span className="font-mono">api/index.ts</span> sudah tersedia).</li>
              <li>Tambahkan Environment Variables di dashboard Vercel: <span className="font-mono font-semibold">DATABASE_URL</span>, <span className="font-mono font-semibold">SESSION_SECRET</span>, dan <span className="font-mono font-semibold">API_KEY_ENC_SECRET</span>.</li>
              <li>Semua tabel dan gambar upload (logo, soal, slider, import Word) otomatis tersimpan aman di PostgreSQL Neon.</li>
            </ol>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900">Opsi 2: Build untuk VPS / cPanel (SQLite WAL atau Neon)</div>
            <pre className="p-3.5 rounded-lg bg-slate-900 text-emerald-200 font-mono text-xs overflow-x-auto">
{`npm install
npm run build:all
npm run start:hosting`}
            </pre>
            <ul className="list-disc pl-5 text-xs space-y-1 text-slate-600">
              <li>Unggah <span className="font-mono font-semibold">dist/</span>, <span className="font-mono font-semibold">dist-server/server.mjs</span>, dan <span className="font-mono font-semibold">package.json</span>.</li>
              <li>Jika <span className="font-mono">DATABASE_URL</span> kosong, aplikasi otomatis memakai SQLite lokal (<span className="font-mono">data/mkc_cbt.db</span>) dan folder <span className="font-mono">uploads/</span>.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900">Contoh Variabel Lingkungan (Vercel / .env)</div>
            <pre className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs overflow-x-auto text-slate-800">
{`DATABASE_URL=postgresql://user:password@ep-xxxx-pooler.aws.neon.tech/neondb?sslmode=require
SESSION_SECRET=isi_string_acak_panjang_32_karakter
API_KEY_ENC_SECRET=isi_kunci_enkripsi_aes_256_anda
ADMIN_PASSCODE=opsional_passcode_admin_utama`}
            </pre>
          </div>
        </div>
      )}
    </div>

    {/* MODAL PRATINJAU & CETAK KARTU PESERTA */}
    {cardModalOpen && (
      <div className="fixed inset-0 z-50 bg-slate-950/60 p-4 overflow-y-auto print:static print:inset-auto print:bg-white print:p-0 print:overflow-visible">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden print:shadow-none print:rounded-none print:max-w-none">
          {/* Toolbar Modal (Disembunyikan saat mencetak) */}
          <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 space-y-4 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Printer className="w-5 h-5 text-emerald-700" />
                  <span>Cetak Kartu Peserta Ujian</span>
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Menampilkan {cardsList.length} kartu peserta aktif. Tata letak otomatis rapi 2 kolom per kertas A4.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {cardsList.some((c) => !c.pin) && (
                  <button
                    type="button"
                    disabled={pinResetBusy}
                    onClick={handleResetMissingPins}
                    className="px-3 py-2 rounded-lg border border-amber-400 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${pinResetBusy ? 'animate-spin' : ''}`} />
                    <span>Buatkan PIN Akun Lama</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDownloadCardsHtml}
                  disabled={cardsList.length === 0}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Siap Cetak (.html)</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={cardsList.length === 0}
                  className="px-4 py-2 rounded-lg bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak / Simpan PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCardModalOpen(false)}
                  aria-label="Tutup"
                  className="p-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Filter Kelas</label>
                <select
                  value={cardClassFilter}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCardClassFilter(val);
                    loadParticipantCards(val, cardSearch);
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="">Semua Kelas</option>
                  {cardClasses.map((cls) => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Cari Nama / Username</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="Ketik nama atau NIS..."
                    value={cardSearch}
                    onChange={(e) => setCardSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        loadParticipantCards(cardClassFilter, cardSearch);
                      }
                    }}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => loadParticipantCards(cardClassFilter, cardSearch)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium"
                  >
                    Cari
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Catatan Bawah Kartu</label>
                <input
                  type="text"
                  value={cardNote}
                  onChange={(e) => setCardNote(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
            </div>
          </div>

          {/* Lembar Kartu Peserta */}
          <div className="p-5 print:p-0 bg-slate-100/60 print:bg-white min-h-[260px]">
            {cardLoading ? (
              <div className="py-12 text-center text-sm text-slate-500">Memuat kartu peserta...</div>
            ) : cardsList.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Belum ada akun peserta (siswa) yang sesuai filter. Silakan import Excel atau tambah akun siswa terlebih dahulu.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3.5">
                {cardsList.map((c) => (
                  <div
                    key={c.id}
                    className="border-2 border-slate-800 rounded-lg overflow-hidden bg-white break-inside-avoid page-break-inside-avoid"
                  >
                    <div className="bg-[#009944] text-white px-3 py-2 flex items-center gap-2.5">
                      {cardSchool.schoolLogoUrl ? (
                        <img
                          src={cardSchool.schoolLogoUrl}
                          alt={cardSchool.schoolName}
                          className="w-8 h-8 rounded bg-white p-0.5 object-contain shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-white/15 flex items-center justify-center shrink-0">
                          <MkcLogoMark size={24} light />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-display font-bold text-xs uppercase tracking-wide truncate">
                          {cardSchool.schoolName}
                        </div>
                        <div className="text-[10px] text-emerald-50 truncate">
                          {cardSchool.examEventTitle} · {cardSchool.academicYear}
                        </div>
                      </div>
                    </div>

                    <div className="bg-amber-50 border-b border-slate-300 text-amber-950 text-center text-[10px] font-bold tracking-wider py-0.5 uppercase">
                      Kartu Peserta Ujian CBT
                    </div>

                    <div className="px-3 py-2 text-xs">
                      <table className="w-full border-collapse">
                        <tbody>
                          <tr className="border-b border-dashed border-slate-200">
                            <td className="py-1 text-[11px] text-slate-500 w-[42%]">Username / No. Peserta</td>
                            <td className="py-1 font-mono font-bold text-slate-900">{c.username}</td>
                          </tr>
                          <tr className="border-b border-dashed border-slate-200">
                            <td className="py-1 text-[11px] text-slate-500">Nama Lengkap</td>
                            <td className="py-1 font-semibold text-slate-900">{c.fullName}</td>
                          </tr>
                          <tr className="border-b border-dashed border-slate-200">
                            <td className="py-1 text-[11px] text-slate-500">Kelas / Ruang</td>
                            <td className="py-1 text-slate-800">{c.className}</td>
                          </tr>
                          <tr>
                            <td className="py-1.5 text-[11px] text-slate-500">PIN / Kata Sandi</td>
                            <td className="py-1.5">
                              <span
                                className={`inline-block font-mono font-bold px-2 py-0.5 rounded border text-xs ${
                                  c.pin
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                                    : 'bg-amber-50 border-amber-300 text-amber-800'
                                }`}
                              >
                                {c.pin || 'Belum tersimpan'}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="bg-slate-50 border-t border-slate-200 px-3 py-1.5 flex items-end justify-between gap-3 text-[9px] text-slate-500">
                      <span className="leading-tight flex-1">{cardNote}</span>
                      <span className="w-20 text-center border-t border-slate-400 pt-0.5 font-semibold text-slate-700 shrink-0">
                        Panitia Ujian
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
