import { useEffect, useState } from 'react';
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Repeat,
  ScanLine,
  Sun,
  Users as UsersIcon,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  Loader2
} from 'lucide-react';
import { api, getToken, setToken } from './api.js';
import { ToastHost } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Passports from './pages/Passports.jsx';
import Loans from './pages/Loans.jsx';
import Districts from './pages/Districts.jsx';
import Users from './pages/Users.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'paspor', label: 'Data Paspor', icon: FileText },
  { id: 'scan', label: 'Scan Paspor', icon: ScanLine },
  { id: 'pinjam', label: 'Peminjaman', icon: Repeat },
  { id: 'kecamatan', label: 'Kecamatan', icon: MapPin },
  { id: 'pengguna', label: 'Pengguna', icon: UsersIcon, admin: true },
];

function useTheme() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('theme', t);
  }, [t]);
  return [t, () => setT(x => (x === 'dark' ? 'light' : 'dark'))];
}

function useHash() {
  const get = () => location.hash.replace('#/', '') || 'dashboard';
  const [h, setH] = useState(get);
  useEffect(() => {
    const f = () => setH(get());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

function useWide(px = 960) {
  const q = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setWide(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return wide;
}

function ThemeBtn({ theme, toggle }) {
  return (
    <button
      className="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
      title={theme === 'dark' ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function Login({ onLogin, theme, toggle }) {
  const [f, setF] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api('/login', { method: 'POST', body: f });
      setToken(r.token);
      onLogin(r.user);
    } catch (x) {
      setErr(x.message || 'Gagal masuk. Periksa kembali username dan password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-theme-toggle">
        <ThemeBtn theme={theme} toggle={toggle} />
      </div>

      <div className="login-container">
        <div className="login-card">
          <div className="login-brand-header">
            <div className="login-logo-container">
              <img
                src="/assets/logo.png"
                alt="Logo Paspor"
                className="brand-img"
                onError={e => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'grid';
                }}
              />
              <div style={{ display: 'none', width: '100%', height: '100%', placeItems: 'center' }}>
                <BookOpen size={28} color="var(--primary)" />
              </div>
            </div>

            <span className="login-badge">Sistem Informasi Paspor</span>
            <h1 className="login-title">Manajemen Paspor</h1>
            <p className="login-desc">Masuk untuk mengelola data paspor, verifikasi visabio, dan catatan peminjaman.</p>
          </div>

          <form onSubmit={submit} className="stack">
            <div className="field">
              <label>Username</label>
              <div className="input-icon-group">
                <span className="input-icon-left"><UserIcon size={18} /></span>
                <input
                  value={f.username}
                  onChange={e => setF({ ...f, username: e.target.value })}
                  placeholder="Masukkan username"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="field">
              <label>Password</label>
              <div className="input-icon-group">
                <span className="input-icon-left"><Lock size={18} /></span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={f.password}
                  onChange={e => setF({ ...f, password: e.target.value })}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="input-icon-right"
                  onClick={() => setShowPassword(p => !p)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {err && (
              <div className="badge bad" style={{ width: '100%', justifyContent: 'center', padding: '10px 14px', borderRadius: '10px' }} role="alert">
                {err}
              </div>
            )}

            <button className="btn primary block" disabled={busy} style={{ marginTop: '8px', height: '46px', fontSize: '0.96rem' }}>
              {busy ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Memeriksa Akun…</span>
                </>
              ) : (
                <>
                  <span>Masuk ke Dashboard</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <div className="login-security-tag">
            <ShieldCheck size={14} color="var(--ok)" />
            <span>Koneksi aman & terenkripsi</span>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const [theme, toggle] = useTheme();
  const page = useHash();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (getToken()) {
      api('/me')
        .then(setUser)
        .catch(() => setToken(null))
        .finally(() => setReady(true));
    }
    const h = () => setUser(null);
    addEventListener('auth-expired', h);
    return () => removeEventListener('auth-expired', h);
  }, []);

  useEffect(() => setOpen(false), [page]);

  if (!ready) return null;
  if (!user) return <ToastHost><Login onLogin={setUser} theme={theme} toggle={toggle} /></ToastHost>;

  const items = NAV.filter(n => !n.admin || user.role === 'admin');
  const cur = items.find(n => n.id === page.split('/')[0]) || items[0];
  const pages = {
    dashboard: <Dashboard />,
    paspor: <Passports key="list" />,
    scan: <Passports key="scan" openNew />,
    pinjam: <Loans />,
    kecamatan: <Districts />,
    pengguna: <Users me={user} />
  };

  const initial = (user.full_name || user.username || 'U')[0].toUpperCase();

  return (
    <ToastHost>
      <div className="app">
        <aside className={'side' + (open ? ' open' : '')} aria-label="Menu utama">
          <div className="brand">
            <div className="brand-logo-wrap">
              <img
                src="/assets/logo.png"
                alt="Logo"
                className="brand-img"
                onError={e => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'grid';
                }}
              />
              <div style={{ display: 'none', width: '100%', height: '100%', placeItems: 'center' }}>
                <BookOpen size={20} color="var(--primary)" />
              </div>
            </div>
            <div className="brand-text">
              <span className="brand-title">Manajemen Paspor</span>
              <span className="brand-sub">Kemenag RI</span>
            </div>
          </div>

          <nav>
            {items.map(n => {
              const active = n.id === cur.id;
              return (
                <a
                  key={n.id}
                  href={'#/' + n.id}
                  className={active ? 'on' : ''}
                  aria-current={active ? 'page' : undefined}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                </a>
              );
            })}
          </nav>

          <div className="side-f">
            <div className="avatar-chip">{initial}</div>
            <div className="who">
              <b>{user.full_name || user.username}</b>
              <small className="muted">{user.role === 'admin' ? 'Administrator' : 'Staf Operasional'}</small>
            </div>
            {wide && <ThemeBtn theme={theme} toggle={toggle} />}
            <button
              className="icon danger"
              onClick={() => {
                setToken(null);
                setUser(null);
              }}
              aria-label="Keluar"
              title="Keluar dari akun"
            >
              <LogOut size={18} />
            </button>
          </div>
        </aside>

        {open && <div className="scrim" onClick={() => setOpen(false)} />}

        <div className="main">
          <header className="top">
            <button className="icon" onClick={() => setOpen(true)} aria-label="Buka menu">
              <Menu size={20} />
            </button>
            <div className="row" style={{ gap: '8px' }}>
              <span className="brand-logo-wrap" style={{ width: '28px', height: '28px', borderRadius: '8px' }}>
                <img src="/assets/logo.png" alt="Logo" className="brand-img" />
              </span>
              <b>{cur.label}</b>
            </div>
            <ThemeBtn theme={theme} toggle={toggle} />
          </header>
          <main className="content">{pages[cur.id]}</main>
        </div>
      </div>
    </ToastHost>
  );
}
