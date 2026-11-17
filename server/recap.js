'use strict';
// Вечерний RECAP: сводка за последние 24 часа. Отправляется ботом раз в сутки в 21:00 по времени пользователя
// (или по команде /recap).
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const short = (t, n = 60) => { const x = String(t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };

function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

function buildRecap(db, userId, now, botId = 0) {
  const rows = db.feed(userId, now - 86400000).filter((r) => !botId || r.chat_id !== botId);
  if (!rows.length) return null;
  const important = rows.filter((r) => r.level !== 'quiet' && !(r.snoozed_until > now)).slice(0, 5);
  const quiet = rows.length - important.length;
  const lines = important.map((r) => `• ${esc(r.chat_name)}: ${esc(short(r.text))}`);
  const text = important.length
    ? `<b>RECAP · за сутки</b>\n${lines.join('\n')}\n\nОстальное — тишина (${quiet}).`
    : `<b>RECAP · за сутки</b>\nСегодня тихо: ничего важного. Сообщений в тишине: ${quiet}.`;
  return { text, important: important.length, quiet };
}

async function tick({ db, tg, openBtn, tz, botId, hour = 21, now = Date.now() }) {
  const t = localParts(now, tz);
  if (t.hour !== hour) return 0;
  let sent = 0;
  for (const u of db.recapUsers()) {
    if (u.last_recap === t.day) continue;
    const settings = db.getSettings(u.id);
    if (settings.layers && settings.layers.recap === false) continue;
    const conn = db.userConnection(u.id);
    const r = buildRecap(db, u.id, now, botId);
    db.setLastRecap(u.id, t.day);                       // отметка до отправки: сбой не приведёт к повторам
    if (!r || !conn) continue;
    try { await tg.call('sendMessage', { chat_id: conn.user_chat_id, parse_mode: 'HTML', text: r.text, reply_markup: openBtn('Открыть страницу дня') }); sent++; }
    catch (e) { console.error('recap:', e.message); }
  }
  return sent;
}

function start(opts) { return setInterval(() => tick({ ...opts, now: Date.now() }).catch((e) => console.error('recap tick:', e.message)), 60000); }

module.exports = { buildRecap, tick, start, localParts };
