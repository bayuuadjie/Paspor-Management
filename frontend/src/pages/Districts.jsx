import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Empty, PageHead, useToast } from '../ui.jsx';

export default function Districts() {
  const notify = useToast(); const [rows, setRows] = useState(null); const [name, setName] = useState('');
  const load = () => api('/districts').then(setRows).catch(e => notify(e.message, 'bad'));
  useEffect(() => { load(); }, []);
  const add = async e => { e.preventDefault(); try { await api('/districts', { method: 'POST', body: { name } }); setName(''); notify('Kecamatan ditambahkan'); load(); } catch (x) { notify(x.message, 'bad'); } };
  const del = async d => { try { await api(`/districts/${d.id}`, { method: 'DELETE' }); notify('Kecamatan dihapus'); load(); } catch (x) { notify(x.message, 'bad'); } };
  return (
    <>
      <PageHead title="Kecamatan" sub="Daftar ini dipakai sebagai pilihan pada form paspor." />
      <form className="card row" onSubmit={add}><input className="grow" placeholder="Nama kecamatan baru" value={name} onChange={e => setName(e.target.value)} required /><button className="btn primary">Tambah</button></form>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Kecamatan</th><th>Jumlah paspor</th><th /></tr></thead>
        <tbody>{(rows || []).map(d => <tr key={d.id}><td data-label="Kecamatan"><b>{d.name}</b></td><td data-label="Jumlah paspor">{d.total}</td>
          <td className="act"><button className="icon danger" onClick={() => del(d)} aria-label={`Hapus ${d.name}`}><Trash2 size={16} /></button></td></tr>)}</tbody></table>
        {rows && !rows.length && <Empty>Belum ada kecamatan. Tambahkan yang pertama di atas.</Empty>}</div>
    </>
  );
}
