'use strict';
// «Ты не ответил»: если важное сообщение ждёт ответа больше 3 часов, бот напоминает (до двух раз: через 3 и 12 часов).
const { localParts } = require('./recap');
const { activePlan } = require('./plans');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const short = (t, n = 50) => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };

const QUIET_FROM = Number(process.env.QUIET_FROM || 23), QUIET_TO = Number(process.env.QUIET_TO || 8);
// Тихие часы: с 23:00 до 08:00 по времени пользователя (по умолчанию включены; слой «quiet» можно выключить).
function inQuiet(settings, now, tz) {
  if (((settings.layers) || {}).quiet === false) return false;
  const h = localParts(now, tz).hour;
  return QUIET_FROM > QUIET_TO ? (h >= QUIET_FROM || h < QUIET_TO) : (h >= QUIET_FROM && h < QUIET_TO);
}
const ago = (ms) => { const h = Math.round(ms / 3600000); return h >= 1 ? h + ' ч назад' : 'недавно'; };

async function tick({ db, tg, openBtn, tz, now = Date.now(), adminIds = new Set(), firstAfterH = 3, secondAfterH = 9 }) {
  const byUser = new Map();
  for (const r of db.pendingReplies(now)) {
    const due = r.reminded_count === 0 ? now - r.ts >= firstAfterH * 3600000 : now - r.reminded_at >= secondAfterH * 3600000;
    if (!due) continue;
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  let sent = 0;
  for (const [userId, rows] of byUser) {
    const st = db.getSettings(userId), layers = st.layers || {};
    if (layers.remind === false || layers.radar === false || inQuiet(st, now, tz)) continue;
    if (!activePlan(db.getUser(userId), now, adminIds.has(userId)).features.remind) continue;   // «Ты не ответил» — с тарифа СЛОЙ
    const conn = db.userConnection(userId); if (!conn) continue;
    const top = rows.slice(0, 4);
    const lines = top.map((r) => `• ${esc(r.chat_name)} (${ago(now - r.ts)}): ${esc(short(r.text))}`);
    try {
      await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML',
        text: `<b>Ты не ответил</b>\n${lines.join('\n')}${rows.length > top.length ? `\nи ещё ${rows.length - top.length}` : ''}`,
        reply_markup: openBtn('Открыть и ответить', 'card/' + top[0].id) });
      sent++;
    } catch (e) { console.error('reminder:', e.message); }
    rows.forEach((r) => db.bumpReminded(r.id, now));                 // помечаем всегда: сбой отправки не должен привести к спаму
  }
  return sent;
}
function start(opts) { return setInterval(() => tick({ ...opts, now: Date.now() }).catch((e) => console.error('reminders tick:', e.message)), 5 * 60000); }

module.exports = { tick, start, inQuiet };
