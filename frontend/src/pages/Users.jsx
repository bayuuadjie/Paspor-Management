import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Modal, PageHead, Seg, tgl, useToast } from '../ui.jsx';

export default function Users({ me }) {
  const notify = useToast(); const [rows, setRows] = useState([]); const [f, setF] = useState({ full_name: '', username: '', password: '', role: 'staf' });
  const [reset, setReset] = useState(null); const [pw, setPw] = useState('');
  const load = () => api('/users').then(setRows).catch(e => notify(e.message, 'bad'));
  useEffect(() => { load(); }, []);
  const add = async e => {
    e.preventDefault();
    try { await api('/users', { method: 'POST', body: f }); setF({ full_name: '', username: '', password: '', role: 'staf' }); notify('Pengguna ditambahkan'); load(); } catch (x) { notify(x.message, 'bad'); }
  };
  const del = async u => { if (!confirm(`Hapus pengguna ${u.username}?`)) return; try { await api(`/users/${u.id}`, { method: 'DELETE' }); notify('Pengguna dihapus'); load(); } catch (x) { notify(x.message, 'bad'); } };
  const doReset = async e => { e.preventDefault(); try { await api(`/users/${reset.id}`, { method: 'PUT', body: { password: pw } }); notify('Password diubah'); setReset(null); setPw(''); } catch (x) { notify(x.message, 'bad'); } };
  return (
    <>
      <PageHead title="Pengguna" sub="Admin bisa menambah pengguna, mengatur ulang password, dan menghapus akun." />
      <form className="card form" onSubmit={add}>
        <label>Nama lengkap<input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} required /></label>
        <label>Username<input value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase() })} autoComplete="off" required /></label>
        <label>Password sementara<input type="password" minLength={8} value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete="new-password" required /></label>
        <div className="field"><label>Peran</label><Seg label="Peran" value={f.role} options={['staf', 'admin']} onChange={v => setF({ ...f, role: v })} /></div>
        <div className="wide row end"><button className="btn primary">Tambah pengguna</button></div>
      </form>
      <div className="card flush"><table className="tbl">
        <thead><tr><th>Nama</th><th>Username</th><th>Peran</th><th>Dibuat</th><th /></tr></thead>
        <tbody>{rows.map(u => <tr key={u.id}><td data-label="Nama"><b>{u.full_name || '–'}</b></td><td data-label="Username">{u.username}</td>
          <td data-label="Peran"><span className={'badge ' + (u.role === 'admin' ? 'info' : 'neutral')}>{u.role}</span></td><td data-label="Dibuat">{tgl(u.created_at)}</td>
          <td className="act"><button className="icon" onClick={() => setReset(u)} aria-label="Atur ulang password" title="Atur ulang password"><KeyRound size={16} /></button>
            {u.id !== me.id && <button className="icon danger" onClick={() => del(u)} aria-label="Hapus"><Trash2 size={16} /></button>}</td></tr>)}</tbody></table></div>
      {reset && <Modal title={`Password baru: ${reset.username}`} onClose={() => setReset(null)}>
        <form className="stack" onSubmit={doReset}><input type="password" minLength={8} placeholder="Minimal 8 karakter" value={pw} onChange={e => setPw(e.target.value)} autoFocus required autoComplete="new-password" />
          <button className="btn primary block">Simpan password</button></form></Modal>}
    </>
  );
}
