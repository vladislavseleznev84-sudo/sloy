'use strict';
// Анализ входящего сообщения. Сейчас — прозрачные правила (работают без ключей и без сети).
// Интерфейс analyze(text, {now}) заменяемый: позже сюда встаёт LLM, формат результата тот же.
//
// Результат: { level: 'act'|'know'|'quiet', tag, segs, fullSegs, note, ask, deadline, left, reply }
// segs: массив строк и пар [текст, 'hl'|'ul'] — их рисует Mini App (hl = маркер, ul = подчёркивание).

const DAYS = 'понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья';
const RE = {
  time: /(?<![а-яёa-z])(?:до|к|в)\s+(\d{1,2})[:.](\d{2})(?!\d)/i,
  day: new RegExp('(?<![а-яёa-z])до\\s+(' + DAYS + ')(?![а-яёa-z])', 'i'),
  rel: /(?<![а-яёa-z])(сегодня|завтра|послезавтра)(?![а-яёa-z])(?:\s+в\s+\d{1,2}[:.]\d{2})?/i,
  urgent: /срочно|горит|как можно скорее|asap/i,
  ask: /(?:^|[\s,.!])(подпиши|подпишите|скинь|скиньте|пришли|пришлите|отправь|отправьте|сделай|сделайте|ответь|позвони|напомни|оплати|оплатите|купи|проверь|посмотри|подтверди|согласуй|нужно|надо|сможешь|можешь|не забудь)(?=[\s,.!?]|$)/i,
  promo: /(бонус|баллов|скидк|акци[яи]|промокод|распродаж|кэшбэк|заказ будет|курьер|доставк|код подтверждения|rate us|подписывайтесь)/i,
  question: /(когда|где|во сколько|как|почему|что)\s+[а-яёa-z]+[^?]*\?/i,
};

function splitAround(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length), m];
}

function minutesLeft(h, mi, now, tz) {
  // «Сейчас» в часовом поясе пользователя, а не сервера.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const nh = Number(parts.find((p) => p.type === 'hour').value), nm = Number(parts.find((p) => p.type === 'minute').value);
  const diff = h * 60 + mi - (nh * 60 + nm);
  return diff > 0 ? diff : null;
}
function fmtLeft(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return 'ещё ' + (h ? h + ' ч ' : '') + (m ? m + ' мин' : '').trim();
}
function pad(n) { return String(n).padStart(2, '0'); }

function analyze(text, { now = Date.now(), tz = 'Europe/Moscow' } = {}) {
  const t = String(text || '').trim();
  if (!t) return quiet(t);
  if (RE.promo.test(t) && !RE.ask.test(t)) return quiet(t);

  const hasAsk = RE.ask.test(t);
  const urgent = RE.urgent.test(t);
  let hit = null, deadline = '', left = '';

  const time = splitAround(t, RE.time), day = splitAround(t, RE.day), rel = splitAround(t, RE.rel);
  if (time) {
    hit = time;
    const hh = Number(time[3][1]), mm = Number(time[3][2]);
    deadline = 'Сегодня, ' + pad(hh) + ':' + pad(mm);
    left = fmtLeft(minutesLeft(hh, mm, now, tz));
  } else if (day) {
    hit = day; deadline = 'До ' + day[3][1];
  } else if (rel) {
    hit = rel; deadline = rel[3][1][0].toUpperCase() + rel[3][1].slice(1);
  }

  const isAct = hasAsk || Boolean(hit) || urgent;
  if (isAct) {
    const segs = hit ? [hit[0], [hit[1], 'hl'], hit[2]].filter((s) => s !== '') : [t];
    const asked = firstSentenceWith(t, RE.ask) || t;
    return {
      level: 'act',
      tag: urgent || (time && left) ? 'Срочно' : hit ? 'Дата' : 'Просьба',
      segs, fullSegs: segs,
      note: deadline ? (urgent || time ? 'срок — сегодня' : 'поставить напоминание?') : 'ответь, когда сможешь',
      ask: asked.replace(/[.!]+$/, '') + '.',
      deadline: deadline || 'Без срока', left,
      reply: suggestReply(t, hit, deadline),
    };
  }

  const q = splitAround(t, RE.question);
  if (q || /\?/.test(t)) {
    const word = /(когда|где|во сколько)\s+([а-яёa-z]+)/i.exec(t);
    let segs = [t];
    if (word) { const i = t.indexOf(word[0]); segs = [t.slice(0, i + word[1].length + 1), [word[2], 'ul'], t.slice(i + word[0].length)].filter((s) => s !== ''); }
    return {
      level: 'know', tag: 'Личное', segs, fullSegs: segs,
      note: 'просто знай', ask: 'Ответить на вопрос.', deadline: 'Без срока', left: '',
      reply: { tone: 'Тепло', text: 'Привет! Отвечу чуть позже, хорошо?' },
    };
  }
  return quiet(t);
}

function firstSentenceWith(t, re) {
  const parts = t.split(/(?<=[.!?])\s+/);
  return parts.find((p) => re.test(p)) || null;
}
function suggestReply(t, hit, deadline) {
  const tm = /(\d{1,2})[:.](\d{2})/.exec(hit ? hit[1] : '');
  if (tm) {
    const h = Math.max(0, Number(tm[1]) - 1);
    return { tone: 'Деловой', text: 'Сделаю до ' + pad(h) + ':' + tm[2] + ', дам знать.' };
  }
  if (deadline) return { tone: 'Деловой', text: 'Принял, успею в срок.' };
  return { tone: 'Тепло', text: 'Принял, скоро отвечу.' };
}
function quiet(t) {
  return { level: 'quiet', tag: '', segs: [t], fullSegs: [t], note: '', ask: '', deadline: '', left: '', reply: null };
}

module.exports = { analyze };
