import io
import re
import time

import cv2
import numpy as np
from PIL import Image, ImageOps

from reader import Log, ROTS, _flat, _tess_str, deskew

# Nomor paspor dicetak tepat di sebelah label "Passport Number" pada kertas visabio.
# Pola utama mengikuti regex yang dipakai sebelumnya; dua pola lain menangani label
# yang ditulis sebagai "Passport No." / "No. Paspor".
LABELS = (
    r"passport\s*(?:number|no\.?|nr\.?|num)",
    r"no\.?\s*paspor",
    r"nomor\s*paspor",
)
TOKEN = r"([A-Z0-9]{5,12})(?![A-Z0-9])"


def _extract(text):
    """Ambil nomor paspor dari teks hasil OCR; None bila tidak ada yang cocok."""
    for label in LABELS:
        m = re.search(label + r"\s*:?\s*" + TOKEN, text, re.I)
        if m:
            return m.group(1).upper()

    # Cadangan: tulisan nomor kadang terpisah oleh spasi (mis. "C 1234567").
    for label in LABELS:
        m = re.search(label + r"\s*:?\s*", text, re.I)
        if not m:
            continue
        tail = text[m.end():].lstrip(" \t:-\n")
        token = re.match(r"[A-Z0-9][A-Z0-9 .-]{0,14}", tail, re.I)
        if token:
            value = re.sub(r"[^A-Z0-9]", "", token.group(0).upper())[:12]
            if 5 <= len(value) <= 12:
                return value
    return None


def read_visabio(data):
    """Baca nomor paspor dari foto kertas visabio. Gambar tidak disimpan."""
    L = Log()
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    k = min(2.0, 2400 / max(h, w))
    if k != 1:
        bgr = cv2.resize(bgr, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
    L(f"Foto visabio: {w}x{h}px")

    variants = []
    for rot in ROTS:
        oriented = bgr if rot is None else cv2.rotate(bgr, rot)
        gray = cv2.cvtColor(oriented, cv2.COLOR_BGR2GRAY)
        gray, ang = deskew(gray)
        flat = _flat(gray)
        otsu = cv2.threshold(flat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        name = "0" if rot is None else {cv2.ROTATE_90_CLOCKWISE: "90", cv2.ROTATE_90_COUNTERCLOCKWISE: "-90", cv2.ROTATE_180: "180"}[rot]
        variants.extend(((f"ratakan, {name}°", flat), (f"otsu, {name}°", otsu)))

    votes, texts = [], []
    for vname, variant in variants:
        for psm in (6, 11):
            txt = _tess_str(variant, f"--oem 1 --psm {psm}", timeout=8).strip()
            if not txt:
                continue
            texts.append(txt)
            value = _extract(txt)
            L(f"{vname}, psm {psm}: " + (f"nomor={value}" if value else "tidak ada label 'Passport Number'"))
            if value:
                votes.append(value)
            if len(votes) >= 2 and votes[-1] == votes[-2]:
                break
        if len(votes) >= 2 and votes[-1] == votes[-2]:
            break

    number = None
    if votes:
        counts = {}
        for v in votes:
            counts[v] = counts.get(v, 0) + 1
        number = max(counts, key=lambda v: (counts[v], votes.index(v)))
        L(f"Konsensus nomor paspor: {number} ({counts[number]} dari {len(votes)} bacaan)")

    preview = "\n".join(dict.fromkeys(texts))[:1200]
    return {
        "passport_number": number or "",
        "confidence": (100 if counts[number] >= 2 else 70) if number else 0,
        "text": preview,
        "log": L.lines,
        "elapsed": round(time.time() - L.t0, 1),
    }
