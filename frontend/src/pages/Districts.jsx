import { useEffect, useState } from 'react';
import { BookOpen, MapPin, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Empty, PageHead, Req, useToast } from '../ui.jsx';

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
        sub='Master data kecamatan untuk pengelompokan wilayah jemaah pada data paspor.' 
      >
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
        <label className="grow">
          <span>Nama Kecamatan <Req /></span>
          <div className="search-wrap">
            <MapPin size={18} className="search-icon-left" />
            <input
              placeholder="Ketik nama kecamatan baru"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
        </label>
        <button className="btn primary">
          <Plus size={17} />
          <span>Tambah Kecamatan</span>
        </button>
      </form>

      <div className="card flush">
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
        </table>
        {rows && !rows.length && (
          <Empty>Belum ada kecamatan. Tambahkan kecamatan pertama menggunakan formulir di atas.</Empty>
        )}
      </div>
    </>
  );
}
