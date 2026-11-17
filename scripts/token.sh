#!/usr/bin/env bash
# Задать/заменить токен бота на сервере. Сам вырежет токен из вставленного текста и проверит его в Telegram.
set -euo pipefail
cd /opt/sloy
read -rsp "Вставьте токен бота и нажмите Enter (символы не показываются): " RAW </dev/tty; echo
TOKEN="$(printf '%s' "$RAW" | tr -d '\r' | grep -oE '[0-9]{6,12}:[A-Za-z0-9_-]{30,}' | head -1 || true)"
[ -n "$TOKEN" ] || { echo "Не нашёл в вставленном тексте токен. Он выглядит как 1234567890:AAH…  Скопируйте его из чата с BotFather ещё раз."; exit 1; }
if ! curl -fsS "https://api.telegram.org/bot$TOKEN/getMe" >/dev/null 2>&1; then
  echo "Telegram не принял этот токен. Возможно, он старый (после Revoke). Возьмите новый из BotFather и повторите."; exit 1
fi
echo "Токен принят Telegram."
if grep -q '^BOT_TOKEN=' .env 2>/dev/null; then sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$TOKEN|" .env; else echo "BOT_TOKEN=$TOKEN" >> .env; fi
chmod 600 .env
docker compose up -d --force-recreate sloy
DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2)"
for i in $(seq 1 20); do curl -fsS "https://$DOMAIN/healthz" >/dev/null 2>&1 && break; sleep 3; done
docker compose exec -T sloy node scripts/set-webhook.js
echo "ГОТОВО. Адрес: https://$DOMAIN"
