import io
import re
import time
from datetime import date
from difflib import SequenceMatcher, get_close_matches

import cv2
import numpy as np
import pytesseract
from PIL import Image, ImageOps
from pytesseract import Output

FIELDS = ("name", "passport_number", "birth_date")
MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MEI": 5, "MAY": 5, "JUN": 6, "JUL": 7, "AGU": 8, "AGT": 8,
          "AUG": 8, "SEP": 9, "OKT": 10, "OCT": 10, "NOV": 11, "DES": 12, "DEC": 12}
LABEL_WORDS = {"FUL", "FULI", "NAMA", "LENGKAP", "FULL", "NAME", "NO", "PASPOR", "PASSPORT", "TGL", "LAHIR", "DATE", "OF", "BIRTH",
               "JENIS", "TYPE", "KODE", "NEGARA", "COUNTRY", "CODE", "KEWARGANEGARAAN", "NATIONALITY", "KELAMIN",
               "SEX", "TEMPAT", "PLACE", "PENGELUARAN", "ISSUE", "HABIS", "BERLAKU", "EXPIRY", "REG", "KANTOR",
               "YANG", "MENGELUARKAN", "ISSUING", "OFFICE", "DAN", "AND"}
WHITELIST = {
    "name": None,
    "passport_number": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "birth_date": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-.",
}
TO_DIGIT = str.maketrans("OQDILBSZG|", "0001185266")   # huruf yang sering salah baca sebagai angka
TO_LETTER = str.maketrans("01582", "OISBZ")             # angka yang sering salah baca sebagai huruf
HEAD_WORDS = {"FULL", "FUL", "FULI", "NAME", "NAMA", "LENGKAP"}
NOT_NAMES = {"INDONESIA", "WNI", "IDN", "REPUBLIK", "PASPOR", "PASSPORT", "INDONESIAN"}
NAME_FIX = str.maketrans("0158", "OISB")


# ---------------------------------------------------------------- parsing nilai
def parse_name(t):
    t = t.replace("|", "I").replace("!", "I")
    if not re.search(r"[a-km-z]", t):          # teks kapital: 'l' kecil pasti huruf I
        t = t.replace("l", "I")
    s = re.sub(r"[^A-Z .'\-]", " ", t.upper().translate(NAME_FIX))
    s = re.sub(r"\s+", " ", s).strip(" .'-")
    toks = s.split()
    while toks and (toks[0] in HEAD_WORDS or (len(toks[0]) >= 5 and SequenceMatcher(None, toks[0], "LENGKAP").ratio() >= 0.8)):
        toks.pop(0)                                  # sisa label ("Full Name", "Nama Lengkap") yang menempel di depan nama
    s = " ".join(toks)
    if any(w in NOT_NAMES or (len(w) > 5 and SequenceMatcher(None, w, "INDONESIA").ratio() >= 0.8) for w in toks) or (toks and sum(len(w) > 3 and _is_label_word(w) for w in toks) / len(toks) > 0.5):
        return None                              # kata label / nama negara bukan nama jemaah
    if sum(len(w.strip(".'-")) <= 1 for w in toks) > 1 or (toks and max(len(w) for w in toks) < 3):
        return None                              # banyak huruf tunggal = sampah OCR
    letters = sum(c.isalpha() for c in s)
    return s if letters >= 3 and letters >= 0.6 * len(re.sub(r"\s", "", t)) else None


def parse_number(t):
    toks = re.findall(r"[A-Z0-9]+", t.upper())
    if len(toks) > 1:
        for tok in toks:                                 # kata tunggal yang berpola paspor RI
            if len(tok) == 8 and re.fullmatch(r"[A-Z]\d{7}", tok[0].translate(TO_LETTER) + tok[1:].translate(TO_DIGIT)):
                return tok[0].translate(TO_LETTER) + tok[1:].translate(TO_DIGIT)
    s = re.sub(r"[^A-Z0-9]", "", t.upper())
    if len(s) == 8:                                      # format paspor Indonesia: 1 huruf + 7 angka
        fixed = s[0].translate(TO_LETTER) + s[1:].translate(TO_DIGIT)
        if re.fullmatch(r"[A-Z]\d{7}", fixed):
            return fixed
    return s if 6 <= len(s) <= 9 and any(c.isdigit() for c in s) else None


