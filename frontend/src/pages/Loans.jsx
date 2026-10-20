import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, PageHead, useToast, waktu } from '../ui.jsx';

export default function Loans() {
  const notify = useToast(); const [loans, setLoans] = useState(null); const [avail, setAvail] = useState([]); const [f, setF] = useState({ passport_id: '', borrower: '', note: '' });
  const load = async () => { setLoans(await api('/loans')); setAvail(await api('/passports?passport_physical=ada')); };
  useEffect(() => { load().catch(e => notify(e.message, 'bad')); }, []);
  const lend = async e => {
    e.preventDefault();
    try { await api('/loans', { method: 'POST', body: f }); setF({ passport_id: '', borrower: '', note: '' }); notify('Peminjaman dicatat'); load(); } catch (x) { notify(x.message, 'bad'); }
  };
  const back = async l => { try { await api(`/loans/${l.id}/return`, { method: 'POST' }); notify('Paspor dikembalikan'); load(); } catch (x) { notify(x.message, 'bad'); } };
  return (
    <>
      <PageHead title="Peminjaman paspor" sub="Hanya paspor dengan status fisik “ada” yang bisa dipinjam." />
      <form className="card form" onSubmit={lend}>
        <label>Paspor<select required value={f.passport_id} onChange={e => setF({ ...f, passport_id: e.target.value })}>
          <option value="">Pilih paspor</option>{avail.map(p => <option key={p.id} value={p.id}>{p.name} · {p.passport_number}</option>)}</select></label>
        <label>Dipinjam oleh<input required value={f.borrower} onChange={e => setF({ ...f, borrower: e.target.value })} /></label>
        <label className="wide">Keperluan<input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
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
