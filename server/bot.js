'use strict';
const { analyze } = require('./analyze');
const { PLANS, PERIOD_MS, activePlan } = require('./plans');
const { buildRecap } = require('./recap');

const TERMS = 'Условия СЛОЯ: подписка на 30 дней оплачивается в Telegram Stars. Слой читает только выбранные тобой чаты и только новые сообщения, отвечает от твоего имени лишь после твоего тапа. Память можно стереть в приложении. Возврат — по запросу в /support.';
const SUPPORT = 'Поддержка СЛОЯ: напиши сюда, что случилось, — ответим. [впишите контакт поддержки]';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const chatName = (c) => c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Чат';

function createBot({ tg, db, webappUrl, tz = 'Europe/Moscow', adminIds = new Set(), botId = 0, now = () => Date.now() }) {
  // Предохранитель от спама: не больше 8 уведомлений за 10 минут на человека.
  const sent = new Map();
  const mayNotify = (userId) => {
    const t = now(), list = (sent.get(userId) || []).filter((x) => t - x < 600000);
    if (list.length >= 8) { sent.set(userId, list); return false; }
    list.push(t); sent.set(userId, list); return true;
  };
  // Без публичного адреса (проверка в режиме опроса) кнопку не рисуем — Telegram требует настоящий HTTPS.
  // Экран передаём в query (?r=card/5): Telegram перезаписывает #-часть адреса своими параметрами.
  const openBtn = (text, path = '') => (webappUrl ? { inline_keyboard: [[{ text, web_app: { url: webappUrl + (path ? '/?r=' + encodeURIComponent(path) : '') } }]] } : undefined);

  async function handle(update) {
    if (update.business_connection) return onConnection(update.business_connection);
    if (update.business_message) return onBusinessMessage(update.business_message);
    if (update.edited_business_message) return onEdited(update.edited_business_message);
    if (update.deleted_business_messages) return onDeleted(update.deleted_business_messages);
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
    // Сообщения ботов и чат с самим ботом не разбираем — иначе уведомления превращаются в бесконечный цикл.
    if (m.from && (m.from.is_bot || (botId && m.from.id === botId))) return;
    if (botId && m.chat && m.chat.id === botId) return;
    if (typeof m.text !== 'string') return;                    // MVP: только текст
    // Лимит чатов по тарифу: новый чат сверх лимита не обрабатываем (админ — без лимита).
    const plan = activePlan(db.getUser(conn.user_id), now(), adminIds.has(conn.user_id));
    if (!db.hasChat(conn.user_id, m.chat.id) && db.countChats(conn.user_id) >= plan.chats) return;
    const analysis = analyze(m.text, { now: now(), tz });
    const id = db.addMessage({
      user_id: conn.user_id, conn_id: conn.id, chat_id: m.chat.id, chat_name: chatName(m.chat), tg_msg_id: m.message_id,
      text: m.text, ts: (m.date || Math.floor(now() / 1000)) * 1000, level: analysis.level, analysis,
    });
    const layers = (db.getSettings(conn.user_id).layers) || {};
    if (id && analysis.level === 'act' && layers.radar !== false && mayNotify(conn.user_id)) {
      await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML',
        text: `<b>RADAR · ${esc(chatName(m.chat))}</b>\n<blockquote>${esc(m.text)}</blockquote>` + (analysis.deadline && analysis.deadline !== 'Без срока' ? `\nСрок: ${esc(analysis.deadline)}${analysis.left ? ' · ' + esc(analysis.left) : ''}` : ''),
        reply_markup: openBtn('Открыть разбор ↗', 'card/' + id) });
    }
  }

  // «След»: уведомления об изменённых и удалённых сообщениях (только те, что слой уже видел).
  const hhmm = (ts) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ts);
  const traceOn = (userId) => ((db.getSettings(userId).layers) || {}).trace !== false;
  const quote = (t) => `<blockquote>${esc(String(t).slice(0, 900))}</blockquote>`;

  async function onEdited(m) {
    const conn = db.getConnection(m.business_connection_id);
    if (!conn || !conn.enabled || typeof m.text !== 'string') return;
    if (m.from && (m.from.id === conn.user_id || m.from.is_bot || (botId && m.from.id === botId))) return;
    const row = db.findMessage(conn.id, m.chat.id, m.message_id);
    if (!row || row.text === m.text) return;                       // неизвестное сообщение или правка без смены текста
    const history = JSON.parse(row.history || '[]'); history.push({ text: row.text, at: now() });
    const analysis = analyze(m.text, { now: now(), tz });
    db.markEdited(row.id, m.text, analysis, analysis.level, history, now());
    if (traceOn(conn.user_id) && mayNotify(conn.user_id)) {
      await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML',
        text: `<b>Изменено · ${esc(row.chat_name)}</b>\nНаписано ${hhmm(row.ts)}, изменено ${hhmm(now())}\nБыло:\n${quote(row.text)}Стало:\n${quote(m.text)}`,
        reply_markup: openBtn('Открыть', 'card/' + row.id) });
    }
  }

  async function onDeleted(d) {
    const conn = db.getConnection(d.business_connection_id);
    if (!conn || !conn.enabled) return;
    for (const mid of d.message_ids || []) {
      const row = db.findMessage(conn.id, d.chat.id, mid);
      if (!row || row.deleted_at) continue;                         // слой это сообщение не видел — показать нечего
      db.markDeleted(row.id, now());
      if (traceOn(conn.user_id) && mayNotify(conn.user_id)) {
        await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML',
          text: `<b>Удалено · ${esc(row.chat_name)}</b>\nОтправлено ${hhmm(row.ts)}, удалено ${hhmm(now())}\n${quote(row.text)}`,
          reply_markup: openBtn('Открыть', 'card/' + row.id) });
      }
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
    if (/^\/recap/.test(text)) {
      const r = buildRecap(db, m.from.id, now(), botId);
      return tg.call('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: r ? r.text : 'Пока нечего пересказывать: за сутки тихо.', reply_markup: openBtn('Открыть страницу дня') });
    }
    if (/^\/id\b/.test(text)) return tg.call('sendMessage', { chat_id: m.chat.id, text: 'Ваш Telegram ID: ' + m.from.id });
    if (/^\/buytest/.test(text)) {
      // Проверка оплаты Stars за 1 ⭐: бот потом сам вернёт её.
      return tg.call('sendInvoice', { chat_id: m.chat.id, title: 'Тест оплаты СЛОЙ', description: 'Проверка оплаты за 1 Звезду. Звезда вернётся автоматически.',
        payload: 'test:' + m.from.id, currency: 'XTR', prices: [{ label: 'Тест', amount: 1 }] });
    }
    if (/^\/buy/.test(text)) {
      const plan = PLANS.sloy;
      return tg.call('sendInvoice', { chat_id: m.chat.id, title: 'Билет «' + plan.title + '»', description: 'Доступ к слоям СЛОЙ на 30 дней',
        payload: 'plan:' + plan.id + ':' + m.from.id, currency: 'XTR', prices: [{ label: plan.title + ' · 30 дней', amount: plan.stars }] });
    }
    if (/^\/terms/.test(text)) return tg.call('sendMessage', { chat_id: m.chat.id, text: TERMS });
    if (/^\/support/.test(text)) return tg.call('sendMessage', { chat_id: m.chat.id, text: SUPPORT });
  }

  async function onPaid(m) {
    const p = m.successful_payment;
    if (String(p.invoice_payload || '') === 'test:' + m.from.id) {
      let back = 'Звезда вернётся вам автоматически.';
      try { await tg.call('refundStarPayment', { user_id: m.from.id, telegram_payment_charge_id: p.telegram_payment_charge_id }); back = 'Звезда уже возвращена вам.'; }
      catch (e) { back = 'Не получилось вернуть Звезду автоматически (' + e.message + ') — напишите в /support.'; }
      return tg.call('sendMessage', { chat_id: m.chat.id, text: 'Оплата прошла. ' + back });
    }
    const [, planId, userId] = String(p.invoice_payload || '').split(':');
    const plan = PLANS[planId];
    if (!plan || Number(userId) !== m.from.id) return;   // payload сверяем с платящим
    const user = db.upsertUser(m.from.id, now());
    const base = user.plan === planId && user.plan_until > now() ? user.plan_until : now();
    db.setPlan(m.from.id, planId, base + PERIOD_MS);
    await tg.call('sendMessage', { chat_id: m.chat.id, text: `Готово. Билет «${plan.title}» активен на 30 дней.` });
  }

  return { handle, openBtn };
}

module.exports = { createBot };
