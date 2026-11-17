'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { validateInitData, signInitData } = require('../server/validate');
const { analyze } = require('../server/analyze');
const { openDb } = require('../server/db');
const { createBot } = require('../server/bot');
const { createApp } = require('../server/app');
const { PERIOD_MS } = require('../server/plans');

const TOKEN = '123:TEST';
const T0 = new Date('2026-11-17T14:12:00+03:00').getTime();
const mkInit = (user, authDate = Math.floor(T0 / 1000)) => signInitData({ user: JSON.stringify(user), auth_date: String(authDate), query_id: 'q1' }, TOKEN);

function fakeTg() {
  const calls = [];
  return { calls, call: async (method, params) => { calls.push({ method, params }); return method === 'createInvoiceLink' ? 'https://t.me/$invoice' : {}; } };
}
function setup(adminIds = new Set(), botId = 555) {
  const db = openDb(':memory:'); const tg = fakeTg();
  const bot = createBot({ tg, db, webappUrl: 'https://sloy.example', adminIds, botId, now: () => T0 });
  return { db, tg, bot, adminIds };
}

test('initData: валидная подпись проходит, подделка и протухшая — нет', () => {
  const user = { id: 42, first_name: 'Аня' };
  assert.strictEqual(validateInitData(mkInit(user), TOKEN, { now: T0 }).user.id, 42);
  assert.strictEqual(validateInitData(mkInit(user), 'другой:токен', { now: T0 }), null);
  const tampered = mkInit(user).replace('%22id%22%3A42', '%22id%22%3A43');
  assert.strictEqual(validateInitData(tampered, TOKEN, { now: T0 }), null);
  assert.strictEqual(validateInitData(mkInit(user, Math.floor(T0 / 1000) - 90000), TOKEN, { now: T0 }), null);
  assert.strictEqual(validateInitData('', TOKEN), null);
});

test('analyze: срок, дата, личное, тишина', () => {
  const a = analyze('Привет! Подпиши акт до 18:00, иначе сорвётся оплата', { now: T0 });
  assert.strictEqual(a.level, 'act'); assert.strictEqual(a.tag, 'Срочно');
  assert.deepStrictEqual(a.segs[1], ['до 18:00', 'hl']); assert.strictEqual(a.deadline, 'Сегодня, 18:00');
  assert.match(a.left, /3 ч 48 мин/);
  const b = analyze('Скинь конспект по матану до пятницы', { now: T0 });
  assert.strictEqual(b.deadline, 'До пятницы'); assert.deepStrictEqual(b.segs[1], ['до пятницы', 'hl']);
  assert.strictEqual(analyze('Ты когда приедешь? Купить что-нибудь?', { now: T0 }).level, 'know');
  assert.strictEqual(analyze('Ваш бонусный баланс — 120 баллов', { now: T0 }).level, 'quiet');
  assert.strictEqual(analyze('', { now: T0 }).level, 'quiet');
});

test('Business: подключение → сообщение → разбор + уведомление; свои исходящие игнорируются', async () => {
  const { db, tg, bot } = setup();
  await bot.handle({ business_connection: { id: 'bc1', user: { id: 42 }, user_chat_id: 4242, is_enabled: true, rights: { can_reply: true } } });
  assert.strictEqual(tg.calls[0].method, 'sendMessage');
  await bot.handle({ business_connection: { id: 'bc1', user: { id: 42 }, user_chat_id: 4242, is_enabled: true } });
  assert.strictEqual(tg.calls.length, 1);          // повторное подключение не шлёт второе приветствие
  const msg = (over) => ({ business_message: { business_connection_id: 'bc1', message_id: 1, date: T0 / 1000, chat: { id: 7, first_name: 'Даня', last_name: 'М.' }, from: { id: 7 }, text: 'Подпиши акт до 18:00', ...over } });
  await bot.handle(msg());
  assert.strictEqual(db.feed(42, 0).length, 1);
  const note = tg.calls.at(-1);
  assert.strictEqual(note.params.chat_id, 4242);
  assert.match(note.params.text, /<blockquote>Подпиши акт до 18:00<\/blockquote>/);
  assert.match(note.params.reply_markup.inline_keyboard[0][0].web_app.url, /\/\?r=card%2F\d+$/);
  const before = tg.calls.length;
  await bot.handle(msg({ message_id: 1 }));                     // дубль не создаёт запись и уведомление
  await bot.handle(msg({ message_id: 2, from: { id: 42 } }));   // исходящее от владельца
  assert.strictEqual(db.feed(42, 0).length, 1); assert.strictEqual(tg.calls.length, before);
  await bot.handle({ business_message: { ...msg().business_message, business_connection_id: 'нет' } });
  assert.strictEqual(db.feed(42, 0).length, 1);
});

