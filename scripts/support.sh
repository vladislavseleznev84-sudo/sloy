#!/usr/bin/env bash
# Указать контакт поддержки: SUPPORT=ник bash support.sh   (ник без @ или с @)
set -euo pipefail
cd /opt/sloy
NICK="${SUPPORT:-}"
if [ -z "$NICK" ]; then read -rp "Telegram-ник поддержки: " NICK </dev/tty; fi
NICK="${NICK#@}"
[[ "$NICK" =~ ^[A-Za-z0-9_]{4,32}$ ]] || { echo "Ник должен состоять из латинских букв, цифр и _ (от 4 до 32 символов)."; exit 1; }
if grep -q '^SUPPORT_CONTACT=' .env; then sed -i "s|^SUPPORT_CONTACT=.*|SUPPORT_CONTACT=$NICK|" .env; else echo "SUPPORT_CONTACT=$NICK" >> .env; fi
docker compose up -d --force-recreate sloy
echo "ГОТОВО: поддержка — @$NICK"
