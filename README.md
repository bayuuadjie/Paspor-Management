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
