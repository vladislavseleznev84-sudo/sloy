(function () {
  'use strict';
  var D = window.SLOY_DATA;
  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var state = { showOnb: !onbDone(), askQ: '', askRes: null, week: null, plan: 'sloy', editing: false, layers: loadLayers(), live: false, loaded: true, replyIdx: {}, snoozed: {}, theme: loadTheme() };

  /* ---------- живые данные (внутри Telegram) ---------- */
  function isLive() { var t = tg(); return !!(t && t.initData); }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'Authorization': 'tma ' + tg().initData, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, data: j }; }); });
  }
  function loadWeek() {
    if (!isLive()) { state.week = { received: 47, important: 5, quiet: 42, sent: 12, answered: 4, avgReplyMin: 38, days: [{ total: 9, important: 1 }, { total: 14, important: 2 }, { total: 6, important: 0 }, { total: 11, important: 1 }, { total: 17, important: 3 }, { total: 12, important: 2 }, { total: 47, important: 5 }] }; return; }
    api('GET', '/api/week').then(function (r) { if (r.ok) { state.week = r.data; render(); } });
  }
  function loadAdminStats() {
    if (!isLive()) return;
    api('GET', '/api/admin/stats').then(function (r) { if (r.ok) { state.adminStats = r.data; if (route().name === 'admin') render(); } });
  }
  function refreshFeed() {
    if (!isLive() || !state.loaded || document.hidden) return;
    var name = route().name;
    if (['home', 'radar', 'memory'].indexOf(name) < 0) return;
    if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    api('GET', '/api/feed').then(function (r) {
      if (!r.ok) return;
      var sig = function (x) { return JSON.stringify([x.messages, x.quietCount, x.facts]); };
      if (sig(r.data) === sig(D)) return;                       // ничего нового — экран не трогаем, анимации не перезапускаем
      D.now = r.data.now; D.messages = r.data.messages; D.quietCount = r.data.quietCount; D.facts = r.data.facts;
      render();
    }).catch(function () {});
  }
  setInterval(refreshFeed, 20000);
  document.addEventListener('visibilitychange', refreshFeed);
  function loadFeed() {
    if (!isLive()) return Promise.resolve();
    state.live = true; state.loaded = false; render();
    return api('GET', '/api/feed').then(function (r) {
      if (r.ok) { D.now = r.data.now; D.messages = r.data.messages; D.quietCount = r.data.quietCount; D.facts = r.data.facts; state.connected = r.data.connected; state.userPlan = r.data.plan; state.isAdmin = !!r.data.isAdmin; var sl = (r.data.settings || {}).layers; if (sl) { for (var k in sl) if (k in state.layers) state.layers[k] = !!sl[k]; saveLayers(); } }
      else { toast('Не вышло загрузить ленту'); D.messages = []; D.facts = []; }
    }).catch(function () { toast('Нет связи с сервером'); D.messages = []; D.facts = []; })
      .then(function () { state.loaded = true; render(); });
  }

  /* ---------- Telegram ---------- */
  function tg() { return window.Telegram && window.Telegram.WebApp; }
  function initTg() {
    var t = tg(); if (!t) return;
    t.ready(); t.expand();
    // Полный экран и защита от случайного закрытия свайпом (поддерживается новыми версиями Telegram).
    try { if (t.requestFullscreen && !t.isFullscreen) t.requestFullscreen(); } catch (e) {}
    try { if (t.disableVerticalSwipes) t.disableVerticalSwipes(); } catch (e) {}
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
  var SYMBOL = function (s, c) { c = c || ['currentColor', '#C4FF2E']; return '<svg viewBox="0 0 96 96" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M8 20a12 12 0 0 1 12-12H76a12 12 0 0 1 12 12V32H8Z" fill="' + c[0] + '"/><rect class="slab" x="22" y="36" width="74" height="24" fill="' + c[1] + '"/><path d="M8 64H88V76a12 12 0 0 1-12 12H8Z" fill="' + c[0] + '"/></svg>'; };
  var STAR = function (s, c) { return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M12 2.5L14.9 8.6L21.5 9.4L16.6 14L17.9 20.6L12 17.3L6.1 20.6L7.4 14L2.5 9.4L9.1 8.6Z" fill="' + (c || 'currentColor') + '"/></svg>'; };
  var TICK = function (c) { return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="' + c + '" stroke-width="3" aria-hidden="true"><path d="M4 12L10 18L20 6"/></svg>'; };
  var CROSS = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#6B717D" stroke-width="3" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>';
  var BACK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#C9CCD3" stroke-width="2" aria-hidden="true"><path d="M15 5L8 12L15 19"/></svg>';

  function tabs() { return ''; }   // нижняя панель живёт отдельно: см. buildNav / updateNav
  var NAV = [
    ['home', '#/', 'Страница', '<path d="M5 8H25"/><path class="mid" d="M9 16H29"/><path d="M5 24H25"/>'],
    ['radar', '#/radar', 'Радар', '<path d="M6 16A10 10 0 0 1 16 26"/><path d="M6 6A20 20 0 0 1 26 26"/><circle cx="17" cy="14" r="2.4" fill="currentColor" stroke="none"/>'],
    ['memory', '#/memory', 'Память', '<path d="M16 5A11 11 0 1 0 27 16"/><circle class="mid" cx="16" cy="16" r="3" fill="currentColor" stroke="none"/>'],
    ['layers', '#/layers', 'Слои', '<path d="M4 10H28"/><path d="M4 22H28"/><circle class="mid" cx="11" cy="10" r="3" fill="#12162A"/><circle cx="21" cy="22" r="3" fill="#12162A"/>'],
  ];
  var navEl = document.getElementById('nav');
  function buildNav() {
    navEl.innerHTML = '<div class="ind"><i></i></div>' + NAV.map(function (i) {
      return '<button data-go="' + i[1] + '" data-tab="' + i[0] + '" aria-label="' + i[2] + '"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' + i[3] + '</svg><span>' + i[2] + '</span></button>';
    }).join('');
    navEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-go]'); if (!b) return;
      haptic('light'); location.hash = b.dataset.go;
    });
  }
  function updateNav() {
    var name = route().name, tab = name === 'admin' ? 'layers' : name === 'ask' ? 'home' : name === 'week' ? 'memory' : name;
    var idx = NAV.map(function (n) { return n[0]; }).indexOf(tab);
    navEl.hidden = idx < 0 || (state.showOnb && name === 'home');
    if (idx < 0) return;
    navEl.querySelectorAll('button').forEach(function (b) { b.getAttribute('data-tab') === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); });
    navEl.querySelector('.ind').style.transform = 'translateX(' + (idx * 100) + '%)';
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
      if (act && i < 3) labels += '<text class="rlabel" style="animation-delay:' + (0.8 + i * 0.18) + 's" x="' + (+x + 11) + '" y="' + (+y + 3) + '">' + esc(m.name.split(/[ \u00a0]/)[0].toUpperCase()) + '</text>';
    });
    return '<svg class="radar-svg" viewBox="0 0 346 190" width="100%" role="img" aria-label="Радар: ' + list.length + ' отмеченных сообщений">' +
      '<path class="ring" d="M123 180A50 50 0 0 1 223 180"/><path class="ring" d="M73 180A100 100 0 0 1 273 180"/><path class="ring" d="M23 180A150 150 0 0 1 323 180"/>' +
      '<path class="ring" style="stroke-dasharray:none;stroke-dashoffset:0;animation:none" d="M0 180H346"/>' +
      '<line class="sweep" x1="173" y1="180" x2="173" y2="30" stroke="#C4FF2E" stroke-width="1.5" opacity=".75"/>' + blips + labels + '</svg>';
  }

  function onbVer() { return '2'; }   // версия знакомства: при изменении текста — поднять, и все увидят заново
  function onbDone() { try { return localStorage.getItem('sloy.onb') === onbVer(); } catch (e) { return true; } }
  var ONB = [
    ['Слой подчёркивает важное', 'Я читаю чаты, которые ты выбрал, и отмечаю то, что нельзя пропустить: сроки, просьбы, личное. Остальное — тишина.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><rect x="20" y="20" width="200" height="22" fill="currentColor" opacity=".18"/><rect x="20" y="52" width="200" height="22" fill="currentColor" opacity=".18"/><rect class="slab" x="46" y="52" width="120" height="22" fill="#C4FF2E"/><rect x="20" y="84" width="200" height="22" fill="currentColor" opacity=".1"/></svg>'],
    ['Свайпы и умные ответы', 'Вправо — ответить, влево — отложить на 3 часа. На «Я тебя люблю» подскажу «Я тебя тоже». Отправится только после твоего тапа.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><rect x="20" y="8" width="150" height="36" rx="12" fill="currentColor" opacity=".18"/><rect x="20" y="58" width="62" height="26" rx="13" fill="#C4FF2E"/><rect x="90" y="58" width="50" height="26" rx="13" fill="currentColor" opacity=".2"/><rect x="148" y="58" width="72" height="26" rx="13" fill="currentColor" opacity=".2"/><path d="M14 108H50M24 98L14 108L24 118" stroke="#C4FF2E" stroke-width="3" fill="none"/><path d="M226 108H190M216 98L226 108L216 118" stroke="#6E8BFF" stroke-width="3" fill="none"/></svg>'],
    ['Важные люди и тихие часы', 'Отметь человека ★ — сообщу сразу и даже ночью. С 23:00 до 08:00 все остальные уведомления молчат, но ничего не теряется.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><path d="M70 14L81 42L112 45L88 65L96 96L70 80L44 96L52 65L28 45L59 42Z" fill="#C4FF2E"/><path d="M178 22A42 42 0 1 0 204 96A32 32 0 1 1 178 22Z" fill="currentColor" opacity=".8"/></svg>'],
    ['Ты не ответил', 'Если важное сообщение ждёт ответа больше 3 часов, напомню. Не больше двух раз и не ночью. Ответил в чате — напоминание отменяется.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><circle cx="90" cy="65" r="46" fill="none" stroke="currentColor" stroke-width="4" opacity=".35"/><path d="M90 65V36M90 65L110 78" stroke="#C4FF2E" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="90" cy="65" r="5" fill="currentColor"/><rect x="156" y="40" width="64" height="22" rx="11" fill="#C4FF2E"/><rect x="156" y="70" width="46" height="14" rx="7" fill="currentColor" opacity=".2"/></svg>'],
    ['След: удалили или изменили', 'Если человек удалил или поправил сообщение, покажу, что там было, когда отправлено и когда исправлено. Можно выключить в «Слоях».',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><rect x="20" y="28" width="190" height="20" rx="3" fill="currentColor" opacity=".2"/><rect x="20" y="37" width="190" height="3" fill="#FF6A4D"/><rect x="20" y="66" width="140" height="20" rx="3" fill="#C4FF2E"/><rect x="20" y="96" width="90" height="8" rx="3" fill="currentColor" opacity=".18"/></svg>'],
    ['Итоги и поиск', 'В 21:00 пришлю итоги дня. На вкладке «Память» — неделя в цифрах. А в «Спроси слой» можно найти, что ты обещал Дане или что писала Маша.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><rect x="20" y="80" width="20" height="30" fill="currentColor" opacity=".2"/><rect x="50" y="62" width="20" height="48" fill="currentColor" opacity=".2"/><rect x="80" y="90" width="20" height="20" fill="currentColor" opacity=".2"/><rect x="110" y="48" width="20" height="62" fill="currentColor" opacity=".2"/><rect x="140" y="70" width="20" height="40" fill="currentColor" opacity=".2"/><rect x="170" y="30" width="20" height="80" fill="#C4FF2E"/><circle cx="204" cy="34" r="14" fill="none" stroke="currentColor" stroke-width="4"/><path d="M214 44L226 56" stroke="currentColor" stroke-width="4"/></svg>'],
    ['Всё под твоим контролем', 'Слой видит только выбранные тобой чаты и только новое. Каждый слой можно выключить, а память и сохранённое — стереть одним тапом.',
      '<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true"><circle cx="120" cy="65" r="44" fill="none" stroke="currentColor" stroke-width="3" opacity=".3"/><path d="M120 21A44 44 0 1 0 164 65" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="120" cy="65" r="12" fill="#C4FF2E"/></svg>'],
  ];
  function onboarding() {
    var i = state.onbStep || 0, s = ONB[i], last = i === ONB.length - 1;
    return '<main class="screen onb"><div class="top"><div class="brand">' + SYMBOL(26) + '<b>СЛОЙ</b></div><button class="m" data-act="onbskip" style="padding:8px">Пропустить</button></div>' +
      '<div class="onb-art">' + s[2] + '</div><h1 class="t" style="font-size:30px;line-height:1.1;margin-top:26px">' + s[0] + '</h1>' +
      '<p class="lead" style="font-size:19px">' + s[1] + '</p>' +
      '<div class="dots">' + ONB.map(function (x, k) { return '<i' + (k === i ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' +
      '<button class="btn go onb-btn" data-act="onbnext">' + (last ? 'Понятно, начнём' : 'Дальше') + '</button></main>';
  }

  /* ---------- тема ---------- */
  function loadTheme() { try { return localStorage.getItem('sloy.theme') || 'auto'; } catch (e) { return 'auto'; } }
  function effectiveTheme() {
    if (state.theme === 'light' || state.theme === 'dark') return state.theme;
    var t = tg(); if (t && t.colorScheme) return t.colorScheme;
    return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function applyTheme() {
    var th = effectiveTheme(); document.documentElement.setAttribute('data-theme', th);
    var col = th === 'light' ? '#F1EFE7' : '#0A0D18', t = tg();
    try { if (t) { t.setHeaderColor(col); t.setBackgroundColor(col); } } catch (e) {}
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', col);
  }
  applyTheme();
  if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme); } catch (e) {} }
  window.addEventListener('load', function () { var t = tg(); if (t && t.onEvent) t.onEvent('themeChanged', function () { applyTheme(); }); applyTheme(); });

  /* ---------- свайп по заметкам ---------- */
  var sw = null, swipeBlockUntil = 0;
  app.addEventListener('pointerdown', function (e) {
    var w = e.target.closest('.swipe'); if (!w || e.button > 0) return;
    sw = { w: w, el: w.querySelector('.pp,.chat'), x: e.clientX, y: e.clientY, dx: 0, drag: false, armed: false, id: e.pointerId };
  });
  app.addEventListener('pointermove', function (e) {
    if (!sw || e.pointerId !== sw.id) return;
    var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (!sw.drag) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { sw = null; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) { sw.drag = true; try { sw.w.setPointerCapture(e.pointerId); } catch (x) {} } else return;
    }
    sw.dx = dx; var lim = Math.max(-150, Math.min(150, dx));
    sw.el.style.transition = 'none'; sw.el.style.transform = 'translateX(' + lim + 'px)';
    var armed = Math.abs(dx) > 90; if (armed !== sw.armed) { sw.armed = armed; sw.w.classList.toggle('armed', armed); if (armed) haptic('light'); }
  });
  function endSwipe(e) {
    if (!sw || (e && e.pointerId !== sw.id)) return;
    var s = sw; sw = null;
    if (!s.drag) return;
    swipeBlockUntil = Date.now() + 350;                                   // тап после жеста не должен открывать карточку
    var id = s.w.getAttribute('data-swipe');
    if (s.dx > 90) { haptic('medium'); s.el.style.transition = 'transform .2s'; s.el.style.transform = 'translateX(0)'; location.hash = '#/card/' + id; return; }
    if (s.dx < -90) { haptic('medium'); snoozeMsg(id, 3); return; }
    s.w.classList.remove('armed'); s.el.style.transition = 'transform .3s cubic-bezier(.3,1.4,.4,1)'; s.el.style.transform = 'translateX(0)';
  }
  app.addEventListener('pointerup', endSwipe); app.addEventListener('pointercancel', endSwipe);
  app.addEventListener('click', function (e) { if (Date.now() < swipeBlockUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  function finishOnb() { state.showOnb = false; state.onbStep = 0; try { localStorage.setItem('sloy.onb', onbVer()); } catch (e) {} render(); }
  function runAsk() {
    var q = (state.askQ || '').trim(); if (!q) return;
    state.askBusy = true; render();
    var done = function (res) { state.askBusy = false; state.askRes = res; render(); };
    if (!state.live) {                                                    // демо: простой поиск по тому, что на экране
      var toks = q.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
      var res = D.messages.filter(function (m) { var t = (m.name + ' ' + m.segs.join('')).toLowerCase(); return toks.some(function (k) { return t.indexOf(k.slice(0, Math.max(3, k.length - 2))) >= 0; }); })
        .map(function (m) { return { name: m.name, text: m.fullSegs ? m.fullSegs.map(function (s) { return typeof s === 'string' ? s : s[0]; }).join('') : m.segs.join(''), time: m.time, date: 'сегодня', out: false, deleted: !!m.deleted }; });
      setTimeout(function () { done(res); }, 350); return;
    }
    api('POST', '/api/ask', { q: q }).then(function (r) { done(r.ok ? r.data.results : []); }).catch(function () { done([]); toast('Нет связи с сервером'); });
  }
  app.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'askQ') { state.askQ = e.target.value; runAsk(); } });
  function snoozeMsg(id, hours) {
    var done = function () { D.messages = D.messages.filter(function (m) { return m.id !== id; }); toast('Отложено на ' + hours + ' ч'); render(); };
    if (!state.live) { done(); return; }
    api('POST', '/api/snooze', { id: id, hours: hours }).then(function (r) { if (r.ok) done(); else toast('Не вышло отложить'); }).catch(function () { toast('Нет связи с сервером'); });
  }

  /* ---------- screens ---------- */
  // «След»: метка удалено / изменено.
  function traceTag(m, cls) {
    if (m.deleted) return '<span class="' + cls + ' del">удалено' + (m.deletedTime ? ' ' + esc(m.deletedTime) : '') + '</span>';
    if (m.edited) return '<span class="' + cls + ' edit">изменено</span>';
    return '';
  }
  // Обёртка со свайпом: вправо — ответить, влево — отложить на 3 часа.
  function swipeWrap(id, inner) {
    return '<div class="swipe" data-swipe="' + esc(id) + '"><div class="under"><i>Ответить →</i><i>← Отложить на 3 ч</i></div>' + inner + '</div>';
  }
  function home() {
    var important = D.messages.filter(function (m) { return m.level !== 'quiet'; });
    if (state.live && !state.loaded) return '<main class="screen">' + topbar('') + '<div class="sk" aria-label="Загрузка"><i></i><i></i><i></i></div></main>' + tabs('home');
    if (state.live && important.length === 0) return homeEmpty();
    var notes = important.map(function (m) {
      var head = '<div class="row"><span class="src">' + vipMark(m) + esc(m.name) + ' · ' + m.time + '</span>' + (m.tag === 'Срочно' ? '<span class="src b">Срочно</span>' : '') + traceTag(m, 'src') + '</div>';
      var foot = '<div class="row" style="margin-top:8px"><span class="note">' + esc(m.note) + '</span><span class="btn-d">Разбор</span></div>';
      return swipeWrap(m.id, '<button class="pp" data-go="#/card/' + m.id + '" aria-label="Разбор: ' + esc(m.name) + '">' + head + '<div class="txt">' + segs(m.segs) + '</div>' + foot + '</button>');
    }).join('');
    return '<main class="screen">' + topbar('Слушаю ' + D.now.listening + ' чатов') +
      '<div class="big hero"><svg class="ghost" viewBox="0 0 96 96" aria-hidden="true"><path d="M8 20a12 12 0 0 1 12-12H76a12 12 0 0 1 12 12V32H8Z"/><rect x="22" y="36" width="74" height="24"/><path d="M8 64H88V76a12 12 0 0 1-12 12H8Z"/></svg><div class="n" data-count="' + important.length + '">0</div><div style="padding-bottom:4px"><div class="u" style="font-size:16px;font-weight:800">важных</div><div class="m" style="margin-top:5px;line-height:1.5">из ' + D.now.total + ' новых<br>сегодня · ' + D.now.time + '</div></div></div>' +
      '<p class="lead">Я прошёлся по личным чатам. Вот что отметил.</p>' +
      '<div class="stack">' + notes + '</div>' +
      '<button class="ask" data-go="#/ask"><i>&gt;</i>Спроси слой: что я обещал…</button></main>' + tabs('home');
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
      var inner = '<div class="av">' + esc(m.ini) + '</div><div style="flex:1;min-width:0"><div class="hd"><span class="nm">' + vipMark(m) + esc(m.name) + '</span><span class="m">' + m.time + '</span></div><div class="tx">' + segs(m.segs) + '</div>' + traceTag(m, 'tr') + '</div>';
      var canOpen = !quiet || (m.replies && m.replies.length);
      if (!canOpen) return '<div class="chat q">' + inner + '</div>';
      return swipeWrap(m.id, '<button class="chat' + (quiet ? ' q soft' : '') + '" data-go="#/card/' + m.id + '">' + inner + '</button>');
    }).join('');
    return '<main class="screen">' +
      '<div class="top"><h1 class="t">RADAR</h1><div class="pill"><i class="dot"></i>Живой</div></div>' +
      '<p class="lead" style="font-size:19px;margin-top:8px">Подчёркиваю важное, остальное — тишина.</p>' +
      radarSvg(D.messages.filter(function (m) { return m.level !== 'quiet'; }).slice(0, 8)) + '<div class="legend"><span><span class="hl" style="animation:none">Действие</span></span><span><span class="ul">Просто знай</span></span><span class="m" style="margin-left:auto">Личные ' + D.now.listening + (D.now.of ? ' из ' + D.now.of : '') + '</span></div>' +
      '<div style="margin-top:12px">' + (rows || '<p class="lead" style="font-size:17px">Пока тишина. Слой слушает.</p>') + '</div>' +
      (D.quietCount ? '<div class="silent">…и ещё ' + D.quietCount + ' в тишине</div>' : '') +
      '<div class="pp group" style="transform:rotate(.4deg)"><div class="row"><div><span class="src b">Группы</span><div style="font-size:13.5px;line-height:1.4;margin-top:3px;font-weight:500">«Диплом» пока в тишине: слой видит группу, только если его туда добавили.</div></div><button class="btn-d" data-act="groups" style="flex:none">Как</button></div></div>' +
      '</main>' + tabs('radar');
  }

  function card(id) {
    var m = msg(id);
    if (!m || (m.level === 'quiet' && !(m.replies && m.replies.length))) return notFound();
    var quietCard = m.level === 'quiet';
    var variants = (m.replies && m.replies.length) ? m.replies : (m.reply ? [m.reply] : []);
    var vi = (state.replyIdx[m.id] || 0) % Math.max(1, variants.length), rp = variants[vi] || { tone: 'Тепло', text: '' };
    var arrows = '<svg class="arrows" viewBox="0 0 346 52" width="100%" height="52" aria-hidden="true"><g fill="none" stroke="#8FA5FF" stroke-width="1.6" stroke-linecap="round"><path d="M126 2C122 22 90 28 52 46"/><path d="M42 36L52 46L38 48"/><path d="M262 2C262 24 268 32 290 46"/><path d="M280 48L290 46L286 34"/></g></svg>';
    var noteList = [];
    (m.history || []).forEach(function (h) { noteList.push('<div class="pp"><span class="src b">Было · ' + esc(h.time) + '</span><div class="txt" style="margin-top:3px;font-size:15px">' + esc(h.text) + '</div></div>'); });
    if (m.ask) noteList.push('<div class="pp"><span class="src">Что просят</span><div class="txt" style="margin-top:3px;font-size:15px">' + esc(m.ask) + '</div></div>');
    if (m.deadline && m.deadline !== 'Без срока') noteList.push('<div class="pp"><span class="src">Срок</span><div class="txt" style="margin-top:3px;font-size:15px"><span class="hl" style="animation:none">' + esc(m.deadline) + '</span> ' + (m.left ? '<span class="note" style="margin-left:4px">' + esc(m.left) + '</span>' : '') + '</div></div>');
    if (m.memory) noteList.push('<div class="pp"><span class="src b">Помню</span><div class="txt" style="margin-top:3px;font-size:15px">' + esc(m.memory) + '</div></div>');
    var notes = '<div class="stack" style="margin-top:2px;gap:11px">' + noteList.join('') + '</div>';
    var composer = '<div class="composer"><div class="row"><span class="m" style="color:var(--nav-active)">Reply · ' + esc(rp.tone).toLowerCase() + ' · ' + (vi + 1) + '/' + variants.length + '</span>' + (variants.length > 1 ? '<button class="m" data-act="nextreply" data-id="' + m.id + '" style="color:var(--blue)">Ещё вариант ↻</button>' : '') + '</div>' +
      '<div class="txt" id="replyText" style="margin-top:6px"' + (state.editing ? ' contenteditable="true"' : '') + '>' + esc(rp.text) + '</div>' +
      '<div class="btns"><button class="btn" data-act="edit">' + (state.editing ? 'Готово' : 'Править') + '</button><button class="btn go" data-act="send" data-id="' + m.id + '">Отправить от меня</button></div>' +
      '<div class="fine">Уйдёт из твоего аккаунта только после тапа · окно ответа 24 ч</div></div>';
    return '<main class="screen" style="padding-bottom:230px"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><div class="av" style="width:34px;height:34px;font-size:11px">' + esc(m.ini) + '</div><div><b style="font-weight:600;font-size:15px">' + esc(m.name) + '</b><div class="m" style="font-size:9.5px">Разбор сообщения · ' + m.time + '</div></div>' + vipBtn(m) + '</div>' +
      (m.deleted ? '<div class="m" style="margin-top:18px;color:#FF6A4D">Удалено в ' + esc(m.deletedTime) + ' · слой сохранил текст</div>' : '') + (m.edited && !m.deleted ? '<div class="m" style="margin-top:18px;color:var(--blue)">Сообщение изменили</div>' : '') + '<div class="bubble" style="margin-top:' + ((m.deleted || m.edited) ? 8 : 22) + 'px">' + segs(m.fullSegs || m.segs) + '<span class="m">' + m.time + '</span></div>' + (quietCard ? '' : arrows + notes) + '</main>' + composer;
  }

  function memory() {
    var facts = D.facts.map(function (f) { return '<div class="pp"><span class="src b">' + esc(f.t) + '</span><div class="txt" style="font-size:15px;margin-top:3px">' + esc(f.s) + '</div></div>'; }).join('');
    return '<main class="screen"><h1 class="t">Память</h1><p class="lead" style="font-size:19px;margin-top:8px">Что я о тебе помню. Ничего лишнего.</p>' +
      '<button class="clear" data-go="#/week" style="margin:14px 0 0">Неделя в цифрах →</button>' +
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
      (state.isAdmin ? '<button class="clear" data-go="#/admin" style="border-color:#C4FF2E;color:#C4FF2E">Админ-панель</button>' : '') +
      '<div class="m" style="margin:22px 0 0">Тема</div><div class="seg">' + [['auto', 'Как в Telegram'], ['dark', 'Тёмная'], ['light', 'Светлая']].map(function (t) { return '<button class="chip' + (state.theme === t[0] ? ' on' : '') + '" data-act="theme" data-id="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<button class="clear" data-act="onbshow">Показать знакомство снова</button>' +
      '<button class="clear" data-go="#/paywall">' + (state.isAdmin ? 'Тариф: админ — всё включено' : 'Мой билет · СЛОЙ') + '</button></main>' + tabs('layers');
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
      (state.isAdmin ? '<div class="cta"><div class="go" style="background:#1A2036;color:#C4FF2E">Админ: всё включено без оплаты</div></div><div style="display:none">' : '<div class="cta"><button class="go" data-act="pay">' + go + '</button>' + alt) + '<div class="m" style="text-align:center;margin-top:10px;font-size:9.5px;line-height:1.6">Telegram Stars · /terms · /support</div></div>' + (state.isAdmin ? '</div>' : '');
  }

  function admin() {
    if (!state.isAdmin) return notFound();
    var st = state.adminStats;
    var cells = st ? [['Пользователей', st.users], ['Подключено', st.connections], ['Сообщений всего', st.messages], ['За 24 часа', st.messages24h], ['Важных за 24 часа', st.important24h], ['Платных', st.paid]]
      .map(function (c) { return '<div class="pp" style="padding:12px 14px"><span class="src">' + c[0] + '</span><div class="u" style="font-size:26px;font-weight:800;margin-top:4px">' + c[1] + '</div></div>'; }).join('')
      : '<div class="sk" style="grid-column:1/3"><i></i><i></i><i></i></div>';
    var plans = [['sloy', 'СЛОЙ'], ['max', 'МАКС'], ['start', 'Снять тариф']].map(function (p) {
      return '<button class="chip' + (state.adminPlan === p[0] ? ' on' : '') + '" data-act="adminplan" data-id="' + p[0] + '">' + p[1] + '</button>';
    }).join('');
    return '<main class="screen"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><h1 class="t" style="margin:0">Админ</h1></div>' +
      '<p class="lead" style="font-size:18px;margin-top:8px">Всё включено для тебя без оплаты.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">' + cells + '</div>' +
      '<div class="m" style="margin:24px 0 8px">Выдать билет</div>' +
      '<input class="fld" id="adminUid" inputmode="numeric" placeholder="Telegram ID человека" value="' + esc(state.adminUid || '') + '">' +
      '<input class="fld" id="adminDays" inputmode="numeric" placeholder="Дней (например 30)" value="' + esc(state.adminDays || '30') + '">' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' + plans + '</div>' +
      '<button class="btn go" data-act="admingrant" style="margin-top:14px;width:100%;height:48px;border-radius:99px">Выдать</button>' +
      '<div class="fine">Узнать ID человека: пусть напишет боту команду /id</div></main>' + tabs('layers');
  }

  function vipMark(m) { return m.vip ? '★ ' : ''; }
  function vipBtn(m) {
    if (m.chatId == null) return '';
    return '<button class="vipbtn' + (m.vip ? ' on' : '') + '" data-act="vip" data-chat="' + m.chatId + '" aria-pressed="' + !!m.vip + '" aria-label="Важный человек">★<span>' + (m.vip ? 'Важный' : 'Важный?') + '</span></button>';
  }

  function ask() {
    var chips = ['что я обещал Дане?', 'что писала Маша вчера?', 'акт', 'конспект'].map(function (c) { return '<button class="chip" data-act="askex" data-q="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
    var res = '';
    if (state.askBusy) res = '<div class="sk"><i></i><i></i><i></i></div>';
    else if (state.askRes && !state.askRes.length) res = '<p class="lead" style="font-size:18px">Ничего не нашёл. Попробуй другое слово или имя.</p>';
    else if (state.askRes) res = '<div class="stack">' + state.askRes.map(function (r) {
      return '<div class="pp"><div class="row"><span class="src">' + (r.out ? 'Ты → ' : '') + esc(r.name) + '</span><span class="src">' + esc(r.date || '') + ' ' + esc(r.time) + '</span></div><div class="txt" style="font-size:15px">' + esc(r.text) + '</div>' + (r.deleted ? '<div class="src del" style="margin-top:6px">удалено</div>' : '') + '</div>';
    }).join('') + '</div>';
    return '<main class="screen"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><h1 class="t" style="margin:0">Спроси слой</h1></div>' +
      '<p class="lead" style="font-size:18px;margin-top:8px">Ищу по сохранённым сообщениям: по имени, словам и дням.</p>' +
      '<input class="fld" id="askQ" placeholder="Например: что я обещал Дане?" value="' + esc(state.askQ) + '" enterkeyhint="search" autocomplete="off">' +
      '<button class="btn go" data-act="askgo" style="margin-top:10px;width:100%;height:46px;border-radius:99px">Найти</button>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px">' + chips + '</div>' + res + '</main>' + tabs('home');
  }

  var DAYN = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  function week() {
    var w = state.week;
    if (!w) return '<main class="screen"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><h1 class="t" style="margin:0">Неделя</h1></div><div class="sk"><i></i><i></i><i></i></div></main>' + tabs('memory');
    var cells = [['Получено', w.received], ['Важных', w.important], ['В тишине', w.quiet], ['Твоих ответов', w.sent]].map(function (c) {
      return '<div class="pp" style="padding:12px 14px"><span class="src">' + c[0] + '</span><div class="u" style="font-size:28px;font-weight:800;margin-top:4px" data-count="' + c[1] + '">0</div></div>';
    }).join('');
    var max = Math.max(1, Math.max.apply(null, w.days.map(function (d) { return d.total; })));
    var today = new Date().getDay();
    var bars = w.days.map(function (d, i) {
      var label = DAYN[(today - (6 - i) + 7 * 2) % 7];
      return '<div class="bar"><div class="col"><i class="all" style="height:' + Math.round(d.total / max * 100) + '%;animation-delay:' + (i * 70) + 'ms"></i><i class="imp" style="height:' + Math.round(d.important / max * 100) + '%;animation-delay:' + (i * 70 + 120) + 'ms"></i></div><span class="m">' + label + '</span></div>';
    }).join('');
    var avg = w.avgReplyMin == null ? '—' : (w.avgReplyMin >= 60 ? Math.round(w.avgReplyMin / 60 * 10) / 10 + ' ч' : w.avgReplyMin + ' мин');
    return '<main class="screen"><div class="back"><button data-act="back" aria-label="Назад">' + BACK + '</button><h1 class="t" style="margin:0">Неделя</h1></div>' +
      '<p class="lead" style="font-size:18px;margin-top:8px">Сколько шума слой убрал за семь дней.</p>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px">' + cells + '</div>' +
      '<div class="m" style="margin:22px 0 8px">Сообщения по дням · <span style="color:var(--nav-active)">важные</span></div><div class="bars">' + bars + '</div>' +
      '<div class="pp" style="margin-top:20px"><span class="src b">Среднее время ответа на важное</span><div class="u" style="font-size:26px;font-weight:800;margin-top:4px">' + avg + '</div><div class="note" style="margin-top:4px">ответов на важное: ' + w.answered + '</div></div></main>' + tabs('memory');
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
      case 'home': html = state.showOnb ? onboarding() : home(); break;
      case 'radar': html = radar(); break;
      case 'card': html = card(r.id); break;
      case 'memory': html = memory(); break;
      case 'layers': html = layers(); break;
      case 'paywall': html = paywall(); break;
      case 'ask': html = ask(); break;
      case 'week': if (!state.week) loadWeek(); html = week(); break;
      case 'admin': html = admin(); if (state.isAdmin && !state.adminStats) loadAdminStats(); break;
      default: html = notFound();
    }
    app.innerHTML = html;
    updateNav();
    countUps();
    syncBack();
  }
  window.addEventListener('hashchange', function () { state.editing = false; if (route().name === 'week') state.week = null; window.scrollTo(0, 0); render(); });
  window.addEventListener('load', function () { initTg(); loadFeed(); });

  /* ---------- actions ---------- */
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go],[data-act]'); if (!el) return;
    if (el.dataset.go) { haptic(); location.hash = el.dataset.go; return; }
    var act = el.dataset.act;
    if (act === 'back') { history.length > 1 ? history.back() : (location.hash = '#/'); return; }
    if (act === 'toggle') {
      state.layers[el.dataset.id] = !state.layers[el.dataset.id]; saveLayers(); haptic(); render();
      if (state.live) api('POST', '/api/settings', { layers: state.layers }).catch(function () {});
      return;
    }
    if (act === 'theme') { state.theme = el.dataset.id; try { localStorage.setItem('sloy.theme', state.theme); } catch (e) {} applyTheme(); haptic(); render(); return; }
    if (act === 'nextreply') { state.replyIdx[el.dataset.id] = (state.replyIdx[el.dataset.id] || 0) + 1; state.editing = false; haptic(); render(); return; }
    if (act === 'onbnext') { haptic(); if ((state.onbStep || 0) >= ONB.length - 1) { finishOnb(); } else { state.onbStep = (state.onbStep || 0) + 1; render(); } return; }
    if (act === 'onbshow') { state.showOnb = true; state.onbStep = 0; haptic(); if (location.hash === '#/' || location.hash === '') render(); else location.hash = '#/'; return; }
    if (act === 'onbskip') { finishOnb(); return; }
    if (act === 'askex') { state.askQ = el.dataset.q; runAsk(); return; }
    if (act === 'askgo') { var inp = document.getElementById('askQ'); state.askQ = inp ? inp.value : state.askQ; runAsk(); return; }
    if (act === 'vip') {
      var cid = Number(el.dataset.chat), on = el.getAttribute('aria-pressed') !== 'true';
      D.messages.forEach(function (m) { if (m.chatId === cid) m.vip = on; }); haptic('medium'); render();
      toast(on ? 'Важный человек: всегда сообщу сразу' : 'Больше не важный');
      if (state.live) api('POST', '/api/vip', { chatId: cid, on: on }).catch(function () {});
      return;
    }
    if (act === 'adminplan') { state.adminPlan = el.dataset.id; haptic(); render(); return; }
    if (act === 'admingrant') {
      var uid = (document.getElementById('adminUid') || {}).value, days = (document.getElementById('adminDays') || {}).value;
      state.adminUid = uid; state.adminDays = days;
      api('POST', '/api/admin/grant', { userId: uid, plan: state.adminPlan || 'sloy', days: days }).then(function (r) {
        if (r.ok) { haptic('medium'); toast('Выдано'); loadAdminStats(); } else toast('Не вышло: проверь ID и дни');
      }).catch(function () { toast('Нет связи с сервером'); });
      return;
    }
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
        if (r.ok) toast('Отправлено'); else if (r.status === 402) { toast('Ответы — на тарифе СЛОЙ'); location.hash = '#/paywall'; } else if (r.status === 409) toast('Слой отключён в Telegram Business'); else toast('Не отправилось. Окно ответа — 24 часа');
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

  app.addEventListener('input', function (e) {
    if (e.target.id === 'adminUid') state.adminUid = e.target.value;
    if (e.target.id === 'adminDays') state.adminDays = e.target.value;
  });
  buildNav();
  render();
})();
