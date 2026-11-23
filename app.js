/* MotoLink web sürümü (iPhone ve tarayıcılar için).
 * Android uygulamasıyla aynı sunucuyu (Google Apps Script) ve aynı ses sunucusunu (LiveKit) kullanır,
 * aynı oda mesajlarını konuşur: herkes aynı odada buluşur.
 */
(function () {
  'use strict';
  const CFG = window.MOTOLINK;
  const LK = window.LivekitClient;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // 1.3.1: sayfa her telefonda tam ekranı doldursun (iPhone'da alttaki siyah boşluk kalmasın)
  // 1.4.10: iPhone ana ekran uygulamasında iOS yüksekliği eksik bildiriyor (altta ~1,5 cm boşluk kalıyordu): ekranın gerçek boyu kullanılır
  function fitApp() {
    try {
      // 1.4.17: iPhone ana ekran uygulamasında sayfa sadece innerHeight kadarını çizebilir (örn. 852 / ekran 896).
      // Daha uzun yapınca alt tuşlar kesiliyordu. Artık TAM innerHeight kullanılır; kalan şerit tuş çubuğuyla aynı renkte boyanır.
      const h = window.innerHeight || document.documentElement.clientHeight || 0;
      document.documentElement.style.setProperty('--appH', h + 'px');
      document.documentElement.style.setProperty('--fullH', h + 'px');
      const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
      const pr = document.getElementById('safeProbe'); let sb = '?', st = '?';
      if (pr) { const cs = getComputedStyle(pr); sb = parseInt(cs.paddingBottom) || 0; st = parseInt(cs.paddingTop) || 0; }
      window.__fitInfo = 'iç ' + h + ' · ekran ' + (screen ? screen.width + 'x' + screen.height : '?') + ' · güvenli üst ' + st + ' alt ' + sb + (standalone ? ' · ana ekran' : ' · tarayıcı');
    } catch (e) {}
  }
  // 1.3.4: Bas-konuş topuzunun çapı = sahne genişliğinin %34,3'ü (piksel), böylece her telefonda tam daire olur
  function fitKnob() { try { const st = document.querySelector('.stage'); if (!st) return; const w = st.clientWidth || (window.innerWidth - 32); st.style.setProperty('--kd', Math.round(w * 0.343) + 'px'); } catch (e) {} }
  window.addEventListener('resize', () => { fitKnob(); setTimeout(fitKnob, 150); }); window.addEventListener('orientationchange', () => setTimeout(fitKnob, 300));
  if (window.ResizeObserver) { try { new ResizeObserver(fitKnob).observe(document.querySelector('.stage')); } catch (e) {} }
  setTimeout(fitKnob, 300); setInterval(fitKnob, 4000);
  // 1.4.7: oda sayfası kısa ekranlarda da SIĞSIN: alttaki Odadakiler / 📣 / 💬 tuşları hep görünür; gerekirse Bas-konuş sahnesi küçülür
  function fitRoom() {
    try {
      const body = document.getElementById('roomBody'), st = document.querySelector('.stage');
      if (!body || body.classList.contains('hidden') || !st || !body.clientHeight) return;
      const full = body.clientWidth;
      st.style.width = full + 'px'; st.style.marginLeft = 'auto'; st.style.marginRight = 'auto';
      const over = body.scrollHeight - body.clientHeight;
      if (over > 0) {
        const h = st.offsetHeight;
        const nh = Math.max(h * 0.5, h - over - 6);
        st.style.width = Math.round(full * nh / h) + 'px';
      }
      fitKnob();
    } catch (e) {}
  }
  window.addEventListener('resize', () => setTimeout(fitRoom, 120)); window.addEventListener('orientationchange', () => setTimeout(fitRoom, 350));
  // 1.4.7: HAFİF MOD: eski / zayıf telefonlarda parlama, gölge, kayan yazı ve sık güncellenen efektler kapanır
  function autoLite() {
    return true;   // 1.4.11: kasılma olmasın diye web'de efektler herkeste baştan kapalı (Ayarlar > Hafif mod'dan açılabilir)
  }
  function autoLiteOld() {
    const ua = navigator.userAgent || '';
    const m = ua.match(/OS (\d+)_\d+.*like Mac OS X/);
    const oldIos = m && +m[1] < 16;
    const fewCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 3;
    return !!(oldIos || fewCores || lowMem);
  }
  function applyLite() {
    const pref = store.get('lite', null);   // null: otomatik
    const on = pref === null ? autoLite() : !!pref;
    document.body.classList.toggle('lite', on);
    return on;
  }
  setTimeout(applyLite, 0);   // (store aşağıda tanımlanıyor)
  fitApp(); window.addEventListener('resize', fitApp); window.addEventListener('orientationchange', () => setTimeout(fitApp, 250)); setTimeout(fitApp, 400); setTimeout(fitApp, 1500); document.addEventListener('visibilitychange', () => setTimeout(fitApp, 300));
  // ------------------------------------------------------------ küçük kayıt (telefonda)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ml_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ml_' + k, JSON.stringify(v)); } catch (e) {} },
    clear() { try { Object.keys(localStorage).filter((k) => k.startsWith('ml_')).forEach((k) => localStorage.removeItem(k)); } catch (e) {} }
  };
  function myIdentity() {
    let id = store.get('id', '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      const r = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)));
      id = 'web-' + r;
      store.set('id', id);
    }
    return id;
  }
  const opt = {
    noise: store.get('noise', true), echo: store.get('echo', true), agc: store.get('agc', true),
    wake: store.get('wake', true), speak: store.get('speak', true)
  };

  // ------------------------------------------------------------ durum
  const S = {
    id: myIdentity(),
    name: store.get('name', ''),
    room: null, code: '', title: '', locked: false, permanent: false, server: '',
    connecting: false, wantRoom: null, kicked: false,
    micOn: false, open: false, live: false,
    owner: '', admins: new Set(), lockedIds: new Set(), silenced: new Set(), roomLock: false,
    modes: {}, onCall: new Set(), callInfo: {}, locs: {}, myLoc: null,
    locMode: store.get('locMode', 'off'), watchId: null, lastLocSent: 0,
    mySos: (() => { const m = store.get('mySos', null); return m && m.at && Date.now() - m.at < 12 * 3600e3 ? m : null; })(), lastPing: {},
    nicks: {}, approval: false, reqTimer: null, seenReq: new Set(), liveSince: 0,
    tickTimer: null, tickFirst: null, lastTick: 0
  };
  const MODES = { ptt: 'Bas-konuş', open: 'Eller Serbest', live: 'Sürekli Açık' };

  // ------------------------------------------------------------ sunucu
  async function api(body) {
    body.key = CFG.KEY;
    let res;
    try {
      res = await fetch(CFG.SERVER, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error(navigator.onLine === false
        ? 'İnternet bağlantısı yok. Uçak modunu kapat, mobil veriyi ya da Wi-Fi\'yi aç ve tekrar dene.'
        : 'Sunucuya ulaşılamadı. İnterneti kontrol edip tekrar dene.');
    }
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (!j) throw new Error('Sunucu cevabı okunamadı. Biraz sonra tekrar dene.');
    if (j.error) { const er = new Error(j.error); er.code = j.code || ''; er.room = j.room || null; throw er; }
    return j;
  }
  function beacon(body) {
    body.key = CFG.KEY;
    try { fetch(CFG.SERVER, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).catch(() => {}); } catch (e) {}
  }

  function normCode(s) {
    const map = { 'Ç': 'C', 'Ğ': 'G', 'İ': 'I', 'I': 'I', 'Ö': 'O', 'Ş': 'S', 'Ü': 'U', 'ç': 'C', 'ğ': 'G', 'ı': 'I', 'i': 'I', 'ö': 'O', 'ş': 'S', 'ü': 'U' };
    let t = String(s || '').trim().replace(/[ÇĞİIÖŞÜçğıiöşü]/g, (c) => map[c] || c);
    t = t.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
    return t.substring(0, 32).replace(/-+$/, '');
  }
  const validCode = (c) => /^[A-Z0-9-]{3,32}$/.test(c);
  // 1.4.6: davet bağlantısı web sitesindeki katıl sayfası (Android: uygulama açılır / yoksa indirilir · iPhone: web sürümü)
  const inviteUrl = (c) => new URL('katil.html?c=' + encodeURIComponent(c), location.href.split('?')[0].replace(/[^/]*$/, '')).href;

  // ------------------------------------------------------------ arayüz yardımcıları
  let toastT = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), Math.min(ms || 3000, 6000));
  }
  // 1.4.8: bildirim üstte, kısa; dokununca kapanır
  $('#toast').addEventListener('click', () => { clearTimeout(toastT); $('#toast').classList.add('hidden'); });
  function busy(on, text) {
    $('#busyText').textContent = text || 'Bağlanıyor…';
    $('#busy').classList.toggle('hidden', !on);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function sheet(html, onReady) {
    $('#sheetBox').innerHTML = html;
    $('#sheet').classList.remove('hidden');
    if (onReady) onReady($('#sheetBox'));
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetBox').innerHTML = ''; }
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

  const COLORS = ['#46e38a', '#ffb547', '#3ff0e4', '#b9f25c', '#ff7eb6', '#8fa8ff', '#ffd23c', '#ff8a5c', '#c39bff', '#5ce1ff'];
  function colorOf(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
  // 1.4.8: profil resimleri (Android ile aynı: giriş anahtarındaki "av" = küçük JPEG base64)
  const AVC = {}, AVU = {};
  function avSrc(id) {
    let b = '';
    if (id === S.id) b = store.get('avatar', '') || '';
    else if (S.room) {
      let p = null; S.room.remoteParticipants.forEach((x) => { if (x.identity === id) p = x; });
      const k = p && p.metadata;
      if (k) { if (AVC[id] && AVC[id].k === k) b = AVC[id].b; else { try { b = JSON.parse(k).av || ''; } catch (e) {} AVC[id] = { k, b }; } }
    }
    if (!b || !/^[A-Za-z0-9+/=]+$/.test(b)) return '';
    // 1.4.11: resim bir kez çözülür, sonra kısa bir adresle kullanılır (her çizimde koca yazı yerine)
    if (AVU[b]) return AVU[b];
    try { const bin = atob(b); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); AVU[b] = URL.createObjectURL(new Blob([u8], { type: 'image/jpeg' })); } catch (e) { AVU[b] = 'data:image/jpeg;base64,' + b; }
    return AVU[b];
  }
  function avIn(id, name) { const u = avSrc(id); return u ? '<img src="' + u + '" alt="">' : esc(initial(name)); }
  function initial(n) { return (String(n || '?').trim()[0] || '?').toLocaleUpperCase('tr-TR'); }

  function speak(text) {
    if (!opt.speak || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'tr-TR'; u.rate = 1.02;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  let actx = null;
  function audioCtx() {
    try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {}
    return actx;
  }
  function beep(times, freq) {
    const c = audioCtx(); if (!c) return;
    for (let i = 0; i < (times || 1); i++) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = freq || 880; o.type = 'square';
      const t0 = c.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 0.27);
    }
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  function dist(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const fmtDist = (m) => m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : Math.round(m) + ' m';

  // Yazı kutuya sığmazsa küçülsün (hiçbir yerde taşmasın)
  function fit(el, max, min) {
    if (!el) return;
    let fs = max; el.style.fontSize = fs + 'px';
    let guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && fs > min && guard++ < 40) { fs -= 0.5; el.style.fontSize = fs + 'px'; }
  }

  // ------------------------------------------------------------ sayfalar
  const ICON = {
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    room: 'M9 13c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm7.76-9.64l-1.68 1.69c.84 1.18.84 2.71 0 3.89l1.68 1.69c2.02-2.02 2.02-5.07 0-7.27zM20.07 2l-1.63 1.63c2.77 3.02 2.77 7.56 0 10.74L20.07 16c3.9-3.89 3.91-9.95 0-14z',
    map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
    music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
    set: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'
  };
  $$('#nav .it').forEach((b) => {
    b.querySelector('.btn').innerHTML = '<svg viewBox="0 0 24 24"><path d="' + ICON[b.dataset.p] + '"/></svg>';
    b.addEventListener('click', () => go(b.dataset.p));
  });
  let page = 'home';
  function go(p) {
    page = p;
    if (p === 'room') setTimeout(fitRoom, 60);
    $$('.page').forEach((x) => x.classList.toggle('on', x.id === 'p-' + p));
    $$('#nav .it').forEach((x) => x.classList.toggle('on', x.dataset.p === (p === 'rooms' || p === 'routes' || p === 'friends' || (p === 'plan' && PLAN.from === 'routes') ? 'home' : p === 'plan' ? 'map' : p)));
    if (p === 'rooms') { renderHome(); refreshCounts(); }
    if (p === 'room' && !S.room) { renderRoom(); refreshCounts(); }
    if (p === 'routes') renderRoutes();
    if (p === 'plan') setTimeout(initPlanMap, 40);
    if (p === 'map') setTimeout(initMap, 30);
    if (p === 'music') { loadStations(); renderMShare(); }
    if (p === 'room') renderRoom();
  }

  // ------------------------------------------------------------ ana sayfa
  // ------------------------------------------------------------ 1.2.0: Metal Konsol LCD (yeşil · retro zeytin · kırmızı)
  const LCD_STYLES = ['', 'lcd-olive', 'lcd-red'];
  function applyLcd() {
    const st = +store.get('lcd', 0) || 0;
    document.body.classList.remove('lcd-olive', 'lcd-red');
    if (LCD_STYLES[st]) document.body.classList.add(LCD_STYLES[st]);
  }
  // 7 parçalı dijital rakam (eski kırmızı LED/LCD saatlerdeki gibi, hafif eğik)
  function seg7(txt) {
    const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' };
    const h = 100, w = 52, t = 13, gap = 16, sl = 0.10, m = h / 2, g = t * 0.12;
    const sk = (x, y) => (x + (m - y) * sl).toFixed(1) + ',' + y.toFixed(1);
    const hs = (x0, x1, y) => [sk(x0 + g, y), sk(x0 + t / 2 + g, y - t / 2), sk(x1 - t / 2 - g, y - t / 2), sk(x1 - g, y), sk(x1 - t / 2 - g, y + t / 2), sk(x0 + t / 2 + g, y + t / 2)].join(' ');
    const vs = (x, y0, y1) => [sk(x, y0 + g), sk(x + t / 2, y0 + t / 2 + g), sk(x + t / 2, y1 - t / 2 - g), sk(x, y1 - g), sk(x - t / 2, y1 - t / 2 - g), sk(x - t / 2, y0 + t / 2 + g)].join(' ');
    let out = '', cx = 6;
    for (const ch of txt) {
      const L = cx + t / 2, R = cx + w - t / 2, T = t / 2, B = h - t / 2;
      const P = { a: hs(L, R, T), g: hs(L, R, m), d: hs(L, R, B), f: vs(L, T, m), b: vs(R, T, m), e: vs(L, m, B), c: vs(R, m, B) };
      for (const k in P) {
        const on = (SEG[ch] || '').includes(k);
        out += '<polygon points="' + P[k] + '" fill="' + (on ? '#ff2a18' : '#3a0806') + '"' + (on ? ' filter="url(#gl)"' : '') + '/>';
      }
      cx += w + gap;
    }
    const W = cx + 6;
    return '<svg viewBox="0 0 ' + W + ' ' + h + '" xmlns="http://www.w3.org/2000/svg"><defs><filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' + out + '</svg>';
  }
  const ROOM_COUNTS = {};
  const ROOM_NAMES = {};
  async function refreshCounts() {
    const rooms = (store.get('rooms', []) || []).map((r) => r.code).slice(0, 40);
    if (!rooms.length) return;
    try {
      const j = await api({ action: 'counts', room: rooms[0], identity: MY_CODE, rooms });
      Object.assign(ROOM_COUNTS, j.counts || {});
      try {
        const busy = Object.keys(j.counts || {}).filter((k) => j.counts[k] > 0);
        Object.keys(ROOM_NAMES).forEach((k) => { if (!(ROOM_COUNTS[k] > 0)) delete ROOM_NAMES[k]; });
        if (busy.length) { const m = await api({ action: 'members', room: busy[0], identity: MY_CODE, rooms: busy.slice(0, 20) }); Object.assign(ROOM_NAMES, m.members || {}); }
      } catch (e) {}
      renderHome(); if (!S.room) renderRoom();
    } catch (e) {}
  }
  function renderLcd() {
    const now = new Date();
    const days = ['PAZ', 'PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CMT'], mons = ['OCA', 'ŞUB', 'MAR', 'NIS', 'MAY', 'HAZ', 'TEM', 'AĞU', 'EYL', 'EKI', 'KAS', 'ARA'];
    $('#lDate').textContent = now.getDate() + ' ' + mons[now.getMonth()] + ' ' + days[now.getDay()];
    $('#lClock').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    $('#lStatus').textContent = S.room ? 'MOTOLINK · ODADA' : 'MOTOLINK · HAZIR';
    $('#lFriends').textContent = friends().length + ' ARKADAŞ';
    $('#lCode').textContent = 'KOD ' + prettyCode(MY_CODE);
    const rs = store.get('rooms', []) || [];
    const box = $('#lRoom');
    if (S.room) {
      $('#lRoomTag').textContent = 'ŞU AN ODADASIN';
      $('#lRoomName').textContent = (($('#rTitle') && $('#rTitle').textContent) || S.code || '').toLocaleUpperCase('tr-TR');
      $('#lRoomGo').innerHTML = '▶<small>ODAYA GİT</small>'; box.classList.remove('hidden');
      $('#lRoomGo').onclick = () => go('room');
    } else if (rs[0]) {
      $('#lRoomTag').textContent = 'SON ODA';
      $('#lRoomName').textContent = (rs[0].name || rs[0].code).toLocaleUpperCase('tr-TR');
      $('#lRoomGo').innerHTML = '▶<small>GİR</small>'; box.classList.remove('hidden');
      $('#lRoomGo').onclick = () => joinRoom(rs[0].code, rs[0].pw || '');
    } else box.classList.add('hidden');
    $('#cFriendsN').innerHTML = seg7(String(Math.min(99, friends().length)).padStart(2, '0'));
    $('#cRoomsN').innerHTML = seg7(String(Math.min(99, rs.length)).padStart(2, '0'));
    try { $('#cRoutesN').innerHTML = seg7(String(Math.min(99, ((store.get('routes', []) || []).length + plans().length))).padStart(2, '0')); } catch (e) {}
    $('#cRoomsSub').textContent = S.room ? 'İÇERİDESİN' : 'KAYITLI';
  }
  $('#lcdToggle2').onclick = (e) => { e.stopPropagation(); store.set('lcd', ((+store.get('lcd', 0) || 0) + 1) % 3); applyLcd(); };
  $('#lcdToggle').onclick = (e) => { e.stopPropagation(); store.set('lcd', ((+store.get('lcd', 0) || 0) + 1) % 3); applyLcd(); };
  $('#cRooms').onclick = () => go('rooms');
  $('#cRoutes').onclick = () => go('routes');
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => go('home')));
  $('#cFriends').onclick = () => go('friends');
  applyLcd();
  setInterval(() => { try { renderLcd(); if (page === 'room' && S.room) renderRoom(); } catch (e) {} }, 30000);
  setInterval(() => { refreshCounts(); }, 30000);
  setTimeout(refreshCounts, 2500);

  function renderHome() {
    const g = $('#greet');
    g.textContent = ('MERHABA ' + (S.name || 'SÜRÜCÜ')).toLocaleUpperCase('tr-TR');
    try { renderLcd(); } catch (e) {}
    $('#installHint').classList.toggle('hidden', !(isIOS && !standalone));
    renderRoomList('#recent');
  }
  // 1.3.7: kayıtlı oda listesi hem Ana > Odalar sayfasında hem alttaki Oda sekmesinde (odada değilken) görünür
  function renderRoomList(sel) {
    const box = $(sel); if (!box) return;
    const rooms = store.get('rooms', []);
    // 1.2.0: kişi olan odalar üstte (en kalabalık önce), boşlar alfabetik
    const order = rooms.map((r, i) => i).sort((a, b) => {
      const ca = ROOM_COUNTS[rooms[a].code] || 0, cb = ROOM_COUNTS[rooms[b].code] || 0;
      if (ca !== cb) return cb - ca;
      return String(rooms[a].name || rooms[a].code).localeCompare(String(rooms[b].name || rooms[b].code), 'tr');
    });
    box.innerHTML = rooms.length ? order.map((i) => { const r = rooms[i]; const n = ROOM_COUNTS[r.code] || 0; return (
      '<div class="row raised" data-i="' + i + '"><div class="av" style="background:' + colorOf(r.code) + '">' + esc(initial(r.name || r.code)) + '</div>' +
      '<div class="tx"><b>' + esc(r.name || r.code) + '</b><small>' + esc(r.code) + (r.locked ? ' · 🔒 şifreli' : '') + '</small>' +
      memLine(r.code) + '</div>' +
      (n > 0 ? '<span class="cnt-on">● ' + n + ' kişi</span>' : '<span class="cnt-off">Boş</span>') +
      '<button class="x" data-del="' + i + '" aria-label="Listeden kaldır">✕</button></div>'); }).join('')
      : '<div class="note" style="margin:0 2px">Girdiğin odalar burada listelenir.</div>';
    box.querySelectorAll('.row').forEach((el) => el.addEventListener('click', (e) => {
      const rs = store.get('rooms', []);
      const mem = e.target.closest && e.target.closest('[data-mem]'); if (mem) { showMembers(mem.dataset.mem); return; }
      if (e.target.dataset.del !== undefined) { rs.splice(+e.target.dataset.del, 1); store.set('rooms', rs); backupSoon(); setTimeout(() => { try { syncPush(); } catch (e) {} }, 500); renderHome(); renderRoom(); return; }
      const r = rs[+el.dataset.i]; if (r) joinRoom(r.code, r.pw || '');
    }));
  }
  // 1.3.2: odadakiler satırı: ilk 3 isim + "+N kişi"; dokununca tam liste
  function roomNames(code) {
    if (S.room && S.code === code) return riders().map((x) => x.isMe ? 'Sen' : x.name);
    return ROOM_NAMES[code] || [];
  }
  function memLine(code) {
    const l = roomNames(code); if (!l.length) return '';
    return '<small class="rnames tap" data-mem="' + esc(code) + '">● ' + esc(l.slice(0, 3).join(', ')) + (l.length > 3 ? ' +' + (l.length - 3) + ' kişi' : '') + ' ▸</small>';
  }
  function showMembers(code) {
    const l = roomNames(code), rm = (store.get('rooms', []) || []).find((r) => r.code === code);
    sheet('<h3>👥 ' + esc((rm && rm.name) || code) + '</h3><p>Odada şu an ' + l.length + ' kişi var</p>' +
      '<div class="list">' + l.map((n) => '<div class="row raised"><div class="av" style="background:' + colorOf(n) + '">' + esc(initial(n)) + '</div><div class="tx"><b>' + esc(n) + '</b></div></div>').join('') + '</div>' +
      '<button id="memOk" class="mbtn raised">Kapat</button>', (b) => { b.querySelector('#memOk').onclick = closeSheet; });
  }
  function rememberRoom(code, name, locked, pw) {
    const rs = store.get('rooms', []).filter((r) => r.code !== code);
    rs.unshift({ code, name: name || code, locked: !!locked, pw: pw || '' });
    store.set('rooms', rs.slice(0, 15)); setTimeout(() => { try { syncPush(); } catch (e) {} }, 500);
    backupSoon();
  }

  function askName(after) {
    sheet('<h3>Hoş geldin 🏍</h3><p>Odada ve haritada görünecek adını yaz.</p>' +
      '<input id="nmIn" class="input inset" maxlength="24" placeholder="Adın" value="' + esc(S.name) + '">' +
      '<button id="nmOk" class="mbtn amber">Devam</button>', (b) => {
      const inp = b.querySelector('#nmIn');
      setTimeout(() => inp.focus(), 50);
      b.querySelector('#nmOk').onclick = () => {
        const v = inp.value.trim();
        if (v.length < 2) { toast('Adın en az 2 harf olmalı.'); return; }
        S.name = v; store.set('name', v); $('#nameInput').value = v;
        closeSheet(); renderHome(); if (after) after();
      };
    });
  }

  function askCode(prefill) {
    sheet('<h3>Kodla katıl</h3><p>Arkadaşının verdiği oda kodunu yaz.</p>' +
      '<input id="cdIn" class="input inset" maxlength="32" autocapitalize="characters" placeholder="ör. KARTAL-SURUSU" value="' + esc(prefill || '') + '">' +
      '<button id="cdOk" class="mbtn amber">Katıl</button><button id="cdNo" class="mbtn raised">Vazgeç</button>', (b) => {
      const inp = b.querySelector('#cdIn');
      setTimeout(() => inp.focus(), 50);
      b.querySelector('#cdNo').onclick = closeSheet;
      b.querySelector('#cdOk').onclick = () => {
        const c = normCode(inp.value);
        if (!validCode(c)) { toast('Oda kodu en az 3 harf veya rakam olmalı.'); return; }
        closeSheet(); joinRoom(c, '');
      };
    });
  }

  function askPassword(code, title, err) {
    sheet('<h3>🔒 ' + esc(title || code) + '</h3><p>Bu oda şifreli. Şifreyi oda yöneticisinden öğrenebilirsin.</p>' +
      (err ? '<div class="err">' + esc(err) + '</div>' : '') +
      '<input id="pwIn" class="input inset" type="password" maxlength="40" placeholder="Oda şifresi">' +
      '<button id="pwOk" class="mbtn amber">Katıl</button><button id="pwNo" class="mbtn raised">Vazgeç</button>', (b) => {
      const inp = b.querySelector('#pwIn');
      setTimeout(() => inp.focus(), 50);
      b.querySelector('#pwNo').onclick = closeSheet;
      b.querySelector('#pwOk').onclick = () => { const pw = inp.value; closeSheet(); joinRoom(code, pw, true); };
    });
  }

  function askCreate() {
    sheet('<h3>Oda oluştur</h3><p><b>Tek seferlik oda:</b> hemen açılır, kod verilir.<br><b>Kalıcı oda:</b> adı sabit kalır, istersen şifre koyarsın.</p>' +
      '<button id="crTmp" class="mbtn amber">⚡ Tek seferlik oda aç</button>' +
      '<div class="label">KALICI ODA</div>' +
      '<input id="crName" class="input inset" maxlength="32" placeholder="Oda adı (ör. Kartal Sürüşü)">' +
      '<input id="crPw" class="input inset" type="password" maxlength="40" placeholder="Şifre (istersen, boş bırakabilirsin)">' +
      '<label class="tg"><div><b>🛡 Girişte yönetici onayı</b><small>Şifreyi bilen biri girmek isteyince sana sorulur; sen onaylarsan girer.</small></div><input type="checkbox" id="crApr" class="switch"></label>' +
      '<button id="crPerm" class="mbtn raised">Kalıcı odayı aç</button><button id="crNo" class="mbtn raised">Vazgeç</button>', (b) => {
      b.querySelector('#crNo').onclick = closeSheet;
      b.querySelector('#crTmp').onclick = () => { closeSheet(); joinRoom('TMP-' + (1000 + Math.floor(Math.random() * 9000)), ''); };
      b.querySelector('#crPerm').onclick = async () => {
        const name = b.querySelector('#crName').value.trim();
        const pw = b.querySelector('#crPw').value;
        const code = normCode(name);
        if (!validCode(code)) { toast('Oda adı en az 3 harf veya rakam olmalı.'); return; }
        closeSheet(); busy(true, 'Oda açılıyor…');
        try {
          const apr = !!(pw && b.querySelector('#crApr').checked);
          const j = await api({ action: 'create', room: code, identity: S.id, displayName: name, permanent: true, password: pw, approval: apr });
          const info = j.room || {};
          rememberRoom(code, info.name || name, !!pw, pw);
          busy(false);
          joinRoom(code, pw, true);
        } catch (e) { busy(false); toast(e.message || 'Oda açılamadı.', 6000); }
      };
    });
  }

  $('#createBtn').onclick = () => { if (!S.name) return askName(askCreate); askCreate(); };
  $('#codeBtn').onclick = () => { if (!S.name) return askName(() => askCode()); askCode(); };
  $('#joinBtn').onclick = () => {
    if (S.room || S.connecting) { confirmLeave(); return; }
    if (!S.name) return askName(() => askCode());
    askCode();
  };
  function confirmLeave() {
    sheet('<h3>Odadan ayrılmak istiyor musun?</h3><p>' + esc(S.title || S.code) + '</p>' +
      '<button id="lvOk" class="mbtn danger">Odadan ayrıl</button><button id="lvNo" class="mbtn raised">Odada kal</button>', (b) => {
      b.querySelector('#lvNo').onclick = closeSheet;
      b.querySelector('#lvOk').onclick = () => { closeSheet(); leaveRoom(true); };
    });
  }

  // ------------------------------------------------------------ odaya bağlan
  async function joinRoom(code, pw, fromPrompt) {
    if (S.connecting) return;
    if (S.room) await leaveRoom(false);
    code = normCode(code);
    if (!validCode(code)) { toast('Oda kodu geçersiz.'); return; }
    S.connecting = true; S.kicked = false;
    audioCtx(); // iPhone: sesi kullanıcının dokunuşuyla aç
    busy(true, 'Odaya bağlanıyor…');
    const saved = store.get('rooms', []).find((r) => r.code === code);
    const usePw = pw || (saved && saved.pw) || '';
    let acc;
    try {
      acc = await fetchWithApproval(code, usePw);
    } catch (e) {
      S.connecting = false; busy(false); closeSheet();
      if (e.code === 'APPROVAL_CANCELLED') { toast('Giriş isteğinden vazgeçtin.'); return; }
      if (['PASSWORD_REQUIRED', 'PASSWORD_WRONG', 'TOO_MANY'].includes(e.code)) {
        if (saved && saved.pw) { saved.pw = ''; rememberRoom(saved.code, saved.name, true, ''); }
        const showErr = (e.code === 'PASSWORD_REQUIRED' && !fromPrompt && !usePw) ? '' : e.message;
        askPassword(code, (e.room && e.room.name) || code, showErr);
        return;
      }
      toast(e.message || 'Bağlanılamadı.', 7000);
      return;
    }

    const room = new LK.Room({
      adaptiveStream: false, dynacast: false,
      audioCaptureDefaults: { echoCancellation: opt.echo, noiseSuppression: opt.noise, autoGainControl: opt.agc },
      publishDefaults: { dtx: true, red: true, audioPreset: LK.AudioPresets ? LK.AudioPresets.speech : undefined }
    });
    wireRoom(room);
    try {
      await room.connect(String(acc.url).trim(), acc.token, { autoSubscribe: true });
    } catch (e) {
      S.connecting = false; busy(false);
      try { room.disconnect(); } catch (x) {}
      toast('Ses sunucusuna bağlanılamadı: ' + (e.message || e), 7000);
      return;
    }
    const capNow = (acc.room && acc.room.cap !== undefined) ? (acc.room.cap | 0) : CFG.MAX_RIDERS; // 1.3.6: oda kapasitesi (0 = sınırsız)
    if (capNow > 0 && room.remoteParticipants.size >= capNow) {
      try { room.disconnect(); } catch (x) {}
      S.connecting = false; busy(false);
      toast('Oda dolu. En fazla ' + capNow + ' sürücü olabilir.');
      return;
    }

    S.room = room; S.code = code; S.server = acc.server || '';
    const info = acc.room || {};
    S.cap = (info.cap !== undefined) ? (info.cap | 0) : CFG.MAX_RIDERS;
    S.title = info.name || code; S.locked = !!info.locked; S.permanent = !!info.permanent; S.logo = String(info.logo || '');
    S.owner = acc.owner || ''; S.admins = new Set(acc.admins || []);
    S.nicks = acc.nicks || {}; S.approval = !!(info.approval);
    S.lockedIds = new Set(); S.silenced = new Set(); S.roomLock = false;
    S.modes = {}; S.onCall = new Set(); S.callInfo = {}; S.locs = {};
    S.open = false; S.live = false; S.micOn = false;
    S.wantRoom = { code, pw: usePw };
    rememberRoom(code, S.title, S.locked, usePw);
    // 1.3.0: kayıtlı (kalıcı / şifreli) odaya girince odayı kaydeden diğerlerine bildirim (Android ile aynı)
    if (S.locked || S.permanent) { api({ action: 'token', room: code, identity: S.id, name: S.name || 'Sürücü', password: usePw, avatar: store.get('avatar', '') || '', announce: true, known: true }).catch(() => {}); }
    store.set('lastRoom', { code, pw: usePw, title: S.title }); // uygulama kapanıp açılınca tek dokunuşla geri dönmek için

    // Mikrofonu bir kez aç (izin sorulur), sonra Bas-konuş'ta kapat: odaya giren herkes bas-konuşla başlar
    try { await room.localParticipant.setMicrophoneEnabled(true); } catch (e) {}
    try { await room.localParticipant.setMicrophoneEnabled(false); } catch (e) {}
    try { await room.startAudio(); } catch (e) {}
    publishMode();

    S.connecting = false; busy(false);
    startTicks(); keepAwake(true); applyLocMode(); startRequestsPolling();
    updateTop(); go('room');
    toast('🏍 ' + S.title + ' odasına girdin. Konuşmak için düğmeye basılı tut.');
  }

  // Oda girişte yönetici onayı istiyorsa: onay gelene kadar 5 saniyede bir tekrar sor (en çok 10 dakika)
  let approvalCancel = false;
  async function fetchWithApproval(code, pw) {
    approvalCancel = false;
    const started = Date.now();
    let shown = false;
    while (true) {
      try {
        const a = await api({ action: 'token', room: code, identity: S.id, name: S.name || 'Sürücü', password: pw, avatar: store.get('avatar', '') || '', announce: false, known: !!(store.get('rooms', []) || []).find((r) => r.code === code) });
        if (shown) { closeSheet(); busy(true, 'Odaya bağlanıyor…'); }
        return a;
      } catch (e) {
        if (e.code !== 'APPROVAL_PENDING') throw e;
        if (!shown) {
          shown = true; busy(false);
          sheet('<h3>🛡 Yönetici onayı bekleniyor</h3><p><b>' + esc((e.room && e.room.name) || code) + '</b> odası girişte yönetici onayı istiyor. İsteğin gönderildi; yönetici onaylayınca kendiliğinden odaya gireceksin.</p><div class="spin" style="margin:14px auto"></div><p>Yönetici şu an odada değilse onay gecikebilir.</p><button class="mbtn raised" id="apCancel">Vazgeç</button>',
            (b) => { b.querySelector('#apCancel').onclick = () => { approvalCancel = true; }; });
        }
        if (Date.now() - started > 10 * 60000) { const er = new Error('Yönetici 10 dakika içinde onaylamadı. Daha sonra tekrar dene.'); er.code = 'APPROVAL_TIMEOUT'; throw er; }
        for (let w = 0; w < 20; w++) {
          if (approvalCancel) { const er = new Error('Vazgeçildi'); er.code = 'APPROVAL_CANCELLED'; throw er; }
          await new Promise((ok) => setTimeout(ok, 250));
        }
      }
    }
  }

  // Yöneticiysem ve oda onay istiyorsa: bekleyen giriş isteklerini 8 saniyede bir kontrol et
  function startRequestsPolling() {
    clearInterval(S.reqTimer);
    S.reqTimer = setInterval(async () => {
      if (!S.room || !S.approval || !amAdmin()) return;
      if (!$('#sheet').classList.contains('hidden')) return; // açık bir pencere varken araya girme
      try {
        const j = await api({ action: 'requests', room: S.code, identity: S.id });
        const req = (j.requests || [])[0];
        if (!req) return;
        if (!S.seenReq.has(req.id)) { S.seenReq.add(req.id); beep(2, 880); vibrate([0, 150, 100, 150]); speak(req.name + ' odaya girmek istiyor'); }
        sheet('<h3>🔔 Odaya giriş isteği</h3><p style="font-size:20px;color:#fff;font-weight:800">' + esc(req.name) + '</p><p>Şifreyi doğru girdi ve odaya girmek istiyor. Tanıyorsan onayla; bir kez onaylanan bir daha sorulmaz.</p>' +
          '<button class="mbtn amber" id="rqOk">✅ Onayla</button><button class="mbtn danger" id="rqNo">⛔ Reddet</button>', (b) => {
          const answer = async (ok) => {
            closeSheet();
            try { await api({ action: 'approve', room: S.code, identity: S.id, target: req.id, ok }); toast(ok ? '✅ ' + req.name + ' onaylandı, odaya giriyor.' : '⛔ ' + req.name + ' reddedildi.'); }
            catch (e) { toast('Yapılamadı: ' + (e.message || 'sunucuya ulaşılamadı')); }
          };
          b.querySelector('#rqOk').onclick = () => answer(true);
          b.querySelector('#rqNo').onclick = () => answer(false);
        });
      } catch (e) {}
    }, 8000);
  }

  async function leaveRoom(userLeft) {
    const r = S.room;
    if (userLeft) { S.wantRoom = null; store.set('lastRoom', null); }
    if (r) {
      finalTick();
      try { if (S.locMode !== 'off') publish({ t: 'loc_off' }); } catch (e) {}
      try { if (RK.mr) publish({ t: 'rec', on: false, by: RK.by }); } catch (e) {}
      S.room = null;
      try { chClear(); roomRecClear(); } catch (e) {}
      try { await r.disconnect(); } catch (e) {}
    }
    stopTicks(); stopGeo(); keepAwake(false);
    clearInterval(S.reqTimer); S.nicks = {}; S.approval = false;
    $$('audio.lk').forEach((a) => a.remove());
    S.micOn = false; S.open = false; S.live = false; S.locs = {};
    clearPhotos();
    if (sharedRadio) stopRadio(true);
    updateTop(); renderRoom(); renderMapRiders();
  }

  function wireRoom(room) {
    const E = LK.RoomEvent;
    room.on(E.TrackSubscribed, (track) => {
      if (track.kind !== 'audio') return;
      const el = track.attach();
      if (RK.mr) roomRecAddTrack(track.mediaStreamTrack);   // 1.4.1: kayıt sürerken yeni gelen ses de kayda girsin
      el.classList.add('lk'); el.setAttribute('playsinline', ''); el.style.display = 'none';
      document.body.appendChild(el); try { applyVoiceVol(); } catch (e) {}
    });
    room.on(E.TrackUnsubscribed, (track) => { try { track.detach().forEach((el) => el.remove()); } catch (e) {} });
    room.on(E.ParticipantConnected, (p) => {
      publishMode();
      if (amAdmin()) {
        publishAdmins();
        if (S.lockedIds.size || S.silenced.size || S.roomLock) publishLocks();
      }
      if (S.mySos) publishSos(false);
      try { if (sharedRadio && sharedRadio.mine && radioWant) publish({ t: 'music', a: 'play', url: sharedRadio.url, title: sharedRadio.title, by: S.name || 'Bir sürücü' }); } catch (e) {}   // yeni gelen de duysun
      if (RK.mr) publish({ t: 'rec', on: true, by: RK.by, el: Math.floor((Date.now() - RK.t0) / 1000) });   // yeni gelen de uyarılsın, süreyi doğru görsün
      if (S.myLoc && S.locMode !== 'off') sendLoc(true);
      if (p.name) toast('👋 ' + dispName(p.identity, p.name) + ' odaya katıldı', 2500);
      renderRoom(); renderMapRiders();
    });
    room.on(E.ParticipantDisconnected, (p) => {
      delete S.locs[p.identity]; delete S.modes[p.identity]; S.onCall.delete(p.identity); delete S.callInfo[p.identity];
      if (RK.byId === p.identity && !RK.mr) { RK.by = null; RK.byId = null; roomRecShow('⏹ Kayıt durduruldu', ''); roomRecUi(); }
      renderRoom(); renderMapRiders();
    });
    room.on(E.ActiveSpeakersChanged, () => renderRoom());
    try { room.on(E.ParticipantMetadataChanged, () => { renderRoom(); renderMapRiders(); }); } catch (e) {}
    room.on(E.DataReceived, (payload, participant) => onData(payload, participant));
    room.on(E.AudioPlaybackStatusChanged, () => $('#audioUnlock').classList.toggle('hidden', room.canPlaybackAudio));
    room.on(E.Reconnecting, () => toast('Bağlantı zayıf, yeniden bağlanıyor…'));
    room.on(E.Reconnected, () => { toast('Yeniden bağlandı.'); publishMode(); });
    room.on(E.Disconnected, (reason) => {
      if (S.room !== room) return;
      S.room = null;
      try { chClear(); roomRecClear(); } catch (e) {}
      stopTicks(); keepAwake(false);
      $$('audio.lk').forEach((a) => a.remove());
      S.micOn = false;
      updateTop(); renderRoom();
      if (S.kicked) return;
      const removed = LK.DisconnectReason && (reason === LK.DisconnectReason.PARTICIPANT_REMOVED || reason === LK.DisconnectReason.ROOM_DELETED);
      if (removed) { S.wantRoom = null; toast('Odadan çıkarıldın ya da oda kapandı.', 6000); return; }
      toast('Bağlantı koptu. Ekran açıkken kendiliğinden tekrar bağlanacak.', 6000);
      if (document.visibilityState === 'visible') setTimeout(rejoin, 2500);
    });
  }
  function rejoin() {
    if (S.room || S.connecting || !S.wantRoom || S.kicked) return;
    joinRoom(S.wantRoom.code, S.wantRoom.pw, true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S.wantRoom && !S.room) setTimeout(rejoin, 800);
      if (S.room) keepAwake(true);
    }
  });

  // ------------------------------------------------------------ oda mesajları (Android ile aynı)
  const enc = new TextEncoder(), dec = new TextDecoder();
  function publish(obj) {
    const r = S.room; if (!r) return;
    try { r.localParticipant.publishData(enc.encode(JSON.stringify(obj)), { reliable: true }); } catch (e) {}
  }
  const currentMode = () => !S.open ? 'ptt' : (S.live ? 'live' : 'open');
  const publishMode = () => publish({ t: 'mode', m: currentMode() });
  const isAdmin = (id) => !!id && (id === S.owner || S.admins.has(id));
  const amAdmin = () => isAdmin(S.id);
  const openMicLocked = () => S.lockedIds.has(S.id) || S.silenced.has(S.id) || (S.roomLock && !amAdmin());
  function publishAdmins() { publish({ t: 'adm', owner: S.owner, ids: Array.from(S.admins) }); }
  function publishLocks() { publish({ t: 'locks', ids: Array.from(S.lockedIds), sil: Array.from(S.silenced), all: S.roomLock }); }
  // Bu odada görünen ad: yönetici görev adı verdiyse o (ör. "Dalgıç"), yoksa kişinin kendi adı
  function dispName(id, raw, fallback) { return (id && S.nicks[id]) || raw || fallback || 'Sürücü'; }
  function nameOf(p) { return dispName(p && p.identity, p && p.name, 'Bir sürücü'); }

  function onData(payload, participant) {
    if (payload && payload.length > 2 && payload[0] === 1 && payload[1] === 0xA5) { try { phonePacket(payload); } catch (e) {} return; }   // 1.4.18: Android'in telefon müziği paketi
    if (!payload || !payload.length || payload[0] !== 123) return; // { ile başlamıyorsa geç
    let j; try { j = JSON.parse(dec.decode(payload)); } catch (e) { return; }
    const id = participant && participant.identity;
    const name = nameOf(participant);
    switch (j.t) {
      case 'route':
        if (j.clear || !Array.isArray(j.stops) || !j.stops.length) break;
        { const stops = j.stops.map((s) => ({ lat: +s.lat, lon: +s.lon, n: String(s.n || '') })).filter((s) => isFinite(s.lat) && isFinite(s.lon));
          if (!stops.length) break; const nm = String(j.name || 'Paylaşılan rota').slice(0, 40);
          sheet('<h3>🗺 ' + esc(name) + ' rota paylaştı</h3><p><b>' + esc(nm) + '</b> · ' + stops.length + ' durak</p><button id="rcOk" class="mbtn amber">Hazır rotalarıma ekle</button><button id="rcNo" class="mbtn raised">Kapat</button>', (b) => {
            b.querySelector('#rcOk').onclick = () => { savePlan({ name: nm, stops }); closeSheet(); toast('✅ Rota eklendi: Ana sayfa > Rotalar'); };
            b.querySelector('#rcNo').onclick = closeSheet; }); }
        break;
      case 'mode': if (id) { S.modes[id] = j.m || 'ptt'; renderRoom(); } break;
      case 'loc':
        if (!id) return;
        S.locs[id] = { id, name: dispName(id, participant.name), lat: +j.lat, lon: +j.lon, spd: j.spd | 0, at: Date.now() };
        renderMapRiders(); break;
      case 'loc_off': if (id) { delete S.locs[id]; renderMapRiders(); } break;
      case 'call':
        if (!id) return;
        if (j.on) {
          if (!S.onCall.has(id)) toast((j.k === 'media' ? '🎧 ' + name + ' müzik / medya dinliyor' : '📞 ' + name + ' telefon görüşmesinde') + ', seni duyamıyor.');
          S.onCall.add(id); S.callInfo[id] = { media: j.k === 'media', at: Date.now() };
        } else { delete S.callInfo[id]; if (S.onCall.delete(id)) toast(name + ' telefon görüşmesini bitirdi.'); }
        renderRoom(); break;
      case 'roominfo': if (j.name) { S.title = j.name; if (j.logo !== undefined) S.logo = String(j.logo || ''); rememberRoom(S.code, j.name, S.locked, S.wantRoom && S.wantRoom.pw); renderRoom(); toast('Oda adı güncellendi: ' + j.name); } break;
      case 'ping': onPing(j, id, name); break;
      case 'img': if (id) onPhotoChunk(j, id, name); break;
      case 'sos': onSos(j, id, name); break;
      case 'chat': if (id) onChat(j, id, name); break;
      case 'rec': if (id) onRec(j, id, name); break;
      case 'music': onMusic(j); break;
      case 'adm': case 'locks': case 'mod': case 'nick': case 'apr': onAdminMsg(j, id, name); break;
      default: break;
    }
  }


  // ------------------------------------------------------------ 1.3.6: oda sohbeti (Android 0.9.99 ile aynı paket: {t:'chat', i, x, to})
  const CH = { msgs: [], to: null, open: false, unreadAll: 0, unreadPriv: {}, seen: new Set(), last: 0 };
  const CH_QUICK = ['📍 Odadayız', '🏍 Yoldayım', '☕ Mola', '⛽ Benzin', '👍 Tamam', '👋 Selam'];
  const chDriving = () => { const m = S.locs[S.id]; return !!m && Date.now() - m.at < 15000 && m.spd >= 40; };
  function chUnreadTotal() { return CH.unreadAll + Object.values(CH.unreadPriv).reduce((a, b) => a + b, 0); }
  function chBadge() {
    const n = chUnreadTotal();
    ['#chatBadge', '#chatBadge2'].forEach((s) => { const b = $(s); if (b) { b.textContent = n; b.classList.toggle('hidden', n === 0); } });
  }
  function chMarkRead() { if (CH.to == null) CH.unreadAll = 0; else delete CH.unreadPriv[CH.to]; chBadge(); }
  function chThread() {
    return CH.msgs.filter((m) => CH.to == null ? m.to == null : (m.to != null && ((m.me && m.to === CH.to) || (!m.me && m.from === CH.to))));
  }
  // 1.4.1: başkasının mesajına dokun: Bildir / Engelle (Google Play kuralı)
  function chMsgMenu(m) {
    if (!m || m.me) return;
    sheet('<h3>' + esc(m.name) + ' — mesaj</h3><p style="color:#fff">\u201c' + esc(m.x) + '\u201d</p>' +
      '<p class="small">Uygunsuz mu (hakaret, taciz, şiddet, reklam)? Bildirim geliştiriciye gider. Engellersen bu kişinin mesajları ve fotoğrafları sana gösterilmez.</p>' +
      '<button class="mbtn raised" id="cmRep">⚠ Bildir</button><button class="mbtn danger" id="cmBlk">⛔ Engelle</button><button class="mbtn raised" id="cmNo">Kapat</button>', (b) => {
      b.querySelector('#cmNo').onclick = closeSheet;
      b.querySelector('#cmRep').onclick = async () => {
        closeSheet();
        try { await api({ action: 'report', room: S.code || 'PUSH', identity: S.id, target: m.from, targetName: m.name, kind: 'mesaj', reason: String(m.x).slice(0, 200) }); toast('Bildirimin alındı, teşekkürler.'); }
        catch (e) { toast('Bildirim gönderilemedi: ' + e.message); }
      };
      b.querySelector('#cmBlk').onclick = () => {
        const l = store.get('photoBlocked', []) || []; if (!l.includes(m.from)) l.push(m.from); store.set('photoBlocked', l);
        CH.msgs = CH.msgs.filter((x) => x.from !== m.from); delete CH.unreadPriv[m.from];
        PH.list.filter((x) => x.from === m.from).forEach((x) => URL.revokeObjectURL(x.url));
        PH.list = PH.list.filter((x) => x.from !== m.from);
        if (CH.to === m.from) CH.to = null;
        closeSheet(); chBadge(); chRender();
        toast(m.name + ' engellendi; mesajları ve fotoğrafları artık gösterilmeyecek.');
      };
    });
  }
  function chRender() {
    if (!CH.open) return;
    const who = CH.to ? (riders().find((x) => x.id === CH.to) || {}).name || 'Sürücü' : null;
    $('#chatTitle').textContent = who ? '🔒 Özel · ' + who : '💬 ' + (S.title || S.code || 'Oda') + ' · Sohbet';
    $('#chatBack').textContent = who ? '‹ Sohbet' : '‹ Odaya dön';
    $('#chatIn').placeholder = who ? who + "'e yaz…" : 'Mesaj yaz…';
    const pr = Object.entries(CH.unreadPriv).slice(0, 3);
    const pe = $('#chatPriv'); pe.classList.toggle('hidden', !(CH.to == null && pr.length));
    pe.innerHTML = pr.map(([id, n]) => '<button data-id="' + esc(id) + '">✉ ' + esc((riders().find((x) => x.id === id) || {}).name || 'Sürücü') + ' (' + n + ')</button>').join('');
    pe.querySelectorAll('button').forEach((b) => b.onclick = () => chOpen(b.dataset.id));
    // 1.4.0: oda sohbetinde fotoğraflar da mesajların arasında, saat sırasıyla görünür
    let th = chThread(); const box = $('#chatMsgs');
    if (!CH.to) th = th.concat(PH.list.map((p) => ({ ph: p, at: p.time, me: p.mine, name: p.name }))).sort((x, y) => x.at - y.at);
    $('#chatPhoto').classList.toggle('hidden', !!CH.to);
    box.innerHTML = th.length ? th.map((m) => m.ph ?
      '<div class="cb ph ' + (m.me ? 'me' : 'o') + '">' + (m.me ? '' : '<small>' + esc(m.name) + '</small>') + '<img src="' + m.ph.url + '" data-ph="' + esc(m.ph.id) + '" alt="Fotoğraf"><time>' + new Date(m.at).toTimeString().slice(0, 5) + '</time></div>' :
      '<div class="cb ' + (m.me ? 'me' : 'o') + '"' + (m.me ? '' : ' data-mid="' + esc(m.id) + '"') + '>' + (m.me ? '' : '<small>' + esc(m.name) + (m.to ? ' (özel)' : '') + '</small>') + esc(m.x) +
      '<time>' + new Date(m.at).toTimeString().slice(0, 5) + '</time></div>').join('') :
      '<div class="empty">' + (CH.to ? 'Bu kişiyle henüz yazışmadınız.' : 'Henüz mesaj yok. Aşağıdaki hazır mesajlarla başla.<br><br>Uygunsuz bir mesaja dokunarak bildirebilir ya da kişiyi engelleyebilirsin.') + '</div>';
    box.querySelectorAll('[data-mid]').forEach((el) => { el.onclick = () => chMsgMenu(CH.msgs.find((m) => m.id === el.dataset.mid)); });
    box.querySelectorAll('img[data-ph]').forEach((im) => { im.onclick = () => viewPhoto(PH.list.find((p) => p.id === im.dataset.ph)); im.onload = () => { box.scrollTop = box.scrollHeight; }; });
    box.scrollTop = box.scrollHeight;
    const lock = chDriving();
    $('#chatLock').classList.toggle('hidden', !lock); $('#chatForm').classList.toggle('hidden', lock);
  }
  // 1.4.0: klavye açılınca sohbet ekranı görünen alana küçülür; yazı kutusu klavyenin hemen üstünde kalır
  function chFit() {
    const el = $('#chat'), vv = window.visualViewport;
    if (!el || !vv || !CH.open) return;
    const kb = window.innerHeight - vv.height > 120;
    el.style.height = kb ? vv.height + 'px' : '';
    el.style.top = kb ? vv.offsetTop + 'px' : '';
    el.classList.toggle('kb', kb);
    if (kb) { try { window.scrollTo(0, 0); } catch (e) {} }
    const box = $('#chatMsgs'); box.scrollTop = box.scrollHeight;
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', chFit); window.visualViewport.addEventListener('scroll', chFit); }
  // ---------------------------------------------------------------- 1.4.1: yönetici oda kaydı
  // Kayıt SADECE yöneticinin telefonuna iner. Odaya duyuru gider, herkesin LCD'sinde ● KAYIT yanar.
  const RK = { mr: null, ctx: null, dest: null, chunks: [], t0: 0, timer: null, tracks: new Set(), by: null, byId: null };
  function roomRecShow(title, text) {
    const b = $('#recBanner'); if (!b) return;
    $('#rbTitle').textContent = title; $('#rbText').textContent = text || '';
    b.classList.remove('hidden'); b.onclick = () => b.classList.add('hidden');
    try { navigator.vibrate && navigator.vibrate([120, 80, 120]); } catch (e) {}
    clearTimeout(RK.bt); RK.bt = setTimeout(() => b.classList.add('hidden'), 9000);
  }
  function roomRecUi() {
    const on = !!RK.by;
    $('#rlRec').classList.toggle('hidden', !on);
    // 1.4.2: kayıt sürerken üst satır HERKESTE kırmızı şerit: ● KAYIT YAPILIYOR · Ad  12:34
    const strip = $('#recStrip');
    if (strip) {
      strip.classList.toggle('hidden', !on);
      $('#rlTop').classList.toggle('hidden', on);
      if (on) { const s = Math.max(0, Math.floor((Date.now() - (RK.t0 || Date.now())) / 1000)); $('#rsName').textContent = '● KAYIT YAPILIYOR · ' + RK.by; $('#rsTime').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
    }
    const k = $('#roomRecBtn'); if (!k) return;
    k.classList.add('hidden');   // 1.4.4: kayıt tuşu artık YÖNET menüsünde
    k.classList.toggle('on', !!RK.mr);
    k.textContent = RK.mr ? '⏹ DURDUR' : '⏺ KAYIT';
  }
  function roomRecAddTrack(mst) {
    if (!RK.mr || !mst || RK.tracks.has(mst.id)) return;
    try { RK.ctx.createMediaStreamSource(new MediaStream([mst])).connect(RK.dest); RK.tracks.add(mst.id); } catch (e) {}
  }
  function roomRecScan() {
    if (!RK.mr || !S.room) return;
    try { S.room.remoteParticipants.forEach((p) => p.audioTrackPublications.forEach((pub) => { if (pub.track) roomRecAddTrack(pub.track.mediaStreamTrack); })); } catch (e) {}
    try { const lp = S.room.localParticipant.getTrackPublication(LK.Track.Source.Microphone); if (lp && lp.track) roomRecAddTrack(lp.track.mediaStreamTrack); } catch (e) {}
  }
  function roomRecStart() {
    if (!S.room || !amAdmin() || RK.mr) return;
    if (!window.MediaRecorder) { toast('Bu tarayıcı ses kaydını desteklemiyor.'); return; }
    try {
      RK.ctx = new (window.AudioContext || window.webkitAudioContext)();
      RK.dest = RK.ctx.createMediaStreamDestination();
      try { RK.ctx.resume(); } catch (e) {}
      // sessiz taşıyıcı: odada ses olmasa da kayıt akışı hiç kesilmesin
      try { const g = RK.ctx.createGain(); g.gain.value = 0; const o = RK.ctx.createOscillator(); o.connect(g); g.connect(RK.dest); o.start(); } catch (e) {}
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      RK.mr = new MediaRecorder(RK.dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
      RK.chunks = []; RK.tracks = new Set(); RK.t0 = Date.now();
      RK.mr.ondataavailable = (e) => { if (e.data && e.data.size) RK.chunks.push(e.data); };
      RK.mr.onstop = roomRecSave;
      RK.mr.start(5000);
      roomRecScan();
      RK.timer = setInterval(() => { roomRecScan(); roomRecUi(); }, 1000);
      RK.by = S.name || 'Yönetici'; RK.byId = S.id;
      publish({ t: 'rec', on: true, by: RK.by, el: 0 });
      roomRecShow('⏺ KAYIT BAŞLADI', 'Bu odadaki konuşmalar senin tarafından kaydediliyor. Odadakilere duyuruldu. Ekranı kapatırsan kayıt da durur.');
      roomRecUi();
    } catch (e) { RK.mr = null; toast('Kayıt başlatılamadı: ' + (e.message || e)); }
  }
  function roomRecStop(silent) {
    if (!RK.mr) return;
    try { if (!silent) publish({ t: 'rec', on: false, by: RK.by }); } catch (e) {}
    clearInterval(RK.timer);
    try { RK.mr.stop(); } catch (e) { roomRecSave(); }
    if (RK.byId === S.id) { RK.by = null; RK.byId = null; }
    roomRecUi();
  }
  function roomRecSave() {
    const mr = RK.mr; RK.mr = null;
    try { RK.ctx && RK.ctx.close(); } catch (e) {}
    if (!RK.chunks.length) { toast('Kayıt boş kaldı (ses alınamadı).'); roomRecUi(); return; }
    const type = (mr && mr.mimeType) || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : 'webm';
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const name = 'MotoLink_' + String(S.title || S.code || 'Oda').replace(/[^\wÇĞİÖŞÜçğıöşü -]/g, '').slice(0, 40) + '_' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + '-' + p2(d.getMinutes()) + '.' + ext;
    const blob = new Blob(RK.chunks, { type }); RK.chunks = [];
    const file = new File([blob], name, { type });
    const dl = () => { const u = URL.createObjectURL(blob); const a2 = document.createElement('a'); a2.href = u; a2.download = name; document.body.appendChild(a2); a2.click(); setTimeout(() => { URL.revokeObjectURL(u); a2.remove(); }, 4000); };
    sheet('<h3>⏺ Kayıt hazır</h3><p>' + esc(name) + '</p><p class="small">Dosya sadece bu telefonda. Kaydet ya da paylaş.</p>' +
      '<button class="mbtn amber" id="rsSave">💾 Kaydet / Paylaş</button><button class="mbtn raised" id="rsNo">Kapat</button>', (b) => {
      b.querySelector('#rsNo').onclick = closeSheet;
      b.querySelector('#rsSave').onclick = async () => {
        try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); closeSheet(); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
        dl(); closeSheet();
      };
    });
    roomRecUi();
  }
  function onRec(j, id, name) {
    const by = String(j.by || name || 'Bir yönetici');
    if (j.on) {
      const again = RK.byId === id; RK.byId = id; RK.by = by; RK.t0 = Date.now() - (+j.el || 0) * 1000;
      clearInterval(RK.vt); RK.vt = setInterval(roomRecUi, 1000);
      if (!again) roomRecShow('⏺ KAYIT BAŞLADI', 'Bu odadaki konuşmalar ' + by + ' tarafından kayıt altına alınmaktadır. İstemiyorsan odadan ayrılabilirsin.');
    } else if (RK.byId === id) { RK.by = null; RK.byId = null; clearInterval(RK.vt); roomRecShow('⏹ Kayıt durduruldu', by); }
    roomRecUi();
  }
  function roomRecClear() { roomRecStop(true); clearInterval(RK.vt); RK.by = null; RK.byId = null; try { $('#recBanner').classList.add('hidden'); } catch (e) {} roomRecUi(); }
  $('#recStrip').onclick = () => { if (RK.mr) $('#roomRecBtn').onclick(); };   // 1.4.4: yönetici şeride dokunup durdurur
  $('#roomRecBtn').onclick = () => {
    if (RK.mr) {
      sheet('<h3>⏹ Kaydı durdur?</h3><p>Kayıt durur, dosya telefonuna iner. Odadakilere "Kayıt durduruldu" duyurulur.</p><button class="mbtn danger" id="rcYes">DURDUR</button><button class="mbtn raised" id="rcNo">Devam et</button>', (b) => {
        b.querySelector('#rcNo').onclick = closeSheet; b.querySelector('#rcYes').onclick = () => { closeSheet(); roomRecStop(false); };
      });
      return;
    }
    sheet('<h3 style="color:#ff5a5a">⏺ Konuşmalar kaydedilsin mi?</h3><p>Odadaki herkese şu duyuru gider ve kayıt sürdükçe herkesin ekranında <b style="color:#ff5a5a">● KAYIT</b> görünür:</p>' +
      '<p style="color:#fff;font-weight:700">\u201cBu odadaki konuşmalar ' + esc(S.name || 'yönetici') + ' tarafından kayıt altına alınmaktadır.\u201d</p>' +
      '<p class="small">Kayıt sadece senin telefonuna iner, sunucuya gönderilmez. Katılımcıları bilgilendirmek ve kaydı yasalara uygun kullanmak (KVKK) kaydı yapan yöneticinin sorumluluğundadır. Ekran kapanırsa kayıt da durur.</p>' +
      '<button class="mbtn danger" id="rcYes">⏺ ANLADIM, KAYDI BAŞLAT</button><button class="mbtn raised" id="rcNo">Vazgeç</button>', (b) => {
      b.querySelector('#rcNo').onclick = closeSheet; b.querySelector('#rcYes').onclick = () => { closeSheet(); roomRecStart(); };
    });
  };
  function chOpen(to) { if (!S.room) return; CH.to = to || null; CH.open = true; $('#chat').classList.remove('hidden'); chMarkRead(); chRender(); }
  function chClose() { CH.open = false; const el = $('#chat'); el.classList.add('hidden'); el.classList.remove('kb'); el.style.height = ''; el.style.top = ''; try { $('#chatIn').blur(); } catch (e) {} }
  function chClear() { try { $('#people').classList.add('hidden'); } catch (e) {}  try { $('#chatBanner').classList.add('hidden'); } catch (e) {} CH.msgs = []; CH.unreadAll = 0; CH.unreadPriv = {}; CH.seen.clear(); CH.to = null; chClose(); chBadge(); }
  function chSend(text) {
    const x = String(text || '').trim().slice(0, 200); if (!x || !S.room) return false;
    const now = Date.now(); if (now - CH.last < 400) return false; CH.last = now;
    const i = Math.random().toString(36).slice(2, 14);
    const j = { t: 'chat', i, x }; if (CH.to) j.to = CH.to;
    publish(j);
    CH.msgs.push({ id: i, from: S.id, name: 'Sen', x, at: now, me: true, to: CH.to || null });
    if (CH.msgs.length > 200) CH.msgs.shift();
    chRender(); return true;
  }
  // 1.3.7: yeni mesaj şeridi (her sayfada), bip + titreşim, 6 sn sonra kapanır, dokununca sohbete gider
  let cbT = null, bAx = null;
  function chBeep() {
    try {
      bAx = bAx || new (window.AudioContext || window.webkitAudioContext)();
      const o = bAx.createOscillator(), g = bAx.createGain(); o.type = 'sine'; o.frequency.value = 880;
      g.gain.value = 0.12; o.connect(g); g.connect(bAx.destination); o.start(); o.stop(bAx.currentTime + 0.18);
    } catch (e) {}
  }
  function chBanner(from, name, x, priv) {
    const b = $('#chatBanner'); if (!b) return;
    $('#cbIcon').textContent = priv ? '🔒' : '💬';
    $('#cbName').textContent = name + (priv ? ' · ÖZEL MESAJ' : ' · ODA');
    $('#cbText').textContent = x;
    b.onclick = () => { b.classList.add('hidden'); chOpen(priv ? from : null); };
    b.classList.remove('hidden');
    chBeep(); try { navigator.vibrate && navigator.vibrate([90, 70, 90]); } catch (e) {}
    clearTimeout(cbT); cbT = setTimeout(() => b.classList.add('hidden'), 6000);
  }
  function onChat(j, from, name) {
    if (photoBlocked(from)) return;              // 1.4.1: engellenen kişi
    const to = j.to ? String(j.to) : null;
    if (to && to !== S.id) return;               // başkasına özel
    const i = String(j.i || ''); if (!i || CH.seen.has(i)) return;
    CH.seen.add(i); if (CH.seen.size > 400) CH.seen.delete(CH.seen.values().next().value);
    const x = String(j.x || '').trim().slice(0, 200); if (!x) return;
    CH.msgs.push({ id: i, from, name, x, at: Date.now(), me: false, to });
    if (CH.msgs.length > 200) CH.msgs.shift();
    const viewing = CH.open && CH.to === (to ? from : null);
    if (!viewing) {
      if (!to) CH.unreadAll++; else CH.unreadPriv[from] = (CH.unreadPriv[from] || 0) + 1;
      chBanner(from, name, x, !!to);
      chBadge();
    }
    chRender();
  }
  $('#chatBack').onclick = () => { if (CH.to) chOpen(null); else chClose(); };
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); const inp = $('#chatIn'); if (chSend(inp.value)) inp.value = ''; };
  $('#chatQuick').innerHTML = CH_QUICK.map((q) => '<button type="button">' + q + '</button>').join('');
  $$('#chatQuick button').forEach((b) => b.onclick = () => chSend(b.textContent));

  function onAdminMsg(j, from, fromName) {
    if (!isAdmin(from)) return; // sadece yöneticiden gelen komutlar
    fromName = fromName === 'Bir sürücü' ? 'Oda yöneticisi' : fromName;
    if (j.t === 'apr') { S.approval = !!j.on; return; }
    if (j.t === 'nick') {
      const n = String(j.n || '').trim();
      if (j.id) {
        if (n) S.nicks[j.id] = n; else delete S.nicks[j.id];
        if (S.locs[j.id] && n) S.locs[j.id].name = n;
        if (j.id === S.id && n) toast(fromName + ' bu odadaki adını "' + n + '" yaptı.');
        renderRoom(); renderMapRiders();
      }
      return;
    }
    if (j.t === 'adm') {
      S.admins = new Set((j.ids || []).filter(Boolean));
      if (j.owner && !S.owner) S.owner = j.owner;
      renderRoom(); return;
    }
    if (j.t === 'locks') {
      const was = S.silenced.has(S.id);
      S.lockedIds = new Set((j.ids || []).filter(Boolean));
      S.silenced = new Set((j.sil || []).filter(Boolean));
      S.roomLock = !!j.all;
      const now = S.silenced.has(S.id);
      if (now) { if (S.open) forcePtt(); else setMic(false, true); if (!was) toast('🔇 ' + fromName + ' seni susturdu. İzin verene kadar konuşamazsın.', 6000); }
      else if (was) toast('🔊 ' + fromName + ' susturmanı kaldırdı. Bas-konuşla konuşabilirsin.');
      else if (openMicLocked() && S.open) { forcePtt(); toast('🔒 ' + fromName + ' seni bas-konuşa aldı. Konuşmak için düğmeye basılı tut.'); }
      renderRoom(); return;
    }
    if (j.t === 'ann') {
      // 1.4.23: yöneticiden odaya duyuru
      if (!isAdmin(id)) return;
      const tx = String(j.text || '').trim().slice(0, 140);
      if (tx) { toast('📢 ' + fromName + ': ' + tx, 9000); speak('Yönetici duyurusu. ' + tx); }
      return;
    }
    if (j.t === 'mod') {
      const forMe = j.to === S.id || (j.to === '*' && !amAdmin());
      if (!forMe) return;
      if (j.a === 'ptt' && S.open) {
        forcePtt();
        toast(fromName + ' seni bas-konuşa aldı. Konuşmak için düğmeye basılı tut.');
        speak('Yönetici seni bas konuş moduna aldı.');
      } else if (j.a === 'kick') {
        S.kicked = true; S.wantRoom = null;
        leaveRoom(true);
        sheet('<h3>Odadan çıkarıldın</h3><p>Oda yöneticisi seni odadan çıkardı. 30 dakika sonra tekrar girebilirsin.</p><button class="mbtn raised" id="okk">Tamam</button>',
          (b) => { b.querySelector('#okk').onclick = closeSheet; });
      }
    }
  }

  // ------------------------------------------------------------ mikrofon ve konuşma modu
  async function setMic(on, quiet) {
    const r = S.room; if (!r) return;
    if (on && S.silenced.has(S.id)) { if (!quiet) toast('🔇 Oda yöneticisi seni susturdu. İzin verene kadar konuşamazsın.'); return; }
    S.micOn = on; renderPtt();
    try { await r.localParticipant.setMicrophoneEnabled(on); }
    catch (e) {
      if (on) {
        S.micOn = false; renderPtt();
        toast(String(e && e.name) === 'NotAllowedError'
          ? 'Mikrofon izni verilmedi. Ayarlar > Safari > Mikrofon\'dan izin ver.'
          : 'Mikrofon açılamadı. Oda yöneticisi konuşmanı kapatmış olabilir.', 6000);
      }
    }
  }
  function setTalkMode(mode) {
    if (!S.room) { toast('Önce bir odaya katıl.'); return; }
    if (mode !== 'ptt' && openMicLocked()) { toast('Oda yöneticisi seni bas-konuşa aldı; açık mikrofon şu an kilitli.'); return; }
    S.open = mode !== 'ptt'; S.live = mode === 'live';
    setMic(S.open);
    publishMode(); renderRoom();
    if (mode === 'live') toast('Sürekli Açık: herkes aynı anda konuşabilir. Kulaklık ya da kask interkomu kullan.');
    if (mode === 'open') toast('Eller Serbest: mikrofon açık. Kapatmak için büyük düğmeye dokun.');
  }
  function forcePtt() { S.open = false; S.live = false; setMic(false, true); publishMode(); renderRoom(); }
  $$('.modes .sw').forEach((b) => b.addEventListener('click', () => setTalkMode(b.dataset.mode)));

  // Bas-konuş düğmesi: basılı tut = konuş (Bas-konuş), dokun = aç/kapat (diğer modlar)
  const ptt = $('#ptt');
  let holding = false;
  ptt.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!S.room) { toast('Konuşmak için önce bir odaya katıl.'); return; }
    if (!S.room.canPlaybackAudio) { try { S.room.startAudio(); } catch (x) {} }
    audioCtx();
    if (S.open) { setMic(!S.micOn); return; }
    holding = true;
    try { ptt.setPointerCapture(e.pointerId); } catch (x) {}
    setMic(true); vibrate(25);
  });
  const release = () => { if (!holding) return; holding = false; setMic(false); };
  ptt.addEventListener('pointerup', release);
  ptt.addEventListener('pointercancel', release);
  ptt.addEventListener('lostpointercapture', release);
  ptt.addEventListener('contextmenu', (e) => e.preventDefault());
  // 1.4.5: Kişiler sayfasındaki ince Bas-konuş tuşu (büyük düğmeyle aynı davranış)
  const ptt2 = $('#ptt2'); let holding2 = false;
  ptt2.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!S.room) return;
    if (!S.room.canPlaybackAudio) { try { S.room.startAudio(); } catch (x) {} }
    audioCtx();
    if (S.open) { setMic(!S.micOn); return; }
    holding2 = true;
    try { ptt2.setPointerCapture(e.pointerId); } catch (x) {}
    setMic(true); vibrate(25);
  });
  const release2 = () => { if (!holding2) return; holding2 = false; setMic(false); };
  ptt2.addEventListener('pointerup', release2);
  ptt2.addEventListener('pointercancel', release2);
  ptt2.addEventListener('lostpointercapture', release2);
  ptt2.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#audioUnlock').onclick = () => { if (S.room) S.room.startAudio().catch(() => {}); audioCtx(); $('#audioUnlock').classList.add('hidden'); };

  function renderPtt() {
    const sil = S.room && S.silenced.has(S.id);
    ptt.classList.toggle('on', S.micOn);
    try { $('#ptt2').classList.toggle('on', S.micOn); } catch (e) {}
    ptt.classList.toggle('live', S.live);
    ptt.classList.toggle('sil', !!sil);
    let t, h, ic = S.micOn ? '🎙' : '🔇';
    if (!S.room) { t = 'BAS KONUŞ'; h = 'önce odaya katıl'; }
    else if (sil) { t = 'SUSTURULDUN'; h = 'yönetici izin verene kadar dinliyorsun'; ic = '🔇'; }
    else if (!S.open && S.micOn) { t = 'KONUŞUYORSUN'; h = 'bırakınca kapanır'; }
    else if (!S.open) { t = 'BAS KONUŞ'; h = 'basılı tut'; }
    else if (S.micOn && S.live) { t = 'SÜREKLİ AÇIK'; h = 'kapatmak için dokun'; }
    else if (S.micOn) { t = 'ELLER SERBEST'; h = 'kapatmak için dokun'; }
    else { t = 'MİKROFON KAPALI'; h = 'açmak için dokun'; }
    $('#pttIcon').textContent = ic; $('#pttTitle').textContent = t; $('#pttHint').textContent = h;
    try { $('#ptt2Icon').textContent = ic; $('#ptt2Title').textContent = t; $('#ptt2Hint').textContent = h; } catch (e) {}
    fit($('#pttTitle'), 17, 11);
    try { if (radioWant && !PM.on && player.paused && player.src) player.play().catch(() => {}); } catch (e) {}
    const ring = $('#ring');
    ring.classList.toggle('glow', S.micOn);
    ring.style.setProperty('--tc', S.live ? '#ff3b3b' : '#46e38a');
  }
  // Konuşurken halka sesle birlikte parlasın; başkası konuşunca düğmenin içinde ses dalgası görünsün
  const waveEl = document.createElement('div');
  waveEl.className = 'wave'; waveEl.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><i></i>';
  $('#pttIcon').after(waveEl);
  let remoteOn = false;
  setInterval(() => {
    const ring = $('#ring');
    if (!S.room) { if (remoteOn) { remoteOn = false; ptt.classList.remove('rx'); ring.classList.remove('rxglow'); } return; }
    let rl = 0;
    S.room.remoteParticipants.forEach((p) => { if (p.isSpeaking) rl = Math.max(rl, Math.max(p.audioLevel || 0, 0.2)); });
    const on = rl > 0.01;
    if (on !== remoteOn) { remoteOn = on; ptt.classList.toggle('rx', on); ring.classList.toggle('rxglow', on); }
    if (on && !document.body.classList.contains('lite')) {
      ring.style.setProperty('--rx', Math.min(1, rl * 2).toFixed(2));
      ring.style.setProperty('--tc', S.live ? '#ff3b3b' : '#46e38a');
      $$('#ptt .wave i').forEach((b, i) => { const mid = 1 - Math.abs(i - 3) / 3 * 0.55; b.style.height = Math.round(6 + 30 * mid * (0.35 + 0.65 * Math.min(1, rl * 2)) * (0.55 + 0.45 * Math.random())) + 'px'; });
    }
    if (S.micOn && !document.body.classList.contains('lite')) {
      const lv = Math.min(1, (S.room.localParticipant.audioLevel || 0) * 2.5);
      ring.style.setProperty('--lv', lv.toFixed(2));
    }
  }, 120);

  // Sürekli Açık modunda 5 dakika hiç konuşmazsan bas-konuşa geç (1 dakika önce uyar)
  let liveWarned = false;
  setInterval(() => {
    if (!S.room || !S.open || !S.live) { S.liveSince = 0; liveWarned = false; return; }
    const lp = S.room.localParticipant;
    if (!S.liveSince || (S.micOn && lp.isSpeaking && (lp.audioLevel || 0) > 0.07)) { S.liveSince = Date.now(); liveWarned = false; return; }
    const quiet = Date.now() - S.liveSince;
    if (quiet > 5 * 60000) {
      S.liveSince = 0; liveWarned = false; forcePtt();
      toast('🎙 5 dakikadır konuşmadığın için bas-konuş moduna geçildi.', 7000);
      speak('Bas konuş moduna geçildi. Konuşmak için düğmeye basılı tutun.'); vibrate([0, 300, 200, 300]);
    } else if (quiet > 4 * 60000 && !liveWarned) {
      liveWarned = true;
      speak('Beş dakikadır konuşmadınız. Bir dakika sonra bas konuş moduna geçilecektir.'); vibrate([0, 300, 200, 300]);
      sheet('<h3>Sürekli Açık: 4 dakikadır konuşmadın</h3><p>1 dakika sonra bas-konuş moduna geçilecek; özel konuşmaların odaya gitmesin.</p><button class="mbtn amber" id="lvKeep">MİKROFON AÇIK KALSIN</button>',
        (b) => { b.querySelector('#lvKeep').onclick = () => { S.liveSince = Date.now(); liveWarned = false; closeSheet(); }; });
    }
  }, 1000);

  // ------------------------------------------------------------ oda ekranı
  function riders() {
    const r = S.room; if (!r) return [];
    const list = [];
    const lp = r.localParticipant;
    list.push({ id: S.id, name: dispName(S.id, S.name), me: true, speaking: lp.isSpeaking && S.micOn, mode: currentMode() });
    r.remoteParticipants.forEach((p) => list.push({ id: p.identity, name: dispName(p.identity, p.name), me: false, speaking: p.isSpeaking, mode: S.modes[p.identity] || 'ptt' }));
    return list;
  }
  let fitT = null, fitKey = '', rrPending = false;
  // 1.4.11: TAKILMA DÜZELTMESİ: oda ekranı saniyede onlarca kez baştan çiziliyordu (her konuşma değişiminde).
  // Artık istekler birleştirilir (en fazla ~6 kez/saniye) ve sadece değişen kısım yeniden çizilir.
  function renderRoom() {
    if (rrPending) return;
    rrPending = true;
    setTimeout(() => { rrPending = false; try { renderRoomNow(); } catch (e) {} }, 160);
  }
  function setHtml(sel, html) { const el = $(sel); if (el && el.__h !== html) { el.__h = html; el.innerHTML = html; return true; } return false; }
  // 1.4.19: oda logosu (sunucudaki base64 resim; Android ile aynı)
  function logoSrc(b) {
    b = String(b || ''); if (!b || /^https?:/i.test(b) && b.length > 400) return '';
    if (/^https:\/\//i.test(b)) return b;
    if (!/^[A-Za-z0-9+\/=]+$/.test(b)) return '';
    return 'data:image/' + (b.startsWith('iVBOR') ? 'png' : b.startsWith('UklG') ? 'webp' : 'jpeg') + ';base64,' + b;
  }
  function renderRoomNow() {
    try { renderMShare(); } catch (e) {}
    // ekrana sığdırma sadece ekran/oda durumu değişince (her çizimde değil: sürekli ölçmek telefonu kasıyordu)
    const fk = (!!S.room) + '|' + page + '|' + window.innerWidth + 'x' + window.innerHeight + '|' + ((store.get('rooms', []) || []).length > 0);
    if (fk !== fitKey) { fitKey = fk; clearTimeout(fitT); fitT = setTimeout(fitRoom, 80); }
    const inRoom = !!S.room;
    $('#roomEmpty').classList.toggle('hidden', inRoom);
    $('#roomBody').classList.toggle('hidden', !inRoom);
    renderPtt();
    // 1.3.9: kayıtlı oda listesi SADECE odada değilken görünür (Android ile aynı); odadayken gizlenir ki bas-konuş aşağı kaymasın
    const hasRooms = (store.get('rooms', []) || []).length > 0;
    $('#recent2').classList.toggle('hidden', inRoom);
    $('#roomListHead').classList.toggle('hidden', inRoom || !hasRooms);
    $('#roomEmpty').classList.toggle('hidden', inRoom || hasRooms);
    if (!inRoom) { renderRoomList('#recent2'); return; }
    $('#recent2').innerHTML = '';
    const list = riders();
    $('#rLogo').textContent = initial(S.title);
    $('#rTitle').textContent = S.title;
    try {
      const cap = (S.cap === undefined ? CFG.MAX_RIDERS : S.cap);
      { const lg = $('#rLogo2'), u = logoSrc(S.logo);
        if (u) { if (lg.__u !== u) { lg.__u = u; lg.innerHTML = '<img alt="" src="' + u + '">'; } lg.classList.add('has'); }
        else { lg.__u = ''; lg.textContent = initial(S.title); lg.classList.remove('has'); } }
      $('#rlName').textContent = String(S.title || S.code || '').toLocaleUpperCase('tr-TR') + (S.locked ? ' 🔒' : '');
      $('#rlCount').textContent = list.length + '/' + (cap > 0 ? cap : '∞') + ' SÜRÜCÜ' + (S.permanent ? ' · KALICI' : '');
      $('#rlMode').textContent = { ptt: 'BAS-KONUŞ', open: 'ELLER SERBEST', live: 'SÜREKLİ AÇIK' }[currentMode()];
      $('#rlStatus').textContent = 'ODA KODU · ' + S.code;
      $('#rlLock').textContent = S.locked ? '🔒 · ' : '';
      $('#rlPpl').textContent = list.length + '/' + (cap > 0 ? cap : '∞');
      $('#rlLoc').textContent = '📍 ' + ({ off: 'KAPALI', saver: 'TASARRUF', live: 'CANLI' }[S.locMode] || 'KAPALI');
      const n = new Date(); $('#rlClock').textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
      routeUi();
    } catch (e) {}
    $('#rSub').textContent = list.length + ' sürücü';
    $('#adminBtn').classList.toggle('hidden', !amAdmin()); try { $('#lAdmin').classList.toggle('hidden', !amAdmin()); } catch (e) {}
    try { roomRecUi(); } catch (e) {}
    const cls = { ptt: 'c-green', open: 'c-orange', live: 'c-red' };
    $$('.modes .sw').forEach((b) => { b.className = 'sw ' + cls[b.dataset.mode] + (b.dataset.mode === currentMode() ? ' on' : ''); });
    const talking = list.filter((x) => x.speaking).map((x) => x.me ? 'Sen' : x.name);
    $('#talking').classList.toggle('on', talking.length > 0);
    try {
      $('#lcdChan').textContent = talking.length ? talking.map((x) => String(x).toLocaleUpperCase('tr-TR')).join(', ') : 'SESSİZ';
      const cn = list.filter((x) => S.onCall.has(x.id)).map((x) => String(x.name).toLocaleUpperCase('tr-TR'));
      const cl = $('#lcdCall'); cl.textContent = cn.length ? '📞 ' + cn.join(', ') + ' TELEFONDA · DUYMUYOR' : '';
    } catch (e) {}
    $('#talkingText').textContent = talking.length ? '🎙 ' + talking.join(', ') + (talking.length > 1 || talking[0] === 'Sen' ? ' konuşuyor' : ' konuşuyor') : 'Kimse konuşmuyor';
    const me = S.locs[S.id];
    const ridersChanged = setHtml('#riders', list.map((x) => {
      const loc = S.locs[x.id];
      const line = [];
      if (!x.me && me && loc) line.push(fmtDist(dist(me, loc)));
      if (loc && loc.spd > 3) line.push(loc.spd + ' km/s');
      if (x.me) line.push('sen');
      // 1.4.2: durum simgeleri sağdan sola: [📍 konum] ← [📞 telefon / 🎧 müzik-medya] ← [🎙 konuşuyor]; yazı yok
      const ci = S.callInfo[x.id];
      if (S.onCall.has(x.id) && ci && Date.now() - ci.at > 75000) { S.onCall.delete(x.id); delete S.callInfo[x.id]; }  // takılı kalmasın
      const ic = '<i class="sic m-' + x.mode + '" title="' + (x.mode === 'ptt' ? 'Bas-konuş' : x.mode === 'open' ? 'Eller Serbest' : 'Sürekli Açık') + '">🎙</i>' +
        (S.onCall.has(x.id) ? '<i class="sic a" title="' + (ci && ci.media ? 'müzik / medya' : 'telefonda') + '">' + (ci && ci.media ? '🎧' : '📞') + '</i>' : '') +
        (loc ? '<i class="sic l" data-loc="' + esc(x.id) + '" title="haritada göster">📍</i>' : '');
      const badge = '';   // 1.4.4: mod artık sağda renkli simge
      const crown = isAdmin(x.id) ? (x.id === S.owner ? '👑' : '⭐') : '';
      const lock = S.silenced.has(x.id) ? '🔇' : (S.lockedIds.has(x.id) ? '🔒' : '');
      return '<button class="rider raised' + (x.speaking ? ' speak' : '') + '" data-id="' + esc(x.id) + '">' +
        '<div class="av" style="background:' + colorOf(x.id) + '">' + avIn(x.id, x.name) + '</div>' +
        '<div class="tx"><div class="nm"><span class="n">' + esc(x.name) + '</span>' + crown + lock + badge + '</div><small>' + esc(line.join(' · ')) + '</small></div>' +
        '<span class="sics">' + ic + '</span></button>';
    }).join(''));
    if (ridersChanged) $$('#riders .rider').forEach((el) => el.addEventListener('click', (e) => {
      const pin = e.target.closest && e.target.closest('[data-loc]');
      if (pin) { e.stopPropagation(); showOnMap(pin.dataset.loc); return; }   // 1.4.8: 📍 → haritada o kişi
      riderMenu(el.dataset.id);
    }));
    // 1.4.5: alttaki Odadakiler tuşu (küçük yuvarlak resimler) + Kişiler sayfası başlığı
    setHtml('#pAvs', list.slice(0, 4).map((x) => '<i style="background:' + colorOf(x.id) + '">' + avIn(x.id, x.name) + '</i>').join(''));
    $('#pplTitle').textContent = 'Odadaki kişiler (' + list.length + ')';
    // 1.4.8: kişiler sayfasının LCD'si: oda adı + kim konuşuyor + mod
    try {
      $('#pplRoom').textContent = (S.locked ? '🔒 ' : '') + String(S.title || S.code || '').toLocaleUpperCase('tr-TR');
      $('#pplTalk').textContent = $('#talkingText').textContent;
      $('#pplTalk').classList.toggle('on', talking.length > 0);
      $('#pplMode').textContent = { ptt: 'BAS-KONUŞ', open: 'ELLER SERBEST', live: 'SÜREKLİ AÇIK' }[currentMode()];
    } catch (e) {}
    $('#pplCount').textContent = '👥 ' + list.length;
    $('#pplInfo').textContent = '📞 ' + list.filter((x) => S.onCall.has(x.id)).length + ' TELEFONDA';
  }

  $('#qrBtn').onclick = () => {
    if (!S.room) return;
    let img = '';
    try { const q = qrcode(0, 'M'); q.addData(inviteUrl(S.code)); q.make(); img = q.createDataURL(6, 2); } catch (e) {}
    sheet('<h3>' + esc(S.title) + '</h3><p>Arkadaşın telefonunun kamerasıyla okutsun. Android\'de uygulama açılır, iPhone\'da web sürümü.</p>' +
      (img ? '<div class="qrbox"><img src="' + img + '" alt="QR"></div>' : '') +
      '<div class="codebig">' + esc(S.code) + '</div><button class="mbtn raised" id="qrOk">Kapat</button>', (b) => { b.querySelector('#qrOk').onclick = closeSheet; });
  };
  // ⤴ Paylaş: küçük menü (davet et / fotoğraf gönder / fotoğraflar)
  // 1.4.0: 📣 Herkesi çağır: odayı kaydetmiş herkese "X herkesi ... odasına çağırıyor" bildirimi (sunucu 2 dakikada bir izin verir)
  // 1.4.5: 📣 Odaya çağır: HERKESİ ya da SEÇTİKLERİMİ (gece kimse rahatsız olmasın)
  async function doSummon(to) {
    try {
      const body = { action: 'summon', room: S.code, identity: S.id, name: S.name || 'Bir sürücü' };
      if (to) body.to = to;
      const r = await api(body);
      if (r && r.sent === 'BEKLE') toast('Az önce çağırdın. 2 dakika sonra tekrar çağırabilirsin.');
      else if (r && String(r.sent || '').indexOf('CIHAZ_YOK') === 0) toast('Çağrılacak kayıtlı telefon bulunamadı.');
      else toast(to ? '📣 Seçtiğin ' + to.length + ' kişiye çağrı gönderildi.' : '📣 Çağrı gönderildi.');
    } catch (e) { toast(String(e.message || e)); }
  }
  function seenText(t) {
    if (!t) return 'bilinmiyor';
    const d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? 'bugün' : d === 1 ? 'dün' : d < 7 ? d + ' gün önce' : d < 30 ? Math.floor(d / 7) + ' hafta önce' : Math.floor(d / 30) + ' ay önce';
  }
  async function summonPick() {
    sheet('<h3>👤 Kimi çağıralım?</h3><p class="small">Bu odanın üyeleri (şu an odada olmayanlar)</p><div id="smList" class="smlist"><p>Yükleniyor…</p></div>' +
      '<button class="mbtn danger" id="smGo" disabled>📣 SEÇİLENLERİ ÇAĞIR (0)</button><button class="mbtn raised" id="smNo">Vazgeç</button>', async (b) => {
      b.querySelector('#smNo').onclick = closeSheet;
      const chosen = new Set();
      const go = b.querySelector('#smGo');
      const upd = () => { go.disabled = !chosen.size; go.textContent = '📣 SEÇİLENLERİ ÇAĞIR (' + chosen.size + ')'; };
      go.onclick = () => { closeSheet(); doSummon(Array.from(chosen)); };
      try {
        const r = await api({ action: 'roster', room: S.code, identity: S.id });
        const here = new Set(riders().map((x) => x.id));
        const list = (r.members || []).filter((m) => !here.has(m.id));
        const box = b.querySelector('#smList');
        box.innerHTML = list.length ? list.map((m) => '<label class="sosrow smrow"><input type="checkbox" data-id="' + esc(m.id) + '"><span><b>' + esc(m.name) + '</b><small>son girişi: ' + seenText(m.seen) + '</small></span></label>').join('')
          : '<p>Henüz listede kimse yok. Üyeler bu sürümden sonra odaya bir kez girince listeye eklenir.</p>';
        box.querySelectorAll('input').forEach((i) => i.onchange = () => { if (i.checked) chosen.add(i.dataset.id); else chosen.delete(i.dataset.id); upd(); });
      } catch (e) { b.querySelector('#smList').innerHTML = '<p>Liste alınamadı: ' + esc(e.message || e) + '</p>'; }
    });
  }
  $('#summonBtn').onclick = () => {
    if (!S.room) return;
    sheet('<h3 style="color:#ff5a5a">📣 Odaya çağır</h3><p>Kimi çağırmak istiyorsun?</p>' +
      '<button class="mbtn danger smopt" id="smAll">📣 HERKESİ ÇAĞIR<br><small>Odayı kaydetmiş herkese bildirim gider</small></button>' +
      '<button class="mbtn smopt" id="smSel" style="background:#fff;color:#c0181d;border:2px solid #ff4a4a;font-weight:900">👤 SEÇTİKLERİMİ ÇAĞIR<br><small>Sadece seçtiğin kişiler (gece rahatsız etmez)</small></button>' +
      '<button class="mbtn raised" id="smNo">Vazgeç</button><p class="small">Aynı kişi 2 dakikada bir çağırabilir.</p>', (b) => {
      b.querySelector('#smNo').onclick = closeSheet;
      b.querySelector('#smAll').onclick = () => { closeSheet(); doSummon(null); };
      b.querySelector('#smSel').onclick = () => { closeSheet(); setTimeout(summonPick, 80); };
    });
  };
  // 1.4.5: Kişiler sayfası (Android gibi)
  $('#peopleBtn').onclick = () => { if (!S.room) return; $('#people').classList.remove('hidden'); renderRoom(); };
  $('#pplBack').onclick = () => $('#people').classList.add('hidden');
  $('#chatBtn2').onclick = () => chOpen(null);
  $('#shareBtn').onclick = () => {
    if (!S.room) return;
    sheet('<h3>Paylaş</h3><button class="mbtn raised" id="shInv">👥 Arkadaşını davet et</button>' +
      '<p>📷 Fotoğraf göndermek için 💬 Mesajlar ekranındaki kamera tuşunu kullan.</p>' +
      '<button class="mbtn raised" id="shQr">▦ QR kodu göster</button><button class="mbtn raised" id="shNo">Kapat</button>', (b) => {
      b.querySelector('#shNo').onclick = closeSheet;
      b.querySelector('#shQr').onclick = () => { closeSheet(); setTimeout(() => $('#qrBtn').click(), 60); };
      b.querySelector('#shInv').onclick = () => { closeSheet(); shareInvite(); };
    });
  };
  // 1.4.7: açıklamalı davet mesajı (Android ve iPhone için ayrı bağlantılar; hepsi https:// ile tıklanabilir)
  function inviteText(code, title, locked) {
    const base = location.href.split('?')[0].split('#')[0].replace(/[^/]*$/, '');
    const c = encodeURIComponent(code);
    return '🏍 MotoLink: "' + (title || code) + '" odasına davetlisin!\n\n' +
      '📱 Android:\n👉 Katılmak için dokun: ' + base + 'katil.html?c=' + c + '\n' +
      'Uygulama yüklüyse açılır ve odaya girer. Yüklü değilse indirme sayfası açılır: oradaki MotoLink …apk dosyasını indirip kur, sonra bu bağlantıya tekrar dokun.\n' +
      '⬇ Uygulamayı indir: https://github.com/ozdemiraltuntas/motolink-web/releases/latest\n\n' +
      '🍏 iPhone:\n👉 Katılmak için dokun (Safari\'de açılır): ' + base + '?c=' + c + '\n' +
      'Kalıcı uygulama gibi kullanmak için Safari\'de alttaki Paylaş ⬆ tuşuna, sonra "Ana Ekrana Ekle"ye dokun.\n\n' +
      '🔑 Oda kodu: ' + code + (locked ? '\nBu oda şifreli, şifreyi oda sahibinden iste.' : '');
  }
  // 1.4.23: uygulamaya davet (oda olmadan): Android ve iPhone bağlantıları + arkadaş kodum
  function appInviteText() {
    const base = location.href.split('?')[0].split('#')[0].replace(/[^/]*$/, '');
    return '🏍 Seni MotoLink\'e davet ediyorum! Motosiklet grubu için interkom, harita ve S.O.S.\n\n' +
      '📱 Android: ' + base + 'katil.html\n' +
      '⬇ Uygulamayı indir: https://github.com/ozdemiraltuntas/motolink-web/releases/latest\n\n' +
      '🍏 iPhone (Safari\'de aç): ' + base + '\n' +
      'Kalıcı uygulama gibi kullanmak için Safari\'de Paylaş ⬆ tuşuna, sonra "Ana Ekrana Ekle"ye dokun.\n\n' +
      'Kurunca Arkadaşlarım > Ekle ile beni ekle. Arkadaş kodum: ' + prettyCode(MY_CODE);
  }
  async function shareAppInvite() {
    const text = appInviteText();
    try { if (navigator.share) { await navigator.share({ title: 'MotoLink', text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Davet yazısı kopyalandı.'); } catch (e) { toast(text, 8000); }
  }
  async function shareInvite() {
    if (!S.room) return;
    const text = inviteText(S.code, S.title, S.locked);
    try { if (navigator.share) { await navigator.share({ title: 'MotoLink', text }); return; } } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); toast('Davet yazısı kopyalandı.'); } catch (e) { toast(text, 8000); }
  };

  // ------------------------------------------------------------ yönetici
  function riderMenu(id) {
    const r = riders().find((x) => x.id === id); if (!r) return;
    if (r.me) {
      sheet('<h3>' + esc(r.name) + ' (sen)</h3><p>Konuşma modun: ' + MODES[currentMode()] + (amAdmin() ? ' · ' + (id === S.owner ? '👑 odayı açan' : '⭐ yönetici') : '') + '</p><button class="mbtn raised" id="mx">Kapat</button>',
        (b) => { b.querySelector('#mx').onclick = closeSheet; });
      return;
    }
    const fBtn = isFriend(friendCode(id)) ? '<button class="mbtn raised" disabled>✅ Arkadaş listende</button>' : '<button class="mbtn amber" data-a="friend">👤 Arkadaş olarak ekle</button>';
    const mBtn = '<button class="mbtn raised" data-a="msg">✉ Mesaj yaz</button>';
    if (!amAdmin()) {
      sheet('<h3>' + esc(r.name) + '</h3><p>Konuşma modu: ' + MODES[r.mode] + (isAdmin(id) ? ' · oda yöneticisi' : '') + '</p>' + mBtn + fBtn + '<button class="mbtn raised" id="mx">Kapat</button>',
        (b) => {
          b.querySelector('#mx').onclick = closeSheet;
          b.querySelector('[data-a="msg"]').onclick = () => { closeSheet(); chOpen(id); };
          const fb = b.querySelector('[data-a="friend"]'); if (fb) fb.onclick = () => { closeSheet(); addFriendFromRoom(id, r.name); };
        });
      return;
    }
    const isOwner = id === S.owner, locked = S.lockedIds.has(id), sil = S.silenced.has(id);
    sheet('<h3>' + esc(r.name) + '</h3><p>' + (isOwner ? '👑 Odayı açan' : isAdmin(id) ? '⭐ Oda yöneticisi' : 'Üye') + (sil ? ' · 🔇 susturuldu' : locked ? ' · 🔒 bas-konuşa kilitli' : '') + '</p>' +
      mBtn + fBtn + '<button class="mbtn raised" data-a="ptt">🎙 Bas-konuşa al</button>' +
      (locked ? '<button class="mbtn raised" data-a="unlock">🔓 Açık mikrofon kilidini kaldır</button>' : (!isOwner ? '<button class="mbtn raised" data-a="lock">🔒 Bas-konuşa al ve kilitle</button>' : '')) +
      (!isOwner ? '<button class="mbtn ' + (sil ? 'raised' : 'danger') + '" data-a="sil">' + (sil ? '🔊 Susturmayı kaldır' : '🔇 Sustur (hiç konuşamasın)') + '</button>' : '') +
      '<button class="mbtn raised" data-a="nick">✏️ Odadaki adını değiştir (görev adı)</button>' +
      (!isOwner ? '<button class="mbtn raised" data-a="adm">' + (isAdmin(id) ? '⭐ Yöneticiliğini al' : '⭐ Yönetici yap') + '</button>' : '') +
      (!isOwner ? '<button class="mbtn danger" data-a="kick">🚫 Odadan çıkar</button>' : '') +
      '<button class="mbtn raised" data-a="x">Kapat</button>', (b) => {
      b.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => {
        const a = btn.dataset.a;
        if (a === 'x') return closeSheet();
        if (a === 'friend') { closeSheet(); addFriendFromRoom(id, r.name); return; }
        if (a === 'msg') { closeSheet(); chOpen(id); return; }
        if (a === 'kick') {
          sheet('<h3>' + esc(r.name) + ' odadan çıkarılsın mı?</h3><p>30 dakika boyunca geri giremez.</p><button class="mbtn danger" id="ky">🚫 Evet, odadan çıkar</button><button class="mbtn raised" id="kn">Vazgeç</button>',
            (bb) => { bb.querySelector('#kn').onclick = closeSheet; bb.querySelector('#ky').onclick = () => { closeSheet(); modKick(id, r.name); }; });
          return;
        }
        closeSheet();
        if (a === 'ptt') modPtt(id, r.name, false);
        if (a === 'lock') modPtt(id, r.name, true);
        if (a === 'unlock') { S.lockedIds.delete(id); publishLocks(); toast(r.name + ' artık açık mikrofon kullanabilir.'); renderRoom(); }
        if (a === 'sil') modSilence(id, r.name, !sil);
        if (a === 'adm') modAdmin(id, r.name, !isAdmin(id));
        if (a === 'nick') askNick(id, r.name);
      });
    });
  }
  $('#adminBtn').onclick = () => {
    if (!amAdmin()) return;
    const members = riders().filter((x) => !x.me).length;
    sheet('<h3>🛡 Oda yönetimi</h3><p>' + members + ' üye · ' + S.silenced.size + ' susturulmuş · ' + (S.roomLock ? 'oda kilitli' : 'oda serbest') + '</p>' +
      (RK.mr ? '<button class="mbtn" data-a="rec" style="background:#fff;color:#c0181d;border:2px solid #ff4a4a;font-weight:900">⏹ Kaydı durdur</button>'
             : '<button class="mbtn danger" data-a="rec">⏺ Konuşmaları kaydet</button>') +
      '<button class="mbtn raised" data-a="all">👥 Herkesi bas-konuşa al</button>' +
      '<button class="mbtn raised" data-a="lock">' + (S.roomLock ? '🔓 Oda kilidini aç (herkes mod seçebilsin)' : '🔒 Odayı bas-konuşa kilitle') + '</button>' +
      '<button class="mbtn danger" data-a="silall">🔇 Herkesi sustur (sadece yöneticiler konuşsun)</button>' +
      ((S.silenced.size || S.lockedIds.size || S.roomLock) ? '<button class="mbtn raised" data-a="free">🔊 Herkesi serbest bırak</button>' : '') +
      (amAdmin() && (S.locked || S.permanent) ? '<button class="mbtn raised" data-a="apr">' + (S.approval ? '🛡 Girişte onay: AÇIK (kapatmak için dokun)' : '🛡 Girişte yönetici onayı iste') + '</button>' : '') +
      '<button class="mbtn raised" data-a="ann">📢 Odaya duyuru gönder</button>' +
      (S.id === S.owner && S.permanent ? '<button class="mbtn raised" data-a="ren">✏️ Oda adını düzenle</button>' : '') +
      '<p>Tek bir kişi için listede ismine dokun. Gizlilik gereği kimsenin mikrofonu uzaktan açılamaz.</p>' +
      '<button class="mbtn raised" data-a="x">Kapat</button>', (b) => {
      b.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => {
        const a = btn.dataset.a; closeSheet();
        if (a === 'all') modAllPtt();
        if (a === 'lock') modRoomLock(!S.roomLock);
        if (a === 'silall') modSilenceAll();
        if (a === 'free') modReleaseAll();
        if (a === 'apr') setApproval(!S.approval);
        if (a === 'ren') setTimeout(askRenameRoom, 80);
        if (a === 'ann') setTimeout(askAnnounce, 80);
        if (a === 'rec') setTimeout(() => $('#roomRecBtn').onclick(), 80);   // 1.4.4: kayıt YÖNET menüsünde
      });
    });
  };
  // 1.4.23: odayı açan kişi oda adını düzeltebilir (giriş kodu aynı kalır, odadakilerde ad kendiliğinden güncellenir)
  function askAnnounce() {
    sheet('<h3>📢 Odaya duyuru</h3><p>Odadakilerin ekranında yazı çıkar ve sesli okunur.</p>' +
      '<input id="anIn" class="input inset" maxlength="140" placeholder="ör. 5 dakika sonra yola çıkıyoruz">' +
      '<button class="mbtn amber" id="anOk">Gönder</button><button class="mbtn raised" id="anNo">Vazgeç</button>', (b) => {
      const inp = b.querySelector('#anIn'); setTimeout(() => inp.focus(), 50);
      b.querySelector('#anNo').onclick = closeSheet;
      b.querySelector('#anOk').onclick = () => {
        const v = inp.value.trim().slice(0, 140); if (!v) return;
        closeSheet(); publish({ t: 'ann', text: v }); toast('📢 Duyuru gönderildi.');
      };
    });
  }
  function askRenameRoom() {
    sheet('<h3>✏️ Oda adını düzenle</h3><p>Yeni adı yaz. Odanın giriş kodu ve davet bağlantıları aynı kalır.</p>' +
      '<input id="rnIn" class="input inset" maxlength="32" value="' + esc(S.title || '') + '">' +
      '<button class="mbtn amber" id="rnOk">Kaydet</button><button class="mbtn raised" id="rnNo">Vazgeç</button>', (b) => {
      const inp = b.querySelector('#rnIn'); setTimeout(() => inp.focus(), 50);
      b.querySelector('#rnNo').onclick = closeSheet;
      b.querySelector('#rnOk').onclick = async () => {
        const v = inp.value.replace(/\s+/g, ' ').trim();
        if (v.length < 2) { toast('Oda adı en az 2 harf olmalı.'); return; }
        closeSheet();
        try {
          const j = await api({ action: 'create', room: S.code, identity: S.id, displayName: v, permanent: S.permanent, password: 'keep', approval: S.approval });
          const nm = (j.room && j.room.name) || v;
          S.title = nm;
          rememberRoom(S.code, nm, S.locked, S.wantRoom && S.wantRoom.pw);
          publish({ t: 'roominfo', name: nm, logo: S.logo || '' });
          renderRoom(); toast('Oda adı güncellendi: ' + nm);
        } catch (e) { toast((e.message || 'Oda adı değiştirilemedi.').indexOf('başka biri') >= 0 ? 'Bu odayı sen açmamışsın; sadece açan kişi düzenleyebilir.' : (e.message || 'Oda adı değiştirilemedi.'), 6000); }
      };
    });
  }
  function askNick(id, name) {
    sheet('<h3>' + esc(name) + ' bu odada hangi adla görünsün?</h3><p>Sadece bu odada görünür; diğer odalarda kendi adıyla görünmeye devam eder.</p>' +
      '<input id="nkIn" class="input inset" maxlength="24" placeholder="ör. Dalgıç, Muhabere, Öncü">' +
      '<button class="mbtn amber" id="nkOk">Kaydet</button><button class="mbtn raised" id="nkReset">↩ Kendi adına döndür</button><button class="mbtn raised" id="nkNo">Vazgeç</button>', (b) => {
      const inp = b.querySelector('#nkIn'); setTimeout(() => inp.focus(), 50);
      b.querySelector('#nkNo').onclick = closeSheet;
      b.querySelector('#nkOk').onclick = () => { const v = inp.value.trim(); if (!v) return; closeSheet(); modNick(id, name, v); };
      b.querySelector('#nkReset').onclick = () => { closeSheet(); modNick(id, name, ''); };
    });
  }
  async function modNick(id, name, nick) {
    nick = String(nick || '').replace(/\s+/g, ' ').trim().substring(0, 24);
    try {
      await api({ action: 'nick', room: S.code, identity: S.id, target: id, nick });
      if (nick) S.nicks[id] = nick; else delete S.nicks[id];
      publish({ t: 'nick', id, n: nick });
      toast(nick ? name + ' bu odada artık "' + nick + '" olarak görünüyor.' : name + ' kendi adına döndü.');
      renderRoom(); renderMapRiders();
    } catch (e) { toast('Yapılamadı: ' + (e.message || 'sunucuya ulaşılamadı')); }
  }
  function serverMute(target) { api({ action: 'mute', room: S.code, identity: S.id, target }).catch(() => {}); }
  function modCall(target, op) { return api({ action: 'mod', room: S.code, identity: S.id, target, op }); }
  function modPtt(id, name, lock) {
    if (lock) { S.lockedIds.add(id); publishLocks(); }
    publish({ t: 'mod', to: id, a: 'ptt', lock: !!lock });
    serverMute(id);
    toast(name + ' bas-konuşa alındı' + (lock ? ' ve açık mikrofonu kilitlendi.' : '.'));
    renderRoom();
  }
  async function setApproval(on) {
    try {
      // 1.1.8: yöneticiler de açıp kapatabilir (sunucu 0.9.45 "approval")
      let j;
      try { j = await api({ action: 'approval', room: S.code, identity: S.id, on: on }); S.approval = !!j.approval; }
      catch (e1) {
        if (S.id !== S.owner) throw e1;
        j = await api({ action: 'create', room: S.code, identity: S.id, displayName: S.title, permanent: S.permanent, password: 'keep', approval: on });
        S.approval = !!(j.room && j.room.approval);
      }
      publish({ t: 'apr', on: S.approval });
      toast(S.approval ? '🛡 Girişte yönetici onayı açıldı.' : 'Girişte yönetici onayı kapatıldı.');
    } catch (e) { toast('Yapılamadı: ' + (e.message || 'sunucuya ulaşılamadı')); }
  }
  function modAllPtt() { publish({ t: 'mod', to: '*', a: 'ptt', lock: false }); serverMute('*'); toast('Odadaki herkes bas-konuşa alındı.'); }
  function modRoomLock(on) {
    S.roomLock = on; publishLocks();
    if (on) { publish({ t: 'mod', to: '*', a: 'ptt', lock: true }); serverMute('*'); }
    toast(on ? '🔒 Oda bas-konuşa kilitlendi.' : '🔓 Oda kilidi açıldı: herkes istediği modu seçebilir.');
    renderRoom();
  }
  function modSilence(id, name, on) {
    if (on) S.silenced.add(id); else S.silenced.delete(id);
    publishLocks();
    if (on) publish({ t: 'mod', to: id, a: 'ptt', lock: true });
    modCall(id, on ? 'silence' : 'unsilence').catch(() => {});
    if (on) serverMute(id);
    toast(on ? '🔇 ' + name + ' susturuldu; bas-konuşla da konuşamaz.' : '🔊 ' + name + ' artık konuşabilir.');
    renderRoom();
  }
  function modSilenceAll() {
    const t = riders().filter((x) => !x.me && !isAdmin(x.id) && !S.silenced.has(x.id));
    if (!t.length) { toast('Susturulacak üye yok.'); return; }
    t.forEach((x) => S.silenced.add(x.id));
    publishLocks(); publish({ t: 'mod', to: '*', a: 'ptt', lock: true });
    t.forEach((x) => modCall(x.id, 'silence').catch(() => {}));
    serverMute('*');
    toast('🔇 ' + t.length + ' kişi susturuldu; sadece yöneticiler konuşabilir.');
    renderRoom();
  }
  function modReleaseAll() {
    const sil = Array.from(S.silenced);
    S.silenced = new Set(); S.lockedIds = new Set(); S.roomLock = false;
    publishLocks();
    sil.forEach((id) => modCall(id, 'unsilence').catch(() => {}));
    toast('🔓 Bütün kilitler ve susturmalar kaldırıldı.');
    renderRoom();
  }
  async function modAdmin(id, name, make) {
    try {
      const j = await modCall(id, make ? 'admin' : 'unadmin');
      S.admins = new Set(j.admins || []); publishAdmins();
      toast(make ? '⭐ ' + name + ' artık oda yöneticisi.' : name + ' artık yönetici değil.');
      renderRoom();
    } catch (e) { toast('Yapılamadı: ' + (e.message || 'sunucuya ulaşılamadı')); }
  }
  async function modKick(id, name) {
    publish({ t: 'mod', to: id, a: 'kick' });
    try { const j = await modCall(id, 'kick'); S.admins = new Set(j.admins || []); publishAdmins(); toast(name + ' odadan çıkarıldı. 30 dakika geri giremez.'); }
    catch (e) { toast(name + '\'e çıkış komutu gönderildi; sunucu: ' + (e.message || 'ulaşılamadı')); }
  }

  // ------------------------------------------------------------ kullanım sayacı (yönetici istatistiği ve dakika sayımı)
  function tick(minutes) {
    if (!S.code) return;
    const b = { action: 'tick', room: S.code, identity: S.id, minutes, server: S.server };
    const l = S.myLoc; if (l) { b.lat = Math.round(l.lat * 10) / 10; b.lon = Math.round(l.lon * 10) / 10; }
    beacon(b);
  }
  function startTicks() {
    stopTicks();
    S.lastTick = Date.now();
    S.tickFirst = setTimeout(() => tick(0), 20000);
    S.tickTimer = setInterval(() => { S.lastTick = Date.now(); tick(5); }, 5 * 60000);
  }
  function stopTicks() { clearTimeout(S.tickFirst); clearInterval(S.tickTimer); S.tickFirst = S.tickTimer = null; }
  function finalTick() {
    if (!S.lastTick) return;
    const m = (Date.now() - S.lastTick) / 60000;
    if (m > 0.05) tick(Math.round(m * 100) / 100);
    S.lastTick = 0;
  }
  window.addEventListener('pagehide', () => { if (S.room) finalTick(); });

  // ------------------------------------------------------------ ekran açık kalsın
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && opt.wake && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) {}
  }

  // ------------------------------------------------------------ konum
  function applyLocMode() {
    $$('.locmodes .sw').forEach((b) => { b.className = 'sw ' + ({ off: 'c-green', saver: 'c-yellow', live: 'c-red' }[b.dataset.loc]) + (b.dataset.loc === S.locMode ? ' on' : ''); });
    if (S.locMode === 'off') { stopGeo(); if (S.room) publish({ t: 'loc_off' }); delete S.locs[S.id]; renderMapRiders(); return; }
    startGeo();
  }
  $$('.locmodes .sw').forEach((b) => b.addEventListener('click', () => {
    S.locMode = b.dataset.loc; store.set('locMode', S.locMode); applyLocMode();
    toast({ off: 'Konum kapalı: kimse göremez.', saver: 'Tasarruf: 15 saniyede bir paylaşılır.', live: 'Canlı: 3 saniyede bir paylaşılır.' }[S.locMode]);
  }));
  function startGeo() {
    if (!navigator.geolocation) { toast('Bu tarayıcı konum desteklemiyor.'); return; }
    if (S.watchId != null) return;
    S.watchId = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      S.myLoc = { lat: c.latitude, lon: c.longitude, spd: c.speed != null && c.speed >= 0 ? Math.round(c.speed * 3.6) : 0 };
      if (S.locMode !== 'off') { S.locs[S.id] = { id: S.id, name: S.name || 'Ben', lat: S.myLoc.lat, lon: S.myLoc.lon, spd: S.myLoc.spd, at: Date.now() }; sendLoc(false); }
      renderMapRiders();
    }, (err) => {
      if (err.code === 1) { toast('Konum izni verilmedi. Ayarlar > Gizlilik > Konum Servisleri > Safari\'den izin ver.', 7000); S.locMode = 'off'; store.set('locMode', 'off'); stopGeo(); applyLocMode(); }
    }, { enableHighAccuracy: S.locMode === 'live', maximumAge: 2000, timeout: 20000 });
  }
  function stopGeo() { if (S.watchId != null) { try { navigator.geolocation.clearWatch(S.watchId); } catch (e) {} S.watchId = null; } }
  function sendLoc(force) {
    if (!S.room || !S.myLoc || S.locMode === 'off') return;
    const gap = S.locMode === 'live' ? 3000 : 15000;
    if (!force && Date.now() - S.lastLocSent < gap) return;
    S.lastLocSent = Date.now();
    publish({ t: 'loc', lat: S.myLoc.lat, lon: S.myLoc.lon, spd: S.myLoc.spd });
  }

  // ------------------------------------------------------------ harita
  let map = null, markers = {}, centered = false;
  function initMap() {
    if (!map) {
      map = L.map('map', { zoomControl: false, attributionControl: true }).setView([39.0, 35.0], 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const h = new Date().getHours();
      if (h >= 19 || h < 7) $('#map').classList.add('night');
    }
    map.invalidateSize();
    if (S.locMode === 'off' && !S.myLoc && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => { S.myLoc = { lat: p.coords.latitude, lon: p.coords.longitude, spd: 0 }; if (!centered) { centered = true; map.setView([S.myLoc.lat, S.myLoc.lon], 14); } renderMapRiders(); }, () => {}, { maximumAge: 60000, timeout: 15000 });
    }
    renderMapRiders();
  }
  $('#centerBtn').onclick = () => { if (S.myLoc && map) map.setView([S.myLoc.lat, S.myLoc.lon], Math.max(map.getZoom(), 15)); else toast('Konumun henüz bulunamadı.'); };
  // 1.3.0: Herkes — odadaki herkes ekrana sığsın
  function showEveryone(all) {
    const pts = Object.values(all || S.locs).map((l) => [l.lat, l.lon]);
    if (!pts.length) { toast('Konumunu paylaşan kimse yok.'); return; }
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
  }
  // 1.4.8: kişiler listesindeki 📍 → Harita sekmesi, o kişi ortada
  function showOnMap(id) {
    const l = id === S.id && S.myLoc ? { lat: S.myLoc.lat, lon: S.myLoc.lon } : S.locs[id];
    if (!l) { toast('Bu kişinin konumu yok.'); return; }
    try { $('#people').classList.add('hidden'); } catch (e) {}
    go('map');
    setTimeout(() => { try { if (map) { map.invalidateSize(); map.setView([l.lat, l.lon], Math.max(map.getZoom(), 16)); if (markers[id]) markers[id].openTooltip(); } } catch (e) {} }, 350);
  }
  let mapAll = {};
  function renderMapRiders() {
    $('#pings').classList.toggle('hidden', !S.room);
    const all = Object.assign({}, S.locs);
    mapAll = all;
    if (S.myLoc && !all[S.id]) all[S.id] = { id: S.id, name: S.name || 'Ben', lat: S.myLoc.lat, lon: S.myLoc.lon, spd: S.myLoc.spd };
    if (map) {
      Object.keys(markers).forEach((id) => { if (!all[id]) { map.removeLayer(markers[id]); delete markers[id]; } });
      Object.values(all).forEach((l) => {
        const me = l.id === S.id;
        const icon = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
          html: '<div class="pin' + (me ? ' me' : '') + '" style="background:' + colorOf(l.id) + '">' + avIn(l.id, l.name) + '</div>' });
        if (markers[l.id]) { markers[l.id].setLatLng([l.lat, l.lon]); if (markers[l.id].__h !== icon.options.html) { markers[l.id].__h = icon.options.html; markers[l.id].setIcon(icon); } }
        else markers[l.id] = L.marker([l.lat, l.lon], { icon }).addTo(map).bindTooltip(esc(me ? 'Sen' : l.name));
      });
      if (!centered && S.myLoc) { centered = true; map.setView([S.myLoc.lat, S.myLoc.lon], 14); }
    }
    const me = all[S.id];
    const nAll = Object.keys(all).length;
    const mrHtml = (nAll ? '<button class="chip all" data-all="1"><div class="av">👥</div><b>Herkes</b><small>' + nAll + ' kişi</small></button>' : '') + Object.values(all).map((l) => {
      const sub = l.id === S.id ? (l.spd > 3 ? l.spd + ' km/s' : 'sen') : (l.spd > 3 ? l.spd + ' km/s' : (me ? fmtDist(dist(me, l)) : ''));
      return '<button class="chip" data-id="' + esc(l.id) + '"><div class="av" style="background:' + colorOf(l.id) + '">' + avIn(l.id, l.name) + '</div><b>' + esc(l.id === S.id ? 'Sen' : l.name) + '</b><small>' + esc(sub) + '</small></button>';
    }).join('') || '<div class="note" style="margin:4px 2px">' + (S.room ? 'Konumunu paylaşan kimse yok.' : 'Odaya girince arkadaşların burada görünür.') + '</div>';
    if (setHtml('#mapRiders', mrHtml)) $$('#mapRiders .chip').forEach((el) => el.addEventListener('click', () => {
      if (!map) return;
      if (el.dataset.all) { showEveryone(mapAll); return; }
      const l = mapAll[el.dataset.id]; if (l) map.setView([l.lat, l.lon], Math.max(map.getZoom(), 15));
    }));
    if (page === 'room') renderRoom();
  }

  // ------------------------------------------------------------ 1.3.0: Rotalar (sürüş kaydı, sadece bu telefonda)
  const REC = { on: false, pts: [], t0: 0, watch: null, dist: 0, max: 0, tick: null };
  function routesList() { return store.get('routes', []) || []; }
  function fmtDur(ms) { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0'); }
  function recStats() {
    try { mtRecUi(); } catch (e) {}
    const ms = REC.on ? Date.now() - REC.t0 : 0;
    const km = REC.dist / 1000;
    $('#recTag').textContent = REC.on ? '● KAYIT AÇIK' : 'KAYIT KAPALI';
    $('#recMain').textContent = km.toFixed(1).replace('.', ',') + ' km';
    $('#recSub').textContent = 'Süre ' + fmtDur(ms) + ' · Ort ' + (ms > 5000 ? Math.round(km / (ms / 3600000)) : 0) + ' km/s · En yüksek ' + Math.round(REC.max);
    $('#recBtn').textContent = REC.on ? '■ Kaydı bitir ve kaydet' : '● Sürüş kaydını başlat';
  }
  function recStart() {
    if (!navigator.geolocation) { toast('Bu tarayıcı konum desteklemiyor.'); return; }
    Object.assign(REC, { on: true, pts: [], t0: Date.now(), dist: 0, max: 0 });
    keepAwake(true);
    REC.watch = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords, p = { lat: c.latitude, lon: c.longitude, t: Date.now(), s: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : 0 };
      const last = REC.pts[REC.pts.length - 1];
      if (last) { const d = dist(last, p); if (d < 12) return; REC.dist += d; }
      REC.max = Math.max(REC.max, p.s); REC.pts.push(p); recStats();
    }, (err) => { if (err.code === 1) { toast('Konum izni verilmedi.'); recStop(false); } }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    REC.tick = setInterval(recStats, 1000); recStats();
  }
  function recStop(save) {
    try { navigator.geolocation.clearWatch(REC.watch); } catch (e) {}
    clearInterval(REC.tick); REC.on = false;
    if (!S.room && !REC.keepAwakeKeep) keepAwake(false);
    if (save && REC.pts.length >= 2) {
      let pts = REC.pts; if (pts.length > 3000) { const k = Math.ceil(pts.length / 3000); pts = pts.filter((_, i) => i % k === 0); }
      const ms = Date.now() - REC.t0;
      const rs = routesList(); rs.unshift({ id: REC.t0, at: REC.t0, ms, km: REC.dist / 1000, max: REC.max, pts: pts.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5), p.t]) });
      store.set('routes', rs.slice(0, 20)); toast('✅ Rota kaydedildi: ' + (REC.dist / 1000).toFixed(1).replace('.', ',') + ' km');
    } else if (save) toast('Kaydedilecek kadar yol alınmadı.');
    recStats(); renderRoutes(); renderLcd();
  }
  $('#recBtn').onclick = () => { if (REC.on) recStop(true); else recStart(); };
  let routeLayer = null;
  function showRoute(r) {
    go('map');
    setTimeout(() => {
      initMap(); if (routeLayer) map.removeLayer(routeLayer);
      const ll = r.pts.map((p) => [p[0], p[1]]);
      routeLayer = L.polyline(ll, { color: '#ff7a00', weight: 5, opacity: 0.9 }).addTo(map);
      map.fitBounds(ll, { padding: [40, 40] }); $('#routeClear').classList.remove('hidden');
    }, 80);
  }
  $('#routeClear').onclick = () => { if (routeLayer && map) map.removeLayer(routeLayer); routeLayer = null; $('#routeClear').classList.add('hidden'); };
  function gpx(r) {
    const x = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="MotoLink" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>MotoLink ' + new Date(r.at).toLocaleString('tr-TR') + '</name><trkseg>' +
      r.pts.map((p) => '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"><time>' + new Date(p[2]).toISOString() + '</time></trkpt>').join('') + '</trkseg></trk></gpx>';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([x], { type: 'application/gpx+xml' })); a.download = 'MotoLink-rota-' + r.id + '.gpx'; document.body.appendChild(a); a.click(); a.remove();
  }
  function renderRoutes() {
    recStats(); renderPlans();
    const rs = routesList();
    $('#routesList').innerHTML = rs.length ? rs.map((r, i) => '<div class="row raised rrow"><div class="tx"><b>' + esc(new Date(r.at).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })) + '</b>' +
      '<small>' + r.km.toFixed(1).replace('.', ',') + ' km · ' + fmtDur(r.ms) + ' · ort ' + Math.round(r.km / (r.ms / 3600000 || 1)) + ' · en yüksek ' + Math.round(r.max) + ' km/s</small>' +
      '<div class="acts"><button data-show="' + i + '">🗺 Haritada</button><button data-gpx="' + i + '">⬇ GPX</button><button class="del" data-del="' + i + '">🗑</button></div></div></div>').join('')
      : '<div class="note" style="margin:0 2px">Henüz kayıtlı rotan yok. Yukarıdan sürüş kaydını başlat.</div>';
    $$('#routesList [data-show]').forEach((b) => b.onclick = () => showRoute(routesList()[+b.dataset.show]));
    $$('#routesList [data-gpx]').forEach((b) => b.onclick = () => gpx(routesList()[+b.dataset.gpx]));
    $$('#routesList [data-del]').forEach((b) => b.onclick = () => { const l = routesList(); l.splice(+b.dataset.del, 1); store.set('routes', l); renderRoutes(); renderLcd(); });
  }

  // ------------------------------------------------------------ 1.3.2 · rota hazırlama (Android ile aynı biçim: MLR1 kodu, oda mesajı)
  function plans() { return store.get('plans', []) || []; }
  function savePlan(p) {
    const l = plans().filter((x) => x.name !== p.name); l.unshift({ name: p.name, stops: p.stops });
    store.set('plans', l.slice(0, 30)); renderRoutes(); renderLcd();
  }
  function planCode(p) {
    const bytes = new TextEncoder().encode(JSON.stringify({ n: p.name.slice(0, 40), s: p.stops.map((s) => ({ lat: s.lat, lon: s.lon, n: s.n })) }));
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return 'MLR1:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
  }
  function planFromText(t) {
    const i = String(t).indexOf('MLR1:'); if (i < 0) return null;
    const code = String(t).slice(i + 5).trim().split(/\s/)[0].replace(/-/g, '+').replace(/_/g, '/');
    try {
      const bin = atob(code), u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
      const o = JSON.parse(new TextDecoder().decode(u));
      const stops = (o.s || []).map((s) => ({ lat: +s.lat, lon: +s.lon, n: String(s.n || '') })).filter((s) => isFinite(s.lat) && isFinite(s.lon));
      return stops.length ? { name: String(o.n || 'Paylaşılan rota'), stops } : null;
    } catch (e) { return null; }
  }
  function planShareText(p) {
    return '🏍 MotoLink rotası: ' + p.name + '\n' + p.stops.map((s, i) => (i + 1) + '. ' + s.n).join('\n') +
      '\n\nMotoLink\'te açmak için bu mesajın tamamını kopyala, sonra Rotalar > "Rota kodu ekle".\n\n' + planCode(p);
  }
  async function shareText(text) {
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('📋 Kopyalandı, mesaja yapıştırabilirsin.'); } catch (e) { toast('Kopyalanamadı.'); }
  }
  // ------------------------------------------------------------ 1.4.14: YENİ ROTA OLUŞTUR (Nereden / Nereye, yazarken öneri, yol üstünde hava)
  // Alanlar: { me:true } = Konumum · { n, sub, lat, lon } = seçilmiş yer · { n:'' } = boş
  let PLAN = { name: '', stops: [] }, planMap = null, planLayer = null, planPins = [], planSeq = 0;
  let RF = [], rAct = -1, rSugT = null, rSugSeq = 0, rLast = null;   // rLast: son hesaplanan rota { stops, km, sec, geo }
  const ME = () => ({ me: true, n: 'Konumum' });
  function openPlan(p, from) {
    rLast = null;
    if (p && p.stops && p.stops.length) {
      RF = p.stops.map((s) => (s.me ? ME() : { n: s.n, lat: s.lat, lon: s.lon }));
      if (RF.length < 2) RF.push({ n: '' });
      PLAN = { name: p.name || '', stops: [], auto: RF.every((f) => f.me || f.lat != null) };
    } else { RF = [ME(), { n: '' }]; PLAN = { name: '', stops: [], auto: false }; }
    PLAN.from = from || 'map';
    go('plan');
  }
  function initPlanMap() {
    $('#rResult').classList.add('hidden'); $('#rSug').classList.add('hidden'); rAct = -1;
    renderFields();
    if (PLAN.auto) { PLAN.auto = false; buildRoute(); }
    else { const e = RF.findIndex((f) => !f.me && f.lat == null); if (e >= 0 && !PLAN.q) setTimeout(() => { const i = $('#rFields input[data-f="' + e + '"]'); if (i) i.focus(); }, 120); }
    if (PLAN.q) { const q = PLAN.q; PLAN.q = ''; const e = RF.findIndex((f) => !f.me && f.lat == null); if (e >= 0) { RF[e].n = q; renderFields(); const i = $('#rFields input[data-f="' + e + '"]'); if (i) { i.focus(); rAct = e; rSuggest(q); } } }
  }
  function fieldReady(f) { return f.me || f.lat != null; }
  function renderFields() {
    const n = RF.length;
    $('#rFields').innerHTML = RF.map((f, i) => {
      const dot = i === 0 ? 'g' : i === n - 1 ? 'r' : 'y';
      const ph = i === 0 ? 'Nereden?' : i === n - 1 ? 'Nereye gidiyoruz?' : 'Ara durak';
      return '<div class="rf' + (fieldReady(f) ? ' ok' : '') + '"><span class="rdot ' + dot + '"></span>' +
        '<input data-f="' + i + '" type="search" enterkeyhint="search" autocomplete="off" placeholder="' + ph + '" value="' + esc(f.me ? '📍 Konumum' : f.n) + '">' +
        (i > 0 && i < n - 1 ? '<button class="rx" data-x="' + i + '" aria-label="Kaldır">✕</button>' : '') + '</div>';
    }).join('');
    $$('#rFields input').forEach((el) => {
      const i = +el.dataset.f;
      el.addEventListener('focus', () => { rAct = i; if (RF[i].me) { el.value = ''; } el.select && el.select(); rSuggest(el.value.trim()); });
      el.addEventListener('input', () => { RF[i] = { n: el.value }; rAct = i; clearTimeout(rSugT); const q = el.value.trim(); rSugT = setTimeout(() => rSuggest(q), q.length < 3 ? 150 : 350); rGoUi(); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('#rSug [data-s]'); if (first) first.click(); } });
      el.addEventListener('blur', () => setTimeout(() => { if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#rFields')) return; if (RF[i] && RF[i].me) el.value = '📍 Konumum'; }, 250));
    });
    $$('#rFields [data-x]').forEach((b) => b.onclick = () => { RF.splice(+b.dataset.x, 1); renderFields(); rGoUi(); });
    rGoUi();
  }
  function rGoUi() { const ok = RF.filter(fieldReady).length >= 2 && RF.every(fieldReady); $('#rGo').disabled = !ok; $('#rGo').classList.toggle('dim', !ok); }
  $('#rSwap').onclick = () => { RF.reverse(); renderFields(); $('#rResult').classList.add('hidden'); };
  $('#rAdd').onclick = () => { if (RF.length >= 8) { toast('En fazla 8 nokta.'); return; } RF.splice(RF.length - 1, 0, { n: '' }); renderFields(); const i = $('#rFields input[data-f="' + (RF.length - 2) + '"]'); if (i) i.focus(); };
  const rRecent = () => store.get('rRecent', []) || [];
  function rRemember(p) { const l = rRecent().filter((x) => x.n !== p.n); l.unshift({ n: p.n, sub: p.sub || '', lat: p.lat, lon: p.lon }); store.set('rRecent', l.slice(0, 8)); }
  function rIcon(k, v) {
    if (/city|town|village|suburb|county|state|district|municipality/.test(v) || k === 'place' || k === 'boundary') return '🏙';
    return ({ aerodrome: '✈️', fuel: '⛽', restaurant: '🍽', cafe: '☕', fast_food: '🍔', hotel: '🏨', motel: '🏨', hospital: '🏥', pharmacy: '💊', parking: '🅿️', beach: '🏖', peak: '⛰', water: '🌊', lake: '🌊', bus_station: '🚌', station: '🚆', mall: '🛍', supermarket: '🛒', mosque: '🕌', museum: '🏛', motorcycle: '🏍' })[v] || (k === 'highway' ? '🛣' : '📍');
  }
  function rSugShow(items, head) {
    const box = $('#rSug');
    if (!items.length && !head) { box.classList.add('hidden'); return; }
    box.innerHTML = (head || '') + items.map((x, i) => '<button class="rs" data-s="' + i + '"><i>' + x.ic + '</i><span><b>' + esc(x.n) + '</b><small>' + esc(x.sub || '') + '</small></span></button>').join('');
    box.classList.remove('hidden');
    $$('#rSug [data-s]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    $$('#rSug [data-s]').forEach((b) => b.onclick = () => rPick(items[+b.dataset.s]));
  }
  function rPick(x) {
    if (rAct < 0) return;
    if (x.me) RF[rAct] = ME();
    else { RF[rAct] = { n: x.n, sub: x.sub, lat: x.lat, lon: x.lon }; rRemember(x); }
    $('#rSug').classList.add('hidden');
    renderFields();
    const next = RF.findIndex((f) => !fieldReady(f));
    if (next >= 0) { const i = $('#rFields input[data-f="' + next + '"]'); if (i) i.focus(); }
    else { try { document.activeElement.blur(); } catch (e) {} buildRoute(); }   // hepsi seçildi: rota kendiliğinden çizilsin
  }
  function rDistTxt(lat, lon) { if (!S.myLoc) return ''; const d = dist(S.myLoc, { lat, lon }); return d < 1000 ? Math.round(d) + ' m' : Math.round(d / 1000) + ' km'; }
  async function rSuggest(q) {
    const my = ++rSugSeq;
    const meItem = { me: true, ic: '📍', n: 'Konumum', sub: 'Şu an bulunduğun yer' };
    if (!q || q.length < 2) {
      const rec = rRecent().map((r) => ({ ic: '🕘', n: r.n, sub: (r.sub ? r.sub + ' · ' : '') + 'son aramalar', lat: r.lat, lon: r.lon }));
      rSugShow([meItem].concat(rec)); return;
    }
    rSugShow([], '<div class="rsn">Aranıyor…</div>');
    let items = [];
    try {
      const bias = S.myLoc ? '&lat=' + S.myLoc.lat.toFixed(3) + '&lon=' + S.myLoc.lon.toFixed(3) : '&lat=39.9&lon=32.85';
      const r = await fetch('https://photon.komoot.io/api/?limit=8&q=' + encodeURIComponent(q) + bias);
      const j = await r.json(); if (my !== rSugSeq) return;
      const seen = new Set();
      (j.features || []).forEach((f) => {
        const p = f.properties || {}, c = (f.geometry || {}).coordinates || [];
        if (c.length < 2) return;
        const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city; if (!name) return;
        const place = [p.district, p.city !== name ? p.city : '', p.county, p.state !== p.city ? p.state : ''].filter(Boolean);
        const sub = [...new Set(place)].slice(0, 2).join(', ') + (p.country && p.country !== 'Türkiye' && p.country !== 'Turkey' ? (place.length ? ', ' : '') + p.country : '');
        const key = name + '|' + sub; if (seen.has(key)) return; seen.add(key);
        const dt = rDistTxt(c[1], c[0]);
        items.push({ ic: rIcon(p.osm_key, p.osm_value || p.type || ''), n: name, sub: sub + (dt ? (sub ? ' · ' : '') + dt : ''), lat: +c[1].toFixed(5), lon: +c[0].toFixed(5) });
      });
    } catch (e) {
      try {   // yedek: OpenStreetMap araması
        const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=tr&q=' + encodeURIComponent(q));
        const l = await r.json(); if (my !== rSugSeq) return;
        items = l.map((x) => ({ ic: rIcon(x.category, x.type), n: String(x.name || x.display_name).split(',')[0], sub: String(x.display_name).split(',').slice(1, 3).join(',').trim(), lat: +(+x.lat).toFixed(5), lon: +(+x.lon).toFixed(5) }));
      } catch (e2) { if (my === rSugSeq) rSugShow([], '<div class="rsn">Arama yapılamadı (internet?).</div>'); return; }
    }
    if (my !== rSugSeq) return;
    rSugShow(items, items.length ? '' : '<div class="rsn">Bulunamadı. Başka bir yazımla dene (ör. "Abant Gölü").</div>');
  }
  document.addEventListener('click', (e) => { if (!e.target.closest || (!e.target.closest('#rSug') && !e.target.closest('#rFields'))) $('#rSug').classList.add('hidden'); });
  function getMyPos() {
    return new Promise((ok, no) => {
      if (S.myLoc && S.myLoc.lat) { ok({ lat: S.myLoc.lat, lon: S.myLoc.lon }); return; }
      if (!navigator.geolocation) { no(new Error('konum yok')); return; }
      navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }), () => no(new Error('izin')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }
  function fmtDurS(sec) { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + ' SA ' + (m % 60) + ' DK' : m + ' DK'; }
  const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  async function buildRoute() {
    if (!RF.every(fieldReady)) { toast('Önce nereden ve nereye seç.'); return; }
    const my = ++planSeq;
    $('#rSug').classList.add('hidden');
    $('#rResult').classList.remove('hidden');
    setTimeout(() => { try { $('#rResult').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 120);
    $('#planKm').textContent = 'HESAPLANIYOR…'; $('#planSub').textContent = ''; $('#planTag').textContent = 'ROTA';
    $('#rWx').innerHTML = ''; $('#rWarn').textContent = '';
    let stops;
    try {
      stops = [];
      for (const f of RF) { if (f.me) { const p = await getMyPos(); stops.push({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), n: 'Konumum' }); } else stops.push({ lat: f.lat, lon: f.lon, n: f.n }); }
    } catch (e) { $('#planKm').textContent = 'KONUM YOK'; $('#planSub').textContent = 'Konum izni ver ya da "Nereden"e bir yer yaz.'; return; }
    if (!planMap) {
      planMap = L.map('planMap', { zoomControl: false, attributionControl: false }).setView([39.0, 35.0], 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(planMap);
    }
    setTimeout(() => planMap.invalidateSize(), 50);
    planPins.forEach((m) => planMap.removeLayer(m)); planPins = [];
    if (planLayer) { planMap.removeLayer(planLayer); planLayer = null; }
    stops.forEach((s, i) => {
      const c = i === 0 ? '#3be083' : i === stops.length - 1 ? '#ff4b4b' : '#ffffff';
      planPins.push(L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: '<div class="rpin" style="background:' + c + '"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(planMap));
    });
    planMap.fitBounds(stops.map((s) => [s.lat, s.lon]), { padding: [30, 30], maxZoom: 13 });
    try {
      const q = stops.map((s) => s.lon + ',' + s.lat).join(';');
      const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + q + '?overview=full&geometries=geojson&steps=true');
      const j = await r.json(); if (my !== planSeq) return;
      const rt = j.routes && j.routes[0]; if (!rt) throw new Error('yok');
      const geo = rt.geometry.coordinates.map((c) => [c[1], c[0]]);
      planLayer = L.polyline(geo, { color: '#2d7cff', weight: 6, opacity: 0.9 }).addTo(planMap);
      planMap.fitBounds(planLayer.getBounds(), { padding: [24, 24] });
      rLast = { stops, km: rt.distance / 1000, sec: rt.duration, geo, steps: flatSteps(rt) };
      const eta = new Date(Date.now() + rt.duration * 1000);
      const molas = Math.floor(rt.duration / 7200);
      $('#planKm').textContent = Math.round(rt.distance / 1000) + ' KM · ' + fmtDurS(rt.duration);
      $('#planSub').textContent = 'Varış ≈ ' + hhmm(eta) + (molas ? ' · ' + molas + ' mola önerilir' : '') + (stops.length > 2 ? ' · ' + (stops.length - 2) + ' ara durak' : '');
      routeWeather(my);
    } catch (e) { if (my === planSeq) { $('#planKm').textContent = 'YOL BULUNAMADI'; $('#planSub').textContent = 'İnternetini kontrol et ya da başka bir yer seç.'; } }
  }
  // Yol üstünde hava: rotanın 5 noktasında, oraya varacağın saatteki hava (Open-Meteo, ücretsiz; tek istek)
  const WX = (c) => c === 0 ? '☀️' : c <= 2 ? '🌤' : c === 3 ? '☁️' : (c === 45 || c === 48) ? '🌫' : c <= 57 ? '🌦' : c <= 67 ? '🌧' : c <= 77 ? '🌨' : c <= 82 ? '🌧' : c <= 86 ? '🌨' : '⛈';
  async function routeWeather(my) {
    const R = rLast; if (!R) return;
    const g = R.geo; const cum = [0];
    for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + dist({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: g[i][0], lon: g[i][1] }));
    const tot = cum[cum.length - 1] || 1;
    const fr = R.km < 15 ? [0, 1] : [0, 0.25, 0.5, 0.75, 1];
    const pts = fr.map((f) => { let k = cum.findIndex((d) => d >= f * tot); if (k < 0) k = g.length - 1; return { lat: g[k][0], lon: g[k][1], f, at: new Date(Date.now() + R.sec * 1000 * f) }; });
    $('#rWx').innerHTML = '<div class="rsn">Hava durumu alınıyor…</div>';
    try {
      const days = Math.min(7, Math.ceil(R.sec / 86400) + 2);
      const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map((p) => p.lat.toFixed(3)).join(',') + '&longitude=' + pts.map((p) => p.lon.toFixed(3)).join(',') +
        '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&timezone=GMT&forecast_days=' + days;
      const [wr, names] = await Promise.all([fetch(u).then((r) => r.json()), Promise.all(pts.map((p, i) => i === 0 ? Promise.resolve(R.stops[0].n === 'Konumum' ? '' : R.stops[0].n) : i === pts.length - 1 ? Promise.resolve(R.stops[R.stops.length - 1].n) : placeName(p.lat, p.lon)))]);
      if (my !== planSeq) return;
      const arr = Array.isArray(wr) ? wr : [wr];
      const warns = [];
      const tiles = pts.map((p, i) => {
        const h = (arr[i] || {}).hourly || {}; const key = p.at.toISOString().slice(0, 13) + ':00';
        let k = (h.time || []).indexOf(key); if (k < 0) k = 0;
        const t = Math.round((h.temperature_2m || [])[k]), c = (h.weather_code || [])[k] || 0, pr = (h.precipitation_probability || [])[k] || 0, w = Math.round((h.wind_speed_10m || [])[k] || 0);
        const nm = (names[i] || (i === 0 ? 'Başlangıç' : 'Yol')).slice(0, 18);
        const bad = [];
        if (c === 45 || c === 48) bad.push('sis');
        if (c >= 71 && c <= 77 || c === 85 || c === 86) bad.push('kar');
        else if (c >= 51 && c <= 67 || c >= 80 && c <= 82 || pr >= 60) bad.push('yağmur, yol kaygan');
        if (c >= 95) bad.push('fırtına / yıldırım');
        if (!isNaN(t) && t <= 3) bad.push(t + '°: buzlanma olabilir');
        if (w >= 40) bad.push('kuvvetli rüzgar ' + w + ' km/s');
        if (bad.length) warns.push('⚠ ' + nm + ': ' + bad.join(', ') + '.');
        return '<div class="' + (bad.length ? 'w' : '') + '"><b>' + esc(nm) + '</b><span>' + WX(c) + '</span><em>' + (isNaN(t) ? '–' : t + '°') + '</em><small>' + hhmm(p.at) + '</small></div>';
      });
      $('#rWx').innerHTML = tiles.join('');
      $('#rWarn').textContent = warns.length ? warns.slice(0, 3).join(' ') + ' Dikkatli sür.' : '✅ Yol boyunca hava uygun görünüyor.';
      $('#rWarn').classList.toggle('ok', !warns.length);
    } catch (e) { if (my === planSeq) $('#rWx').innerHTML = '<div class="rsn">Hava durumu alınamadı.</div>'; }
  }
  async function placeName(lat, lon) {
    try {
      const r = await fetch('https://photon.komoot.io/reverse?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4) + '&limit=1');
      const j = await r.json(); const p = ((j.features || [])[0] || {}).properties || {};
      return p.district || p.city || p.county || p.name || p.state || '';
    } catch (e) { return ''; }
  }
  $('#rGo').onclick = () => { if (!$('#rGo').disabled) buildRoute(); else toast('Önce nereden ve nereye seç.'); };
  function openExternalNav(R) {
    if (!R) return;
    const s = R.stops, a = s[0], b = s[s.length - 1], mid = s.slice(1, -1);
    const g = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + a.lat + ',' + a.lon + '&destination=' + b.lat + ',' + b.lon + (mid.length ? '&waypoints=' + mid.map((x) => x.lat + ',' + x.lon).join('|') : '');
    const ap = 'https://maps.apple.com/?dirflg=d&saddr=' + a.lat + ',' + a.lon + '&daddr=' + b.lat + ',' + b.lon;
    const ya = 'https://yandex.com.tr/maps/?rtext=' + s.map((x) => x.lat + ',' + x.lon).join('~') + '&rtt=auto';
    sheet('<h3>🧭 Navigasyonu başlat</h3><p>Sesli yol tarifi için rota seçtiğin harita uygulamasında açılır.</p>' +
      '<button class="mbtn amber" id="nvG">Google Haritalar</button>' + (isIOS ? '<button class="mbtn raised" id="nvA">Apple Haritalar' + (mid.length ? ' (ara duraksız)' : '') + '</button>' : '') +
      '<button class="mbtn raised" id="nvY">Yandex Haritalar</button><button class="mbtn raised" id="nvN">Vazgeç</button>', (bx) => {
        bx.querySelector('#nvG').onclick = () => { closeSheet(); window.open(g, '_blank'); };
        const na = bx.querySelector('#nvA'); if (na) na.onclick = () => { closeSheet(); window.open(ap, '_blank'); };
        bx.querySelector('#nvY').onclick = () => { closeSheet(); window.open(ya, '_blank'); };
        bx.querySelector('#nvN').onclick = closeSheet;
      });
  }
  // ------------------------------------------------------------ 1.4.16: UYGULAMA İÇİ NAVİGASYON (Android'deki gibi: sesli yol tarifi, dönüş okları, kalan km, yoldan çıkınca yeniden hesaplama)
  function flatSteps(rt) {
    const out = [];
    ((rt.legs) || []).forEach((lg) => (lg.steps || []).forEach((st) => {
      const m = st.maneuver || {};
      out.push({ type: m.type || '', mod: m.modifier || '', exit: m.exit || 0, loc: { lat: (m.location || [0, 0])[1], lon: (m.location || [0, 0])[0] }, name: st.name || '', d: st.distance || 0, t: st.duration || 0 });
    }));
    return out;
  }
  const NV = { on: false, map: null, line: null, me: null, steps: [], idx: 0, geo: [], stops: [], watch: null, pos: null, follow: true, snd: true, said: {}, off: 0, lastRe: 0, rerouting: false, lastFix: 0, dest: null };
  function nvDir(mod) { return ({ left: 'sola', right: 'sağa', 'slight left': 'hafif sola', 'slight right': 'hafif sağa', 'sharp left': 'keskin sola', 'sharp right': 'keskin sağa', straight: 'düz', uturn: 'U dönüşü yap' })[mod] || ''; }
  function nvArrow(st) {
    if (!st) return '⬆';
    if (st.type === 'arrive') return '🏁';
    if (st.type === 'roundabout' || st.type === 'rotary' || st.type === 'roundabout turn') return '⟳';
    return ({ left: '⬅', right: '➡', 'slight left': '↖', 'slight right': '↗', 'sharp left': '↩', 'sharp right': '↪', straight: '⬆', uturn: '⮌' })[st.mod] || '⬆';
  }
  function nvText(st) {
    if (!st) return 'Düz devam et';
    const nm = st.name ? ' · ' + st.name : '';
    if (st.type === 'arrive') return 'Hedefe vardınız';
    if (st.type === 'depart') return 'Yola çık';
    if (st.type === 'roundabout' || st.type === 'rotary' || st.type === 'roundabout turn') return 'Kavşakta ' + (st.exit ? st.exit + '. çıkıştan çık' : 'devam et');
    if (st.mod === 'uturn') return 'U dönüşü yap';
    if (st.type === 'merge') return 'Yola katıl';
    if (st.type === 'fork') return (st.mod.indexOf('left') >= 0 ? 'Çatalda sola' : st.mod.indexOf('right') >= 0 ? 'Çatalda sağa' : 'Çatalda düz') + ' devam et';
    if (st.type === 'on ramp' || st.type === 'off ramp') return 'Bağlantı yoluna ' + (nvDir(st.mod) ? nvDir(st.mod).replace('düz', '') + ' ' : '') + 'gir';
    if (st.type === 'continue' || st.type === 'new name' || st.mod === 'straight') return 'Düz devam et';
    return nvDir(st.mod) ? nvDir(st.mod).charAt(0).toLocaleUpperCase('tr-TR') + nvDir(st.mod).slice(1) + ' dön' : 'Devam et';
  }
  const nvDist = (m) => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' km' : (m < 50 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + ' m';
  function nvSpeak(t) { if (!NV.snd || !window.speechSynthesis) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.lang = 'tr-TR'; u.rate = 1.02; speechSynthesis.speak(u); } catch (e) {} }
  function nvStart(R) {
    if (!R || !R.steps || !R.steps.length) { toast('Bu rotada yol tarifi yok. Rotayı yeniden oluştur.'); return; }
    NV.on = true; NV.steps = R.steps.map((x) => ({ ...x })); NV.idx = 0; NV.geo = R.geo; NV.stops = R.stops; NV.said = {}; NV.off = 0; NV.follow = true; NV.dest = R.stops[R.stops.length - 1]; NV.pos = null;
    nvIndexSteps();
    $('#navi').classList.remove('hidden');
    if (!NV.map) {
      NV.map = L.map('naviMap', { zoomControl: false, attributionControl: false }).setView([R.stops[0].lat, R.stops[0].lon], 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(NV.map);
      NV.map.on('dragstart', () => { NV.follow = false; });
    }
    setTimeout(() => NV.map.invalidateSize(), 60);
    if (NV.line) NV.map.removeLayer(NV.line);
    NV.line = L.polyline(R.geo, { color: '#2d7cff', weight: 8, opacity: 0.9 }).addTo(NV.map);
    if (NV.dm) NV.map.removeLayer(NV.dm);
    NV.dm = L.marker([NV.dest.lat, NV.dest.lon], { icon: L.divIcon({ className: '', html: '<div class="rpin" style="background:#ff4b4b"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(NV.map);
    if (!NV.me) NV.me = L.marker([R.stops[0].lat, R.stops[0].lon], { icon: L.divIcon({ className: '', html: '<div class="nvme"><i></i></div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1000 }).addTo(NV.map);
    NV.me.setLatLng([R.stops[0].lat, R.stops[0].lon]);
    nvBanner(null);
    keepAwake(true);
    if (!navigator.geolocation) { toast('Bu tarayıcı konum desteklemiyor.'); return; }
    NV.watch = navigator.geolocation.watchPosition(nvFix, () => { $('#nvText').textContent = 'Konum bulunamıyor'; $('#nvStreet').textContent = 'Konum iznini ve GPS\'i kontrol et'; }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    nvSpeak0('Navigasyon başladı. Yol tarifi için ekranı açık tut.');
    toast('🧭 Navigasyon başladı. Ekran açık kalmalı.', 3500);
  }
  function nvSpeak0(t) { nvSpeak(t); }
  function nvStop() {
    NV.on = false;
    if (NV.watch != null) { try { navigator.geolocation.clearWatch(NV.watch); } catch (e) {} NV.watch = null; }
    try { speechSynthesis.cancel(); } catch (e) {}
    $('#navi').classList.add('hidden');
    if (!REC.on && !S.room) keepAwake(false);
  }
  // rota çizgisine en yakın noktaya uzaklık (m)
  // konuma en yakın rota noktasının sırası (önce son bilinen yerin ilerisine bakar: geri sıçramasın)
  function nvNearest(p) {
    const g = NV.geo; let best = 1e12, bi = 0;
    const from = Math.max(0, (NV.ui || 0) - 5), to = Math.min(g.length - 1, (NV.ui || 0) + 600);
    const scan = (a, b) => { for (let i = a; i <= b; i++) { const dx = (g[i][0] - p.lat) * 111000, dy = (g[i][1] - p.lon) * 111000 * Math.cos(p.lat * Math.PI / 180); const d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } } };
    scan(from, to);
    if (best > 150 * 150) scan(0, g.length - 1);
    return bi;
  }
  function nvIndexSteps() {
    const g = NV.geo;
    NV.steps.forEach((st) => { let best = 1e12, bi = 0; for (let i = 0; i < g.length; i++) { const dx = (g[i][0] - st.loc.lat) * 111000, dy = (g[i][1] - st.loc.lon) * 111000 * Math.cos(st.loc.lat * Math.PI / 180); const d = dx * dx + dy * dy; if (d < best) { best = d; bi = i; } } st.gi = bi; });
    NV.ui = 0;
  }
  function nvOffDist(p) {
    let best = 1e9; const g = NV.geo;
    for (let i = 0; i < g.length; i += 1) { const dx = Math.abs(g[i][0] - p.lat) * 111000, dy = Math.abs(g[i][1] - p.lon) * 111000 * Math.cos(p.lat * Math.PI / 180); if (dx < 400 && dy < 400) { const d = Math.sqrt(dx * dx + dy * dy); if (d < best) best = d; } }
    if (best < 1e8) return best;
    for (let i = 0; i < g.length; i += 5) { const d = dist(p, { lat: g[i][0], lon: g[i][1] }); if (d < best) best = d; }
    return best;
  }
  function nvBanner(d, st) {
    const nx = st || NV.steps[Math.min(NV.idx + 1, NV.steps.length - 1)];
    $('#nvArrow').textContent = nvArrow(nx);
    $('#nvDist').textContent = d == null ? '—' : nvDist(d);
    $('#nvText').textContent = nvText(nx);
    $('#nvStreet').textContent = nx && nx.name && nx.type !== 'arrive' ? nx.name : '';
  }
  function nvFix(pos) {
    if (!NV.on) return;
    const c = pos.coords, p = { lat: c.latitude, lon: c.longitude }; NV.pos = p; NV.lastFix = Date.now();
    const spd = c.speed != null && c.speed >= 0 ? Math.round(c.speed * 3.6) : 0;
    $('#nvSpd').textContent = spd;
    NV.me.setLatLng([p.lat, p.lon]);
    const hd = c.heading; if (hd != null && !isNaN(hd) && spd > 4) { const el = NV.me.getElement && NV.me.getElement(); const inner = el && el.querySelector('.nvme'); if (inner) inner.style.transform = 'rotate(' + hd + 'deg)'; }
    if (NV.follow) NV.map.setView([p.lat, p.lon], Math.max(NV.map.getZoom(), 16), { animate: true });
    const st = NV.steps;
    // yol üzerindeki ilerleme: konumun rotadaki en yakın noktası; dönüşün noktasını geçtiysen adım ilerler
    const ui = nvNearest(p);
    NV.ui = Math.max(NV.ui || 0, ui);
    while (NV.idx < st.length - 2 && (NV.ui >= st[NV.idx + 1].gi - 1 || dist(p, st[NV.idx + 1].loc) < 25)) NV.idx++;
    const nx = st[Math.min(NV.idx + 1, st.length - 1)];
    const dNx = dist(p, nx.loc);
    nvBanner(dNx, nx);
    // kalan yol ve süre
    let remD = dNx, remT = 0; for (let j = NV.idx + 1; j < st.length; j++) { remD += st[j].d; remT += st[j].t; }
    const dEnd = dist(p, NV.dest);
    $('#nvRem').textContent = nvDist(Math.max(remD, dEnd));
    $('#nvEta').textContent = hhmm(new Date(Date.now() + remT * 1000));
    // sesli tarif: 400 m, 150 m ve dönüşte
    const key = NV.idx + 1;
    const say = (tag, t) => { const k = key + tag; if (!NV.said[k]) { NV.said[k] = 1; nvSpeak(t); } };
    if (nx.type === 'arrive') { if (dEnd < 40) { nvSpeak('Hedefe vardınız.'); toast('🏁 Hedefe vardınız', 4000); setTimeout(nvStop, 3500); return; } if (dNx < 300) say('a', 'Hedefe ' + nvDist(dNx) + ' kaldı.'); }
    else if (dNx < 40) say('c', nvText(nx));
    else if (dNx < 180) say('b', nvDist(dNx) + ' sonra ' + nvText(nx).toLocaleLowerCase('tr-TR'));
    else if (dNx < 500 && st[NV.idx + 1].d > 600) say('a', nvDist(dNx) + ' sonra ' + nvText(nx).toLocaleLowerCase('tr-TR'));
    // yoldan çıktıysan yeniden hesapla
    const off = nvOffDist(p);
    $('#naviTop').classList.toggle('warn', off > 80);
    if (off > 80) { NV.off++; if (NV.off >= 3 && !NV.rerouting && Date.now() - NV.lastRe > 15000) nvReroute(p); } else NV.off = 0;
  }
  async function nvReroute(p) {
    NV.rerouting = true; NV.lastRe = Date.now();
    $('#nvText').textContent = 'Yol yeniden hesaplanıyor…'; nvSpeak('Yol yeniden hesaplanıyor.');
    try {
      const rest = NV.stops.slice(1).filter((s) => dist(p, s) > 300 || s === NV.dest);
      const pts = [{ lat: p.lat, lon: p.lon }].concat(rest);
      const q = pts.map((s) => s.lon + ',' + s.lat).join(';');
      const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + q + '?overview=full&geometries=geojson&steps=true');
      const j = await r.json(); const rt = j.routes && j.routes[0]; if (!rt) throw new Error('yok');
      NV.steps = flatSteps(rt); NV.idx = 0; NV.geo = rt.geometry.coordinates.map((c) => [c[1], c[0]]); NV.said = {}; NV.off = 0; nvIndexSteps();
      if (NV.line) NV.map.removeLayer(NV.line);
      NV.line = L.polyline(NV.geo, { color: '#2d7cff', weight: 8, opacity: 0.9 }).addTo(NV.map);
      $('#naviTop').classList.remove('warn');
    } catch (e) { $('#nvText').textContent = 'Yol hesaplanamadı (internet?)'; }
    NV.rerouting = false;
  }
  $('#nvEnd').onclick = () => nvStop();
  $('#nvCen').onclick = () => { NV.follow = true; if (NV.pos) NV.map.setView([NV.pos.lat, NV.pos.lon], 17); };
  $('#nvSnd').onclick = () => { NV.snd = !NV.snd; $('#nvSnd').textContent = NV.snd ? '🔊' : '🔇'; if (!NV.snd) { try { speechSynthesis.cancel(); } catch (e) {} } toast(NV.snd ? 'Sesli yol tarifi açık' : 'Sesli yol tarifi kapalı', 1800); };
  $('#nvExt').onclick = () => openExternalNav(rLast);
  $('#rNav').onclick = () => { if (!rLast) { toast('Önce rotayı oluştur.'); return; } nvStart(rLast); };
  $('#planBack').onclick = () => go(PLAN.from || 'map');
  $('#planNew').onclick = () => openPlan(null, 'routes');
  // Harita sayfasından: "Nereye gidiyoruz?" yazınca rota oluştur açılır; Nereden = Konumum, yazdığın yer için öneriler çıkar
  function mapPlan(q) { openPlan(null, 'map'); PLAN.q = q || ''; }
  $('#mapQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const q = $('#mapQ').value.trim(); $('#mapQ').blur(); $('#mapQ').value = ''; mapPlan(q); } });
  $('#mapQ').addEventListener('focus', () => { const q = $('#mapQ').value.trim(); $('#mapQ').blur(); $('#mapQ').value = ''; mapPlan(q); });
  $('#mtPlan').onclick = () => { const q = $('#mapQ').value.trim(); $('#mapQ').value = ''; mapPlan(q); };
  $('#mtRoutes').onclick = () => go('routes');
  $('#mtRec').onclick = () => { if (REC.on) recStop(true); else recStart(); mtRecUi(); };
  function mtRecUi() { $('#mtRec').classList.toggle('on', REC.on); $('#mtRecI').textContent = REC.on ? '⏹' : '⏺'; $('#mtRecT').textContent = REC.on ? 'Bitir' : 'Kayıt'; }
  function planNow() {
    const R = rLast; const st = R ? R.stops : RF.filter((f) => f.lat != null).map((f) => ({ lat: f.lat, lon: f.lon, n: f.n }));
    PLAN.stops = st;
    PLAN.name = (st.length >= 2 ? st[0].n + ' → ' + st[st.length - 1].n : 'Rota') + ' · ' + new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    return PLAN;
  }
  $('#planSave').onclick = () => { if (!rLast) { toast('Önce rotayı oluştur.'); return; } const p = planNow(); savePlan(p); toast('✅ Rota kaydedildi: ' + p.name); };
  $('#planSend').onclick = () => {
    if (!S.room) { toast('Göndermek için önce odaya gir.'); return; }
    if (!rLast) { toast('Önce rotayı oluştur.'); return; }
    const p = planNow(); savePlan(p); publish({ t: 'route', name: p.name, stops: p.stops }); toast('📡 Rota odadakilere gönderildi.');
  };
  $('#planShare').onclick = () => { if (!rLast) { toast('Önce rotayı oluştur.'); return; } const p = planNow(); savePlan(p); shareText(planShareText(p)); };
  $('#planImport').onclick = () => {
    sheet('<h3>📋 Rota kodu ekle</h3><p>Arkadaşının gönderdiği MotoLink rota mesajını yapıştır.</p><textarea id="plTxt" class="input inset" style="height:120px;padding:10px" placeholder="MLR1:… kodu ya da mesajın tamamı"></textarea><button id="plOk" class="mbtn amber">Ekle</button><button id="plNo" class="mbtn raised">Vazgeç</button>', (b) => {
      b.querySelector('#plNo').onclick = closeSheet;
      b.querySelector('#plOk').onclick = () => { const p = planFromText(b.querySelector('#plTxt').value); if (!p) { toast('Mesajda geçerli rota kodu bulunamadı.'); return; } savePlan(p); closeSheet(); toast('✅ Rota eklendi: ' + p.name); };
    });
  };
  function renderPlans() {
    const l = plans();
    $('#plansList').innerHTML = l.length ? l.map((p, i) => '<div class="row raised rrow"><div class="tx"><b>' + esc(p.name) + '</b><small>' + p.stops.length + ' durak · ' + esc(p.stops[0].n) + ' → ' + esc(p.stops[p.stops.length - 1].n) + '</small>' +
      '<div class="acts"><button data-pe="' + i + '">🗺 Aç</button><button data-ps="' + i + '">📡 Odaya</button><button data-pc="' + i + '">📤</button><button class="del" data-pd="' + i + '">🗑</button></div></div></div>').join('')
      : '<div class="note" style="margin:0 2px">Henüz hazır rotan yok. Yukarıdan yeni rota hazırla ya da arkadaşının kodunu ekle.</div>';
    $$('#plansList [data-pe]').forEach((b) => b.onclick = () => openPlan(plans()[+b.dataset.pe], 'routes'));
    $$('#plansList [data-ps]').forEach((b) => b.onclick = () => { const p = plans()[+b.dataset.ps]; if (!S.room) { toast('Göndermek için önce odaya gir.'); return; } publish({ t: 'route', name: p.name, stops: p.stops }); toast('📡 Rota odadakilere gönderildi.'); });
    $$('#plansList [data-pc]').forEach((b) => b.onclick = () => shareText(planShareText(plans()[+b.dataset.pc])));
    $$('#plansList [data-pd]').forEach((b) => b.onclick = () => { const l2 = plans(); l2.splice(+b.dataset.pd, 1); store.set('plans', l2); renderRoutes(); renderLcd(); });
  }

  // ------------------------------------------------------------ hızlı uyarılar
  const PINGS = {
    fuel: ['⛽', 'Benzin', 'benzin lazım'], break: ['☕', 'Mola', 'mola verelim'],
    danger: ['⚠️', 'Tehlike', 'dikkat, yolda tehlike ya da radar var'], wait: ['✋', 'Bekleyin', 'geride kaldım, bekleyin']
  };
  $$('#pings .pg').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.ping, p = PINGS[k];
    if (!S.room) { toast('Durum göndermek için önce bir odaya katıl.'); return; }
    if (Date.now() - (S.lastPing[k] || 0) < 8000) { toast(p[0] + ' ' + p[1] + ' az önce gönderildi.'); return; }
    S.lastPing[k] = Date.now();
    const j = { t: 'ping', k };
    if (S.myLoc) { j.lat = S.myLoc.lat; j.lon = S.myLoc.lon; }
    publish(j); vibrate(60);
    toast(p[0] + ' "' + p[1] + '" odadaki herkese gönderildi.');
  }));
  function onPing(j, id, name) {
    const p = PINGS[j.k]; if (!p) return;
    let where = '';
    const me = S.myLoc;
    if (me && j.lat != null && j.lon != null) where = ' · ' + fmtDist(dist(me, { lat: +j.lat, lon: +j.lon }));
    else if (me && id && S.locs[id]) where = ' · ' + fmtDist(dist(me, S.locs[id]));
    toast(p[0] + ' ' + name + ': ' + p[1].toLocaleUpperCase('tr-TR') + where, 6000);
    beep(2, 990); vibrate([0, 120, 90, 120]);
    speak(name + ', ' + p[2]);
  }

  // ------------------------------------------------------------ S.O.S
  // 1.3.7: S.O.S sadece SEÇTİĞİN odalara gider (içinde olduğun oda her zaman seçili). İyiyim tuşu büyük ve ortada.
  function sosMineShow() {
    const m = S.mySos; if (!m) return;
    $('#sosMine').innerHTML = '<h2>🆘 S.O.S YAYINDA</h2><p>\u201c' + esc(m.reason || 'Yardım lazım') + '\u201d bildirdin.</p>' +
      '<button class="sosok" id="sosOk">✅ İYİYİM<small>S.O.S\'i kapat</small></button>' +
      '<button class="mbtn raised" id="sosHide">Küçült (S.O.S tuşundan geri aç)</button>';
    $('#sosMine').classList.remove('hidden');
    $('#sosOk').onclick = () => { $('#sosMine').classList.add('hidden'); sendSos(null, true); };
    $('#sosHide').onclick = () => $('#sosMine').classList.add('hidden');
  }
  $('#sosBtn').onclick = () => {
    if (S.mySos) { sosMineShow(); return; }
    const cur = S.room ? S.code : null;
    const prev = store.get('sosRooms', []);
    const others = (store.get('rooms', []) || []).filter((r) => r.code !== cur);
    sheet('<h3 style="color:#ff6b6b">S.O.S gönderilsin mi?</h3><p><b>Kime gitsin?</b> Sadece işaretlediğin odadakiler uyarılır.</p>' +
      (cur ? '<div class="sosrow on">✓ Şu an içinde olduğun oda: <b>' + esc(S.title || cur) + '</b></div>' : '') +
      '<div class="sosrooms">' + others.map((r) => '<label class="sosrow"><input type="checkbox" data-c="' + esc(r.code) + '"' + (prev.includes(r.code) ? ' checked' : '') + '> ' + esc(r.name || r.code) + '</label>').join('') + '</div>' +
      '<p id="sosHint"></p>' +
      ['Kaza yaptım', 'Arıza, yolda kaldım', 'Yardım lazım'].map((r) => '<button class="mbtn danger" data-r="' + r + '">🆘 ' + r + '</button>').join('') +
      '<button class="mbtn raised" id="sosNo">Vazgeç</button>', (b) => {
      const picked = () => [...b.querySelectorAll('[data-c]:checked')].map((x) => x.dataset.c);
      const upd = () => {
        const ok = !!cur || picked().length > 0;
        b.querySelectorAll('[data-r]').forEach((x) => x.disabled = !ok);
        b.querySelector('#sosHint').textContent = ok ? '' : 'Önce en az bir oda işaretle (ya da bir odaya gir).';
      };
      b.querySelectorAll('[data-c]').forEach((x) => x.onchange = upd); upd();
      b.querySelector('#sosNo').onclick = closeSheet;
      b.querySelectorAll('[data-r]').forEach((btn) => btn.onclick = () => {
        const rooms = picked(); store.set('sosRooms', rooms);
        if (cur && !rooms.includes(cur)) rooms.unshift(cur);
        closeSheet(); sendSos(btn.dataset.r, false, rooms);
      });
    });
  };
  function publishSos(cancel) {
    const j = { t: 'sos', reason: (S.mySos && S.mySos.reason) || 'Yardım lazım', cancel: !!cancel };
    if (S.myLoc) { j.lat = S.myLoc.lat; j.lon = S.myLoc.lon; }
    publish(j);
  }
  function sendSos(reason, cancel, rooms) {
    const go2 = () => {
      const prev = S.mySos;
      if (!cancel) { S.mySos = { reason, rooms: rooms || [], at: Date.now() }; store.set('mySos', S.mySos); }
      publishSos(cancel);
      const list = (cancel ? ((prev && prev.rooms) || []) : (rooms || [])).slice(0, 30);
      const body = { action: 'sos', room: 'SOS', identity: S.id, name: S.name || 'Bir sürücü', reason: reason || (S.mySos && S.mySos.reason) || (prev && prev.reason) || 'Yardım lazım', cancel: !!cancel, rooms: list };
      if (S.myLoc) { body.lat = S.myLoc.lat; body.lon = S.myLoc.lon; }
      if (list.length) api(body).catch(() => {});
      if (cancel) { S.mySos = null; store.set('mySos', null); toast('S.O.S kapatıldı, "iyiyim" bildirildi.'); }
      else { toast('🆘 S.O.S gönderildi.' + (S.myLoc ? '' : ' (Konum bulunamadı)'), 4000); sosMineShow(); }
    };
    if (!cancel && !S.myLoc && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => { S.myLoc = { lat: p.coords.latitude, lon: p.coords.longitude, spd: 0 }; go2(); }, go2, { timeout: 8000, maximumAge: 30000, enableHighAccuracy: true });
    } else go2();
  }
  if (S.mySos) setTimeout(sosMineShow, 1200);
  const activeSos = {};
  function onSos(j, id, name) {
    if (!id) return;
    if (j.cancel) { if (activeSos[id]) { delete activeSos[id]; toast(name + ' iyi olduğunu bildirdi, S.O.S kapandı.', 6000); $('#sosAlert').classList.add('hidden'); } return; }
    const isNew = !activeSos[id];
    activeSos[id] = { name, reason: j.reason || 'Yardım lazım', lat: j.lat, lon: j.lon };
    if (!isNew) return;
    let where = '';
    if (S.myLoc && j.lat != null) where = fmtDist(dist(S.myLoc, { lat: +j.lat, lon: +j.lon })) + ' uzakta';
    const a = $('#sosAlert');
    a.innerHTML = '<h2>🆘 S.O.S</h2><p><b>' + esc(name) + '</b><br>' + esc(activeSos[id].reason) + (where ? '<br>' + esc(where) : '') + '</p>' +
      (j.lat != null ? '<a class="mbtn amber" target="_blank" rel="noopener" href="https://maps.apple.com/?daddr=' + (+j.lat) + ',' + (+j.lon) + '">🧭 Yol tarifi al</a>' : '') +
      '<button class="mbtn raised" id="sosSeen">Gördüm</button>';
    a.classList.remove('hidden');
    a.querySelector('#sosSeen').onclick = () => a.classList.add('hidden');
    beep(6, 1100); vibrate([0, 400, 200, 400, 200, 400]);
    speak('Dikkat! ' + name + ' acil yardım istiyor. ' + activeSos[id].reason);
  }

  // ------------------------------------------------------------ 1.4.18: simgeler, ses düğmesi (dişli çark), kulaklık / hoparlör
  const IC_PLAY = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
  const IC_STOP = '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
  const IC_PREV = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M17 4v16L6 12z" fill="currentColor"/></svg>';
  const IC_NEXT = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 5v14l9-7zM12 5v14l9-7z" fill="currentColor"/></svg>';
  $('#mPrev').innerHTML = IC_PREV; $('#mNext').innerHTML = IC_NEXT; $('#mPlay').innerHTML = IC_PLAY;
  $('#lrPrev').innerHTML = IC_PREV; $('#lrNext').innerHTML = IC_NEXT; $('#lrPlay').innerHTML = IC_PLAY;
  function radioLcd(title, tag, sub, on) {
    try {
      $('#lrName').textContent = '♪ ' + (on || (title && title !== 'KAPALI') ? String(title).toLocaleUpperCase('tr-TR') : 'RADYO');
      $('#lrSub').textContent = on ? (sharedRadio ? 'ODADA ÇALIYOR · ORTAK' : 'ÇALIYOR · SADECE SENDE') : 'KAPALI · AÇMAK İÇİN DOKUN';
      $('#lrPlay').innerHTML = on ? IC_STOP : IC_PLAY;
    } catch (e) {}
  }
  // Ses düğmesi: dişli çarkı parmakla çevir → oda seslerinin düzeyi (iPhone'da sistem sesi değiştirilemez: en sona kıs = sesi kapat)
  let rvol = +store.get('rvol', 100), gearAng = 0;
  function applyVoiceVol() {
    $$('audio.lk').forEach((a) => { try { if (isIOS) a.muted = rvol <= 0; else { a.muted = false; a.volume = Math.max(0, Math.min(1, rvol / 100)); } } catch (e) {} });
  }
  (function gearInit() {
    const t = $('#gearTouch'), img = $('#gearImg'), halo = $('#gearHalo'), hud = $('#gearHud');
    if (!t) return;
    let act = false, last = 0, acc = 0, hideT = null;
    const ang = (e) => { const r = t.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    const show = () => {
      halo.style.setProperty('--gv', rvol / 100); halo.classList.add('on');
      hud.textContent = rvol <= 0 ? '🔇 SES KAPALI' : '🔊 SES %' + rvol; hud.classList.remove('hidden');
      clearTimeout(hideT); hideT = setTimeout(() => { halo.classList.remove('on'); hud.classList.add('hidden'); }, 1800);
    };
    t.addEventListener('pointerdown', (e) => {
      const r = t.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const rr = Math.hypot(dx, dy) / (r.width / 2) * 350;
      act = rr >= 205 && rr <= 350; if (!act) return;
      try { t.setPointerCapture(e.pointerId); } catch (x) {}
      last = ang(e); acc = 0; show(); e.preventDefault();
    });
    t.addEventListener('pointermove', (e) => {
      if (!act) return;
      const a = ang(e); let d = a - last; if (d > 180) d -= 360; if (d < -180) d += 360; last = a;
      gearAng += d; acc += d; img.style.setProperty('--ga', gearAng + 'deg');
      let ch = false;
      while (acc >= 18) { acc -= 18; rvol = Math.min(100, rvol + 8); ch = true; }
      while (acc <= -18) { acc += 18; rvol = Math.max(0, rvol - 8); ch = true; }
      if (ch) { store.set('rvol', rvol); applyVoiceVol(); try { navigator.vibrate && navigator.vibrate(6); } catch (x) {} }
      show(); e.preventDefault();
    });
    const end = () => { act = false; };
    t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
  })();
  // Kulaklık / Hoparlör (Android'deki gibi; seçiliyken tekrar basınca otomatiğe döner)
  let routeSel = store.get('route', 'auto');
  function routeUi() {
    try {
      $('#wL').classList.toggle('on', routeSel === 'headset'); $('#wR').classList.toggle('on', routeSel === 'speaker');
      $('#rlRoute').textContent = routeSel === 'headset' ? '🎧 KULAKLIK' : routeSel === 'speaker' ? '🔊 HOPARLÖR' : '🔊 OTOMATİK';
      $('#wLt').textContent = (routeSel === 'headset' ? '✓ ' : '') + 'Kulaklık'; $('#wRt').textContent = (routeSel === 'speaker' ? '✓ ' : '') + 'Hoparlör';
    } catch (e) {}
  }
  async function applyRoute(say) {
    let ok = false;
    try {
      if (player.setSinkId && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
        const re = routeSel === 'speaker' ? /speaker|hoparl/i : /head|kulak|bluetooth|wired|earpiece|ahize/i;
        const pick = routeSel === 'auto' ? { deviceId: '' } : ds.find((d) => re.test(d.label));
        if (pick) { const els = $$('audio.lk'); els.push(player); for (const a of els) { try { await a.setSinkId(pick.deviceId); } catch (e) {} } ok = true; }
      }
    } catch (e) {}
    if (say && routeSel !== 'auto' && !ok) toast('ℹ️ Bu telefonda ses çıkışını telefon kendisi seçer (kulaklık takılıysa kulaklıktan gelir).', 3500);
  }
  $('#wL').onclick = () => { routeSel = routeSel === 'headset' ? 'auto' : 'headset'; store.set('route', routeSel); routeUi(); applyRoute(true); };
  $('#wR').onclick = () => { routeSel = routeSel === 'speaker' ? 'auto' : 'speaker'; store.set('route', routeSel); routeUi(); applyRoute(true); };
  routeUi();
  // Telefondan paylaşılan müzik (Android ses paketleri: AAC-LC 44,1 kHz mono, 2 bayt uzunlukla art arda)
  const PM = { on: false, dec: null, ctx: null, gain: null, next: 0, ts: 0, q: [] };
  function phoneStart() {
    phoneStop(); const c = audioCtx(); if (!c) return;
    PM.on = true; PM.ctx = c; PM.next = 0; PM.ts = 0; PM.q = [];
    PM.gain = c.createGain(); PM.gain.gain.value = isIOS ? 1 : base0(); PM.gain.connect(c.destination);
    if (window.AudioDecoder && window.EncodedAudioChunk) {
      try {
        PM.dec = new AudioDecoder({ output: (ad) => { try { const n = ad.numberOfFrames, arr = new Float32Array(n); ad.copyTo(arr, { planeIndex: 0, format: 'f32-planar' }); const b = c.createBuffer(1, n, ad.sampleRate); b.copyToChannel(arr, 0); ad.close(); phonePlay(b); } catch (e) {} }, error: () => {} });
        PM.dec.configure({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, description: new Uint8Array([0x12, 0x08]) });
      } catch (e) { PM.dec = null; }
    }
  }
  function phoneStop() { PM.on = false; try { PM.dec && PM.dec.close(); } catch (e) {} PM.dec = null; try { PM.gain && PM.gain.disconnect(); } catch (e) {} PM.gain = null; PM.q = []; }
  function phonePlay(b) {
    const c = PM.ctx; if (!c || !PM.on) return;
    const s = c.createBufferSource(); s.buffer = b; s.connect(PM.gain);
    let t = PM.next; if (t < c.currentTime + 0.02) t = c.currentTime + 0.35;   // kopma olursa 0,35 sn ön tampon
    s.start(t); PM.next = t + b.duration;
  }
  function adts(f) {
    const n = f.length + 7, h = new Uint8Array(7);
    h[0] = 0xFF; h[1] = 0xF1; h[2] = 0x50; h[3] = 0x40 | ((n >> 11) & 3); h[4] = (n >> 3) & 255; h[5] = ((n & 7) << 5) | 0x1F; h[6] = 0xFC;
    const o = new Uint8Array(n); o.set(h, 0); o.set(f, 7); return o;
  }
  function phonePacket(data) {
    if (!PM.on) return;
    let pos = 2; const frames = [];
    while (pos + 2 <= data.length) { const len = (data[pos] << 8) | data[pos + 1]; pos += 2; if (len <= 0 || pos + len > data.length) break; frames.push(data.slice(pos, pos + len)); pos += len; }
    if (PM.dec) {
      frames.forEach((f) => { try { PM.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: PM.ts, data: f })); PM.ts += 23220; } catch (e) {} });
      return;
    }
    // yedek yol (WebCodecs yoksa): ADTS'e sarıp parça parça çöz
    frames.forEach((f) => PM.q.push(adts(f)));
    if (PM.q.length >= 10) {
      const parts = PM.q.splice(0), tot = parts.reduce((a, p) => a + p.length, 0), buf = new Uint8Array(tot); let o = 0; parts.forEach((p) => { buf.set(p, o); o += p.length; });
      try { const pr = PM.ctx.decodeAudioData(buf.buffer, (b) => phonePlay(b), () => {}); if (pr && pr.catch) pr.catch(() => {}); } catch (e) {}
    }
  }

  // 1.4.23: "birbirimizi duyamıyoruz" önlemi: her 3 sn'de ses çalma / abonelik / eksik ses elemanı kontrolü
  setInterval(() => {
    const r = S.room; if (!r || r.state !== 'connected') return;
    try {
      if (!r.canPlaybackAudio) r.startAudio().catch(() => {});
      $$('audio.lk').forEach((a) => { if (a.paused) a.play().catch(() => {}); });
      r.remoteParticipants.forEach((p) => {
        const pubs = p.audioTrackPublications || p.audioTracks; if (!pubs) return;
        pubs.forEach((pub) => {
          if (!pub.isSubscribed) { if (pub.setSubscribed) pub.setSubscribed(true); return; }
          const t = pub.track; if (!t || pub.isMuted) return;
          if (!t.attachedElements || !t.attachedElements.length) {
            const el = t.attach(); el.classList.add('lk'); el.setAttribute('playsinline', ''); el.style.display = 'none';
            document.body.appendChild(el); try { applyVoiceVol(); } catch (e) {}
          }
        });
      });
    } catch (e) {}
  }, 3000);

  // ------------------------------------------------------------ radyo
  const player = new Audio();
  player.setAttribute('playsinline', '');
  player.preload = 'none';
  let stations = [], stIndex = -1, sharedRadio = null, stLoaded = false, radioWant = false;
  // 1.4.9: Android'deki gibi "Sadece ben / Odayla paylaş". Paylaşımdayken kim kanal değiştirirse odadaki herkeste değişir.
  let mShare = store.get('musicShare', true) !== false;
  function renderMShare() {
    const inRoom = !!S.room;
    $('#mShareRow').classList.toggle('hidden', !inRoom);
    $$('#mShareRow .sw').forEach((b) => b.classList.toggle('on', (b.dataset.ms === '1') === mShare));
    $('#mNote').textContent = !inRoom ? 'Seçtiğin kanal sadece sende çalar. Odaya girince radyoyu odayla paylaşabilirsin.'
      : mShare ? 'Odayla paylaş açık: seçtiğin kanal odadaki herkeste çalar; kim değiştirirse herkeste değişir. ■ herkeste durdurur.'
      : 'Sadece ben: seçtiğin kanal sadece sende çalar, kimseye gitmez.';
  }
  $$('#mShareRow .sw').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.ms === '1'; if (v === mShare) return;
    mShare = v; store.set('musicShare', v);
    if (S.room) {
      if (v && stIndex >= 0 && !sharedRadio && radioWant) shareStation(stIndex);         // bende çalanı odaya aç
      else if (!v && sharedRadio && sharedRadio.mine) {                                     // benim açtığımı odada kapat, bende çalsın
        publish({ t: 'music', a: 'stop' }); sharedRadio = null; $('#radioBar').classList.add('hidden');
        const st = stations[stIndex]; if (st) setNow(st.t, 'SADECE SENDE', st.c || 'RADYO', true);
      }
      toast(v ? '📡 Radyo odayla paylaşılıyor.' : '🎧 Radyo sadece sende çalar.');
    }
    renderMShare(); renderStations();
  }));
  function shareStation(i) {
    const s = stations[i]; if (!s) return;
    stIndex = i;
    sharedRadio = { url: s.u, title: s.t, by: S.name || '', mine: true };
    playUrl(s.u, () => toast('Kanal açılamadı, başka bir kanal dene.'));
    publish({ t: 'music', a: 'play', url: s.u, title: s.t, by: S.name || 'Bir sürücü' });
    $('#radioText').textContent = '♪ ' + s.t + ' · ORTAK';
    $('#radioBar').classList.remove('hidden');
    setNow(s.t, 'ODAYLA ORTAK', 'Sen açtın · odadaki herkes dinliyor', true);
    renderStations();
  }
  player.volume = store.get('vol', 80) / 100;
  $('#vol').value = Math.round(player.volume * 100);
  $('#vol').oninput = (e) => { store.set('vol', +e.target.value); duckTick(true); };
  // 1.4.10: Android'deki gibi "Biri konuşunca müziği kıs" + kısma seviyesi
  let duckOn = isIOS ? store.get('duckIosOn', false) === true : store.get('duckOn', true) !== false, duckLv = +store.get('duckLv', 20), lastTalkAt = 0;
  if (isIOS) { try { $('.duckbox .tg b').textContent = 'Biri konuşunca müziği sustur'; $('.duckbox .tg small').textContent = 'Kapalıyken müzik çalmaya devam eder (iPhone sesi kısmaya izin vermiyor).'; } catch (e) {} $('#volRow').classList.add('hidden'); $('#volIos').classList.remove('hidden'); $('#duckRow').classList.add('hidden'); $('#duckIos').classList.remove('hidden'); $('#duckIos').textContent = 'Açarsan biri konuşurken müzik tamamen susar, konuşma bitince geri gelir.'; }
  $('#duckOn').checked = duckOn; $('#duckLv').value = duckLv; $('#duckPct').textContent = '%' + duckLv;
  $('#duckRow').style.opacity = duckOn ? 1 : 0.4;
  $('#duckOn').onchange = (e) => { duckOn = e.target.checked; store.set(isIOS ? 'duckIosOn' : 'duckOn', duckOn); $('#duckRow').style.opacity = duckOn ? 1 : 0.4; duckTick(true); };
  $('#duckLv').oninput = (e) => { duckLv = +e.target.value; store.set('duckLv', duckLv); $('#duckPct').textContent = '%' + duckLv; duckTick(true); };
  function someoneTalking() {
    const r = S.room; if (!r) return false;
    let t = !!S.micOn && (currentMode() === 'ptt' || !!r.localParticipant.isSpeaking);   // 1.4.18: eller serbest/sürekli açıkta mikrofon hep açık: sadece GERÇEKTEN konuşunca say
    if (!t) r.remoteParticipants.forEach((p) => { if (p.isSpeaking) t = true; });
    return t;
  }
  function duckTick(now) {
    if (someoneTalking()) lastTalkAt = Date.now();
    const ducked = duckOn && S.room && Date.now() - lastTalkAt < 900;   // konuşma bitince kısa bir süre sonra geri açılır
    if (PM.gain) { try { PM.gain.gain.value = ducked ? (isIOS ? 0 : base0() * duckLv / 100) : (isIOS ? 1 : base0()); } catch (e) {} }
    if (isIOS) { player.muted = !!ducked; return; }   // iPhone'da ses seviyesi ayarlanamaz: konuşmada sus, sonra geri gel
    const base = (+store.get('vol', 80)) / 100;
    const target = ducked ? base * duckLv / 100 : base;
    const cur = player.volume;
    const nv = now ? target : (Math.abs(target - cur) < 0.06 ? target : cur + Math.sign(target - cur) * (target < cur ? 0.15 : 0.06));
    try { player.volume = Math.max(0, Math.min(1, nv)); } catch (e) {}
  }
  const base0 = () => (+store.get('vol', 80)) / 100;
  setInterval(() => { if (radioWant || player.muted || PM.on) duckTick(false); }, 150);
  // 1.4.18: iPhone mikrofon açılınca müziği durdurabiliyor: durduysa kendiliğinden devam ettir
  player.addEventListener('pause', () => { if (radioWant && !PM.on) setTimeout(() => { if (radioWant && !PM.on && player.paused && player.src) player.play().catch(() => {}); }, 350); });
  // Hazır kanallar (Android uygulamasındaki radyolar.m3u ile aynı) — sunucuya ulaşılamasa bile liste boş kalmasın
  const BUILTIN = [
    ['Alem FM', 'https://turkmedya.radyotvonline.com/turkmedya/alemfm.stream/playlist.m3u8', 'Pop'],
    ['Best FM', 'https://babaradyo.turkhosted.com/best/bestfm.stream/playlist.m3u8', 'Pop'],
    ['Kafa Radyo', 'https://moondigitalmaster.radyotvonline.net/kafaradyo/playlist.m3u8', 'Pop'],
    ["Radyoland 90'lar", 'https://moondigitaledge.radyotvonline.net/radyolanddoksanlar/playlist.m3u8', 'Nostalji'],
    ['A Haber Radyo', 'https://trkvz-radyolar.ercdn.net/ahaberradyo/playlist.m3u8', 'Haber'],
    ['A Spor Radyo', 'https://trkvz-radyolar.ercdn.net/asporradyo/playlist.m3u8', 'Spor'],
    ['Bloomberg HT Radyo', 'https://ciner-live.ercdn.net/bloombergradyo/bloombergradyo_1.m3u8', 'Ekonomi'],
    ['CNN Türk Radyo', 'https://cdn.duhnet.tv/S2/HLS_LIVE/cnnradyo/index.m3u8', 'Haber']
  ];
  function guessCat(name, tags) {
    const t = (String(name) + ' ' + String(tags || '')).toLocaleLowerCase('tr-TR');
    if (/arabesk|damar/.test(t)) return 'Arabesk';
    if (/haber|news/.test(t)) return 'Haber';
    if (/spor|sport/.test(t)) return 'Spor';
    if (/türkü|turku|halk|folk/.test(t)) return 'Türkü';
    if (/rock|metal/.test(t)) return 'Rock';
    if (/klasik|classical|sanat|tsm/.test(t)) return 'Türk Sanat';
    if (/dini|islam|kuran|religious/.test(t)) return 'Dini';
    if (/90|80|70|nostalji|oldies/.test(t)) return 'Nostalji';
    if (/jazz|caz|lounge|chill/.test(t)) return 'Caz';
    if (/pop|hit/.test(t)) return 'Pop';
    return 'Radyo';
  }
  async function fetchJson(url, ms) {
    const ctl = window.AbortController ? new AbortController() : null;
    const tm = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) {} }, ms || 9000);
    try { const r = await fetch(url, ctl ? { signal: ctl.signal } : {}); return await r.json(); }
    finally { clearTimeout(tm); }
  }
  async function loadStations(force) {
    if (stLoaded && !force) return;
    const cached = store.get('stations', []);
    if (cached.length && !stations.length) { stations = cached; renderStations(); }
    else if (!stations.length) $('#stations').innerHTML = '<div class="note">Kanallar yükleniyor…</div>';
    const out = [], seen = new Set();
    // iPhone ve tarayıcılar sadece güvenli (https) yayınları çalabilir
    const add = (t, u, c, l) => {
      u = String(u || '').trim(); t = String(t || '').trim();
      if (!t || !/^https:\/\//i.test(u)) return;
      const k = u.replace(/\/+$/, '').toLowerCase();
      if (seen.has(k)) return; seen.add(k);
      out.push({ t: t.substring(0, 50), u, c: c || guessCat(t, ''), l: /^https:\/\//i.test(l || '') ? l : '' });
    };
    // 1) Yöneticinin Radyolar listesi (sunucu)
    try {
      const j = await api({ action: 'radios', room: 'RADYO', identity: S.id });
      (j.radios || []).forEach((r) => add(r.t, r.u, r.c, r.l));
    } catch (e) {}
    // 2) Hazır kanallar
    BUILTIN.forEach((r) => add(r[0], r[1], r[2], ''));
    // İlk iki liste hemen görünsün; büyük dizin arkadan eklenir
    const apply = () => {
      if (!out.length) return;
      const cur = stIndex >= 0 && stations[stIndex] ? stations[stIndex].u : '';
      stations = out.slice(); stLoaded = true;
      store.set('stations', stations);
      stIndex = cur ? stations.findIndex((x) => x.u === cur) : -1;
      renderStations();
    };
    if (!cached.length) apply();
    // 3) Türkiye'nin en çok dinlenen radyoları (Android uygulamasındaki gibi radio-browser.info dizininden)
    for (const base of ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info']) {
      try {
        const arr = await fetchJson(base + '/json/stations/bycountrycodeexact/TR?order=votes&reverse=true&limit=200&hidebroken=true', 9000);
        if (Array.isArray(arr)) { arr.forEach((o) => add(o.name, o.url_resolved || o.url, guessCat(o.name, o.tags), o.favicon)); break; }
      } catch (e) {}
    }
    apply();
    if (!out.length) renderStations();
  }
  function renderStations() {
    $('#stations').innerHTML = stations.length ? stations.map((s, i) =>
      '<button class="sta raised' + (i === stIndex && radioWant ? ' on' : '') + '" data-i="' + i + '"><div class="lg">' + (s.l ? '<img src="' + esc(s.l) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '<span>' + esc(s.t.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9 ]/g, '').split(' ').map((w) => w[0] || '').join('').slice(0, 2).toLocaleUpperCase('tr-TR') || '♪') + '</span></div>' +
      '<div class="lcdbox"><div class="g">' + esc(s.t.toLocaleUpperCase('tr-TR')) + '</div><div class="gd">' + esc((i === stIndex && radioWant) ? (sharedRadio ? '▶ ODADA ÇALIYOR' : '▶ SENDE ÇALIYOR') : (s.c || 'RADYO').toLocaleUpperCase('tr-TR')) + '</div></div></button>').join('')
      : '<div class="note">Kanal listesi alınamadı. İnternet bağlantını kontrol et.</div><button class="mbtn raised" id="stRetry">Tekrar dene</button>';
    const rt = $('#stRetry'); if (rt) rt.onclick = () => loadStations(true);
    $$('#stations .sta').forEach((el) => el.addEventListener('click', () => playStation(+el.dataset.i)));
  }
  // .m3u8 yayınları: iPhone kendisi çalar; Android Chrome gibi tarayıcılarda hls.js ile çalınır (gerekince yüklenir)
  let hls = null, hlsLoading = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsLoading) hlsLoading = new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'lib/hls.light.min.js'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
    return hlsLoading;
  }
  async function playUrl(url, onFail) {
    radioWant = true;
    try { if (hls) { hls.destroy(); hls = null; } } catch (e) {}
    const isHls = /\.m3u8(\?|$)/i.test(url);
    if (isHls && !player.canPlayType('application/vnd.apple.mpegurl')) {
      try {
        await loadHls();
        if (window.Hls && window.Hls.isSupported()) {
          hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
          hls.loadSource(url); hls.attachMedia(player);
          hls.on(window.Hls.Events.ERROR, (ev, d) => { if (d && d.fatal && onFail) onFail(); });
          player.play().catch(() => onFail && onFail());
          return;
        }
      } catch (e) {}
    }
    player.src = url;
    player.play().catch(() => onFail && onFail());
  }
  function playStation(i) {
    const s = stations[i]; if (!s) return;
    if (S.room && mShare) { shareStation(i); return; }
    if (sharedRadio && sharedRadio.mine && S.room) publish({ t: 'music', a: 'stop' });   // odaya ben açtıysam herkeste kapansın
    sharedRadio = null; $('#radioBar').classList.add('hidden');
    stIndex = i; playUrl(s.u, () => toast('Kanal açılamadı, başka bir kanal dene.'));
    setNow(s.t, 'SADECE SENDE', s.c || 'RADYO', true);
    renderStations();
  }
  function stopRadio(silent) {
    // 1.4.9: odada ortak radyo çalarken ■ herkeste durdurur (Android ile aynı)
    if (!silent && sharedRadio && S.room) publish({ t: 'music', a: 'stop' });
    radioWant = false; phoneStop();
    try { if (hls) { hls.destroy(); hls = null; } } catch (e) {}
    player.pause(); player.removeAttribute('src'); try { player.load(); } catch (e) {}
    sharedRadio = null; $('#radioBar').classList.add('hidden');
    setNow('KAPALI', 'RADYO', 'Listeden bir kanal seç', false);
    renderStations();
    if (!silent) toast('Radyo kapatıldı.');
  }
  function setNow(title, tag, sub, on) {
    $('#nowTitle').textContent = String(title).toLocaleUpperCase('tr-TR'); $('#nowTag').textContent = tag; $('#nowSub').textContent = sub;
    $('#mPlay').innerHTML = on ? IC_STOP : IC_PLAY; radioLcd(title, tag, sub, on);
    $('#vu').classList.toggle('on', on);
    fit($('#nowTitle'), 24, 14);
  }
  $('#lrPlay').onclick = () => $('#mPlay').click(); $('#lrNext').onclick = () => $('#mNext').click(); $('#lrPrev').onclick = () => $('#mPrev').click(); $('#lrTap').onclick = () => go('music');
  $('#lAdmin').onclick = () => $('#adminBtn').click(); $('#lShare').onclick = () => $('#shareBtn').click();
  $('#mPlay').onclick = () => { if (!player.paused && player.src) stopRadio(); else if (stIndex >= 0) playStation(stIndex); else if (stations.length) playStation(0); };
  $('#mNext').onclick = () => { if (stations.length) playStation((stIndex + 1) % stations.length); };
  $('#mPrev').onclick = () => { if (stations.length) playStation((stIndex - 1 + stations.length) % stations.length); };
  $('#radioStop').onclick = () => stopRadio();
  function onMusic(j) {
    if (j.a === 'play' && j.url) {
      // "Sadece ben" modunda kendi kanalım çalıyorsa odanınki onu bozmaz
      if (!mShare && !sharedRadio && radioWant && !player.paused) { toast('🎵 Odada "' + (j.title || 'radyo') + '" açıldı. Dinlemek için Müzik > Odayla paylaş.'); return; }
      sharedRadio = { url: j.url, title: j.title || 'Radyo', by: j.by || '' };
      if (j.url === 'phone://') {   // 1.4.18: Android'de "telefondan müzik paylaş": ses paketlerini çözüp çal
        try { if (hls) { hls.destroy(); hls = null; } player.pause(); } catch (e) {}
        radioWant = true; stIndex = -1; phoneStart(); renderStations();
        $('#radioText').textContent = '♪ ' + sharedRadio.title + ' · ORTAK';
        setNow(sharedRadio.title, 'ODAYLA ORTAK', sharedRadio.by ? sharedRadio.by + ' telefonundan paylaştı' : 'Telefondan müzik', true);
        toast('♪ ' + (sharedRadio.by || 'Biri') + ' telefonundan müzik paylaştı.'); return;
      }
      phoneStop();
      stIndex = stations.findIndex((x) => x.u === j.url); playUrl(j.url, null); renderStations();
      $('#radioText').textContent = '♪ ' + sharedRadio.title + ' · ORTAK';
      $('#radioBar').classList.remove('hidden');
      setNow(sharedRadio.title, 'ODAYLA ORTAK', sharedRadio.by ? sharedRadio.by + ' paylaştı' : 'Odada çalıyor', true);
      toast('♪ Odada ' + sharedRadio.title + ' çalıyor.');
    } else if (sharedRadio) { stopRadio(true); toast('Ortak radyo kapandı.'); }
  }
  // VU göstergesi (çalarken hareket eder)
  $('#vu').innerHTML = Array.from({ length: 24 }, () => '<i></i>').join('');
  setInterval(() => {
    // 1.4.9: iPhone'da mikrofon açıkken Safari müziği kısar: çubuklar dursun, neden olduğu yazsın; bırakınca müzik geri gelsin
    if (page !== 'music') return;   // 1.4.11: müzik sayfası açık değilken boşuna çalışmasın
    const iosTalk = isIOS && S.micOn && radioWant;
    $('#vuHint').classList.toggle('hidden', !iosTalk);
    if (isIOS && !S.micOn && radioWant && player.src && player.paused && Date.now() - (window.__rpT || 0) > 3000) { window.__rpT = Date.now(); player.play().catch(() => {}); }
    if (player.paused || !player.src || iosTalk || player.muted) { if (iosTalk || player.muted) $$('#vu i').forEach((b) => { b.style.height = '3px'; }); return; }
    $$('#vu i').forEach((b) => { b.style.height = (4 + Math.random() * 24) + 'px'; });
  }, 140);

  // ------------------------------------------------------------ üst çubuk
  function updateTop() {
    const inRoom = !!S.room;
    const j = $('#joinBtn');
    j.classList.toggle('red', inRoom);
    $('#joinText').textContent = inRoom ? 'ODADAN AYRIL' : 'ODAYA KATIL';
    $('#joinIcon').textContent = inRoom ? '⮐' : '⮕';
  }

  // ------------------------------------------------------------ ayarlar
  $('#nameInput').value = S.name;
  // 1.4.8: profil fotoğrafı (64×64 JPEG, en fazla 3000 karakter; Android ile aynı)
  function renderMyAv() { $('#myAv').style.background = colorOf(S.id); $('#myAv').innerHTML = avIn(S.id, S.name || '?'); $('#avDel').classList.toggle('hidden', !store.get('avatar', '')); }
  renderMyAv();
  $('#avPick').onclick = () => $('#avFile').click();
  $('#avDel').onclick = () => { store.set('avatar', ''); renderMyAv(); renderHome(); toast('Profil fotoğrafı kaldırıldı.'); };
  $('#avFile').onchange = () => {
    const f = $('#avFile').files && $('#avFile').files[0]; $('#avFile').value = '';
    if (!f) return;
    const img = new Image(); const u = URL.createObjectURL(f);
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const k = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, 0, 0, 64, 64);
        let b = '';
        for (let q = 0.8; q >= 0.25; q -= 0.1) { b = c.toDataURL('image/jpeg', q).split(',')[1] || ''; if (b.length <= 3000) break; }
        if (!b || b.length > 3000) { toast('Bu fotoğraf kullanılamadı, başka bir tane dene.'); return; }
        store.set('avatar', b); renderMyAv(); try { renderRoom(); renderMapRiders(); } catch (e) {}
        toast(S.room ? 'Kaydedildi. Odadakiler bir sonraki girişte görür.' : 'Profil fotoğrafı kaydedildi.');
      } catch (e) { toast('Fotoğraf okunamadı.'); } finally { URL.revokeObjectURL(u); }
    };
    img.onerror = () => { URL.revokeObjectURL(u); toast('Fotoğraf okunamadı.'); };
    img.src = u;
  };
  $('#saveName').onclick = () => {
    const v = $('#nameInput').value.trim();
    if (v.length < 2) { toast('Adın en az 2 harf olmalı.'); return; }
    S.name = v; store.set('name', v); renderHome();
    toast(S.room ? 'Kaydedildi. Yeni adın odaya bir sonraki girişte görünür.' : 'Kaydedildi.');
  };
  [['optNoise', 'noise'], ['optEcho', 'echo'], ['optAgc', 'agc'], ['optWake', 'wake'], ['optSpeak', 'speak']].forEach(([el, k]) => {
    const c = $('#' + el); c.checked = !!opt[k];
    c.onchange = () => {
      opt[k] = c.checked; store.set(k, c.checked);
      if (k === 'wake') keepAwake(!!S.room && c.checked);
      if (['noise', 'echo', 'agc'].includes(k) && S.room) toast('Ses filtresi bir sonraki oda girişinde uygulanır.');
    };
  });
  // 1.4.7: Hafif mod (otomatik / açık / kapalı)
  (function () {
    const c = $('#optLite'); if (!c) return;
    c.checked = store.get('lite', null) === null ? autoLite() : !!store.get('lite', false);
    $('#liteAuto').textContent = store.get('lite', null) === null ? '(otomatik: ' + (autoLite() ? 'açık' : 'kapalı') + ')' : '';
    c.onchange = () => { store.set('lite', c.checked); applyLite(); $('#liteAuto').textContent = ''; toast(c.checked ? 'Hafif mod açıldı.' : 'Hafif mod kapandı.'); };
  })();
  const APP_VER = 'web '+'1.4.23'; $('#ver').textContent = APP_VER; $('#verBig').textContent = APP_VER;
  setTimeout(() => { try { $('#verFit').textContent = window.__fitInfo || ''; } catch (e) {} }, 1500);   // 1.4.13: ekran ölçüsü (sorun olursa ekran görüntüsünden bakılır)
  $('#privacyBtn').onclick = () => window.open(CFG.SERVER + '?page=gizlilik', '_blank');
  $('#wipeBtn').onclick = () => {
    sheet('<h3>Bu telefondaki bilgilerin silinsin mi?</h3><p>Adın, kayıtlı odaların ve ayarların bu tarayıcıdan silinir.</p><button class="mbtn danger" id="wy">🗑 Hepsini sil</button><button class="mbtn raised" id="wn">Vazgeç</button>',
      (b) => { b.querySelector('#wn').onclick = closeSheet; b.querySelector('#wy').onclick = async () => { closeSheet(); await leaveRoom(true); store.clear(); location.reload(); }; });
  };

  // ------------------------------------------------------------ arkadaşlarım (Android ile aynı kodlar)
  // Arkadaş kodu kimlikten çıkar (U + ilk 10 harf/rakam). Liste bu tarayıcıda saklanır.
  // İkili arama: iki kişiye özel oda (P-…), davet sunucunun posta kutusuyla gider; web açıkken 20 sn'de bir bakılır.
  function friendCode(identity) { return 'U' + String(identity || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); }
  const MY_CODE = friendCode(S.id);
  function prettyCode(c) { return 'U' + c.slice(1).match(/.{1,4}/g).join('-'); }
  function cleanCode(t) { let c = String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!c.startsWith('U')) c = 'U' + c; return c.length >= 7 && c.length <= 21 ? c : null; }
  function friends() { return store.get('friends', []) || []; }
  function isFriend(code) { return friends().some((f) => f.code === code); }
  function saveFriends(l) { store.set('friends', l); renderFriends(); }
  function addFriend(name, code) {
    const c = cleanCode(code);
    if (!c) return 'Kod hatalı. Arkadaşının "Arkadaş kodum"unu yaz.';
    if (c === MY_CODE) return 'Bu senin kendi kodun.';
    saveFriends(friends().filter((f) => f.code !== c).concat([{ code: c, name: String(name || '').trim().slice(0, 24) || 'Arkadaş' }]));
    store.set('callers', (store.get('callers', []) || []).filter((x) => x.code !== c));
    api({ action: 'direct', room: 'PUSH', identity: S.id, name: S.name || 'Bir sürücü', targets: [c], data: { type: 'friendreq' } }).catch(() => {});
    return null;
  }
  function addFriendFromRoom(id, name) {
    const e = addFriend(name, friendCode(id));
    toast(e || ('👤 ' + name + ' arkadaşlarına eklendi. Ana sayfa > Arkadaş bölümünden arayabilirsin.'), 5000);
  }
  async function pairRoom(a, b) {
    const key = [a, b].sort().join('|');
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
    return 'P-' + Array.from(d.slice(0, 5)).map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
  }
  async function callFriend(f) {
    try {
      const room = await pairRoom(MY_CODE, f.code);
      toast('📞 ' + f.name + ' aranıyor… Açınca konuşmaya başlarsınız.', 6000);
      api({ action: 'direct', room: 'PUSH', identity: S.id, name: S.name || 'Bir sürücü', targets: [f.code], data: { type: 'call', room } })
        .catch(() => toast('Arama daveti gönderilemedi (internet?)'));
      if (S.room && S.code !== room) await leaveRoom(true);
      if (!S.room) joinRoom(room, '');
    } catch (e) { toast('Arama başlatılamadı: ' + e.message); }
  }
  function renderFriends() {
    const box = $('#friends'); if (!box) return;
    const l = friends(), callers = (store.get('callers', []) || []).filter((c) => !isFriend(c.code)), seen = store.get('lastSeen', {}) || {};
    $('#myCode').textContent = prettyCode(MY_CODE);
    box.innerHTML = callers.map((c, i) => '<div class="row raised"><div class="av" style="background:#ffd23c">' + esc(initial(c.name)) + '</div><div class="tx"><b>' + esc(c.name) + '</b><small>' + esc(c.note || '') + '</small></div>' +
        '<button class="x" data-cadd="' + i + '" aria-label="Kaydet" style="color:var(--green)">＋</button><button class="x" data-cdel="' + i + '" aria-label="Kapat">✕</button></div>').join('') +
      (l.length ? l.map((f, i) => {
        const ls = seen[f.code];
        const sub = prettyCode(f.code) + (ls ? ' · 📍 ' + new Date(ls.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
        return '<div class="row raised" data-f="' + i + '"><div class="av" style="background:' + colorOf(f.code) + '">' + esc(initial(f.name)) + '</div><div class="tx"><b>' + esc(f.name) + '</b><small>' + sub + '</small></div>' +
          '<button class="x" data-call="' + i + '" aria-label="Ara" style="color:var(--green);font-size:20px">📞</button></div>';
      }).join('') : '<div class="note" style="margin:0 2px">Henüz arkadaş yok. Odada birinin adına dokunup "Arkadaş olarak ekle" de ya da kodunu yaz.</div>');
    box.querySelectorAll('[data-cadd]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const c = callers[+b.dataset.cadd]; const er = addFriend(c.name, c.code); toast(er || (c.name + ' arkadaşlarına eklendi.')); });
    box.querySelectorAll('[data-cdel]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const c = callers[+b.dataset.cdel]; store.set('callers', (store.get('callers', []) || []).filter((x) => x.code !== c.code)); renderFriends(); });
    box.querySelectorAll('[data-call]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); callFriend(l[+b.dataset.call]); });
    box.querySelectorAll('[data-f]').forEach((row) => row.onclick = () => friendMenu(l[+row.dataset.f]));
  }
  function friendMenu(f) {
    const ls = (store.get('lastSeen', {}) || {})[f.code];
    sheet('<h3>' + esc(f.name) + '</h3><p>Kodu: ' + prettyCode(f.code) + '</p>' +
      '<button class="mbtn amber" id="fmCall">📞 Ara</button>' +
      (ls ? '<button class="mbtn raised" id="fmLoc">📍 Son görülen konum (' + new Date(ls.at).toLocaleString('tr-TR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) + ')</button>' : '') +
      '<button class="mbtn danger" id="fmDel">🗑 Arkadaşlarımdan çıkar</button><button class="mbtn raised" id="fmNo">Kapat</button>', (b) => {
      b.querySelector('#fmNo').onclick = closeSheet;
      b.querySelector('#fmCall').onclick = () => { closeSheet(); callFriend(f); };
      const lb = b.querySelector('#fmLoc'); if (lb) lb.onclick = () => window.open('https://maps.apple.com/?ll=' + ls.lat + ',' + ls.lon + '&q=' + encodeURIComponent(f.name), '_blank');
      b.querySelector('#fmDel').onclick = () => { closeSheet(); saveFriends(friends().filter((x) => x.code !== f.code)); };
    });
  }
  $('#addFriendBtn').onclick = () => {
    sheet('<h3>＋ Arkadaş ekle</h3><p>Arkadaşının uygulamada "Arkadaş kodum" yazan kodunu gir. Odadaysanız adına dokunup "Arkadaş olarak ekle" de diyebilirsin.</p>' +
      '<input id="afName" class="input inset" maxlength="24" placeholder="Adı"><input id="afCode" class="input inset" maxlength="30" placeholder="Kodu (U…)" autocapitalize="characters" autocomplete="off">' +
      '<div class="small" id="afErr" style="color:#ff6b6b"></div><button class="mbtn amber" id="afOk">Ekle</button><button class="mbtn raised" id="afInv">✉️ MotoLink\'e davet et (SMS / WhatsApp)</button><button class="mbtn raised" id="afNo">Vazgeç</button>', (b) => {
      b.querySelector('#afNo').onclick = closeSheet;
      b.querySelector('#afInv').onclick = () => shareAppInvite();
      b.querySelector('#afOk').onclick = () => {
        const er = addFriend(b.querySelector('#afName').value, b.querySelector('#afCode').value);
        if (er) b.querySelector('#afErr').textContent = er; else { closeSheet(); toast('Arkadaş eklendi.'); }
      };
    });
  };
  $('#myCodeBtn').onclick = () => {
    let img = '';
    try { const q = qrcode(0, 'M'); q.addData('motolink://friend?c=' + MY_CODE + '&n=' + encodeURIComponent(S.name || 'Sürücü')); q.make(); img = q.createDataURL(6, 2); } catch (e) {}
    sheet('<h3>Arkadaş kodum</h3><p>Arkadaşın Android uygulamasında QR\'ı okutsun ya da kodu yazsın.</p>' +
      (img ? '<div class="qrbox"><img src="' + img + '" alt="QR"></div>' : '') + '<div class="codebig">' + prettyCode(MY_CODE) + '</div>' +
      '<button class="mbtn amber" id="mcShare">Paylaş</button><button class="mbtn raised" id="mcNo">Kapat</button>', (b) => {
      b.querySelector('#mcNo').onclick = closeSheet;
      b.querySelector('#mcShare').onclick = async () => {
        const text = appInviteText();
        try { if (navigator.share) { await navigator.share({ title: 'MotoLink', text }); return; } } catch (e) { return; }
        try { await navigator.clipboard.writeText(text); toast('Kod kopyalandı.'); } catch (e) { toast(text, 8000); }
      };
    });
  };
  // Gelenler: arama daveti, "seni ekledi", son görülen konum
  let evSince = 0, evBusy = false;
  async function pollDirect() {
    if (evBusy || document.visibilityState !== 'visible') return;
    evBusy = true;
    try {
      // 1.1.8: kayıtlı odalarımın olayları da (biri odaya girdi / herkesi çağırdı)
      const myRooms = (store.get('rooms', []) || []).map((r) => r.code).slice(0, 25);
      const j = await api({ action: 'events', room: 'PUSH', identity: S.id, rooms: [MY_CODE].concat(myRooms), since: evSince });
      const first = !evSince;
      evSince = j.now || Date.now();
      if (!first) (j.events || []).forEach(onDirectEvent);
    } catch (e) {}
    evBusy = false;
  }
  const seenEv = new Set();
  function onDirectEvent(ev) {
    const key = ev.type + '|' + ev.by + '|' + (ev.t || ev.at || '');
    if (seenEv.has(key)) return; seenEv.add(key);
    const code = friendCode(ev.by), f = friends().find((x) => x.code === code), name = (f && f.name) || ev.name || 'Bir sürücü';
    const noteCaller = (note) => { if (f) return; const l = (store.get('callers', []) || []).filter((x) => x.code !== code); l.unshift({ code, name, note }); store.set('callers', l.slice(0, 10)); renderFriends(); };
    if (ev.type === 'call' && ev.room) {
      if (S.room && S.code === ev.room) return;
      noteCaller('📞 Seni aradı');
      try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) {}
      sheet('<h3>📞 ' + esc(name) + ' seni arıyor</h3><p>Kabul edersen ikinize özel odaya girersin.</p><button class="mbtn amber" id="clOk">CEVAPLA</button><button class="mbtn raised" id="clNo">Reddet</button>', (b) => {
        b.querySelector('#clNo').onclick = closeSheet;
        b.querySelector('#clOk').onclick = async () => { closeSheet(); if (S.room) await leaveRoom(true); joinRoom(ev.room, ''); };
      });
    } else if (ev.type === 'join' && ev.room) {
      // 1.1.8: kayıtlı odama biri girdi ya da herkesi odaya çağırdı
      if (S.room && S.code === ev.room) return;
      const saved = (store.get('rooms', []) || []).find((r) => r.code === ev.room);
      if (!saved) return;
      const rn = ev.title || saved.name || ev.room, who = ev.name || 'Bir sürücü';
      const summon = ev.summon === '1';
      const title = summon ? '📣 ' + who + ' herkesi odaya çağırıyor' : '🏍 ' + who + ' odaya girdi';
      try { if (navigator.vibrate) navigator.vibrate(summon ? [300, 150, 300, 150, 300] : [200]); } catch (e) {}
      try {
        if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
          navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body: rn + ' · Katılmak için dokun', tag: 'join-' + ev.room, icon: 'img/icon-192.png' })).catch(() => {});
        }
      } catch (e) {}
      const inOther = !!S.room;
      sheet('<h3>' + esc(title) + '</h3><p>' + esc(rn) + (inOther ? ' · şu an başka odadasın' : '') + '</p>' +
        '<button class="mbtn amber" id="jnOk">' + (inOther ? 'ODAYA GEÇ' : 'ODAYA GİR') + '</button>' +
        (('Notification' in window && Notification.permission === 'default') ? '<button class="mbtn raised" id="jnPerm">🔔 Bildirimlere izin ver</button>' : '') +
        '<button class="mbtn raised" id="jnNo">Kapat</button>', (b) => {
        b.querySelector('#jnNo').onclick = closeSheet;
        const pb = b.querySelector('#jnPerm'); if (pb) pb.onclick = () => { try { Notification.requestPermission(); } catch (e) {} };
        b.querySelector('#jnOk').onclick = async () => { closeSheet(); if (S.room) await leaveRoom(true); joinRoom(ev.room, saved.pw || ''); };
      });
    } else if (ev.type === 'friendreq') {
      noteCaller('👋 Seni arkadaş olarak ekledi');
      if (!f) toast('👋 ' + name + ' seni arkadaş olarak ekledi. Ana sayfadan sen de ekle.', 6000);
    } else if (ev.type === 'lastloc' && ev.lat && ev.lon) {
      const seen = store.get('lastSeen', {}) || {};
      seen[code] = { lat: +ev.lat, lon: +ev.lon, at: +ev.at || Date.now() };
      store.set('lastSeen', seen); renderFriends();
      toast('📍 ' + name + ' son konumunu paylaştı.');
    }
  }
  renderFriends();
  pollDirect();
  setInterval(pollDirect, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollDirect(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollDirect(); });

  // ------------------------------------------------------------ odada fotoğraf (Android 0.9.55 ile aynı)
  // Fotoğraf küçültülüp veri kanalından parça parça gider; sunucuda saklanmaz, odadan çıkınca silinir.
  const PH = { list: [], pend: {}, sending: null };
  function clearPhotos() { PH.list.forEach((p) => URL.revokeObjectURL(p.url)); PH.list = []; PH.pend = {}; renderPhotos(); $('#pcard').classList.add('hidden'); }
  function photoBlocked(id) { return (store.get('photoBlocked', []) || []).includes(id); }
  // Küçük resimler ekranda sürekli durmaz: sadece gönderim çubuğu ve "Fotoğraflar (n)" düğmesi
  function renderPhotos() {
    const g = $('#galleryBtn'); if (g) g.textContent = '🖼 Fotoğraflar (' + PH.list.length + ')';
    const el = $('#chatSending');
    if (PH.sending == null) { el.classList.add('hidden'); el.innerHTML = ''; try { chRender(); } catch (e) {} return; }
    el.classList.remove('hidden');
    el.innerHTML = '📷 Fotoğraf gönderiliyor… %' + Math.round(PH.sending * 100) + '<div class="bar"><i style="width:' + Math.round(PH.sending * 100) + '%"></i></div>';
  }
  function openGallery() {
    if (!PH.list.length) { toast('Bu odada henüz fotoğraf paylaşılmadı.'); return; }
    sheet('<h3>🖼 Odadaki fotoğraflar (' + PH.list.length + ')</h3><p>Odadan çıkınca silinir. Saklamak istediğini açıp "Kaydet"e bas.</p><div class="pgrid">' +
      PH.list.map((p, i) => '<img src="' + p.url + '" data-i="' + i + '" alt="Fotoğraf">').join('') + '</div><button class="mbtn raised" id="pgClose">Kapat</button>', (b) => {
      b.querySelector('#pgClose').onclick = closeSheet;
      b.querySelectorAll('.pgrid img').forEach((im) => im.onclick = () => viewPhoto(PH.list[+im.dataset.i]));
    });
  }
  $('#galleryBtn').onclick = openGallery;
  function onPhotoChunk(j, id, name) {
    const n = j.n | 0, i = j.i | 0;
    if (!j.id || n < 1 || n > 80 || i < 0 || i >= n || photoBlocked(id)) return;
    const now = Date.now();
    Object.keys(PH.pend).forEach((k) => { if (now - PH.pend[k].at > 120000) delete PH.pend[k]; });
    let p = PH.pend[j.id];
    if (!p) p = PH.pend[j.id] = { n, from: id, name, at: now, parts: new Array(n), got: 0 };
    if (p.n !== n || p.from !== id) return;
    if (p.parts[i] == null) { p.parts[i] = String(j.d || ''); p.got++; }
    if (p.got < p.n) return;
    delete PH.pend[j.id];
    try {
      const bin = atob(p.parts.join(''));
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      if (!(bytes[0] === 0xFF && bytes[1] === 0xD8)) return;   // JPEG değilse gösterme
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      const photo = { id: j.id, from: id, name, url, time: Date.now(), mine: false };
      addPhoto(photo);
      // 1.4.0: fotoğraf sohbete düşer; sohbet açık değilse turuncu şerit + okunmamış sayısı
      if (!(CH.open && !CH.to)) { CH.unreadAll++; chBadge(); chBanner(id, name, '📷 Fotoğraf gönderdi', false); }
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) {}
    } catch (e) {}
  }
  function addPhoto(p) {
    PH.list = [p].concat(PH.list.filter((x) => x.id !== p.id));
    while (PH.list.length > 30) URL.revokeObjectURL(PH.list.pop().url);
    renderPhotos();
  }
  function viewPhoto(p) {
    if (!p) return;
    const t = new Date(p.time).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    sheet('<h3>' + (p.mine ? 'Senin fotoğrafın' : esc(p.name)) + ' · ' + t + '</h3><img class="pview" src="' + p.url + '" alt="Fotoğraf">' +
      '<a class="mbtn amber" id="pvSave" href="' + p.url + '" download="MotoLink_' + p.time + '.jpg" style="text-decoration:none">💾 Kaydet</a>' +
      (p.mine ? '' : '<button class="mbtn raised" id="pvRep">⚠ Bildir</button><button class="mbtn danger" id="pvBlock">⛔ Engelle</button>') +
      '<button class="mbtn raised" id="pvClose">Kapat</button>', (b) => {
      b.querySelector('#pvClose').onclick = closeSheet;
      const rep = b.querySelector('#pvRep'), blk = b.querySelector('#pvBlock');
      if (rep) rep.onclick = async () => {
        try { await api({ action: 'report', room: S.code || 'PUSH', identity: S.id, target: p.from, targetName: p.name, kind: 'foto', reason: 'uygunsuz fotoğraf' }); toast('Bildirimin alındı, teşekkürler.'); }
        catch (e) { toast('Bildirim gönderilemedi: ' + e.message); }
      };
      if (blk) blk.onclick = () => {
        const l = store.get('photoBlocked', []) || []; if (!l.includes(p.from)) l.push(p.from); store.set('photoBlocked', l);
        PH.list.filter((x) => x.from === p.from).forEach((x) => URL.revokeObjectURL(x.url));
        PH.list = PH.list.filter((x) => x.from !== p.from); renderPhotos(); closeSheet();
        toast(p.name + ' engellendi; fotoğrafları artık gösterilmeyecek.');
      };
    });
  }
  $('#chatPhoto').onclick = () => $('#photoBtn').click();
  $('#photoBtn').onclick = () => {
    if (!S.room) { toast('Fotoğraf göndermek için odada olmalısın.'); return; }
    if (PH.sending != null) { toast('Bir önceki fotoğraf hâlâ gönderiliyor.'); return; }
    $('#photoIn').value = ''; $('#photoIn').click();
  };
  $('#photoIn').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f || !S.room) return;
    try {
      const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = URL.createObjectURL(f); });
      const big = Math.max(img.naturalWidth, img.naturalHeight), k = big > 1280 ? 1280 / big : 1;
      const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      let q = 0.78, blob;
      do { blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', q)); q -= 0.12; } while (blob && blob.size > 420000 && q > 0.4);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let k2 = 0; k2 < bytes.length; k2 += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(k2, k2 + 8192));
      const b64 = btoa(bin), CH = 12000, n = Math.ceil(b64.length / CH);
      const id = S.id.slice(0, 6) + '-' + Date.now().toString(36);
      PH.sending = 0; renderPhotos();
      for (let i = 0; i < n; i++) {
        if (!S.room) throw new Error('Odadan çıkıldı.');
        publish({ t: 'img', id, i, n, d: b64.slice(i * CH, (i + 1) * CH) });
        PH.sending = (i + 1) / n; renderPhotos();
        await new Promise((r) => setTimeout(r, 40));
      }
      addPhoto({ id, from: S.id, name: S.name || 'Ben', url: URL.createObjectURL(blob), time: Date.now(), mine: true });
      toast('📷 Fotoğraf gönderildi.');
    } catch (err) { toast('Fotoğraf gönderilemedi: ' + (err && err.message || 'hata')); }
    PH.sending = null; renderPhotos();
  };

  // ------------------------------------------------------------ hesap ve yedek (sunucu 0.9.42)
  // Kimliği geri getirme: Google ile bağlan ya da "ML-" kimlik kodu. Oda listesi şifresiz yedeklenir.
  let backupT = null;
  function roomsForBackup() { return store.get('rooms', []).slice(0, 30).map((r) => ({ code: r.code, name: r.name || r.code, locked: !!r.locked, permanent: !!r.permanent, mine: !!r.mine })); }
  function backupSoon() {
    clearTimeout(backupT);
    backupT = setTimeout(() => { api({ action: 'backup', room: 'PUSH', identity: S.id, rooms: roomsForBackup() }).catch(() => {}); }, 4000);
  }
  function parseIdCode(raw) {
    let t = String(raw || '').trim();
    const q = t.indexOf('c=');
    if (/^motolink/i.test(t) && q >= 0) t = t.slice(q + 2);
    t = t.replace(/\s+/g, '');
    if (/^ML-/i.test(t)) t = t.slice(3);
    return /^[A-Za-z0-9-]{8,64}$/.test(t) ? t : null;
  }
  function switchIdentity(id, rooms, email) {
    const have = store.get('rooms', []);
    (rooms || []).forEach((r) => { if (!have.some((h) => h.code === r.code)) have.push({ code: r.code, name: r.name || r.code, locked: !!r.locked, permanent: !!r.permanent, mine: !!r.mine, pw: '' }); });
    store.set('rooms', have.slice(0, 30));
    store.set('id', id);
    store.set('gmail', email || '');
    store.set('lastRoom', null);
  }
  async function afterSwitch(msg) {
    try { await leaveRoom(true); } catch (e) {}
    sheet('<h3>✅ Kimliğin geri geldi</h3><p>' + esc(msg) + '</p><button class="mbtn amber" id="swOk">Tamam</button>', (b) => { b.querySelector('#swOk').onclick = () => location.reload(); });
  }
  // 1.1.7: "Google ile bağlan" kaldırıldı; kimlik kodu ile yedek / geri yükleme kalır
  // 1.4.23: "Google ile bağlan" geri geldi (Google Identity Services; sunucu Google'a sorarak doğrular, şifre tutulmaz)
  function renderAccount() {
    const box = $('#accBox'); if (!box) return;
    const gm = store.get('gmail', '');
    box.innerHTML = (gm ? '<div class="small" style="color:var(--green);margin:0 2px 6px">✓ Google hesabı bağlı: ' + esc(gm) + '</div>' : '') +
      '<button class="mbtn amber" id="accGoogle">G&nbsp; ' + (gm ? 'Google hesabını yenile' : 'Google ile bağlan / geri getir') + '</button>' +
      (gm ? '<button class="mbtn raised" id="accGUnlink">Google bağlantısını kaldır</button>' : '');
    $('#accGoogle').onclick = googleSignIn;
    const ub = $('#accGUnlink');
    if (ub) ub.onclick = async () => {
      try { await api({ action: 'unlink', room: 'PUSH', identity: S.id }); store.set('gmail', ''); renderAccount(); toast('Google bağlantısı kaldırıldı.'); }
      catch (e) { toast(e.message || 'Kaldırılamadı (internet?)', 5000); }
    };
  }
  function loadGsi() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.id) return res();
      const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
      sc.onload = () => res(); sc.onerror = () => rej(new Error('Google yüklenemedi (internet?)'));
      document.head.appendChild(sc);
    });
  }
  async function googleSignIn() {
    let cid = '';
    try {
      busy(true, 'Google hazırlanıyor…');
      const cfg = await api({ action: 'config', room: 'PUSH', identity: S.id });
      cid = String(cfg.googleClientId || '');
      await loadGsi();
    } catch (e) { busy(false); toast(e.message || 'Google girişi hazırlanamadı.', 6000); return; }
    busy(false);
    if (!cid) { toast('Sunucuda Google girişi ayarlı değil.', 6000); return; }
    sheet('<h3>G Google ile bağlan</h3><p>Aynı Gmail ile bağlanınca, tarayıcıyı ya da telefonu değiştirsen bile odaların ve kimliğin geri gelir.</p>' +
      '<div id="gBtn" style="display:flex;justify-content:center;margin:10px 0;min-height:44px"></div><div class="small" id="gErr" style="color:#ff6b6b"></div>' +
      '<button class="mbtn raised" id="gNo">Vazgeç</button>', (b) => {
      b.querySelector('#gNo').onclick = closeSheet;
      try {
        google.accounts.id.initialize({
          client_id: cid,
          callback: async (resp) => {
            if (!resp || !resp.credential) return;
            closeSheet(); busy(true, 'Google doğrulanıyor…');
            try {
              const j = await api({ action: 'gauth', room: 'PUSH', identity: S.id, idToken: resp.credential, rooms: roomsForBackup() });
              busy(false);
              if (j.restored) {
                switchIdentity(j.identity, j.rooms || [], j.email);
                afterSwitch('Google hesabın bağlandı (' + (j.email || '') + '). ' + ((j.rooms || []).length ? (j.rooms.length + ' oda geri yüklendi.') : ''));
              } else {
                store.set('gmail', j.email || ''); renderAccount(); toast('Google hesabın bağlandı: ' + (j.email || ''), 5000);
              }
            } catch (e) { busy(false); toast(e.message || 'Google girişi yapılamadı.', 6000); }
          }
        });
        google.accounts.id.renderButton(b.querySelector('#gBtn'), { theme: 'filled_blue', size: 'large', text: 'continue_with', shape: 'pill', locale: 'tr' });
      } catch (e) { b.querySelector('#gErr').textContent = 'Google düğmesi açılamadı.'; }
    });
  }
  $('#accCode').onclick = () => {
    const code = 'ML-' + S.id;
    let img = '';
    try { const q = qrcode(0, 'M'); q.addData('motolink://kimlik?c=' + code); q.make(); img = q.createDataURL(5, 2); } catch (e) {}
    sheet('<h3>🔑 Kimlik kodum</h3><p>Bu kodu güvenli bir yere kaydet (kendine e-posta at ya da ekran görüntüsü al). Yeni telefonda "Kodla geri yükle" ile gir.</p>' +
      (img ? '<div style="text-align:center"><img src="' + img + '" alt="QR" style="width:170px;height:170px;background:#fff;border-radius:8px;padding:6px"></div>' : '') +
      '<div class="input inset" style="height:auto;padding:10px 12px;font-family:monospace;font-size:13px;word-break:break-all;user-select:all;-webkit-user-select:all">' + esc(code) + '</div>' +
      '<p style="color:#ff6b6b">⚠ Bu kodu kimseyle paylaşma: kodu bilen kişi odalarda SEN olarak görünür.</p>' +
      '<button class="mbtn amber" id="cdCopy">Kopyala</button><button class="mbtn raised" id="cdClose">Kapat</button>', (b) => {
      b.querySelector('#cdClose').onclick = closeSheet;
      b.querySelector('#cdCopy').onclick = async () => {
        try { await navigator.clipboard.writeText(code); toast('Kopyalandı.'); }
        catch (e) { try { if (navigator.share) await navigator.share({ text: code }); } catch (e2) {} }
      };
    });
  };
  $('#accRestore').onclick = () => {
    sheet('<h3>↩ Kodla geri yükle</h3><p>Eski telefonundaki "ML-" ile başlayan kimlik kodunu yapıştır.</p>' +
      '<input id="rsIn" class="input inset" placeholder="ML-…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<p class="small">Bu tarayıcıdaki şu anki kimliğin yerine eski kimliğin geçer.</p><div class="small" id="rsErr" style="color:#ff6b6b"></div>' +
      '<button class="mbtn amber" id="rsGo">GERİ YÜKLE</button><button class="mbtn raised" id="rsNo">Vazgeç</button>', (b) => {
      b.querySelector('#rsNo').onclick = closeSheet;
      b.querySelector('#rsGo').onclick = async () => {
        const id = parseIdCode(b.querySelector('#rsIn').value);
        const er = b.querySelector('#rsErr');
        if (!id) { er.textContent = 'Kod okunamadı. "ML-" ile başlayan kodun tamamını yaz.'; return; }
        if (id === S.id) { er.textContent = 'Bu zaten bu tarayıcının kimliği.'; return; }
        busy(true, 'Geri yükleniyor…');
        try {
          const j = await api({ action: 'restore', room: 'PUSH', identity: id });
          busy(false);
          switchIdentity(id, j.rooms, j.email);
          afterSwitch(j.rooms && j.rooms.length ? j.rooms.length + ' oda listene eklendi.' : 'Sunucuda oda yedeği bulunamadı; odalara kodla girebilirsin.');
        } catch (e) { busy(false); er.textContent = e.message; }
      };
    });
  };
  renderAccount();
  if (store.get('rooms', []).length && Date.now() - store.get('lastBackup', 0) > 86400000) { store.set('lastBackup', Date.now()); backupSoon(); }

  // ------------------------------------------------------------ bildirimler (1.1.8)
  // iPhone: Ana Ekrana eklenmiş web uygulaması (iOS 16.4+) kapalıyken de bildirim alır (Firebase, ücretsiz).
  const FB = CFG.FIREBASE || {};
  const pushReady = () => !!(FB.apiKey && FB.appId && FB.vapidKey) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  async function enablePush(interactive) {
    if (!pushReady()) { if (interactive) toast('Bildirim bu tarayıcıda desteklenmiyor. iPhone\'da Safari > Paylaş > Ana Ekrana Ekle ile ekleyip oradan aç (iOS 16.4+).', 8000); return; }
    try {
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') { if (interactive) toast('Bildirim izni verilmedi. Ayarlar > Bildirimler > MotoLink\'ten açabilirsin.', 7000); return; }
      if (!window.firebase) {
        await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
        await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
      }
      if (!firebase.apps.length) firebase.initializeApp({ apiKey: FB.apiKey, projectId: FB.projectId, messagingSenderId: FB.senderId, appId: FB.appId });
      const reg = await navigator.serviceWorker.ready;
      const token = await firebase.messaging().getToken({ vapidKey: FB.vapidKey, serviceWorkerRegistration: reg });
      if (!token) throw new Error('anahtar alınamadı');
      store.set('pushToken', token);
      await syncPush();
      if (interactive) toast('🔔 Bildirimler açık: uygulama kapalıyken de haber verilir.');
    } catch (e) { if (interactive) toast('Bildirim açılamadı: ' + (e.message || e), 7000); }
  }
  // Sunucuya: bu telefon hangi odaları (ve arkadaş kodunu) dinliyor
  async function syncPush() {
    const token = store.get('pushToken', ''); if (!token) return;
    const rooms = [MY_CODE].concat((store.get('rooms', []) || []).map((r) => r.code)).slice(0, 30);
    try { await api({ action: 'register', room: 'PUSH', identity: S.id, token, rooms }); } catch (e) {}
  }
  function offerPush() {
    if (!pushReady()) return;
    if (Notification.permission === 'granted') { enablePush(false); return; }
    if (Notification.permission === 'denied') return;
    if (Date.now() - (store.get('pushAsked', 0) || 0) < 2 * 86400000) return;
    store.set('pushAsked', Date.now());
    sheet('<h3>🔔 Bildirimleri aç</h3><p>Kayıtlı odalarına biri girince, seni odaya çağırınca, arayınca ya da S.O.S olunca uygulama kapalıyken de haber verelim.</p>' +
      '<button class="mbtn amber" id="psOk">BİLDİRİMLERİ AÇ</button><button class="mbtn raised" id="psNo">Şimdi değil</button>', (b) => {
      b.querySelector('#psNo').onclick = closeSheet;
      b.querySelector('#psOk').onclick = () => { closeSheet(); enablePush(true); };
    });
  }
  window.motolinkEnablePush = () => enablePush(true);
  setInterval(syncPush, 6 * 3600000);

  // ------------------------------------------------------------ başlat
  renderHome(); renderRoom(); updateTop(); applyLocModeButtonsOnly();
  function applyLocModeButtonsOnly() {
    $$('.locmodes .sw').forEach((b) => { b.className = 'sw ' + ({ off: 'c-green', saver: 'c-yellow', live: 'c-red' }[b.dataset.loc]) + (b.dataset.loc === S.locMode ? ' on' : ''); });
  }
  if (S.locMode !== 'off') startGeo();
  // Davet bağlantısı: ...?c=ODAKODU
  const qc = normCode(new URLSearchParams(location.search).get('c') || '');
  // 1.1.8: bildirime dokununca ...?join=ODA ile açılır: kayıtlıysa doğrudan gir
  const qj = normCode(new URLSearchParams(location.search).get('join') || '');
  if (qj) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  const savedJ = qj && (store.get('rooms', []) || []).find((r) => r.code === qj);
  if (!S.name) askName(qc ? () => askCode(qc) : null);
  else if (savedJ) joinRoom(qj, savedJ.pw || '');
  else if (validCode(qj)) askCode(qj);
  else if (validCode(qc)) askCode(qc);
  else offerRejoin();
  setTimeout(offerPush, 2500);
  // 1.3.0: sunucu kaydı kaybolsa bile her açılışta / öne gelişte bildirim kaydı tazelensin
  setTimeout(syncPush, 4000);
  let lastPushSync = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastPushSync > 600000) { lastPushSync = Date.now(); syncPush(); } });
  // Odadan "Odadan ayrıl" demeden çıkıldıysa: açılışta tek dokunuşla aynı odaya geri dön
  function offerRejoin() {
    const lr = store.get('lastRoom', null);
    if (!lr || !validCode(lr.code)) return;
    sheet('<h3>🏍 Odana geri dön</h3><p>En son <b>' + esc(lr.title || lr.code) + '</b> odasındaydın.</p>' +
      '<button id="rjOk" class="mbtn amber">Odaya geri dön</button><button id="rjNo" class="mbtn raised">Şimdi değil</button>', (b) => {
      b.querySelector('#rjNo').onclick = () => { closeSheet(); store.set('lastRoom', null); };
      b.querySelector('#rjOk').onclick = () => { closeSheet(); joinRoom(lr.code, lr.pw || '', true); };
    });
  }
  if (qc) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  window.addEventListener('resize', () => { fit($('#greet'), 26, 14); if (map) map.invalidateSize(); });
  if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {})); }
  if (!LK) toast('Ses bileşeni yüklenemedi. Sayfayı yenile.', 8000);
})();
