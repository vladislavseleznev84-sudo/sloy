'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { validateInitData, signInitData } = require('../server/validate');
const { analyze } = require('../server/analyze');
const { openDb } = require('../server/db');
const { createBot } = require('../server/bot');
const { createApp } = require('../server/app');
const { PERIOD_MS, TRIAL_MS } = require('../server/plans');
const trialMod = require('../server/trial');
const recap = require('../server/recap');

const TOKEN = '123:TEST';
const T0 = new Date('2026-11-17T14:12:00+03:00').getTime();
const mkInit = (user, authDate = Math.floor(T0 / 1000)) => signInitData({ user: JSON.stringify(user), auth_date: String(authDate), query_id: 'q1' }, TOKEN);

function fakeTg() {
  const calls = [];
  return { calls, upload: async (method, params, field, file) => { calls.push({ method, params, field, file }); return {}; }, call: async (method, params) => { calls.push({ method, params }); return method === 'createInvoiceLink' ? 'https://t.me/$invoice' : {}; } };
}
function setup(adminIds = new Set(), botId = 555, clock = { t: T0 }, backup = null) {
  const db = openDb(':memory:'); const tg = fakeTg();
  const bot = createBot({ tg, db, webappUrl: 'https://sloy.example', adminIds, botId, backup, now: () => clock.t });
  return { db, tg, bot, adminIds, clock };
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
  assert.strictEqual(analyze('Как дела ?', { now: T0 }).level, 'quiet');   // болтовня — не важное
  assert.strictEqual(analyze('Когда приедешь?', { now: T0 }).level, 'know');
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
  assert.strictEqual(tg.calls.at(-1).params.prices[0].amount, 150);
});

