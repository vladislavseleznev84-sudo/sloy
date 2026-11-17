'use strict';
const { analyze } = require('./analyze');
const { PLANS, PERIOD_MS } = require('./plans');

const TERMS = 'Условия СЛОЯ: подписка на 30 дней оплачивается в Telegram Stars. Слой читает только выбранные тобой чаты и только новые сообщения, отвечает от твоего имени лишь после твоего тапа. Память можно стереть в приложении. Возврат — по запросу в /support.';
const SUPPORT = 'Поддержка СЛОЯ: напиши сюда, что случилось, — ответим. [впишите контакт поддержки]';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const chatName = (c) => c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Чат';

function createBot({ tg, db, webappUrl, tz = 'Europe/Moscow', now = () => Date.now() }) {
  // Без публичного адреса (проверка в режиме опроса) кнопку не рисуем — Telegram требует настоящий HTTPS.
  const openBtn = (text, hash = '') => (webappUrl ? { inline_keyboard: [[{ text, web_app: { url: webappUrl + hash } }]] } : undefined);

  async function handle(update) {
    if (update.business_connection) return onConnection(update.business_connection);
    if (update.business_message) return onBusinessMessage(update.business_message);
    if (update.pre_checkout_query) return tg.call('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
    if (update.message) return onMessage(update.message);
  }

  async function onConnection(c) {
    const rights = c.rights || {};
    const was = db.getConnection(c.id);
    db.upsertUser(c.user.id, now());
    db.upsertConnection({ id: c.id, user_id: c.user.id, user_chat_id: c.user_chat_id, enabled: c.is_enabled, can_reply: !!(rights.can_reply || c.can_reply) });
    if (c.is_enabled && !(was && was.enabled)) {   // приветствуем только при первом включении
      await tg.call('sendMessage', { chat_id: c.user_chat_id, parse_mode: 'HTML',
        text: '<b>Слой подключён.</b>\nЯ читаю только новое — прошлую переписку не вижу. Первая пометка появится, как только придёт что-то важное.',
        reply_markup: openBtn('Открыть СЛОЙ') });
    }
  }

  async function onBusinessMessage(m) {
    const conn = db.getConnection(m.business_connection_id);
    if (!conn || !conn.enabled) return;
    if (m.from && m.from.id === conn.user_id) return;          // свои исходящие не разбираем
    if (typeof m.text !== 'string') return;                    // MVP: только текст
    const analysis = analyze(m.text, { now: now(), tz });
    const id = db.addMessage({
      user_id: conn.user_id, conn_id: conn.id, chat_id: m.chat.id, chat_name: chatName(m.chat), tg_msg_id: m.message_id,
      text: m.text, ts: (m.date || Math.floor(now() / 1000)) * 1000, level: analysis.level, analysis,
    });
    if (id && analysis.level === 'act') {
      await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML',
        text: `<b>RADAR · ${esc(chatName(m.chat))}</b>\n<blockquote>${esc(m.text)}</blockquote>` + (analysis.deadline && analysis.deadline !== 'Без срока' ? `\nСрок: ${esc(analysis.deadline)}${analysis.left ? ' · ' + esc(analysis.left) : ''}` : ''),
        reply_markup: openBtn('Открыть разбор ↗', '#/card/' + id) });
    }
  }

  async function onMessage(m) {
    if (m.successful_payment) return onPaid(m);
    const text = (m.text || '').trim();
    if (/^\/start/.test(text)) {
      return tg.call('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML',
        text: '<b>СЛОЙ</b> накидывается поверх Telegram и подчёркивает важное.\n\nПодключи меня: Настройки → Telegram Business → Чат-боты.',
        reply_markup: openBtn('Открыть СЛОЙ') });
    }
    if (/^\/terms/.test(text)) return tg.call('sendMessage', { chat_id: m.chat.id, text: TERMS });
    if (/^\/support/.test(text)) return tg.call('sendMessage', { chat_id: m.chat.id, text: SUPPORT });
  }

  async function onPaid(m) {
    const p = m.successful_payment;
    const [, planId, userId] = String(p.invoice_payload || '').split(':');
    const plan = PLANS[planId];
    if (!plan || Number(userId) !== m.from.id) return;   // payload сверяем с платящим
    const user = db.upsertUser(m.from.id, now());
    const base = user.plan === planId && user.plan_until > now() ? user.plan_until : now();
    db.setPlan(m.from.id, planId, base + PERIOD_MS);
    await tg.call('sendMessage', { chat_id: m.chat.id, text: `Готово. Билет «${plan.title}» активен на 30 дней.` });
  }

  return { handle };
}

module.exports = { createBot };
