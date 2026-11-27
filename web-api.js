/* 繪師委託帳本｜手機版（PWA）
 * 電腦版由 Electron 的 preload 提供 window.api；手機版在瀏覽器裡用 IndexedDB 做出同樣的 window.api，
 * 畫面（app.js）兩邊共用。資料存在這支手機的瀏覽器裡，另外可以透過使用者自己的 Apps Script 和電腦同步。
 */
(function () {
'use strict';
const M = window.Model, Sh = window.Sheets, Cloud = window.Cloud;
const VERSION = '1.4.2';
const DBNAME = 'artist-ledger';

// ───────── IndexedDB ─────────
let idb = null;
function openIdb() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DBNAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
    r.onsuccess = () => { idb = r.result; resolve(idb); };
    r.onerror = () => reject(r.error);
  });
}
function tx(store, mode, fn) {
  return openIdb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode); const os = t.objectStore(store);
    const req = fn(os);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  }));
}
const kvGet = (k) => tx('kv', 'readonly', (os) => os.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', (os) => os.put(v, k));
const fileGet = (k) => tx('files', 'readonly', (os) => os.get(k));
const fileSet = (k, v) => tx('files', 'readwrite', (os) => os.put(v, k));
const fileDel = (k) => tx('files', 'readwrite', (os) => os.delete(k));
const fileKeys = () => tx('files', 'readonly', (os) => os.getAllKeys());

// ───────── 狀態 ─────────
const st = { config: null, dbs: {}, urls: new Map(), listeners: { db: [], cloud: [], sync: [], backup: [] }, cloudRunning: {} };
const cur = () => st.dbs[st.config.book];
const emit = (k, v) => st.listeners[k].forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });

async function saveDb(db) {
  await kvSet('db-' + db.book, JSON.parse(JSON.stringify(db)));
}
async function saveConfig() { await kvSet('config', st.config); }

const ready = (async () => {
  st.config = Object.assign({ book: 'artist', cloud: { url: '', token: '', auto: true } }, (await kvGet('config')) || {});
  st.config.cloud = Object.assign({ url: '', token: '', auto: true }, st.config.cloud || {});
  for (const b of M.BOOKS) {
    const raw = await kvGet('db-' + b);
    const db = M.normalizeDb(raw || null, b); db.book = b;
    if (!raw) M.stampChanges(null, db);
    st.dbs[b] = db;
  }
  // 圖片先做好網址，畫面才能同步拿到
  for (const k of (await fileKeys()) || []) {
    const rec = await fileGet(k);
    if (rec && rec.blob) st.urls.set(k, URL.createObjectURL(rec.blob));
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();

// ───────── 檔案 ─────────
const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-120);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2));
async function importOne(file, kind) {
  const id = uuid();
  const rel = ['files', kind || 'misc', M.today().slice(0, 7), `${id.slice(0, 8)}_${safeName(file.name)}`].join('/');
  await fileSet(rel, { blob: file, name: file.name, size: file.size, type: file.type });
  st.urls.set(rel, URL.createObjectURL(file));
  return { id, file: rel, name: file.name, size: file.size, addedAt: M.today(), addedTs: Date.now(), caption: '' };
}
function pick(opts) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (opts && opts.images) inp.accept = 'image/*';
    if (!(opts && opts.single)) inp.multiple = true;
    inp.style.display = 'none';
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const RISKY = /\.(exe|com|bat|cmd|ps1|vbs|js|msi|scr|lnk|hta|jar|reg|dll|apk)$/i;