test('платёж: pre_checkout одобряется, successful_payment продлевает билет на 30 дней', async () => {
  const { db, tg, bot } = setup();
  await bot.handle({ pre_checkout_query: { id: 'pc1' } });
  assert.deepStrictEqual(tg.calls[0], { method: 'answerPreCheckoutQuery', params: { pre_checkout_query_id: 'pc1', ok: true } });
  const pay = (uid, payload) => ({ message: { chat: { id: uid }, from: { id: uid }, successful_payment: { invoice_payload: payload, currency: 'XTR', total_amount: 250 } } });
  await bot.handle(pay(42, 'plan:sloy:42'));
  assert.strictEqual(db.getUser(42).plan, 'sloy'); assert.strictEqual(db.getUser(42).plan_until, T0 + PERIOD_MS);
  await bot.handle(pay(42, 'plan:sloy:42'));                     // повторная оплата продлевает, а не обнуляет
  assert.strictEqual(db.getUser(42).plan_until, T0 + 2 * PERIOD_MS);
  await bot.handle(pay(43, 'plan:max:42'));                      // чужой payload не засчитывается
  assert.strictEqual(db.getUser(43), undefined);
});

test('/buytest шлёт счёт на 1 ⭐ и возвращает её после оплаты; /buy шлёт настоящий счёт', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 5 }, from: { id: 5 }, text: '/buytest' } });
  const inv = tg.calls[0];
  assert.strictEqual(inv.method, 'sendInvoice'); assert.strictEqual(inv.params.currency, 'XTR'); assert.strictEqual(inv.params.prices[0].amount, 1);
  assert.strictEqual('provider_token' in inv.params, false);
  await bot.handle({ message: { chat: { id: 5 }, from: { id: 5 }, successful_payment: { invoice_payload: inv.params.payload, telegram_payment_charge_id: 'ch1' } } });
  assert.deepStrictEqual(tg.calls[1], { method: 'refundStarPayment', params: { user_id: 5, telegram_payment_charge_id: 'ch1' } });
  await bot.handle({ message: { chat: { id: 5 }, from: { id: 5 }, text: '/buy' } });
  assert.strictEqual(tg.calls.at(-1).params.prices[0].amount, 250);
});

test('бот отвечает на /terms и /support', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/terms' } });
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/support' } });
  assert.match(tg.calls[0].params.text, /Stars/); assert.match(tg.calls[1].params.text, /Поддержка/);
});

async function withServer(fn, adminIds = new Set([42])) {
  const { db, tg, bot } = setup(adminIds);
  const handler = createApp({ botToken: TOKEN, webhookSecret: 's3cret', db, tg, bot, adminIds, webDir: __dirname + '/../web', now: () => T0 });
  const srv = http.createServer(handler); await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try { await fn({ base, db, tg, bot }); } finally { srv.close(); }
}
const authH = (id) => ({ Authorization: 'tma ' + mkInit({ id, first_name: 'T' }), 'Content-Type': 'application/json' });

