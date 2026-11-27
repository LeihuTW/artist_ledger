/**
 * 繪師委託帳本 → Google 表格同步腳本
 * 使用方式請看工具內「Google 表格同步」頁面的步驟說明。
 * 只要把整段貼到 Google 表格的「擴充功能 › Apps Script」裡，然後部署成「網頁應用程式」。
 */
var TOKEN = '__TOKEN__'; // 要跟工具裡顯示的同步密碼一樣

var COLORS = { head: '#1E3F3B', headText: '#FFFFFF', title: '#2F5D57', sub: '#F1EEE7' };

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    // 共享個案：對方（不知道同步密碼）只能用網址裡的個案代碼讀取與留言
    if (body.action === 'caseGet') return out_(caseGet_(body.key));
    if (body.action === 'caseReply') return out_(caseReply_(body.key, body.id, body.name, body.text));
    if (!TOKEN || body.token !== TOKEN) return out_({ ok: false, error: '同步密碼不正確，請重新複製腳本貼上並重新部署' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // 電腦與手機同步：pull 取回整本帳、push 存回（版本號不同代表別的裝置剛存過，請對方重新合併）
      if (body.action === 'pull') return out_(pullBook_(ss, body.book));
      if (body.action === 'push') return out_(pushBook_(ss, body.book, body.baseVer, body.data));
      if (body.action === 'caseSave') return out_(caseSave_(body.items || [], body.remove || []));
      (body.sheets || []).forEach(function (sh) { writeSheet_(ss, sh); });
      if (body.page) savePage_(ss, body.page, body.pageTitle || '委託排單');
    } finally { lock.releaseLock(); }
    return out_({ ok: true, url: ss.getUrl(), ver: 4 });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

// 公開排單網頁：把這個 /exec 網址分享出去，任何人都能看（只會看到公開排單的內容）
function doGet(e) {
  var key = e && e.parameter && e.parameter.c;
  if (key) return casePage_(String(key));
  var ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PAGE_SHEET);
  var html = '<p style="font-family:sans-serif;padding:40px;text-align:center">排單頁還沒有建立，請在繪師委託帳本按一次「立即同步」。</p>';
  var title = '委託排單';
  if (ws && ws.getLastRow() > 1) {
    title = ws.getRange(1, 1).getValue() || title;
    html = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }).join('');
  }
  return HtmlService.createHtmlOutput(html).setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var PAGE_SHEET = '_公開排單網頁';
function savePage_(ss, html, title) {
  var ws = ss.getSheetByName(PAGE_SHEET) || ss.insertSheet(PAGE_SHEET);
  ws.clear();
  var rows = [[title]];
  for (var i = 0; i < html.length; i += 40000) rows.push([html.substr(i, 40000)]);
  ws.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows); // 純文字，避免被當成公式
  ws.hideSheet();
}

// 整本帳以 JSON 分段存在隱藏工作表（每格 4 萬字），不需要額外的雲端硬碟權限
function bookSheetName_(book) { return '_帳本同步_' + (book === 'client' ? 'client' : 'artist'); }
function pullBook_(ss, book) {
  var ws = ss.getSheetByName(bookSheetName_(book));
  if (!ws || ws.getLastRow() < 2) return { ok: true, ver: 0, data: null, scriptVer: 4 };
  var ver = Number(ws.getRange(1, 1).getValue()) || 0;
  var json = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }).join('');
  return { ok: true, ver: ver, data: json ? JSON.parse(json) : null, scriptVer: 4 };
}
function pushBook_(ss, book, baseVer, data) {
  var name = bookSheetName_(book);
  var ws = ss.getSheetByName(name) || ss.insertSheet(name);
  var cur = ws.getLastRow() >= 1 ? (Number(ws.getRange(1, 1).getValue()) || 0) : 0;
  if (Number(baseVer || 0) !== cur) return { ok: true, conflict: true, ver: cur };
  var json = JSON.stringify(data || {});
  var rows = [[cur + 1]];
  for (var i = 0; i < json.length; i += 40000) rows.push([json.substr(i, 40000)]);
  ws.clear();
  ws.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
  ws.hideSheet();
  return { ok: true, ver: cur + 1 };
}

