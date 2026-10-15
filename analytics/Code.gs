/* =========================================================
   PA1 — THỐNG KÊ TRUY CẬP WEBSITE (Google Apps Script)
   Dán toàn bộ file này vào một dự án Apps Script (script.google.com). Dữ liệu ghi vào Sheet theo SHEET_ID.
   1) Đổi ADMIN_PASSWORD bên dưới.
   2) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
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