// ───────── Google 表格與雲端同步 ─────────
async function postScript(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('回應不是 JSON，請確認網址是「網頁應用程式」的 /exec 網址，且存取權設為「所有人」'); }
}
function cloudConf() {
  const c = st.config.cloud;
  if (c.url && c.token) return { url: c.url, token: c.token };
  for (const db of Object.values(st.dbs)) { const s = db.settings.sync; if (s.url && s.token) return { url: s.url, token: s.token }; }
  return { url: '', token: '' };
}
function cloudInfo() {
  const eff = cloudConf();
  return { url: st.config.cloud.url, token: st.config.cloud.token, auto: st.config.cloud.auto, effective: eff, code: eff.url && eff.token ? Cloud.makeCode(eff.url, eff.token) : '' };
}
async function casePost(url, body) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url || ''))) throw new Error('共享個案網址不正確');
  try { return await postScript(url, body); } catch (e) { throw new Error('對方的共享個案網址沒有回應，可能已經停止分享'); }
}
const myName = (db) => (db.settings.profile && db.settings.profile.nickname) || db.settings.artistName || '';
const anyCaseWork = () => M.BOOKS.some((b) => Cloud.hasCaseWork(st.dbs[b]));
async function runCloud(book) {
  const conf = cloudConf();
  if (!conf.url && !Cloud.hasCaseWork(st.dbs[book])) return { ok: false, error: '還沒有設定同步' };
  if (st.cloudRunning[book]) return { ok: false, error: '同步進行中' };
  st.cloudRunning[book] = true;
  emit('cloud', { book, running: true });
  let result;
  const db = st.dbs[book];
  try {
    const call = async (b) => { const j = await postScript(conf.url, Object.assign({ token: conf.token }, b)); if (j.ok === false && j.error) throw new Error(j.error); return j; };
    const cr = await Cloud.syncCases(db, { call: conf.url ? call : null, post: casePost, myName: myName(db) });
    if (conf.url) { const r = await Cloud.syncBook(db, call); st.dbs[book] = r.db; result = Object.assign(r.result, { incoming: cr.incoming }); }
    else result = { ok: true, casesOnly: true, incoming: cr.incoming };
  } catch (e) {
    db.meta.cloud = Object.assign({}, db.meta.cloud || {}, { error: e.message, errorAt: new Date().toISOString() });
    result = { ok: false, error: e.message };
  }
  st.cloudRunning[book] = false;
  await saveDb(st.dbs[book]);
  if (book === st.config.book) emit('db', JSON.parse(JSON.stringify(st.dbs[book])));
  emit('cloud', { book, running: false, result });
  return result;
}
let cloudTimer = null;
function scheduleCloud() {
  if (!(cloudConf().url || anyCaseWork()) || !st.config.cloud.auto) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => { runCloud(st.config.book); }, 15000);
}
async function runCloudAll() { const out = {}; for (const b of M.BOOKS) out[b] = await runCloud(b); return out; }
ready.then(() => {
  const on = () => (cloudConf().url || anyCaseWork()) && st.config.cloud.auto;
  setTimeout(() => { if (on()) runCloudAll(); }, 3000);
  setInterval(() => { if (on() && document.visibilityState === 'visible') runCloudAll(); }, 5 * 60 * 1000);
  // 從背景切回來時拉一次最新資料
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && on()) runCloud(st.config.book); });
});

async function runSheets() {
  const db = cur(), s = db.settings.sync;
  if (!s.url) return { ok: false, error: '還沒有填 Apps Script 網址' };
  emit('sync', { running: true });
  let result;
  try {
    const payload = { token: s.token, sheets: Sh.syncSheets(db) };
    if (s.sheets.public && db.book !== 'client' && window.PublicPage) { payload.page = window.PublicPage.render(db); payload.pageTitle = `${db.settings.artistName || '繪師'} 的委託排單`; }
    const j = await postScript(s.url, payload);
    if (!j.ok) throw new Error(j.error || '同步失敗');
    db.meta.lastSync = new Date().toISOString(); db.meta.lastSyncError = null;
    if (j.url) db.meta.sheetUrl = j.url;
    db.meta.pageVer = j.ver || 1;
    result = { ok: true, sheetUrl: j.url || '' };
  } catch (e) {
    db.meta.lastSyncError = { at: new Date().toISOString(), message: e.message };
    result = { ok: false, error: e.message };
  }
  await saveDb(db);
  emit('sync', { running: false, result });
  return result;
}
let sheetTimer = null;

