import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Download, Pencil, Plus, Search, Trash2, Upload, ScanLine } from 'lucide-react';
import { api, download } from '../api.js';
import { Badge, Empty, ExpiryFlag, FISIK, Modal, PageHead, PRINT, Seg, tgl, useToast, VISABIO } from '../ui.jsx';

const empty = { name: '', passport_number: '', birth_date: '', kecamatan: '', visabio_status: 'belum', visabio_expiry: '', visabio_printed: 'belum', passport_physical: 'ada', phone: '', porsi_number: '', notes: '' };

function CameraModal({ onShot, onClose }) {
  const ref = useRef(); const [err, setErr] = useState('');
  useEffect(() => {
    let stream, off = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then(s => { if (off) return s.getTracks().forEach(t => t.stop()); stream = s; ref.current.srcObject = s; })
      .catch(() => setErr('Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau pakai tombol Unggah.'));
    return () => { off = true; stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  const shoot = () => {
    const v = ref.current; if (!v.videoWidth) return;
    const k = Math.min(1, 1800 / v.videoWidth), c = document.createElement('canvas');
    c.width = v.videoWidth * k; c.height = v.videoHeight * k; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => onShot(b), 'image/jpeg', 0.92);
  };
  return (
    <Modal title="Foto halaman data paspor" onClose={onClose}>
      {err ? <p className="err">{err}</p> : <>
        <div className="cam"><video ref={ref} autoPlay playsInline muted /><div className="cam-frame" /></div>
        <p className="muted">Posisikan halaman data dalam bingkai. Dua baris kode di bagian bawah halaman harus terlihat jelas dan tidak terpotong.</p>
        <button className="btn primary block" onClick={shoot}><Camera size={18} /> Ambil foto</button></>}
    </Modal>
  );
}

function PassportForm({ initial, districts, reloadDistricts, onSaved, onCancel }) {
  const notify = useToast();
  const [f, setF] = useState(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ''])));
  const [cam, setCam] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [newD, setNewD] = useState(null); const [low, setLow] = useState([]);  const [ocrLog, setOcrLog] = useState('');
  const upRef = useRef(), capRef = useRef(); const set = (k, v) => { setF(p => ({ ...p, [k]: v })); setLow(l => l.filter(x => x !== k)); };

  const ocr = async blob => {
    setCam(false); setBusy(true); setMsg({ t: 'info', m: 'Membaca paspor di perangkat…' });
    try {
      const fd = new FormData(); fd.append('file', blob, 'paspor.jpg');
      const r = await api('/ocr', { method: 'POST', body: fd });
      setOcrLog((r.log || []).join('\n'));
      setF(p => ({ ...p, name: r.name || p.name, passport_number: r.passport_number || p.passport_number, birth_date: r.birth_date || p.birth_date }));
            const label = { name: 'nama', passport_number: 'nomor paspor', birth_date: 'tanggal lahir' };
      const check = Object.keys(label).filter(k => !r.missing.includes(k) && ((r.confidence[k] ?? 0) < 75 || r.conflict.includes(k)));
      setLow([...r.missing, ...check]);
      setMsg(r.missing.length
        ? { t: 'warn', m: `Belum terbaca: ${r.missing.map(k => label[k]).join(', ')}. Isi manual atau foto ulang.${check.length ? ' Periksa juga: ' + check.map(k => label[k]).join(', ') + '.' : ''}` }
        : check.length ? { t: 'warn', m: `Terbaca, tetapi kurang yakin pada: ${check.map(k => label[k]).join(', ')}. Mohon periksa.` }
        : { t: 'ok', m: 'Terbaca dengan yakin. Tetap periksa sebelum menyimpan.' });
    } catch (e) { setMsg({ t: 'bad', m: e.message }); setOcrLog((e.data?.log || []).join('\n')); } finally { setBusy(false); }
  };
  const openCam = () => (navigator.mediaDevices?.getUserMedia ? setCam(true) : capRef.current.click());
  const pick = e => { const file = e.target.files[0]; e.target.value = ''; if (file) ocr(file); };
  const addD = async () => {
    try { const d = await api('/districts', { method: 'POST', body: { name: newD } }); await reloadDistricts(); set('kecamatan', d.name); setNewD(null); }
    catch (x) { notify(x.message, 'bad'); }
  };
  const save = async e => {
    e.preventDefault();
    try { await api(f.id ? `/passports/${f.id}` : '/passports', { method: f.id ? 'PUT' : 'POST', body: f }); notify('Data paspor disimpan'); onSaved(); }
    catch (x) { notify(x.message, 'bad'); }
  };
  const names = districts.map(d => d.name); if (f.kecamatan && !names.includes(f.kecamatan)) names.push(f.kecamatan);

  return (
    <form onSubmit={save}>
      <PageHead title={f.id ? 'Ubah data paspor' : 'Tambah paspor'} sub="Scan paspor untuk mengisi data otomatis, atau ketik manual." />
      <div className="card scan">
        <ScanLine size={28} />
        <div className="grow"><b>Scan paspor</b><p className="muted">Dibaca langsung di server lokal, gambar tidak dikirim ke internet dan tidak disimpan.</p></div>
        <div className="row">
          <button type="button" className="btn" onClick={openCam} disabled={busy}><Camera size={18} /> Kamera</button>
          <button type="button" className="btn" onClick={() => upRef.current.click()} disabled={busy}><Upload size={18} /> Unggah</button>
        </div>
        <input ref={upRef} type="file" accept="image/*" hidden onChange={pick} />
        <input ref={capRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </div>
      {msg && <p className={'note ' + msg.t} role="status">{msg.m}</p>}
      {ocrLog && <details className="ocr-log"><summary>Log OCR: apa yang terbaca</summary>
      <pre>{ocrLog}</pre><button type="button" className="btn sm" onClick={() => navigator.clipboard?.writeText(ocrLog).then(() => notify('Log disalin'))}>Salin log</button></details>}
      {cam && <CameraModal onShot={ocr} onClose={() => setCam(false)} />}

      <div className="card form">
        <label className={low.includes('name') ? 'low' : ''}>Nama<input required value={f.name} onChange={e => set('name', e.target.value)} /></label>
        <label className={low.includes('passport_number') ? 'low' : ''}>Nomor paspor<input required value={f.passport_number} onChange={e => set('passport_number', e.target.value.toUpperCase())} /></label>
        <label className={low.includes('birth_date') ? 'low' : ''}>Tanggal lahir<input type="date" value={f.birth_date} onChange={e => set('birth_date', e.target.value)} /></label>
        <div className="field"><label htmlFor="kec">Kecamatan</label>
          <select id="kec" value={newD !== null ? '__new' : f.kecamatan} onChange={e => (e.target.value === '__new' ? setNewD('') : (setNewD(null), set('kecamatan', e.target.value)))}>
            <option value="">Pilih kecamatan</option>{names.map(n => <option key={n}>{n}</option>)}<option value="__new">+ Tambah kecamatan baru…</option></select>
          {newD !== null && <div className="row"><input autoFocus placeholder="Nama kecamatan" value={newD} onChange={e => setNewD(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addD())} /><button type="button" className="btn" onClick={addD}>Simpan</button></div>}</div>
        <div className="field"><label>Status visabio</label><Seg label="Status visabio" value={f.visabio_status} options={VISABIO} onChange={v => set('visabio_status', v)} /></div>
        <label>Tanggal kadaluarsa visabio<input type="date" value={f.visabio_expiry} onChange={e => set('visabio_expiry', e.target.value)} /></label>
        <div className="field"><label>Sudah print visabio</label><Seg label="Print visabio" value={f.visabio_printed} options={PRINT} onChange={v => set('visabio_printed', v)} /></div>
        <div className="field wide"><label>Paspor fisik</label><Seg label="Paspor fisik" value={f.passport_physical} options={FISIK} onChange={v => set('passport_physical', v)} /></div>
        <label><span>Nomor HP <span className="opt">(opsional)</span></span><input type="tel" inputMode="tel" placeholder="08xxxxxxxxxx" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
        <label><span>Nomor porsi <span className="opt">(opsional)</span></span><input value={f.porsi_number} onChange={e => set('porsi_number', e.target.value)} /></label>
        <label className="wide"><span>Catatan <span className="opt">(opsional)</span></span><textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} /></label>
      </div>
      <div className="row end"><button type="button" className="btn" onClick={onCancel}>Batal</button><button className="btn primary">Simpan</button></div>
    </form>
  );
}

