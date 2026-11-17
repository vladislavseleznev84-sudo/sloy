'use strict';
// node scripts/set-webhook.js — регистрирует вебхук и кнопку меню бота.
const { createTelegram } = require('../server/telegram');
const need = (k) => { const v = process.env[k]; if (!v) { console.error('Нужна переменная ' + k); process.exit(1); } return v; };
(async () => {
  const tg = createTelegram(need('BOT_TOKEN'));
  const base = need('WEBAPP_URL').replace(/\/$/, '');
  await tg.call('setWebhook', {
    url: base + '/webhook', secret_token: need('WEBHOOK_SECRET'),
    allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages', 'pre_checkout_query'],
  });
  await tg.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'СЛОЙ', web_app: { url: base } } });
  console.log('Готово: вебхук и кнопка меню настроены.');
})().catch((e) => { console.error(e.message); process.exit(1); });
