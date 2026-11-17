'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateInitData } = require('./validate');
const { PLANS, activePlan } = require('./plans');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function initials(name) {
  const p = String(name).replace(/[«»"]/g, '').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[1][0] : '')).toUpperCase();
}

function createApp({ botToken, webhookSecret, db, tg, bot, webDir, tz = 'Europe/Moscow', now = () => Date.now() }) {
  const fmtTime = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });

  function buildFeed(userId) {
    const since = now() - 24 * 3600 * 1000;
    const rows = db.feed(userId, since);
    const items = rows.map((r) => {
      const a = JSON.parse(r.analysis);
      return { id: String(r.id), name: r.chat_name, ini: initials(r.chat_name), time: fmtTime.format(r.ts), ...a };
    });
    const important = items.filter((m) => m.level !== 'quiet');
    const quiet = items.filter((m) => m.level === 'quiet');
    const chats = new Set(rows.map((r) => r.chat_id)).size;
    return {
      now: { date: fmtDate.format(now()), time: fmtTime.format(now()), total: items.length, listening: chats, of: null },
      messages: [...important, ...quiet.slice(0, 2)],
      quietCount: Math.max(0, quiet.length - 2),
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

    if (req.method === 'GET' && url.pathname === '/api/feed') {
      const u = db.getUser(user.id);
      return json(res, 200, { ...buildFeed(user.id), plan: activePlan(u, now()).id, planUntil: u.plan_until });
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
      const conn = db.getConnection(row.conn_id);
      if (!conn || !conn.enabled) return json(res, 409, { error: 'not connected' });
      try {
        await tg.call('sendMessage', { business_connection_id: conn.id, chat_id: row.chat_id, text: text.trim() });
      } catch (e) { return json(res, 502, { error: 'telegram', detail: e.message }); }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && url.pathname === '/api/memory') {
      db.clearUser(user.id); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  function serveStatic(req, res, url) {
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
        bot.handle(update).catch((e) => console.error('update failed:', e.message));
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
