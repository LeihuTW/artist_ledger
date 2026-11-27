(function () {
'use strict';
// 資料模型與計算邏輯（主程式與介面共用，不依賴 Electron）

// group：公開排單頁的分組（prep 準備中／work 製作中／done 已交付）
const DEFAULT_STAGES = [
  { id: 'st_talk', name: '洽談', done: false, group: 'prep' },
  { id: 'st_quote', name: '報價', done: false, group: 'prep' },
  { id: 'st_deposit', name: '收訂金', done: false, group: 'prep' },
  { id: 'st_sketch', name: '草稿', done: false, group: 'work' },
  { id: 'st_line', name: '線稿', done: false, group: 'work' },
  { id: 'st_color', name: '上色', done: false, group: 'work' },
  { id: 'st_deliver', name: '完稿交付', done: true, group: 'done' }
];
const DEFAULT_TYPES = ['頭像', '半身立繪', '全身立繪', '設定圖', 'VTuber 立繪拆件', 'Q版表符', '插圖', '商業案', '其它委託'];
const NEW_TYPES_V11 = ['設定圖', '其它委託'];
const DEFAULT_PAY_SOURCES = ['委託人本人', '代付（親友、公司）', 'Skeb', 'VGen', '巴哈姆特', 'Pixiv Request', '其他平台'];

// ───────── 委託者模式（我委託繪師）─────────
// 兩本帳：artist＝繪師接案帳（原本的功能），client＝委託者帳（我下給繪師的委託）
const BOOKS = ['artist', 'client'];
const CLIENT_STAGES = [
  { id: 'st_ask', name: '詢價中', done: false, group: 'prep' },
  { id: 'st_queue', name: '排單中', done: false, group: 'prep' },
  { id: 'st_deposit', name: '已付訂金', done: false, group: 'prep' },
  { id: 'st_sketch', name: '草稿確認', done: false, group: 'work' },
  { id: 'st_line', name: '線稿確認', done: false, group: 'work' },
  { id: 'st_color', name: '上色確認', done: false, group: 'work' },
  { id: 'st_deliver', name: '已收稿', done: true, group: 'done' }
];
const CLIENT_TYPES = ['頭像', '半身立繪', '全身立繪', '設定圖', 'VTuber 立繪拆件', 'Q版表符', '插圖', '其它委託'];
const CLIENT_PAY_SOURCES = ['直接轉帳', 'Skeb', 'VGen', 'Pixiv Request', '巴哈姆特', '其他平台'];

// 委託者模式的用詞：畫面上的固定文字依序替換（長的詞放前面）
const CLIENT_TERMS = [
  ['繪師委託帳本 <small>繪師版</small>', '繪師委託帳本 <small>委託者版</small>'],
  ['委託人同意完稿後放作品集', '同意繪師把完稿放作品集'], ['委託人已同意', '已同意'],
  ['註解／委託人回饋（這一版改了什麼）', '註解／我的回饋（這一版要改什麼）'], ['（交付給委託人的版本）', '（繪師交給你的完稿）'],
  ['委託人的角色設定圖在', '這位繪師的參考資料在'], ['修改過程圖面紀錄', '繪師傳來的圖（修改過程）'],
  ['記得和委託人確認加價', '繪師可能會另外收費'], ['付款人／後五碼', '付到繪師帳戶'],
  ['記錄錢收到哪裡，方便對帳。', '記錄錢從哪個帳戶付出，方便對帳。'], ['委託人提供', '我提供'],
  ['依接單日（新到舊）', '依下單日（新到舊）'], ['搜尋委託人、暱稱、編號、項目', '搜尋繪師、編號、項目'],
  ['委託人名冊', '繪師名冊'], ['委託人資料卡', '繪師資料卡'], ['為他新增委託', '向這位繪師下委託'],
  ['新委託人', '新繪師'], ['委託人', '繪師'],
  ['收款紀錄', '付款紀錄'], ['記一筆收款', '記一筆付款'], ['編輯收款', '編輯付款'], ['已記錄收款', '已記錄付款'],
  ['付款人／轉帳後五碼', '付到繪師的哪個帳戶'], ['收款帳戶', '我的付款帳戶'], ['款項來源', '付款平台'],
  ['尚未收款', '尚未付款'], ['已收款', '已付款'], ['待收款', '待付款'], ['預計收款', '預計付款'], ['收款', '付款'],
  ['已收齊', '已付清'], ['收齊', '付清'], ['收尾款', '付尾款'], ['收訂金', '付訂金'],
  ['已收', '已付'], ['未收', '未付'],
  ['死線行事曆', '交稿行事曆'], ['依死線', '依交稿日'], ['死線提醒', '交稿提醒'], ['死線', '交稿日'],
  ['作品圖庫', '收稿圖庫'], ['完成作品', '收到的完稿'], ['完稿圖', '完稿'],
  ['已交付', '已收稿'], ['交付', '收稿'], ['接單日', '下單日'], ['未報價', '金額未定'], ['報價金額', '委託金額'], ['報價', '金額']
];
function swapTerms(text, book) {
  if (book !== 'client' || !text) return text;
  let t = String(text);
  for (const [a, b] of CLIENT_TERMS) if (t.includes(a)) t = t.split(a).join(b);
  return t;
}

function defaultSettings(book) {
  const cl = book === 'client';
  return {
    stages: (cl ? CLIENT_STAGES : DEFAULT_STAGES).map((s) => ({ ...s })),
    upcomingDays: 15,
    reminderDays: [15, 7, 3, 1],
    freeRevisions: 3,
    currency: 'NT$',
    commissionTypes: (cl ? CLIENT_TYPES : DEFAULT_TYPES).slice(),
    paySources: (cl ? CLIENT_PAY_SOURCES : DEFAULT_PAY_SOURCES).slice(),
    entryMode: 'quick',      // 委託者模式新增委託：quick 快速記錄／full 完整
    payAccounts: [],
    backupFolders: [],
    autoBackup: true,
    closeToTray: true,
    priceTemplates: [],      // 價目表／方案範本
    unpaidRemindDays: 7,     // 交付後幾天還沒收齊尾款就提醒（0 = 不提醒）
    privacyMode: false,      // 隱私模式：名字與金額打碼（直播、截圖用）
    setupDone: false,        // 首次設定精靈是否完成
    autoUpdateCheck: true,
    updateUrl: '',           // 版本資訊檔網址（空白 = 用程式內建的網址）
    autostart: false,
    widgetOnTop: true,
    artistName: '',
    sync: {
      url: '',
      token: '',
      auto: true,
      sheets: { public: true, internal: true, payments: true, clients: false },
      maskNames: false,
      statusText: '接單中'
    },
    publicPage: { view: 'list', sort: 'due', contact: '', note: '', showDelivered: true, deliveredDays: 30 }
  };
}

function emptyDb(book) {
  book = BOOKS.includes(book) ? book : 'artist';
  return { version: 1, book, settings: defaultSettings(book), settingsTs: 0, clients: [], commissions: [], deleted: {}, meta: { notified: {}, lastSync: null, lastSyncError: null, lastBackup: null, lastBackupError: null, seq: {} } };
}

// 舊檔或手動修改過的資料補齊欄位
function normalizeDb(db, bookHint) {
  db = db && typeof db === 'object' ? db : null;
  const book = BOOKS.includes(db && db.book) ? db.book : (BOOKS.includes(bookHint) ? bookHint : 'artist');
  const base = emptyDb(book);
  db = db || base;
  const def = defaultSettings(book);
  const s = Object.assign(defaultSettings(book), db.settings || {});
  s.sync = Object.assign(def.sync, (db.settings || {}).sync || {});
  s.sync.sheets = Object.assign(defaultSettings(book).sync.sheets, s.sync.sheets || {});
  if (!Array.isArray(s.stages) || !s.stages.length) s.stages = defaultSettings(book).stages;
  if (!Array.isArray(s.reminderDays)) s.reminderDays = [15, 7, 3, 1];
  if (!Array.isArray(s.backupFolders)) s.backupFolders = [];
  if (!Array.isArray(s.commissionTypes)) s.commissionTypes = defaultSettings(book).commissionTypes;
  if (!Array.isArray(s.paySources)) s.paySources = defaultSettings(book).paySources;
  if (!['quick', 'full'].includes(s.entryMode)) s.entryMode = 'quick';
  if (!Array.isArray(s.payAccounts)) s.payAccounts = [];
  if (!Array.isArray(s.priceTemplates)) s.priceTemplates = [];
  // 舊版已經有資料的人，不再跳首次設定精靈
  if (!db.settings || db.settings.setupDone === undefined) {
    s.setupDone = ((db.clients || []).length + (db.commissions || []).length) > 0;
  }
  s.publicPage = Object.assign(defaultSettings(book).publicPage, (db.settings || {}).publicPage || {});
  // 階段補上公開分組（舊資料沒有 group）
  s.stages = s.stages.map((st) => Object.assign({}, st, {
    group: st.done ? 'done' : (['prep', 'work'].includes(st.group) ? st.group : (/^st_(talk|quote|deposit)$/.test(st.id) ? 'prep' : 'work'))
  }));
  const out = {
    version: 1,
    book,
    settings: s,
    settingsTs: Number(db.settingsTs) || 0,
    deleted: db.deleted && typeof db.deleted === 'object' ? db.deleted : {},
    clients: Array.isArray(db.clients) ? db.clients.map(normClient) : [],
    commissions: Array.isArray(db.commissions) ? db.commissions.map((c) => normCommission(c, s)) : [],
    meta: Object.assign(base.meta, db.meta || {})
  };
  if (!out.meta.notified || typeof out.meta.notified !== 'object') out.meta.notified = {};
  if (!out.meta.seq || typeof out.meta.seq !== 'object') out.meta.seq = {};
  // v1.1：新增「設定圖」「其它委託」類型（只補一次，之後使用者刪掉也不會再加回來）
  if (!out.meta.typesV11 && book === 'artist') {
    for (const t of NEW_TYPES_V11) if (!s.commissionTypes.includes(t)) s.commissionTypes.push(t);
    out.meta.typesV11 = true;
  }
  return out;
}

function normClient(c) {
  return Object.assign({
    id: '', name: '', nickname: '', tags: [], socials: [], contacts: [], replyTime: '', notes: '',
    refs: [], logs: [], createdAt: today(),
    // 委託者模式的繪師資料卡：排單頁、價目表、委託須知、繪師的收款方式、接單狀態
    queueUrl: '', priceUrl: '', terms: '', payMethods: [], openStatus: ''
  }, c, {
    tags: arr(c.tags), socials: arr(c.socials), contacts: arr(c.contacts), refs: arr(c.refs), logs: arr(c.logs), payMethods: arr(c.payMethods)
  });
}

function normCommission(c, s) {
  return Object.assign({
    id: '', code: '', clientId: '', title: '', type: '', stageId: s.stages[0].id,
    startDate: today(), deadline: '', milestones: [], price: 0, payments: [], revisions: [],
    freeRevisions: s.freeRevisions, refs: [], finals: [], sourceFiles: [],
    spec: '', license: '', portfolioOk: false, publicNote: '', notes: '', closed: false, closedAt: '',
    publicMode: 'nick', // nick 顯示暱稱／anon 顯示為「保密委託」／hidden 不放上公開排單
    deliveredAt: '',    // 進入「已交付」階段的日期（尾款提醒用）
    createdAt: today(), updatedAt: today()
  }, c, {
    publicMode: ['nick', 'anon', 'hidden'].includes(c.publicMode) ? c.publicMode : 'nick',
    milestones: arr(c.milestones),
    payments: arr(c.payments).map((p) => Object.assign({ source: '', account: '', payer: '', note: '' }, p)),
    revisions: arr(c.revisions),
    refs: arr(c.refs), finals: arr(c.finals), sourceFiles: arr(c.sourceFiles)
  });
}

function arr(v) { return Array.isArray(v) ? v : []; }

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today(now) { return fmtDate(now || new Date()); }

function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 距離死線的天數（今天 = 0，過期為負數），沒有死線回傳 null
function daysLeft(deadline, now) {
  const d = parseDate(deadline);
  if (!d) return null;
  const n = now || new Date();
  const t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((d - t) / 86400000);
}

function stageOf(db, c) {
  return db.settings.stages.find((s) => s.id === c.stageId) || db.settings.stages[0];
}
function stageIndex(db, c) {
  const i = db.settings.stages.findIndex((s) => s.id === c.stageId);
  return i < 0 ? 0 : i;
}
function isDelivered(db, c) { return !!stageOf(db, c).done; }
function accountLabel(db, id) {
  const a = (db.settings.payAccounts || []).find((x) => x.id === id);
  return a ? a.label : '';
}
function isActive(c) { return !c.closed; }
// 還在趕工（未交付、未結案）
function isWorking(db, c) { return !c.closed && !isDelivered(db, c); }

function paidTotal(c) {
  return c.payments.filter((p) => p.status === 'paid').reduce((a, p) => a + (Number(p.amount) || 0), 0);
}
function unpaid(c) { return Math.max(0, (Number(c.price) || 0) - paidTotal(c)); }
function countedRevisions(c) { return c.revisions.filter((r) => r.counted).length; }
function progressPct(db, c) {
  const n = db.settings.stages.length;
  if (c.closed) return 100;
  return Math.round(((stageIndex(db, c) + 1) / n) * 100);
}

function clientName(db, id, preferNick) {
  const cl = db.clients.find((x) => x.id === id);
  if (!cl) return '（未指定）';
  return preferNick ? (cl.nickname || cl.name) : (cl.name || cl.nickname);
}

function upcoming(db, now) {
  const lim = Number(db.settings.upcomingDays) || 15;
  return db.commissions
    .filter((c) => isWorking(db, c))
    .map((c) => ({ c, left: daysLeft(c.deadline, now) }))
    .filter((x) => x.left !== null && x.left <= lim)
    .sort((a, b) => a.left - b.left);
}

function stats(db, now) {
  const n = now || new Date();
  const ym = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
  let monthPaid = 0;
  for (const c of db.commissions) for (const p of c.payments) {
    if (p.status === 'paid' && (p.date || '').startsWith(ym)) monthPaid += Number(p.amount) || 0;
  }
  const active = db.commissions.filter(isActive);
  return {
    active: active.length,
    working: active.filter((c) => !isDelivered(db, c)).length,
    upcoming: upcoming(db, n).length,
    monthPaid,
    pending: active.reduce((a, c) => a + unpaid(c), 0)
  };
}

// 需要發出的死線提醒（每件委託每個提醒天數只提醒一次）
function dueReminders(db, now) {
  const out = [];
  const days = (db.settings.reminderDays || []).map(Number).filter((x) => x >= 0).sort((a, b) => b - a);
  for (const c of db.commissions) {
    if (!isWorking(db, c)) continue;
    const left = daysLeft(c.deadline, now);
    if (left === null) continue;
    if (left < 0) {
      const key = `${c.id}|${c.deadline}|overdue`;
      if (!db.meta.notified[key]) out.push({ key, c, left, kind: 'overdue' });
      continue;
    }
    // 取「已經跨過」的最小提醒天數，避免一次跳出多則
    const hit = days.filter((d) => left <= d);
    if (!hit.length) continue;
    const d = Math.min(...hit);
    const key = `${c.id}|${c.deadline}|${d}`;
    if (!db.meta.notified[key]) out.push({ key, c, left, kind: 'remind', day: d });
  }
  return out;
}

// 交付後尾款沒收齊的提醒（每隔 unpaidRemindDays 天提醒一次）
function dueUnpaidReminders(db, now) {
  const n = Number(db.settings.unpaidRemindDays) || 0;
  if (n <= 0) return [];
  const out = [];
  for (const c of db.commissions) {
    if (c.closed || !isDelivered(db, c) || !c.deliveredAt || unpaid(c) <= 0) continue;
    const since = -daysLeft(c.deliveredAt, now);
    if (since === null || since < n) continue;
    const key = `${c.id}|unpaid|${c.deliveredAt}|${Math.floor(since / n)}`;
    if (!db.meta.notified[key]) out.push({ key, c, since, amount: unpaid(c) });
  }
  return out;
}

// 「收訂金」階段（找不到就回傳 null）
function depositStage(db) {
  return db.settings.stages.find((s) => s.id === 'st_deposit') || db.settings.stages.find((s) => /訂金/.test(s.name)) || null;
}

// 依死線平均排出製作中各階段的交付日（已經有同名的就略過）
function autoMilestones(db, c, now) {
  const end = parseDate(c.deadline);
  if (!end) return [];
  const t = now || new Date();
  const today0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const st = parseDate(c.startDate);
  const start = st && st > today0 ? st : today0;
  const span = Math.max(0, Math.round((end - start) / 86400000));
  const work = db.settings.stages.filter((s) => s.group === 'work');
  const have = new Set(c.milestones.map((m) => m.name));
  return work.map((s, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.round(span * (i + 1) / (work.length + 1)));
    return { name: `${s.name}交付`, date: fmtDate(d) };
  }).filter((m) => !have.has(m.name));
}

// 版本比較：a > b 回傳 1，相等 0，小於 -1
function cmpVersion(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}

function nextCode(db, now) {
  const y = (now || new Date()).getFullYear();
  const used = db.commissions.map((c) => c.code).filter((x) => x && x.startsWith(`C-${y}-`)).map((x) => Number(x.split('-')[2]) || 0);
  const n = Math.max(0, ...used, db.meta.seq[y] || 0) + 1;
  db.meta.seq[y] = n;
  return `C-${y}-${String(n).padStart(3, '0')}`;
}

// 所有被資料引用到的附件相對路徑（備份用）
function allFileRefs(db) {
  const set = new Set();
  const add = (f) => { if (f && f.file) set.add(f.file); };
  for (const cl of db.clients) cl.refs.forEach(add);
  for (const c of db.commissions) {
    c.refs.forEach(add); c.finals.forEach(add); c.sourceFiles.forEach(add);
    c.revisions.forEach((r) => add(r.image));
    c.payments.forEach((p) => add(p.proof));
  }
  return [...set];
}

// ───────── 電腦與手機同步 ─────────
// 每筆資料有 ts（最後修改時間，毫秒）；刪除的資料記在 deleted（id → 刪除時間）
// 存檔時比對前一版，自動蓋上時間戳記
function stampChanges(prev, next, now) {
  const t = now || Date.now();
  if (!prev) {
    // 舊資料第一次載入：補上時間戳記；設定維持 0，新裝置的預設值才不會蓋掉雲端的設定
    for (const k of ['clients', 'commissions']) for (const r of next[k]) if (!r.ts) r.ts = t;
    return next;
  }
  for (const k of ['clients', 'commissions']) {
    const old = new Map(prev[k].map((r) => [r.id, r]));
    for (const r of next[k]) {
      const o = old.get(r.id);
      if (!o) { r.ts = t; continue; }
      const a = Object.assign({}, o, { ts: 0 }), b = Object.assign({}, r, { ts: 0 });
      r.ts = JSON.stringify(a) === JSON.stringify(b) ? (o.ts || t) : t;
      old.delete(r.id);
    }
    for (const id of old.keys()) next.deleted[id] = t;
  }
  next.settingsTs = JSON.stringify(prev.settings) === JSON.stringify(next.settings) ? (prev.settingsTs || 0) : t;
  return next;
}

// 只同步帳本內容；備份資料夾、同步狀態等只屬於這台裝置的資料不送出
const DEVICE_SETTINGS = ['backupFolders', 'autostart', 'widgetOnTop', 'closeToTray', 'updateUrl', 'privacyMode', 'sync'];
function syncPayload(db) {
  const settings = Object.assign({}, db.settings);
  for (const k of DEVICE_SETTINGS) delete settings[k];
  return { book: db.book, settings, settingsTs: db.settingsTs, clients: db.clients, commissions: db.commissions, deleted: db.deleted, seq: db.meta.seq || {} };
}

// 合併兩邊的資料：同一筆取比較新的；被刪除且刪除時間比較新的就不留
function mergeDbs(local, remote) {
  const out = normalizeDb(JSON.parse(JSON.stringify(local)));
  if (!remote) return out;
  const deleted = Object.assign({}, out.deleted);
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, Number(t) || 0);
  for (const k of ['clients', 'commissions']) {
    const map = new Map();
    for (const r of out[k]) map.set(r.id, r);
    for (const r of (remote[k] || [])) {
      const cur = map.get(r.id);
      if (!cur || (Number(r.ts) || 0) > (Number(cur.ts) || 0)) map.set(r.id, r);
    }
    out[k] = [...map.values()].filter((r) => !(deleted[r.id] && deleted[r.id] >= (Number(r.ts) || 0)));
  }
  if ((Number(remote.settingsTs) || 0) > (Number(out.settingsTs) || 0) && remote.settings) {
    const keep = {};
    for (const k of DEVICE_SETTINGS) keep[k] = out.settings[k];
    out.settings = Object.assign({}, out.settings, remote.settings, keep);
    out.settingsTs = Number(remote.settingsTs);
  }
  out.deleted = deleted;
  for (const [y, n] of Object.entries(remote.seq || {})) out.meta.seq[y] = Math.max(out.meta.seq[y] || 0, Number(n) || 0);
  return normalizeDb(out);
}

const API = {
  BOOKS, CLIENT_STAGES, CLIENT_TERMS, swapTerms, stampChanges, syncPayload, mergeDbs, DEVICE_SETTINGS,
  DEFAULT_STAGES, DEFAULT_TYPES, DEFAULT_PAY_SOURCES, accountLabel, defaultSettings, emptyDb, normalizeDb, today, parseDate, daysLeft, fmtDate,
  stageOf, stageIndex, isDelivered, isActive, isWorking, paidTotal, unpaid, countedRevisions, progressPct,
  clientName, upcoming, stats, dueReminders, dueUnpaidReminders, depositStage, autoMilestones, cmpVersion, nextCode, allFileRefs
};
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.Model = API;
})();
