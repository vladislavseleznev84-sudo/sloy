'use strict';
// Цены в Telegram Stars — рабочая гипотеза, меняйте здесь (и в web/data.js).
// features: replies — отправка ответов из приложения; remind — «Ты не ответил»; ask — «Спроси слой»; trace — «След» (удалённое и изменённое).
const PLANS = {
  start: { id: 'start', title: 'СТАРТ', stars: 0, chats: 3, features: { replies: false, remind: false, ask: false, trace: false } },
  sloy: { id: 'sloy', title: 'СЛОЙ', stars: 250, chats: 15, features: { replies: true, remind: true, ask: true, trace: false } },
  max: { id: 'max', title: 'МАКС', stars: 450, chats: Infinity, features: { replies: true, remind: true, ask: true, trace: true } },
};
const PERIOD_MS = 30 * 24 * 3600 * 1000;

// Админ (ADMIN_IDS) получает максимальный тариф без оплаты.
function activePlan(user, now = Date.now(), isAdmin = false) {
  if (isAdmin) return PLANS.max;
  if (!user || user.plan === 'start' || user.plan_until < now) return PLANS.start;
  return PLANS[user.plan] || PLANS.start;
}
module.exports = { PLANS, PERIOD_MS, activePlan };
