/* =========================================================
   PA1 — THỐNG KÊ TRUY CẬP WEBSITE (Google Apps Script)
   Dán toàn bộ file này vào một dự án Apps Script (script.google.com). Dữ liệu ghi vào Sheet theo SHEET_ID.
   1) Đổi ADMIN_PASSWORD bên dưới.
   2) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
   CẬP NHẬT (khái toán gửi email): dán đè file này → Deploy → Manage deployments → ✏ Edit
      → Version: New version → Deploy (giữ nguyên link /exec). Lần đầu Google sẽ hỏi quyền "Gửi email" → Allow.
   ========================================================= */

const ADMIN_PASSWORD = 'DOI_MAT_KHAU_O_DAY';   // ← ĐỔI MẬT KHẨU ADMIN (ít nhất 8 ký tự)
const TZ = 'Asia/Ho_Chi_Minh';
const SHEET_ID = '18hNFPDUHN4xKmIbfUXj8cFzDdyTXjKVg42y9cBCcnNg';   // Google Sheet "PA1_Website_ThongKeTruyCap"

const LOG_SHEET = 'Log';
const LEAD_SHEET = 'Leads';
const LOG_HEAD = ['Thời gian', 'Mã khách', 'Phiên', 'Lượt xem ID', 'Loại', 'Trang', 'Tiêu đề', 'Giây', 'Thiết bị', 'Trình duyệt', 'Nguồn', 'UTM'];
const LEAD_HEAD = ['Thời gian', 'Mã khách', 'Họ tên', 'SĐT', 'Email', 'Dịch vụ', 'Trang gửi'];

function sheet_(name, head) {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#F2B529');
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').slice(0, n);
// chặn công thức Sheet (=, +, -, @) bị chèn từ dữ liệu khách
const safe = (v, n) => { const s = clip(v, n); return /^[=+\-@]/.test(s) ? "'" + s : s; };

function doGet() {
  return json_({ ok: true, service: 'PA1 analytics' });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false }); }
  if (d.t === 'stats') return stats_(d);
  if (d.t === 'khaitoan') return khaiToan_(d);
  if (!/^V-[A-Z0-9]{6}$/.test(d.vid || '') || !/^\//.test(d.path || '')) return json_({ ok: false });

  if (d.t === 'ping' || d.t === 'view') live_(d);
  if (d.t === 'ping') return json_({ ok: true });

  const now = new Date();
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    if (d.t === 'view' || d.t === 'time') {
      const sec = d.t === 'time' ? Math.max(0, Math.min(Number(d.sec) || 0, 1800)) : 0;
      sheet_(LOG_SHEET, LOG_HEAD).appendRow([
        now, d.vid, clip(d.sid, 12), clip(d.pvid, 14), d.t, safe(d.path, 150), safe(d.title, 120), sec,
        safe(d.device, 10), safe(d.browser, 15), safe(d.ref, 60), safe(d.utm, 40)
      ]);
    } else if (d.t === 'lead') {
      sheet_(LEAD_SHEET, LEAD_HEAD).appendRow([
        now, d.vid, safe(d.name, 80), safe(d.phone, 20), safe(d.email, 80), safe(d.service, 40), safe(d.path, 150)
      ]);
    }
  } finally { lock.releaseLock(); }
  return json_({ ok: true });
}

/* ---------- Khách đang truy cập (lưu tạm trong Cache, không ghi Sheet) ---------- */
const LIVE_SEC = 45;   // coi là "đang truy cập" nếu có tín hiệu trong 45 giây gần nhất
function live_(d) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    const now = Date.now();
    const map = JSON.parse(cache.get('live') || '{}');
    Object.keys(map).forEach(k => { if (now - map[k].ts > LIVE_SEC * 1000) delete map[k]; });
    const prev = map[d.vid] || {};
    map[d.vid] = { path: clip(d.path, 150), ts: now, device: clip(d.device || prev.device || '', 10), browser: clip(d.browser || prev.browser || '', 15) };
    cache.put('live', JSON.stringify(map), 600);
  } finally { lock.releaseLock(); }
}
function liveList_() {
  const now = Date.now();
  const map = JSON.parse(CacheService.getScriptCache().get('live') || '{}');
  return Object.keys(map).filter(k => now - map[k].ts <= LIVE_SEC * 1000)
    .map(k => ({ vid: k, path: map[k].path, device: map[k].device, browser: map[k].browser, ago: Math.round((now - map[k].ts) / 1000) }))
    .sort((a, b) => a.ago - b.ago);
}

