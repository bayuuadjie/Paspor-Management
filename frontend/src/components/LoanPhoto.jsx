import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { api, blobUrl } from '../api.js';
import { compress } from './PhotoInput.jsx';
import { Modal, useToast } from '../ui.jsx';

// Lihat / tambah / ganti / hapus foto pada satu peminjaman.
export default function LoanPhoto({ loan, onClose, onChanged }) {
  const notify = useToast();
  const [has, setHas] = useState(loan.has_photo); const [ver, setVer] = useState(0);
  const [url, setUrl] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const cam = useRef(), file = useRef();

  useEffect(() => {
    if (!has) { setUrl(null); return; }
    let off = false, u = null; setErr('');
    blobUrl(`/loans/${loan.id}/photo`).then(x => { if (off) URL.revokeObjectURL(x); else { u = x; setUrl(x); } }).catch(e => setErr(e.message));
    return () => { off = true; if (u) URL.revokeObjectURL(u); };
  }, [loan.id, has, ver]);

  const upload = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('photo', await compress(f), 'foto.jpg');
      await api(`/loans/${loan.id}/photo`, { method: 'PUT', body: fd });
      setHas(true); setVer(v => v + 1); onChanged(); notify('Foto disimpan');
    } catch (x) { notify(x.message, 'bad'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm('Hapus foto peminjaman ini?')) return;
    try { await api(`/loans/${loan.id}/photo`, { method: 'DELETE' }); setHas(false); onChanged(); notify('Foto dihapus'); }
    catch (x) { notify(x.message, 'bad'); }
  };

  return (
    <Modal title={`Foto peminjaman: ${loan.name}`} onClose={onClose}>
      {has ? (url ? <img className="photo-full" src={url} alt="Foto peminjaman" /> : <p className="muted">{err || 'Memuat foto…'}</p>)
           : <p className="muted">Belum ada foto untuk peminjaman ini.</p>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => cam.current.click()} disabled={busy}><Camera size={18} /> {has ? 'Ganti (kamera)' : 'Ambil foto'}</button>
        <button type="button" className="btn" onClick={() => file.current.click()} disabled={busy}><Upload size={18} /> {has ? 'Ganti (file)' : 'Pilih file'}</button>
        {has && <button type="button" className="btn" onClick={remove} disabled={busy}><Trash2 size={18} /> Hapus</button>}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={upload} />
      <input ref={file} type="file" accept="image/*" hidden onChange={upload} />
    </Modal>
  );
}