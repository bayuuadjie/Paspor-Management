import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  Download,
  FileText,
  FileUp,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { api, download } from '../api.js';
import { Badge, Empty, FISIK, Modal, PageHead, Pagination, PRINT, Req, Seg, tgl, upper, useToast, VISABIO } from '../ui.jsx';

// Jumlah baris per halaman agar tabel tetap ringkas dan mudah dibaca.
const PAGE_SIZE = 50;

// Field teks bebas yang otomatis disimpan dalam huruf kapital.
// Enum status, kecamatan, dan tanggal sengaja dikecualikan.
const UPPER_FIELDS = new Set(['name', 'bin_binti', 'passport_number', 'phone', 'porsi_number', 'notes']);
const upperField = (k, v) => (UPPER_FIELDS.has(k) ? upper(v) : v);

// Kolom yang boleh dipakai untuk pengurutan (harus sama dengan daftar di backend).
const SORTS = [
  { value: 'name', label: 'Nama' },
  { value: 'created_at', label: 'Tanggal Ditambahkan' }
];
const OCR_LABEL = { name: 'nama', passport_number: 'nomor paspor', birth_date: 'tanggal lahir' };
const OCR_MIN_CONFIDENCE = 75;
// Antrean OCR bisa penuh bila banyak perangkat scan bersamaan. Coba ulang dengan jeda membesar
// di dalam satu permintaan: status "membaca" tidak berubah-ubah saat retry berjalan.
const OCR_RETRY_DELAYS = [2000, 4000, 8000, 12000];
const abortedError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const ocrDelay = (ms, signal) => new Promise((resolve, reject) => {
  const onAbort = () => { clearTimeout(timer); reject(abortedError()); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  signal?.addEventListener('abort', onAbort, { once: true });
});
async function postOcr(path, blob, signal, onWait) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortedError();
    const fd = new FormData();
    fd.append('file', blob, path === '/ocr' ? 'paspor.jpg' : 'visabio.jpg');
    try {
      return await api(path, { method: 'POST', body: fd, signal });
    } catch (e) {
      // 503 dari antrean Python boleh dicoba lagi; 503 karena layanan OCR mati tidak ada gunanya diulang.
      const queueFull = e.status === 503 && e.data?.code !== 'OCR_UNAVAILABLE';
      const retryable = (queueFull || e.status === 409) && attempt < OCR_RETRY_DELAYS.length;
      if (!retryable || signal?.aborted) throw e;
      onWait?.(attempt + 1, OCR_RETRY_DELAYS.length);
      await ocrDelay(OCR_RETRY_DELAYS[attempt], signal);
    }
  }
}
const defaultSortDir = field => (field === 'name' ? 'asc' : 'desc');

const empty = {
  name: '',
  bin_binti: '',
  passport_number: '',
  birth_date: '',
  kecamatan: '',
  visabio_status: 'belum',
  visabio_date: '',
  visabio_printed: 'belum',
  passport_physical: 'ada',
  phone: '',
  porsi_number: '',
  notes: ''
};

