import { useEffect, useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
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

  return (
    <>
      <PageHead
        title="Daftar Kecamatan"
        sub="Master data kecamatan untuk pengelompokan wilayah jemaah pada data paspor."
      />

      <form className="card row" onSubmit={add}>
        <div className="search-wrap grow">
          <MapPin size={18} className="search-icon-left" />
          <input
            placeholder="Ketik nama kecamatan baru (misal: Kalianget, Kota Sumenep)…"
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
