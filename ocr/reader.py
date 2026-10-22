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
STRONG_LABELS = ("KODE", "NEGARA", "JENIS", "TYPE", "KEWARGANEGARAAN", "NATIONALITY", "PASPOR", "PASSPORT", "COUNTRY", "CODE", "LENGKAP",
                 "KELAMIN", "TEMPAT", "LAHIR", "PLACE", "BIRTH", "DATE", "ISSUE", "EXPIRY", "BERLAKU", "HABIS", "PENGELUARAN", "KANTOR",
                 "MENGELUARKAN", "ISSUING", "OFFICE", "FULL", "NAME", "NAMA", "REPUBLIK", "INDONESIA")
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
    if any(len(w) >= 4 and any(SequenceMatcher(None, w, sl).ratio() >= 0.8 for sl in STRONG_LABELS) for w in toks) or any(w in NOT_NAMES for w in toks) or (toks and sum(len(w) > 3 and _is_label_word(w) for w in toks) / len(toks) > 0.5):
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


# ---------------------------------------------------------------- MRZ (pembanding, ber-check digit)
def _tess_str(img, cfg, timeout=8):
    try:
        return pytesseract.image_to_string(img, lang="eng", config=cfg, timeout=timeout)
    except RuntimeError:                                  # melewati batas waktu (gambar terlalu penuh motif)
        return ""


def _cd(s):
    w, v = (7, 3, 1), 0
    for i, c in enumerate(s):
        n = int(c) if c.isdigit() else (ord(c) - 55 if c.isalpha() else 0)
        v += n * w[i % 3]
    return v % 10


def _parse_pair(l1, l2):
    l1, l2 = (l1 + "<" * 44)[:44], (l2 + "<" * 44)[:44]
    out = {}
    m_ = re.search(r"[I1L|]DN", l2[9:16])         # patokan kode negara: bila ada karakter sisipan/hilang, posisi ikut bergeser
    p = 9 + m_.start() if m_ else 10
    for s in dict.fromkeys((0, p - 10)):
        if s < 0:
            continue
        raw, cdc = l2[s:s + 9], l2[s + 9].translate(TO_DIGIT)
        for cand in (raw, raw[0].translate(TO_LETTER) + raw[1:].translate(TO_DIGIT)):
            num = cand.replace("<", "")
            if cdc.isdigit() and _cd(cand) == int(cdc) and re.fullmatch(r"[A-Z]\d{7}", num):
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
    if out and l1.startswith("P"):
        parts = [x.replace("<", " ").strip() for x in l1[5:].split("<<") if x.strip("<")]
        if parts:
            nm = parse_name(f"{parts[1]} {parts[0]}" if len(parts) > 1 else parts[0])
            if nm:
                out["name"] = nm
    return out