def _month(tok):
    if tok in MONTHS:
        return MONTHS[tok]
    m = get_close_matches(tok, MONTHS, n=1, cutoff=0.66)
    return MONTHS[m[0]] if m else None


def parse_date(t):
    s, d, mon, y = t.upper(), None, None, None
    m = re.search(r"([0-9OILSB|]{1,2})\s*[-./ ]?\s*([A-Z]{3})(?:\s*/\s*([A-Z]{3}))?\s*[-./ ]?\s*([0-9OILSB|]{4})", s)
    if m:
        d, y = int(m[1].translate(TO_DIGIT)), int(m[4].translate(TO_DIGIT))
        mon = _month(m[2]) or (_month(m[3]) if m[3] else None)
    else:
        m = re.search(r"(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4})", s)
        if m:
            d, mon, y = int(m[1]), int(m[2]), int(m[3])
    try:
        dt = date(y, mon, d)
    except (TypeError, ValueError):
        return None
    return dt.isoformat() if 1900 <= y and dt < date.today() else None


PARSERS = {"name": parse_name, "passport_number": parse_number, "birth_date": parse_date}


# ---------------------------------------------------------------- MRZ (pembanding)
def _cd(s):
    w, v = (7, 3, 1), 0
    for i, c in enumerate(s):
        n = int(c) if c.isdigit() else (ord(c) - 55 if c.isalpha() else 0)
        v += n * w[i % 3]
    return v % 10


def read_mrz(gray):
    for frac in (0.66, 0.0):                      # bagian bawah dulu; jika foto hanya berisi MRZ, pakai seluruh gambar
        out = _read_mrz(gray[int(gray.shape[0] * frac):, :])
        if out:
            return out
    return {}


def _read_mrz(crop):
    W = crop.shape[1]
    k = min(3.0, 2600 / W) if W < 2600 else 1.0
    crop = cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    txt = pytesseract.image_to_string(crop, lang="eng", config="--oem 1 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")
    lines = [re.sub(r"[^A-Z0-9<]", "", l.upper()) for l in txt.splitlines()]
    lines = [l for l in lines if len(l) >= 30]
    if len(lines) < 2:
        return {}
    l1, l2 = (lines[-2] + "<" * 44)[:44], (lines[-1] + "<" * 44)[:44]
    out = {}
    p = l2.find("IDN", 9, 15)                     # patokan: bila ada karakter sisipan/hilang, posisi ikut bergeser
    p = 10 if p < 0 else p
    for s in dict.fromkeys((0, p - 10)):
        if s < 0:
            continue
        raw, cdc = l2[s:s + 9], l2[s + 9].translate(TO_DIGIT)
        for cand in (raw, raw[0].translate(TO_LETTER) + raw[1:].translate(TO_DIGIT)):
            num = cand.replace("<", "")
            if cdc.isdigit() and _cd(cand) == int(cdc) and re.fullmatch(r"[A-Z]\d{7}", num):  # lolos check digit DAN berpola paspor RI
                out["passport_number"] = num
                break
        if "passport_number" in out:
            break
    dob, c = l2[p + 3:p + 9].translate(TO_DIGIT), l2[p + 9:p + 10].translate(TO_DIGIT)
    if dob.isdigit() and c.isdigit() and _cd(dob) == int(c):
        yy = int(dob[:2]); year = 2000 + yy if yy <= date.today().year % 100 else 1900 + yy
        try:
            out["birth_date"] = date(year, int(dob[2:4]), int(dob[4:6])).isoformat()
        except ValueError:
            pass
    if l1.startswith("P"):
        parts = [p.replace("<", " ").strip() for p in l1[5:].split("<<") if p.strip("<")]
        if parts:
            nm = parse_name(f"{parts[1]} {parts[0]}" if len(parts) > 1 else parts[0])
            if nm:
                out["name"] = nm
    return out


# ---------------------------------------------------------------- OCR + tata letak
class Log:
    """Catatan proses OCR yang ditampilkan di layar (tidak ditulis ke log server karena memuat data pribadi)."""
    def __init__(self):
        self.lines, self.t0 = [], time.time()

    def __call__(self, *a):
        self.lines.append(" ".join(str(x) for x in a))


