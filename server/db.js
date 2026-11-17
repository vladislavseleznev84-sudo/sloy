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
  // Мягкая миграция: добавляем колонки в уже существующую базу.
  const addColumn = (table, col, def) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
  addColumn('users', 'settings', "TEXT NOT NULL DEFAULT '{}'");
  addColumn('users', 'last_recap', "TEXT NOT NULL DEFAULT ''");
  addColumn('messages', 'snoozed_until', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'deleted_at', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'edited_at', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'history', "TEXT NOT NULL DEFAULT '[]'");
  addColumn('messages', 'out', 'INTEGER NOT NULL DEFAULT 0');             // 1 = сообщение самого владельца
  addColumn('messages', 'answered_at', 'INTEGER NOT NULL DEFAULT 0');     // когда владелец ответил в этом чате
  addColumn('messages', 'reminded_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('messages', 'reminded_at', 'INTEGER NOT NULL DEFAULT 0');
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
      const r = q(`INSERT OR IGNORE INTO messages(user_id,conn_id,chat_id,chat_name,tg_msg_id,text,ts,level,analysis,out)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(m.user_id, m.conn_id, m.chat_id, m.chat_name, m.tg_msg_id, m.text, m.ts, m.level, JSON.stringify(m.analysis), m.out ? 1 : 0);
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    getMessage(userId, id) { return q('SELECT * FROM messages WHERE user_id=? AND id=?').get(userId, id); },
    feed(userId, since) { return q('SELECT * FROM messages WHERE user_id=? AND ts>=? AND out=0 ORDER BY ts DESC LIMIT 200').all(userId, since); },
    allSince(userId, since) { return q('SELECT * FROM messages WHERE user_id=? AND ts>=? ORDER BY ts DESC LIMIT 5000').all(userId, since); },
    addFact(userId, title, body, now = Date.now()) { q('INSERT INTO facts(user_id,title,body,ts) VALUES(?,?,?,?)').run(userId, title, body, now); },
    facts(userId) { return q('SELECT title, body FROM facts WHERE user_id=? ORDER BY ts DESC LIMIT 50').all(userId); },
    hasChat(userId, chatId) { return !!q('SELECT 1 FROM messages WHERE user_id=? AND chat_id=? AND out=0 LIMIT 1').get(userId, chatId); },
    countChats(userId) { return q('SELECT COUNT(DISTINCT chat_id) AS n FROM messages WHERE user_id=? AND out=0').get(userId).n; },
    stats(now = Date.now()) {
      const one = (sql, ...a) => q(sql).get(...a);
      return {
        users: one('SELECT COUNT(*) AS n FROM users').n,
        connections: one('SELECT COUNT(*) AS n FROM connections WHERE enabled=1').n,
        messages: one('SELECT COUNT(*) AS n FROM messages WHERE out=0').n,
        messages24h: one('SELECT COUNT(*) AS n FROM messages WHERE out=0 AND ts>=?', now - 86400000).n,
        important24h: one("SELECT COUNT(*) AS n FROM messages WHERE out=0 AND ts>=? AND level!='quiet'", now - 86400000).n,
        paid: one("SELECT COUNT(*) AS n FROM users WHERE plan!='start' AND plan_until>?", now).n,
      };
    },
    getSettings(userId) { const u = q('SELECT settings FROM users WHERE id=?').get(userId); try { return JSON.parse((u && u.settings) || '{}'); } catch { return {}; } },
    setSettings(userId, obj) { q('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(obj), userId); },
    snooze(userId, id, until) { return q('UPDATE messages SET snoozed_until=? WHERE user_id=? AND id=?').run(until, userId, id).changes > 0; },
    recapUsers() { return q('SELECT DISTINCT u.id, u.last_recap FROM users u JOIN connections c ON c.user_id=u.id WHERE c.enabled=1').all(); },
    setLastRecap(userId, day) { q('UPDATE users SET last_recap=? WHERE id=?').run(day, userId); },
    findMessage(connId, chatId, tgMsgId) { return q('SELECT * FROM messages WHERE conn_id=? AND chat_id=? AND tg_msg_id=?').get(connId, chatId, tgMsgId); },
    markEdited(id, newText, analysis, level, history, at) {
      q('UPDATE messages SET text=?, analysis=?, level=?, history=?, edited_at=? WHERE id=?').run(newText, JSON.stringify(analysis), level, JSON.stringify(history), at, id);
    },
    markDeleted(id, at) { q('UPDATE messages SET deleted_at=? WHERE id=?').run(at, id); },
    // Срок хранения: старые сообщения стираются (по умолчанию через 30 дней).
    purge(before) { return q('DELETE FROM messages WHERE ts < ?').run(before).changes; },
    // Ответил ли владелец: любое его сообщение в чате закрывает все ждущие ответа сообщения этого чата.
    markAnswered(connId, chatId, at) { return q('UPDATE messages SET answered_at=? WHERE conn_id=? AND chat_id=? AND out=0 AND answered_at=0 AND ts<=?').run(at, connId, chatId, at).changes; },
    pendingReplies(now) {
      return q(`SELECT * FROM messages WHERE out=0 AND level IN ('act','know') AND answered_at=0 AND deleted_at=0 AND snoozed_until<=?
                AND reminded_count<2 AND ts>? ORDER BY ts ASC LIMIT 500`).all(now, now - 48 * 3600000);
    },
    bumpReminded(id, at) { q('UPDATE messages SET reminded_count=reminded_count+1, reminded_at=? WHERE id=?').run(at, id); },
    backupTo(path) { q('VACUUM INTO ?').run(path); },
    clearUser(userId) { q('DELETE FROM messages WHERE user_id=?').run(userId); q('DELETE FROM facts WHERE user_id=?').run(userId); },
  };
}

module.exports = { openDb };
