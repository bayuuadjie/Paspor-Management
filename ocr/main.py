import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile
from fastapi.responses import JSONResponse

from reader import read_passport

# OCR memakai CPU (Tesseract/OpenCV): satu foto diproses per worker, sisanya menunggu di antrean FIFO.
# Default 1 worker agar pemindaian dari banyak perangkat tidak saling berebut CPU; antrean dibatasi
# supaya foto tidak menumpuk tak terbatas bila server sedang sibuk.
WORKERS = max(1, min(4, int(os.getenv("OCR_WORKERS", "1"))))
QUEUE_SIZE = max(1, int(os.getenv("OCR_QUEUE_SIZE", "8")))
JOB_TIMEOUT = max(10, int(os.getenv("OCR_JOB_TIMEOUT", "70")))

queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
executor = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="ocr")
running = 0


async def worker():
    """Ambil jobs satu per satu, jalankan OCR di thread khusus agar event loop tetap bebas menerima request."""
    global running
    loop = asyncio.get_running_loop()
    while True:
        data, job = await queue.get()
        running += 1
        try:
            result = await loop.run_in_executor(executor, read_passport, data)
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
    }


@app.post("/ocr")
async def ocr(file: UploadFile):
    data = await file.read()
    if len(data) > 10_000_000:
        return JSONResponse(status_code=413, content={"detail": "Ukuran gambar maksimal 10 MB."})

    job = asyncio.get_running_loop().create_future()
    try:
        queue.put_nowait((data, job))
    except asyncio.QueueFull:
        return JSONResponse(
            status_code=503,
            content={"detail": "Antrean OCR penuh karena banyak pemindaian bersamaan. Coba lagi beberapa detik."},
        )

    try:
        r = await asyncio.wait_for(job, timeout=JOB_TIMEOUT)
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=504,
            content={"detail": "Pemindaian terlalu lama. Coba foto ulang dengan cahaya yang cukup dan tidak bergerak."},
        )
    except Exception as e:
        return JSONResponse(
            status_code=422,
            content={"detail": "Gambar tidak bisa diproses. Gunakan foto JPG atau PNG.", "log": [f"Kesalahan: {type(e).__name__}: {e}"]},
        )

    if len(r["missing"]) == 3:
        hint = " Foto terlihat buram, pastikan fokus dan tidak bergerak." if r["blurry"] else ""
        return JSONResponse(status_code=422, content={
            "detail": "Label dan data paspor tidak terbaca. Foto halaman data lurus dari atas, terang, tanpa pantulan cahaya." + hint,
            "log": r["log"],
            "mrz_preview": r.get("mrz_preview"),
        })
    return r
