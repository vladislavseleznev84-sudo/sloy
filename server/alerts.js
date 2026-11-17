'use strict';
// Оповещения админу о сбоях (не чаще раза в 10 минут) и резервные копии базы.
const fs = require('node:fs');
const path = require('node:path');

function createAlerter({ tg, adminIds, now = () => Date.now(), cooldownMs = 600000 }) {
  let last = 0;
  return async function alert(text) {
    if (now() - last < cooldownMs || !adminIds.size) return false;
    last = now();
    for (const id of adminIds) { try { await tg.call('sendMessage', { chat_id: id, text: '⚠️ СЛОЙ: ' + String(text).slice(0, 600) }); } catch {} }
    return true;
  };
}

// Копия базы в папку backups рядом с файлом базы; хранится 7 последних.
function makeBackup(db, dir, now = Date.now(), keep = 7) {
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(now).toISOString().slice(0, 10);
  const file = path.join(dir, `sloy-${d}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.backupTo(file);
  const all = fs.readdirSync(dir).filter((f) => /^sloy-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  all.slice(0, Math.max(0, all.length - keep)).forEach((f) => fs.rmSync(path.join(dir, f)));
  return file;
}

module.exports = { createAlerter, makeBackup };