def read_mrz(flat, L):
    """Baca 2 baris MRZ dari beberapa variasi gambar; hanya hasil yang lolos check digit yang dipakai."""
    H, W = flat.shape
    otsu = lambda c: cv2.threshold(c, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    if H < 0.3 * W:                                   # foto yang hanya berisi baris MRZ
        tries = (("rata, seluruh gambar", lambda c: c, 0.0), ("otsu, seluruh gambar", otsu, 0.0), ("goresan, seluruh gambar", lambda c: strokes(c, 3), 0.0))
    else:                                             # MRZ ada di sekitar 12-20% tinggi halaman paling bawah
        tries = (("rata, 20% bawah", lambda c: c, 0.80), ("otsu, 20% bawah", otsu, 0.80), ("rata, 30% bawah", lambda c: c, 0.70),
                 ("otsu, 30% bawah", otsu, 0.70), ("goresan halus, 20% bawah", lambda c: strokes(c, 2), 0.80))
    for name, fn, frac in tries:
        if L.left() < 8:
            break
        crop = fn(flat[int(H * frac):, :])
        k = min(2.0, 2400 / W) if W < 2400 else 1.0
        crop = cv2.copyMakeBorder(cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC), 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
        txt = _tess_str(crop, "--oem 1 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")
        lines = [re.sub(r"[^A-Z0-9<]", "", l.upper()) for l in txt.splitlines()]
        lines = [l for l in lines if len(l) >= 30]
        L(f"MRZ [{name}]: " + (" | ".join(l[:46] for l in lines[-3:]) if lines else "tidak ada baris >= 30 karakter"))
        for i in range(len(lines) - 1, -1, -1):
            out = _parse_pair(lines[i - 1] if i else "", lines[i])
            if out.get("passport_number") or out.get("birth_date"):
                L("   MRZ lolos check digit: " + ", ".join(f"{k_}={v}" for k_, v in out.items()))
                return out
    return {}


# ---------------------------------------------------------------- OCR + tata letak
class Log:
    """Catatan proses OCR yang ditampilkan di layar (tidak ditulis ke log server karena memuat data pribadi)."""
    def __init__(self):
        self.lines, self.t0 = [], time.time()

    def __call__(self, *a):
        self.lines.append(" ".join(str(x) for x in a))

    def left(self):
        return 55 - (time.time() - self.t0)


LABELS = {"name": "Nama Lengkap", "passport_number": "No. Paspor", "birth_date": "Tgl. Lahir"}
ROTS = (None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_180)
STRICT = r"[A-Z]\d{7}"


def load_bgr(data):
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    a = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w = a.shape[:2]
    k = min(3.0, 2400 / max(h, w))
    return cv2.resize(a, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)


def _flat(ch):
    """Ratakan pencahayaan: bagi dengan estimasi latar (menghapus bayangan dan gradasi)."""
    return cv2.divide(ch, cv2.medianBlur(cv2.dilate(ch, np.ones((7, 7), np.uint8)), 61), scale=255)


def strokes(flat, k=None):
    """Pertahankan hanya goresan TEBAL (huruf cetak 4-5 px). Garis guilloche/mikroteks 1-2 px terhapus oleh 'opening'.
    Hasil: hitam di atas putih."""
    sub = flat[flat < 200].reshape(-1, 1)                 # hanya piksel yang lebih gelap dari kertas
    t = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] if sub.size > 500 else 90
    bw = (flat < float(np.clip(t, 50, 115))).astype(np.uint8) * 255   # ambang di pemisah huruf hitam vs garis nada-tengah
    op = lambda kk: cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kk, kk)))
    if k is None:                                           # motif sangat padat -> hapus lebih agresif
        out = op(3)
        out = op(5) if (out > 0).mean() > 0.035 else out
        return 255 - out
    return 255 - op(k)


