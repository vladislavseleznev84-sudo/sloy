'use strict';
// Тонкий клиент Bot API. fetch можно подменить в тестах.
function createTelegram(token, fetchImpl = globalThis.fetch) {
  async function call(method, params = {}) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) { const e = new Error(`${method}: ${data.description || res.status}`); e.code = data.error_code; throw e; }
    return data.result;
  }
  // Отправка файла (multipart). file — путь на диске.
  async function upload(method, params, field, file) {
    const fs = require('node:fs'), path = require('node:path');
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    form.append(field, new Blob([fs.readFileSync(file)]), path.basename(file));
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
    return data.result;
  }
  return { call, upload };
}
module.exports = { createTelegram };
