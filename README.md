# СЛОЙ — Telegram Mini App + бот

Без зависимостей, Node ≥ 22.13 (встроенный SQLite).

    npm test                      # 8 тестов: подпись initData, разбор, Business, оплата, API
    python3 -m http.server -d web # демо интерфейса без сервера (демо-режим)

## Запуск по-настоящему
1. @BotFather: создать бота → **Business Mode / Secretary mode** включить → Mini App (Main) → адрес `WEBAPP_URL`.
2. `cp .env.example .env`, заполнить; задеплоить на любой хостинг с HTTPS (Dockerfile есть).
3. `npm run webhook` — один раз регистрирует вебхук и кнопку меню.
4. В своём Telegram: Настройки → Telegram Business → Чат-боты → выбрать бота.

## Как устроено
- `web/` — Mini App. Внутри Telegram сам берёт `/api/feed` (подпись `initData` проверяется на сервере); снаружи — демо.
- `server/bot.js` — `business_connection`, `business_message`, платежи Stars (`pre_checkout_query`, `successful_payment`), `/start /terms /support`.
- `server/analyze.js` — разбор сообщений правилами (срок, просьба, личное, тишина). Заменяемый модуль: сюда встанет LLM.
- Оплата: `POST /api/invoice` → `createInvoiceLink` (XTR) → `WebApp.openInvoice`. Билет на 30 дней, продление = новая оплата.

Открытые вопросы и что не проверено — `docs/ARCHITECTURE.md`.
