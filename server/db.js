'use strict';
const { DatabaseSync } = require('node:sqlite');

function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'start', plan_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS connections(
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, user_chat_id INTEGER NOT NULL,
      enabled INTEGER NOT NULL, can_reply INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS messages(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, conn_id TEXT NOT NULL,
      chat_id INTEGER NOT NULL, chat_name TEXT NOT NULL, tg_msg_id INTEGER NOT NULL,
      text TEXT NOT NULL, ts INTEGER NOT NULL, level TEXT NOT NULL, analysis TEXT NOT NULL,
      UNIQUE(conn_id, chat_id, tg_msg_id));
    CREATE INDEX IF NOT EXISTS idx_msg_user_ts ON messages(user_id, ts DESC);
    CREATE TABLE IF NOT EXISTS facts(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL);
  `);
  const q = (sql) => db.prepare(sql);
  return {
    raw: db,
    upsertUser(id, now = Date.now()) { q('INSERT OR IGNORE INTO users(id, created) VALUES(?, ?)').run(id, now); return q('SELECT * FROM users WHERE id=?').get(id); },
    getUser(id) { return q('SELECT * FROM users WHERE id=?').get(id); },
    setPlan(id, plan, until) { q('UPDATE users SET plan=?, plan_until=? WHERE id=?').run(plan, until, id); },
    upsertConnection(c) {
      q(`INSERT INTO connections(id,user_id,user_chat_id,enabled,can_reply) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, can_reply=excluded.can_reply, user_chat_id=excluded.user_chat_id`)
        .run(c.id, c.user_id, c.user_chat_id, c.enabled ? 1 : 0, c.can_reply ? 1 : 0);
    },
    getConnection(id) { return q('SELECT * FROM connections WHERE id=?').get(id); },
    userConnection(userId) { return q('SELECT * FROM connections WHERE user_id=? AND enabled=1 ORDER BY rowid DESC LIMIT 1').get(userId); },
    addMessage(m) {
      const r = q(`INSERT OR IGNORE INTO messages(user_id,conn_id,chat_id,chat_name,tg_msg_id,text,ts,level,analysis)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(m.user_id, m.conn_id, m.chat_id, m.chat_name, m.tg_msg_id, m.text, m.ts, m.level, JSON.stringify(m.analysis));
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    getMessage(userId, id) { return q('SELECT * FROM messages WHERE user_id=? AND id=?').get(userId, id); },
    feed(userId, since) { return q('SELECT * FROM messages WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 200').all(userId, since); },
    addFact(userId, title, body, now = Date.now()) { q('INSERT INTO facts(user_id,title,body,ts) VALUES(?,?,?,?)').run(userId, title, body, now); },
    facts(userId) { return q('SELECT title, body FROM facts WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(userId); },
    hasChat(userId, chatId) { return !!q('SELECT 1 FROM messages WHERE user_id=? AND chat_id=? LIMIT 1').get(userId, chatId); },
    countChats(userId) { return q('SELECT COUNT(DISTINCT chat_id) AS n FROM messages WHERE user_id=?').get(userId).n; },
    stats(now = Date.now()) {
      const one = (sql, ...a) => q(sql).get(...a);
      return {
        users: one('SELECT COUNT(*) AS n FROM users').n,
        connections: one('SELECT COUNT(*) AS n FROM connections WHERE enabled=1').n,
        messages: one('SELECT COUNT(*) AS n FROM messages').n,
        messages24h: one('SELECT COUNT(*) AS n FROM messages WHERE ts>=?', now - 86400000).n,
        important24h: one("SELECT COUNT(*) AS n FROM messages WHERE ts>=? AND level!='quiet'", now - 86400000).n,
        paid: one("SELECT COUNT(*) AS n FROM users WHERE plan!='start' AND plan_until>?", now).n,
      };
    },
    clearUser(userId) { q('DELETE FROM messages WHERE user_id=?').run(userId); q('DELETE FROM facts WHERE user_id=?').run(userId); },
  };
}

module.exports = { openDb };
