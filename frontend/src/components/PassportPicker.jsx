import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../api.js';

// Pencarian paspor async: ketik nama / nomor paspor / nomor porsi, lalu pilih dari dropdown.
// value = objek paspor terpilih (atau null); onChange(paspor | null).
export default function PassportPicker({ value, onChange, physical = 'ada', placeholder }) {
  const [q, setQ] = useState(''); const [items, setItems] = useState([]); const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [hi, setHi] = useState(0);
  const box = useRef(); const seq = useRef(0);

  useEffect(() => {                                   // cari ke server (ditunda 250 ms; balasan lama diabaikan)
    if (!open || value) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const rows = await api('/passports?' + new URLSearchParams({ q: q.trim(), passport_physical: physical, limit: '10' }));
        if (id === seq.current) { setItems(rows); setHi(0); }
      } catch { if (id === seq.current) setItems([]); }
      finally { if (id === seq.current) setBusy(false); }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, open, value, physical]);

  useEffect(() => {                                   // klik di luar menutup dropdown
    const h = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  const pick = p => { onChange(p); setOpen(false); setQ(''); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setHi(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && items[hi]) { e.preventDefault(); pick(items[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const info = p => [p.passport_number, p.porsi_number && `Porsi ${p.porsi_number}`, p.kecamatan].filter(Boolean).join(' · ');

  if (value) return (
    <div className="picked">
      <div><b>{value.name}</b>{value.bin_binti && <span className="muted"> {value.bin_binti}</span>}<small className="muted">{info(value)}</small></div>
      <button type="button" className="icon" onClick={() => onChange(null)} aria-label="Ganti paspor"><X size={16} /></button>
    </div>
  );
  return (
    <div className="picker" ref={box}>
      <div className="search"><Search size={18} />
        <input role="combobox" aria-expanded={open} aria-controls="picker-list" aria-autocomplete="list" autoComplete="off"
          placeholder={placeholder || 'Ketik nama, nomor paspor, atau nomor porsi'} value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} /></div>
      {open && (
        <ul className="picker-list" id="picker-list" role="listbox">
          {busy && !items.length && <li className="muted pad">Mencari…</li>}
          {!busy && !items.length && <li className="muted pad">Tidak ada paspor berstatus “{physical}” yang cocok.</li>}
          {items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseEnter={() => setHi(i)} onMouseDown={e => { e.preventDefault(); pick(p); }}>
              <b>{p.name}</b>{p.bin_binti && <span className="muted"> {p.bin_binti}</span>}<small className="muted">{info(p)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}