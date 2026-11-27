(function () {
'use strict';
// 電腦與手機同步（電腦版與手機版共用）
// 雲端是使用者自己的 Apps Script：pull 取回整本帳與版本號，push 帶著取回時的版本號存回；
// 版本號不同代表別的裝置剛存過，就重新取回、合併再存。
const M = typeof module !== 'undefined' && module.exports ? require('./model') : window.Model;

// 連線代碼：把網址與密碼包成一串文字，電腦複製、手機貼上
function makeCode(url, token) {
  const raw = JSON.stringify({ u: url, t: token });
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(raw, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(raw)));
  return 'AL1-' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function readCode(code) {
  const m = String(code || '').trim().match(/^AL1-([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const raw = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64)));
    const j = JSON.parse(raw);
    if (!/^https:\/\/script\.google\.com\//.test(j.u || '') && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(j.u || '')) return null;
    return { url: j.u, token: String(j.t || '') };
  } catch (e) { return null; }
}

// call(body) → 回傳 Apps Script 的 JSON；db 是這台裝置目前的帳本
async function syncBook(db, call) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pulled = await call({ action: 'pull', book: db.book });
    if (!pulled || !pulled.scriptVer) throw new Error('同步腳本是舊版：請到「Google 表格同步」頁按「複製同步腳本」，貼到 Apps Script 取代後，再到「部署 › 管理部署作業」編輯成新版本');
    const merged = M.mergeDbs(db, pulled.data || null);
    merged.book = db.book;
    merged.meta = Object.assign({}, db.meta, { seq: merged.meta.seq });
    const payload = M.syncPayload(merged);
    let same = false;
    if (pulled.data) {
      const remote = M.normalizeDb(Object.assign({}, pulled.data, { book: db.book }), db.book);
      remote.meta.seq = pulled.data.seq || {};
      same = JSON.stringify(payload) === JSON.stringify(M.syncPayload(remote));
    }
    let ver = pulled.ver || 0;
    if (!same) {
      const pushed = await call({ action: 'push', book: db.book, baseVer: ver, data: payload });
      if (pushed.conflict) continue;
      ver = pushed.ver;
    }
    merged.meta.cloud = { ver, at: new Date().toISOString(), error: '' };
    return { db: merged, result: { ok: true, ver, pushed: !same } };
  }
  throw new Error('其他裝置正在同步，請稍後再試');
}

const API = { makeCode, readCode, syncBook };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.Cloud = API;
})();
