set -e
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Docker belum terpasang. Lihat README.md langkah 1."; exit 1; }

if [ -f .env ]; then
  echo ".env sudah ada, dipakai apa adanya."
else
  read -rp "Username admin [admin]: " AU; AU=${AU:-admin}
  [[ $AU =~ ^[a-zA-Z0-9._-]{3,30}$ ]] || { echo "Username 3-30 karakter: huruf, angka, titik, strip, garis bawah."; exit 1; }
  read -rsp "Password admin (minimal 10 karakter): " AP; echo
  [ ${#AP} -ge 10 ] || { echo "Password terlalu pendek."; exit 1; }
  case "$AP" in *[\$\'\"\\\#]*) echo "Password tidak boleh memuat karakter  \$ ' \" \\ #"; exit 1;; esac
  umask 077
  cat > .env <<ENV
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_USER=$AU
ADMIN_PASS='$AP'
ENV
  echo ".env dibuat (DB_PASSWORD dan JWT_SECRET diisi acak otomatis)."
fi

mkdir -p certs
if [ ! -f certs/server.crt ]; then
  SAN="DNS:localhost,IP:127.0.0.1"
  for ip in $(hostname -I); do SAN="$SAN,IP:$ip"; done
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout certs/server.key -out certs/server.crt \
    -subj "/CN=paspor.local" -addext "subjectAltName=$SAN" 2>/dev/null
  chmod 644 certs/server.crt; chmod 600 certs/server.key
  echo "Sertifikat HTTPS dibuat untuk: $SAN"
fi

docker compose up --build -d
echo
echo "Selesai. Buka salah satu alamat ini (terima peringatan sertifikat pada kunjungan pertama):"
echo "  https://localhost"
for ip in $(hostname -I); do echo "  https://$ip"; done
