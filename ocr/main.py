from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse
from pillow_heif import register_heif_opener
from reader import read_passport

app = FastAPI()
register_heif_opener()

@app.post("/ocr")
async def ocr(file: UploadFile):
    try:
        r = read_passport(await file.read())
    except Exception as e:
        return JSONResponse(status_code=422, content={"detail": "Gambar tidak bisa diproses. Gunakan foto JPG, PNG, atau HEIC.", "log": [f"Kesalahan: {type(e).__name__}: {e}"]})
    if len(r["missing"]) == 3:
        hint = " Foto terlihat buram, pastikan fokus dan tidak bergerak." if r["blurry"] else ""
        return JSONResponse(status_code=422, content={
            "detail": "Label dan data paspor tidak terbaca. Foto halaman data lurus dari atas, terang, tanpa pantulan cahaya." + hint, "log": r["log"]})
    return r