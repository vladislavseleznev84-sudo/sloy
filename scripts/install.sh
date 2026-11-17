#!/usr/bin/env bash
# Установка СЛОЯ на чистый Ubuntu-сервер одной командой.
# Спросит только токен бота (ввод скрыт). Домен получит сам (по IP сервера, через sslip.io).
set -euo pipefail

REPO="https://github.com/vladislavseleznev84-sudo/sloy"
BRANCH="${SLOY_BRANCH:-claude/ecstatic-planck-bq1dhu}"
DIR=/opt/sloy

[ "$(id -u)" = 0 ] || { echo "Запустите от root (в консоли сервера вы уже root)."; exit 1; }

echo "==> 1/5 Ставлю нужные программы…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y ca-certificates curl git openssl >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null

echo "==> 2/5 Скачиваю СЛОЙ…"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"; fi
cd "$DIR"

echo "==> 3/5 Настройка…"
IP="$(curl -4 -fsS https://api.ipify.org)"
DOMAIN="${SLOY_DOMAIN:-${IP//./-}.sslip.io}"
if [ -f .env ] && grep -q '^BOT_TOKEN=.\+' .env; then
  echo "Файл настроек уже есть — использую его."
else
  read -rsp "Вставьте токен бота и нажмите Enter (символы не показываются): " TOKEN </dev/tty; echo
  [ -n "$TOKEN" ] || { echo "Токен пустой."; exit 1; }
  umask 077
  cat > .env <<ENV
BOT_TOKEN=$TOKEN
WEBHOOK_SECRET=$(openssl rand -hex 24)
WEBAPP_URL=https://$DOMAIN
DOMAIN=$DOMAIN
TZ_NAME=Europe/Moscow
ENV
fi

echo "==> 4/5 Запускаю (первый раз — несколько минут)…"
docker compose up -d --build

echo "==> 5/5 Жду, пока появится защищённый адрес https://$DOMAIN …"
OK=0
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/healthz" >/dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
if [ "$OK" != 1 ]; then
  echo "Адрес пока не отвечает. Это может быть закрытый порт 80/443 у провайдера или лимит сертификатов."
  echo "Покажите мне вывод команды:  cd /opt/sloy && docker compose logs --tail 40"
  exit 1
fi
docker compose exec -T sloy node scripts/set-webhook.js
echo
echo "ГОТОВО. Адрес: https://$DOMAIN"