def deskew(gray):
    """Luruskan foto yang miring (+-8 derajat). Sudut dihitung dari HURUF TEBAL saja (garis guilloche bergelombang
    akan menyesatkan jika ikut dihitung)."""
    mask = 255 - strokes(gray)                       # huruf = 255
    k = 800 / gray.shape[1]
    small = cv2.resize(mask, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    h, w = small.shape; best, best_s = 0.0, -1.0
    for a in np.arange(-8, 8.01, 0.25):
        r = cv2.warpAffine(small, cv2.getRotationMatrix2D((w / 2, h / 2), a, 1), (w, h))
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


def _cells(gray, timeout=20):
    try:
        d = pytesseract.image_to_data(gray, lang="eng", config="--oem 1 --psm 11", output_type=Output.DICT, timeout=timeout)
    except RuntimeError:
        return []
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


def _dump(L, title, cells, limit=45):
    good = sorted((c for c in cells if c["conf"] >= 35 and sum(ch.isalnum() for ch in c["text"]) >= 2), key=lambda c: (c["t"], c["l"]))
    L(f"{title}: {len(cells)} potongan ({len(good)} cukup jelas)")
    for c in good[:limit]:
        L(f"   y={c['t']:<5} x={c['l']:<5} yakin={c['conf']:3.0f}  {c['text'][:70]}")


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


def _is_nat(cell):
    return any(SequenceMatcher(None, _norm(w["t"]), "INDONESIA").ratio() >= 0.75 for w in cell["words"] if len(_norm(w["t"])) >= 6) \
        or any(_norm(w["t"]) == "WNI" for w in cell["words"])


def _cy(c):
    return (c["t"] + c["b"]) / 2


def _refine(imgs, box, field, multiline=False):
    """Baca ulang satu area dari beberapa gambar (goresan tebal, ratakan+Otsu, ratakan+adaptif); berhenti bila dua hasil sepakat."""
    l, t, r, b, h = (int(v) for v in box)
    pad = int(h * 0.4); k = float(np.clip(70 / max(h, 1), 1, 4))
    wl = WHITELIST[field]
    cfg = f"--oem 1 --psm {6 if multiline else 7}" + (f' -c tessedit_char_whitelist="{wl}"' if wl else "")
    good, raw = [], []
    for kind, img in imgs:
        H, W = img.shape
        crop = img[max(0, t - pad):min(H, b + pad), max(0, l - pad):min(W, r + pad)]
        if crop.size == 0 or min(crop.shape) < 8:
            continue
        crop = cv2.copyMakeBorder(cv2.resize(crop, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC), 24, 24, 24, 24, cv2.BORDER_REPLICATE)
        if kind == "otsu":
            crop = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        elif kind == "adaptif":
            crop = cv2.adaptiveThreshold(crop, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 41, 12)
        elif kind == "tebal":
            crop = cv2.threshold(crop, 127, 255, cv2.THRESH_BINARY)[1]
        txt = _tess_str(crop, cfg).strip()
        raw.append(" / ".join(x.strip() for x in txt.splitlines() if x.strip()))
        for line in (txt.splitlines() if multiline else [txt]):
            val = PARSERS[field](line)
            if val:
                good.append(val); break
        if len(good) >= 2 and good[-1] == good[-2]:
            break
    return good, raw


def _vote(base, refined, field):
    pool = list(refined)
    if base and (len(pool) < 2 or SequenceMatcher(None, base, max(pool, key=lambda c: sum(SequenceMatcher(None, c, o).ratio() for o in pool))).ratio() >= 0.8):
        pool = [base, base] + pool                      # hasil pass 1 diberi 2 suara, kecuali jelas rusak/terpotong
    if not pool:
        return None, 0
    if field == "passport_number" and any(re.fullmatch(STRICT, x) for x in pool):
        pool = [x for x in pool if re.fullmatch(STRICT, x)]   # utamakan pola paspor RI
    sc = lambda c: sum(SequenceMatcher(None, c, o).ratio() for o in pool)
    best = max(dict.fromkeys(pool), key=sc)
    if field == "name":
        best = max((c for c in dict.fromkeys(pool) if SequenceMatcher(None, best, c).ratio() >= 0.9), key=len)
    return best, round(100 * sc(best) / len(pool))


def _read_value(imgs, a, vcells, lcells, field, L, max_rows=3):
    """Cari nilai di bawah anchor `a`. Kandidat diambil dari `vcells` (potongan teks pada gambar goresan tebal)."""
    W = imgs[0][1].shape[1]; tol = max(3 * a["h"], 0.025 * W); max_dy = max(7 * a["h"], 0.06 * W)
    right = min([x["l"] for x in lcells if x is not a and _label_ish(x) and abs(x["t"] - a["t"]) < 1.5 * a["h"] and x["l"] > a["r"]], default=W)
    below = sorted((c for c in vcells if c is not a and c["t"] >= a["t"] + 0.6 * a["h"] and c["t"] - a["b"] <= max_dy
                    and abs(c["l"] - a["l"]) <= tol and sum(ch.isalnum() for ch in c["text"]) >= 2), key=lambda c: c["t"])
    rows = []
    for c in below:                                              # kelompokkan potongan yang sebaris
        if not rows or abs(_cy(rows[-1][0]) - _cy(c)) > 0.6 * max(c["h"], rows[-1][0]["h"]):
            rows.append([c])
        else:
            rows[-1].append(c)
    results = []
    for row in rows[:max_rows]:
        members = [x for x in vcells if abs(_cy(x) - _cy(row[0])) < 0.6 * max(x["h"], row[0]["h"]) and a["l"] - tol <= x["l"] < right]
        text = " ".join(x["text"] for x in sorted(members, key=lambda x: x["l"]))
        h = sorted(x["h"] for x in members)[len(members) // 2]
        box = (a["l"] - tol, min(x["t"] for x in members), min(right, max(x["r"] for x in members) + 3 * h), max(x["b"] for x in members), h)
        if results and not (field == "name" and 0 <= box[1] - results[-1][2][3] < results[-1][2][4] and abs(h - results[-1][2][4]) < 0.4 * results[-1][2][4]):
            break                                        # bukan lanjutan nama (terlalu jauh / beda ukuran)
        base = PARSERS[field](text)
        if not base and not (field == "name" or any(ch.isdigit() for ch in text)):
            continue                                     # baris tanpa isi yang relevan
        mconf = sum(x["conf"] for x in members) / len(members)
        if base and mconf >= 93 and (field != "passport_number" or re.fullmatch(STRICT, base)):
            good, raw = [], ["(dilewati: pass 1 sudah sangat yakin)"]
        else:
            good, raw = _refine(imgs, box, field)
        L(f"   kandidat baris: {text[:60]!r} -> pass1={base!r}; baca ulang={raw}")
        val, agree = _vote(base, good, field)
        if val:
            results.append((val, round(0.5 * mconf + 0.5 * agree), box, row))
            if field != "name":
                break
        elif results and field == "name":
            break
    if not results:                                              # cadangan: baca langsung area di bawah anchor
        box = (a["l"] - tol, a["b"] + 0.2 * a["h"], right, a["b"] + 3.2 * a["h"] * 1.6, int(a["h"] * 1.6))
        good, raw = _refine(imgs, tuple(int(v) for v in box), field, multiline=True)
        L(f"   area bawah anchor dibaca langsung: {raw}")
        val, agree = _vote(None, good, field)
        if val:
            results.append((val, min(agree, 70), box, []))
    if not results:
        return None
    value = " ".join(r[0] for r in results) if field == "name" else results[0][0]
    return value, min(r[1] for r in results)


def _pseudo(cell, field):
    """Anchor buatan dari posisi kata 'INDONESIA' (nilai kewarganegaraan): nama ada di atasnya, tanggal lahir di bawahnya."""
    h = cell["h"]
    if field == "name":
        t = cell["t"] - 5.5 * h
        return dict(words=[], text="(di atas kewarganegaraan)", l=cell["l"], t=t, b=t + h, r=cell["r"], h=h, conf=0)
    return dict(words=[], text="(di bawah kewarganegaraan)", l=cell["l"], t=cell["b"], b=cell["b"] + 1, r=cell["r"], h=h, conf=0)


def _no_label(cells, H, field):
    """Cadangan tanpa label: cari pola nilai di seluruh halaman (di atas area MRZ)."""
    top = [c for c in cells if c["t"] < 0.78 * H and "<" not in c["text"]]
    if field == "passport_number":
        hits = []
        for c in top:
            for w in c["words"]:
                s = re.sub(r"[^A-Z0-9]", "", w["t"].upper())
                v = parse_number(s) if len(s) == 8 else None
                if v and re.fullmatch(STRICT, v):
                    hits.append((v, w["c"]))
        return (max(hits, key=lambda x: x[1])[0], 50) if hits else None
    if field == "birth_date":
        ds = sorted({parse_date(c["text"]) for c in top} - {None})
        for a_ in ds:                                    # paspor berlaku 5/10 tahun: pasangan terbit-kadaluarsa bukan tanggal lahir
            for b_ in ds:
                da, db = date.fromisoformat(a_), date.fromisoformat(b_)
                if 0 < (db - da).days and any(abs((db - da).days - y * 365.25) <= 4 for y in (5, 10)):
                    ds = [d for d in ds if d not in (a_, b_)]
        return (ds[0], 55 if len(ds) >= 2 else 40) if ds else None   # sisanya: tanggal paling lama = tanggal lahir
    return None


def _aligned(bgr, rot, ang):
    """Kanal warna lain (luma, minimum RGB, hijau) dengan orientasi + koreksi miring yang sama seperti gambar utama."""
    b = bgr if rot is None else cv2.rotate(bgr, rot)
    out = {}
    for name, c in (("luma", cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)), ("min", b.min(axis=2)), ("hijau", b[:, :, 1])):
        f = _flat(c)
        if abs(ang) >= 0.4:
            f = cv2.warpAffine(f, cv2.getRotationMatrix2D((f.shape[1] / 2, f.shape[0] / 2), ang, 1), (f.shape[1], f.shape[0]), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        out[name] = f
    return out


def _strict_token(t):
    """Nomor paspor RI hanya diterima sebagai SATU kata utuh (1 huruf + 7 angka); tidak pernah dirangkai dari potongan acak."""
    toks = re.findall(r"[A-Z0-9]+", t.upper())
    cands = [tok for tok in toks if len(tok) == 8] + [a_ + b_ for a_, b_ in zip(toks, toks[1:]) if len(a_) == 1 and len(b_) == 7]
    for c in cands:
        f = c[0].translate(TO_LETTER) + c[1:].translate(TO_DIGIT)
        if re.fullmatch(STRICT, f):
            return f
    return None


def _text_lines(mask, min_h=18, max_h=170):
    """Pisahkan baris teks dari profil kepadatan goresan (mask: huruf=255)."""
    prof = np.convolve((mask > 0).sum(axis=1).astype(np.float32), np.ones(7) / 7, mode="same")
    thr = max(0.22 * float(prof.max()), 8.0)
    runs, start = [], None
    for y, v in enumerate(prof):
        if v >= thr and start is None:
            start = y
        elif v < thr and start is not None:
            runs.append([start, y]); start = None
    if start is not None:
        runs.append([start, len(prof)])
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 8:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [(a_, b_) for a_, b_ in merged if min_h <= b_ - a_ <= max_h]


def _number_roi(chans, shape, cellsL, a_name, L):
    """Nomor paspor yang dicetak dengan tinta berwarna/terang hilang di kanal V. Cari di pita atas-kanan memakai kanal lain,
    baris demi baris (tiap baris teks tebal dibaca terpisah)."""
    H, W = shape
    kw = ("COUNTRY", "CODE", "KODE", "NEGARA", "JENIS", "TYPE")
    tops = [c for c in cellsL if c["t"] < 0.4 * H and any(len(_norm(w["t"])) >= 4 and any(SequenceMatcher(None, _norm(w["t"]), k).ratio() >= 0.8 for k in kw) for w in c["words"])]
    y_top = min((c["t"] for c in tops), default=int(0.11 * H))
    y0 = int(y_top + 0.012 * H)
    y1 = int(a_name["t"] - 4) if a_name is not None else int(y_top + 0.19 * H)
    y1 = min(max(y1, y0 + int(0.06 * H)), y0 + int(0.2 * H))
    x0 = int(0.40 * W)
    L(f"Nomor paspor tidak terbaca lewat kanal V -> mencari baris teks di pita atas-kanan (y={y0}-{y1}, x>={x0}) dengan kanal warna lain")
    found = []
    for name, ch in chans.items():
        crop = ch[y0:y1, x0:]
        if crop.size == 0 or min(crop.shape) < 20:
            continue
        crop = cv2.copyMakeBorder(cv2.resize(crop, None, fx=2.5, fy=2.5, interpolation=cv2.INTER_CUBIC), 20, 20, 20, 20, cv2.BORDER_REPLICATE)
        sub = crop[crop < 200].reshape(-1, 1)
        t1 = cv2.threshold(sub, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] if sub.size > 500 else 90
        sub2 = crop[crop < t1].reshape(-1, 1)             # tingkat kedua: pisahkan tinta paling gelap dari garis motif nada-tengah
        t2 = cv2.threshold(sub2, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] if sub2.size > 300 else t1
        for tname, thr in (("gelap", float(np.clip(t2, 30, 100))), ("sedang", float(np.clip(t1, 40, 115)))):
            bw = ((crop < thr).astype(np.uint8)) * 255
            thick_mask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
            lines = _text_lines(thick_mask, 45, 150)           # tinggi huruf nilai (skala 2,5x): bukan label kecil, bukan blok besar
            L(f"   {name}/{tname} (ambang {thr:.0f}): {len(lines)} baris teks tebal")
            for (ya, yb) in lines[:4]:
                cols = np.where((thick_mask[max(0, ya - 6):yb + 6] > 0).sum(axis=0) > 0)[0]
                segs, start, prev = [], None, None
                for c_ in cols:                                  # pecah baris menjadi kata (celah > 70 px), mis. "IDN" terpisah dari nomor
                    if start is None:
                        start = prev = c_
                    elif c_ - prev > 70:
                        segs.append((start, prev)); start = prev = c_
                    else:
                        prev = c_
                if start is not None:
                    segs.append((start, prev))
                segs = [s_ for s_ in segs if s_[1] - s_[0] >= 150] or [(0, thick_mask.shape[1] - 1)]
                for (xa, xb) in segs[:3]:
                    for kind, img in (("tebal", 255 - thick_mask), ("ambang", 255 - bw)):
                        seg = cv2.copyMakeBorder(img[max(0, ya - 14):yb + 14, max(0, xa - 16):xb + 16], 14, 14, 14, 14, cv2.BORDER_CONSTANT, value=255)
                        txt = _tess_str(seg, '--oem 1 --psm 7 -c tessedit_char_whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"', timeout=6).strip()
                        val = _strict_token(txt)
                        if txt:
                            L(f"      {name}/{tname}/{kind} y={ya}-{yb} x={xa}-{xb}: {txt[:40]!r} -> {val!r}")
                        if val:
                            found.append(val)
                    if len(found) >= 6:
                        break
            if len(found) >= 2 and found[-1] == found[-2]:
                break
        if (len(found) >= 2 and found[-1] == found[-2]) or L.left() < 10:
            break
    if not found:
        return None
    cons = "".join(max(set(col), key=col.count) for col in zip(*found))   # suara terbanyak per posisi karakter
    agree = sum(f == cons for f in found)
    L(f"   bacaan terkumpul ({len(found)}): {found} -> konsensus {cons!r} ({agree} identik)")
    return cons, (70 if len(found) >= 3 and agree == len(found) else 55)   # tanpa check digit: selalu perlu diperiksa


def _markers(cells):
    return sum(_is_nat(c) for c in cells[:400]) + sum(1 for c in cells if any(re.fullmatch(STRICT, re.sub(r"[^A-Z0-9]", "", w["t"].upper())) for w in c["words"]))


def read_passport(data):
    L = Log(); bgr = load_bgr(data); H0, W0 = bgr.shape[:2]
    flat0 = _flat(bgr.max(axis=2))       # kanal V (nilai tertinggi R/G/B) + ratakan pencahayaan: motif berwarna hilang
    L(f"Foto: {W0}x{H0}px, ketajaman {cv2.Laplacian(flat0, cv2.CV_64F).var():.0f} (di bawah 40 = buram)")
    # --- 1) gambar goresan tebal + orientasi
    best = None
    for r in ROTS:
        g, ang = deskew(flat0 if r is None else cv2.rotate(flat0, r))
        T = strokes(g)
        cellsT = _cells(T); m = _markers(cellsT)
        L(f"== Putar={'0' if r is None else {cv2.ROTATE_90_CLOCKWISE: '90 searah', cv2.ROTATE_90_COUNTERCLOCKWISE: '90 berlawanan', cv2.ROTATE_180: '180'}[r]}, koreksi miring={ang:.1f} derajat, penanda halaman={m} ==")
        if best is None or m > best[0]:
            best = (m, g, T, cellsT, r, ang)
        if m >= 1 or L.left() < 40:
            break
    _, g, T, cellsT, rot, angle = best
    _dump(L, "Teks tebal (huruf cetak, motif dihapus)", cellsT)
    T3 = strokes(g, 3)                                                # lebih lembut: huruf tipis (I, label kecil) tetap ada
    imgs = [("tebal", T)] + ([("tebal", T3)] if not np.array_equal(T, T3) else []) + [("otsu", g), ("adaptif", g)]
    cands = {f: [] for f in FIELDS}                                   # (nilai, yakin, metode)
    # --- 2) label (gambar ratakan) -> anchor; nilai diambil dari teks tebal
    name_anchor = None
    cellsL = _cells(g, 14) if L.left() > 15 else []     # batas 14 detik: gambar sangat penuh motif tidak boleh menahan proses
    _dump(L, "Teks dengan label (ratakan)", cellsL, 30)
    for field in FIELDS:
        anch = sorted((c for c in cellsL if _anchor_score(c, field)), key=lambda c: -_anchor_score(c, field))
        L(f"Label {LABELS[field]}: " + (", ".join(f"'{c['text'][:35]}' (y={c['t']})" for c in anch[:3]) or "TIDAK ditemukan"))
        if field == "name" and anch:
            name_anchor = anch[0]
        for a in anch[:2]:
            res = _read_value(imgs, a, cellsT, cellsL, field, L)
            if res and field == "passport_number" and _anchor_score(a, field) == 1 and not re.fullmatch(STRICT, res[0]):
                res = None
            if res:
                cands[field].append((res[0], res[1], "label")); L(f"   => {LABELS[field]} = {res[0]!r} (yakin {res[1]}%) lewat label"); break
    # --- 3) struktur halaman: kata INDONESIA (kewarganegaraan) sebagai patokan
    nats = [c for c in cellsT if _is_nat(c)]
    if nats and any(f in ("name", "birth_date") and not cands[f] for f in FIELDS):
        n = max(nats, key=lambda c: c["conf"]); L(f"Patokan struktur: 'INDONESIA' di y={n['t']}, x={n['l']}")
        for field in ("name", "birth_date"):
            if not cands[field]:
                res = _read_value(imgs, _pseudo(n, field), cellsT, cellsL, field, L, max_rows=1 if field == "birth_date" else 3)
                if res:
                    cands[field].append((res[0], min(res[1], 75), "struktur")); L(f"   => {LABELS[field]} = {res[0]!r} (yakin {min(res[1], 75)}%) lewat struktur halaman")
    # --- 4) pola teks di seluruh halaman
    for field in ("passport_number", "birth_date"):
        if not cands[field]:
            r_ = _no_label(cellsT, T.shape[0], field) or _no_label(cellsL, T.shape[0], field)
            if r_:
                cands[field].append((r_[0], r_[1], "pola")); L(f"Tanpa label: {LABELS[field]} = {r_[0]!r} dari pola teks (kurang pasti, mohon periksa)")
    # --- 4a) MRZ (check digit) dibaca lebih dulu: bila nomor paspor terverifikasi, pencarian lain tidak perlu
    mrz = read_mrz(g, L) if L.left() > 5 else {}
    # --- 4b) nomor paspor bertinta berwarna: cari lewat kanal warna lain
    if not mrz.get("passport_number") and (not cands["passport_number"] or max(c[1] for c in cands["passport_number"]) < 75) and L.left() > 12:
        r_ = _number_roi(_aligned(bgr, rot, angle), T.shape, cellsL, name_anchor, L)
        if r_:
            cands["passport_number"].append((r_[0], r_[1], "kanal-warna")); L(f"   => No. Paspor = {r_[0]!r} (yakin {r_[1]}%) lewat kanal warna lain")
    # --- 5) gabungkan semua sumber
    result = {"name": "", "passport_number": "", "birth_date": ""}
    conf, source, notes = {}, {}, []
    for f in FIELDS:
        vis = max(cands[f], key=lambda x: x[1]) if cands[f] else None
        m = mrz.get(f)
        if f == "name" and m and vis and vis[1] < 80 and SequenceMatcher(None, vis[0], m).ratio() < 0.5:
            L(f"Nama visual {vis[0]!r} jelas rusak (tidak mirip MRZ {m!r}) -> dipakai nama dari MRZ"); vis = None
        if f != "name" and m and (not vis or vis[0] != m):             # MRZ lolos check digit -> lebih dapat dipercaya
            if vis:
                notes.append(f); L(f"{LABELS[f]}: {vis[2]} membaca {vis[0]!r} tetapi MRZ {m!r} lolos check digit -> dipakai MRZ")
            result[f], conf[f], source[f] = m, 95, "mrz"
        elif vis:
            same = (f != "name" and m == vis[0])
            result[f], conf[f], source[f] = vis[0], (max(vis[1], 95) if same else vis[1]), (vis[2] + "+mrz" if same else vis[2])
        elif m:
            result[f], conf[f], source[f] = m, 70, "mrz"
    # Nama tidak punya check digit: hanya dianggap yakin bila cocok dengan nama di MRZ; selain itu keyakinan diturunkan
    if result["name"] and source.get("name") != "mrz":
        mn = mrz.get("name")
        if mn and mn == result["name"]:
            conf["name"] = max(conf["name"], 95)
        elif mn and SequenceMatcher(None, result["name"], mn).ratio() >= 0.8:
            conf["name"] = min(conf["name"], 60)
            L(f"Nama berbeda sedikit: label {result['name']!r} vs MRZ {mn!r} -> mohon periksa huruf demi huruf")
        else:
            conf["name"] = max(0, conf["name"] - 15)
    if result["name"] and source.get("name") != "mrz":
        toks = result["name"].split(); short = sum(len(t) <= 2 for t in toks) / len(toks)
        if conf["name"] < 35 or (short >= 0.5 and conf["name"] < 60):
            L(f"Nama {result['name']!r} tidak masuk akal (keyakinan {conf['name']}%) -> dikosongkan, mohon isi manual")
            result["name"] = ""; conf.pop("name", None); source.pop("name", None)
    L("HASIL: " + "; ".join(f"{LABELS[f]}={result[f]!r} ({source.get(f, '-')}, {conf.get(f, 0)}%)" for f in FIELDS) + f"  [{time.time() - L.t0:.1f} detik]")
    result.update(confidence=conf, source=source, conflict=notes, missing=[f for f in FIELDS if not result[f]],
                  blurry=bool(cv2.Laplacian(flat0, cv2.CV_64F).var() < 40), log=L.lines)
    return result