test('API: без подписи 401, лента отдаёт разобранные сообщения только своего пользователя', async () => {
  await withServer(async ({ base, bot }) => {
    assert.strictEqual((await fetch(base + '/api/feed')).status, 401);
    await bot.handle({ business_connection: { id: 'bc1', user: { id: 42 }, user_chat_id: 4242, is_enabled: true } });
    await bot.handle({ business_message: { business_connection_id: 'bc1', message_id: 1, date: T0 / 1000, chat: { id: 7, first_name: 'Даня' }, from: { id: 7 }, text: 'Подпиши акт до 18:00' } });
    await bot.handle({ business_message: { business_connection_id: 'bc1', message_id: 2, date: T0 / 1000, chat: { id: 8, first_name: 'Кафе' }, from: { id: 8 }, text: 'Ваш бонусный баланс — 120 баллов' } });
    const mine = await (await fetch(base + '/api/feed', { headers: authH(42) })).json();
    assert.strictEqual(mine.messages[0].name, 'Даня'); assert.strictEqual(mine.messages[0].level, 'act');
    assert.strictEqual(mine.plan, 'max'); assert.strictEqual(mine.connected, true);   // 42 — админ
    assert.strictEqual(mine.now.total, 2);
    const other = await (await fetch(base + '/api/feed', { headers: authH(99) })).json();
    assert.strictEqual(other.messages.length, 0);
  });
});

test('API: счёт в Stars и ответ от имени пользователя через Business', async () => {
  await withServer(async ({ base, bot, tg }) => {
    const inv = await fetch(base + '/api/invoice', { method: 'POST', headers: authH(42), body: JSON.stringify({ plan: 'sloy' }) });
    assert.strictEqual((await inv.json()).link, 'https://t.me/$invoice');
    const call = tg.calls.find((c) => c.method === 'createInvoiceLink').params;
    assert.strictEqual(call.currency, 'XTR'); assert.strictEqual(call.prices[0].amount, 250); assert.strictEqual(call.payload, 'plan:sloy:42');
    assert.strictEqual('provider_token' in call, false);
    assert.strictEqual((await fetch(base + '/api/invoice', { method: 'POST', headers: authH(42), body: JSON.stringify({ plan: 'start' }) })).status, 400);

    await bot.handle({ business_connection: { id: 'bc1', user: { id: 42 }, user_chat_id: 4242, is_enabled: true } });
    await bot.handle({ business_message: { business_connection_id: 'bc1', message_id: 1, date: T0 / 1000, chat: { id: 7, first_name: 'Даня' }, from: { id: 7 }, text: 'Подпиши акт до 18:00' } });
    const id = (await (await fetch(base + '/api/feed', { headers: authH(42) })).json()).messages[0].id;
    const ok = await fetch(base + '/api/reply', { method: 'POST', headers: authH(42), body: JSON.stringify({ id, text: 'Сделаю до 17:00' }) });
    assert.strictEqual(ok.status, 200);
    const sent = tg.calls.at(-1);
    assert.deepStrictEqual(sent.params, { business_connection_id: 'bc1', chat_id: 7, text: 'Сделаю до 17:00' });
    const foreign = await fetch(base + '/api/reply', { method: 'POST', headers: authH(99), body: JSON.stringify({ id, text: 'взлом' }) });
    assert.strictEqual(foreign.status, 400);                      // чужое сообщение отправить нельзя
  });
});

test('вебхук: неверный секрет → 401; статика и защита от выхода из папки', async () => {
  await withServer(async ({ base }) => {
    assert.strictEqual((await fetch(base + '/webhook', { method: 'POST', body: '{}' })).status, 401);
    assert.strictEqual((await fetch(base + '/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 's3cret' }, body: '{}' })).status, 200);
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/..%2fpackage.json')).status, 403);
  });
});

const bm = (conn, chatId, id, text) => ({ business_message: { business_connection_id: conn, message_id: id, date: T0 / 1000, chat: { id: chatId, first_name: 'Чат' + chatId }, from: { id: chatId }, text } });

test('лимит чатов: на СТАРТЕ 3 чата, четвёртый не обрабатывается; админу лимит не мешает', async () => {
  const { db, bot } = setup(new Set([1]));
  await bot.handle({ business_connection: { id: 'u2', user: { id: 2 }, user_chat_id: 22, is_enabled: true } });
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  for (let c = 100; c < 105; c++) { await bot.handle(bm('u2', c, c, 'Подпиши акт до 18:00')); await bot.handle(bm('u1', c, c + 1000, 'Подпиши акт до 18:00')); }
  assert.strictEqual(db.countChats(2), 3);        // обычный пользователь: ровно лимит тарифа СТАРТ
  assert.strictEqual(db.countChats(1), 5);        // админ: без лимита
  await bot.handle(bm('u2', 100, 9999, 'Скинь файл до пятницы'));   // уже известный чат продолжает работать
  assert.strictEqual(db.feed(2, 0).length, 4);
});

test('/id отвечает вашим Telegram ID', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 5 }, from: { id: 7998850914 }, text: '/id' } });
  assert.match(tg.calls[0].params.text, /7998850914/);
});

