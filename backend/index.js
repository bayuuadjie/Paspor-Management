import express from 'express'; import pg from 'pg'; import bcrypt from 'bcryptjs'; import jwt from 'jsonwebtoken'; import multer from 'multer'; import ExcelJS from 'exceljs'; import PDFDocument from 'pdfkit';

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
await db.query(`
ALTER TABLE passports ADD COLUMN IF NOT EXISTS visabio_date DATE, ADD COLUMN IF NOT EXISTS bin_binti TEXT;
ALTER TABLE passports DROP CONSTRAINT IF EXISTS passports_visabio_status_check, DROP CONSTRAINT IF EXISTS passports_passport_physical_check;
UPDATE passports SET passport_physical='hilang' WHERE passport_physical='tidak';
ALTER TABLE passports ADD CONSTRAINT passports_visabio_status_check CHECK (visabio_status IN ('sudah','belum','under review','ditolak','mengulang')),
  ADD CONSTRAINT passports_passport_physical_check CHECK (passport_physical IN ('ada','dipinjam','diserahkan','hilang'));`);
await db.query(`
ALTER TABLE loans ADD COLUMN IF NOT EXISTS borrower_phone TEXT, ADD COLUMN IF NOT EXISTS borrower_address TEXT,
  ADD COLUMN IF NOT EXISTS loan_date DATE, ADD COLUMN IF NOT EXISTS due_date DATE;
UPDATE loans SET loan_date = (loaned_at AT TIME ZONE 'Asia/Jakarta')::date WHERE loan_date IS NULL;`);
await db.query(`CREATE TABLE IF NOT EXISTS loan_photos (
  loan_id INT PRIMARY KEY REFERENCES loans(id) ON DELETE CASCADE, mime TEXT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
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
const F = ['name', 'bin_binti', 'passport_number', 'birth_date', 'kecamatan', 'visabio_status', 'visabio_date', 'visabio_printed', 'passport_physical', 'phone', 'porsi_number', 'notes'];
const NULLABLE = ['bin_binti', 'birth_date', 'kecamatan', 'visabio_date', 'phone', 'porsi_number', 'notes'];const vals = b => F.map(k => { let v = typeof b[k] === 'string' ? b[k].trim() : b[k]; if (k === 'passport_number' && v) v = v.toUpperCase(); return v === '' && NULLABLE.includes(k) ? null : v === '' ? undefined : v; });
const queryPassports = async ({ q = '', kecamatan = '', visabio_status = '', passport_physical = '', visabio_year = '', limit = '' }) =>
  (await db.query(`SELECT * FROM passports WHERE (name ILIKE $1 OR passport_number ILIKE $1 OR phone ILIKE $1 OR porsi_number ILIKE $1) AND ($2='' OR kecamatan=$2)
    AND ($3='' OR visabio_status=$3) AND ($4='' OR passport_physical=$4)
    AND ($5='' OR (visabio_date IS NOT NULL AND EXTRACT(YEAR FROM visabio_date)::text=$5))
    ORDER BY name LIMIT $6`,
    [`%${q}%`, kecamatan, visabio_status, passport_physical, visabio_year, Math.min(Number(limit) || 0, 50) || null])).rows;
app.get('/api/passports', auth, wrap(async (req, res) => res.json(await queryPassports(req.query))));

// ---- helper PDF
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
const idDate = s => (s ? s.split('-').reverse().join('/') : '');

const EXPORT_COLS = [ // [judul, field, lebar, jenis]
  ['Nama', 'name', 30], ['Bin/Binti', 'bin_binti', 22], ['Nomor Paspor', 'passport_number', 16], ['Tanggal Lahir', 'birth_date', 14, 'date'], ['Kecamatan', 'kecamatan', 20],
  ['Status Visabio', 'visabio_status', 16, 'enum'], ['Tanggal Visabio', 'visabio_date', 16, 'date'], ['Print Visabio', 'visabio_printed', 14, 'enum'],
  ['Paspor Fisik', 'passport_physical', 14, 'enum'], ['Nomor HP', 'phone', 16], ['Nomor Porsi', 'porsi_number', 16], ['Catatan', 'notes', 40]];

// helper: buat PDF tabel paspor
const buildPassportPdf = (rows, title) => new Promise(resolve => {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
  const W = doc.page.width - 60;
  const cols = [
    { w: 24, label: 'No' }, { w: 110, label: 'Nama' }, { w: 72, label: 'Nomor Paspor' },
    { w: 65, label: 'Tgl Lahir' }, { w: 78, label: 'Kecamatan' }, { w: 68, label: 'Status Visabio' },
    { w: 65, label: 'Tgl Visabio' }, { w: 48, label: 'Print' }, { w: 56, label: 'Paspor Fisik' },
    { w: 72, label: 'No HP' }, { w: 72, label: 'No Porsi' }
  ];
  const rowH = 17;
  let y = 30;

  const drawHeader = () => {
    doc.fontSize(13).font('Helvetica-Bold').text(title, 30, y);
    y += 16;
    doc.fontSize(7).font('Helvetica').fillColor('#666').text(`Dicetak: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}  |  Total: ${rows.length} data`, 30, y);
    y += 14;
    // header baris
    doc.rect(30, y, W, rowH).fill('#0C6B58');
    let x = 30;
    cols.forEach(c => {
      doc.fillColor('white').font('Helvetica-Bold').fontSize(6.5).text(c.label, x + 2, y + 5, { width: c.w - 4, ellipsis: true });
      x += c.w;
    });
    doc.fillColor('black'); y += rowH;
  };

  drawHeader();
  rows.forEach((r, i) => {
    if (y + rowH > doc.page.height - 30) {
      doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' }); y = 30;
      doc.fontSize(7).font('Helvetica').fillColor('#666').text(title + ' (lanjutan)', 30, y); y += 14;
      doc.rect(30, y, W, rowH).fill('#0C6B58');
      let x = 30;
      cols.forEach(c => { doc.fillColor('white').font('Helvetica-Bold').fontSize(6.5).text(c.label, x + 2, y + 5, { width: c.w - 4, ellipsis: true }); x += c.w; });
      doc.fillColor('black'); y += rowH;
    }
    if (i % 2 === 0) doc.rect(30, y, W, rowH).fill('#EDF7F5');
    doc.rect(30, y, W, rowH).stroke('#C5DDD9');
    const vals2 = [i + 1, r.name, r.passport_number, idDate(r.birth_date), r.kecamatan || '–',
      cap(r.visabio_status), idDate(r.visabio_date), cap(r.visabio_printed), cap(r.passport_physical),
      r.phone || '–', r.porsi_number || '–'];
    let x = 30;
    cols.forEach((c, ci) => {
      doc.fillColor('#111').font('Helvetica').fontSize(6.5).text(String(vals2[ci] ?? ''), x + 2, y + 5, { width: c.w - 4, ellipsis: true });
      x += c.w;
    });
    y += rowH;
  });
  doc.end();
});

// ---- export passports (xlsx & pdf)
app.get('/api/passports/export', auth, wrap(async (req, res) => {
  const rows = await queryPassports(req.query), stamp = new Date().toISOString().slice(0, 10);
  if (req.query.format === 'pdf') {
    const buf = await buildPassportPdf(rows, 'Data Paspor Jemaah Haji');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="data-paspor-${stamp}.pdf"`);
    return res.send(buf);
  }
  // xlsx (default)
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
const queryLoans = async ({ status = '' }) => (await db.query(`
  SELECT l.*, p.name, p.passport_number, (l.returned_at AT TIME ZONE 'Asia/Jakarta')::date AS returned_date,
         EXISTS(SELECT 1 FROM loan_photos ph WHERE ph.loan_id = l.id) AS has_photo
  FROM loans l JOIN passports p ON p.id = l.passport_id
  WHERE ($1 = '' OR ($1 = 'open' AND l.returned_at IS NULL) OR ($1 = 'returned' AND l.returned_at IS NOT NULL))
  ORDER BY (l.returned_at IS NULL) DESC, l.loan_date DESC NULLS LAST, l.id DESC`, [status])).rows;
