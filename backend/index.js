import express from 'express'; import pg from 'pg'; import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import multer from 'multer'; import ExcelJS from 'exceljs';

pg.types.setTypeParser(1082, v => v); // DATE tetap string 'YYYY-MM-DD' (tanpa geser zona waktu)
const { DATABASE_URL, OCR_URL = 'http://ocr:8000', JWT_SECRET, ADMIN_USER = 'admin', ADMIN_PASS } = process.env;
if (!JWT_SECRET || JWT_SECRET.length < 32 || !ADMIN_PASS) { console.error('JWT_SECRET (min 32 karakter) dan ADMIN_PASS wajib diisi'); process.exit(1); }

const db = new pg.Pool({ connectionString: DATABASE_URL });
const app = express(); app.set('trust proxy', true); app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10e6 } });
const uploadImage = (req, res, next) => upload.single('file')(req, res, err => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Ukuran gambar maksimal 10 MB. Kompres gambar atau pilih foto lain.' });
  }
  if (err) return res.status(400).json({ error: 'Berkas gambar tidak dapat diunggah.' });
  next();
});

await db.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staf' CHECK (role IN ('admin','staf')), created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS districts (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS passports (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, passport_number TEXT UNIQUE NOT NULL, birth_date DATE, kecamatan TEXT,
  visabio_status TEXT NOT NULL DEFAULT 'belum' CHECK (visabio_status IN ('sudah','belum','mengulang')),
  visabio_expiry DATE,
  visabio_printed TEXT NOT NULL DEFAULT 'belum' CHECK (visabio_printed IN ('sudah','belum')),
  passport_physical TEXT NOT NULL DEFAULT 'ada' CHECK (passport_physical IN ('ada','tidak','dipinjam','hilang','diserahkan')),
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY, passport_id INT NOT NULL REFERENCES passports(id) ON DELETE CASCADE,
  borrower TEXT NOT NULL, note TEXT, loaned_at TIMESTAMPTZ DEFAULT now(), returned_at TIMESTAMPTZ);`);
await db.query(`ALTER TABLE passports ADD COLUMN IF NOT EXISTS phone TEXT, ADD COLUMN IF NOT EXISTS porsi_number TEXT, ADD COLUMN IF NOT EXISTS notes TEXT`);
if (!(await db.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).rowCount) {
  await db.query("INSERT INTO users(username,full_name,password_hash,role) VALUES($1,'Administrator',$2,'admin')", [ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10)]);
  console.log('Akun admin dibuat:', ADMIN_USER);
}

const wrap = f => (req, res) => f(req, res).catch(e => {
  const c = String(e.constraint || '');
  if (e.code === '23505') return res.status(409).json({ error: c.includes('passport_number') ? 'Nomor paspor sudah terdaftar' : c.includes('username') ? 'Username sudah dipakai' : 'Kecamatan sudah ada' });
  if (['23514', '23502', '22007', '22008', '22P02'].includes(e.code)) return res.status(400).json({ error: 'Ada isian yang tidak valid' });
  console.error(e); res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});
const auth = async (req, res, next) => {
  try {
    const { id } = jwt.verify((req.headers.authorization || '').slice(7), JWT_SECRET);
    const u = (await db.query('SELECT id,username,full_name,role FROM users WHERE id=$1', [id])).rows[0];
    if (!u) throw 0; req.user = u; next();
  } catch { res.status(401).json({ error: 'Sesi berakhir, silakan login lagi' }); }
};
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Hanya admin yang boleh' }));

// ---- login (dibatasi 10 gagal / 15 menit / IP)
const fails = new Map();
const recent = ip => { const a = (fails.get(ip) || []).filter(t => Date.now() - t < 9e5); fails.set(ip, a); return a; };
app.post('/api/login', wrap(async (req, res) => {
  if (recent(req.ip).length >= 10) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' });
  const { username = '', password = '' } = req.body;
  const u = (await db.query('SELECT * FROM users WHERE lower(username)=lower($1)', [username])).rows[0];
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) { recent(req.ip).push(Date.now()); return res.status(401).json({ error: 'Username atau password salah' }); }
  res.json({ token: jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '12h' }), user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role } });
}));
app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---- pengguna (admin)
const lastAdmin = async id => { const r = (await db.query("SELECT id FROM users WHERE role='admin'")).rows; return r.length === 1 && r[0].id === id; };
app.get('/api/users', auth, adminOnly, wrap(async (_q, res) => res.json((await db.query('SELECT id,username,full_name,role,created_at FROM users ORDER BY id')).rows)));
app.post('/api/users', auth, adminOnly, wrap(async (req, res) => {
  const { username = '', full_name = '', password = '', role = 'staf' } = req.body;
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username 3-30 karakter: huruf kecil, angka, titik, strip, garis bawah' });
  if (password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
  if (!['admin', 'staf'].includes(role)) return res.status(400).json({ error: 'Peran tidak valid' });
  const r = await db.query('INSERT INTO users(username,full_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,username,full_name,role', [username, full_name.trim(), bcrypt.hashSync(password, 10), role]);
  res.status(201).json(r.rows[0]);
}));
app.put('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const { password = '' } = req.body;
  if (password.length < 8) return res.status(400).json({ error: 'Password minimal 8 karakter' });
  await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [bcrypt.hashSync(password, 10), req.params.id]); res.json({ ok: true });
}));
app.delete('/api/users/:id', auth, adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
  if (await lastAdmin(id)) return res.status(409).json({ error: 'Admin terakhir tidak bisa dihapus' });
  await db.query('DELETE FROM users WHERE id=$1', [id]); res.sendStatus(204);
}));

// ---- kecamatan
app.get('/api/districts', auth, wrap(async (_q, res) => res.json((await db.query(
  'SELECT d.id, d.name, count(p.id)::int AS total FROM districts d LEFT JOIN passports p ON p.kecamatan=d.name GROUP BY d.id ORDER BY d.name')).rows)));
app.post('/api/districts', auth, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 60) return res.status(400).json({ error: 'Nama kecamatan 1-60 karakter' });
  res.status(201).json((await db.query('INSERT INTO districts(name) VALUES($1) RETURNING *', [name])).rows[0]);
}));
app.delete('/api/districts/:id', auth, wrap(async (req, res) => {
  const n = (await db.query('SELECT count(*)::int n FROM passports p JOIN districts d ON d.name=p.kecamatan WHERE d.id=$1', [req.params.id])).rows[0].n;
  if (n) return res.status(409).json({ error: `Masih dipakai ${n} paspor` });
  await db.query('DELETE FROM districts WHERE id=$1', [req.params.id]); res.sendStatus(204);
}));

// ---- paspor
const F = ['name', 'passport_number', 'birth_date', 'kecamatan', 'visabio_status', 'visabio_expiry', 'visabio_printed', 'passport_physical', 'phone', 'porsi_number', 'notes'];
const NULLABLE = ['birth_date', 'kecamatan', 'visabio_expiry', 'phone', 'porsi_number', 'notes'];
const vals = b => F.map(k => { let v = typeof b[k] === 'string' ? b[k].trim() : b[k]; if (k === 'passport_number' && v) v = v.toUpperCase(); return v === '' && NULLABLE.includes(k) ? null : v === '' ? undefined : v; });
const queryPassports = async ({ q = '', kecamatan = '', visabio_status = '', passport_physical = '' }) =>
  (await db.query(`SELECT * FROM passports WHERE (name ILIKE $1 OR passport_number ILIKE $1 OR phone ILIKE $1 OR porsi_number ILIKE $1) AND ($2='' OR kecamatan=$2)
    AND ($3='' OR visabio_status=$3) AND ($4='' OR passport_physical=$4) ORDER BY name`, [`%${q}%`, kecamatan, visabio_status, passport_physical])).rows;
app.get('/api/passports', auth, wrap(async (req, res) => res.json(await queryPassports(req.query))));

// ---- export (mengikuti filter yang sama dengan daftar)
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const idDate = s => (s ? s.split('-').reverse().join('/') : '');
const EXPORT_COLS = [ // [judul, field, lebar, jenis]
  ['Nama', 'name', 30], ['Nomor Paspor', 'passport_number', 16], ['Tanggal Lahir', 'birth_date', 14, 'date'], ['Kecamatan', 'kecamatan', 20],
  ['Status Visabio', 'visabio_status', 16, 'enum'], ['Kadaluarsa Visabio', 'visabio_expiry', 18, 'date'], ['Print Visabio', 'visabio_printed', 14, 'enum'],
  ['Paspor Fisik', 'passport_physical', 14, 'enum'], ['Nomor HP', 'phone', 16], ['Nomor Porsi', 'porsi_number', 16], ['Catatan', 'notes', 40]];
app.get('/api/passports/export', auth, wrap(async (req, res) => {
  const rows = await queryPassports(req.query), stamp = new Date().toISOString().slice(0, 10);
  if (req.query.format === 'csv') {
    const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d ()-]*$/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; // cegah formula injection
    const lines = [['No', ...EXPORT_COLS.map(c => c[0])].map(cell).join(',')];
    rows.forEach((r, i) => lines.push([i + 1, ...EXPORT_COLS.map(([, k, , t]) => (t === 'date' ? idDate(r[k]) : t === 'enum' ? cap(r[k]) : r[k]))].map(cell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="data-paspor-${stamp}.csv"`);
    return res.send('\uFEFF' + lines.join('\r\n')); // BOM agar Excel/LibreOffice membaca UTF-8
  }
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Data Paspor', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ header: 'No', key: 'no', width: 6 }, ...EXPORT_COLS.map(([header, key, width, t]) => ({ header, key, width, style: t === 'date' ? { numFmt: 'dd/mm/yyyy' } : {} }))];
  rows.forEach((r, i) => ws.addRow({ no: i + 1, ...Object.fromEntries(EXPORT_COLS.map(([, k, , t]) =>
    [k, t === 'date' ? (r[k] ? new Date(r[k] + 'T00:00:00Z') : null) : t === 'enum' ? cap(r[k]) : r[k] ?? null])) }));
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C6B58' } }; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="data-paspor-${stamp}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));
app.post('/api/passports', auth, wrap(async (req, res) => {
  const r = await db.query(`INSERT INTO passports(${F}) VALUES(${F.map((_, i) => '$' + (i + 1))}) RETURNING *`, vals(req.body));
  res.status(201).json(r.rows[0]);
}));
app.put('/api/passports/:id', auth, wrap(async (req, res) => {
  const v = vals(req.body);
  const r = await db.query(`UPDATE passports SET ${F.map((c, i) => `${c}=$${i + 1}`)}, updated_at=now() WHERE id=$${F.length + 1} RETURNING *`, [...v, req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Data tidak ditemukan' });
  if (r.rows[0].passport_physical !== 'dipinjam') await db.query('UPDATE loans SET returned_at=now() WHERE passport_id=$1 AND returned_at IS NULL', [req.params.id]);
  res.json(r.rows[0]);
}));
app.delete('/api/passports/:id', auth, wrap(async (req, res) => { await db.query('DELETE FROM passports WHERE id=$1', [req.params.id]); res.sendStatus(204); }));

// ---- peminjaman
app.get('/api/loans', auth, wrap(async (_q, res) => res.json((await db.query(
  `SELECT l.*, p.name, p.passport_number FROM loans l JOIN passports p ON p.id=l.passport_id ORDER BY (l.returned_at IS NULL) DESC, l.loaned_at DESC`)).rows)));
app.post('/api/loans', auth, wrap(async (req, res) => {
  const { passport_id, borrower = '', note } = req.body, c = await db.connect();
  if (!borrower.trim()) { c.release(); return res.status(400).json({ error: 'Nama peminjam wajib diisi' }); }
  try {
    await c.query('BEGIN');
    const up = await c.query("UPDATE passports SET passport_physical='dipinjam', updated_at=now() WHERE id=$1 AND passport_physical='ada' RETURNING id", [passport_id]);
    if (!up.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'Paspor fisik tidak berstatus "ada"' }); }
    const r = await c.query('INSERT INTO loans(passport_id,borrower,note) VALUES($1,$2,$3) RETURNING *', [passport_id, borrower.trim(), note || null]);
    await c.query('COMMIT'); res.status(201).json(r.rows[0]);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
app.post('/api/loans/:id/return', auth, wrap(async (req, res) => {
  const r = await db.query('UPDATE loans SET returned_at=now() WHERE id=$1 AND returned_at IS NULL RETURNING passport_id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Peminjaman tidak ditemukan' });
  await db.query("UPDATE passports SET passport_physical='ada', updated_at=now() WHERE id=$1 AND passport_physical='dipinjam'", [r.rows[0].passport_id]); res.json({ ok: true });
}));

// ---- dashboard
app.get('/api/stats', auth, wrap(async (_q, res) => {
  const g = async col => Object.fromEntries((await db.query(`SELECT ${col} k, count(*)::int n FROM passports GROUP BY 1`)).rows.map(r => [r.k, r.n]));
  const [visabio, print, fisik] = await Promise.all([g('visabio_status'), g('visabio_printed'), g('passport_physical')]);
  const exp = `FROM passports WHERE visabio_expiry IS NOT NULL AND visabio_expiry <= CURRENT_DATE + 30`;
  res.json({
    total: Object.values(fisik).reduce((a, b) => a + b, 0), visabio, print, fisik,
    expiring_count: (await db.query(`SELECT count(*)::int n ${exp}`)).rows[0].n,
    expiring: (await db.query(`SELECT id,name,passport_number,visabio_expiry ${exp} ORDER BY visabio_expiry LIMIT 8`)).rows,
  });
}));

// ---- OCR: diteruskan ke service Python lokal; gambar tidak disimpan
app.post('/api/ocr', auth, uploadImage, wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada gambar' });
  const fd = new FormData(); fd.append('file', new Blob([req.file.buffer]), 'paspor.jpg');
  let r; try { r = await fetch(`${OCR_URL}/ocr`, { method: 'POST', body: fd }); } catch { return res.status(503).json({ error: 'Layanan OCR belum siap, coba lagi sebentar' }); }
  const body = await r.json().catch(() => ({})); res.status(r.status).json(r.ok ? body : { error: body.detail || 'OCR gagal', log: body.log });
}));

app.listen(4000, () => console.log('API siap di :4000'));