export default function Passports({ openNew }) {
  const notify = useToast(); const [rows, setRows] = useState(null); const [districts, setDistricts] = useState([]);
  const [f, setF] = useState({ q: '', kecamatan: '', visabio_status: '', passport_physical: '' }); const [form, setForm] = useState(openNew ? empty : null);
  const loadD = () => api('/districts').then(setDistricts);
  const load = useCallback(() => api('/passports?' + new URLSearchParams(f)).then(setRows).catch(e => notify(e.message, 'bad')), [f]);
  useEffect(() => { loadD().catch(() => {}); }, []);
  useEffect(() => { const id = setTimeout(load, 200); return () => clearTimeout(id); }, [load]);
  const exportData = async fmt => {
    try { await download(`/passports/export?${new URLSearchParams({ ...f, format: fmt })}`, `data-paspor-${new Date().toISOString().slice(0, 10)}.${fmt}`); notify('Data diekspor'); }
    catch (e) { notify(e.message, 'bad'); }
  };
  const del = async p => { if (confirm(`Hapus data paspor ${p.name}?`)) { await api(`/passports/${p.id}`, { method: 'DELETE' }); notify('Data dihapus'); load(); } };

  if (form) return <PassportForm initial={form} districts={districts} reloadDistricts={loadD}
    onCancel={() => (openNew ? (location.hash = '#/paspor') : setForm(null))}
    onSaved={() => { if (openNew) location.hash = '#/paspor'; else { setForm(null); load(); } }} />;
  const sel = (k, label, opts) => <select aria-label={label} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })}><option value="">{label}</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  return (
    <>
      <PageHead title="Data paspor" sub={rows ? `${rows.length} data` : ''}>
        <button className="btn" onClick={() => exportData('xlsx')} title="Ekspor sesuai filter yang aktif"><Download size={18} /> Excel</button>
        <button className="btn" onClick={() => exportData('csv')} title="Ekspor sesuai filter yang aktif">CSV</button>
        <button className="btn primary" onClick={() => setForm(empty)}><Plus size={18} /> Tambah paspor</button>
      </PageHead>
      <div className="filters">
        <div className="search"><Search size={18} /><input placeholder="Cari nama, nomor paspor, HP, atau porsi" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
        {sel('kecamatan', 'Semua kecamatan', districts.map(d => d.name))}{sel('visabio_status', 'Semua status visabio', VISABIO)}{sel('passport_physical', 'Semua paspor fisik', FISIK)}
      </div>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Jemaah</th><th>Tgl lahir</th><th>Kecamatan</th><th>Visabio</th><th>Kadaluarsa</th><th>Print</th><th>Paspor fisik</th><th /></tr></thead>
        <tbody>{(rows || []).map(p => (
          <tr key={p.id}>
            <td data-label="Jemaah" title={p.notes || undefined}><b>{p.name}</b><small className="muted">{p.passport_number}</small>
              {(p.phone || p.porsi_number) && <small className="muted">{[p.phone, p.porsi_number && `Porsi ${p.porsi_number}`].filter(Boolean).join(' · ')}</small>}</td>
            <td data-label="Tgl lahir">{tgl(p.birth_date)}</td><td data-label="Kecamatan">{p.kecamatan || '–'}</td>
            <td data-label="Visabio"><Badge v={p.visabio_status} /></td>
            <td data-label="Kadaluarsa">{tgl(p.visabio_expiry)} <ExpiryFlag d={p.visabio_expiry} /></td>
            <td data-label="Print"><Badge v={p.visabio_printed} /></td><td data-label="Paspor fisik"><Badge v={p.passport_physical} /></td>
            <td className="act"><button className="icon" onClick={() => setForm(p)} aria-label="Ubah"><Pencil size={16} /></button>
              <button className="icon danger" onClick={() => del(p)} aria-label="Hapus"><Trash2 size={16} /></button></td>
          </tr>))}</tbody></table>
        {rows && !rows.length && <Empty>Belum ada data yang cocok. Tambah paspor atau ubah filter.</Empty>}</div>
    </>
  );
}
