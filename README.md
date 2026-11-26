# Manajemen Paspor v2

Stack: React (Vite) + Node (Express) + PostgreSQL + Python (OCR Tesseract/PassportEye), semuanya dijalankan Docker.

## Setup
1. Pasang Docker.
2. `cd pasport_management`
3. `./setup.sh`  (menanyakan username & password admin; JWT_SECRET dan password database dibuat acak otomatis)
4. Buka https://localhost atau https://IP dan terima peringatan sertifikat.

## Perintah harian
- Hentikan: `docker compose down` | Nyalakan: `docker compose up -d`
- Log: `docker compose logs -f api` (atau `ocr`, `web`)
- Backup: `docker compose exec -T db pg_dump -U paspor paspor > backup.sql`
- Restore: `docker compose exec -T db psql -U paspor paspor < backup.sql`

## Pengurutan data
Hanya dua pilihan: **Nama** dan **Tanggal Ditambahkan**. Kolom lain (tanggal lahir, tanggal visabio, dll.) tidak bisa dipakai sebagai pengurutan, baik dari UI maupun lewat API.

## Import data paspor dari Excel
Tombol **Import Excel** di halaman Data Paspor menerima file `.xlsx`/`.xlsm` (maks. 10 MB). Header dicari otomatis di 30 baris pertama, jadi boleh ada judul di atas tabel.

Kolom yang dikenali: **No Porsi**, **Nama**, **Kecamatan**, **No. Paspor** (nama header boleh tanpa tanda titik, mis. `No Paspor`). Kolom **No**, **Alamat**, **Provinsi**, **Kab Kota**, **Usia**, **Kategori**, dan **Tahap** diabaikan.

Aturan baris:
- Baris dengan **Nama**, **No. Paspor**, atau **Kecamatan** kosong dilewati.
- Nomor paspor yang sudah terdaftar atau dobel di dalam file dilewati (huruf besar/kecil dianggap sama).
- Data baru disimpan dengan status visabio **belum**, tanggal visabio kosong, print visabio **belum**, paspor fisik **ada**.
- Kecamatan baru otomatis masuk ke master kecamatan sehingga bisa dipakai di filter.

Hasil import menampilkan jumlah baris berhasil, dilewati karena field wajib kosong, dan dilewati karena duplikat, lengkap dengan nomor baris yang bermasalah.

Agar nomor tidak berubah menjadi notasi ilmiah (mis. `1.23457E+11`), simpan kolom No. Paspor dan No Porsi sebagai teks atau angka dengan format penuh di Excel.

## OCR dari beberapa perangkat
- Satu akun hanya bisa aktif di satu perangkat (sesi akan ditolak dengan pesan "sedang aktif di perangkat lain"). Untuk scan dari beberapa perangkat, pakai akun berbeda.
- Di backend, satu akun hanya boleh punya satu scan berjalan; kiriman foto ulang yang bertumpuk ditolak (409) dan foto baru membatalkan scan lama di browser.
- Di service OCR, semua permintaan masuk **antrean FIFO** dan diproses bergiliran oleh 1 worker (default). Antrean maksimal 8 job; bila penuh, server membalas 503 agar klien mencoba lagi, jadi gambar tidak menumpuk tanpa batas.
- Banyaknya worker/antrean bisa diatur lewat `OCR_WORKERS` dan `OCR_QUEUE_SIZE` di `.env` lalu `docker compose up -d --force-recreate ocr`. Karena OCR memakai CPU, naikkan `OCR_WORKERS` hanya bila CPU server masih longgar.
- Cek kondisi antrean: `curl http://localhost:8000/ocr/status` dari dalam jaringan internal, atau `docker compose exec ocr python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/ocr/status').read().decode())"`.
- Batas waktu scan: 70 detik di service OCR, 75 detik di API; bila terlalu lama, pengguna diminta foto ulang.

## Kamera OCR
Bingkai foto mengikuti rasio halaman data paspor (persegi panjang ±1,45:1) dan hasil foto dipotong tepat sesuai bingkai sebelum dikirim ke OCR. Kamera diminta memakai lensa belakang/utama dengan zoom digital 1x dan fokus otomatis berkelanjutan; ketuk layar untuk memindahkan titik fokus bila perangkat mendukung. Foto dengan MRZ terpotong atau buram tetap perlu diperiksa manual.
