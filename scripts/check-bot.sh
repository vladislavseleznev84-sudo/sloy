#!/usr/bin/env bash
# Показывает, что Telegram знает о боте (без вывода токена). Запускать на сервере.
set -euo pipefail
cd /opt/sloy
docker compose exec -T sloy node -e '
const t = process.env.BOT_TOKEN;
const api = (m) => fetch("https://api.telegram.org/bot" + t + "/" + m).then((r) => r.json());
(async () => {
  const me = await api("getMe");
  if (!me.ok) { console.log("getMe: ошибка:", me.description); return; }
  const r = me.result;
  console.log("Бот: @" + r.username);
  console.log("Работает как секретарь (can_connect_to_business):", r.can_connect_to_business);
  console.log("Inline-режим:", r.supports_inline_queries, "| Группы:", r.can_join_groups, "| Главное приложение:", r.has_main_web_app);
  const w = await api("getWebhookInfo");
  if (w.ok) {
    console.log("Вебхук задан:", Boolean(w.result.url), "| ждёт событий:", w.result.pending_update_count);
    console.log("Типы событий:", (w.result.allowed_updates || []).join(", ") || "(по умолчанию)");
    if (w.result.last_error_message) console.log("Последняя ошибка вебхука:", w.result.last_error_message);
  }
})().catch((e) => console.log("ошибка:", e.message));
'
