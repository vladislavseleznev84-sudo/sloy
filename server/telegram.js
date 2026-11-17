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
  return { call };
}
module.exports = { createTelegram };
