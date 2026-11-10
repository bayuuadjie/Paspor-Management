import { useEffect, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  Plus,
  Repeat,
  Upload
} from 'lucide-react';
import { api, download } from '../api.js';
import PassportPicker from '../components/PassportPicker.jsx';
import PhotoInput from '../components/PhotoInput.jsx';
import LoanPhoto from '../components/LoanPhoto.jsx';
import { Badge, daysLeft, Empty, PageHead, tgl, useToast, waktu } from '../ui.jsx';

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const blank = () => ({
  borrower: '',
  borrower_phone: '',
  borrower_address: '',
  note: '',
  loan_date: today(),
  due_date: ''
});

function DueFlag({ loan }) {
  if (loan.returned_at || !loan.due_date) return null;
  const n = daysLeft(loan.due_date);
  if (n > 0) return null;
  return (
    <span className={'flag ' + (n < 0 ? 'bad' : 'warn')}>
      {n < 0 ? `Terlambat ${-n} hari` : 'Jatuh tempo hari ini'}
    </span>
  );
}

export default function Loans() {
  const notify = useToast();
  const [loans, setLoans] = useState(null);
  const [status, setStatus] = useState('');
  const [picked, setPicked] = useState(null);
  const [f, setF] = useState(blank);
  const [photo, setPhoto] = useState(null);
  const [view, setView] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const load = () =>
    api('/loans?' + new URLSearchParams({ status }))
      .then(setLoans)
      .catch(e => notify(e.message, 'bad'));

  useEffect(() => {
    load();
  }, [status]);

  const lend = async e => {
    e.preventDefault();
    if (!picked) return notify('Pilih paspor terlebih dahulu', 'bad');
    try {
      const created = await api('/loans', { method: 'POST', body: { passport_id: picked.id, ...f } });
      let photoFailed = false;
      if (photo) {
        try {
          const fd = new FormData();
          fd.append('photo', photo, 'foto.jpg');
          await api(`/loans/${created.id}/photo`, { method: 'PUT', body: fd });
        } catch {
          photoFailed = true;
        }
      }
      setPicked(null);
      setF(blank());
      setPhoto(null);
      setShowForm(false);
      load();
      notify(
        photoFailed
          ? 'Peminjaman dicatat, tetapi foto gagal diunggah. Tambahkan lewat tombol Foto di tabel.'
          : 'Peminjaman paspor berhasil dicatat',
        photoFailed ? 'bad' : 'ok'
      );
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const back = async l => {
    try {
      await api(`/loans/${l.id}/return`, { method: 'POST' });
      notify('Paspor telah ditandai kembali');
      load();
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const exportData = async fmt => {
    try {
      await download(
        `/loans/export?${new URLSearchParams({ status, format: fmt })}`,
        `data-peminjaman-${today()}.${fmt}`
      );
      notify(`Data peminjaman diekspor ke ${fmt.toUpperCase()}`);
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  return (
    <>
      <PageHead
        title="Peminjaman Paspor"
        sub="Pencatatan peminjaman fisik paspor jemaah dengan bukti foto dan batas pengembalian."
      >
        <button
          className="btn"
          onClick={() => exportData('xlsx')}
          title="Ekspor daftar peminjaman ke Excel"
        >
          <Download size={17} />
          <span>Excel</span>
        </button>
        <button
          className="btn"
          onClick={() => exportData('pdf')}
          title="Ekspor daftar peminjaman ke PDF"
        >
          <FileText size={17} />
          <span>PDF</span>
        </button>
        <button
          className="btn primary"
          onClick={() => setShowForm(v => !v)}
        >
          <Plus size={17} />
          <span>{showForm ? 'Tutup Formulir' : 'Catat Peminjaman'}</span>
        </button>
      </PageHead>

      {/* Formulir Peminjaman */}
      {showForm && (
        <form className="card form" onSubmit={lend} style={{ marginBottom: '24px' }}>
          <div className="wide" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Formulir Peminjaman Paspor Baru</h3>
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Hanya paspor dengan status fisik &quot;ada&quot; yang dapat dipilih.
            </p>
          </div>
          <div className="field wide">
            <label>Pilih Paspor Jemaah</label>
            <PassportPicker value={picked} onChange={setPicked} />
          </div>
          <label>
            Dipinjam oleh (Nama Lengkap)
            <input required value={f.borrower} onChange={e => set('borrower', e.target.value)} placeholder="Nama pihak peminjam" />
          </label>
          <label>
            Nomor Telepon
            <input
              type="tel"
              inputMode="tel"
              placeholder="08xxxxxxxxxx"
              value={f.borrower_phone}
              onChange={e => set('borrower_phone', e.target.value)}
            />
          </label>
          <label className="wide">
            Alamat Peminjam
            <textarea
              rows={2}
              value={f.borrower_address}
              onChange={e => set('borrower_address', e.target.value)}
              placeholder="Alamat lengkap peminjam..."
            />
          </label>
          <label>
            Tanggal Peminjaman
            <input type="date" required value={f.loan_date} onChange={e => set('loan_date', e.target.value)} />
          </label>
          <label>
            Rencana Tanggal Pengembalian
            <input
              type="date"
              min={f.loan_date || undefined}
              value={f.due_date}
              onChange={e => set('due_date', e.target.value)}
            />
          </label>
          <label className="wide">
            Catatan Keperluan
            <textarea
              rows={2}
              value={f.note}
              onChange={e => set('note', e.target.value)}
              placeholder="Contoh: Pengurusan visa khusus, perubahan data jemaah, dll."
            />
          </label>
          <div className="field wide">
            <label>
              <span>Foto Bukti Fisik / Identitas <span className="opt">(opsional, sebagai pengganti tanda tangan)</span></span>
            </label>
            <PhotoInput value={photo} onChange={setPhoto} />
          </div>
          <div className="wide row end">
            <button type="button" className="btn" onClick={() => setShowForm(false)}>
              Batal
            </button>
            <button className="btn primary">
              <CheckCircle2 size={17} />
              <span>Simpan Peminjaman</span>
            </button>
          </div>
        </form>
      )}

      {/* Filter Toolbar */}
      <div className="row" style={{ marginBottom: '16px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: '8px' }}>
          <span className="muted" style={{ fontSize: '0.86rem', fontWeight: 600 }}>Filter Status:</span>
          <select
            aria-label="Filter status peminjaman"
            style={{ width: 'auto', minWidth: '180px' }}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="">Semua Peminjaman</option>
            <option value="open">Sedang Dipinjam</option>
            <option value="returned">Sudah Dikembalikan</option>
          </select>
        </div>
      </div>

      {/* Tabel Riwayat Peminjaman */}
      <div className="card flush">
        <table className="tbl">
          <thead>
            <tr>
              <th>Paspor</th>
              <th>Peminjam</th>
              <th>Tgl Pinjam</th>
              <th>Rencana Kembali</th>
              <th>Catatan</th>
              <th>Foto Bukti</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(loans || []).map(l => (
              <tr key={l.id}>
                <td data-label="Paspor">
                  <b>{l.name}</b>
                  <small className="muted" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{l.passport_number}</small>
                </td>
                <td data-label="Peminjam">
                  <b>{l.borrower}</b>
                  {l.borrower_phone && <small className="muted">{l.borrower_phone}</small>}
                  {l.borrower_address && <small className="muted">{l.borrower_address}</small>}
                </td>
                <td data-label="Tgl pinjam">{tgl(l.loan_date)}</td>
                <td data-label="Rencana kembali">
                  <span>{tgl(l.due_date)}</span>
                  <DueFlag loan={l} />
                </td>
                <td data-label="Catatan">{l.note || '–'}</td>
                <td data-label="Foto">
                  <button className="btn sm" onClick={() => setView(l)}>
                    <Camera size={14} />
                    <span>{l.has_photo ? 'Lihat Foto' : '+ Tambah'}</span>
                  </button>
                </td>
                <td data-label="Status">
                  {l.returned_at ? (
                    <span className="badge ok">
                      <span className="badge-dot" />
                      <span>Kembali ({waktu(l.returned_at)})</span>
                    </span>
                  ) : (
                    <Badge v="dipinjam" />
                  )}
                </td>
                <td className="act">
                  {!l.returned_at && (
                    <button className="btn primary sm" onClick={() => back(l)}>
                      <span>Tandai Kembali</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loans && !loans.length && <Empty>Belum ada catatan peminjaman paspor.</Empty>}
      </div>

      {view && <LoanPhoto loan={view} onClose={() => setView(null)} onChanged={load} />}
    </>
  );
}
