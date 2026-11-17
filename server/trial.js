'use strict';
// Пробный период: 7 дней МАКС новым пользователям. Предупреждаем за сутки и сообщаем об окончании.
function pluralDays(n) { return n === 1 ? 'день' : n >= 2 && n <= 4 ? 'дня' : 'дней'; }

async function tick({ db, tg, openBtn, now = Date.now() }) {
  let sent = 0;
  for (const u of db.trialUsers()) {
    const conn = db.userConnection(u.id); const left = u.plan_until - now;
    let text = null, next = null;
    if (left <= 0) { text = '<b>Подарочная неделя МАКС закончилась.</b>\nТеперь у тебя СТАРТ: радар и итоги остались. Ответы, «Ты не ответил», поиск и «След» — на платных тарифах.'; next = 3; }
    else if (u.trial_state === 1 && left < 24 * 3600000) { text = '<b>Завтра закончится подарочная неделя МАКС.</b>\nУспей попробовать «След», ответы и поиск. Продлить можно в приложении.'; next = 2; }
    if (!text) continue;
    db.setTrialState(u.id, next);                                       // отметка до отправки: сбой не приведёт к повторам
    if (!conn) continue;
    try { await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML', text, reply_markup: openBtn('Открыть тарифы', 'paywall') }); sent++; }
    catch (e) { console.error('trial:', e.message); }
  }
  return sent;
}
function start(opts) { return setInterval(() => tick({ ...opts, now: Date.now() }).catch((e) => console.error('trial tick:', e.message)), 10 * 60000); }
module.exports = { tick, start, pluralDays };
