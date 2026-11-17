#!/usr/bin/env bash
# Записать настройку в .env на сервере и перезапустить:  KEY=OPERATOR_NAME VALUE="ИП Иванов И.И." bash setenv.sh
set -euo pipefail
cd /opt/sloy
K="${KEY:-}"; V="${VALUE:-}"
case "$K" in OPERATOR_NAME|OPERATOR_INFO|SUPPORT_CONTACT|KEEP_DAYS|RECAP_HOUR|QUIET_FROM|QUIET_TO) ;; *) echo "Можно менять только: OPERATOR_NAME OPERATOR_INFO SUPPORT_CONTACT KEEP_DAYS RECAP_HOUR QUIET_FROM QUIET_TO"; exit 1;; esac
[ -n "$V" ] || { echo "VALUE пустое."; exit 1; }
case "$V" in *$'\n'*|*'"'*) echo "В значении не должно быть переносов строк и кавычек."; exit 1;; esac
if grep -q "^$K=" .env; then
  ESC="$(printf '%s' "$V" | sed -e 's/[\\&|]/\\&/g')"
  sed -i "s|^$K=.*|$K=$ESC|" .env
else printf '%s=%s\n' "$K" "$V" >> .env; fi
docker compose up -d --force-recreate sloy
echo "ГОТОВО: $K обновлён."
