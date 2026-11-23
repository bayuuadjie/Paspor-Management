import { useEffect, useState } from 'react';
import { BookOpen, MapPin, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Empty, PageHead, useToast } from '../ui.jsx';

export default function Districts() {
  const notify = useToast();
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');

  const load = () =>
    api('/districts')
      .then(setRows)
      .catch(e => notify(e.message, 'bad'));

  useEffect(() => {
    load();
  }, []);

  const add = async e => {
    e.preventDefault();
    try {
      await api('/districts', { method: 'POST', body: { name: name.trim() } });
      setName('');
      notify('Kecamatan berhasil ditambahkan');
      load();
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const del = async d => {
    if (confirm(`Hapus data kecamatan "${d.name}"?`)) {
      try {
        await api(`/districts/${d.id}`, { method: 'DELETE' });
        notify('Kecamatan berhasil dihapus');
        load();
      } catch (x) {
        notify(x.message, 'bad');
      }
    }
  };

  const totalKecamatan = rows ? rows.length : 0;
  const totalPaspor = (rows || []).reduce((acc, d) => acc + (d.total || 0), 0);

  return (
    <>
      <PageHead
        title="Daftar Kecamatan"
        sub={
          rows
            ? `Total ${totalKecamatan} kecamatan terdaftar • Master data untuk pengelompokan wilayah jemaah.`
            : 'Master data kecamatan untuk pengelompokan wilayah jemaah pada data paspor.'
        }
      >
        {rows && (
          <div className="badge neutral" style={{ padding: '6px 14px', fontSize: '0.88rem', gap: '8px' }}>
            <MapPin size={15} color="var(--primary)" />
            <span>Total: <b>{totalKecamatan}</b> Kecamatan</span>
          </div>
        )}
      </PageHead>

      <div className="dash-stat-grid">
        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon blue">
              <MapPin size={22} />
            </div>
            <span className="stat-badge info">Wilayah</span>
          </div>
          <div>
            <div className="stat-num">{totalKecamatan}</div>
            <div className="stat-label">Total Kecamatan Terdaftar</div>
          </div>
        </div>

        <div className="dash-stat-card">
          <div className="stat-header">
            <div className="stat-icon green">
              <BookOpen size={22} />
            </div>
            <span className="stat-badge ok">Data Paspor</span>
          </div>
          <div>
            <div className="stat-num">{totalPaspor}</div>
            <div className="stat-label">Total Paspor di Seluruh Kecamatan</div>
          </div>
        </div>
      </div>

      <form className="card row" onSubmit={add}>
        <div className="search-wrap grow">
          <MapPin size={18} className="search-icon-left" />
          <input
            placeholder="Ketik nama kecamatan baru"
            value={name}
            onChange={e => setName(e.target.value)}
            required
          />
        </div>
        <button className="btn primary">
          <Plus size={17} />
          <span>Tambah Kecamatan</span>
        </button>
      </form>

      <div className="card flush">
        <div className="row" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
          <b style={{ fontSize: '0.92rem' }}>Daftar Kecamatan</b>
          <span className="badge neutral">
            <b>{totalKecamatan}</b> kecamatan
          </span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Nama Kecamatan</th>
              <th>Jumlah Paspor Terdaftar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(d => (
              <tr key={d.id}>
                <td data-label="Kecamatan">
                  <div className="row" style={{ gap: '8px' }}>
                    <MapPin size={16} color="var(--primary)" />
                    <b>{d.name}</b>
                  </div>
                </td>
                <td data-label="Jumlah paspor">
                  <span className="badge neutral">
                    <b>{d.total}</b> paspor
                  </span>
                </td>
                <td className="act">
                  <button
                    className="icon danger"
                    onClick={() => del(d)}
                    aria-label={`Hapus ${d.name}`}
                    title="Hapus kecamatan"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {rows && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--surface-2)', fontWeight: 600 }}>
                <td>Total: {totalKecamatan} Kecamatan</td>
                <td>
                  <span className="badge neutral">
                    <b>{totalPaspor}</b> paspor
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {rows && !rows.length && (
          <Empty>Belum ada kecamatan. Tambahkan kecamatan pertama menggunakan formulir di atas.</Empty>
        )}
      </div>
    </>
  );
}
