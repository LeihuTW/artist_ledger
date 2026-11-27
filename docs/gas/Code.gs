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
    if (!TOKEN || body.token !== TOKEN) return out_({ ok: false, error: '同步密碼不正確，請重新複製腳本貼上並重新部署' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // 電腦與手機同步：pull 取回整本帳、push 存回（版本號不同代表別的裝置剛存過，請對方重新合併）
      if (body.action === 'pull') return out_(pullBook_(ss, body.book));
      if (body.action === 'push') return out_(pushBook_(ss, body.book, body.baseVer, body.data));
      (body.sheets || []).forEach(function (sh) { writeSheet_(ss, sh); });
      if (body.page) savePage_(ss, body.page, body.pageTitle || '委託排單');
    } finally { lock.releaseLock(); }
    return out_({ ok: true, url: ss.getUrl(), ver: 3 });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

// 公開排單網頁：把這個 /exec 網址分享出去，任何人都能看（只會看到公開排單的內容）
function doGet() {
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
  if (!ws || ws.getLastRow() < 2) return { ok: true, ver: 0, data: null, scriptVer: 3 };
  var ver = Number(ws.getRange(1, 1).getValue()) || 0;
  var json = ws.getRange(2, 1, ws.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }).join('');
  return { ok: true, ver: ver, data: json ? JSON.parse(json) : null, scriptVer: 3 };
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