test('бот отвечает на /terms и /support', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/terms' } });
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/support' } });
  assert.match(tg.calls[0].params.text, /Stars/); assert.match(tg.calls[1].params.text, /Поддержка/);
  const sup = require('../server/bot').createBot({ tg, db: openDb(':memory:'), webappUrl: 'https://x', supportContact: 'helper_nick' });
  await sup.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/support' } });
  assert.match(tg.calls.at(-1).params.text, /@helper_nick/);
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
    assert.strictEqual(call.currency, 'XTR'); assert.strictEqual(call.prices[0].amount, 150); assert.strictEqual(call.payload, 'plan:sloy:42');
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

const noTrial = (db, id) => { db.setPlan(id, 'start', 0); db.setTrialState(id, 3); };   // в тестах про тарифы подарок уже «использован»
const bm = (conn, chatId, id, text) => ({ business_message: { business_connection_id: conn, message_id: id, date: T0 / 1000, chat: { id: chatId, first_name: 'Чат' + chatId }, from: { id: chatId }, text } });

test('лимит чатов: на СТАРТЕ 3 чата, четвёртый не обрабатывается; админу лимит не мешает', async () => {
  const { db, bot } = setup(new Set([1]));
  await bot.handle({ business_connection: { id: 'u2', user: { id: 2 }, user_chat_id: 22, is_enabled: true } }); noTrial(db, 2);
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
    await bot.handle({ business_connection: { id: 'bc9', user: { id: 99 }, user_chat_id: 9, is_enabled: true } }); noTrial(db, 99);
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

test('умные ответы: «я тебя люблю» → «я тебя тоже», привет → привет, вопрос да/нет, срок', () => {
  const love = analyze('Я тебя люблю', { now: T0 });
  assert.strictEqual(love.level, 'know'); assert.strictEqual(love.replies[0].text, 'Я тебя тоже люблю'); assert.strictEqual(love.replies.length, 3);
  assert.strictEqual(analyze('Привет', { now: T0 }).replies[0].text, 'Привет!');
  const how = analyze('Как дела ?', { now: T0 });
  assert.strictEqual(how.level, 'quiet'); assert.match(how.replies[0].text, /хорошо/i);
  assert.strictEqual(analyze('Спасибо!', { now: T0 }).replies[0].text, 'Пожалуйста!');
  assert.match(analyze('Погнали гулять?', { now: T0 }).replies[0].text, /Погнали/);
  assert.strictEqual(analyze('Ты придёшь завтра?', { now: T0 }).replies[0].text, 'Да');
  const act = analyze('Подпиши акт до 18:00', { now: T0 });
  assert.match(act.replies[0].text, /17:00/); assert.ok(act.replies.length >= 2);          // ответ по сроку идёт первым
  assert.strictEqual(analyze('Ваш бонусный баланс — 120 баллов', { now: T0 }).replies.length, 0);
  assert.deepStrictEqual(new Set(love.replies.map((r) => r.text)).size, 3);                 // без повторов
});

test('RECAP: сводка за сутки, команда /recap, отправка в 21:00 раз в день, уважает настройку слоя', async () => {
  const { db, tg, bot } = setup(new Set([1]));
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  await bot.handle(bm('u1', 7, 1, 'Подпиши акт до 18:00'));
  await bot.handle(bm('u1', 8, 2, 'Ваш бонусный баланс — 120 баллов'));
  await bot.handle({ message: { chat: { id: 11 }, from: { id: 1 }, text: '/recap' } });
  const cmd = tg.calls.at(-1);
  assert.match(cmd.params.text, /RECAP/); assert.match(cmd.params.text, /Подпиши акт/); assert.match(cmd.params.text, /тишина \(1\)/);
  const base = { db, tg, openBtn: bot.openBtn, tz: 'Europe/Moscow', botId: 555 };
  const at = (h, m = 0) => new Date(`2026-11-17T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+03:00`).getTime();
  const before = tg.calls.length;
  assert.strictEqual(await recap.tick({ ...base, now: at(20, 59) }), 0);                 // не время
  assert.strictEqual(await recap.tick({ ...base, now: at(21, 0) }), 1);                  // 21:00 — отправили
  assert.strictEqual(await recap.tick({ ...base, now: at(21, 1) }), 0);                  // повторно в тот же день — нет
  assert.strictEqual(tg.calls.length - before, 1);
  db.raw.prepare('UPDATE users SET last_recap=?').run('');
  db.setSettings(1, { layers: { recap: false } });
  assert.strictEqual(await recap.tick({ ...base, now: at(21, 2) }), 0);                  // слой RECAP выключен
});

test('настройки слоёв и «отложить»: радар выключен — уведомлений нет; отложенное скрывается из ленты', async () => {
  await withServer(async ({ base, bot, tg, db }) => {
    await bot.handle({ business_connection: { id: 'bc9', user: { id: 42 }, user_chat_id: 9, is_enabled: true } });
    const set = (layers) => fetch(base + '/api/settings', { method: 'POST', headers: authH(42), body: JSON.stringify({ layers }) });
    assert.strictEqual((await set({ radar: false, evil: true })).status, 200);
    assert.deepStrictEqual(db.getSettings(42), { layers: { radar: false } });             // лишние ключи отброшены
    const n = tg.calls.length;
    await bot.handle(bm('bc9', 7, 1, 'Подпиши акт до 18:00'));
    assert.strictEqual(tg.calls.length, n);                                                 // радар выключен — без уведомления, но разобрано
    const feed = await (await fetch(base + '/api/feed', { headers: authH(42) })).json();
    assert.strictEqual(feed.messages.length, 1); assert.deepStrictEqual(feed.settings.layers, { radar: false });
    const id = feed.messages[0].id;
    assert.strictEqual((await fetch(base + '/api/snooze', { method: 'POST', headers: authH(42), body: JSON.stringify({ id, hours: 3 }) })).status, 200);
    assert.strictEqual((await (await fetch(base + '/api/feed', { headers: authH(42) })).json()).messages.length, 0);
    assert.strictEqual((await fetch(base + '/api/snooze', { method: 'POST', headers: authH(42), body: JSON.stringify({ id, hours: 999 }) })).status, 400);
  });
});

test('СЛЕД: удалённое и изменённое сообщение — уведомление с автором, временем и текстом; неизвестное и свои правки игнорируются', async () => {
  const { db, tg, bot } = setup(new Set([1]));
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  await bot.handle(bm('u1', 7, 50, 'Подпиши акт до 18:00'));                                   // дошло до слоя
  const n0 = tg.calls.length;
  const edit = (over) => ({ edited_business_message: { business_connection_id: 'u1', message_id: 50, date: T0 / 1000, edit_date: T0 / 1000 + 60, chat: { id: 7, first_name: 'Чат7' }, from: { id: 7 }, text: 'Подпиши акт до 19:00', ...over } });
  await bot.handle(edit());
  const e = tg.calls.at(-1);
  assert.match(e.params.text, /Изменено · Чат7/); assert.match(e.params.text, /Подпиши акт до 18:00/); assert.match(e.params.text, /Подпиши акт до 19:00/); assert.match(e.params.text, /Написано 14:12/);
  const row = db.findMessage('u1', 7, 50);
  assert.strictEqual(row.text, 'Подпиши акт до 19:00'); assert.strictEqual(JSON.parse(row.history)[0].text, 'Подпиши акт до 18:00'); assert.ok(row.edited_at > 0);
  const n1 = tg.calls.length;
  await bot.handle(edit({ text: 'Подпиши акт до 19:00' }));                                   // тот же текст — не шум
  await bot.handle(edit({ message_id: 999, text: 'чужое неизвестное' }));                      // слой не видел
  await bot.handle(edit({ from: { id: 1 }, text: 'моя правка' }));                             // правка владельца
  assert.strictEqual(tg.calls.length, n1);
  const del = { deleted_business_messages: { business_connection_id: 'u1', chat: { id: 7, first_name: 'Чат7' }, message_ids: [50, 777] } };
  await bot.handle(del);
  const d = tg.calls.at(-1);
  assert.match(d.params.text, /Удалено · Чат7/); assert.match(d.params.text, /Отправлено 14:12, удалено 14:12/); assert.match(d.params.text, /Подпиши акт до 19:00/);
  assert.strictEqual(tg.calls.length, n1 + 1);                                                  // 777 неизвестно — без уведомления
  assert.ok(db.findMessage('u1', 7, 50).deleted_at > 0);
  await bot.handle(del); assert.strictEqual(tg.calls.length, n1 + 1);                           // повторно не уведомляем
});

test('СЛЕД: слой выключен — всё записывается, но уведомлений нет; в ленте видны флаги; чистка по сроку', async () => {
  await withServer(async ({ base, bot, tg, db }) => {
    await bot.handle({ business_connection: { id: 'bc9', user: { id: 42 }, user_chat_id: 9, is_enabled: true } });
    await fetch(base + '/api/settings', { method: 'POST', headers: authH(42), body: JSON.stringify({ layers: { trace: false } }) });
    await bot.handle(bm('bc9', 7, 1, 'Привет, это секрет'));
    const n = tg.calls.length;
    await bot.handle({ deleted_business_messages: { business_connection_id: 'bc9', chat: { id: 7 }, message_ids: [1] } });
    assert.strictEqual(tg.calls.length, n);
    const feed = await (await fetch(base + '/api/feed', { headers: authH(42) })).json();
    const m = feed.messages[0]; assert.strictEqual(m.deleted, true); assert.strictEqual(m.edited, false); assert.match(m.deletedTime, /\d\d:\d\d/);
    assert.strictEqual(db.purge(T0 + 1000), 1);                                                  // всё старше точки — стирается
    assert.strictEqual(db.feed(42, 0).length, 0);
  });
});

const HOUR = 3600000;
const bmOut = (conn, chatId, id, text, t = T0, owner = 1) => ({ business_message: { business_connection_id: conn, message_id: id, date: t / 1000, chat: { id: chatId, first_name: 'Чат' + chatId }, from: { id: owner }, text } });
const bmIn = (conn, chatId, id, text, t = T0) => ({ business_message: { business_connection_id: conn, message_id: id, date: t / 1000, chat: { id: chatId, first_name: 'Чат' + chatId }, from: { id: chatId }, text } });
const reminders = require('../server/reminders');
const insights = require('../server/insights');
const alertsMod = require('../server/alerts');

test('ответ владельца: сохраняется для поиска, закрывает «ждущие ответа», в ленту не попадает', async () => {
  const { db, bot } = setup(new Set([1]));
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  await bot.handle(bmIn('u1', 7, 1, 'Подпиши акт до 18:00', T0));
  assert.strictEqual(db.pendingReplies(T0 + 4 * HOUR).length, 1);
  await bot.handle(bmOut('u1', 7, 2, 'Подпишу до 17:00', T0 + 60000));
  assert.strictEqual(db.pendingReplies(T0 + 4 * HOUR).length, 0);
  assert.strictEqual(db.feed(1, 0).length, 1);                                  // только входящее
  assert.strictEqual(db.allSince(1, 0).length, 2);                              // оба — для поиска
  await bot.handle(bmOut('u1', 999, 3, 'пишу в чат, которого слой не знает', T0));   // неизвестный чат не сохраняем
  assert.strictEqual(db.allSince(1, 0).length, 2);
});

test('«Ты не ответил»: через 3 ч, потом через 9 ч, не больше двух раз; не ночью; отвеченное, отложенное и выключенное — нет', async () => {
  const clock = { t: T0 };
  const { db, tg, bot } = setup(new Set([1]), 555, clock);
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  await bot.handle(bmIn('u1', 7, 1, 'Подпиши акт до 18:00'));
  await bot.handle(bmIn('u1', 8, 2, 'Скинь файл до пятницы'));
  await bot.handle(bmOut('u1', 8, 3, 'скинул', T0 + 1000));                                   // этот чат отвечен
  const base = { db, tg, openBtn: bot.openBtn, tz: 'Europe/Moscow', adminIds: new Set([1]) };
  const n0 = tg.calls.length;
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 2 * HOUR }), 0);                // рано
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 3 * HOUR }), 1);                // 17:12 — напомнили про Чат7
  const r = tg.calls.at(-1); assert.match(r.params.text, /Ты не ответил/); assert.match(r.params.text, /Чат7/); assert.doesNotMatch(r.params.text, /Чат8/);
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 4 * HOUR }), 0);                // повтор раньше срока — нет
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 12 * HOUR }), 0);              // 02:12 ночью — тишина
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 18 * HOUR }), 1);              // 08:12 утром — второе напоминание
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 40 * HOUR }), 0);              // больше двух раз не напоминаем
  assert.strictEqual(tg.calls.length - n0, 2);
  // выключенный слой и отложенное
  await bot.handle(bmIn('u1', 9, 4, 'Позвони мне', T0 + 20 * HOUR));
  db.setSettings(1, { layers: { remind: false } });
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 24 * HOUR }), 0);
  db.setSettings(1, {}); db.snooze(1, db.findMessage('u1', 9, 4).id, T0 + 30 * HOUR);
  assert.strictEqual(await reminders.tick({ ...base, now: T0 + 25 * HOUR }), 0);
});