// ───────── 備份檔（手機）─────────
const blobToB64 = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.readAsDataURL(blob); });
function b64ToBlob(b64, type) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: type || 'application/octet-stream' }); }
async function exportBackup() {
  const files = {};
  const refs = new Set(M.BOOKS.flatMap((b) => M.allFileRefs(st.dbs[b])));
  for (const rel of refs) { const rec = await fileGet(rel); if (rec) files[rel] = { name: rec.name, type: rec.type, data: await blobToB64(rec.blob) }; }
  const out = { app: 'ArtistLedger', kind: 'backup', version: VERSION, at: new Date().toISOString(), books: st.dbs, files };
  download(`繪師委託帳本-手機備份-${M.today()}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
  const at = new Date().toISOString();
  for (const b of M.BOOKS) { st.dbs[b].meta.lastBackup = { at, results: [{ folder: '下載資料夾', ok: true, copied: Object.keys(files).length }] }; await saveDb(st.dbs[b]); }
  return { ok: true, results: [] };
}
async function importBackup() {
  const [f] = await pick({ single: true });
  if (!f) return { ok: false };
  let j; try { j = JSON.parse(await f.text()); } catch (e) { return { ok: false, error: '這不是繪師委託帳本的備份檔' }; }
  if (!j || j.app !== 'ArtistLedger' || !j.books) return { ok: false, error: '這不是繪師委託帳本的備份檔' };
  if (!confirm('確定要用這份備份取代手機裡目前的資料嗎？')) return { ok: false };
  for (const [rel, rec] of Object.entries(j.files || {})) {
    const blob = b64ToBlob(rec.data, rec.type);
    await fileSet(rel, { blob, name: rec.name, size: blob.size, type: rec.type });
    st.urls.set(rel, URL.createObjectURL(blob));
  }
  for (const b of M.BOOKS) if (j.books[b]) { const db = M.normalizeDb(j.books[b], b); db.book = b; st.dbs[b] = db; await saveDb(db); }
  return { ok: true, previous: '（手機裡原本的資料已被取代）' };
}

// ───────── window.api ─────────
window.api = {
  getDb: async () => { await ready; return JSON.parse(JSON.stringify(cur())); },
  putDb: async (db) => {
    await ready;
    const prev = cur();
    const next = M.normalizeDb(db, prev.book);
    next.book = prev.book; next.meta = prev.meta;
    M.stampChanges(prev, next);
    st.dbs[prev.book] = next;
    await saveDb(next);
    scheduleCloud();
    if (next.settings.sync.auto && next.settings.sync.url) { clearTimeout(sheetTimer); sheetTimer = setTimeout(runSheets, 20000); }
    return true;
  },
  nextCode: async () => { await ready; const c = M.nextCode(cur()); await saveDb(cur()); return c; },
  onDbChanged: (fn) => st.listeners.db.push(fn),
  onNav: () => {},
  onBackupState: (fn) => st.listeners.backup.push(fn),
  onSyncState: (fn) => st.listeners.sync.push(fn),
  switchBook: async (b) => { await ready; if (M.BOOKS.includes(b)) { st.config.book = b; await saveConfig(); } return JSON.parse(JSON.stringify(cur())); },
  runCloud: () => runCloudAll(),
  cloudGet: async () => { await ready; return cloudInfo(); },
  cloudSet: async (c) => {
    await ready; c = c || {};
    if (typeof c.code === 'string') { const r = Cloud.readCode(c.code); if (!r) return { error: '連線代碼不正確，請從電腦版重新複製' }; st.config.cloud.url = r.url; st.config.cloud.token = r.token; }
    if (typeof c.auto === 'boolean') st.config.cloud.auto = c.auto;
    await saveConfig();
    return cloudInfo();
  },
  onCloudState: (fn) => st.listeners.cloud.push(fn),

  setZoom: (f) => {
    // 網頁版用 CSS zoom；vh 不會跟著縮放，所以另外給 --vh 讓對話框高度正確
    const n = Number(f), el = document.documentElement, on = n && n !== 1;
    el.style.zoom = on ? String(n) : '';
    if (on) el.style.setProperty('--vh', `calc(1vh / ${n})`); else el.style.removeProperty('--vh');
  },
  fileUrl: (rel) => st.urls.get(rel) || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  pathsOf: (files) => Array.from(files || []),
  importFiles: async (files, kind) => { const out = []; for (const f of (files || []).slice(0, 200)) if (f instanceof Blob) out.push(await importOne(f, kind)); return out; },
  pickFiles: async (kind, opts) => { const files = await pick(opts); const out = []; for (const f of files) out.push(await importOne(f, kind)); return out; },
  openFile: async (rel) => {
    const rec = await fileGet(rel); if (!rec) return { ok: false, error: '找不到檔案' };
    if (RISKY.test(rec.name)) { download(rec.name, rec.blob); return { blocked: true }; }
    if (/^image\//.test(rec.type)) window.open(st.urls.get(rel), '_blank', 'noopener'); else download(rec.name, rec.blob);
    return { ok: true };
  },
  showFile: async (rel) => { const rec = await fileGet(rel); if (rec) download(rec.name, rec.blob); return true; },
  trashFile: async (rel) => { await fileDel(rel); const u = st.urls.get(rel); if (u) URL.revokeObjectURL(u); st.urls.delete(rel); },
  missingFiles: async () => { await ready; const have = new Set((await fileKeys()) || []); return M.allFileRefs(cur()).filter((r) => !have.has(r)); },

  openMain: async () => true,
  openWidget: async () => true,
  closeWidget: async () => true,
  minimizeWidget: async () => true,
  setOnTop: async (on) => !!on,
  setAutostart: async (on) => !!on,
  info: async () => { await ready; return { version: VERSION, dataDir: '（這支手機的瀏覽器）', platform: 'web', portable: false, hasBuiltinUpdateUrl: false, web: true, webUrl: location.origin + location.pathname.replace(/index\.html$/, '') }; },
  checkUpdate: async () => ({ ok: true, newer: false, current: VERSION }),
  setPrivacy: async (on) => { for (const b of M.BOOKS) { st.dbs[b].settings.privacyMode = !!on; await saveDb(st.dbs[b]); } return !!on; },
  openUpdatePage: async () => false,
  exportDiagnostics: async () => {
    const db = cur();
    const info = { 說明: '這份檔案只包含版本與設定，不含委託人姓名、聯絡方式、金額或圖片。', app: { version: VERSION, web: true, ua: navigator.userAgent }, generatedAt: new Date().toISOString(),
      counts: { clients: db.clients.length, commissions: db.commissions.length }, book: db.book, sync: { sheets: !!db.settings.sync.url, cloud: !!cloudConf().url, cloudError: db.meta.cloud && db.meta.cloud.error || '' } };
    download(`繪師委託帳本-診斷資訊-${M.today()}.json`, new Blob([JSON.stringify(info, null, 2)], { type: 'application/json' }));
    return { ok: true };
  },
  createShortcuts: async () => ({ ok: false, error: '手機版請用瀏覽器選單的「加到主畫面」' }),
  openExternal: async (url) => { try { const u = new URL(url); if (['https:', 'http:', 'mailto:'].includes(u.protocol)) window.open(u.href, '_blank', 'noopener'); } catch (e) { /* 忽略 */ } return true; },
  openDataDir: async () => true,
  saveImage: async (name, dataUrl) => {
    const bin = atob(String(dataUrl).split(',')[1] || '');
    const blob = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/png' });
    const file = new File([blob], name, { type: 'image/png' });
    // 手機上優先用系統分享（可以直接傳到 LINE、Discord、IG）
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return { ok: true, shared: true }; } catch (e) { if (e && e.name === 'AbortError') return { ok: false }; }
    }
    download(name, blob); return { ok: true };
  },
  copyText: async (t) => { try { await navigator.clipboard.writeText(String(t || '')); } catch (e) { prompt('請複製：', String(t || '')); } return true; },
  changeDataDir: async () => ({ ok: false }),

  addBackupFolder: async () => ({ error: '手機版請用「匯出備份檔」' }),
  runBackup: () => exportBackup(),
  restore: () => importBackup(),

  runSync: () => runSheets(),
  newToken: async () => {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    cur().settings.sync.token = Array.from(a).map((x) => x.toString(16).padStart(2, '0')).join('');
    await saveDb(cur()); return cur().settings.sync.token;
  },
  syncPreview: async () => Sh.publicSheet(cur()),
  syncScript: async () => { const t = await (await fetch('gas/Code.gs')).text(); return t.replace('__TOKEN__', cur().settings.sync.token || ''); },

  exportXlsx: async () => {
    if (!window.XLSX) return { ok: false };
    const wb = XLSX.utils.book_new();
    for (const sh of Sh.allSheets(cur())) {
      const aoa = [];
      if (sh.title) aoa.push([sh.title]);
      aoa.push([`更新時間：${sh.updated}`], sh.header, ...sh.rows);
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = sh.header.map(() => ({ wch: 14 }));
      XLSX.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31));
    }
    XLSX.writeFile(wb, `委託紀錄-${M.today()}.xlsx`);
    return { ok: true };
  },
  exportCsv: async () => {
    const sh = Sh.csvSheet(cur());
    const e = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    download(`委託總表-${M.today()}.csv`, new Blob(['﻿' + [sh.header, ...sh.rows].map((r) => r.map(e).join(',')).join('\r\n')], { type: 'text/csv' }));
    return { ok: true };
  },
  openPublicPage: async () => { if (window.PublicPage) window.open(URL.createObjectURL(new Blob([window.PublicPage.render(cur())], { type: 'text/html' })), '_blank'); return { ok: true }; },
  exportPublicPage: async () => { if (window.PublicPage) download('委託排單.html', new Blob([window.PublicPage.render(cur())], { type: 'text/html' })); return { ok: true }; }
};

// 離線也能開：註冊 service worker
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