app.get('/api/loans', auth, wrap(async (req, res) => res.json(await queryLoans(req.query))));app.post('/api/loans', auth, wrap(async (req, res) => {
  const { passport_id, borrower = '', borrower_phone, borrower_address, note, loan_date, due_date } = req.body;
  const t = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (!borrower.trim()) return res.status(400).json({ error: 'Nama peminjam wajib diisi' });
  if (loan_date && due_date && due_date < loan_date) return res.status(400).json({ error: 'Tanggal rencana kembali tidak boleh sebelum tanggal peminjaman' });
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const up = await c.query("UPDATE passports SET passport_physical='dipinjam', updated_at=now() WHERE id=$1 AND passport_physical='ada' RETURNING id", [passport_id]);
    if (!up.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({ error: 'Paspor fisik tidak berstatus "ada"' }); }
    const r = await c.query(`INSERT INTO loans(passport_id,borrower,borrower_phone,borrower_address,note,loan_date,due_date)
      VALUES($1,$2,$3,$4,$5,COALESCE($6::date,(now() AT TIME ZONE 'Asia/Jakarta')::date),$7) RETURNING *`,
      [passport_id, borrower.trim(), t(borrower_phone), t(borrower_address), t(note), t(loan_date), t(due_date)]);
    await c.query('COMMIT'); res.status(201).json(r.rows[0]);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}));
