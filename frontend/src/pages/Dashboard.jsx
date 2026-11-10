import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  FileCheck,
  FileText,
  Printer,
  Repeat,
  ScanLine,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { api } from '../api.js';
import { Badge, Empty, PageHead, tgl, useToast, VISABIO, FISIK, PRINT } from '../ui.jsx';

const COLOR_MAP = {
  sudah: 'var(--ok)',
  ada: 'var(--ok)',
  belum: 'var(--warn)',
  mengulang: 'var(--warn)',
  'under review': 'var(--info)',
  dipinjam: 'var(--info)',
  ditolak: 'var(--bad)',
  hilang: 'var(--bad)',
  diserahkan: 'var(--muted)'
};

function DistributionCard({ title, icon: Icon, items, data, total }) {
  return (
    <div className="card">
      <div className="dash-card-header">
        <div className="row" style={{ gap: '10px' }}>
          <div className="stat-icon blue" style={{ width: '36px', height: '36px' }}>
            <Icon size={18} />
          </div>
          <h3 style={{ margin: 0 }}>{title}</h3>
        </div>
        <span className="badge neutral">{total} total</span>
      </div>

      <div className="stack" style={{ gap: '10px' }}>
        {items.map(k => {
          const n = data[k] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          const barColor = COLOR_MAP[k] || 'var(--primary)';
          return (
            <div key={k} className="bar-row">
              <span className="cap" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="badge-dot" style={{ background: barColor }} />
                <span>{k}</span>
              </span>
              <div className="bar">
                <i style={{ width: `${pct}%`, background: barColor }} />
              </div>
              <b>{n}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const notify = useToast();
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/stats')
      .then(setS)
      .catch(e => notify(e.message, 'bad'))
      .finally(() => setLoading(false));
  }, [notify]);

  const todayStr = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());

  if (loading) {
    return (
      <div className="empty" style={{ minHeight: '400px' }}>
        <p className="muted">Memuat data ringkasan dashboard…</p>
      </div>
    );
  }

  if (!s) return null;

  const sudahVisabio = s.visabio?.sudah || 0;
  const sudahPct = s.total ? Math.round((sudahVisabio / s.total) * 100) : 0;
  const fisikAda = s.fisik?.ada || 0;
  const fisikAdaPct = s.total ? Math.round((fisikAda / s.total) * 100) : 0;
  const fisikDipinjam = s.fisik?.dipinjam || 0;
  const needAttention = (s.visabio?.['under review'] || 0) + (s.visabio?.ditolak || 0) + (s.visabio?.mengulang || 0);

  return (
    <>
      <div className="dash-welcome">
        <div>
          <h2>Ringkasan Dokumen Paspor</h2>
          <p className="muted">Pantau data terkini proses visabio, cetak dokumen, dan peminjaman paspor.</p>
        </div>
        <div className="dash-date-badge">
          <Calendar size={16} color="var(--primary)" />
          <span>{todayStr}</span>
        </div>
      </div>

      {/* Quick Action Ribbon */}
      <div className="card row" style={{ justifyContent: 'space-between', padding: '14px 20px', flexWrap: 'wrap', gap: '12px' }}>
        <div className="row" style={{ gap: '8px' }}>
          <Sparkles size={18} color="var(--primary)" />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Aksi Cepat:</span>
        </div>
        <div className="page-a">
          <a href="#/scan" className="btn primary sm">
            <ScanLine size={16} />
            <span>Scan Paspor Baru</span>
          </a>
          <a href="#/pinjam" className="btn sm">
            <Repeat size={16} />
            <span>Catat Peminjaman</span>
          </a>
          <a href="#/paspor" className="btn sm">
            <FileText size={16} />
            <span>Semua Data Paspor</span>
          </a>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="dash-stat-grid">
        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon blue">
              <BookOpen size={22} />
            </div>
            <span className="stat-badge info">Total</span>
          </div>
          <div>
            <div className="stat-num">{s.total}</div>
            <div className="stat-label">Total Paspor Terdaftar</div>
          </div>
          <div className="stat-progress-bar">
            <div className="stat-progress-fill" style={{ width: '100%' }} />
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon green">
              <CheckCircle2 size={22} />
            </div>
            <span className="stat-badge ok">{sudahPct}%</span>
          </div>
          <div>
            <div className="stat-num">{sudahVisabio}</div>
            <div className="stat-label">Visabio Selesai (Sudah)</div>
          </div>
          <div className="stat-progress-bar">
            <div className="stat-progress-fill green" style={{ width: `${sudahPct}%` }} />
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon indigo">
              <ShieldCheck size={22} />
            </div>
            <span className="stat-badge ok">{fisikAdaPct}%</span>
          </div>
          <div>
            <div className="stat-num">{fisikAda}</div>
            <div className="stat-label">Paspor Fisik Tersedia</div>
          </div>
          <div className="stat-progress-bar">
            <div className="stat-progress-fill" style={{ width: `${fisikAdaPct}%` }} />
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon amber">
              <Clock size={22} />
            </div>
            {fisikDipinjam > 0 && <span className="stat-badge warn">Dipinjam</span>}
          </div>
          <div>
            <div className="stat-num">{fisikDipinjam}</div>
            <div className="stat-label">Sedang Dipinjam</div>
          </div>
          <div className="stat-progress-bar">
            <div
              className="stat-progress-fill"
              style={{
                width: s.total ? `${Math.min(100, Math.round((fisikDipinjam / s.total) * 100))}%` : '0%',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
              }}
            />
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon rose">
              <AlertTriangle size={22} />
            </div>
            {needAttention > 0 && <span className="stat-badge bad">Perlu Tindakan</span>}
          </div>
          <div>
            <div className="stat-num">{needAttention}</div>
            <div className="stat-label">Review / Tolak / Ulang</div>
          </div>
          <div className="stat-progress-bar">
            <div
              className="stat-progress-fill"
              style={{
                width: s.total ? `${Math.min(100, Math.round((needAttention / s.total) * 100))}%` : '0%',
                background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)'
              }}
            />
          </div>
        </div>
      </div>

      {/* Distribution Breakdown Cards */}
      <div className="dash-cols">
        <DistributionCard
          title="Status Rekam Visabio"
          icon={CheckCircle2}
          items={VISABIO}
          data={s.visabio}
          total={s.total}
        />
        <DistributionCard
          title="Kondisi Paspor Fisik"
          icon={ShieldCheck}
          items={FISIK}
          data={s.fisik}
          total={s.total}
        />
        <DistributionCard
          title="Proses Cetak Visabio"
          icon={Printer}
          items={PRINT}
          data={s.print}
          total={s.total}
        />
      </div>

      {/* Under Review Attention Section */}
      <div className="card">
        <div className="dash-card-header">
          <div className="row" style={{ gap: '10px' }}>
            <div className="stat-icon amber" style={{ width: '36px', height: '36px' }}>
              <Clock size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0 }}>Visabio Under Review</h3>
              <p className="muted" style={{ fontSize: '0.8rem' }}>Jemaah yang menunggu konfirmasi hasil verifikasi visa biometrik</p>
            </div>
          </div>
          <span className="badge warn">{s.review.length} Menunggu</span>
        </div>

        {s.review.length ? (
          <ul className="plain">
            {s.review.map(p => (
              <li key={p.id}>
                <div>
                  <b>{p.name}</b>
                  <small className="muted">Nomor Paspor: {p.passport_number}</small>
                </div>
                <div className="row" style={{ gap: '12px' }}>
                  <span className="badge info">Tgl Bio: {tgl(p.visabio_date)}</span>
                  <a
                    href={`#/paspor`}
                    className="btn sm"
                    title="Buka data paspor"
                    style={{ padding: '0 10px', height: '30px' }}
                  >
                    <span>Periksa</span>
                    <ArrowRight size={14} />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            <CheckCircle2 size={32} color="var(--ok)" style={{ marginBottom: '8px' }} />
            <div>Tidak ada visabio yang berstatus Under Review. Semua data telah terverifikasi!</div>
          </Empty>
        )}
      </div>
    </>
  );
}
