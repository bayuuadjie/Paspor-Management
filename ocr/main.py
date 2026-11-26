import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, UploadFile
from fastapi.responses import JSONResponse

from reader import read_passport
from visabio import read_visabio

# OCR memakai CPU (Tesseract/OpenCV): tiap worker memproses satu foto, sisanya menunggu di antrean FIFO.
# Job yang dibatalkan klien dibuang dari antrean agar tidak menyisakan kerja yatim yang membuat
# pemindaian berikutnya terasa "ramai" padahal tidak ada scan aktif.
WORKERS = max(1, min(4, int(os.getenv("OCR_WORKERS", "2"))))
QUEUE_SIZE = max(4, int(os.getenv("OCR_QUEUE_SIZE", "32")))
JOB_TIMEOUT = max(10, int(os.getenv("OCR_JOB_TIMEOUT", "70")))

queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
executor = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="ocr")
jobs: dict[str, asyncio.Future] = {}  # jobId yang masih mengantre, bisa dibatalkan
running = 0


async def worker():
    """Ambil jobs satu per satu, jalankan OCR di thread khusus agar event loop tetap bebas menerima request."""
    global running
    loop = asyncio.get_running_loop()
    while True:
        data, job, fn, job_id = await queue.get()
        jobs.pop(job_id, None)  # sudah diambil worker: tidak bisa dibatalkan lagi
        started = False
        try:
            if job.done():
                continue  # job dibatalkan klien saat masih antre -> lewati, jangan buang CPU
            started = True
            running += 1
            result = await loop.run_in_executor(executor, fn, data)
            if not job.done():
                job.set_result(result)
        except asyncio.CancelledError:
            if not job.done():
                job.cancel()
            raise
        except Exception as e:
            if not job.done():
                job.set_exception(e)
        finally:
            if started:
                running -= 1
            queue.task_done()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tasks = [asyncio.create_task(worker()) for _ in range(WORKERS)]
    yield
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(lifespan=lifespan)


@app.get("/ocr/status")
async def status():
    """Pantau antrean: GET /ocr/status (dipakai untuk cek kondisi layanan)."""
    return {
        "workers": WORKERS,
        "running": running,
        "queued": max(0, queue.qsize() - running),
        "queue_size": QUEUE_SIZE,
        "cancellable": len(jobs),
    }


async def enqueue(data, fn, job_id):
    """Jalankan fungsi OCR di antrean bersama; hasilnya dict atau JSONResponse error."""
    job = asyncio.get_running_loop().create_future()
    if job_id:
        jobs[job_id] = job
    try:
        queue.put_nowait((data, job, fn, job_id))
    except asyncio.QueueFull:
        jobs.pop(job_id, None)
        return JSONResponse(
            status_code=503,
            content={"detail": "Antrean OCR penuh karena banyak pemindaian bersamaan. Coba lagi beberapa detik.", "code": "OCR_QUEUE_FULL"},
        )

    try:
        return await asyncio.wait_for(job, timeout=JOB_TIMEOUT)
    except asyncio.TimeoutError:
        jobs.pop(job_id, None)
        return JSONResponse(
            status_code=504,
            content={"detail": "Pemindaian terlalu lama. Coba foto ulang dengan cahaya yang cukup dan tidak bergerak."},
        )
    except asyncio.CancelledError:
        jobs.pop(job_id, None)
        return JSONResponse(status_code=200, content={"cancelled": True})
    except Exception as e:
        jobs.pop(job_id, None)
        return JSONResponse(
            status_code=422,
            content={"detail": "Gambar tidak bisa diproses. Gunakan foto JPG atau PNG.", "log": [f"Kesalahan: {type(e).__name__}: {e}"]},
        )


@app.post("/ocr/cancel")
async def cancel_ocr(x_ocr_job_id: str | None = Header(default=None, alias="X-OCR-Job-ID")):
    """Batalkan job yang masih mengantre (job yang sedang diproses tidak bisa dihentikan)."""
    job = jobs.pop(x_ocr_job_id, None) if x_ocr_job_id else None
    if job is not None and not job.done():
        job.cancel()
        return {"cancelled": True}
    return {"cancelled": False}


def _guard_size(data):
    return None if len(data) <= 10_000_000 else JSONResponse(
        status_code=413, content={"detail": "Ukuran gambar maksimal 10 MB."}
    )


@app.post("/ocr")
async def ocr(file: UploadFile, x_ocr_job_id: str | None = Header(default=None, alias="X-OCR-Job-ID")):
    data = await file.read()
    if (err := _guard_size(data)) is not None:
        return err

    r = await enqueue(data, read_passport, x_ocr_job_id)
    if isinstance(r, JSONResponse):
        return r
    if len(r["missing"]) == 3:
        hint = " Foto terlihat buram, pastikan fokus dan tidak bergerak." if r["blurry"] else ""
        return JSONResponse(status_code=422, content={
            "detail": "Label dan data paspor tidak terbaca. Foto halaman data lurus dari atas, terang, tanpa pantulan cahaya." + hint,
            "log": r["log"],
            "mrz_preview": r.get("mrz_preview"),
        })
    return r


@app.post("/ocr/visabio")
async def ocr_visabio(file: UploadFile, x_ocr_job_id: str | None = Header(default=None, alias="X-OCR-Job-ID")):
    """Baca nomor paspor dari kertas visabio untuk dipakai sebagai kata kunci pencarian."""
    data = await file.read()
    if (err := _guard_size(data)) is not None:
        return err

    r = await enqueue(data, read_visabio, x_ocr_job_id)
    if isinstance(r, JSONResponse):
        return r
    if not r["passport_number"]:
        return JSONResponse(status_code=422, content={
            "detail": "Nomor paspor tidak terbaca. Foto kertas visabio lurus dari atas dan pastikan tulisan 'Passport Number' beserta nomornya terang.",
            "text": r.get("text", ""),
            "log": r.get("log", []),
        })
    return r
