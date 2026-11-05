import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, X } from 'lucide-react';

function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Gambar tidak bisa dibaca. Gunakan foto JPG atau PNG.')); };
    img.src = url;
  });
}

// Perkecil foto (maks 1280 px, JPEG) di perangkat sebelum diunggah: hemat ruang dan cepat.
export async function compress(file, max = 1280, quality = 0.82) {
  const img = await loadImg(file);
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Gagal memproses gambar'))), 'image/jpeg', quality));
}

// value: Blob | null. Ambil foto dengan kamera atau pilih dari file/galeri.
export default function PhotoInput({ value, onChange }) {
  const [url, setUrl] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const cam = useRef(), file = useRef();
  useEffect(() => {
    if (!value) { setUrl(null); return; }
    const u = URL.createObjectURL(value); setUrl(u); return () => URL.revokeObjectURL(u);
  }, [value]);
  const pick = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    setBusy(true); setErr('');
    try { onChange(await compress(f)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div>
      {url ? (
        <div className="photo-prev"><img src={url} alt="Foto peminjaman" />
          <button type="button" className="icon" onClick={() => onChange(null)} aria-label="Hapus foto"><X size={16} /></button></div>
      ) : (
        <div className="row">
          <button type="button" className="btn" onClick={() => cam.current.click()} disabled={busy}><Camera size={18} /> Ambil foto</button>
          <button type="button" className="btn" onClick={() => file.current.click()} disabled={busy}><Upload size={18} /> Pilih file</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
    </div>
  );
}