function writeSheet_(ss, sh) {
  var ws = ss.getSheetByName(sh.name) || ss.insertSheet(sh.name);
  ws.clear();
  var r = 1;
  var width = sh.header.length;
  if (sh.title) {
    ws.getRange(r, 1).setValue(sh.title).setFontSize(14).setFontWeight('bold').setFontColor(COLORS.title);
    r++;
  }
  ws.getRange(r, 1).setValue('更新時間：' + sh.updated).setFontColor('#5E5A53');
  r++;
  ws.getRange(r, 1, 1, width).setValues([sh.header])
    .setBackground(COLORS.head).setFontColor(COLORS.headText).setFontWeight('bold');
  ws.setFrozenRows(r);
  var start = r + 1;
  if (sh.rows && sh.rows.length) {
    var rows = sh.rows.map(function (row) {
      var a = row.slice(0, width);
      while (a.length < width) a.push('');
      return a;
    });
    ws.getRange(start, 1, rows.length, width).setValues(rows);
    // 斑馬紋
    for (var i = 0; i < rows.length; i += 2) ws.getRange(start + i, 1, 1, width).setBackground(COLORS.sub);
  }
  ws.autoResizeColumns(1, width);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ───────── 共享個案頁 ─────────
var CASE_SHEET = '_共享個案', REPLY_SHEET = '_個案留言';
var KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
function caseSheet_() { var ss = SpreadsheetApp.getActiveSpreadsheet(); var ws = ss.getSheetByName(CASE_SHEET); if (!ws) { ws = ss.insertSheet(CASE_SHEET); ws.hideSheet(); } return ws; }
function replySheet_() { var ss = SpreadsheetApp.getActiveSpreadsheet(); var ws = ss.getSheetByName(REPLY_SHEET); if (!ws) { ws = ss.insertSheet(REPLY_SHEET); ws.hideSheet(); } return ws; }
function caseRows_() { var ws = caseSheet_(); var n = ws.getLastRow(); return n ? ws.getRange(1, 1, n, 2).getValues() : []; }
function findCase_(key) {
  if (!KEY_RE.test(String(key || ''))) return null;
  var rows = caseRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i][0] === key) { try { return JSON.parse(rows[i][1]); } catch (err) { return null; } }
  return null;
}
function repliesFor_(keys) {
  var ws = replySheet_(), n = ws.getLastRow(), out = {};
  keys.forEach(function (k) { out[k] = []; });
  if (!n) return out;
  ws.getRange(1, 1, n, 5).getValues().forEach(function (r) { if (out[r[0]]) out[r[0]].push({ id: r[1], name: r[2], text: r[3], at: r[4] }); });
  return out;
}
function caseSave_(items, remove) {
  var ws = caseSheet_(), rows = caseRows_(), map = {}, keys = [];
  rows.forEach(function (r) { if (r[0]) map[r[0]] = r[1]; });
  remove.forEach(function (k) { delete map[k]; });
  items.forEach(function (it) {
    if (!it || !KEY_RE.test(String(it.key || ''))) return;
    var d = it.data || {};
    var json = JSON.stringify(d);
    while (json.length > 45000 && d.thread && d.thread.length) { d.thread.shift(); json = JSON.stringify(d); }
    map[it.key] = json; keys.push(it.key);
  });
  var out = Object.keys(map).map(function (k) { return [k, map[k]]; });
  ws.clear();
  if (out.length) ws.getRange(1, 1, out.length, 2).setNumberFormat('@').setValues(out);
  return { ok: true, cases: true, replies: repliesFor_(keys), ver: 4 };
}
function caseGet_(key) {
  var d = findCase_(key);
  if (!d) return { ok: true, gone: true, cases: true };
  return { ok: true, cases: true, data: d, replies: repliesFor_([key])[key] };
}
function caseReply_(key, id, name, text) {
  text = String(text || '').trim().slice(0, 1000); name = String(name || '').trim().slice(0, 40); id = String(id || '').slice(0, 40);
  if (!text) return { ok: false, error: '留言是空的' };
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) id = Utilities.getUuid();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (!findCase_(key)) return { ok: false, error: '這個個案已經停止分享' };
    var ws = replySheet_(), n = ws.getLastRow(), count = 0;
    if (n) {
      var rows = ws.getRange(1, 1, n, 2).getValues();
      for (var i = 0; i < rows.length; i++) { if (rows[i][0] === key) { count++; if (rows[i][1] === id) return { ok: true, dup: true }; } }
    }
    if (count >= 500) return { ok: false, error: '這一單的留言已經太多了，請改用其他方式聯絡' };
    // 先設成純文字再寫入，留言開頭是 = 也不會被當成公式
    ws.getRange(n + 1, 1, 1, 5).setNumberFormat('@').setValues([[key, id, name, text, new Date().toISOString()]]);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
