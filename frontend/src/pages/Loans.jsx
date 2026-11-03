import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PassportPicker from '../components/PassportPicker.jsx';
import { Badge, daysLeft, Empty, PageHead, tgl, useToast, waktu } from '../ui.jsx';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);   // tanggal lokal perangkat
const blank = () => ({ borrower: '', borrower_phone: '', borrower_address: '', note: '', loan_date: today(), due_date: '' });

function DueFlag({ loan }) {
  if (loan.returned_at || !loan.due_date) return null;
  const n = daysLeft(loan.due_date);
  if (n > 0) return null;
  return <span className={'flag ' + (n < 0 ? 'bad' : 'warn')}>{n < 0 ? `Terlambat ${-n} hari` : 'Jatuh tempo hari ini'}</span>;
}

export default function Loans() {
  const notify = useToast(); const [loans, setLoans] = useState(null);
  const [picked, setPicked] = useState(null); const [f, setF] = useState(blank);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const load = () => api('/loans').then(setLoans).catch(e => notify(e.message, 'bad'));
  useEffect(() => { load(); }, []);

  const lend = async e => {
    e.preventDefault();
    if (!picked) return notify('Pilih paspor terlebih dahulu', 'bad');
    try {
      await api('/loans', { method: 'POST', body: { passport_id: picked.id, ...f } });
      setPicked(null); setF(blank()); notify('Peminjaman dicatat'); load();
    } catch (x) { notify(x.message, 'bad'); }
  };
  const back = async l => { try { await api(`/loans/${l.id}/return`, { method: 'POST' }); notify('Paspor dikembalikan'); load(); } catch (x) { notify(x.message, 'bad'); } };

  return (
    <>
      <PageHead title="Peminjaman paspor" sub="Cari berdasarkan nama, nomor paspor, atau nomor porsi. Hanya paspor dengan status fisik “ada” yang bisa dipinjam." />
      <form className="card form" onSubmit={lend}>
        <div className="field wide"><label>Paspor</label><PassportPicker value={picked} onChange={setPicked} /></div>
        <label>Dipinjam oleh<input required value={f.borrower} onChange={e => set('borrower', e.target.value)} /></label>
        <label>No. telepon<input type="tel" inputMode="tel" placeholder="08xxxxxxxxxx" value={f.borrower_phone} onChange={e => set('borrower_phone', e.target.value)} /></label>
        <label className="wide">Alamat<textarea rows={2} value={f.borrower_address} onChange={e => set('borrower_address', e.target.value)} /></label>
        <label>Tanggal peminjaman<input type="date" required value={f.loan_date} onChange={e => set('loan_date', e.target.value)} /></label>
        <label>Tanggal rencana dikembalikan<input type="date" min={f.loan_date || undefined} value={f.due_date} onChange={e => set('due_date', e.target.value)} /></label>
        <label className="wide">Catatan<textarea rows={2} value={f.note} onChange={e => set('note', e.target.value)} /></label>
        <div className="wide row end"><button className="btn primary">Catat peminjaman</button></div>
      </form>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Paspor</th><th>Peminjam</th><th>Tgl pinjam</th><th>Rencana kembali</th><th>Catatan</th><th>Status</th><th /></tr></thead>
        <tbody>{(loans || []).map(l => (
          <tr key={l.id}>
            <td data-label="Paspor"><b>{l.name}</b><small className="muted">{l.passport_number}</small></td>
            <td data-label="Peminjam"><b>{l.borrower}</b>{l.borrower_phone && <small className="muted">{l.borrower_phone}</small>}{l.borrower_address && <small className="muted">{l.borrower_address}</small>}</td>
            <td data-label="Tgl pinjam">{tgl(l.loan_date)}</td>
            <td data-label="Rencana kembali">{tgl(l.due_date)} <DueFlag loan={l} /></td>
            <td data-label="Catatan">{l.note || '–'}</td>
            <td data-label="Status">{l.returned_at ? <span className="muted">Kembali {waktu(l.returned_at)}</span> : <Badge v="dipinjam" />}</td>
            <td className="act">{!l.returned_at && <button className="btn sm" onClick={() => back(l)}>Tandai kembali</button>}</td>
          </tr>))}</tbody></table>
        {loans && !loans.length && <Empty>Belum ada peminjaman.</Empty>}</div>
    </>
  );
}