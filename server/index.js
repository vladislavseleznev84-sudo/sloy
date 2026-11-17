'use strict';
const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./db');
const { createTelegram } = require('./telegram');
const { createBot } = require('./bot');
const { createApp } = require('./app');

const need = (k) => { const v = process.env[k]; if (!v) { console.error('Нужна переменная окружения ' + k + ' (см. .env.example)'); process.exit(1); } return v; };

const botToken = need('BOT_TOKEN');
const webhookSecret = need('WEBHOOK_SECRET');
const webappUrl = need('WEBAPP_URL').replace(/\/$/, '');
const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'sloy.db'));
const adminIds = new Set((process.env.ADMIN_IDS || '').split(',').map((x) => Number(x.trim())).filter(Boolean));
const tg = createTelegram(botToken);
const alerts = require('./alerts');
const alert = alerts.createAlerter({ tg, adminIds });   // оповещение админа о сбоях (не чаще раза в 10 минут)
const dbFile = process.env.DB_PATH || path.join(__dirname, '..', 'sloy.db');
const backupDir = process.env.BACKUP_DIR || path.join(path.dirname(dbFile), 'backups');
const doBackup = () => alerts.makeBackup(db, backupDir);
const bot = createBot({ tg, db, webappUrl, adminIds, backup: doBackup, botId: Number(botToken.split(':')[0]), tz: process.env.TZ_NAME || 'Europe/Moscow' });
const botId = Number(botToken.split(':')[0]);
db.raw.prepare('DELETE FROM messages WHERE chat_id=?').run(botId);   // разовая чистка мусора от старого цикла
const handler = createApp({ botToken, webhookSecret, db, tg, bot, adminIds, botId, onError: (t) => alert(t), webDir: path.join(__dirname, '..', 'web'), tz: process.env.TZ_NAME || 'Europe/Moscow' });

// Срок хранения сообщений: 30 дней (по умолчанию), чистим при запуске и раз в сутки.
const keepDays = Number(process.env.KEEP_DAYS || 30);
const purge = () => { try { const n = db.purge(Date.now() - keepDays * 86400000); if (n) console.log('очищено старых сообщений:', n); } catch (e) { console.error('purge:', e.message); } };
purge(); setInterval(purge, 24 * 3600 * 1000);
// Резервная копия базы раз в сутки (последние 7 хранятся рядом с базой). Отправить копию в Telegram админу: команда /backup.
try { doBackup(); } catch (e) { console.error('backup:', e.message); }
setInterval(() => { try { doBackup(); } catch (e) { console.error('backup:', e.message); } }, 24 * 3600 * 1000);
process.on('uncaughtException', (e) => { console.error(e); alert('сбой: ' + e.message); });
process.on('unhandledRejection', (e) => { console.error(e); alert('ошибка: ' + (e && e.message ? e.message : e)); });
const recap = require('./recap');
require('./reminders').start({ db, tg, openBtn: bot.openBtn, tz: process.env.TZ_NAME || 'Europe/Moscow' });
recap.start({ db, tg, openBtn: bot.openBtn, tz: process.env.TZ_NAME || 'Europe/Moscow', botId, hour: Number(process.env.RECAP_HOUR || 21) });

const port = Number(process.env.PORT || 3000);
http.createServer(handler).listen(port, () => console.log('СЛОЙ слушает порт ' + port));
