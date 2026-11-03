import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PassportPicker from '../components/PassportPicker.jsx';
import { Badge, Empty, PageHead, useToast, waktu } from '../ui.jsx';

export default function Loans() {
  const notify = useToast(); const [loans, setLoans] = useState(null);
  const [picked, setPicked] = useState(null); const [f, setF] = useState({ borrower: '', note: '' });
  const load = () => api('/loans').then(setLoans).catch(e => notify(e.message, 'bad'));
  useEffect(() => { load(); }, []);

  const lend = async e => {
    e.preventDefault();
    if (!picked) return notify('Pilih paspor terlebih dahulu', 'bad');
    try {
      await api('/loans', { method: 'POST', body: { passport_id: picked.id, ...f } });
      setPicked(null); setF({ borrower: '', note: '' }); notify('Peminjaman dicatat'); load();
    } catch (x) { notify(x.message, 'bad'); }
  };
  const back = async l => { try { await api(`/loans/${l.id}/return`, { method: 'POST' }); notify('Paspor dikembalikan'); load(); } catch (x) { notify(x.message, 'bad'); } };

  return (
    <>
      <PageHead title="Peminjaman paspor" sub="Cari berdasarkan nama, nomor paspor, atau nomor porsi. Hanya paspor dengan status fisik “ada” yang bisa dipinjam." />
      <form className="card form" onSubmit={lend}>
        <div className="field wide"><label>Paspor</label><PassportPicker value={picked} onChange={setPicked} /></div>
        <label>Dipinjam oleh<input required value={f.borrower} onChange={e => setF({ ...f, borrower: e.target.value })} /></label>
        <label>Keperluan<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
        <div className="wide row end"><button className="btn primary">Catat peminjaman</button></div>
      </form>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Paspor</th><th>Peminjam</th><th>Keperluan</th><th>Dipinjam</th><th>Status</th><th /></tr></thead>
        <tbody>{(loans || []).map(l => (
          <tr key={l.id}><td data-label="Paspor"><b>{l.name}</b><small className="muted">{l.passport_number}</small></td><td data-label="Peminjam">{l.borrower}</td>
            <td data-label="Keperluan">{l.note || '–'}</td><td data-label="Dipinjam">{waktu(l.loaned_at)}</td>
            <td data-label="Status">{l.returned_at ? <span className="muted">Kembali {waktu(l.returned_at)}</span> : <Badge v="dipinjam" />}</td>
            <td className="act">{!l.returned_at && <button className="btn sm" onClick={() => back(l)}>Tandai kembali</button>}</td></tr>))}</tbody></table>
        {loans && !loans.length && <Empty>Belum ada peminjaman.</Empty>}</div>
    </>
  );
}