function CameraModal({ onShot, onClose, title = 'Foto Halaman Data Paspor', hint = 'Posisikan seluruh halaman data paspor di dalam bingkai persegi panjang. Pegang ponsel mendatar bila bisa agar gambar tidak dipotong terlalu banyak. Dua baris kode MRZ di bawah harus jelas dan tidak terpotong. Ketuk layar untuk membantu fokus bila kamera mendukung.' }) {
  const ref = useRef();   // elemen video
  const frame = useRef(); // bingkai paspor: area yang benar-benar dikirim ke OCR
  const shot = useRef(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream, off = false;
    (async () => {
      let s;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
      } catch {
        // Constraint tidak didukung: pakai kamera bawaan agar tetap bisa memotret.
        try { s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
        catch { if (!off) setErr('Kamera tidak bisa dibuka. Izinkan akses kamera di browser, atau pakai tombol Unggah.'); return; }
      }
      if (off) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      if (ref.current) ref.current.srcObject = s;

      // Utamakan lensa utama (belakang): zoom digital dikembalikan ke 1x dan fokus otomatis terus menyala.
      const track = s.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() || {};
      const adv = [];
      if (caps.zoom && typeof caps.zoom === 'object' && 'min' in caps.zoom) adv.push({ zoom: caps.zoom.min });
      const focus = ['continuous', 'single-shot'].find(m => caps.focusMode?.includes(m));
      if (focus) adv.push({ focusMode: focus });
      for (const c of adv) {
        try { await track.applyConstraints({ advanced: [c] }); } catch { /* constraint tidak didukung perangkat ini */ }
      }
    })();
    return () => {
      off = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const focusAt = async e => {
    const t = ref.current?.srcObject?.getVideoTracks?.()[0];
    if (!t?.getCapabilities?.().pointsOfInterest) return;
    const r = ref.current.getBoundingClientRect();
    try {
      await t.applyConstraints({ advanced: [{ pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] }] });
    } catch { /* tap-to-focus tidak didukung perangkat ini */ }
  };

  const shoot = () => {
    const v = ref.current;
    if (shot.current || !v || !v.videoWidth) return;
    shot.current = true; // cegah klik ganda mengirim beberapa hasil OCR yang saling menimpa
    const vr = v.getBoundingClientRect(), fr = frame.current?.getBoundingClientRect();
    let sx = 0, sy = 0, sw = v.videoWidth, sh = v.videoHeight;
    // video memakai object-fit: cover -> petakan bingkai ke piksel asli kamera, bukan ke layar.
    const scale = fr?.width ? Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight) : 0;
    if (scale > 0) {
      const dx = (vr.width - v.videoWidth * scale) / 2, dy = (vr.height - v.videoHeight * scale) / 2;
      sx = Math.max(0, (fr.left - vr.left - dx) / scale);
      sy = Math.max(0, (fr.top - vr.top - dy) / scale);
      sw = Math.max(1, Math.min(v.videoWidth - sx, fr.width / scale));
      sh = Math.max(1, Math.min(v.videoHeight - sy, fr.height / scale));
    }
    const k = Math.min(1, 1800 / sw);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k));
    c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    c.toBlob(b => onShot(b), 'image/jpeg', 0.92);
  };

  return (
    <Modal title={title} onClose={onClose}>
      {err ? (
        <p className="err">{err}</p>
      ) : (
        <>
          <div className="cam">
            <video ref={ref} onClick={focusAt} autoPlay playsInline muted />
            <div className="cam-frame" ref={frame} />
          </div>
          <p className="muted" style={{ marginBottom: '14px', fontSize: '0.86rem' }}>
            {hint}
          </p>
          <button className="btn primary block" onClick={shoot}>
            <Camera size={18} />
            <span>Ambil Foto Paspor</span>
          </button>
        </>
      )}
    </Modal>
  );
}

