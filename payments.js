// Платежный слой. UI знает только про Pay.start(plan, provider) — как оплата устроена внутри, решается здесь.
//
// Провайдеры:
//  - 'stars': разрешённый Telegram путь для цифровых услуг внутри бота/Mini App.
//             Бэкенд создаёт счёт (createInvoiceLink, currency "XTR") → Mini App открывает его через WebApp.openInvoice.
//  - 'web'  : оплата рублями (СБП и т.д.) на отдельной странице вне Telegram. Серая зона правил Telegram, по умолчанию выключено.
window.SLOY_CONFIG = {
  apiBase: '',          // URL бэкенда; пусто = демо-режим
  webPay: false,        // показывать ссылку «Оплатить рублями (СБП)»
  webPayUrl: '',        // страница оплаты на вашем сайте
};

window.Pay = {
  providers() {
    const list = ['stars'];
    if (window.SLOY_CONFIG.webPay) list.push('web');
    return list;
  },

  async start(plan, provider) {
    const tg = window.Telegram && window.Telegram.WebApp;
    const cfg = window.SLOY_CONFIG;

    if (provider === 'web') {
      if (!cfg.webPayUrl) return { status: 'demo', message: 'Демо: тут откроется страница оплаты СБП' };
      const url = cfg.webPayUrl + '?plan=' + encodeURIComponent(plan.id);
      tg && tg.openLink ? tg.openLink(url) : window.open(url, '_blank');
      return { status: 'redirected' };
    }

    // Stars
    if (!cfg.apiBase || !tg || !tg.openInvoice) {
      return { status: 'demo', message: 'Демо: тут откроется оплата ⭐ ' + plan.stars };
    }
    try {
      const res = await fetch(cfg.apiBase + '/api/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.id, initData: tg.initData }),
      });
      if (!res.ok) throw new Error('invoice ' + res.status);
      const { link } = await res.json();
      return await new Promise((resolve) => tg.openInvoice(link, (s) => resolve({ status: s })));
    } catch (e) {
      return { status: 'failed', message: 'Не вышло создать счёт. Попробуй ещё раз.' };
    }
  },
};
