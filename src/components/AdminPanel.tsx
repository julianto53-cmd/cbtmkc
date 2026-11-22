import {
  BookOpen,
  ImagePlus,
  KeyRound,
  Plus,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { AuthUser, LoginSlide } from '../types';
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
    image_url: '/src/assets/images/slider_campus_digital_1795305217271.jpg',
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
        image_url: '/src/assets/images/slider_campus_digital_1795305217271.jpg',
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

  return (
    <div className="space-y-6">
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
                      image_url: '/src/assets/images/slider_campus_digital_1795305217271.jpg',
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

      {/* TAB 2: PENGGUNA & GENERATE MASSAL */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-5">
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
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
              <h2 className="font-display font-bold text-sm text-slate-900">Daftar Pengguna ({users.length})</h2>
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
            <h2 className="font-display font-bold text-lg text-slate-900">Panduan Upload MKC CBT ke Hosting</h2>
            <p className="text-xs text-slate-600 mt-1">
              Aplikasi ini dirancang mandiri (standalone Node.js + SQLite WAL) tanpa ketergantungan layanan eksternal agar langsung siap diunggah ke VPS, Cloud Server, maupun cPanel Node.js Selector.
            </p>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900">1. Langkah Build untuk Hosting</div>
            <pre className="p-3.5 rounded-lg bg-slate-900 text-emerald-200 font-mono text-xs overflow-x-auto">
{`npm install
npm run build:all
npm run start:hosting`}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900">2. Berkas & Folder yang Diunggah ke Server Hosting</div>
            <ul className="list-disc pl-5 text-xs space-y-1">
              <li><span className="font-mono font-semibold">dist/</span> — aset frontend hasil build Vite</li>
              <li><span className="font-mono font-semibold">dist-server/server.mjs</span> — bundel backend Express siap produksi</li>
              <li><span className="font-mono font-semibold">package.json</span> &amp; <span className="font-mono font-semibold">node_modules/</span> (atau jalankan <span className="font-mono">npm install --omit=dev</span> di hosting)</li>
              <li>Folder <span className="font-mono font-semibold">data/</span> (berisi database <span className="font-mono">mkc_cbt.db</span>) dan <span className="font-mono font-semibold">uploads/</span> dibuat otomatis dan bersifat persisten.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900">3. Variabel Lingkungan (.env) di Hosting</div>
            <pre className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs overflow-x-auto text-slate-800">
{`NODE_ENV=production
PORT=3000
SESSION_SECRET=isi_string_acak_panjang_32_karakter
API_KEY_ENC_SECRET=isi_kunci_enkripsi_aes_256_anda
ADMIN_PASSCODE=opsional_passcode_admin_utama`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
