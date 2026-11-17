(function () {
  'use strict';
  var D = window.SLOY_DATA;
  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var state = { plan: 'sloy', editing: false, layers: loadLayers(), live: false, loaded: true };

  /* ---------- живые данные (внутри Telegram) ---------- */
  function isLive() { var t = tg(); return !!(t && t.initData); }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'Authorization': 'tma ' + tg().initData, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }
  function loadFeed() {
    if (!isLive()) return Promise.resolve();
    state.live = true; state.loaded = false; render();
    return api('GET', '/api/feed').then(function (r) {
      if (r.ok) { D.now = r.data.now; D.messages = r.data.messages; D.quietCount = r.data.quietCount; D.facts = r.data.facts; state.connected = r.data.connected; state.userPlan = r.data.plan; }
      else { toast('Не вышло загрузить ленту'); D.messages = []; D.facts = []; }
    }).catch(function () { toast('Нет связи с сервером'); D.messages = []; D.facts = []; })
      .then(function () { state.loaded = true; render(); });
  }

  /* ---------- Telegram ---------- */
  function tg() { return window.Telegram && window.Telegram.WebApp; }
  function initTg() {
    var t = tg(); if (!t) return;
    t.ready(); t.expand();
    try { t.setHeaderColor('#0A0D18'); t.setBackgroundColor('#0A0D18'); } catch (e) {}
    if (t.BackButton) t.BackButton.onClick(function () { history.back(); });
    syncBack();
  }
  function syncBack() {
    var t = tg(); if (!t || !t.BackButton) return;
    var r = route().name;
    (r === 'card' || r === 'paywall') ? t.BackButton.show() : t.BackButton.hide();
  }
  function haptic(kind) {
    var t = tg(); if (t && t.HapticFeedback) { try { t.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) {} }
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove('on'); }, 2400);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function segs(list) {
    return list.map(function (s) { return typeof s === 'string' ? esc(s) : '<span class="' + s[1] + '">' + esc(s[0]) + '</span>'; }).join('');
  }
  function loadLayers() {
    var base = {}; D.layers.forEach(function (l) { base[l.id] = l.on; });
    try { var saved = JSON.parse(localStorage.getItem('sloy.layers') || '{}'); for (var k in saved) if (k in base) base[k] = !!saved[k]; } catch (e) {}
    return base;
  }
  function saveLayers() { try { localStorage.setItem('sloy.layers', JSON.stringify(state.layers)); } catch (e) {} }
  function msg(id) { return D.messages.filter(function (m) { return m.id === id; })[0]; }
  var SYMBOL = function (s, c) { c = c || ['#EDEFE8', '#C4FF2E']; return '<svg viewBox="0 0 96 96" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M8 20a12 12 0 0 1 12-12H76a12 12 0 0 1 12 12V32H8Z" fill="' + c[0] + '"/><rect class="slab" x="22" y="36" width="74" height="24" fill="' + c[1] + '"/><path d="M8 64H88V76a12 12 0 0 1-12 12H8Z" fill="' + c[0] + '"/></svg>'; };
  var STAR = function (s, c) { return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M12 2.5L14.9 8.6L21.5 9.4L16.6 14L17.9 20.6L12 17.3L6.1 20.6L7.4 14L2.5 9.4L9.1 8.6Z" fill="' + (c || 'currentColor') + '"/></svg>'; };
  var TICK = function (c) { return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="' + c + '" stroke-width="3" aria-hidden="true"><path d="M4 12L10 18L20 6"/></svg>'; };
  var CROSS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#6B717D" stroke-width="3" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#C9CCD3" stroke-width="2" aria-hidden="true"><path d="M15 5L8 12L15 19"/></svg>';

  function tabs(active) {
    var items = [['home', '#/', 'Страница'], ['radar', '#/radar', 'Радар'], ['memory', '#/memory', 'Память'], ['layers', '#/layers', 'Слои']];
    return '<nav class="tabs" aria-label="Разделы">' + items.map(function (i) {
      return '<button data-go="' + i[1] + '"' + (i[0] === active ? ' aria-current="page"' : '') + '><span>' + i[2] + '</span></button>';
    }).join('') + '</nav>';
  }
  function topbar(pillText) {
    return '<div class="top"><div class="brand">' + SYMBOL(26) + '<b>СЛОЙ</b></div>' +
      (pillText ? '<div class="pill"><i class="dot"></i>' + pillText + '</div>' : '') + '</div>';
  }

  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function hash(str) { var h = 0; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
  function countUps() {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var to = +el.dataset.count; if (REDUCED || !to) { el.textContent = to; return; }
      var t0 = performance.now(), dur = 800;
      (function f(t) { var k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
    });
  }
  function celebrate() {
    if (REDUCED) return;
    var o = document.createElement('div'); o.className = 'burst'; o.innerHTML = '<i></i><i></i><i></i>';
    document.body.appendChild(o); setTimeout(function () { o.remove(); }, 1500);
  }
  window.SLOY_celebrate = celebrate;
  function radarSvg(list) {
    var blips = '', labels = '';
    list.forEach(function (m, i) {
      var h = hash(m.id + m.name), ang = (-68 + (h % 136)) * Math.PI / 180;
      var r = m.level === 'act' ? 55 + (hash(m.id + 'r') % 55) : 105 + (hash(m.id + 'k') % 40);
      var x = (173 + r * Math.sin(ang)).toFixed(1), y = (180 - r * Math.cos(ang)).toFixed(1);
      var act = m.level === 'act';
      blips += '<circle class="blip" style="animation-delay:' + (0.5 + i * 0.18) + 's,' + (1 + i * 0.3) + 's" cx="' + x + '" cy="' + y + '" r="' + (act ? 6 : 4) + '" fill="' + (act ? '#C4FF2E' : '#6E8BFF') + '"/>';
      if (act) labels += '<text class="rlabel" style="animation-delay:' + (0.8 + i * 0.18) + 's" x="' + (+x + 11) + '" y="' + (+y + 3) + '">' + esc(m.name.split(/[ \u00a0]/)[0].toUpperCase()) + '</text>';
    });
    return '<svg class="radar-svg" viewBox="0 0 346 190" width="100%" role="img" aria-label="Радар: ' + list.length + ' отмеченных сообщений">' +
      '<path class="ring" d="M123 180A50 50 0 0 1 223 180"/><path class="ring" d="M73 180A100 100 0 0 1 273 180"/><path class="ring" d="M23 180A150 150 0 0 1 323 180"/>' +
      '<path d="M0 180H346" stroke="#252A45" stroke-width="1.5" fill="none"/>' +
      '<line class="sweep" x1="173" y1="180" x2="173" y2="30" stroke="#C4FF2E" stroke-width="1.5" opacity=".75"/>' + blips + labels + '</svg>';
  }

  /* ---------- screens ---------- */
  function home() {
    var important = D.messages.filter(function (m) { return m.level !== 'quiet'; });
    if (state.live && !state.loaded) return '<main class="screen">' + topbar('') + '<div class="sk" aria-label="Загрузка"><i></i><i></i><i></i></div></main>' + tabs('home');
    if (state.live && important.length === 0) return homeEmpty();
    var notes = important.map(function (m) {
      var head = '<div class="row"><span class="src">' + esc(m.name) + ' · ' + m.time + '</span>' + (m.tag === 'Срочно' ? '<span class="src b">Срочно</span>' : '') + '</div>';
      var foot = '<div class="row" style="margin-top:8px"><span class="note">' + esc(m.note) + '</span><span class="btn-d">Разбор</span></div>';
      return '<button class="pp" data-go="#/card/' + m.id + '" aria-label="Разбор: ' + esc(m.name) + '">' + head + '<div class="txt">' + segs(m.segs) + '</div>' + foot + '</button>';
    }).join('');
    return '<main class="screen">' + topbar('Слушаю ' + D.now.listening + ' чатов') +
      '<div class="big hero"><svg class="ghost" viewBox="0 0 96 96" aria-hidden="true"><path d="M8 20a12 12 0 0 1 12-12H76a12 12 0 0 1 12 12V32H8Z"/><rect x="22" y="36" width="74" height="24"/><path d="M8 64H88V76a12 12 0 0 1-12 12H8Z"/></svg><div class="n" data-count="' + important.length + '">0</div><div style="padding-bottom:4px"><div class="u" style="font-size:16px;font-weight:800">важных</div><div class="m" style="margin-top:5px;line-height:1.5">из ' + D.now.total + ' новых<br>сегодня · ' + D.now.time + '</div></div></div>' +
      '<p class="lead">Я прошёлся по личным чатам. Вот что отметил.</p>' +
      '<div class="stack">' + notes + '</div>' +
      '<button class="ask" data-act="ask"><i>&gt;</i>Спроси слой: что я обещал…</button></main>' + tabs('home');
  }

  function homeEmpty() {
    var conn = state.connected;
    return '<main class="screen">' + topbar(conn ? 'Слушаю' : 'Не подключён') +
      '<div class="big"><div class="n" style="color:#2A3250">0</div><div style="padding-bottom:4px"><div class="u" style="font-size:16px;font-weight:800;color:#9DA2AE">важных пока</div><div class="m" style="margin-top:5px;line-height:1.5">' + (conn ? 'слой начал слушать' : 'слой пока ничего не видит') + '</div></div></div>' +
      '<p class="lead">' + (conn ? 'Первая пометка появится, как только придёт что-то важное.' : 'Подключи меня в Настройки → Telegram Business → Чат-боты.') + '</p>' +
      '<div class="pp" style="margin-top:22px;transform:rotate(-.4deg)"><span class="src b">Важно знать</span><div class="txt" style="font-size:14.5px">Прошлую переписку слой не видит — только то, что пришло после подключения.</div></div>' +
      '</main>' + tabs('home');
  }

  function radar() {
    var rows = D.messages.map(function (m) {
      var quiet = m.level === 'quiet';
      var inner = '<div class="av">' + esc(m.ini) + '</div><div style="flex:1;min-width:0"><div class="hd"><span class="nm">' + esc(m.name) + '</span><span class="m">' + m.time + '</span></div><div class="tx">' + segs(m.segs) + '</div></div>';
      return quiet ? '<div class="chat q">' + inner + '</div>' : '<button class="chat" data-go="#/card/' + m.id + '">' + inner + '</button>';
    }).join('');
    return '<main class="screen">' +
      '<div class="top"><h1 class="t">RADAR</h1><div class="pill"><i class="dot"></i>Живой</div></div>' +
      '<p class="lead" style="font-size:19px;margin-top:8px">Подчёркиваю важное, остальное — тишина.</p>' +
      radarSvg(D.messages.filter(function (m) { return m.level !== 'quiet'; })) + '<div class="legend"><span><span class="hl" style="animation:none">Действие</span></span><span><span class="ul">Просто знай</span></span><span class="m" style="margin-left:auto">Личные ' + D.now.listening + ' из ' + D.now.of + '</span></div>' +
      '<div style="margin-top:12px">' + (rows || '<p class="lead" style="font-size:17px">Пока тишина. Слой слушает.</p>') + '</div>' +
      (D.quietCount ? '<div class="silent">…и ещё ' + D.quietCount + ' в тишине</div>' : '') +
      '<div class="pp group" style="transform:rotate(.4deg)"><div class="row"><div><span class="src b">Группы</span><div style="font-size:13.5px;line-height:1.4;margin-top:3px;font-weight:500">«Диплом» пока в тишине: слой видит группу, только если его туда добавили.</div></div><button class="btn-d" data-act="groups" style="flex:none">Как</button></div></div>' +
      '</main>' + tabs('radar');
  }

  function card(id) {
    var m = msg(id);
    if (!m || m.level === 'quiet') return notFound();
    var arrows = '<svg class="arrows" viewBox="0 0 346 52" width="100%" height="52" aria-hidden="true"><g fill="none" stroke="#8FA5FF" stroke-width="1.6" stroke-linecap="round"><path d="M126 2C122 22 90 28 52 46"/><path d="M42 36L52 46L38 48"/><path d="M262 2C262 24 268 32 290 46"/><path d="M280 48L290 46L286 34"/></g></svg>';
    var notes = '<div class="stack" style="margin-top:2px;gap:11px">' +
      '<div class="pp"><span class="src">Что просят</span><div class="txt" style="margin-top:3px;font-size:15px">' + esc(m.ask) + '</div></div>' +
      '<div class="pp"><span class="src">Срок</span><div class="txt" style="margin-top:3px;font-size:15px"><span class="hl" style="animation:none">' + esc(m.deadline) + '</span> ' + (m.left ? '<span class="note" style="margin-left:4px">' + esc(m.left) + '</span>' : '') + '</div></div>' +
      '<div class="pp"><span class="src b">Помню</span><div class="txt" style="margin-top:3px;font-size:15px">' + esc(m.memory) + '</div></div></div>';
    var composer = '<div class="composer"><div class="row"><span class="m" style="color:#C4FF2E">Reply · ' + esc(m.reply.tone).toLowerCase() + '</span><span class="m">Ещё тон</span></div>' +
      '<div class="txt" id="replyText" style="margin-top:6px"' + (state.editing ? ' contenteditable="true"' : '') + '>' + esc(m.reply.text) + '</div>' +
      '<div class="btns"><button class="btn" data-act="edit">' + (state.editing ? 'Готово' : 'Править') + '</button><button class="btn go" data-act="send" data-id="' + m.id + '">Отправить от меня</button></div>' +
      '<div class="fine">Уйдёт из твоего аккаунта только после тапа · окно ответа 24 ч</div></div>';
    return '<main class="screen" style="padding-bottom:230px"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><div class="av" style="width:34px;height:34px;font-size:11px">' + esc(m.ini) + '</div><div><b style="font-weight:600;font-size:15px">' + esc(m.name) + '</b><div class="m" style="font-size:9.5px">Разбор сообщения · ' + m.time + '</div></div></div>' +
      '<div class="bubble">' + segs(m.fullSegs) + '<span class="m">' + m.time + '</span></div>' + arrows + notes + '</main>' + composer;
  }

  function memory() {
    var facts = D.facts.map(function (f) { return '<div class="pp"><span class="src b">' + esc(f.t) + '</span><div class="txt" style="font-size:15px;margin-top:3px">' + esc(f.s) + '</div></div>'; }).join('');
    return '<main class="screen"><h1 class="t">Память</h1><p class="lead" style="font-size:19px;margin-top:8px">Что я о тебе помню. Ничего лишнего.</p>' +
      '<div class="stack">' + (facts || '<p class="lead" style="font-size:17px">Пока ничего не запомнил.</p>') + '</div><button class="clear" data-act="clear">Стереть память</button></main>' + tabs('memory');
  }

  function layers() {
    var rows = D.layers.map(function (l) {
      var on = !!state.layers[l.id];
      return '<button class="lr" role="checkbox" aria-checked="' + on + '" data-act="toggle" data-id="' + l.id + '"><span class="cb">' + TICK('#07080A') + '</span><span><div class="nm">' + l.name + '</div><div class="ds">' + esc(l.desc) + '</div></span></button>';
    }).join('');
    var rights = '<div class="pp rights" style="transform:rotate(.4deg)"><div class="row"><span class="src">Права слоя в Telegram</span><span class="src b">Изменить ↗</span></div><ul>' +
      '<li>' + TICK('#2447D6') + 'Читает ' + D.now.listening + ' выбранных чатов</li><li>' + TICK('#2447D6') + 'Отвечает — только после твоего тапа</li><li class="no">' + CROSS + 'Не удаляет сообщения</li></ul></div>';
    return '<main class="screen"><h1 class="t">Слои</h1><p class="lead" style="font-size:19px;margin-top:6px">Что слой делает за тебя.</p><div style="margin-top:14px">' + rows + '</div>' + rights +
      '<button class="clear" data-go="#/paywall">Мой билет · СЛОЙ</button></main>' + tabs('layers');
  }

  function paywall() {
    var P = D.plans, sel = state.plan;
    var list = P.map(function (p) {
      if (p.id === sel && p.items) {
        // ['текст', 'hl'] — вся строка маркером; ['начало ', 'конец'] — подчёркнут хвост
        var items = p.items.map(function (it) { return it[1] === 'hl' ? '<div><span class="hl" style="animation:none">' + esc(it[0]) + '</span></div>' : '<div>' + esc(it[0]) + (it[1] ? '<span class="ul">' + esc(it[1]) + '</span>' : '') + '</div>'; }).join('');
        return '<div class="paper-t"><div class="h"><div><div class="nm">' + p.name + '</div><div style="font-size:12.5px;color:#3A3F4B;margin-top:3px">' + esc(p.sub) + '</div></div><div class="price">' + STAR(22, '#0B0D14') + p.stars + '</div></div><div class="perf"></div><div class="b">' + items + '<div class="note" style="margin-top:8px">' + esc(p.note) + '</div></div></div>';
      }
      return '<button class="ticket" data-act="plan" data-id="' + p.id + '" aria-pressed="' + (p.id === sel) + '"><span><div class="nm">' + p.name + '</div><div class="sb">' + esc(p.sub) + '</div></span><span class="u" style="font-size:16px;color:#C9CCD3;display:flex;align-items:center;gap:4px">' + (p.stars ? STAR(15) + p.stars : '0') + '</span></button>';
    }).join('');
    var plan = P.filter(function (p) { return p.id === sel; })[0];
    var go = plan.stars ? 'Оплатить ' + STAR(17, '#07080A') + ' ' + plan.stars : 'Остаться на Старте';
    var alt = window.Pay.providers().indexOf('web') > -1 && plan.stars ? '<button class="alt" data-act="payweb">Оплатить рублями (СБП)</button>' : '';
    return '<main class="screen" style="padding-bottom:210px"><div class="back"><button data-act="back" style="display:flex;align-items:center;gap:6px;color:#9DA2AE;font-size:13px">' + BACK.replace('22', '18').replace('22', '18') + 'Закрыть</button></div>' +
      '<h1 class="t" style="margin-top:16px;font-size:27px;line-height:1.1">Билет на слои</h1><p class="lead" style="font-size:19px;margin-top:6px;color:#B6BAC4">Платишь только за глубину.</p>' + list + '</main>' +
      '<div class="cta"><button class="go" data-act="pay">' + go + '</button>' + alt + '<div class="m" style="text-align:center;margin-top:10px;font-size:9.5px;line-height:1.6">Telegram Stars · /terms · /support</div></div>';
  }

  function notFound() { return '<main class="screen"><h1 class="t">Тишина</h1><p class="lead">Такого экрана нет.</p><button class="clear" data-go="#/">На главную</button></main>'; }

  /* ---------- router ---------- */
  function route() {
    // Telegram дописывает к адресу служебные параметры (#tgWebAppData=…) — это не экран.
    var h = (location.hash || '').replace(/^#/, '');
    var path = /^\//.test(h) ? h.split(/[&?]/)[0] : '';
    if (!path) { try { var q = new URLSearchParams(location.search).get('r'); if (q) path = '/' + q.replace(/^\//, ''); } catch (e) {} }
    var p = path.replace(/^\//, '').split('/');
    return { name: p[0] || 'home', id: p[1] };
  }
  function render() {
    var r = route(), html;
    switch (r.name) {
      case 'home': html = home(); break;
      case 'radar': html = radar(); break;
      case 'card': html = card(r.id); break;
      case 'memory': html = memory(); break;
      case 'layers': html = layers(); break;
      case 'paywall': html = paywall(); break;
      default: html = notFound();
    }
    app.innerHTML = html;
    countUps();
    syncBack();
  }
  window.addEventListener('hashchange', function () { state.editing = false; window.scrollTo(0, 0); render(); });
  window.addEventListener('load', function () { initTg(); loadFeed(); });

  /* ---------- actions ---------- */
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go],[data-act]'); if (!el) return;
    if (el.dataset.go) { haptic(); location.hash = el.dataset.go; return; }
    var act = el.dataset.act;
    if (act === 'back') { history.length > 1 ? history.back() : (location.hash = '#/'); return; }
    if (act === 'toggle') { state.layers[el.dataset.id] = !state.layers[el.dataset.id]; saveLayers(); haptic(); render(); return; }
    if (act === 'plan') { state.plan = el.dataset.id; haptic(); render(); return; }
    if (act === 'edit') {
      state.editing = !state.editing; render();
      if (state.editing) { var t = document.getElementById('replyText'); t && t.focus(); }
      return;
    }
    if (act === 'send') {
      haptic('medium');
      if (!state.live) { toast('Демо: ушло бы из твоего аккаунта'); return; }
      var rt = document.getElementById('replyText');
      api('POST', '/api/reply', { id: el.dataset.id, text: rt ? rt.textContent : '' }).then(function (r) {
        if (r.ok) toast('Отправлено'); else if (r.status === 409) toast('Слой отключён в Telegram Business'); else toast('Не отправилось. Окно ответа — 24 часа');
      }).catch(function () { toast('Нет связи с сервером'); });
      return;
    }
    if (act === 'ask') { toast('Скоро: спросишь слой голосом или текстом'); return; }
    if (act === 'groups') { toast('Добавь бота в группу и сделай админом'); return; }
    if (act === 'clear') {
      haptic('medium');
      if (!state.live) { toast('Демо: память стёрта'); return; }
      api('DELETE', '/api/memory').then(function (r) { if (r.ok) { D.messages = []; D.facts = []; toast('Память стёрта'); render(); } });
      return;
    }
    if (act === 'pay' || act === 'payweb') {
      var plan = D.plans.filter(function (p) { return p.id === state.plan; })[0];
      if (!plan.stars) { toast('Ты на Старте'); return; }
      window.Pay.start(plan, act === 'payweb' ? 'web' : 'stars').then(function (r) {
        if (r.status === 'paid') { haptic('medium'); celebrate(); toast('Готово. Слой включён.'); }
        else if (r.message) { if (r.status === 'demo') celebrate(); toast(r.message); }
        else if (r.status === 'cancelled') toast('Оплата отменена');
      });
    }
  });

  render();
})();
