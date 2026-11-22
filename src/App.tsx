import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { AdminPanel } from './components/AdminPanel';
import { LoginPage } from './components/LoginPage';
import { MkcLogoMark } from './components/MkcLogo';
import { ProctorPanel } from './components/ProctorPanel';
import { StudentPortal } from './components/StudentPortal';
import { TeacherPanel } from './components/TeacherPanel';
import { setAuthToken } from './lib/api';
import { AuthUser } from './types';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [inActiveExam, setInActiveExam] = useState(false);
  const [prefillTokenCode, setPrefillTokenCode] = useState('');

  const handleLogout = () => {
    // Student cannot log out during an active exam!
    if (inActiveExam) return;
    setAuthToken(null);
    setUser(null);
    setPrefillTokenCode('');
  };

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(u, optionalToken) => {
          setPrefillTokenCode(optionalToken ? optionalToken.trim().toUpperCase() : '');
          setUser(u);
        }}
      />
    );
  }

  // When a student is inside an active exam, hide the entire top navigation bar so there is NO exit / home / logout path!
  if (user.role === 'siswa' && inActiveExam) {
    return <StudentPortal user={user} prefillTokenCode={prefillTokenCode} onExamLockChange={setInActiveExam} />;
  }

  const roleLabel: Record<AuthUser['role'], string> = {
    admin: 'Administrator',
    guru: 'Guru Pengampu',
    pengawas: 'Pengawas Ruang',
    siswa: 'Peserta Ujian',
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col print:bg-white">
      {/* Clean 3-Zone Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8 sticky top-0 z-30 print:hidden">
        {/* Zone 1: Single Brand Lockup */}
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <MkcLogoMark size={30} />
          <span className="font-display font-bold text-base tracking-tight text-slate-900">MKC CBT</span>
        </div>

        {/* Zone 2: Clean Inline User Context */}
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 truncate">
          <span className="font-medium text-slate-900">{user.fullName}</span>
          <span aria-hidden="true">·</span>
          <span>{roleLabel[user.role]}</span>
          {user.className && (
            <>
              <span aria-hidden="true">·</span>
              <span>{user.className}</span>
            </>
          )}
        </div>

        {/* Zone 3: Single Logout Action */}
        <div className="shrink-0">
          <button
            type="button"
            onClick={handleLogout}
            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      {/* Role-Enforced Workspace */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 print:p-0 print:max-w-none print:m-0">
        {user.role === 'admin' && <AdminPanel user={user} />}
        {user.role === 'guru' && <TeacherPanel user={user} />}
        {user.role === 'pengawas' && <ProctorPanel user={user} />}
        {user.role === 'siswa' && (
          <StudentPortal user={user} prefillTokenCode={prefillTokenCode} onExamLockChange={setInActiveExam} />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-3.5 px-6 text-center text-xs text-slate-500 print:hidden">
        Hak Cipta &copy; Fikrul MKC
      </footer>
    </div>
  );
}
