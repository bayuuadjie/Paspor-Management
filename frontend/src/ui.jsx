import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';

export const VISABIO = ['belum', 'sudah', 'mengulang'];
export const PRINT = ['belum', 'sudah'];
export const FISIK = ['ada', 'tidak', 'dipinjam', 'hilang', 'diserahkan'];
const TONE = { sudah: 'ok', ada: 'ok', belum: 'warn', mengulang: 'warn', tidak: 'neutral', dipinjam: 'info', hilang: 'bad', diserahkan: 'neutral' };

export const Badge = ({ v }) => <span className={`badge ${TONE[v] || 'neutral'}`}>{v}</span>;
export const tgl = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const waktu = d => (d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
export const daysLeft = d => (d ? Math.round((new Date(String(d).slice(0, 10) + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 864e5) : null);

export function ExpiryFlag({ d }) {
  const n = daysLeft(d); if (n === null || n > 30) return null;
  return <span className={'flag ' + (n < 0 ? 'bad' : 'warn')}>{n < 0 ? 'Kadaluarsa' : `${n} hari lagi`}</span>;
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }) {
  const [t, setT] = useState(null);
  const notify = useCallback((msg, type = 'ok') => setT({ msg, type, k: Date.now() }), []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3500); return () => clearTimeout(id); }, [t]);
  return <ToastCtx.Provider value={notify}>{children}{t && <div key={t.k} className={`toast ${t.type}`} role="status">{t.msg}</div>}</ToastCtx.Provider>;
}

export function Modal({ title, onClose, children }) {
  useEffect(() => { const h = e => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button className="icon" onClick={onClose} aria-label="Tutup"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

export const Seg = ({ value, options, onChange, label }) => (
  <div className="seg" role="radiogroup" aria-label={label}>
    {options.map(o => <button type="button" key={o} role="radio" aria-checked={value === o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>)}
  </div>
);

export const PageHead = ({ title, sub, children }) => (
  <div className="page-h"><div><h2>{title}</h2>{sub && <p className="muted">{sub}</p>}</div><div className="page-a">{children}</div></div>
);
export const Empty = ({ children }) => <div className="empty">{children}</div>;
