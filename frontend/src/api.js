export const getToken = () => localStorage.getItem('token');
export const setToken = t => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

// Logout: beri tahu server agar session token dihapus di DB, lalu bersihkan lokal
export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* abaikan jika gagal jaringan */ }
  }
  setToken(null);
  localStorage.removeItem('paspor_last_act');
}

export async function download(path, filename) {
  const r = await fetch('/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (r.status === 401) {
    const data = await r.json().catch(() => ({}));
    setToken(null);
    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { code: data?.code || 'AUTH', message: data?.error || 'Sesi berakhir' } }));
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal mengunduh');
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function blobUrl(path) {
  const r = await fetch('/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (r.status === 401) {
    const data = await r.json().catch(() => ({}));
    setToken(null);
    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { code: data?.code || 'AUTH', message: data?.error || 'Sesi berakhir' } }));
  }
  if (!r.ok) throw new Error('Foto tidak bisa dimuat');
  return URL.createObjectURL(await r.blob());
}

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch('/api' + path, {
    ...opts, body: isForm || !opts.body ? opts.body : JSON.stringify(opts.body),
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${getToken()}` },
  });
  const data = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') {
    setToken(null);
    const code = data?.code || 'AUTH';
    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { code, message: data?.error || 'Sesi berakhir' } }));
  }
  if (!r.ok) throw Object.assign(new Error(data?.error || 'Terjadi kesalahan'), { data });
  return data;
}