app.post('/api/loans/:id/return', auth, wrap(async (req, res) => {
  const r = await db.query('UPDATE loans SET returned_at=now() WHERE id=$1 AND returned_at IS NULL RETURNING passport_id', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Peminjaman tidak ditemukan' });
  await db.query("UPDATE passports SET passport_physical='ada', updated_at=now() WHERE id=$1 AND passport_physical='dipinjam'", [r.rows[0].passport_id]); res.json({ ok: true });
}));

// ---- dashboard
// ---- foto peminjaman
const sniff = b => (!b || b.length < 12 ? null
  : b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF ? 'image/jpeg'
  : b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'image/png'
  : b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null);   // jenis file dari isinya, bukan dari klaim klien
app.get('/api/loans/:id/photo', auth, wrap(async (req, res) => {
  const r = (await db.query('SELECT mime,data FROM loan_photos WHERE loan_id=$1', [req.params.id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Belum ada foto' });
  res.set({ 'Content-Type': r.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.send(r.data);
}));
app.put('/api/loans/:id/photo', auth, upload.single('photo'), wrap(async (req, res) => {
  const mime = sniff(req.file && req.file.buffer);
  if (!mime) return res.status(400).json({ error: 'File harus berupa gambar JPG, PNG, atau WebP' });
  if (req.file.size > 4e6) return res.status(413).json({ error: 'Ukuran foto maksimal 4 MB' });
  if (!(await db.query('SELECT 1 FROM loans WHERE id=$1', [req.params.id])).rowCount) return res.status(404).json({ error: 'Peminjaman tidak ditemukan' });
  await db.query(`INSERT INTO loan_photos(loan_id,mime,data) VALUES($1,$2,$3)
    ON CONFLICT (loan_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, created_at=now()`, [req.params.id, mime, req.file.buffer]);
  res.json({ ok: true });
}));
app.delete('/api/loans/:id/photo', auth, wrap(async (req, res) => { await db.query('DELETE FROM loan_photos WHERE loan_id=$1', [req.params.id]); res.sendStatus(204); }));

// ---- export peminjaman (xlsx & pdf, termasuk foto)
const LOAN_COLS = [ // [judul, field, lebar, jenis]; field diawali _ = dihitung
  ['Nama Jemaah', 'name', 28], ['Nomor Paspor', 'passport_number', 16], ['Peminjam', 'borrower', 24], ['No. Telepon', 'borrower_phone', 16], ['Alamat', 'borrower_address', 36],
  ['Tanggal Peminjaman', 'loan_date', 18, 'date'], ['Rencana Dikembalikan', 'due_date', 20, 'date'], ['Tanggal Dikembalikan', 'returned_date', 20, 'date'],
  ['Status', '_status', 22], ['Catatan', 'note', 36]];

// query loans sekaligus dengan foto
const queryLoansWithPhoto = async ({ status = '' }) => (await db.query(`
  SELECT l.*, p.name, p.passport_number, (l.returned_at AT TIME ZONE 'Asia/Jakarta')::date AS returned_date,
         ph.data AS photo_data, ph.mime AS photo_mime
  FROM loans l JOIN passports p ON p.id = l.passport_id
  LEFT JOIN loan_photos ph ON ph.loan_id = l.id
  WHERE ($1 = '' OR ($1 = 'open' AND l.returned_at IS NULL) OR ($1 = 'returned' AND l.returned_at IS NOT NULL))
  ORDER BY (l.returned_at IS NULL) DESC, l.loan_date DESC NULLS LAST, l.id DESC`, [status])).rows;

// helper: buat PDF tabel peminjaman (dengan foto)
const buildLoanPdf = (rows, title, today) => new Promise(resolve => {
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
  const W = doc.page.width - 60;
  // kolom: No, Nama Jemaah, No Paspor, Peminjam, No Telp, Tgl Pinjam, Rencana Kembali, Tgl Dikembalikan, Status, Catatan, Foto
  const cols = [
    { w: 22, label: 'No' }, { w: 95, label: 'Nama Jemaah' }, { w: 68, label: 'No Paspor' },
    { w: 90, label: 'Peminjam' }, { w: 70, label: 'No Telepon' },
    { w: 60, label: 'Tgl Pinjam' }, { w: 65, label: 'Rencana Kembali' }, { w: 65, label: 'Tgl Kembali' },
    { w: 72, label: 'Status' }, { w: 90, label: 'Catatan' }, { w: 55, label: 'Foto TTD' }
  ];
  const rowH = 55; // tinggi baris lebih besar untuk foto
  let y = 30;

  const drawHeader = (isPage2 = false) => {
    if (!isPage2) {
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#111').text(title, 30, y); y += 16;
      doc.fontSize(7).font('Helvetica').fillColor('#666').text(`Dicetak: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}  |  Total: ${rows.length} data`, 30, y); y += 14;
    } else {
      doc.fontSize(7).font('Helvetica').fillColor('#666').text(title + ' (lanjutan)', 30, y); y += 14;
    }
    doc.rect(30, y, W, 16).fill('#0C6B58');
    let x = 30;
    cols.forEach(c => {
      doc.fillColor('white').font('Helvetica-Bold').fontSize(6).text(c.label, x + 2, y + 5, { width: c.w - 4, ellipsis: true });
      x += c.w;
    });
    doc.fillColor('black'); y += 16;
  };

  drawHeader(false);
  rows.forEach((r, i) => {
    if (y + rowH > doc.page.height - 30) {
      doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' }); y = 30;
      drawHeader(true);
    }
    if (i % 2 === 0) doc.rect(30, y, W, rowH).fill('#EDF7F5');
    doc.rect(30, y, W, rowH).stroke('#C5DDD9');

    const status = r.returned_at ? 'Dikembalikan' : (r.due_date && r.due_date < today ? 'Dipinjam (terlambat)' : 'Dipinjam');
    const textVals = [i + 1, r.name, r.passport_number, r.borrower, r.borrower_phone || '–',
      idDate(r.loan_date), idDate(r.due_date), idDate(r.returned_date), status, r.note || '–'];
    let x = 30;
    cols.forEach((c, ci) => {
      if (ci < cols.length - 1) {
        // text cell
        doc.fillColor('#111').font('Helvetica').fontSize(6.5).text(String(textVals[ci] ?? ''), x + 2, y + 4, { width: c.w - 4, height: rowH - 8, ellipsis: true });
      } else {
        // foto cell
        if (r.photo_data) {
          try {
            const imgBuf = Buffer.isBuffer(r.photo_data) ? r.photo_data : Buffer.from(r.photo_data);
            const imgW = c.w - 6, imgH = rowH - 6;
            doc.image(imgBuf, x + 3, y + 3, { fit: [imgW, imgH], align: 'center', valign: 'center' });
          } catch { doc.fillColor('#888').font('Helvetica').fontSize(6).text('Gagal muat', x + 2, y + 4); }
        } else {
          doc.fillColor('#AAA').font('Helvetica').fontSize(6).text('Tidak ada', x + 2, y + 4);
        }
      }
      x += c.w;
    });
    y += rowH;
  });
  doc.end();
});

app.get('/api/loans/export', auth, wrap(async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10), today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // WIB
  const val = (r, k) => (k === '_status' ? (r.returned_at ? 'Dikembalikan' : r.due_date && r.due_date < today ? 'Dipinjam (terlambat)' : 'Dipinjam')
    : r[k]);
  if (req.query.format === 'pdf') {
    const rows = await queryLoansWithPhoto(req.query);
    const buf = await buildLoanPdf(rows, 'Data Peminjaman Paspor', today);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="data-peminjaman-${stamp}.pdf"`);
    return res.send(buf);
  }
  // xlsx dengan foto
  const rows = await queryLoansWithPhoto(req.query);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Peminjaman', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'No', key: 'no', width: 6 },
    ...LOAN_COLS.map(([header, key, width, t]) => ({ header, key, width, style: t === 'date' ? { numFmt: 'dd/mm/yyyy' } : {} })),
    { header: 'Foto TTD', key: '_photo_cell', width: 22 }
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowData = { no: i + 1, ...Object.fromEntries(LOAN_COLS.map(([, k, , t]) =>
      [k, t === 'date' ? (val(r, k) ? new Date(val(r, k) + 'T00:00:00Z') : null) : val(r, k) ?? null])), _photo_cell: null };
    const exRow = ws.addRow(rowData);
    exRow.height = 60;
    // sisipkan foto sebagai image di sel kolom terakhir jika ada
    if (r.photo_data) {
      try {
        const imgBuf = Buffer.isBuffer(r.photo_data) ? r.photo_data : Buffer.from(r.photo_data);
        const mime = r.photo_mime || 'image/jpeg';
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'png' : 'jpeg';
        const finalBuf = ext === 'jpeg' ? imgBuf : imgBuf; // webp: exceljs tidak support, tetap coba
        const imgId = wb.addImage({ buffer: finalBuf, extension: ext });
        const colIdx = ws.columns.length - 1; // kolom Foto (0-based)
        ws.addImage(imgId, {
          tl: { col: colIdx, row: i + 1 },
          br: { col: colIdx + 1, row: i + 2 },
          editAs: 'oneCell'
        });
      } catch { /* foto gagal disisipkan, skip */ }
    }
  }
  const head = ws.getRow(1); head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C6B58' } }; });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="data-peminjaman-${stamp}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));

app.get('/api/stats', auth, wrap(async (_q, res) => {
  const g = async col => Object.fromEntries((await db.query(`SELECT ${col} k, count(*)::int n FROM passports GROUP BY 1`)).rows.map(r => [r.k, r.n]));
  const [visabio, print, fisik] = await Promise.all([g('visabio_status'), g('visabio_printed'), g('passport_physical')]);
  res.json({
    total: Object.values(fisik).reduce((a, b) => a + b, 0), visabio, print, fisik,
    review: (await db.query(`SELECT id,name,passport_number,visabio_date FROM passports WHERE visabio_status='under review' ORDER BY visabio_date NULLS LAST, name LIMIT 8`)).rows,
  });
}));

// ---- OCR: diteruskan ke service Python lokal; gambar tidak disimpan
app.post('/api/ocr', auth, uploadImage, wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada gambar' });
  const fd = new FormData(); fd.append('file', new Blob([req.file.buffer]), 'paspor.jpg');
  let r; try { r = await fetch(`${OCR_URL}/ocr`, { method: 'POST', body: fd }); } catch { return res.status(503).json({ error: 'Layanan OCR belum siap, coba lagi sebentar' }); }
  const body = await r.json().catch(() => ({})); res.status(r.status).json(r.ok ? body : { error: body.detail || 'OCR gagal', log: body.log, mrz_preview: body.mrz_preview });
}));

app.listen(4000, () => console.log('API siap di :4000'));
