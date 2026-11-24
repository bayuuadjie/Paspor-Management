import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, X } from 'lucide-react';

export const VISABIO = ['sudah', 'belum', 'mengulang', 'under review', 'ditolak'];
export const PRINT = ['belum', 'sudah'];
export const FISIK = ['ada', 'dipinjam', 'diserahkan', 'hilang'];

export const upper = v => (typeof v === 'string' ? v.toUpperCase() : v);

// Penanda field wajib. Field opsional sengaja tidak memakai penanda apa pun.
export const Req = () => <span className="req" title="Wajib diisi" aria-label="wajib diisi"> *</span>;

const TONE = {
  sudah: 'ok',
  ada: 'ok',
  belum: 'warn',
  mengulang: 'warn',
  'under review': 'info',
  ditolak: 'bad',
  dipinjam: 'info',
  hilang: 'bad',
  diserahkan: 'neutral'
};

export const Badge = ({ v }) => (
  <span className={`badge ${TONE[v] || 'neutral'}`}>
    <span className="badge-dot" />
    <span>{v}</span>
  </span>
);

export const tgl = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export const waktu = d => (d ? new Date(d).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
export const daysLeft = d => (d ? Math.round((new Date(String(d).slice(0, 10) + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 864e5) : null);

export function ExpiryFlag({ d }) {
  const n = daysLeft(d);
  if (n === null || n > 30) return null;
  return <span className={'flag ' + (n < 0 ? 'bad' : 'warn')}>{n < 0 ? 'Kadaluarsa' : `${n} hari lagi`}</span>;
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [t, setT] = useState(null);
  const notify = useCallback((msg, type = 'ok') => setT({ msg, type, k: Date.now() }), []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), 3500);
    return () => clearTimeout(id);
  }, [t]);

  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {t && (
        <div key={t.k} className={`toast ${t.type}`} role="status">
          {t.type === 'ok' ? <CheckCircle2 size={18} /> : t.type === 'bad' ? <AlertCircle size={18} /> : <Info size={18} />}
          <span>{t.msg}</span>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button className="icon" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Seg = ({ value, options, onChange, label }) => (
  <div className="seg" role="radiogroup" aria-label={label}>
    {options.map(o => (
      <button
        type="button"
        key={o}
        role="radio"
        aria-checked={value === o}
        className={value === o ? 'on' : ''}
        onClick={() => onChange(o)}
      >
        {o}
      </button>
    ))}
  </div>
);

export const PageHead = ({ title, sub, children }) => (
  <div className="page-h">
    <div>
      <h2>{title}</h2>
      {sub && <p className="muted">{sub}</p>}
    </div>
    {children && <div className="page-a">{children}</div>}
  </div>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

// Navigasi halaman tabel: batasi jumlah baris yang tampil dan sediakan tombol sebelumnya/berikutnya.
export function Pagination({ page, total, pageSize = 50, onPage, label = 'data' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (!total || total <= pageSize) return null;
  const current = Math.min(Math.max(page, 1), pages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  return (
    <nav className="pagination" aria-label="Navigasi halaman tabel">
      <span className="pagination-info">
        Menampilkan <b>{from}–{to}</b> dari <b>{total}</b> {label}
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="btn sm"
          onClick={() => onPage(current - 1)}
          disabled={current <= 1}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={15} />
          <span>Sebelumnya</span>
        </button>
        <span className="pagination-page">
          Halaman <b>{current}</b> / {pages}
        </span>
        <button
          type="button"
          className="btn sm"
          onClick={() => onPage(current + 1)}
          disabled={current >= pages}
          aria-label="Halaman berikutnya"
        >
          <span>Berikutnya</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}
