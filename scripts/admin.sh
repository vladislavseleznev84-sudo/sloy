#!/usr/bin/env bash
# Сделать пользователя админом: ADMIN_ID=123456 bash admin.sh   (или спросит номер)
set -euo pipefail
cd /opt/sloy
ID="${ADMIN_ID:-}"
if [ -z "$ID" ]; then read -rp "Ваш Telegram ID (число): " ID </dev/tty; fi
[[ "$ID" =~ ^[0-9]{5,15}$ ]] || { echo "ID должен быть числом."; exit 1; }
if grep -q '^ADMIN_IDS=' .env; then
  CUR="$(grep '^ADMIN_IDS=' .env | cut -d= -f2)"
  case ",$CUR," in *",$ID,"*) ;; *) sed -i "s|^ADMIN_IDS=.*|ADMIN_IDS=${CUR:+$CUR,}$ID|" .env;; esac
else echo "ADMIN_IDS=$ID" >> .env; fi
docker compose up -d --force-recreate sloy
echo "ГОТОВО: админ $ID добавлен."