/* ---------- Báo cáo cho admin (chỉ trả dữ liệu khi đúng mật khẩu) ---------- */
function stats_(d) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 10) return json_({ ok: false, error: 'locked' });   // khoá 15 phút sau 10 lần sai
  if (ADMIN_PASSWORD === 'DOI_MAT_KHAU_O_DAY' || ADMIN_PASSWORD.length < 8) return json_({ ok: false, error: 'setup' });
  if (String(d.key || '') !== ADMIN_PASSWORD) {
    cache.put('fails', String(fails + 1), 900);
    Utilities.sleep(800);
    return json_({ ok: false, error: 'auth' });
  }

  const days = Number(d.days) || 0;          // 0 = tất cả
  let from = 0;
  if (days > 0) {
    const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
    from = new Date(today + 'T00:00:00+07:00').getTime() - (days - 1) * 86400000;
  }

  const log = sheet_(LOG_SHEET, LOG_HEAD);
  const rows = log.getLastRow() > 1 ? log.getRange(2, 1, log.getLastRow() - 1, LOG_HEAD.length).getValues() : [];
  const leadSh = sheet_(LEAD_SHEET, LEAD_HEAD);
  const leadRows = leadSh.getLastRow() > 1 ? leadSh.getRange(2, 1, leadSh.getLastRow() - 1, LEAD_HEAD.length).getValues() : [];

  const leads = {};
  const live = liveList_();
  leadRows.forEach(r => { leads[r[1]] = { name: r[2], phone: String(r[3]).replace(/^'/, ''), email: r[4], service: r[5], at: +new Date(r[0]) }; });

  const nowMs = Date.now(), minutes = new Array(30).fill(0), todayH = new Array(24).fill(0);
  const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const pages = {}, users = {}, daily = {}, hours = new Array(24).fill(0), hourSec = new Array(24).fill(0);
  let views = 0, sec = 0;
  rows.forEach(r => {
    const ts = +new Date(r[0]);
    if (r[4] === 'view') {
      const ago = Math.floor((nowMs - ts) / 60000);
      if (ago >= 0 && ago < 30) minutes[29 - ago]++;
    }
    if (ts < from) return;
    const vid = r[1], type = r[4], path = r[5], s = Number(r[7]) || 0;
    const p = pages[path] || (pages[path] = { path, title: '', views: 0, sec: 0, u: {} });
    const u = users[vid] || (users[vid] = { vid, device: '', browser: '', ref: '', first: ts, last: ts, views: 0, sec: 0, sess: {}, paths: {} });
    u.first = Math.min(u.first, ts); u.last = Math.max(u.last, ts);
    if (type === 'view') {
      p.views++; p.u[vid] = 1; if (r[6]) p.title = r[6];
      u.views++; u.sess[r[2]] = 1; u.paths[path] = (u.paths[path] || 0) + 1;
      if (r[8]) u.device = r[8]; if (r[9]) u.browser = r[9]; if (r[10] && !u.ref) u.ref = r[10]; if (r[11] && !u.ref) u.ref = r[11];
      views++;
      const day = Utilities.formatDate(new Date(ts), TZ, 'yyyy-MM-dd');
      daily[day] = (daily[day] || 0) + 1;
      if (day === todayStr) todayH[Number(Utilities.formatDate(new Date(ts), TZ, 'H'))]++;
      hours[Number(Utilities.formatDate(new Date(ts), TZ, 'H'))]++;
    } else {
      p.sec += s; u.sec += s; sec += s;
      hourSec[Number(Utilities.formatDate(new Date(ts), TZ, 'H'))] += s;
    }
  });

  const pageList = Object.values(pages).map(p => ({ path: p.path, title: p.title, views: p.views, sec: p.sec, users: Object.keys(p.u).length }))
    .sort((a, b) => b.views - a.views);
  const userList = Object.values(users).map(u => ({
    vid: u.vid, device: u.device, browser: u.browser, ref: u.ref || '(trực tiếp)', first: u.first, last: u.last,
    views: u.views, sec: u.sec, sessions: Object.keys(u.sess).length,
    paths: Object.entries(u.paths).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + (v > 1 ? ' ×' + v : '')),
    lead: leads[u.vid] || null
  })).sort((a, b) => b.last - a.last);

  cache.remove('fails');
  return json_({
    ok: true, generated: Date.now(),
    totals: { views, sec, users: userList.length, leads: userList.filter(u => u.lead).length },
    pages: pageList, users: userList.slice(0, 500), daily, hours, hourSec, live, minutes, todayH, nowMs, days, today: todayStr
  });
}

/* ---------- Khái toán: gửi phiếu PDF A4 cho khách + lưu thông tin khách ---------- */
const KT_SHEET = 'KhaiToan';
const KT_HEAD = ['Thời gian', 'Mã phiếu', 'Mã khách', 'Họ tên', 'SĐT', 'Email', 'Lô đất', 'Quy mô', 'Tổng m² quy đổi', 'Gói', 'Mức / loại', 'Chi phí dự kiến', 'Đường vào', 'Gửi mail'];
const KT_NOTIFY = 'Phuocan1construction@gmail.com';   // email PA1 nhận bản sao mỗi khái toán ('' để tắt)
const KT_DAILY_MAX = 40;                              // tối đa phiếu gửi / 6 giờ (hạn mức Gmail ~100 email/ngày)

function khaiToan_(d) {
  const email = clip(d.email, 80).trim();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(email)) return json_({ ok: false, error: 'email' });
  const name = clip(d.name, 80).trim();
  if (!name) return json_({ ok: false, error: 'name' });
  const phone = clip(d.phone, 20).replace(/[^\d+ .]/g, '');
  const cache = CacheService.getScriptCache();
  const kAll = 'kt_all', kOne = 'kt_' + email.toLowerCase();
  const nAll = Number(cache.get(kAll) || 0), nOne = Number(cache.get(kOne) || 0);
  if (nAll >= KT_DAILY_MAX || nOne >= 3 || MailApp.getRemainingDailyQuota() < (KT_NOTIFY ? 2 : 1)) return json_({ ok: false, error: 'limit' });
  cache.put(kAll, String(nAll + 1), 21600); cache.put(kOne, String(nOne + 1), 21600);

  const data = ktData_(d.data || {});
  const now = new Date();
  const id = 'KT-' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const who = { name: name, phone: phone, email: email };
  const html = pa1Report(data, who, { id: id, date: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm') });
  let status = 'Đã gửi';
  try {
    const pdf = Utilities.newBlob(html, 'text/html', id + '.html').getAs('application/pdf').setName('Khai-toan-PA1-' + id + '.pdf');
    const opt = { to: email, name: 'PA1 Construction', subject: '[PA1] Khái toán diện tích & chi phí xây dựng – ' + id, htmlBody: ktMail_(name, data, id), attachments: [pdf] };
    if (KT_NOTIFY) opt.replyTo = KT_NOTIFY;
    MailApp.sendEmail(opt);
    if (KT_NOTIFY) MailApp.sendEmail({
      to: KT_NOTIFY, name: 'Website PA1', replyTo: email,
      subject: '[Khách khái toán] ' + name + ' · ' + data.total + ' m² · ' + data.range,
      htmlBody: 'Khách: <b>' + ktEsc_(name) + '</b><br>SĐT: ' + ktEsc_(phone || '—') + '<br>Email: ' + ktEsc_(email) + '<br>Quy mô: ' + ktEsc_(data.scale) + '<br>Gói: ' + ktEsc_(data.goi + ' · ' + data.pkg) + '<br>Dự kiến: <b>' + ktEsc_(data.range) + '</b>',
      attachments: [pdf]
    });
  } catch (err) { status = 'Lỗi: ' + clip(err, 80); }

  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    sheet_(KT_SHEET, KT_HEAD).appendRow([now, id, clip(d.vid, 10), safe(name, 80), safe(phone, 20), safe(email, 80), safe(data.lot, 60), safe(data.scale, 60),
      data.total, safe(data.goi, 20), safe(data.pkg, 40), safe(data.range, 40), safe(data.duong, 60), status]);
    sheet_(LEAD_SHEET, LEAD_HEAD).appendRow([now, clip(d.vid, 10), safe(name, 80), safe(phone, 20), safe(email, 80), safe('Khái toán ' + id, 40), '/khai-toan']);
  } finally { lock.releaseLock(); }
  return json_(status === 'Đã gửi' ? { ok: true, id: id } : { ok: false, error: 'mail', id: id });
}

function ktEsc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Chỉ nhận đúng các trường cần thiết, giới hạn độ dài; tổng m² tính lại ở máy chủ
function ktData_(x) {
  const s = (v, n) => clip(v, n);
  const num = (v, max) => { v = Number(v); return isFinite(v) && v > 0 ? Math.min(v, max) : 0; };
  const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 60)
    .map(r => ({ g: s(r.g, 30), label: s(r.label, 80), a: num(r.a, 100000), k: num(r.k, 300) }))
    .filter(r => r.a > 0);
  const total = Math.round(rows.reduce((t, r) => t + r.a * r.k / 100, 0) * 10) / 10;
  return {
    lot: s(x.lot, 60), scale: s(x.scale, 60), mong: s(x.mong, 40), logioi: s(x.logioi, 40), duong: s(x.duong, 60), hem: s(x.hem, 30), mua: s(x.mua, 40),
    rows: rows, total: total, goi: s(x.goi, 20), pkg: s(x.pkg, 40), price: s(x.price, 40), range: s(x.range, 40), xayTho: !!x.xayTho
  };
}

function ktMail_(name, d, id) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.6">' +
    '<p>Chào anh/chị <b>' + ktEsc_(name) + '</b>,</p>' +
    '<p>PA1 Construction gửi anh/chị phiếu khái toán <b>' + ktEsc_(id) + '</b> (file PDF đính kèm):</p>' +
    '<table style="border-collapse:collapse;font-size:14px">' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Tổng diện tích quy đổi</td><td><b>' + ktEsc_(String(d.total).replace('.', ',')) + ' m²</b></td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Gói thi công</td><td>' + ktEsc_(d.goi + ' · ' + d.pkg) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Chi phí dự kiến</td><td><b>' + ktEsc_(d.range) + '</b></td></tr></table>' +
    '<p>Đây là số liệu tham khảo. PA1 khảo sát hiện trạng miễn phí để báo giá chi tiết — anh/chị chỉ cần trả lời email này hoặc gọi <b>0523.023.023</b>.</p>' +
    '<p>Trân trọng,<br><b>PA1 Construction</b> · Dự án chất, PA1 lo tất<br>phuocan1construction.com</p></div>';
}

