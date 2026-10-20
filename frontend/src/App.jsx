import { useEffect, useState } from 'react';
import { BookOpen, FileText, LayoutDashboard, LogOut, MapPin, Menu, Moon, Repeat, ScanLine, Sun, Users as UsersIcon } from 'lucide-react';
import { api, getToken, setToken } from './api.js';
import { ToastHost } from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Passports from './pages/Passports.jsx';
import Loans from './pages/Loans.jsx';
import Districts from './pages/Districts.jsx';
import Users from './pages/Users.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'paspor', label: 'Data paspor', icon: FileText },
  { id: 'scan', label: 'Scan paspor', icon: ScanLine },
  { id: 'pinjam', label: 'Peminjaman', icon: Repeat },
  { id: 'kecamatan', label: 'Kecamatan', icon: MapPin },
  { id: 'pengguna', label: 'Pengguna', icon: UsersIcon, admin: true },
];

function useTheme() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => { document.documentElement.dataset.theme = t; localStorage.setItem('theme', t); }, [t]);
  return [t, () => setT(x => (x === 'dark' ? 'light' : 'dark'))];
}
function useHash() {
  const get = () => location.hash.replace('#/', '') || 'dashboard';
  const [h, setH] = useState(get);
  useEffect(() => { const f = () => setH(get()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
}

function ThemeBtn({ theme, toggle }) {
  return <button className="icon" onClick={toggle} aria-label={theme === 'dark' ? 'Mode terang' : 'Mode gelap'} title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}>
    {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;
}

function Login({ onLogin, theme, toggle }) {
  const [f, setF] = useState({ username: '', password: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api('/login', { method: 'POST', body: f }); setToken(r.token); onLogin(r.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <div className="login-theme"><ThemeBtn theme={theme} toggle={toggle} /></div>
      <form className="card login-card" onSubmit={submit}>
        <div className="logo"><BookOpen size={26} /></div>
        <h1>Manajemen Paspor</h1><p className="muted">Masuk untuk mengelola data paspor jemaah.</p>
        <label>Username<input value={f.username} onChange={e => setF({ ...f, username: e.target.value })} autoComplete="username" autoFocus required /></label>
        <label>Password<input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="current-password" required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk'}</button>
      </form>
    </main>
  );
}

export default function App() {
  const [theme, toggle] = useTheme(); const page = useHash(); const [open, setOpen] = useState(false);
  const [user, setUser] = useState(null); const [ready, setReady] = useState(!getToken());
  useEffect(() => {
    if (getToken()) api('/me').then(setUser).catch(() => setToken(null)).finally(() => setReady(true));
    const h = () => setUser(null); addEventListener('auth-expired', h); return () => removeEventListener('auth-expired', h);
  }, []);
  useEffect(() => setOpen(false), [page]);
  if (!ready) return null;
  if (!user) return <ToastHost><Login onLogin={setUser} theme={theme} toggle={toggle} /></ToastHost>;

  const items = NAV.filter(n => !n.admin || user.role === 'admin');
  const cur = items.find(n => n.id === page.split('/')[0]) || items[0];
  const pages = { dashboard: <Dashboard />, paspor: <Passports key="list" />, scan: <Passports key="scan" openNew />, pinjam: <Loans />, kecamatan: <Districts />, pengguna: <Users me={user} /> };

  return (
    <ToastHost>
      <div className="app">
        <aside className={'side' + (open ? ' open' : '')} aria-label="Menu utama">
          <div className="brand"><span className="logo sm"><BookOpen size={18} /></span>Manajemen Paspor</div>
          <nav>{items.map(n => <a key={n.id} href={'#/' + n.id} className={n.id === cur.id ? 'on' : ''} aria-current={n.id === cur.id ? 'page' : undefined}><n.icon size={18} />{n.label}</a>)}</nav>
          <div className="side-f">
            <div className="who"><b>{user.full_name || user.username}</b><small>{user.role === 'admin' ? 'Admin' : 'Staf'}</small></div>
            <ThemeBtn theme={theme} toggle={toggle} />
            <button className="icon" onClick={() => { setToken(null); setUser(null); }} aria-label="Keluar" title="Keluar"><LogOut size={18} /></button>
          </div>
        </aside>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <div className="main">
          <header className="top"><button className="icon" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu size={20} /></button><b>{cur.label}</b><ThemeBtn theme={theme} toggle={toggle} /></header>
          <main className="content">{pages[cur.id]}</main>
        </div>
      </div>
    </ToastHost>
  );
}
