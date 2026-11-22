import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  User,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, { useEffect, useState } from 'react';
import { apiFetch, setAuthToken } from '../lib/api';
import { AuthUser, LoginSlide } from '../types';
import { AnimatedPetalMotif, MkcLogoMark } from './MkcLogo';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser, optionalExamCode?: string) => void;
}

function formatClockDot(date: Date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}.${mm}.${ss}`;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [slides, setSlides] = useState<LoginSlide[]>([]);
  const [schoolName, setSchoolName] = useState('SMK Teknologi MKC');
  const [examEventTitle, setExamEventTitle] = useState('Tes Akhir Semester');
  const [academicYear, setAcademicYear] = useState('Tahun Pelajaran 2026/2027');
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [activeSlide, setActiveSlide] = useState(0);
  const [imgFailed, setImgFailed] = useState<Record<number, boolean>>({});
  const [clockText, setClockText] = useState(() => formatClockDot(new Date()));

  // Login Mode: Student ('siswa') vs Staff ('staff' for Guru/Pengawas/Admin)
  const [loginMode, setLoginMode] = useState<'siswa' | 'staff'>('siswa');

  // Login Form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [examTokenCode, setExamTokenCode] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // First-Run Setup Form
  const [setupSchool, setSetupSchool] = useState('SMK Teknologi MKC');
  const [setupFullName, setSetupFullName] = useState('Administrator MKC');
  const [setupPassword, setSetupPassword] = useState('');
  const [includeSim, setIncludeSim] = useState(true);
  const [demoUsersPass, setDemoUsersPass] = useState('mkc2026');

  useEffect(() => {
    const timer = setInterval(() => {
      setClockText(formatClockDot(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    apiFetch<{
      schoolName: string;
      examEventTitle?: string;
      academicYear?: string;
      schoolLogoUrl?: string;
      needsAdminSetup: boolean;
      slides: LoginSlide[];
    }>('/api/public/bootstrap')
      .then((data) => {
        setSchoolName(data.schoolName || 'SMK Teknologi MKC');
        setExamEventTitle(data.examEventTitle || 'Tes Akhir Semester');
        setAcademicYear(data.academicYear || 'Tahun Pelajaran 2026/2027');
        setSchoolLogoUrl(data.schoolLogoUrl || '');
        setLogoImgFailed(false);
        setSetupSchool(data.schoolName || 'SMK Teknologi MKC');
        setNeedsAdminSetup(data.needsAdminSetup);
        setSlides(data.slides || []);
      })
      .catch(() => {
        setErrorMsg('Gagal memuat konfigurasi awal server.');
      })
      .finally(() => setLoadingBootstrap(false));
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % slides.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [slides.length]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user, loginMode === 'siswa' ? examTokenCode : '');
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal masuk. Periksa kembali kredensial Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFirstRunSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);
    try {
      const data = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({
          schoolName: setupSchool,
          fullName: setupFullName,
          adminPassword: setupPassword,
          includeSimulationData: includeSim,
          demoUsersPassword: demoUsersPass,
        }),
      });
      setAuthToken(data.token);
      onLoginSuccess(data.user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyelesaikan aktivasi admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const currentSlide = slides[activeSlide];

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* 1. Top Full-Width Emerald Header Bar */}
      <header className="bg-[#009944] text-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-10 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0 overflow-hidden p-1">
              {schoolLogoUrl && !logoImgFailed ? (
                <img
                  src={schoolLogoUrl}
                  alt={schoolName}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoImgFailed(true)}
                  className="w-full h-full object-contain"
                />
              ) : (
                <MkcLogoMark size={30} />
              )}
            </div>
            <span className="font-display font-bold text-base sm:text-xl tracking-wide uppercase truncate">
              {schoolName}
            </span>
          </div>

          <div
            className="font-mono text-base sm:text-lg font-semibold tracking-wider tabular-nums shrink-0"
            aria-label="Waktu server saat ini"
          >
            {clockText}
          </div>
        </div>
      </header>

      {/* 2. Warm Cream Curved Sub-Header Ribbon */}
      <div className="relative bg-[#FBF3E8] border-b border-slate-200/80 overflow-hidden">
        {/* Subtle white curved arch across the ribbon matching reference */}
        <svg
          viewBox="0 0 1440 80"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full"
        >
          <path
            d="M220,0 Q720,92 1220,0 L1220,0 L220,0 Z"
            fill="#FFFFFF"
            fillOpacity="0.68"
          />
        </svg>
        <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-10 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <div className="font-display font-bold text-base sm:text-lg text-[#1D5ED8]">
            {examEventTitle}
          </div>
          <div className="text-sm font-medium text-slate-600">
            {academicYear}
          </div>
        </div>
      </div>

      {/* 3. Main Clean White 2-Column Split Canvas */}
      <main className="flex-1 flex items-center">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-10 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left Column: Clean Framed Animated Slider with MKC Petal Motif */}
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="relative rounded-2xl overflow-hidden bg-emerald-950 border border-slate-200 shadow-xl aspect-[16/10] flex flex-col justify-end">
              <AnimatePresence mode="wait">
                {currentSlide && (
                  <motion.div
                    key={currentSlide.id}
                    initial={{ opacity: 0, scale: 1.03 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0"
                  >
                    {!imgFailed[currentSlide.id] ? (
                      <img
                        src={currentSlide.image_url}
                        alt={currentSlide.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImgFailed((prev) => ({ ...prev, [currentSlide.id]: true }))}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-emerald-950 via-slate-900 to-emerald-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-emerald-950/20" />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Animated Petal Motif derived from MKC Crest */}
              <AnimatedPetalMotif />

              {/* Top-left subtle brand identifier on card */}
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-slate-950/55 backdrop-blur-sm border border-white/15 rounded-lg px-3 py-1.5 text-white max-w-[85%]">
                <MkcLogoMark size={20} light />
                <span className="font-display text-xs font-semibold tracking-wide truncate">{schoolName}</span>
              </div>

              {/* Slide Caption & Navigation Controls */}
              <div className="relative z-10 p-5 sm:p-6 text-white">
                <AnimatePresence mode="wait">
                  {currentSlide ? (
                    <motion.div
                      key={currentSlide.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div className="text-[11px] font-medium text-amber-300 mb-1">
                        {currentSlide.badge_label}
                      </div>
                      <h2 className="font-display text-lg sm:text-xl font-bold leading-snug text-white [text-wrap:balance]">
                        {currentSlide.title}
                      </h2>
                      <p className="mt-1.5 text-xs sm:text-sm text-slate-200 line-clamp-2 leading-relaxed">
                        {currentSlide.subtitle}
                      </p>
                    </motion.div>
                  ) : (
                    <div>
                      <h2 className="font-display text-xl font-bold text-white">MKC Computer-Based Test</h2>
                      <p className="mt-1 text-xs sm:text-sm text-slate-200">
                        Platform asesmen digital aman dengan layar penuh dan sinkronisasi otomatis.
                      </p>
                    </div>
                  )}
                </AnimatePresence>

                {slides.length > 1 && (
                  <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      {slides.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-label={`Pilih slide ${idx + 1}`}
                          onClick={() => setActiveSlide(idx)}
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            idx === activeSlide ? 'w-7 bg-amber-400' : 'w-3 bg-white/40 hover:bg-white/70'
                          }`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Slide sebelumnya"
                        onClick={() => setActiveSlide((prev) => (prev - 1 + slides.length) % slides.length)}
                        className="p-1.5 rounded-md border border-white/25 bg-slate-950/40 text-white hover:bg-white/15 transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Slide berikutnya"
                        onClick={() => setActiveSlide((prev) => (prev + 1) % slides.length)}
                        className="p-1.5 rounded-md border border-white/25 bg-slate-950/40 text-white hover:bg-white/15 transition-colors"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Login Form (Matching Screenshot) or First-Run Setup */}
          <div className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="w-full max-w-[460px]">
              {needsAdminSetup ? (
                <>
                  <div className="mb-6">
                    <h1 className="font-display text-2xl font-bold text-slate-900">Aktivasi Awal MKC CBT</h1>
                    <p className="mt-1 text-sm text-slate-500">
                      Buat akun operator utama untuk mengelola ujian, pengguna, slider, dan kunci API.
                    </p>
                  </div>

                  {errorMsg && (
                    <div role="alert" className="mb-4 p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
                      {errorMsg}
                    </div>
                  )}

                  <form onSubmit={handleFirstRunSetup} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Sekolah / Institusi</label>
                      <input
                        type="text"
                        required
                        value={setupSchool}
                        onChange={(e) => setSetupSchool(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nama Lengkap Admin</label>
                      <input
                        type="text"
                        required
                        value={setupFullName}
                        onChange={(e) => setSetupFullName(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">Kata Sandi Admin (min. 6 karakter)</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        placeholder="Buat kata sandi admin"
                        value={setupPassword}
                        onChange={(e) => setSetupPassword(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                      />
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includeSim}
                          onChange={(e) => setIncludeSim(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-[#009944] focus:ring-[#009944]"
                        />
                        <span className="text-xs text-slate-700 leading-relaxed">
                          Muat data simulasi awal (<span className="font-mono">guru_rpl</span>, <span className="font-mono">guru_mtk</span>, <span className="font-mono">pengawas1</span>, <span className="font-mono">siswa01–siswa15</span>)
                        </span>
                      </label>

                      {includeSim && (
                        <div className="mt-3">
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Kata Sandi Akun Simulasi</label>
                          <input
                            type="text"
                            required
                            minLength={4}
                            value={demoUsersPass}
                            onChange={(e) => setDemoUsersPass(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#009944]"
                          />
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 px-4 rounded-lg bg-[#009944] hover:bg-[#00823a] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 whitespace-nowrap"
                    >
                      <span>{submitting ? 'Mengaktifkan Sistem...' : 'Aktifkan MKC CBT & Masuk'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {/* Heading + Top-Right Role Switch Link */}
                  <div className="flex items-baseline justify-between gap-4">
                    <h1 className="font-display text-2xl sm:text-[26px] font-bold text-slate-900 tracking-tight">
                      {loginMode === 'siswa' ? 'Login Siswa' : 'Login Guru / Admin'}
                    </h1>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setLoginMode((prev) => (prev === 'siswa' ? 'staff' : 'siswa'));
                      }}
                      className="text-sm font-semibold text-[#1D5ED8] hover:text-blue-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      {loginMode === 'siswa' ? 'Login Guru / Admin' : 'Login Siswa'}
                    </button>
                  </div>

                  <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
                    {loginMode === 'siswa'
                      ? 'Ketik Username/NIS dan PIN peserta ujian sesuai kartu ujian Anda'
                      : 'Masuk menggunakan akun Guru Pengampu, Pengawas Ruang, atau Administrator'}
                  </p>

                  {errorMsg && (
                    <div role="alert" className="mt-4 p-3.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
                      {errorMsg}
                    </div>
                  )}

                  {loadingBootstrap ? (
                    <div className="mt-6 space-y-4 animate-pulse">
                      <div className="h-11 bg-slate-100 rounded-lg" />
                      <div className="h-11 bg-slate-100 rounded-lg" />
                      <div className="h-11 bg-slate-100 rounded-lg" />
                      <div className="h-12 bg-slate-200 rounded-lg" />
                    </div>
                  ) : (
                    <form onSubmit={handleLogin} className="mt-6 space-y-4">
                      <div>
                        <label htmlFor="mkc-username" className="block text-xs font-semibold text-slate-800 mb-1.5">
                          {loginMode === 'siswa' ? 'Username / NIS Peserta' : 'Username / NIP Staff'}
                        </label>
                        <div className="relative">
                          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            id="mkc-username"
                            type="text"
                            required
                            autoComplete="username"
                            placeholder={loginMode === 'siswa' ? 'Contoh: siswa01' : 'Contoh: guru_rpl, pengawas1, admin'}
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="mkc-password" className="block text-xs font-semibold text-slate-800 mb-1.5">
                          PIN / Kata Sandi
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            id="mkc-password"
                            type={showPass ? 'text' : 'password'}
                            required
                            autoComplete="current-password"
                            placeholder={loginMode === 'siswa' ? 'Ketik PIN peserta (contoh: 123456)' : 'Masukkan kata sandi akun'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                          />
                          <button
                            type="button"
                            aria-label={showPass ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                            onClick={() => setShowPass((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          >
                            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {loginMode === 'siswa' && (
                        <div>
                          <label htmlFor="mkc-exam-token" className="block text-xs font-semibold text-slate-800 mb-1.5">
                            Kode Ujian (Opsional)
                          </label>
                          <div className="relative">
                            <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input
                              id="mkc-exam-token"
                              type="text"
                              placeholder="Contoh: MKC2026 (bisa diisi setelah masuk)"
                              value={examTokenCode}
                              onChange={(e) => setExamTokenCode(e.target.value.toUpperCase())}
                              className="w-full pl-10 pr-3.5 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-mono uppercase text-slate-900 placeholder:font-sans placeholder:normal-case placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009944] focus:border-[#009944]"
                            />
                          </div>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-3 px-4 rounded-lg bg-[#009944] hover:bg-[#00823a] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>
                          {submitting
                            ? 'Memverifikasi...'
                            : loginMode === 'siswa'
                              ? 'Masuk ke Portal Ujian'
                              : 'Masuk ke Dasbor MKC'}
                        </span>
                      </button>

                      {/* Bottom Bordered Info Box */}
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-start gap-3 text-xs text-slate-600 leading-relaxed">
                        <ShieldCheck className="w-4 h-4 text-[#009944] shrink-0 mt-0.5" />
                        <span>
                          {loginMode === 'siswa'
                            ? 'Gunakan Username/NIS dan PIN dari kartu peserta ujian. Jawaban tersimpan otomatis secara real-time.'
                            : 'Halaman pengelolaan bank soal, pengawasan ruang layar penuh, dan pengaturan sistem terenkripsi MKC CBT.'}
                        </span>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-100 bg-white py-4 px-5 sm:px-10 text-center text-xs text-slate-500">
        Hak Cipta &copy; Fikrul MKC
      </footer>
    </div>
  );
}
