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
const bot = createBot({ tg, db, webappUrl, adminIds, botId: Number(botToken.split(':')[0]), tz: process.env.TZ_NAME || 'Europe/Moscow' });
const handler = createApp({ botToken, webhookSecret, db, tg, bot, adminIds, webDir: path.join(__dirname, '..', 'web'), tz: process.env.TZ_NAME || 'Europe/Moscow' });

const port = Number(process.env.PORT || 3000);
http.createServer(handler).listen(port, () => console.log('СЛОЙ слушает порт ' + port));