function PassportForm({ initial, districts, reloadDistricts, onSaved, onCancel }) {
  const notify = useToast();
  const [f, setF] = useState(() =>
    Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, upperField(k, v ?? '')]))
  );
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newD, setNewD] = useState(null);
  const [low, setLow] = useState([]);
  const [ocrLog, setOcrLog] = useState('');
  const [ocrImg, setOcrImg] = useState('');
  const upRef = useRef(), capRef = useRef();
  // Nomor urut + AbortController: hasil scan lama/batal tidak boleh menimpa form.
  const ocrSeq = useRef(0), ocrAbort = useRef(null);

  const set = (k, v) => {
    setF(p => ({ ...p, [k]: upperField(k, v) }));
    setLow(l => l.filter(x => x !== k));
  };

  const ocr = async blob => {
    const id = ++ocrSeq.current;
    ocrAbort.current?.abort(); // foto ulang membatalkan scan sebelumnya yang masih berjalan
    const ctrl = new AbortController();
    ocrAbort.current = ctrl;
    setCam(false);
    setBusy(true);
    setLow([]);
    setOcrLog('');
    setOcrImg('');
    setMsg({ t: 'info', m: 'Membaca paspor…' });

    let r;
    try {
      r = await postOcr('/ocr', blob, ctrl.signal, (n, max) => {
        if (id === ocrSeq.current) {
          setMsg({ t: 'warn', m: `OCR sedang ramai, tetap mencoba… (${n}/${max})` });
        }
      });
    } catch (e) {
      if (id !== ocrSeq.current || e.name === 'AbortError') return; // balasan lama/dibatalkan: abaikan
      setMsg({ t: 'bad', m: e.message });
      setOcrLog((e.data?.log || []).join('\n'));
      setOcrImg(e.data?.mrz_preview || '');
      return; // scan gagal tidak boleh mengubah data yang sudah ada
    } finally {
      if (id === ocrSeq.current) {
        setBusy(false);
        ocrAbort.current = null;
      }
    }

    // Hanya hasil scan terbaru yang sukses yang boleh mengisi form.
    if (id !== ocrSeq.current) return;
    const missing = Array.isArray(r.missing) ? r.missing : [];
    const conflict = Array.isArray(r.conflict) ? r.conflict : [];
    const check = Object.keys(OCR_LABEL).filter(
      k => !missing.includes(k) && ((r.confidence?.[k] ?? 0) < OCR_MIN_CONFIDENCE || conflict.includes(k))
    );
    const patch = {};
    for (const k of Object.keys(OCR_LABEL)) {
      if (missing.includes(k) || !r[k] || (r.confidence?.[k] ?? 0) < OCR_MIN_CONFIDENCE) continue;
      patch[k] = k === 'birth_date' ? r[k] : upper(r[k]);
    }
    if (Object.keys(patch).length) setF(p => ({ ...p, ...patch }));
    setOcrLog((r.log || []).join('\n'));
    setOcrImg(r.mrz_preview || '');
    setLow([...new Set([...missing, ...check])]);
    const skipped = check.filter(k => !(k in patch));
    const review = check.length ? ` Periksa juga: ${check.map(k => OCR_LABEL[k]).join(', ')}.` : '';
    const unsure = skipped.length ? ' Bacaan kurang yakin tidak diisi otomatis.' : '';
    setMsg(
      missing.length
        ? { t: 'warn', m: `Belum terbaca: ${missing.map(k => OCR_LABEL[k]).join(', ')}. Isi manual atau foto ulang.${review}${unsure}` }
        : check.length
        ? { t: 'warn', m: `Terbaca, tetapi perlu diperiksa: ${check.map(k => OCR_LABEL[k]).join(', ')}.${unsure}` }
        : { t: 'ok', m: 'Terbaca dengan yakin. Tetap periksa sebelum menyimpan.' }
    );
  };

  const openCam = () => {
    if (busy || saving) return;
    navigator.mediaDevices?.getUserMedia ? setCam(true) : capRef.current.click();
  };
  const pick = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file && !busy && !saving) ocr(file);
  };

  const addD = async () => {
    try {
      const d = await api('/districts', { method: 'POST', body: { name: newD } });
      await reloadDistricts();
      set('kecamatan', d.name);
      setNewD(null);
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const save = async e => {
    e.preventDefault();
    if (busy || saving) return; // jangan simpan saat OCR masih berjalan / tombol sudah ditekan
    setSaving(true);
    try {
      await api(f.id ? `/passports/${f.id}` : '/passports', { method: f.id ? 'PUT' : 'POST', body: f });
      notify('Data paspor berhasil disimpan');
      onSaved();
    } catch (x) {
      notify(x.message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  const names = districts.map(d => d.name);
  if (f.kecamatan && !names.includes(f.kecamatan)) names.push(f.kecamatan);

  return (
    <form onSubmit={save}>
      <PageHead
        title={f.id ? 'Ubah Data Paspor' : 'Tambah Paspor Jemaah'}
        sub="Scan paspor untuk deteksi otomatis melalui MRZ, atau isi formulir secara manual."
      />

      <div className="card scan">
        <ScanLine size={32} />
        <div className="grow">
          <b>Scan Paspor Otomatis (OCR)</b>
          <p className="muted">Dibaca langsung di server lokal menggunakan MRZ OCR. Gambar tidak dikirim ke internet.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={openCam} disabled={busy || saving}>
            <Camera size={18} />
            <span>Kamera</span>
          </button>
          <button type="button" className="btn" onClick={() => upRef.current.click()} disabled={busy || saving}>
            <Upload size={18} />
            <span>Unggah Foto</span>
          </button>
        </div>
        <input ref={upRef} type="file" accept="image/*" hidden onChange={pick} />
        <input ref={capRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      </div>

      {msg && <p className={'note ' + msg.t} role="status">{msg.m}</p>}

      {ocrLog && (
        <details className="ocr-log">
          <summary>Log OCR: apa yang terbaca</summary>
          {ocrImg && (
            <>
              <p className="muted">Area MRZ yang dibaca OCR (harus berupa dua baris kode berhuruf kapital dan tanda &lt;):</p>
              <img src={ocrImg} alt="Area MRZ" style={{ maxWidth: '100%', borderRadius: 8, marginTop: '8px' }} />
            </>
          )}
          <pre>{ocrLog}</pre>
          <button
            type="button"
            className="btn sm"
            onClick={() => navigator.clipboard?.writeText(ocrLog).then(() => notify('Log disalin'))}
          >
            Salin log
          </button>
        </details>
      )}

      {cam && <CameraModal onShot={ocr} onClose={() => setCam(false)} />}

      <div className="card form">
        <label className={low.includes('name') ? 'low' : ''}>
          <span>Nama Lengkap <Req /></span>
          <input required value={f.name} onChange={e => set('name', e.target.value)} />
        </label>
        <label>
          <span>Bin / Binti</span>
          <input value={f.bin_binti} onChange={e => set('bin_binti', e.target.value)} />
        </label>
        <label className={low.includes('passport_number') ? 'low' : ''}>
          <span>Nomor Paspor <Req /></span>
          <input required value={f.passport_number} onChange={e => set('passport_number', e.target.value.toUpperCase())} />
        </label>
        <label className={low.includes('birth_date') ? 'low' : ''}>
          <span>Tanggal Lahir</span>
          <input type="date" value={f.birth_date} onChange={e => set('birth_date', e.target.value)} />
        </label>
        <div className="field">
          <label htmlFor="kec"><span>Kecamatan <Req /></span></label>
          <select
            id="kec"
            required
            value={newD !== null ? '__new' : f.kecamatan}
            onChange={e =>
              e.target.value === '__new' ? setNewD('') : (setNewD(null), set('kecamatan', e.target.value))
            }
          >
            <option value="">Pilih kecamatan</option>
            {names.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="__new">+ Tambah kecamatan baru…</option>
          </select>
          {newD !== null && (
            <div className="row" style={{ marginTop: '8px' }}>
              <input
                autoFocus
                required
                placeholder="Nama kecamatan baru"
                value={newD}
                onChange={e => setNewD(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addD())}
              />
              <button type="button" className="btn primary" onClick={addD}>Simpan</button>
            </div>
          )}
        </div>
        <div className="field">
          <label>Status Visabio</label>
          <Seg label="Status visabio" value={f.visabio_status} options={VISABIO} onChange={v => set('visabio_status', v)} />
        </div>
        <label>
          Tanggal Visabio
          <input type="date" value={f.visabio_date} onChange={e => set('visabio_date', e.target.value)} />
        </label>
        <div className="field">
          <label>Sudah Cetak Visabio</label>
          <Seg label="Print visabio" value={f.visabio_printed} options={PRINT} onChange={v => set('visabio_printed', v)} />
        </div>
        <div className="field wide">
          <label>Status Paspor Fisik</label>
          <Seg label="Paspor fisik" value={f.passport_physical} options={FISIK} onChange={v => set('passport_physical', v)} />
        </div>
        <label>
          <span>Nomor HP</span>
          <input type="tel" inputMode="tel" placeholder="08xxxxxxxxxx" value={f.phone} onChange={e => set('phone', e.target.value)} />
        </label>
        <label>
          <span>Nomor Porsi</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Nomor Porsi"
            value={f.porsi_number}
            onChange={e => set('porsi_number', e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <label className="wide">
          <span>Catatan</span>
          <textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="Catatan tambahan mengenai berkas jemaah..." />
        </label>
      </div>

      <div className="row end">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Batal</button>
        <button className="btn primary" disabled={busy || saving}>
          {saving ? 'Menyimpan…' : 'Simpan Data Paspor'}
        </button>
      </div>
    </form>
  );
}

function useVisabioYears() {
  const [years, setYears] = useState([]);
  useEffect(() => {
    const thisYear = new Date().getFullYear();
    const y = [];
    for (let yr = thisYear - 5; yr <= thisYear + 5; yr++) y.push(String(yr));
    setYears(y);
  }, []);
  return years;
}

function ImportHelp({ onPick, onClose, notify }) {
  const [downloading, setDownloading] = useState(false);
  const template = async () => {
    setDownloading(true);
    try {
      await download('/passports/import/template', 'template-import-paspor.xlsx');
    } catch (e) {
      notify(e.message, 'bad');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Modal title="Cara Import Excel" onClose={onClose}>
      <p className="muted" style={{ marginBottom: '12px', fontSize: '0.86rem' }}>
        Siapkan file <b>.xlsx/.xlsm</b> dengan nama kolom berikut. Header boleh ada judul di atasnya (dicari otomatis di 30 baris pertama).
      </p>
      <div className="import-cols">
        <div>
          <h4>Dipakai (wajib ada)</h4>
          <ul>
            <li><b>No Porsi</b></li>
            <li><b>Nama</b></li>
            <li><b>Kecamatan</b></li>
            <li><b>No. Paspor</b></li>
          </ul>
        </div>
        <div>
          <h4>Diabaikan</h4>
          <p>No, Alamat, Provinsi, Kab Kota, Usia, Kategori, Tahap</p>
        </div>
      </div>
      <ul className="import-rules">
        <li>Baris dengan Nama, Kecamatan, atau No. Paspor kosong dilewati.</li>
        <li>No. Paspor duplikat (di file atau di database) dilewati.</li>
        <li>Status visabio &amp; print visabio diisi <b>belum</b>, tanggal visabio dikosongkan.</li>
      </ul>
      <div className="row" style={{ marginTop: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <button className="btn" onClick={template} disabled={downloading}>
          <Download size={17} />
          <span>{downloading ? 'Mengunduh…' : 'Unduh Template'}</span>
        </button>
        <button className="btn primary" onClick={onPick}>
          <FileUp size={17} />
          <span>Pilih File Excel</span>
        </button>
      </div>
    </Modal>
  );
}

function ImportResult({ result, onClose }) {
  const issues = result.issues || [];
  return (
    <Modal title="Hasil Import Excel" onClose={onClose}>
      <p className="muted" style={{ marginBottom: '14px', fontSize: '0.86rem' }}>
        Hanya kolom No Porsi, Nama, Kecamatan, dan No. Paspor yang disimpan. Kolom lain diabaikan. Status visabio dan print visabio diisi <b>belum</b>, tanggal visabio dikosongkan.
      </p>
      <div className="import-summary">
        <div className="import-stat ok"><b>{result.imported}</b><span>Berhasil ditambah</span></div>
        <div className="import-stat warn"><b>{result.skippedEmpty}</b><span>Wajib kosong</span></div>
        <div className="import-stat bad"><b>{result.skippedDuplicate}</b><span>Duplikat</span></div>
      </div>
      {issues.length > 0 && (
        <div className="import-issues">
          <h4>Baris yang dilewati</h4>
          <ul>
            {issues.slice(0, 20).map((x, i) => (
              <li key={i}><b>Baris {x.row}:</b> {x.reason}</li>
            ))}
          </ul>
          {issues.length > 20 && <p className="muted">… dan {issues.length - 20} baris lainnya.</p>}
        </div>
      )}
      <button className="btn primary block" onClick={onClose}>Tutup</button>
    </Modal>
  );
}

export default function Passports({ openNew }) {
  const notify = useToast();
  const [rows, setRows] = useState(null);
  const [districts, setDistricts] = useState([]);
  const [f, setF] = useState({
    q: '',
    kecamatan: '',
    visabio_status: '',
    visabio_printed: '',
    passport_physical: '',
    visabio_year: '',
    sort: 'name',
    dir: 'asc'
  });
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(openNew ? empty : null);
  const [page, setPage] = useState(1);
  const [importResult, setImportResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const impRef = useRef();
  const scanRef = useRef();
  const scanAbort = useRef(null);
  const visabioYears = useVisabioYears();

  const loadD = () => api('/districts').then(setDistricts);
  // Balasan daftar yang lebih lama tidak boleh menimpa hasil filter/urutan terbaru.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const id = ++loadSeq.current;
    return api('/passports?' + new URLSearchParams(f))
      .then(rows => { if (id === loadSeq.current) setRows(rows); })
      .catch(e => { if (id === loadSeq.current) notify(e.message, 'bad'); });
  }, [f, notify]);

  useEffect(() => {
    loadD().catch(() => {});
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);

  // Setiap perubahan filter, pencarian, atau urutan kembali ke halaman pertama.
  useEffect(() => {
    setPage(1);
  }, [f.q, f.kecamatan, f.visabio_status, f.visabio_printed, f.passport_physical, f.visabio_year, f.sort, f.dir]);

  // Jaga nomor halaman tetap valid setelah data berubah (mis. setelah menghapus data).
  useEffect(() => {
    const pages = Math.max(1, Math.ceil((rows?.length || 0) / PAGE_SIZE));
    setPage(p => Math.min(p, pages));
  }, [rows]);

  const exportData = async fmt => {
    try {
      await download(
        `/passports/export?${new URLSearchParams({ ...f, format: fmt })}`,
        `data-paspor-${new Date().toISOString().slice(0, 10)}.${fmt}`
      );
      notify(`Data berhasil diekspor ke format ${fmt.toUpperCase()}`);
    } catch (e) {
      notify(e.message, 'bad');
    }
  };

  const importData = async e => {
    const file = e.target.files?.[0];
    e.target.value = ''; // agar file yang sama bisa dipilih lagi
    if (!file || importing) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api('/passports/import', { method: 'POST', body: fd });
      setImportResult(result);
      notify(`${result.imported} paspor berhasil diimport`);
      await Promise.all([load(), loadD()]);
    } catch (e) {
      notify(e.message, 'bad');
    } finally {
      setImporting(false);
    }
  };

  // OCR kertas visabio: nomor paspor di sebelah "Passport Number" dipakai sebagai kata kunci pencarian.
  const scanVisabio = async blob => {
    setScanOpen(false);
    scanAbort.current?.abort();
    const ctrl = new AbortController();
    scanAbort.current = ctrl;
    setScanning(true);
    setScanMsg(null);
    try {
      const r = await postOcr('/ocr/visabio', blob, ctrl.signal, (n, max) => {
        setScanMsg({ t: 'warn', m: `OCR sedang ramai, tetap mencoba… (${n}/${max})` });
      });
      setF(p => ({ ...p, q: r.passport_number }));
      setScanMsg({ t: 'ok', m: `Nomor paspor terbaca: ${r.passport_number}. Data yang cocok ditampilkan di bawah.` });
      notify(`Nomor paspor ${r.passport_number} dipakai untuk pencarian`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      const text = e.data?.text ? ` Teks terbaca: ${e.data.text.slice(0, 160)}` : '';
      setScanMsg({ t: 'bad', m: e.message + text });
      notify(e.message, 'bad');
    } finally {
      if (scanAbort.current === ctrl) scanAbort.current = null;
      setScanning(false);
    }
  };

  const pickVisabio = e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && !scanning) scanVisabio(file);
  };

  const del = async p => {
    if (confirm(`Hapus data paspor ${p.name}? Tindakan ini tidak dapat dibatalkan.`)) {
      await api(`/passports/${p.id}`, { method: 'DELETE' });
      notify('Data paspor dihapus');
      load();
    }
  };

  const clearAllFilters = () => {
    setF({
      ...f,
      kecamatan: '',
      visabio_status: '',
      visabio_printed: '',
      passport_physical: '',
      visabio_year: ''
    });
  };

  // Klik kolom yang sama mengubah arah urutan; pindah kolom memakai arah bawaan (nama A-Z, tanggal terbaru).
  const toggleSort = field =>
    setF(p => (p.sort === field ? { ...p, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { ...p, sort: field, dir: defaultSortDir(field) }));
  const SortIcon = f.dir === 'asc' ? ArrowUp : ArrowDown;

  // Count active filter criteria (excluding search query)
  const activeFilters = [
    f.kecamatan ? { key: 'kecamatan', label: 'Kecamatan', val: f.kecamatan } : null,
    f.visabio_status ? { key: 'visabio_status', label: 'Visabio', val: f.visabio_status } : null,
    f.visabio_printed ? { key: 'visabio_printed', label: 'Print', val: f.visabio_printed === 'belum' ? 'Belum print' : 'Sudah print' } : null,
    f.passport_physical ? { key: 'passport_physical', label: 'Fisik', val: f.passport_physical } : null,
    f.visabio_year ? { key: 'visabio_year', label: 'Tahun', val: f.visabio_year } : null
  ].filter(Boolean);

  // Potong data sesuai halaman aktif; nomor halaman dijaga agar tidak melewati jumlah halaman.
  const total = rows?.length || 0;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const pageRows = (rows || []).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (form) {
    return (
      <PassportForm
        initial={form}
        districts={districts}
        reloadDistricts={loadD}
        onCancel={() => (openNew ? (location.hash = '#/paspor') : setForm(null))}
        onSaved={() => {
          if (openNew) location.hash = '#/paspor';
          else {
            setForm(null);
            load();
          }
        }}
      />
    );
  }

  return (
    <>
      <PageHead title="Data Paspor Jemaah" sub={rows ? `${rows.length} paspor ditemukan` : 'Memuat data…'}>
        <button className="btn" onClick={() => exportData('xlsx')} title="Ekspor data ke file Excel">
          <Download size={17} />
          <span>Excel</span>
        </button>
        <button className="btn" onClick={() => exportData('pdf')} title="Ekspor data ke file PDF">
          <FileText size={17} />
          <span>PDF</span>
        </button>
        <button className="btn" onClick={() => setShowImportHelp(true)} disabled={importing} title="Lihat format kolom lalu import file Excel (.xlsx)">
          <FileUp size={17} />
          <span>{importing ? 'Mengimport…' : 'Import Excel'}</span>
        </button>
        <input
          ref={impRef}
          type="file"
          accept=".xlsx,.xlsm"
          hidden
          onChange={importData}
        />
        <button className="btn primary" onClick={() => setForm(empty)}>
          <Plus size={17} />
          <span>Tambah Paspor</span>
        </button>
      </PageHead>

      {scanMsg && <p className={'note ' + scanMsg.t} role="status">{scanMsg.m}</p>}

      {/* Unified Filter Toolbar */}
      <div className="filter-toolbar">
        <div className="filter-bar-main">
          {/* Search Box */}
          <div className="search-wrap">
            <Search size={18} className="search-icon-left" />
            <input
              placeholder="Cari nama jemaah, nomor paspor, HP, atau porsi…"
              value={f.q}
              onChange={e => setF({ ...f, q: e.target.value })}
            />
            {f.q && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setF({ ...f, q: '' })}
                aria-label="Hapus kata kunci pencarian"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Scan kertas visabio -> nomor paspor dipakai sebagai kata kunci */}
          <button
            type="button"
            className="btn search-scan"
            disabled={scanning}
            onClick={() => (navigator.mediaDevices?.getUserMedia ? setScanOpen(true) : scanRef.current.click())}
            title="Scan kertas visabio untuk mencari nomor paspor"
          >
            <ScanLine size={17} />
            <span>{scanning ? 'Memindai…' : 'Scan Visabio'}</span>
          </button>
          <input ref={scanRef} type="file" accept="image/*" hidden onChange={pickVisabio} />

          {/* Single Consolidated Filter Button */}
          <button
            type="button"
            className={`btn-filter-toggle ${activeFilters.length > 0 ? 'active' : ''}`}
            onClick={() => setShowFilters(v => !v)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={17} />
            <span>Filter</span>
            {activeFilters.length > 0 && <span className="filter-count-badge">{activeFilters.length}</span>}
            <ChevronDown
              size={15}
              style={{
                transform: showFilters ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s ease'
              }}
            />
          </button>

          {/* Urutan: nama / tanggal, asc / desc */}
          <div className="sort-wrap">
            <label htmlFor="sort-field">Urutkan</label>
            <select
              id="sort-field"
              aria-label="Kolom pengurutan"
              value={f.sort}
              onChange={e => setF(p => ({ ...p, sort: e.target.value, dir: defaultSortDir(e.target.value) }))}
            >
              {SORTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="sort-dir-btn"
              onClick={() => setF(p => ({ ...p, dir: p.dir === 'asc' ? 'desc' : 'asc' }))}
              title={f.dir === 'asc' ? 'Urutan naik, klik untuk menurun' : 'Urutan turun, klik untuk naik'}
              aria-label={f.dir === 'asc' ? 'Ubah ke urutan menurun' : 'Ubah ke urutan naik'}
            >
              <SortIcon size={16} />
              <span>{f.dir === 'asc' ? 'Naik' : 'Turun'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        {showFilters && (
          <div className="filter-panel">
            <div className="filter-panel-h">
              <div className="filter-panel-title">
                <SlidersHorizontal size={16} color="var(--primary)" />
                <span>Filter Data Paspor</span>
              </div>
              <div className="row" style={{ gap: '8px' }}>
                {activeFilters.length > 0 && (
                  <button type="button" className="filter-reset-link" onClick={clearAllFilters}>
                    Reset Semua
                  </button>
                )}
                <button
                  type="button"
                  className="icon"
                  style={{ width: '28px', height: '28px' }}
                  onClick={() => setShowFilters(false)}
                  aria-label="Tutup panel filter"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="filter-grid">
              <div className="filter-group">
                <span className="filter-group-label">Kecamatan</span>
                <select
                  value={f.kecamatan}
                  onChange={e => setF({ ...f, kecamatan: e.target.value })}
                  aria-label="Filter kecamatan"
                >
                  <option value="">Semua Kecamatan</option>
                  {districts.map(d => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <span className="filter-group-label">Status Visabio</span>
                <select
                  value={f.visabio_status}
                  onChange={e => setF({ ...f, visabio_status: e.target.value })}
                  aria-label="Filter status visabio"
                >
                  <option value="">Semua Status Visabio</option>
                  {VISABIO.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <span className="filter-group-label">Print Visabio</span>
                <select
                  value={f.visabio_printed}
                  onChange={e => setF({ ...f, visabio_printed: e.target.value })}
                  aria-label="Filter print visabio"
                >
                  <option value="">Semua Status Print</option>
                  {PRINT.map(o => (
                    <option key={o} value={o}>{o === 'belum' ? 'Belum print' : 'Sudah print'}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <span className="filter-group-label">Paspor Fisik</span>
                <select
                  value={f.passport_physical}
                  onChange={e => setF({ ...f, passport_physical: e.target.value })}
                  aria-label="Filter paspor fisik"
                >
                  <option value="">Semua Status Fisik</option>
                  {FISIK.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <span className="filter-group-label">Tahun Visabio</span>
                <select
                  value={f.visabio_year}
                  onChange={e => setF({ ...f, visabio_year: e.target.value })}
                  aria-label="Filter tahun visabio"
                >
                  <option value="">Semua Tahun Visabio</option>
                  {visabioYears.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Active Filter Chips / Pills */}
        {activeFilters.length > 0 && (
          <div className="filter-chips">
            <span className="filter-chips-label">Filter aktif:</span>
            {activeFilters.map(item => (
              <span key={item.key} className="filter-chip">
                <span>{item.label}: <b>{item.val}</b></span>
                <button
                  type="button"
                  className="filter-chip-remove"
                  onClick={() => setF({ ...f, [item.key]: '' })}
                  aria-label={`Hapus filter ${item.label}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button type="button" className="filter-chip-clear-all" onClick={clearAllFilters}>
              Reset Semua Filter
            </button>
          </div>
        )}
      </div>

      {/* Main Table Card */}
      <div className="card flush">
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort" onClick={() => toggleSort('name')} title="Urutkan berdasarkan nama">
                    Jemaah {f.sort === 'name' && <SortIcon size={13} />}
                  </button>
                </th>
                <th>Tgl Lahir</th>
                <th>Kecamatan</th>
                <th>Status Visabio</th>
                <th>Tgl Visabio</th>
                <th>Print</th>
                <th>Paspor Fisik</th>
                <th>Catatan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map(p => (
                <tr key={p.id}>
                  <td data-label="Jemaah">
                    <b>{p.name}</b>
                    {p.bin_binti && <small className="muted">{p.bin_binti}</small>}
                    <small className="muted" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.passport_number}</small>
                    {(p.phone || p.porsi_number) && (
                      <small className="muted">
                        {[p.phone, p.porsi_number && `Porsi: ${p.porsi_number}`].filter(Boolean).join(' · ')}
                      </small>
                    )}
                  </td>
                  <td data-label="Tgl lahir">{tgl(p.birth_date)}</td>
                  <td data-label="Kecamatan">{p.kecamatan || '–'}</td>
                  <td data-label="Visabio"><Badge v={p.visabio_status} /></td>
                  <td data-label="Tgl visabio">{tgl(p.visabio_date)}</td>
                  <td data-label="Print"><Badge v={p.visabio_printed} /></td>
                  <td data-label="Paspor fisik"><Badge v={p.passport_physical} /></td>
                  <td data-label="Catatan" className={'tbl-notes' + (p.notes ? '' : ' muted')}>{p.notes || '–'}</td>
                  <td className="act">
                    <button
                      className="icon"
                      onClick={() => setForm(p)}
                      aria-label="Ubah data paspor"
                      title="Ubah data"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon danger"
                      onClick={() => del(p)}
                      aria-label="Hapus data paspor"
                      title="Hapus data"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={currentPage} total={total} pageSize={PAGE_SIZE} onPage={setPage} label="paspor" />
        {rows && !rows.length && (
          <Empty>
            <p style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '4px' }}>Tidak ada data yang cocok</p>
            <p className="muted" style={{ fontSize: '0.88rem' }}>Coba ubah kata kunci pencarian atau sesuaikan filter yang aktif.</p>
            {activeFilters.length > 0 && (
              <button
                type="button"
                className="btn sm"
                onClick={clearAllFilters}
                style={{ marginTop: '10px' }}
              >
                Reset Filter
              </button>
            )}
          </Empty>
        )}
      </div>
      {showImportHelp && (
        <ImportHelp
          notify={notify}
          onClose={() => setShowImportHelp(false)}
          onPick={() => { setShowImportHelp(false); impRef.current.click(); }}
        />
      )}
      {importResult && <ImportResult result={importResult} onClose={() => setImportResult(null)} />}
      {scanOpen && (
        <CameraModal
          title="Foto Kertas Visabio"
          hint="Posisikan area bertuliskan 'Passport Number' dan nomornya di dalam bingkai. Foto lurus dari atas, terang, tanpa pantulan cahaya. Ketuk layar untuk membantu fokus bila kamera mendukung."
          onClose={() => setScanOpen(false)}
          onShot={scanVisabio}
        />
      )}
    </>
  );
}
