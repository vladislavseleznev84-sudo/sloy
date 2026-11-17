'use strict';
// Цены в Telegram Stars — рабочая гипотеза, меняйте здесь (и в web/data.js).
const PLANS = {
  start: { id: 'start', title: 'СТАРТ', stars: 0, chats: 3 },
  sloy: { id: 'sloy', title: 'СЛОЙ', stars: 250, chats: 15 },
  max: { id: 'max', title: 'МАКС', stars: 450, chats: Infinity },
};
const PERIOD_MS = 30 * 24 * 3600 * 1000;

// Админ (ADMIN_IDS) получает максимальный тариф без оплаты.
function activePlan(user, now = Date.now(), isAdmin = false) {
  if (isAdmin) return PLANS.max;
  if (!user || user.plan === 'start' || user.plan_until < now) return PLANS.start;
  return PLANS[user.plan] || PLANS.start;
}
module.exports = { PLANS, PERIOD_MS, activePlan };