test('админка: чужим 403; админ видит статистику, выдаёт и снимает тариф; ответы — только на платном', async () => {
  await withServer(async ({ base, bot, db }) => {
    await bot.handle({ business_connection: { id: 'bc9', user: { id: 99 }, user_chat_id: 9, is_enabled: true } });
    await bot.handle(bm('bc9', 7, 1, 'Подпиши акт до 18:00'));
    assert.strictEqual((await fetch(base + '/api/admin/stats', { headers: authH(99) })).status, 403);
    const feedAdmin = await (await fetch(base + '/api/feed', { headers: authH(42) })).json();
    assert.strictEqual(feedAdmin.isAdmin, true); assert.strictEqual(feedAdmin.plan, 'max');
    const stats = await (await fetch(base + '/api/admin/stats', { headers: authH(42) })).json();
    assert.ok(stats.users >= 2 && stats.messages === 1);
    // обычный пользователь на СТАРТЕ: отправить ответ нельзя
    const id = (await (await fetch(base + '/api/feed', { headers: authH(99) })).json()).messages[0].id;
    const reply = () => fetch(base + '/api/reply', { method: 'POST', headers: authH(99), body: JSON.stringify({ id, text: 'ок' }) });
    assert.strictEqual((await reply()).status, 402);
    const bad = await fetch(base + '/api/admin/grant', { method: 'POST', headers: authH(42), body: JSON.stringify({ userId: 'x', plan: 'sloy', days: 30 }) });
    assert.strictEqual(bad.status, 400);
    const ok = await fetch(base + '/api/admin/grant', { method: 'POST', headers: authH(42), body: JSON.stringify({ userId: 99, plan: 'sloy', days: 30 }) });
    assert.strictEqual(ok.status, 200); assert.strictEqual(db.getUser(99).plan, 'sloy');
    assert.strictEqual((await reply()).status, 200);
    await fetch(base + '/api/admin/grant', { method: 'POST', headers: authH(42), body: JSON.stringify({ userId: 99, plan: 'start', days: 0 }) });
    assert.strictEqual((await reply()).status, 402);
  });
});

test('защита от цикла: сообщения самого бота и чат с ботом не разбираются; не больше 8 уведомлений за 10 минут', async () => {
  const { db, tg, bot } = setup(new Set([1]), 555);
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  const before = tg.calls.length;
  // уведомление бота, которое вернулось как business_message из чата с ботом
  await bot.handle({ business_message: { business_connection_id: 'u1', message_id: 1, date: T0 / 1000, chat: { id: 555, first_name: 'SLOY' }, from: { id: 555, is_bot: true }, text: 'RADAR · Даня\nПодпиши акт до 18:00' } });
  await bot.handle({ business_message: { business_connection_id: 'u1', message_id: 2, date: T0 / 1000, chat: { id: 555 }, from: { id: 1 }, text: 'Подпиши акт до 18:00' } });
  await bot.handle({ business_message: { business_connection_id: 'u1', message_id: 3, date: T0 / 1000, chat: { id: 9 }, from: { id: 9, is_bot: true }, text: 'Подпиши акт до 18:00' } });
  assert.strictEqual(db.feed(1, 0).length, 0); assert.strictEqual(tg.calls.length, before);
  // обычные люди: больше 8 срочных подряд не засыпают уведомлениями
  for (let i = 0; i < 12; i++) await bot.handle({ business_message: { business_connection_id: 'u1', message_id: 100 + i, date: T0 / 1000, chat: { id: 200 + i }, from: { id: 200 + i }, text: 'Срочно позвони' } });
  assert.strictEqual(db.feed(1, 0).length, 12);
  assert.strictEqual(tg.calls.length - before, 8);
});