LABELS = {"name": "Nama Lengkap", "passport_number": "No. Paspor", "birth_date": "Tgl. Lahir"}


def load_bgr(data):
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    a = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w = a.shape[:2]
    k = min(3.0, 2400 / max(h, w))
    return cv2.resize(a, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)


def _flat(ch):
    """Ratakan pencahayaan: bagi dengan estimasi latar (menghapus bayangan dan gradasi)."""
    return cv2.divide(ch, cv2.medianBlur(cv2.dilate(ch, np.ones((7, 7), np.uint8)), 61), scale=255)


# Kanal V (nilai tertinggi R/G/B) menghapus motif guilloche berwarna: teks hitam tetap gelap di semua kanal,
# sedangkan garis berwarna tetap terang di salah satu kanal.
VARIANTS = (("V-rata", lambda a: _flat(a.max(axis=2))),
            ("V-asli", lambda a: a.max(axis=2)),
            ("abu-abu+CLAHE", lambda a: cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY))))


def deskew(gray):
    """Luruskan foto yang miring (+-10 derajat) dengan mencari sudut yang membuat baris teks paling tajam."""
    k = 800 / gray.shape[1]
    small = cv2.medianBlur(cv2.resize(gray, None, fx=k, fy=k, interpolation=cv2.INTER_AREA), 3)
    bw = cv2.adaptiveThreshold(small, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    h, w = bw.shape; best, best_s = 0.0, -1.0
    for a in np.arange(-10, 10.01, 0.5):
        r = cv2.warpAffine(bw, cv2.getRotationMatrix2D((w / 2, h / 2), a, 1), (w, h))
        s = float(np.var(r.sum(axis=1)))
        if s > best_s:
            best, best_s = float(a), s
    if abs(best) < 0.4:
        return gray, 0.0
    H, W = gray.shape
    return cv2.warpAffine(gray, cv2.getRotationMatrix2D((W / 2, H / 2), best, 1), (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE), best


def _norm(t):
    return re.sub(r"[^A-Z]", "", t.upper().replace("0", "O").replace("1", "I"))


def _is_label_word(w):
    if len(w) <= 3:
        return w in LABEL_WORDS
    return any(SequenceMatcher(None, w, l).ratio() >= 0.85 for l in LABEL_WORDS if len(l) > 3)


def _cells(gray):
    d = pytesseract.image_to_data(gray, lang="eng", config="--oem 1 --psm 11", output_type=Output.DICT)
    words = [dict(t=d["text"][i].strip(), c=float(d["conf"][i]), l=d["left"][i], tp=d["top"][i], w=d["width"][i], h=d["height"][i])
             for i in range(len(d["text"])) if d["text"][i].strip() and float(d["conf"][i]) >= 0]
    rows = []
    for w in sorted(words, key=lambda w: w["tp"] + w["h"] / 2):
        cy = w["tp"] + w["h"] / 2
        for r in rows:
            if abs(r["cy"] - cy) < 0.6 * max(r["h"], w["h"]):
                r["w"].append(w); break
        else:
            rows.append({"cy": cy, "h": w["h"], "w": [w]})
    cells = []
    for r in rows:
        ws = sorted(r["w"], key=lambda w: w["l"]); cur = [ws[0]]
        for w in ws[1:]:
            if w["l"] - (cur[-1]["l"] + cur[-1]["w"]) > 1.5 * max(w["h"], cur[-1]["h"]):
                cells.append(cur); cur = [w]
            else:
                cur.append(w)
        cells.append(cur)
    out = []
    for c in cells:
        hs = sorted(w["h"] for w in c)
        out.append(dict(words=c, text=" ".join(w["t"] for w in c), l=min(w["l"] for w in c), t=min(w["tp"] for w in c),
                        r=max(w["l"] + w["w"] for w in c), b=max(w["tp"] + w["h"] for w in c), h=hs[len(hs) // 2],
                        conf=sum(w["c"] for w in c) / len(c)))
    return out


def _label_ish(cell):
    ws = [x for x in (_norm(w["t"]) for w in cell["words"]) if x]
    n = sum(_is_label_word(w) for w in ws)
    return bool(ws) and (n / len(ws) > 0.5 or (len(ws) == 1 and n == 1))


def _anchor_score(cell, field):
    ws = [x for x in (_norm(w["t"]) for w in cell["words"]) if x]
    has = lambda kw, r=0.75: any(SequenceMatcher(None, w, kw).ratio() >= r for w in ws)
    if field == "name":
        return 2 if has("LENGKAP") else 1 if has("FULL", 0.99) and has("NAME") else 0
    if field == "passport_number":
        return (2 if "NO" in ws else 1) if has("PASPOR") or has("PASSPORT") else 0   # skor 1 = longgar (bisa judul halaman)
    if (has("LAHIR") or has("BIRTH")) and not has("TEMPAT") and not has("PLACE", 0.8):
        return 1 + has("TGL", 0.99) + has("DATE", 0.8)
    return 0


def _cy(c):
    return (c["t"] + c["b"]) / 2


def _refine(gray, box, field, multiline=False):
    """Baca ulang area kecil dengan pembesaran, whitelist, dan 3 variasi binarisasi. Mengembalikan (daftar nilai valid, teks mentah)."""
    H, W = gray.shape; l, t, r, b, h = (int(v) for v in box)
    pad = int(h * 0.4)
    crop = gray[max(0, t - pad):min(H, b + pad), max(0, l - pad):min(W, r + pad)]
    if crop.size == 0 or min(crop.shape) < 8:
        return [], []
    k = float(np.clip(70 / max(h, 1), 1, 4))
    crop = cv2.copyMakeBorder(cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC), 24, 24, 24, 24, cv2.BORDER_REPLICATE)
    variants = [crop, cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1],
                cv2.adaptiveThreshold(crop, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 12)]
    wl = WHITELIST[field]
    cfg = f"--oem 1 --psm {6 if multiline else 7}" + (f' -c tessedit_char_whitelist="{wl}"' if wl else "")
    good, raw = [], []
    for v in variants:
        txt = pytesseract.image_to_string(v, lang="eng", config=cfg).strip()
        raw.append(" / ".join(x.strip() for x in txt.splitlines() if x.strip()))
        for line in (txt.splitlines() if multiline else [txt]):
            val = PARSERS[field](line)
            if val:
                good.append(val); break
        if len(good) >= 2 and good[-1] == good[-2]:       # dua variasi sepakat: cukup
            break
    return good, raw


def _vote(base, refined, field):
    pool = list(refined)
    if base and (len(pool) < 2 or SequenceMatcher(None, base, max(pool, key=lambda c: sum(SequenceMatcher(None, c, o).ratio() for o in pool))).ratio() >= 0.8):
        pool = [base, base] + pool                      # hasil pass 1 diberi 2 suara, kecuali jelas rusak/terpotong
    if not pool:
        return None, 0
    if field == "passport_number" and any(re.fullmatch(r"[A-Z]\d{7}", x) for x in pool):
        pool = [x for x in pool if re.fullmatch(r"[A-Z]\d{7}", x)]   # utamakan pola paspor RI
    sc = lambda c: sum(SequenceMatcher(None, c, o).ratio() for o in pool)
    best = max(dict.fromkeys(pool), key=sc)
    return best, round(100 * sc(best) / len(pool))


def _read_value(gray, a, cells, field, L):
    W = gray.shape[1]; tol = max(3 * a["h"], 0.025 * W); max_dy = max(7 * a["h"], 0.06 * W)
    right = min([x["l"] for x in cells if x is not a and _label_ish(x) and abs(x["t"] - a["t"]) < 1.5 * a["h"] and x["l"] > a["r"]], default=W)
    below = sorted((c for c in cells if c is not a and c["t"] >= a["t"] + 0.6 * a["h"] and c["t"] - a["b"] <= max_dy
                    and abs(c["l"] - a["l"]) <= tol and sum(ch.isalnum() for ch in c["text"]) >= 2), key=lambda c: c["t"])
    cand, last_b = [], a["b"]
    for c in below:
        if _label_ish(c):
            if not cand and c["t"] - last_b < 1.8 * a["h"]:      # baris kedua label (mis. "Full Name"), lewati
                last_b = c["b"]; continue
            L(f"   berhenti: di bawahnya ada label '{c['text'][:30]}'"); break
        cand.append(c)
    rows = []
    for c in cand:                                               # kelompokkan potongan yang sebaris
        if not rows or abs(_cy(rows[-1][0]) - _cy(c)) > 0.6 * max(c["h"], rows[-1][0]["h"]):
            rows.append([c])
        else:
            rows[-1].append(c)
    results = []
    for row in rows[:2]:
        # satukan SEMUA potongan sebaris di kolom ini (kata yang terputus motif tetap tergabung)
        members = [x for x in cells if not _label_ish(x) and abs(_cy(x) - _cy(row[0])) < 0.6 * max(x["h"], row[0]["h"]) and a["l"] - tol <= x["l"] < right]
        text = " ".join(x["text"] for x in sorted(members, key=lambda x: x["l"]))
        h = sorted(x["h"] for x in members)[len(members) // 2]
        box = (a["l"] - tol, min(x["t"] for x in members), min(right, max(x["r"] for x in members) + 3 * h), max(x["b"] for x in members), h)
        if results and not (field == "name" and 0 <= box[1] - results[-1][2][3] < results[-1][2][4] and abs(h - results[-1][2][4]) < 0.4 * results[-1][2][4]):
            break                                        # bukan lanjutan nama (terlalu jauh / beda ukuran)
        base = PARSERS[field](text)
        mconf = sum(x["conf"] for x in members) / len(members)
        if base and mconf >= 93 and (field != "passport_number" or re.fullmatch(r"[A-Z]\d{7}", base)):
            good, raw = [], ["(dilewati: pass 1 sudah sangat yakin)"]
        else:
            good, raw = _refine(gray, box, field)
        L(f"   kandidat baris: {text[:60]!r} -> pass1={base!r}; baca ulang={raw}")
        val, agree = _vote(base, good, field)
        if val:
            conf = sum(x["conf"] for x in members) / len(members)
            results.append((val, round(0.5 * conf + 0.5 * agree), box, row))
            if field != "name":
                break
        elif field == "name" and results:
            break
    if not results:                                              # cadangan: baca langsung area di bawah label
        box = (a["l"] - tol, last_b + 0.2 * a["h"], right, last_b + 3.2 * a["h"] * 1.6, int(a["h"] * 1.6))
        good, raw = _refine(gray, tuple(int(v) for v in box), field, multiline=True)
        L(f"   area bawah label dibaca langsung: {raw}")
        val, agree = _vote(None, good, field)
        if val:
            results.append((val, min(agree, 70), box, []))
    if not results:
        return None
    value = " ".join(r[0] for r in results) if field == "name" else results[0][0]
    return value, min(r[1] for r in results)


def _no_label(cells, H, field):
    """Cadangan tanpa label: cari pola nilai di seluruh halaman (di atas area MRZ)."""
    top = [c for c in cells if c["t"] < 0.78 * H and "<" not in c["text"]]
    if field == "passport_number":
        hits = []
        for c in top:
            for w in c["words"]:
                s = re.sub(r"[^A-Z0-9]", "", w["t"].upper())
                v = parse_number(s) if len(s) == 8 else None
                if v and re.fullmatch(r"[A-Z]\d{7}", v):
                    hits.append((v, w["c"]))
        return (max(hits, key=lambda x: x[1])[0], 50) if hits else None
    if field == "birth_date":
        ds = sorted({parse_date(c["text"]) for c in top} - {None})
        return (ds[0], 55 if len(ds) >= 2 else 40) if ds else None   # tanggal paling lama = tanggal lahir
    return None


def _extract(gray, vname, L):
    cells = _cells(gray); W = gray.shape[1]; found, anchors = {}, 0
    L(f"Teks terbaca ({len(cells)} potongan) [{vname}]:")
    for c in sorted(cells, key=lambda c: (c["t"] // max(c["h"], 1), c["l"]))[:40]:
        L(f"   y={c['t']:<5} x={c['l']:<5} yakin={c['conf']:3.0f}  {c['text'][:70]}")
    for field in FIELDS:
        anch = sorted((c for c in cells if _anchor_score(c, field)), key=lambda c: -_anchor_score(c, field))
        L(f"Label {LABELS[field]}: " + (", ".join(f"'{c['text'][:35]}' (y={c['t']})" for c in anch[:3]) or "TIDAK ditemukan"))
        anchors += bool(anch)
        for a in anch:
            res = _read_value(gray, a, cells, field, L)
            if res and field == "passport_number" and _anchor_score(a, field) == 1 and not re.fullmatch(r"[A-Z]\d{7}", res[0]):
                res = None                                       # anchor longgar wajib berpola paspor RI
            if res:
                found[field] = res; L(f"   => {LABELS[field]} = {res[0]!r} (yakin {res[1]}%)"); break
    return found, anchors, cells


def read_passport(data):
    L = Log(); bgr = load_bgr(data); H0, W0 = bgr.shape[:2]
    found, all_cells, rot, g_ref = {}, [], None, None
    for vname, fn in VARIANTS:
        if time.time() - L.t0 > 40:
            L('Batas waktu tercapai, variasi pra-proses berikutnya dilewati'); break
        g0 = fn(bgr)
        if g_ref is None:
            L(f"Foto: {W0}x{H0}px, ketajaman {cv2.Laplacian(g0, cv2.CV_64F).var():.0f} (di bawah 40 = buram)")
        rots = [rot] if rot != None or g_ref is not None else [None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_180]
        best = None
        for r in rots:
            g, ang = deskew(g0 if r is None else cv2.rotate(g0, r))
            L(f"== Variasi '{vname}', putar={'0' if r is None else {cv2.ROTATE_90_CLOCKWISE: '90 searah', cv2.ROTATE_90_COUNTERCLOCKWISE: '90 berlawanan', cv2.ROTATE_180: '180'}[r]}, koreksi miring={ang:.1f} derajat ==")
            f, anchors, cells = _extract(g, vname, L)
            if best is None or (len(f), anchors) > (len(best[0]), best[2]):
                best = (f, g, anchors, cells, r)
            if len(f) == 3 or anchors >= 2:
                break
        f, g, _, cells, r = best
        if g_ref is None:
            g_ref, rot = g, r
        all_cells.append((cells, g.shape[0]))
        for k, v in f.items():
            if k in found and found[k][0] == v[0]:
                found[k] = (v[0], min(99, max(found[k][1], v[1]) + 5))    # dua variasi sepakat -> lebih yakin
            elif k not in found or v[1] > found[k][1]:
                found[k] = v
        if len(found) == 3 and all(v[1] >= 75 for v in found.values()):
            break
    for f_ in FIELDS:                                                # cadangan tanpa label
        if f_ not in found:
            for cells, H in all_cells:
                r_ = _no_label(cells, H, f_)
                if r_:
                    found[f_] = r_; L(f"Tanpa label: {LABELS[f_]} = {r_[0]!r} dari pola teks (kurang pasti, mohon periksa)"); break
    mrz = read_mrz(g_ref) if g_ref is not None else {}
    L("MRZ (baris kode di dasar halaman): " + (", ".join(f"{k}={v}" for k, v in mrz.items()) if mrz else "tidak terbaca / check digit tidak lolos"))
    result = {"name": "", "passport_number": "", "birth_date": ""}
    conf, source, notes = {}, {}, []
    for f in FIELDS:
        vis, m = found.get(f), mrz.get(f)
        if f != "name" and m and (not vis or vis[0] != m):         # MRZ lolos check digit -> lebih dapat dipercaya
            if vis:
                notes.append(f); L(f"{LABELS[f]}: label membaca {vis[0]!r} tetapi MRZ {m!r} lolos check digit -> dipakai MRZ")
            result[f], conf[f], source[f] = m, 95, "mrz"
        elif vis:
            result[f], conf[f], source[f] = vis[0], vis[1], "label"
        elif m:
            result[f], conf[f], source[f] = m, 70, "mrz"
    L("HASIL: " + "; ".join(f"{LABELS[f]}={result[f]!r} ({source.get(f, '-')}, {conf.get(f, 0)}%)" for f in FIELDS) + f"  [{time.time() - L.t0:.1f} detik]")
    result.update(confidence=conf, source=source, conflict=notes, missing=[f for f in FIELDS if not result[f]],
                  blurry=bool(g_ref is not None and cv2.Laplacian(g_ref, cv2.CV_64F).var() < 40), log=L.lines)
    return result