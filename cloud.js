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


// ───────── 共享個案頁與雙方同步 ─────────
// 分享的一方（有自己的 Apps Script）：caseSave 把個案摘要存到雲端，同時取回對方的留言。
// 對方：用瀏覽器打開網址就能看、能留言；如果也用這個程式，貼上網址就能「追蹤」這一單，
//      進度、交稿日、對話會自動同步（caseGet 取資料、caseReply 送訊息，不需要密碼，只認網址裡的代碼）。
const CASE_KEY = /^[A-Za-z0-9_-]{16,64}$/;
const cstr = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n);

function caseLink(scriptUrl, key) { return `${scriptUrl}${scriptUrl.includes('?') ? '&' : '?'}c=${key}`; }
function parseCaseLink(text) {
  const m = String(text || '').match(/https:\/\/script\.google(?:usercontent)?\.com\/[^\s"'<>]+/);
  if (!m) return null;
  try {
    const u = new URL(m[0]);
    const key = u.searchParams.get('c') || '';
    if (!CASE_KEY.test(key) || u.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)) return null;
    return { url: u.origin + u.pathname, key };
  } catch (e) { return null; }
}

// 分享出去的內容：只有進度、交稿日、階段日期、給對方看的備註、對話（金額要勾選才放）
function casePayload(db, c, ownerName) {
  const sh = c.share || {};
  const stages = db.settings.stages;
  const idx = Math.max(0, stages.findIndex((s) => s.id === c.stageId));
  const out = {
    v: 1, title: cstr(c.title, 100), code: cstr(c.code, 30), owner: cstr(ownerName, 60), ownerRole: db.book === 'client' ? 'client' : 'artist',
    stages: stages.map((s) => cstr(s.name, 30)), stage: idx, closed: !!c.closed, deadline: cstr(c.deadline, 10),
    milestones: (c.milestones || []).map((m) => ({ name: cstr(m.name, 60), date: cstr(m.date, 10), done: !!m.done })),
    note: cstr(sh.note, 3000), updated: new Date().toISOString(),
    thread: (c.thread || []).slice(-200).map((m) => ({ id: cstr(m.id, 40), who: m.from === 'me' ? 'owner' : 'guest', name: cstr(m.name, 40), text: cstr(m.text, 1000), at: cstr(m.at, 30) }))
  };
  if (sh.showPay) {
    const paid = (c.payments || []).filter((p) => p.status === 'paid').reduce((a, p) => a + (Number(p.amount) || 0), 0);
    out.pay = { currency: cstr(db.settings.currency, 10), price: Number(c.price) || 0, paid };
  }
  return out;
}
function cleanCaseData(d) {
  if (!d || typeof d !== 'object') return null;
  const arr = (a) => (Array.isArray(a) ? a : []);
  return {
    title: cstr(d.title, 100), code: cstr(d.code, 30), owner: cstr(d.owner, 60), ownerRole: d.ownerRole === 'client' ? 'client' : 'artist',
    stages: arr(d.stages).slice(0, 30).map((x) => cstr(x, 30)), stage: Math.max(0, Number(d.stage) || 0), closed: !!d.closed,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(d.deadline || '') ? d.deadline : '',
    milestones: arr(d.milestones).slice(0, 50).map((m) => ({ name: cstr(m && m.name, 60), date: cstr(m && m.date, 10), done: !!(m && m.done) })),
    note: cstr(d.note, 3000), updated: cstr(d.updated, 30),
    pay: d.pay && typeof d.pay === 'object' ? { currency: cstr(d.pay.currency, 10), price: Number(d.pay.price) || 0, paid: Number(d.pay.paid) || 0 } : null
  };
}
const cleanMsg = (m) => ({ id: cstr(m && m.id, 40), name: cstr(m && m.name, 40), text: cstr(m && m.text, 1000), at: cstr(m && m.at, 30) });

function addThread(db, c, msgs, from, channel) {
  c.thread = c.thread || [];
  const have = new Set(c.thread.map((m) => m.id));
  let n = 0;
  for (const raw of msgs) {
    const m = cleanMsg(raw);
    if (!m.id || !m.text || have.has(m.id)) continue;
    have.add(m.id); n++;
    c.thread.push({ id: m.id, from, name: m.name, text: m.text, at: m.at || new Date().toISOString() });
    // 也記到委託人（繪師）資料卡的聯繫紀錄
    const cl = db.clients.find((x) => x.id === c.clientId);
    if (cl) { cl.logs = cl.logs || []; cl.logs.push({ id: 'lg_' + m.id, date: (m.at || '').slice(0, 10) || M.today(), channel, text: `${c.title}：${m.name ? m.name + '：' : ''}${m.text}` }); }
  }
  c.thread.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return n;
}

// 依名稱對應階段；名稱對不上而且階段數一樣就照順序
function mapStage(db, data) {
  const name = data.stages[data.stage];
  const st = db.settings.stages;
  const byName = st.find((s) => s.name === name);
  if (byName) return byName.id;
  if (st.length === data.stages.length && st[data.stage]) return st[data.stage].id;
  return '';
}

// db 會直接被修改；有改到的資料會蓋上新的時間戳記，接著的帳本同步就會一起送出
async function syncCases(db, { call, post, myName }) {
  const prev = JSON.parse(JSON.stringify(db));
  const res = { incoming: 0, errors: [] };
  const shared = db.commissions.filter((c) => c.share && c.share.key);
  if (call && shared.length) {
    try {
      const items = shared.filter((c) => c.share.on).map((c) => ({ key: c.share.key, data: casePayload(db, c, myName) }));
      const remove = shared.filter((c) => !c.share.on).map((c) => c.share.key);
      const r = await call({ action: 'caseSave', items, remove });
      if (!r || !r.cases) throw new Error('共享個案頁需要新版同步腳本：請到「Google 表格同步」按「複製同步腳本」，貼到 Apps Script 取代後重新部署（新版本）');
      for (const c of shared) {
        const got = (r.replies || {})[c.share.key] || [];
        res.incoming += addThread(db, c, got, 'them', '個案頁留言');
        for (const m of c.thread || []) if (m.from === 'me' && c.share.on) m.sent = true;
      }
      db.meta.caseError = '';
    } catch (e) { db.meta.caseError = e.message; res.errors.push(e.message); }
  }
  for (const c of db.commissions.filter((x) => x.follow && x.follow.key)) {
    const f = c.follow;
    try {
      for (const m of (c.thread || []).filter((x) => x.from === 'me' && !x.sent)) {
        const r = await post(f.url, { action: 'caseReply', key: f.key, id: m.id, name: myName || '', text: m.text });
        if (r && r.ok) m.sent = true; else throw new Error((r && r.error) || '訊息送不出去');
      }
      const g = await post(f.url, { action: 'caseGet', key: f.key });
      if (!g || !g.ok) throw new Error((g && g.error) || '讀不到對方的個案');
      if (g.gone) { f.error = '對方已經停止分享這一單'; continue; }
      const d = cleanCaseData(g.data);
      if (!d) throw new Error('對方的個案資料不完整');
      c.followData = d;
      const mine = new Set((c.thread || []).map((m) => m.id));
      const fromOwner = (g.data.thread || []).filter((m) => m && !mine.has(m.id));
      res.incoming += addThread(db, c, fromOwner.filter((m) => m.who === 'owner'), 'them', '共享個案');
      res.incoming += addThread(db, c, [...fromOwner.filter((m) => m.who !== 'owner'), ...(g.replies || [])], 'other', '共享個案');
      if (d.deadline && d.deadline !== c.deadline) c.deadline = d.deadline;
      const sid = mapStage(db, d); if (sid && sid !== c.stageId) c.stageId = sid;
      f.error = '';
    } catch (e) { f.error = e.message; res.errors.push(e.message); }
  }
  M.stampChanges(prev, db);
  return res;
}
const hasCaseWork = (db) => db.commissions.some((c) => (c.share && c.share.key) || (c.follow && c.follow.key));

const API = { makeCode, readCode, syncBook, syncCases, casePayload, cleanCaseData, caseLink, parseCaseLink, hasCaseWork, CASE_KEY };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.Cloud = API;
})();
