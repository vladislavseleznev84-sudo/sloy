'use strict';
// «Спроси слой» (поиск по сохранённым сообщениям) и «Неделя в цифрах». Всё считается на сервере по данным пользователя.
const STOP = new Set('что я мне меня про о об обо какой какая какие когда кто где как писал писала писали говорил говорила обещал обещала просил просила сказал сказала был была ли на в с по от до у и а но это этот вчера сегодня неделе недели прошлой этой последний последнее там тоже мой моя мои ему ей им нам вам ты вы мы он она они есть было нет покажи найди найти скажи напомни'.split(' '));
const tokens = (q) => (String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length >= 2 && !STOP.has(t));
const stem = (t) => (t.length > 5 ? t.slice(0, t.length - 2) : t.length > 3 ? t.slice(0, t.length - 1) : t);

function dayStart(now, tz, back = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  const base = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`).getTime();
  // сдвиг часового пояса: разница между «полночью в UTC» и тем же моментом в tz
  const off = new Date(new Date(base).toLocaleString('en-US', { timeZone: tz })).getTime() - new Date(new Date(base).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return base - off - back * 86400000;
}

function search(rows, query, { now = Date.now(), tz = 'Europe/Moscow' } = {}) {
  const q = String(query || '').toLowerCase();
  let from = 0, to = now + 1;
  if (/вчера/.test(q)) { from = dayStart(now, tz, 1); to = dayStart(now, tz, 0); }
  else if (/сегодня/.test(q)) { from = dayStart(now, tz, 0); }
  else if (/прошл\p{L}*\s+недел/u.test(q)) { from = now - 14 * 86400000; to = now - 7 * 86400000; }
  else if (/(этой|эту)\s+недел|за\s+недел/.test(q)) { from = now - 7 * 86400000; }
  const toks = tokens(q); if (!toks.length) return [];
  const promised = /обещ|договорил|скажу|сделаю/.test(q);
  const out = [];
  for (const r of rows) {
    if (r.ts < from || r.ts >= to) continue;
    const name = r.chat_name.toLowerCase(), text = r.text.toLowerCase();
    let score = 0, nameHit = false;
    for (const t of toks) {
      const s = stem(t);
      if (name.split(/\s+/).some((w) => w.startsWith(s.slice(0, Math.max(3, s.length - 1))) || s.startsWith(w.slice(0, 3)) && w.length >= 3 && s.length >= 3 && w.slice(0, 3) === s.slice(0, 3))) { score += 3; nameHit = true; }
      else if (text.includes(s)) score += 2;
    }
    if (!score) continue;
    if (promised && r.out) score += 2;
    out.push({ id: r.id, name: r.chat_name, ts: r.ts, text: r.text, out: !!r.out, deleted: r.deleted_at > 0, score, nameHit });
  }
  return out.sort((a, b) => b.score - a.score || b.ts - a.ts).slice(0, 8);
}

function weekStats(rows, { now = Date.now(), tz = 'Europe/Moscow' } = {}) {
  const days = []; for (let i = 6; i >= 0; i--) days.push({ start: dayStart(now, tz, i), total: 0, important: 0 });
  let received = 0, important = 0, answered = 0, sent = 0, replySum = 0, replyN = 0;
  for (const r of rows) {
    if (r.ts < days[0].start) continue;
    if (r.out) { sent++; continue; }
    received++; const imp = r.level === 'act' || r.level === 'know'; if (imp) important++;
    if (r.answered_at > 0 && imp) { answered++; replySum += r.answered_at - r.ts; replyN++; }
    for (let i = days.length - 1; i >= 0; i--) if (r.ts >= days[i].start) { days[i].total++; if (imp) days[i].important++; break; }
  }
  return {
    received, important, quiet: received - important, sent, answered,
    avgReplyMin: replyN ? Math.round(replySum / replyN / 60000) : null,
    days: days.map((d) => ({ total: d.total, important: d.important })),
  };
}

// Воронка по событиям. Когорта = люди, впервые появившиеся в выбранном окне (days=0 — всё время). Админы исключаются.
function funnel(events, { now = Date.now(), days = 0, exclude = new Set() } = {}) {
  const DAY = 86400000, users = new Map();
  for (const e of events) {
    if (exclude.has(e.user_id)) continue;
    let u = users.get(e.user_id); if (!u) users.set(e.user_id, (u = { first: e.ts, kinds: new Set(), openDays: new Set(), connectedAt: 0, trialAt: 0, payAt: 0, lastOpen: 0, opens: [] }));
    u.first = Math.min(u.first, e.ts); u.kinds.add(e.kind);
    if (e.kind === 'open') { u.openDays.add(e.day); u.lastOpen = Math.max(u.lastOpen, e.ts); u.opens.push(e.ts); }
    if (e.kind === 'connected' && !u.connectedAt) u.connectedAt = e.ts;
    if (e.kind === 'trial' && !u.trialAt) u.trialAt = e.ts;
    if (e.kind === 'payment' && !u.payAt) u.payAt = e.ts;
  }
  const since = days ? now - days * DAY : 0;
  const cohort = [...users.values()].filter((u) => u.first >= since);
  const has = (k) => cohort.filter((u) => u.kinds.has(k)).length;
  const stages = [
    { key: 'joined', label: 'Пришли', n: cohort.length },
    { key: 'connected', label: 'Подключили бота', n: has('connected') },
    { key: 'notified', label: 'Получили первое уведомление', n: has('notified') },
    { key: 'open', label: 'Открыли приложение', n: has('open') },
    { key: 'return', label: 'Вернулись в другой день', n: cohort.filter((u) => u.openDays.size >= 2).length },
    { key: 'paywall', label: 'Дошли до тарифов', n: has('paywall') },
    { key: 'payment', label: 'Оплатили', n: has('payment') },
  ];
  const eligible = [...users.values()].filter((u) => u.connectedAt && u.connectedAt <= now - 7 * DAY);
  const returned = eligible.filter((u) => u.opens.some((t) => t >= u.connectedAt + 6 * DAY)).length;
  const trial = [...users.values()].filter((u) => u.trialAt);
  const revenue = events.filter((e) => e.kind === 'payment' && !exclude.has(e.user_id) && e.ts >= since).reduce((a, e) => a + e.amount, 0);
  return {
    stages,
    active7: [...users.values()].filter((u) => u.lastOpen >= now - 7 * DAY).length,
    revenue,
    trial: { started: trial.length, ended: trial.filter((u) => u.trialAt + 7 * DAY < now).length, paid: trial.filter((u) => u.payAt && u.payAt >= u.trialAt).length },
    retention: { eligible: eligible.length, returned },
  };
}

module.exports = { search, weekStats, tokens, dayStart, funnel };
