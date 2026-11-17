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
function setup() {
  const db = openDb(':memory:'); const tg = fakeTg();
  const bot = createBot({ tg, db, webappUrl: 'https://sloy.example', now: () => T0 });
  return { db, tg, bot };
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
  assert.match(note.params.reply_markup.inline_keyboard[0][0].web_app.url, /#\/card\/\d+$/);
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

test('бот отвечает на /terms и /support', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/terms' } });
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/support' } });
  assert.match(tg.calls[0].params.text, /Stars/); assert.match(tg.calls[1].params.text, /Поддержка/);
});

async function withServer(fn) {
  const { db, tg, bot } = setup();
  const handler = createApp({ botToken: TOKEN, webhookSecret: 's3cret', db, tg, bot, webDir: __dirname + '/../web', now: () => T0 });
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
    assert.strictEqual(mine.plan, 'start'); assert.strictEqual(mine.connected, true);
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