// 網頁上的留言表單呼叫這個（google.script.run）
function webReply(key, name, text) { return caseReply_(key, 'w' + Utilities.getUuid().replace(/-/g, ''), name, text); }

function h_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function casePage_(key) {
  var d = findCase_(key);
  var css = '<style>body{margin:0;font-family:"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif;background:#F4F2EC;color:#26302E;line-height:1.6}'
    + '.wrap{max-width:720px;margin:0 auto;padding:20px 16px 60px}.card{background:#fff;border:1px solid #E2DED3;border-radius:14px;padding:18px 20px;margin-top:14px}'
    + 'h1{font-size:22px;margin:0}.sub{color:#6B746F;font-size:14px}.bar{display:flex;gap:4px;margin:12px 0 6px}.bar i{flex:1;height:8px;border-radius:4px;background:#E2DED3}.bar i.on{background:#2A6B60}'
    + '.st{display:flex;flex-wrap:wrap;gap:6px;font-size:13px}.st span{padding:2px 10px;border-radius:12px;background:#F1EEE7;color:#6B746F}.st span.on{background:#2A6B60;color:#fff}'
    + 'h2{font-size:16px;margin:0 0 8px;color:#2A6B60}.ms{display:flex;justify-content:space-between;border-bottom:1px solid #F1EEE7;padding:6px 0;font-size:14px}.ms.done{color:#8A918D;text-decoration:line-through}'
    + '.msg{margin:10px 0;max-width:85%}.msg .b{padding:9px 13px;border-radius:14px;background:#F1EEE7;white-space:pre-wrap;word-break:break-word}.msg.me{margin-left:auto}.msg.me .b{background:#2A6B60;color:#fff}.msg .n{font-size:12px;color:#8A918D;margin:0 4px 2px}'
    + 'textarea,input{width:100%;box-sizing:border-box;font:inherit;padding:9px 12px;border:1px solid #D5D0C4;border-radius:10px;margin-top:6px}button{margin-top:10px;font:inherit;background:#1E3F3B;color:#fff;border:0;border-radius:10px;padding:10px 20px}'
    + '.foot{margin-top:24px;text-align:center;font-size:12px;color:#8A918D}</style>';
  if (!d) return HtmlService.createHtmlOutput(css + '<div class="wrap"><div class="card"><h1>找不到這個個案</h1><p class="sub">分享的人可能已經停止分享，或網址不完整。</p></div></div>').setTitle('共享個案').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  var stages = d.stages || [], idx = Number(d.stage) || 0;
  var html = css + '<div class="wrap"><div class="card"><div class="sub">' + h_(d.owner ? d.owner + ' 分享的委託' : '共享的委託') + (d.code ? '｜' + h_(d.code) : '') + '</div><h1>' + h_(d.title) + '</h1>';
  html += '<div class="bar">' + stages.map(function (s, i) { return '<i class="' + (i <= idx ? 'on' : '') + '"></i>'; }).join('') + '</div>';
  html += '<div class="st">' + stages.map(function (s, i) { return '<span class="' + (i === idx ? 'on' : '') + '">' + h_(s) + '</span>'; }).join('') + '</div>';
  html += '<p class="sub" style="margin:10px 0 0">' + (d.closed ? '已結案' : '目前進度：' + h_(stages[idx] || '')) + (d.deadline ? '｜交稿日 ' + h_(d.deadline) : '') + '</p>';
  if (d.pay) html += '<p class="sub" style="margin:4px 0 0">金額 ' + h_(d.pay.currency) + ' ' + Number(d.pay.price).toLocaleString() + '｜已付 ' + h_(d.pay.currency) + ' ' + Number(d.pay.paid).toLocaleString() + '</p>';
  html += '</div>';
  if (d.milestones && d.milestones.length) html += '<div class="card"><h2>階段日期</h2>' + d.milestones.map(function (m) { return '<div class="ms' + (m.done ? ' done' : '') + '"><span>' + h_(m.name) + '</span><span>' + h_(m.date) + '</span></div>'; }).join('') + '</div>';
  if (d.note) html += '<div class="card"><h2>備註</h2><div style="white-space:pre-wrap">' + h_(d.note) + '</div></div>';
  var seen = {}, msgs = [];
  (d.thread || []).forEach(function (m) { seen[m.id] = 1; msgs.push(m); });
  (repliesFor_([key])[key] || []).forEach(function (m) { if (!seen[m.id]) { m.who = 'guest'; msgs.push(m); } });
  msgs.sort(function (a, b) { return String(a.at) < String(b.at) ? -1 : 1; });
  html += '<div class="card"><h2>對話</h2>' + (msgs.length ? msgs.map(function (m) {
    return '<div class="msg' + (m.who === 'owner' ? '' : ' me') + '"><div class="n">' + h_(m.name || (m.who === 'owner' ? d.owner : '你')) + '・' + h_(String(m.at || '').slice(0, 16).replace('T', ' ')) + '</div><div class="b">' + h_(m.text) + '</div></div>';
  }).join('') : '<p class="sub">還沒有訊息。</p>');
  html += '<form id="f"><input id="nm" maxlength="40" placeholder="你的名字"><textarea id="tx" rows="3" maxlength="1000" placeholder="留言給' + h_(d.owner || '對方') + '" required></textarea><button id="bt">送出留言</button><p id="msg" class="sub"></p></form></div>';
  html += '<div class="foot">繪師委託帳本・共享個案頁　留言會在對方下次同步時收到</div></div>';
  html += '<script>var K=' + JSON.stringify(key) + ';try{document.getElementById("nm").value=localStorage.getItem("al-name")||""}catch(e){}'
    + 'document.getElementById("f").onsubmit=function(ev){ev.preventDefault();var n=document.getElementById("nm").value,t=document.getElementById("tx").value.trim();if(!t)return;'
    + 'try{localStorage.setItem("al-name",n)}catch(e){}document.getElementById("bt").disabled=true;document.getElementById("msg").textContent="送出中…";'
    + 'google.script.run.withSuccessHandler(function(r){if(r&&r.ok){document.getElementById("tx").value="";document.getElementById("msg").textContent="已送出，對方下次同步時就會收到。重新整理頁面就能看到。"}else{document.getElementById("msg").textContent=(r&&r.error)||"送出失敗"}document.getElementById("bt").disabled=false})'
    + '.withFailureHandler(function(){document.getElementById("msg").textContent="送出失敗，請稍後再試";document.getElementById("bt").disabled=false}).webReply(K,n,t)};</script>';
  return HtmlService.createHtmlOutput(html).setTitle(d.title ? d.title + '｜共享個案' : '共享個案').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
