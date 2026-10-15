/* =========================================================
   PA1 — Thống kê truy cập (ghi lượt xem + thời gian xem thực)
   Dữ liệu gửi về Google Apps Script → Google Sheet của PA1.
   ĐỔI LINK WEB APP Ở DÒNG DƯỚI (chỉ 1 chỗ này).
   ========================================================= */
(function () {
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxvPQYoPNod0InObA73rEhFyoWnXXRjNYJsNzT9hjGVZrc5HOUaGC5DkZ_gJxxDpqvOGQ/exec';

  window.PA1_TRACK_ENDPOINT = ENDPOINT;
  if (!ENDPOINT || ENDPOINT.indexOf('script.google.com') < 0) return;
  if (navigator.webdriver || /bot|crawl|spider|lighthouse|headless/i.test(navigator.userAgent)) return;

  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { var s = store(kind); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function set(kind, k, v) { try { var s = store(kind); if (s) s.setItem(k, v); } catch (e) {} }
  function rid(n) { var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

  // Admin đã bật "không ghi lượt của tôi" → bỏ qua
  if (get('localStorage', 'pa1_notrack') === '1') return;

  var vid = get('localStorage', 'pa1_vid');
  if (!vid) { vid = 'V-' + rid(6); set('localStorage', 'pa1_vid', vid); }
  window.PA1_VID = vid;
  var sid = get('sessionStorage', 'pa1_sid');
  if (!sid) { sid = 'S-' + rid(8); set('sessionStorage', 'pa1_sid', sid); }
  var pvid = 'P-' + rid(10);

  var ua = navigator.userAgent;
  var device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'Tablet'
             : /Mobi|iPhone|Android/i.test(ua) ? 'Mobile' : 'Desktop';
  var browser = /Zalo/i.test(ua) ? 'Zalo' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook' : /CocCoc/i.test(ua) ? 'Cốc Cốc'
              : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
              : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'Khác';
  var ref = '';
  try { if (document.referrer) { var r = new URL(document.referrer); if (r.host !== location.host) ref = r.host.replace(/^www\./, ''); } } catch (e) {}
  var utm = '';
  try { utm = new URLSearchParams(location.search).get('utm_source') || (new URLSearchParams(location.search).get('fbclid') ? 'facebook' : ''); } catch (e) {}

  var path = location.pathname.replace(/\/index\.html$/, '/');
  if (path.length > 1) path = path.replace(/\/$/, '');

  function send(obj) {
    obj.vid = vid; obj.sid = sid; obj.pvid = pvid; obj.path = path;
    var body = JSON.stringify(obj);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=utf-8' }))) return;
    } catch (e) {}
    try { fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body }); } catch (e) {}
  }

  // ---- Đếm thời gian xem THỰC: tab đang hiển thị + có thao tác trong 5 phút gần nhất
  var TICK = 5, IDLE = 300, pending = 0, lastAct = Date.now();
  ['scroll', 'mousemove', 'keydown', 'touchstart', 'click'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastAct = Date.now(); }, { passive: true });
  });
  setInterval(function () {
    if (document.visibilityState === 'visible' && Date.now() - lastAct < IDLE * 1000) pending += TICK;
    if (pending >= 120) flush();            // gửi định kỳ mỗi 2 phút xem
  }, TICK * 1000);

  // ---- Tín hiệu "đang truy cập" mỗi 20 giây khi tab đang mở
  setInterval(function () {
    if (document.visibilityState === 'visible' && Date.now() - lastAct < IDLE * 1000) send({ t: 'ping', device: device, browser: browser });
  }, 20000);

  function flush() {
    if (pending <= 0) return;
    var s = pending; pending = 0;
    send({ t: 'time', sec: s });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(); else lastAct = Date.now();
  });
  window.addEventListener('pagehide', flush);

  // ---- Lượt xem trang
  send({ t: 'view', title: (document.title || '').slice(0, 120), device: device, browser: browser, ref: ref, utm: utm.slice(0, 40) });

  // ---- Gắn mã khách vào form liên hệ (biết khách nào đã xem trang nào)
  document.addEventListener('DOMContentLoaded', hookForms);
  if (document.readyState !== 'loading') hookForms();
  function hookForms() {
    var forms = document.querySelectorAll('form[action*="formsubmit"]');
    for (var i = 0; i < forms.length; i++) (function (f) {
      if (f.__pa1) return; f.__pa1 = true;
      var h = document.createElement('input');
      h.type = 'hidden'; h.name = 'Mã khách (website)'; h.value = vid; f.appendChild(h);
      f.addEventListener('submit', function () {
        function v(sel) { var el = f.querySelector(sel); return el ? String(el.value || '').slice(0, 120) : ''; }
        flush();
        send({ t: 'lead', name: v('#c-name, [name*="tên" i], [name*="name" i]'), phone: v('input[type=tel]'),
               email: v('input[type=email]'), service: v('select').replace(/^—.*/, '') });
      });
    })(forms[i]);
  }
})();
