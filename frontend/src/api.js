export const getToken = () => localStorage.getItem('token');
export const setToken = t => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));
export async function download(path, filename) {
  const r = await fetch('/api' + path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (r.status === 401) { setToken(null); window.dispatchEvent(new Event('auth-expired')); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Gagal mengunduh');
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch('/api' + path, {
    ...opts, body: isForm || !opts.body ? opts.body : JSON.stringify(opts.body),
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${getToken()}` },
  });
  const data = r.status === 204 ? null : await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { setToken(null); window.dispatchEvent(new Event('auth-expired')); }
  if (!r.ok) throw Object.assign(new Error(data?.error || 'Terjadi kesalahan'), { data });
  return data;
}

