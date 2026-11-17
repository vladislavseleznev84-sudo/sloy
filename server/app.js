'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateInitData } = require('./validate');
const { PLANS, activePlan } = require('./plans');
const insights = require('./insights');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function initials(name) {
  const p = String(name).replace(/[«»"]/g, '').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[1][0] : '')).toUpperCase();
}

function createApp({ botToken, webhookSecret, db, tg, bot, webDir, tz = 'Europe/Moscow', adminIds = new Set(), botId = 0, botUsername = '', supportContact = '', legal = {}, onError = () => {}, now = () => Date.now() }) {
  const fmtTime = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });

  function buildFeed(userId, plan) {
    const vipSet = new Set((db.getSettings(userId).vip) || []);
    const since = now() - 24 * 3600 * 1000;
    const rows = db.feed(userId, since).filter((r) => (!botId || r.chat_id !== botId) && !(r.snoozed_until > now()));
    const items = rows.map((r) => {
      const a = JSON.parse(r.analysis);
      const history = JSON.parse(r.history || '[]').map((h) => ({ text: h.text, time: fmtTime.format(h.at) }));
      const trace = !plan || plan.features.trace;           // «След» виден только на МАКС
      return { id: String(r.id), chatId: r.chat_id, vip: vipSet.has(r.chat_id), name: r.chat_name, ini: initials(r.chat_name), time: fmtTime.format(r.ts), ...a, deleted: trace && r.deleted_at > 0, deletedTime: trace && r.deleted_at ? fmtTime.format(r.deleted_at) : '', edited: trace && r.edited_at > 0, history: trace ? history : [] };
    });
    const important = items.filter((m) => m.level !== 'quiet');
    const quiet = items.filter((m) => m.level === 'quiet');
    const chats = new Set(rows.map((r) => r.chat_id)).size;
    return {
      now: { date: fmtDate.format(now()), time: fmtTime.format(now()), total: items.length, listening: chats, of: null },
      messages: [...important, ...quiet.slice(0, 2)],
      quietCount: Math.max(0, quiet.length - 2),
      settings: db.getSettings(userId),
      facts: db.facts(userId).map((f) => ({ t: f.title, s: f.body })),
      connected: Boolean(db.userConnection(userId)),
    };
  }

  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 65536) throw new Error('too large'); chunks.push(c); }
    const s = Buffer.concat(chunks).toString('utf8');
    return s ? JSON.parse(s) : {};
  }
  function auth(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('tma ')) return null;
    const v = validateInitData(h.slice(4), botToken, { now: now() });
    return v ? v.user : null;
  }

  async function api(req, res, url) {
    const user = auth(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    db.upsertUser(user.id, now());
    const isAdmin = adminIds.has(user.id);

    if (req.method === 'GET' && url.pathname === '/api/feed') {
      db.addEvent(user.id, 'open', now(), { daily: true });
      const u = db.getUser(user.id);
      const plan = activePlan(u, now(), isAdmin);
      const trial = (u.trial_state === 1 || u.trial_state === 2) && u.plan_until > now() ? { daysLeft: Math.max(1, Math.ceil((u.plan_until - now()) / 86400000)) } : null;
      return json(res, 200, { ...buildFeed(user.id, plan), plan: plan.id, features: plan.features, planUntil: u.plan_until, isAdmin, trial, botUsername, support: db.getConfig('support') || supportContact });
    }
    if (req.method === 'POST' && url.pathname === '/api/invoice') {
      const { plan } = await body(req);
      const p = PLANS[plan];
      if (!p || !p.stars) return json(res, 400, { error: 'bad plan' });
      const link = await tg.call('createInvoiceLink', {
        title: 'Билет «' + p.title + '»', description: 'Доступ к слоям СЛОЙ на 30 дней',
        payload: `plan:${p.id}:${user.id}`, currency: 'XTR', prices: [{ label: p.title + ' · 30 дней', amount: p.stars }],
      });
      return json(res, 200, { link });
    }
    if (req.method === 'POST' && url.pathname === '/api/reply') {
      const { id, text } = await body(req);
      const row = db.getMessage(user.id, Number(id));
      if (!row || typeof text !== 'string' || !text.trim() || text.length > 4000) return json(res, 400, { error: 'bad request' });
      if (!activePlan(db.getUser(user.id), now(), isAdmin).features.replies) return json(res, 402, { error: 'plan' });   // ответы — на платных тарифах
      const conn = db.getConnection(row.conn_id);
      if (!conn || !conn.enabled) return json(res, 409, { error: 'not connected' });
      try {
        await tg.call('sendMessage', { business_connection_id: conn.id, chat_id: row.chat_id, text: text.trim() });
        db.markAnswered(conn.id, row.chat_id, now());
      } catch (e) { return json(res, 502, { error: 'telegram', detail: e.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/track') {
      const { event } = await body(req);
      if (!['paywall', 'guide', 'onboarding', 'support'].includes(event)) return json(res, 400, { error: 'bad request' });
      db.addEvent(user.id, event, now());
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin) return json(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && url.pathname === '/api/admin/stats') return json(res, 200, db.stats(now()));
      if (req.method === 'GET' && url.pathname === '/api/admin/funnel') {
        const days = Math.max(0, Math.min(365, Number(url.searchParams.get('days')) || 0));
        return json(res, 200, insights.funnel(db.allEvents(), { now: now(), days, exclude: adminIds }));
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/grant') {
        const { userId, plan, days } = await body(req);
        const uid = Number(userId), d = Number(days);
        if (!Number.isInteger(uid) || uid <= 0 || !PLANS[plan] || !(d >= 0 && d <= 3650)) return json(res, 400, { error: 'bad request' });
        db.upsertUser(uid, now());
        if (plan === 'start' || d === 0) db.setPlan(uid, 'start', 0); else db.setPlan(uid, plan, now() + d * 86400000);
        return json(res, 200, { ok: true, user: db.getUser(uid) });
      }
      return json(res, 404, { error: 'not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/settings') {
      const { layers } = await body(req);
      const ok = ['radar', 'reply', 'memory', 'recap', 'auto', 'trace', 'remind', 'quiet'];
      if (!layers || typeof layers !== 'object') return json(res, 400, { error: 'bad request' });
      const clean = {}; for (const k of ok) if (typeof layers[k] === 'boolean') clean[k] = layers[k];
      const cur = db.getSettings(user.id); db.setSettings(user.id, { ...cur, layers: { ...(cur.layers || {}), ...clean } });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/vip') {
      const { chatId, on } = await body(req); const cid = Number(chatId);
      if (!Number.isInteger(cid) || typeof on !== 'boolean') return json(res, 400, { error: 'bad request' });
      const cur = db.getSettings(user.id), set = new Set(cur.vip || []);
      on ? set.add(cid) : set.delete(cid);
      db.setSettings(user.id, { ...cur, vip: [...set].slice(0, 100) });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/ask') {
      if (!activePlan(db.getUser(user.id), now(), isAdmin).features.ask) return json(res, 402, { error: 'plan' });
      const { q } = await body(req);
      if (typeof q !== 'string' || !q.trim() || q.length > 200) return json(res, 400, { error: 'bad request' });
      const rows = db.allSince(user.id, now() - 30 * 86400000).filter((r) => !botId || r.chat_id !== botId);
      const found = insights.search(rows, q, { now: now(), tz });
      return json(res, 200, { results: found.map((r) => ({ id: r.id, name: r.name, out: r.out, deleted: r.deleted, text: r.text, time: fmtTime.format(r.ts), date: fmtDate.format(r.ts) })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/week') {
      const rows = db.allSince(user.id, now() - 8 * 86400000).filter((r) => !botId || r.chat_id !== botId);
      return json(res, 200, insights.weekStats(rows, { now: now(), tz }));
    }
    if (req.method === 'POST' && url.pathname === '/api/snooze') {
      const { id, hours } = await body(req); const h = Number(hours);
      if (!(h >= 1 && h <= 72) || !db.snooze(user.id, Number(id), now() + h * 3600000)) return json(res, 400, { error: 'bad request' });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/memory') {
      db.clearUser(user.id); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // Юридические страницы: реквизиты оператора берутся из настроек сервера, а не из репозитория.
  const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function serveLegal(res, name) {
    fs.readFile(path.join(webDir, name + '.html'), 'utf8', (err, html) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const sup = db.getConfig('support') || supportContact;
      const vars = {
        OPERATOR_NAME: db.getConfig('operator_name') || legal.OPERATOR_NAME || '[оператор не указан]', OPERATOR_INFO: db.getConfig('operator_info') || legal.OPERATOR_INFO || '',
        KEEP_DAYS: legal.KEEP_DAYS || '30', DATE: legal.DATE || '17 ноября 2026',
        BOT: botUsername ? '@' + botUsername : 'СЛОЙ', SUPPORT: sup ? '@' + sup : '[контакт поддержки не указан]',
      };
      const out = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? escHtml(vars[k]) : m));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(out);
    });
  }

  function serveStatic(req, res, url) {
    if (/^\/(privacy|terms)(\.html)?$/.test(url.pathname)) return serveLegal(res, url.pathname.replace(/^\//, '').replace(/\.html$/, ''));
    let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(webDir, p));
    if (!file.startsWith(path.resolve(webDir) + path.sep) && file !== path.resolve(webDir)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(buf);
    });
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/healthz') return json(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/webhook') {
        if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) { res.writeHead(401); return res.end(); }
        const update = await body(req);
        res.writeHead(200); res.end('ok');
        bot.handle(update).catch((e) => { console.error('update failed:', e.message); onError('не обработано событие Telegram: ' + e.message); });
        return;
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'server' }); else res.end();
    }
  };
}

module.exports = { createApp };