/* Mẫu phiếu PDF A4 — giống hệt hàm trong src/pages/khai-toan.astro */
function pa1Report(d, who, meta) {
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f(n, k) { k = k == null ? 1 : k; var p = Math.pow(10, k), x = (Math.round(Number(n || 0) * p) / p).toFixed(k).split('.'); x[0] = x[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return x.join(','); }
  var rows = '', last = '';
  (d.rows || []).forEach(function (r) {
    if (r.g !== last) { rows += '<tr class="g"><td colspan="4">' + e(r.g) + '</td></tr>'; last = r.g; }
    rows += '<tr><td>' + e(r.label) + '</td><td class="n">' + f(r.a) + '</td><td class="n">' + e(r.k) + '%</td><td class="n">' + f(r.a * r.k / 100) + '</td></tr>';
  });
  function kv(list) { var h = ''; for (var i = 0; i < list.length; i += 2) { h += '<tr>' + [list[i], list[i + 1]].map(function (x) { return x ? '<td class="l">' + e(x[0]) + '</td><td>' + e(x[1] || '—') + '</td>' : '<td></td><td></td>'; }).join('') + '</tr>'; } return '<table class="kv">' + h + '</table>'; }
  var css = '@page{size:A4;margin:11mm 13mm 11mm}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:9.5pt;margin:0;line-height:1.35}' +
    '.hd{width:100%;border-collapse:collapse;border-bottom:3px solid #F2B529}.hd td{padding:0 0 8px;vertical-align:bottom}' +
    '.brand{font-size:16pt;font-weight:bold;letter-spacing:.5px}.slogan{color:#8a6a10;font-style:italic;font-size:9.5pt}' +
    '.ct{text-align:right;font-size:8.5pt;color:#555;line-height:1.5}' +
    'h1{font-size:14pt;text-align:center;margin:10px 0 2px;letter-spacing:.5px}.sub{text-align:center;color:#666;font-size:9pt;margin:0 0 10px}' +
    'h2{font-size:10pt;background:#1a1a1a;color:#fff;padding:4px 8px;margin:10px 0 4px}' +
    'table{width:100%;border-collapse:collapse}.kv td{padding:3px 6px;border-bottom:1px solid #e5e0d4;vertical-align:top}.kv td.l{width:17%;color:#666;white-space:nowrap}' +
    '.t th{background:#f4ead3;text-align:left;font-size:8.5pt;padding:4px 6px;border-bottom:1px solid #d9c9a0}.t th.n{text-align:right}' +
    '.t td{padding:2.5px 6px;border-bottom:1px solid #eee}.t .n{text-align:right;white-space:nowrap}' +
    '.t tr.g td{font-weight:bold;color:#8a6a10;background:#fbf7ec;font-size:8pt;text-transform:uppercase;letter-spacing:.5px}' +
    '.t tr.tot td{font-weight:bold;font-size:11.5pt;border-top:2px solid #1a1a1a;border-bottom:0;padding-top:6px}' +
    '.big{border:2px solid #F2B529;background:#fffaf0;padding:8px;text-align:center;margin-top:8px}.big .k{font-size:9pt;color:#666;text-transform:uppercase;letter-spacing:1px}.big .v{font-size:20pt;font-weight:bold;margin-top:2px}' +
    '.note{font-size:8pt;color:#555;margin-top:8px}.note ul{margin:4px 0 0 16px;padding:0}' +
    '.ft{margin-top:10px;border-top:1px solid #ccc;padding-top:6px;font-size:8pt;color:#777;text-align:center}';
  return '<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><title>Khái toán ' + e(meta.id) + '</title><style>' + css + '</style></head><body>' +
    '<table class="hd"><tr><td><div class="brand">PHƯỚC AN 1 CONSTRUCTION</div><div class="slogan">Dự án chất, PA1 lo tất</div></td>' +
    '<td class="ct">Hotline: 0523.023.023<br>Phuocan1construction@gmail.com<br>phuocan1construction.com</td></tr></table>' +
    '<h1>PHIẾU KHÁI TOÁN DIỆN TÍCH &amp; CHI PHÍ XÂY DỰNG</h1>' +
    '<p class="sub">Mã phiếu: <b>' + e(meta.id) + '</b> &nbsp;·&nbsp; Ngày lập: ' + e(meta.date) + '</p>' +
    '<h2>1. Khách hàng &amp; công trình</h2>' +
    kv([['Khách hàng', who.name], ['Điện thoại', who.phone], ['Email', who.email], ['Lô đất', d.lot], ['Quy mô', d.scale], ['Móng', d.mong], ['Lộ giới trước nhà', d.logioi], ['Đường vào', d.duong], ['Dự kiến khởi công', d.mua]]) +
    '<h2>2. Diện tích xây dựng quy đổi</h2>' +
    '<table class="t"><thead><tr><th>Hạng mục</th><th class="n">Diện tích (m²)</th><th class="n">Hệ số</th><th class="n">Quy đổi (m²)</th></tr></thead><tbody>' + rows +
    '<tr class="tot"><td colspan="3">TỔNG DIỆN TÍCH QUY ĐỔI</td><td class="n">' + f(d.total) + '</td></tr></tbody></table>' +
    '<h2>3. Chi phí dự kiến</h2>' +
    kv([['Gói thi công', d.goi + ' · ' + d.pkg], ['Đơn giá', d.price], ['Phát sinh đường vào', d.hem], ['Diện tích tính giá', f(d.total) + ' m²']]) +
    '<div class="big"><div class="k">Chi phí dự kiến</div><div class="v">' + e(d.range) + '</div></div>' +
    '<div class="note"><b>Ghi chú</b><ul>' +
    '<li>Khái toán mang tính tham khảo, theo bảng giá PA1 hiện hành và số liệu khách hàng tự nhập.</li>' +
    (d.xayTho ? '<li>Gói Xây thô chưa gồm vật tư hoàn thiện (gạch ốp lát, sơn, thiết bị vệ sinh, cửa…).</li>' : '') +
    '<li>Chưa gồm chi phí thiết kế, xin phép xây dựng, điện nước kéo từ ngoài vào, nội thất rời.</li>' +
    '<li>Phát sinh đường vào áp dụng cho hẻm nhỏ do vận chuyển vật tư thủ công, thi công bằng máy nhỏ.</li>' +
    '<li>PA1 khảo sát hiện trạng miễn phí để báo giá chi tiết và chính xác.</li></ul></div>' +
    '<div class="ft">PA1 Construction · Đại diện: Nguyễn Hữu Phước · 243/15A Bình Thung, Đông Hòa, TP. Hồ Chí Minh</div>' +
    '</body></html>';
}