test('тихие часы и ★ важные люди: ночью обычные просьбы молчат, ★ — всегда; любое сообщение ★ уведомляет', async () => {
  const clock = { t: new Date('2026-11-18T02:30:00+03:00').getTime() };
  const { db, tg, bot } = setup(new Set(), 555, clock);
  await bot.handle({ business_connection: { id: 'u1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  const n0 = tg.calls.length;
  await bot.handle(bmIn('u1', 7, 1, 'Подпиши акт до 18:00', clock.t));                         // ночью, не ★ — молчим
  assert.strictEqual(tg.calls.length, n0); assert.strictEqual(db.feed(1, 0).length, 1);          // но в ленте он есть
  db.setSettings(1, { vip: [8] });
  await bot.handle(bmIn('u1', 8, 2, 'Привет!', clock.t));                                        // ★: даже «Привет» и даже ночью
  assert.match(tg.calls.at(-1).params.text, /★ Чат8/);
  db.setSettings(1, { layers: { quiet: false }, vip: [8] });                                      // тихие часы выключены
  await bot.handle(bmIn('u1', 9, 3, 'Позвони мне', clock.t));
  assert.match(tg.calls.at(-1).params.text, /RADAR · Чат9/);
});

test('«Спроси слой»: поиск по имени и словам, «что я обещал Дане», «вчера», «на прошлой неделе»', () => {
  const day = 86400000;
  const row = (id, name, text, ts, out = 0) => ({ id, chat_name: name, text, ts, out, deleted_at: 0 });
  const rows = [
    row(1, 'Даня М.', 'Подпиши акт до 18:00', T0 - 2 * HOUR), row(2, 'Даня М.', 'Подпишу до 17:00, скину скан', T0 - HOUR, 1),
    row(3, 'Маша', 'Скинь конспект по матану', T0 - day), row(4, 'Мама', 'Купить хлеб?', T0 - 10 * day), row(5, 'Маша', 'привет', T0 - 2 * HOUR),
  ];
  const ask = (q) => insights.search(rows, q, { now: T0 });
  const promised = ask('Что я обещал Дане?');
  assert.strictEqual(promised[0].id, 2); assert.ok(promised.every((r) => r.name === 'Даня М.'));    // мои слова — первыми
  assert.deepStrictEqual(ask('конспект').map((r) => r.id), [3]);                                    // по словам
  assert.deepStrictEqual(ask('что писала Маша вчера').map((r) => r.id), [3]);                      // «вчера»
  assert.deepStrictEqual(ask('хлеб на прошлой неделе').map((r) => r.id), [4]);
  assert.deepStrictEqual(ask('что-то совсем другое'), []);
  assert.deepStrictEqual(ask('что я'), []);                                                         // только «стоп-слова» — пусто
});

test('Неделя в цифрах: получено / важное / тишина / ответов / среднее время ответа', () => {
  const rows = [
    { ts: T0 - HOUR, level: 'act', out: 0, answered_at: T0 - HOUR + 30 * 60000 }, { ts: T0 - 2 * HOUR, level: 'quiet', out: 0, answered_at: 0 },
    { ts: T0 - 3 * HOUR, level: 'know', out: 0, answered_at: T0 - 3 * HOUR + 90 * 60000 }, { ts: T0 - 30 * HOUR, level: 'act', out: 0, answered_at: 0 }, { ts: T0, level: 'out', out: 1 },
  ];
  const w = insights.weekStats(rows, { now: T0 });
  assert.strictEqual(w.received, 4); assert.strictEqual(w.important, 3); assert.strictEqual(w.quiet, 1); assert.strictEqual(w.sent, 1);
  assert.strictEqual(w.answered, 2); assert.strictEqual(w.avgReplyMin, 60); assert.strictEqual(w.days.length, 7);
  assert.strictEqual(w.days.reduce((a, d) => a + d.total, 0), 4);
});

test('API: ★ важный человек, поиск, неделя; чужие данные не видны', async () => {
  await withServer(async ({ base, bot }) => {
    await bot.handle({ business_connection: { id: 'bc9', user: { id: 42 }, user_chat_id: 9, is_enabled: true } });
    await bot.handle(bmIn('bc9', 7, 1, 'Подпиши акт до 18:00', T0 - 60000)); await bot.handle(bmOut('bc9', 7, 2, 'Подпишу до 17:00', T0 - 1000, 42));   // оба «в прошлом» относительно часов сервера
    const post = (path, o, id = 42) => fetch(base + path, { method: 'POST', headers: authH(id), body: JSON.stringify(o) });
    assert.strictEqual((await post('/api/vip', { chatId: 7, on: true })).status, 200);
    assert.strictEqual((await post('/api/vip', { chatId: 'x', on: true })).status, 400);
    const feed = await (await fetch(base + '/api/feed', { headers: authH(42) })).json();
    assert.strictEqual(feed.messages[0].vip, true); assert.strictEqual(feed.messages[0].chatId, 7);
    const found = await (await post('/api/ask', { q: 'что я обещал Чат7' })).json();
    assert.strictEqual(found.results[0].out, true); assert.match(found.results[0].text, /17:00/);
    assert.strictEqual((await post('/api/ask', { q: 'Чат7' }, 99)).status, 402);                      // на СТАРТЕ поиск закрыт
    assert.strictEqual((await post('/api/ask', { q: '' })).status, 400);
    const w = await (await fetch(base + '/api/week', { headers: authH(42) })).json();
    assert.strictEqual(w.received, 1); assert.strictEqual(w.sent, 1);
    await post('/api/vip', { chatId: 7, on: false });
    assert.strictEqual((await (await fetch(base + '/api/feed', { headers: authH(42) })).json()).messages[0].vip, false);
  });
});

test('резервная копия и оповещения: копия базы, хранится 7, /backup только админу; оповещение не чаще раза в 10 минут', async () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sloy-bk-'));
  const { db, tg, bot } = setup(new Set([1]), 555, { t: T0 }, () => alertsMod.makeBackup(db, dir, T0));
  db.upsertUser(1, T0);
  const f = alertsMod.makeBackup(db, dir, T0);
  assert.ok(fs.existsSync(f)); assert.match(path.basename(f), /^sloy-2026-11-17\.db$/);
  const copy = require('../server/db').openDb(f); assert.strictEqual(copy.getUser(1).id, 1);   // копия — рабочая база
  for (let d = 1; d <= 9; d++) alertsMod.makeBackup(db, dir, T0 + d * 86400000);
  assert.strictEqual(fs.readdirSync(dir).filter((x) => /\.db$/.test(x)).length, 7);
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/backup' } });
  assert.strictEqual(tg.calls.at(-1).method, 'sendDocument'); assert.strictEqual(tg.calls.at(-1).field, 'document');
  const n = tg.calls.length;
  await bot.handle({ message: { chat: { id: 2 }, from: { id: 2 }, text: '/backup' } });
  assert.strictEqual(tg.calls.length, n);                                                       // не админ — ничего
  let t = T0; const sent = []; const alert = alertsMod.createAlerter({ tg: { call: async (m, p) => sent.push(p) }, adminIds: new Set([1]), now: () => t });
  assert.strictEqual(await alert('упал'), true); assert.strictEqual(await alert('снова'), false);
  t += 11 * 60000; assert.strictEqual(await alert('ещё'), true); assert.strictEqual(sent.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('тарифы: СТАРТ без ответов/напоминаний/поиска/«След»; СЛОЙ — без «След»; МАКС и админ — всё', async () => {
  const clock = { t: T0 };
  const { db, tg, bot } = setup(new Set(), 555, clock);
  await bot.handle({ business_connection: { id: 'c5', user: { id: 5 }, user_chat_id: 55, is_enabled: true } }); noTrial(db, 5);
  await bot.handle(bmIn('c5', 7, 1, 'Подпиши акт до 18:00', T0 - 4 * HOUR));
  const base = { db, tg, openBtn: bot.openBtn, tz: 'Europe/Moscow', adminIds: new Set() };
  assert.strictEqual(await reminders.tick({ ...base, now: T0 }), 0);                         // СТАРТ: напоминаний нет
  db.setPlan(5, 'sloy', T0 + 30 * 86400000);
  assert.strictEqual(await reminders.tick({ ...base, now: T0 }), 1);                         // СЛОЙ: напоминание пришло
  const n = tg.calls.length;
  await bot.handle({ deleted_business_messages: { business_connection_id: 'c5', chat: { id: 7 }, message_ids: [1] } });
  assert.strictEqual(tg.calls.length, n);                                                    // СЛОЙ: «След» не уведомляет
  await bot.handle(bmIn('c5', 7, 2, 'Привет, второе', T0));
  db.setPlan(5, 'max', T0 + 30 * 86400000);
  const n2 = tg.calls.length;
  await bot.handle({ deleted_business_messages: { business_connection_id: 'c5', chat: { id: 7 }, message_ids: [2] } });
  assert.match(tg.calls.at(-1).params.text, /Удалено/); assert.strictEqual(tg.calls.length, n2 + 1);   // МАКС: уведомляет
});

test('пробная неделя: МАКС новым один раз; предупреждение за сутки и сообщение об окончании; оплата гасит пробный; админам не даётся', async () => {
  const clock = { t: T0 };
  const { db, tg, bot } = setup(new Set([1]), 555, clock);
  await bot.handle({ business_connection: { id: 'n1', user: { id: 7 }, user_chat_id: 77, is_enabled: true } });
  const u = db.getUser(7);
  assert.strictEqual(u.plan, 'max'); assert.strictEqual(u.plan_until, T0 + TRIAL_MS); assert.strictEqual(u.trial_state, 1);
  assert.match(tg.calls.at(-1).params.text, /подарок/i);
  // переподключение подарок не повторяет
  await bot.handle({ business_connection: { id: 'n1', user: { id: 7 }, user_chat_id: 77, is_enabled: false } });
  db.setPlan(7, 'start', 0); db.setTrialState(7, 3);
  await bot.handle({ business_connection: { id: 'n1', user: { id: 7 }, user_chat_id: 77, is_enabled: true } });
  assert.strictEqual(db.getUser(7).plan, 'start');
  // админу подарок не нужен
  await bot.handle({ business_connection: { id: 'a1', user: { id: 1 }, user_chat_id: 11, is_enabled: true } });
  assert.strictEqual(db.getUser(1).trial_state, 0);
  // расписание сообщений
  await bot.handle({ business_connection: { id: 'n2', user: { id: 8 }, user_chat_id: 88, is_enabled: true } });
  const base = { db, tg, openBtn: bot.openBtn };
  const n = tg.calls.length;
  assert.strictEqual(await trialMod.tick({ ...base, now: T0 + 3 * 86400000 }), 0);                       // середина — тишина
  assert.strictEqual(await trialMod.tick({ ...base, now: T0 + TRIAL_MS - 3600000 }), 1);                 // за час до конца — предупреждение
  assert.match(tg.calls.at(-1).params.text, /Завтра закончится/);
  assert.strictEqual(await trialMod.tick({ ...base, now: T0 + TRIAL_MS - 1800000 }), 0);                 // повторно не предупреждаем
  assert.strictEqual(await trialMod.tick({ ...base, now: T0 + TRIAL_MS + 1000 }), 1);
  assert.match(tg.calls.at(-1).params.text, /закончилась/); assert.strictEqual(db.getUser(8).trial_state, 3);
  assert.strictEqual(await trialMod.tick({ ...base, now: T0 + TRIAL_MS + 2000 }), 0);
  // после окончания тариф — СТАРТ
  assert.strictEqual(require('../server/plans').activePlan(db.getUser(8), T0 + TRIAL_MS + 5000).id, 'start');
  // оплата во время пробного гасит его
  await bot.handle({ business_connection: { id: 'n3', user: { id: 9 }, user_chat_id: 99, is_enabled: true } });
  await bot.handle({ message: { chat: { id: 99 }, from: { id: 9 }, successful_payment: { invoice_payload: 'plan:sloy:9', currency: 'XTR', total_amount: 150 } } });
  assert.strictEqual(db.getUser(9).trial_state, 3); assert.strictEqual(db.getUser(9).plan, 'sloy');
});

test('/start и /connect объясняют, что нужен Telegram Premium, и ведут на гид подключения', async () => {
  const { tg, bot } = setup();
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/start' } });
  await bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/connect' } });
  for (const c of tg.calls.slice(-2)) {
    assert.match(c.params.text, /Premium/); assert.match(c.params.text, /Telegram Business/);
    assert.match(c.params.reply_markup.inline_keyboard[0][0].web_app.url, /\?r=connect$/);
  }
});

test('страницы /privacy и /terms: реквизиты из настроек, экранирование, ссылки в /terms бота', async () => {
  const { db, tg, bot } = setup();
  const handler = createApp({ botToken: TOKEN, webhookSecret: 's', db, tg, bot, webDir: __dirname + '/../web', botUsername: 'sloy_test_bot', supportContact: 'help_nick',
    legal: { OPERATOR_NAME: 'ИП <Иванов> & Ко', OPERATOR_INFO: 'ИНН 1234', KEEP_DAYS: '30' }, now: () => T0 });
  const srv = http.createServer(handler); await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const priv = await fetch(base + '/privacy'); const html = await priv.text();
    assert.strictEqual(priv.status, 200); assert.match(priv.headers.get('content-type'), /text\/html/);
    assert.match(html, /ИП &lt;Иванов&gt; &amp; Ко/);            // реквизиты подставлены и экранированы
    assert.match(html, /@help_nick/); assert.match(html, /@sloy_test_bot/); assert.match(html, /30 дней/);
    assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);               // не осталось неподставленных меток
    const terms = await (await fetch(base + '/terms')).text();
    assert.match(terms, /Telegram Premium/); assert.match(terms, /не продлевается автоматически/);
    assert.strictEqual((await fetch(base + '/privacy.html')).status, 200);
  } finally { srv.close(); }
  // без настроек оператор помечен как не указанный, а не выдуманный
  const h2 = createApp({ botToken: TOKEN, webhookSecret: 's', db, tg, bot, webDir: __dirname + '/../web', now: () => T0 });
  const s2 = http.createServer(h2); await new Promise((r) => s2.listen(0, r));
  try { assert.match(await (await fetch('http://127.0.0.1:' + s2.address().port + '/privacy')).text(), /оператор не указан/); } finally { s2.close(); }
  const b2 = createBotForTerms();
  await b2.bot.handle({ message: { chat: { id: 1 }, from: { id: 1 }, text: '/terms' } });
  assert.match(b2.tg.calls.at(-1).params.text, /https:\/\/sloy\.example\/privacy/);
  function createBotForTerms() { const tg = fakeTg(); return { tg, bot: createBot({ tg, db: openDb(':memory:'), webappUrl: 'https://sloy.example' }) }; }
});

test('события: открытие — раз в сутки, остальные один раз, оплаты все; воронка по когорте, возвращаемость, пробный, выручка', () => {
  const db = openDb(':memory:'); const DAYMS = 86400000;
  db.addEvent(1, 'open', T0, { daily: true }); db.addEvent(1, 'open', T0 + HOUR, { daily: true }); db.addEvent(1, 'open', T0 + DAYMS, { daily: true });
  db.addEvent(1, 'start', T0); db.addEvent(1, 'start', T0 + 5);
  db.addEvent(1, 'payment', T0 + 1, { amount: 150 }); db.addEvent(1, 'payment', T0 + 2, { amount: 150 });
  const ev = db.allEvents();
  assert.strictEqual(ev.filter((e) => e.kind === 'open').length, 2); assert.strictEqual(ev.filter((e) => e.kind === 'start').length, 1); assert.strictEqual(ev.filter((e) => e.kind === 'payment').length, 2);
  // 4 человека + админ (99)
  const now = T0 + 20 * DAYMS, d0 = T0;
  const E = (u, kind, ts, extra = {}) => ({ user_id: u, kind, ts, day: kind === 'open' ? new Date(ts).toISOString().slice(0, 10) : '', amount: extra.amount || 0 });
  const events = [
    E(10, 'start', d0), E(10, 'connected', d0 + 1), E(10, 'trial', d0 + 1), E(10, 'notified', d0 + 2), E(10, 'open', d0 + 3), E(10, 'open', d0 + 8 * DAYMS), E(10, 'paywall', d0 + 8 * DAYMS), E(10, 'payment', d0 + 8 * DAYMS + 5, { amount: 150 }),
    E(11, 'start', d0 + 10), E(11, 'connected', d0 + 11), E(11, 'trial', d0 + 11), E(11, 'notified', d0 + 12), E(11, 'open', d0 + 13),
    E(12, 'start', d0 + 14), E(12, 'connected', d0 + 15),
    E(13, 'start', now - DAYMS),                                                              // новый, в последние сутки
    E(99, 'start', d0), E(99, 'connected', d0), E(99, 'payment', d0, { amount: 1000 }),       // админ — не считается
  ];
  const f = insights.funnel(events, { now, exclude: new Set([99]) });
  const n = (k) => f.stages.find((x) => x.key === k).n;
  assert.deepStrictEqual([n('joined'), n('connected'), n('notified'), n('open'), n('return'), n('paywall'), n('payment')], [4, 3, 2, 2, 1, 1, 1]);
  assert.strictEqual(f.revenue, 150);                                                            // выручка админа не в счёт
  assert.deepStrictEqual(f.trial, { started: 2, ended: 2, paid: 1 });
  assert.deepStrictEqual(f.retention, { eligible: 3, returned: 1 });                            // трое подключены ≥7 дней назад, вернулся один
  assert.strictEqual(f.active7, 0);
  const last7 = insights.funnel(events, { now, days: 7, exclude: new Set([99]) });
  assert.strictEqual(last7.stages[0].n, 1);                                                      // в окне 7 дней пришёл один человек
});

test('события пишутся: /start, подключение, подарок, первое уведомление, оплата; /api/track и воронка для админа', async () => {
  const clock = { t: T0 };
  const { db, tg, bot } = setup(new Set([1]), 555, clock);
  await bot.handle({ message: { chat: { id: 7 }, from: { id: 7 }, text: '/start' } });
  await bot.handle({ business_connection: { id: 'e1', user: { id: 7 }, user_chat_id: 77, is_enabled: true } });
  await bot.handle(bmIn('e1', 8, 1, 'Подпиши акт до 18:00'));
  await bot.handle({ message: { chat: { id: 7 }, from: { id: 7 }, successful_payment: { invoice_payload: 'plan:sloy:7', currency: 'XTR', total_amount: 150 } } });
  const kinds = db.allEvents().filter((e) => e.user_id === 7).map((e) => e.kind).sort();
  assert.deepStrictEqual(kinds, ['connected', 'notified', 'payment', 'start', 'trial']);
  assert.strictEqual(db.allEvents().find((e) => e.kind === 'payment').amount, 150);
  await withServer(async ({ base }) => {
    const post = (path, o, id = 42) => fetch(base + path, { method: 'POST', headers: authH(id), body: JSON.stringify(o) });
    assert.strictEqual((await post('/api/track', { event: 'paywall' }, 99)).status, 200);
    assert.strictEqual((await post('/api/track', { event: 'payment' }, 99)).status, 400);        // подделать оплату нельзя
    await fetch(base + '/api/feed', { headers: authH(99) });                                       // открытие приложения
    assert.strictEqual((await fetch(base + '/api/admin/funnel', { headers: authH(99) })).status, 403);
    const f = await (await fetch(base + '/api/admin/funnel?days=0', { headers: authH(42) })).json();   // 42 — админ
    const st = (k) => f.stages.find((x) => x.key === k).n;
    assert.strictEqual(st('joined'), 1); assert.strictEqual(st('open'), 1); assert.strictEqual(st('paywall'), 1);   // админ в воронку не входит, пользователь 99 — входит
  });
});
