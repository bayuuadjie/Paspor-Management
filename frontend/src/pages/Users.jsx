import { useEffect, useState } from 'react';
import { KeyRound, Plus, Shield, Trash2, User, UserPlus } from 'lucide-react';
import { api } from '../api.js';
import { Modal, PageHead, Seg, tgl, useToast } from '../ui.jsx';

export default function Users({ me }) {
  const notify = useToast();
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ full_name: '', username: '', password: '', role: 'staf' });
  const [reset, setReset] = useState(null);
  const [pw, setPw] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const load = () =>
    api('/users')
      .then(setRows)
      .catch(e => notify(e.message, 'bad'));

  useEffect(() => {
    load();
  }, []);

  const add = async e => {
    e.preventDefault();
    try {
      await api('/users', { method: 'POST', body: f });
      setF({ full_name: '', username: '', password: '', role: 'staf' });
      setShowAddForm(false);
      notify('Pengguna baru berhasil ditambahkan');
      load();
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const del = async u => {
    if (!confirm(`Hapus pengguna ${u.username}? Akun ini tidak akan dapat login kembali.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      notify('Pengguna berhasil dihapus');
      load();
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  const doReset = async e => {
    e.preventDefault();
    try {
      await api(`/users/${reset.id}`, { method: 'PUT', body: { password: pw } });
      notify('Password berhasil diubah');
      setReset(null);
      setPw('');
    } catch (x) {
      notify(x.message, 'bad');
    }
  };

  return (
    <>
      <PageHead
        title="Manajemen Pengguna"
        sub="Kelola akun staf dan administrator yang memiliki akses ke sistem paspor."
      >
        <button
          className="btn primary"
          onClick={() => setShowAddForm(v => !v)}
        >
          <UserPlus size={17} />
          <span>{showAddForm ? 'Tutup Formulir' : 'Tambah Pengguna'}</span>
        </button>
      </PageHead>

      {showAddForm && (
        <form className="card form" onSubmit={add} style={{ marginBottom: '24px' }}>
          <div className="wide" style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Tambah Pengguna Baru</h3>
            <p className="muted" style={{ fontSize: '0.84rem' }}>
              Pengguna baru dapat langsung login menggunakan username dan password sementara yang dibuat di sini.
            </p>
          </div>
          <label>
            Nama Lengkap
            <input
              value={f.full_name}
              onChange={e => setF({ ...f, full_name: e.target.value })}
              placeholder="Contoh: Ahmad Syarifuddin"
              required
            />
          </label>
          <label>
            Username
            <input
              value={f.username}
              onChange={e => setF({ ...f, username: e.target.value.toLowerCase().trim() })}
              placeholder="Contoh: ahmad"
              autoComplete="off"
              required
            />
          </label>
          <label>
            Password Sementara
            <input
              type="password"
              minLength={8}
              value={f.password}
              onChange={e => setF({ ...f, password: e.target.value })}
              placeholder="Minimal 8 karakter"
              autoComplete="new-password"
              required
            />
          </label>
          <div className="field">
            <label>Peran / Hak Akses</label>
            <Seg
              label="Peran"
              value={f.role}
              options={['staf', 'admin']}
              onChange={v => setF({ ...f, role: v })}
            />
          </div>
          <div className="wide row end">
            <button type="button" className="btn" onClick={() => setShowAddForm(false)}>
              Batal
            </button>
            <button className="btn primary">
              <Plus size={17} />
              <span>Tambah Pengguna</span>
            </button>
          </div>
        </form>
      )}

      <div className="card flush">
        <table className="tbl">
          <thead>
            <tr>
              <th>Nama Lengkap</th>
              <th>Username</th>
              <th>Peran</th>
              <th>Tanggal Dibuat</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td data-label="Nama">
                  <div className="row" style={{ gap: '10px' }}>
                    <div className="avatar-chip" style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>
                      {(u.full_name || u.username || 'U')[0].toUpperCase()}
                    </div>
                    <b>{u.full_name || '–'}</b>
                  </div>
                </td>
                <td data-label="Username">
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{u.username}</span>
                </td>
                <td data-label="Peran">
                  <span className={'badge ' + (u.role === 'admin' ? 'info' : 'neutral')}>
                    <span className="badge-dot" />
                    <span>{u.role === 'admin' ? 'Admin' : 'Staf'}</span>
                  </span>
                </td>
                <td data-label="Dibuat">{tgl(u.created_at)}</td>
                <td className="act">
                  <button
                    className="icon"
                    onClick={() => setReset(u)}
                    aria-label="Atur ulang password"
                    title="Atur ulang password"
                  >
                    <KeyRound size={16} />
                  </button>
                  {u.id !== me.id && (
                    <button
                      className="icon danger"
                      onClick={() => del(u)}
                      aria-label="Hapus pengguna"
                      title="Hapus akun pengguna"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reset && (
        <Modal title={`Atur Ulang Password: ${reset.username}`} onClose={() => setReset(null)}>
          <form className="stack" onSubmit={doReset}>
            <p className="muted" style={{ fontSize: '0.86rem' }}>
              Masukkan password baru untuk akun <b>{reset.full_name || reset.username}</b>.
            </p>
            <input
              type="password"
              minLength={8}
              placeholder="Minimal 8 karakter password baru"
              value={pw}
              onChange={e => setPw(e.target.value)}
              autoFocus
              required
              autoComplete="new-password"
            />
            <div className="row end">
              <button type="button" className="btn" onClick={() => setReset(null)}>
                Batal
              </button>
              <button className="btn primary">Simpan Password Baru</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
