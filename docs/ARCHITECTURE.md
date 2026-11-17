# СЛОЙ — архитектура (черновик)

```
Telegram-клиент ── Mini App (этот репозиторий: index.html, app.js …)
       │                         │  fetch /api/*  (initData → проверка подписи на бэкенде)
       │                         ▼
       └── Business-подключение ─► Бот (Bot API) ─► Бэкенд ─► БД (сообщения, память, подписки)
              business_message                          └─► LLM-анализ (RADAR/REPLY/RECAP)
```

## Что уже есть
- Mini App: Страница / RADAR / Разбор / Память / Слои / Билет. Демо-данные в `data.js`, без бэкенда.
- Интеграция с Telegram.WebApp: ready, expand, BackButton, HapticFeedback (включается сама внутри Telegram).
- `payments.js` — единственная точка оплаты. UI зовёт `Pay.start(plan, provider)`.

## Что нужно сделать (по порядку)
1. Бэкенд + бот: Secretary Mode в @BotFather, приём `business_connection` / `business_message`.
2. Валидация `initData` на бэкенде (иначе любой может притвориться пользователем).
3. Анализ входящих → хранение → `/api/feed`, `/api/message/:id`.
4. `/api/invoice` → `createInvoiceLink` (currency `XTR`) → в Mini App `WebApp.openInvoice`.
5. Бот обязан отвечать на `/terms` и `/support` (требование Telegram для платежей).

## Открытые вопросы (не проверено)
- Нужен ли Telegram Premium для Business-подключения (источники противоречат).
- Могут ли пользователи из России купить Stars. От этого зависит выбор способа оплаты.
- Автопродление подписки на бот через Stars — не подтверждено; в дизайне «билет на 30 дней».
- Условия для разработчиков Telegram (telegram.org/tos/bot-developers) и 152-ФЗ — прочитать/юрист.
