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
    modes: {}, onCall: new Set(), locs: {}, myLoc: null,
    locMode: store.get('locMode', 'off'), watchId: null, lastLocSent: 0,
    mySos: null, lastPing: {},
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
  const inviteUrl = (c) => CFG.SERVER + '?page=katil&c=' + encodeURIComponent(c);

  // ------------------------------------------------------------ arayüz yardımcıları
  let toastT = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.add('hidden'), ms || 3800);
  }
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
    $$('.page').forEach((x) => x.classList.toggle('on', x.id === 'p-' + p));
    $$('#nav .it').forEach((x) => x.classList.toggle('on', x.dataset.p === p));
    if (p === 'map') setTimeout(initMap, 30);
    if (p === 'music') loadStations();
    if (p === 'room') renderRoom();
  }

  // ------------------------------------------------------------ ana sayfa
  function renderHome() {
    const g = $('#greet');
    g.textContent = (S.name || 'Sürücü') + ', yola hazır mısın?';
    fit(g, 26, 14);
    $('#installHint').classList.toggle('hidden', !(isIOS && !standalone));
    const rooms = store.get('rooms', []);
    $('#recent').innerHTML = rooms.length ? rooms.map((r, i) =>
      '<div class="row raised" data-i="' + i + '"><div class="av" style="background:' + colorOf(r.code) + '">' + esc(initial(r.name || r.code)) + '</div>' +
      '<div class="tx"><b>' + esc(r.name || r.code) + '</b><small>' + esc(r.code) + (r.locked ? ' · 🔒 şifreli' : '') + '</small></div>' +
      '<button class="x" data-del="' + i + '" aria-label="Listeden kaldır">✕</button></div>').join('')
      : '<div class="note" style="margin:0 2px">Girdiğin odalar burada listelenir.</div>';
    $$('#recent .row').forEach((el) => el.addEventListener('click', (e) => {
      const rs = store.get('rooms', []);
      if (e.target.dataset.del !== undefined) { rs.splice(+e.target.dataset.del, 1); store.set('rooms', rs); renderHome(); return; }
      const r = rs[+el.dataset.i]; if (r) joinRoom(r.code, r.pw || '');
    }));
  }
  function rememberRoom(code, name, locked, pw) {
    const rs = store.get('rooms', []).filter((r) => r.code !== code);
    rs.unshift({ code, name: name || code, locked: !!locked, pw: pw || '' });
    store.set('rooms', rs.slice(0, 15));
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
    if (room.remoteParticipants.size >= CFG.MAX_RIDERS) {
      try { room.disconnect(); } catch (x) {}
      S.connecting = false; busy(false);
      toast('Oda dolu. En fazla ' + CFG.MAX_RIDERS + ' sürücü olabilir.');
      return;
    }

    S.room = room; S.code = code; S.server = acc.server || '';
    const info = acc.room || {};
    S.title = info.name || code; S.locked = !!info.locked; S.permanent = !!info.permanent;
    S.owner = acc.owner || ''; S.admins = new Set(acc.admins || []);
    S.nicks = acc.nicks || {}; S.approval = !!(info.approval);
    S.lockedIds = new Set(); S.silenced = new Set(); S.roomLock = false;
    S.modes = {}; S.onCall = new Set(); S.locs = {};
    S.open = false; S.live = false; S.micOn = false;
    S.wantRoom = { code, pw: usePw };
    rememberRoom(code, S.title, S.locked, usePw);
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
        const a = await api({ action: 'token', room: code, identity: S.id, name: S.name || 'Sürücü', password: pw, avatar: '', announce: false });
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
      S.room = null;
      try { await r.disconnect(); } catch (e) {}
    }
    stopTicks(); stopGeo(); keepAwake(false);
    clearInterval(S.reqTimer); S.nicks = {}; S.approval = false;
    $$('audio.lk').forEach((a) => a.remove());
    S.micOn = false; S.open = false; S.live = false; S.locs = {};
    if (sharedRadio) stopRadio(true);
    updateTop(); renderRoom(); renderMapRiders();
  }

  function wireRoom(room) {
    const E = LK.RoomEvent;
    room.on(E.TrackSubscribed, (track) => {
      if (track.kind !== 'audio') return;
      const el = track.attach();
      el.classList.add('lk'); el.setAttribute('playsinline', ''); el.style.display = 'none';
      document.body.appendChild(el);
    });
    room.on(E.TrackUnsubscribed, (track) => { try { track.detach().forEach((el) => el.remove()); } catch (e) {} });
    room.on(E.ParticipantConnected, (p) => {
      publishMode();
      if (amAdmin()) {
        publishAdmins();
        if (S.lockedIds.size || S.silenced.size || S.roomLock) publishLocks();
      }
      if (S.mySos) publishSos(false);
      if (S.myLoc && S.locMode !== 'off') sendLoc(true);
      if (p.name) toast(dispName(p.identity, p.name) + ' odaya katıldı');
      renderRoom(); renderMapRiders();
    });
    room.on(E.ParticipantDisconnected, (p) => {
      delete S.locs[p.identity]; delete S.modes[p.identity]; S.onCall.delete(p.identity);
      renderRoom(); renderMapRiders();
    });
    room.on(E.ActiveSpeakersChanged, () => renderRoom());
    room.on(E.DataReceived, (payload, participant) => onData(payload, participant));
    room.on(E.AudioPlaybackStatusChanged, () => $('#audioUnlock').classList.toggle('hidden', room.canPlaybackAudio));
    room.on(E.Reconnecting, () => toast('Bağlantı zayıf, yeniden bağlanıyor…'));
    room.on(E.Reconnected, () => { toast('Yeniden bağlandı.'); publishMode(); });
    room.on(E.Disconnected, (reason) => {
      if (S.room !== room) return;
      S.room = null;
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
    if (!payload || !payload.length || payload[0] !== 123) return; // { ile başlamıyorsa (müzik ses paketi) geç
    let j; try { j = JSON.parse(dec.decode(payload)); } catch (e) { return; }
    const id = participant && participant.identity;
    const name = nameOf(participant);
    switch (j.t) {
      case 'mode': if (id) { S.modes[id] = j.m || 'ptt'; renderRoom(); } break;
      case 'loc':
        if (!id) return;
        S.locs[id] = { id, name: dispName(id, participant.name), lat: +j.lat, lon: +j.lon, spd: j.spd | 0, at: Date.now() };
        renderMapRiders(); break;
      case 'loc_off': if (id) { delete S.locs[id]; renderMapRiders(); } break;
      case 'call':
        if (!id) return;
        if (j.on) { if (!S.onCall.has(id)) toast('📞 ' + name + ' telefon görüşmesinde, seni duyamıyor.'); S.onCall.add(id); }
        else if (S.onCall.delete(id)) toast(name + ' telefon görüşmesini bitirdi.');
        renderRoom(); break;
      case 'roominfo': if (j.name) { S.title = j.name; rememberRoom(S.code, j.name, S.locked, S.wantRoom && S.wantRoom.pw); renderRoom(); toast('Oda adı güncellendi: ' + j.name); } break;
      case 'ping': onPing(j, id, name); break;
      case 'sos': onSos(j, id, name); break;
      case 'music': onMusic(j); break;
      case 'adm': case 'locks': case 'mod': case 'nick': case 'apr': onAdminMsg(j, id, name); break;
      default: break;
    }
  }

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
  $('#audioUnlock').onclick = () => { if (S.room) S.room.startAudio().catch(() => {}); audioCtx(); $('#audioUnlock').classList.add('hidden'); };

  function renderPtt() {
    const sil = S.room && S.silenced.has(S.id);
    ptt.classList.toggle('on', S.micOn);
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
    fit($('#pttTitle'), 17, 11);
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
    if (on) {
      ring.style.setProperty('--rx', Math.min(1, rl * 2).toFixed(2));
      ring.style.setProperty('--tc', S.live ? '#ff3b3b' : '#46e38a');
      $$('#ptt .wave i').forEach((b, i) => { const mid = 1 - Math.abs(i - 3) / 3 * 0.55; b.style.height = Math.round(6 + 30 * mid * (0.35 + 0.65 * Math.min(1, rl * 2)) * (0.55 + 0.45 * Math.random())) + 'px'; });
    }
    if (S.micOn) {
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
  function renderRoom() {
    const inRoom = !!S.room;
    $('#roomEmpty').classList.toggle('hidden', inRoom);
    $('#roomBody').classList.toggle('hidden', !inRoom);
    renderPtt();
    if (!inRoom) return;
    const list = riders();
    $('#rLogo').textContent = initial(S.title);
    $('#rTitle').textContent = S.title;
    $('#rSub').textContent = list.length + ' / ' + CFG.MAX_RIDERS + ' sürücü' + (S.permanent ? ' · kalıcı oda' : '') + (S.title !== S.code ? ' · ' + S.code : '') + (S.locked ? ' · 🔒' : '');
    $('#adminBtn').classList.toggle('hidden', !amAdmin());
    const cls = { ptt: 'c-green', open: 'c-orange', live: 'c-red' };
    $$('.modes .sw').forEach((b) => { b.className = 'sw ' + cls[b.dataset.mode] + (b.dataset.mode === currentMode() ? ' on' : ''); });
    const talking = list.filter((x) => x.speaking).map((x) => x.me ? 'Sen' : x.name);
    $('#talking').classList.toggle('on', talking.length > 0);
    $('#talkingText').textContent = talking.length ? '🎙 ' + talking.join(', ') + (talking.length > 1 || talking[0] === 'Sen' ? ' konuşuyor' : ' konuşuyor') : 'Kimse konuşmuyor';
    const me = S.locs[S.id];
    $('#riders').innerHTML = list.map((x) => {
      const loc = S.locs[x.id];
      const line = [];
      if (!x.me && me && loc) line.push(fmtDist(dist(me, loc)));
      if (loc && loc.spd > 3) line.push(loc.spd + ' km/s');
      if (S.onCall.has(x.id)) line.push('📞 telefonda');
      if (x.me) line.push('sen');
      const badge = '<span class="badge ' + x.mode + '">' + (x.mode === 'ptt' ? 'Bas-konuş' : x.mode === 'open' ? 'Eller Serbest' : 'Sürekli Açık') + '</span>';
      const crown = isAdmin(x.id) ? (x.id === S.owner ? '👑' : '⭐') : '';
      const lock = S.silenced.has(x.id) ? '🔇' : (S.lockedIds.has(x.id) ? '🔒' : '');
      return '<button class="rider raised' + (x.speaking ? ' speak' : '') + '" data-id="' + esc(x.id) + '">' +
        '<div class="av" style="background:' + colorOf(x.id) + '">' + esc(initial(x.name)) + '</div>' +
        '<div class="tx"><div class="nm"><span class="n">' + esc(x.name) + '</span>' + crown + lock + badge + '</div><small>' + esc(line.join(' · ')) + '</small></div>' +
        '<i class="dot' + (x.speaking ? ' on' : '') + '"></i></button>';
    }).join('');
    $$('#riders .rider').forEach((el) => el.addEventListener('click', () => riderMenu(el.dataset.id)));
  }

  $('#qrBtn').onclick = () => {
    if (!S.room) return;
    let img = '';
    try { const q = qrcode(0, 'M'); q.addData(inviteUrl(S.code)); q.make(); img = q.createDataURL(6, 2); } catch (e) {}
    sheet('<h3>' + esc(S.title) + '</h3><p>Arkadaşın telefonunun kamerasıyla okutsun. Android\'de uygulama açılır, iPhone\'da web sürümü.</p>' +
      (img ? '<div class="qrbox"><img src="' + img + '" alt="QR"></div>' : '') +
      '<div class="codebig">' + esc(S.code) + '</div><button class="mbtn raised" id="qrOk">Kapat</button>', (b) => { b.querySelector('#qrOk').onclick = closeSheet; });
  };
  $('#shareBtn').onclick = async () => {
    if (!S.room) return;
    const text = 'MotoLink odama katıl: ' + S.title + '\nOda kodu: ' + S.code + '\n' + inviteUrl(S.code);
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
    if (!amAdmin()) {
      sheet('<h3>' + esc(r.name) + '</h3><p>Konuşma modu: ' + MODES[r.mode] + (isAdmin(id) ? ' · oda yöneticisi' : '') + '</p><button class="mbtn raised" id="mx">Kapat</button>',
        (b) => { b.querySelector('#mx').onclick = closeSheet; });
      return;
    }
    const isOwner = id === S.owner, locked = S.lockedIds.has(id), sil = S.silenced.has(id);
    sheet('<h3>' + esc(r.name) + '</h3><p>' + (isOwner ? '👑 Odayı açan' : isAdmin(id) ? '⭐ Oda yöneticisi' : 'Üye') + (sil ? ' · 🔇 susturuldu' : locked ? ' · 🔒 bas-konuşa kilitli' : '') + '</p>' +
      '<button class="mbtn raised" data-a="ptt">🎙 Bas-konuşa al</button>' +
      (locked ? '<button class="mbtn raised" data-a="unlock">🔓 Açık mikrofon kilidini kaldır</button>' : (!isOwner ? '<button class="mbtn raised" data-a="lock">🔒 Bas-konuşa al ve kilitle</button>' : '')) +
      (!isOwner ? '<button class="mbtn ' + (sil ? 'raised' : 'danger') + '" data-a="sil">' + (sil ? '🔊 Susturmayı kaldır' : '🔇 Sustur (hiç konuşamasın)') + '</button>' : '') +
      '<button class="mbtn raised" data-a="nick">✏️ Odadaki adını değiştir (görev adı)</button>' +
      (!isOwner ? '<button class="mbtn raised" data-a="adm">' + (isAdmin(id) ? '⭐ Yöneticiliğini al' : '⭐ Yönetici yap') + '</button>' : '') +
      (!isOwner ? '<button class="mbtn danger" data-a="kick">🚫 Odadan çıkar</button>' : '') +
      '<button class="mbtn raised" data-a="x">Kapat</button>', (b) => {
      b.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => {
        const a = btn.dataset.a;
        if (a === 'x') return closeSheet();
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
      '<button class="mbtn raised" data-a="all">👥 Herkesi bas-konuşa al</button>' +
      '<button class="mbtn raised" data-a="lock">' + (S.roomLock ? '🔓 Oda kilidini aç (herkes mod seçebilsin)' : '🔒 Odayı bas-konuşa kilitle') + '</button>' +
      '<button class="mbtn danger" data-a="silall">🔇 Herkesi sustur (sadece yöneticiler konuşsun)</button>' +
      ((S.silenced.size || S.lockedIds.size || S.roomLock) ? '<button class="mbtn raised" data-a="free">🔊 Herkesi serbest bırak</button>' : '') +
      (S.id === S.owner && (S.locked || S.permanent) ? '<button class="mbtn raised" data-a="apr">' + (S.approval ? '🛡 Girişte onay: AÇIK (kapatmak için dokun)' : '🛡 Girişte yönetici onayı iste') + '</button>' : '') +
      '<p>Tek bir kişi için listede ismine dokun. Gizlilik gereği kimsenin mikrofonu uzaktan açılamaz.</p>' +
      '<button class="mbtn raised" data-a="x">Kapat</button>', (b) => {
      b.querySelectorAll('[data-a]').forEach((btn) => btn.onclick = () => {
        const a = btn.dataset.a; closeSheet();
        if (a === 'all') modAllPtt();
        if (a === 'lock') modRoomLock(!S.roomLock);
        if (a === 'silall') modSilenceAll();
        if (a === 'free') modReleaseAll();
        if (a === 'apr') setApproval(!S.approval);
      });
    });
  };
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
      const j = await api({ action: 'create', room: S.code, identity: S.id, displayName: S.title, permanent: S.permanent, password: 'keep', approval: on });
      S.approval = !!(j.room && j.room.approval);
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
  function renderMapRiders() {
    $('#pings').classList.toggle('hidden', !S.room);
    const all = Object.assign({}, S.locs);
    if (S.myLoc && !all[S.id]) all[S.id] = { id: S.id, name: S.name || 'Ben', lat: S.myLoc.lat, lon: S.myLoc.lon, spd: S.myLoc.spd };
    if (map) {
      Object.keys(markers).forEach((id) => { if (!all[id]) { map.removeLayer(markers[id]); delete markers[id]; } });
      Object.values(all).forEach((l) => {
        const me = l.id === S.id;
        const icon = L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
          html: '<div class="pin' + (me ? ' me' : '') + '" style="background:' + colorOf(l.id) + '">' + esc(initial(l.name)) + '</div>' });
        if (markers[l.id]) { markers[l.id].setLatLng([l.lat, l.lon]); markers[l.id].setIcon(icon); }
        else markers[l.id] = L.marker([l.lat, l.lon], { icon }).addTo(map).bindTooltip(esc(me ? 'Sen' : l.name));
      });
      if (!centered && S.myLoc) { centered = true; map.setView([S.myLoc.lat, S.myLoc.lon], 14); }
    }
    const me = all[S.id];
    $('#mapRiders').innerHTML = Object.values(all).map((l) => {
      const sub = l.id === S.id ? (l.spd > 3 ? l.spd + ' km/s' : 'sen') : (l.spd > 3 ? l.spd + ' km/s' : (me ? fmtDist(dist(me, l)) : ''));
      return '<button class="chip" data-id="' + esc(l.id) + '"><div class="av" style="background:' + colorOf(l.id) + '">' + esc(initial(l.name)) + '</div><b>' + esc(l.id === S.id ? 'Sen' : l.name) + '</b><small>' + esc(sub) + '</small></button>';
    }).join('') || '<div class="note" style="margin:4px 2px">' + (S.room ? 'Konumunu paylaşan kimse yok.' : 'Odaya girince arkadaşların burada görünür.') + '</div>';
    $$('#mapRiders .chip').forEach((el) => el.addEventListener('click', () => { const l = all[el.dataset.id]; if (l && map) map.setView([l.lat, l.lon], Math.max(map.getZoom(), 15)); }));
    if (page === 'room') renderRoom();
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
  $('#sosBtn').onclick = () => {
    if (S.mySos) {
      sheet('<h3>S.O.S gönderildi</h3><p>Odadakiler ve kayıtlı odalarındaki arkadaşların uyarıldı.</p><button class="mbtn amber" id="sosOk">✅ İyiyim, S.O.S\'i kapat</button><button class="mbtn raised" id="sosNo">Kapat</button>',
        (b) => { b.querySelector('#sosNo').onclick = closeSheet; b.querySelector('#sosOk').onclick = () => { closeSheet(); sendSos(null, true); }; });
      return;
    }
    sheet('<h3 style="color:#ff6b6b">S.O.S gönderilsin mi?</h3><p>Konumunla birlikte odadakilere ve kayıtlı odalarındaki arkadaşlarına acil uyarı gider.</p>' +
      ['Kaza yaptım', 'Arıza, yolda kaldım', 'Yardım lazım'].map((r) => '<button class="mbtn danger" data-r="' + r + '">🆘 ' + r + '</button>').join('') +
      '<button class="mbtn raised" id="sosNo">Vazgeç</button>', (b) => {
      b.querySelector('#sosNo').onclick = closeSheet;
      b.querySelectorAll('[data-r]').forEach((btn) => btn.onclick = () => { closeSheet(); sendSos(btn.dataset.r, false); });
    });
  };
  function publishSos(cancel) {
    const j = { t: 'sos', reason: (S.mySos && S.mySos.reason) || 'Yardım lazım', cancel: !!cancel };
    if (S.myLoc) { j.lat = S.myLoc.lat; j.lon = S.myLoc.lon; }
    publish(j);
  }
  function sendSos(reason, cancel) {
    const go2 = () => {
      if (!cancel) S.mySos = { reason };
      publishSos(cancel);
      const rooms = store.get('rooms', []).map((r) => r.code);
      if (S.code && !rooms.includes(S.code)) rooms.unshift(S.code);
      const body = { action: 'sos', room: 'SOS', identity: S.id, name: S.name || 'Bir sürücü', reason: reason || (S.mySos && S.mySos.reason) || 'Yardım lazım', cancel: !!cancel, rooms: rooms.slice(0, 30) };
      if (S.myLoc) { body.lat = S.myLoc.lat; body.lon = S.myLoc.lon; }
      api(body).catch(() => {});
      if (cancel) { S.mySos = null; toast('S.O.S kapatıldı, "iyiyim" bildirildi.'); }
      else toast('🆘 S.O.S gönderildi.' + (S.myLoc ? '' : ' (Konum bulunamadı)'), 6000);
    };
    if (!cancel && !S.myLoc && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => { S.myLoc = { lat: p.coords.latitude, lon: p.coords.longitude, spd: 0 }; go2(); }, go2, { timeout: 8000, maximumAge: 30000, enableHighAccuracy: true });
    } else go2();
  }
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

  // ------------------------------------------------------------ radyo
  const player = new Audio();
  player.setAttribute('playsinline', '');
  player.preload = 'none';
  let stations = [], stIndex = -1, sharedRadio = null, stLoaded = false;
  player.volume = store.get('vol', 80) / 100;
  $('#vol').value = Math.round(player.volume * 100);
  $('#vol').oninput = (e) => { player.volume = e.target.value / 100; store.set('vol', +e.target.value); };
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
      '<button class="sta raised' + (i === stIndex && !sharedRadio ? ' on' : '') + '" data-i="' + i + '"><div class="lg">' + (s.l ? '<img src="' + esc(s.l) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '<span>' + esc(s.t.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9 ]/g, '').split(' ').map((w) => w[0] || '').join('').slice(0, 2).toLocaleUpperCase('tr-TR') || '♪') + '</span></div>' +
      '<div class="lcdbox"><div class="g">' + esc(s.t.toLocaleUpperCase('tr-TR')) + '</div><div class="gd">' + esc((i === stIndex && !sharedRadio) ? '▶ SENDE ÇALIYOR' : (s.c || 'RADYO').toLocaleUpperCase('tr-TR')) + '</div></div></button>').join('')
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
    sharedRadio = null; $('#radioBar').classList.add('hidden');
    stIndex = i; playUrl(s.u, () => toast('Kanal açılamadı, başka bir kanal dene.'));
    setNow(s.t, 'SADECE SENDE', s.c || 'RADYO', true);
    renderStations();
  }
  function stopRadio(silent) {
    try { if (hls) { hls.destroy(); hls = null; } } catch (e) {}
    player.pause(); player.removeAttribute('src'); try { player.load(); } catch (e) {}
    sharedRadio = null; $('#radioBar').classList.add('hidden');
    setNow('KAPALI', 'RADYO', 'Listeden bir kanal seç', false);
    renderStations();
    if (!silent) toast('Radyo kapatıldı.');
  }
  function setNow(title, tag, sub, on) {
    $('#nowTitle').textContent = String(title).toLocaleUpperCase('tr-TR'); $('#nowTag').textContent = tag; $('#nowSub').textContent = sub;
    $('#mPlay').textContent = on ? '■' : '▶';
    $('#vu').classList.toggle('on', on);
    fit($('#nowTitle'), 24, 14);
  }
  $('#mPlay').onclick = () => { if (!player.paused && player.src) stopRadio(); else if (stIndex >= 0) playStation(stIndex); else if (stations.length) playStation(0); };
  $('#mNext').onclick = () => { if (stations.length) playStation((stIndex + 1) % stations.length); };
  $('#mPrev').onclick = () => { if (stations.length) playStation((stIndex - 1 + stations.length) % stations.length); };
  $('#radioStop').onclick = () => stopRadio();
  function onMusic(j) {
    if (j.a === 'play' && j.url) {
      sharedRadio = { url: j.url, title: j.title || 'Radyo', by: j.by || '' };
      stIndex = -1; playUrl(j.url, null);
      $('#radioText').textContent = '♪ ' + sharedRadio.title + ' · ORTAK';
      $('#radioBar').classList.remove('hidden');
      setNow(sharedRadio.title, 'ODAYLA ORTAK', sharedRadio.by ? sharedRadio.by + ' paylaştı' : 'Odada çalıyor', true);
      toast('♪ Odada ' + sharedRadio.title + ' çalıyor.');
    } else if (sharedRadio) { stopRadio(true); toast('Ortak radyo kapandı.'); }
  }
  // VU göstergesi (çalarken hareket eder)
  $('#vu').innerHTML = Array.from({ length: 24 }, () => '<i></i>').join('');
  setInterval(() => {
    if (player.paused || !player.src) return;
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
  $('#ver').textContent = CFG.VERSION;
  $('#privacyBtn').onclick = () => window.open(CFG.SERVER + '?page=gizlilik', '_blank');
  $('#wipeBtn').onclick = () => {
    sheet('<h3>Bu telefondaki bilgilerin silinsin mi?</h3><p>Adın, kayıtlı odaların ve ayarların bu tarayıcıdan silinir.</p><button class="mbtn danger" id="wy">🗑 Hepsini sil</button><button class="mbtn raised" id="wn">Vazgeç</button>',
      (b) => { b.querySelector('#wn').onclick = closeSheet; b.querySelector('#wy').onclick = async () => { closeSheet(); await leaveRoom(true); store.clear(); location.reload(); }; });
  };

  // ------------------------------------------------------------ başlat
  renderHome(); renderRoom(); updateTop(); applyLocModeButtonsOnly();
  function applyLocModeButtonsOnly() {
    $$('.locmodes .sw').forEach((b) => { b.className = 'sw ' + ({ off: 'c-green', saver: 'c-yellow', live: 'c-red' }[b.dataset.loc]) + (b.dataset.loc === S.locMode ? ' on' : ''); });
  }
  if (S.locMode !== 'off') startGeo();
  // Davet bağlantısı: ...?c=ODAKODU
  const qc = normCode(new URLSearchParams(location.search).get('c') || '');
  if (!S.name) askName(qc ? () => askCode(qc) : null);
  else if (validCode(qc)) askCode(qc);
  else offerRejoin();
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
