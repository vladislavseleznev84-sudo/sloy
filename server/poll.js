'use strict';
// Режим «опроса» без публичного адреса: сервер сам спрашивает у Telegram новые события.
// Нужен для проверки бота и для запуска на домашнем компьютере. Mini App в этом режиме не открывается.
const path = require('node:path');
const { openDb } = require('./db');
const { createTelegram } = require('./telegram');
const { createBot } = require('./bot');

const token = process.env.BOT_TOKEN;
if (!token) { console.error('Нужна переменная BOT_TOKEN'); process.exit(1); }
const tg = createTelegram(token);
const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'sloy.db'));
const bot = createBot({ tg, db, botId: Number(token.split(':')[0]), webappUrl: process.env.WEBAPP_URL ? process.env.WEBAPP_URL.replace(/\/$/, '') : '', tz: process.env.TZ_NAME || 'Europe/Moscow' });

const kinds = (u) => Object.keys(u).filter((k) => k !== 'update_id').join(',');
(async () => {
  await tg.call('deleteWebhook', { drop_pending_updates: false });
  console.log('СЛОЙ (режим опроса) запущен');
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages', 'pre_checkout_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        console.log(new Date().toISOString(), 'событие:', kinds(u));    // тексты сообщений в лог не пишем
        try { await bot.handle(u); } catch (e) { console.error('ошибка обработки:', e.message); }
      }
    } catch (e) { console.error('опрос:', e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
})();
