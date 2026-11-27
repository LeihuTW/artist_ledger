'use strict';
/* 繪師委託帳本｜完整版介面（電腦版與手機版共用；繪師帳與委託者帳共用同一套畫面） */
const M = window.Model;
// window.api 由 preload 提供

// 外觀：跟隨系統／淺色／深色（存在這台裝置，不會同步）
const THEMES = { auto: '系統', light: '淺色', dark: '深色' };
function themePref() { try { return THEMES[localStorage.getItem('al-theme')] ? localStorage.getItem('al-theme') : 'auto'; } catch (e) { return 'auto'; } }
function applyTheme() {
  const t = themePref();
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#0F1514' : '#1E3F3B';
}
applyTheme();
if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* 舊瀏覽器 */ } }

// 畫面大小：字和介面一起放大，最大 150%；「依視窗」會隨視窗寬度自動調整（存在這台裝置）
const ZOOM_LIST = [['auto', '依視窗'], ['1', '100%'], ['1.1', '110%'], ['1.25', '125%'], ['1.4', '140%'], ['1.5', '150%']];
const ZOOMS = Object.fromEntries(ZOOM_LIST);
// 作品圖庫一排幾張（只存在這台裝置）
function galleryCols() { try { const v = localStorage.getItem('al-gcols'); return ['3', '6', '8'].includes(v) ? v : '6'; } catch (e) { return '6'; } }
function zoomPref() { try { const v = localStorage.getItem('al-zoom'); return ZOOMS[v] ? v : 'auto'; } catch (e) { return 'auto'; } }
function zoomFactor() {
  const z = zoomPref();
  if (z !== 'auto') return Number(z);
  const w = window.outerWidth || window.innerWidth || 1280; // outerWidth 不受縮放影響
  return Math.min(1.5, Math.max(1, Math.round((w / 1440) * 20) / 20));
}
function applyZoom() { if (window.api && api.setZoom) api.setZoom(zoomFactor()); }
applyZoom();
window.addEventListener('resize', () => { if (zoomPref() !== 'auto') return; clearTimeout(applyZoom._t); applyZoom._t = setTimeout(applyZoom, 150); });

const S = {
  db: null, info: null, pendingDb: null, modal: null, syncRunning: false, backupRunning: false,
  view: { mode: 'board', q: '', type: '', showClosed: false, sort: 'deadline', calMonth: null, payMonth: '', payStatus: '', payAccount: '', paySource: '', galleryRev: false, cmp: [], ctag: '' }
};

// ───────── 小工具 ─────────
// 使用者輸入的文字一律經過 esc；前後加上記號，切換委託者用詞時才不會改到使用者自己寫的內容
const P0 = '\uE000', P1 = '\uE001';
const esc = (v) => P0 + String(v ?? '').replace(/[&<>"'\uE000\uE001]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\uE000': '', '\uE001': '' }[c])) + P1;
const BOOK = () => (S.db && S.db.book) || 'artist';
const CLIENT = () => BOOK() === 'client';
const WEB = () => !!(S.info && S.info.web);
// 畫面文字：委託者帳把固定用詞換成委託者的說法（esc 包起來的使用者內容不換）
function tr(html) {
  html = String(html ?? '');
  if (!CLIENT()) return html.replace(/[\uE000\uE001]/g, '');
  let out = '', i = 0;
  while (i < html.length) {
    const a = html.indexOf(P0, i);
    if (a < 0) { out += M.swapTerms(html.slice(i), 'client'); break; }
    out += M.swapTerms(html.slice(i, a), 'client');
    const b = html.indexOf(P1, a);
    out += html.slice(a + 1, b < 0 ? html.length : b);
    i = b < 0 ? html.length : b + 1;
  }
  return out.replace(/[\uE000\uE001]/g, '');
}
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const PV = () => !!(S.db && S.db.settings.privacyMode);
const maskTxt = (v) => { const t = String(v ?? ''); if (!t) return t; return t.length <= 1 ? t + '○' : t[0] + '○'.repeat(Math.min(3, t.length - 1)); };
const pv = (v) => PV() ? maskTxt(v) : String(v ?? '');
const amt = (n) => PV() ? '●●●' : Number(n || 0).toLocaleString('zh-TW');
const money = (n) => `${S.db.settings.currency} ${amt(n)}`;
// 常用貨幣（設定裡的下拉選單），不在清單裡的可以選「自訂」
const CURRENCIES = [['NT$', '新台幣'], ['HK$', '港幣'], ['US$', '美元'], ['¥', '日圓'], ['₩', '韓元'], ['RMB', '人民幣'], ['€', '歐元'], ['£', '英鎊'], ['S$', '新加坡幣'], ['MOP', '澳門幣'], ['A$', '澳幣'], ['C$', '加幣']];
const imgUrl = (rel) => (api.fileUrl ? api.fileUrl(rel) : 'ledger://f/' + String(rel).split('/').map(encodeURIComponent).join('/'));
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const RISKY = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|ws|msi|msp|mst|scr|pif|lnk|url|hta|cpl|jar|reg|inf|scf|dll|sys|appx|appxbundle|msix|msixbundle|application|gadget|iso|img|vhd|vhdx|chm)$/i;
const isImg = (f) => f && IMG_EXT.test(f.file || '');
const extOf = (f) => ((f && f.name) || '').split('.').pop().slice(0, 6).toUpperCase() || 'FILE';
const md = (d) => { const p = M.parseDate(d); return p ? `${p.getMonth() + 1}/${p.getDate()}` : ''; };
const wk = (d) => { const p = M.parseDate(d); return p ? '日一二三四五六'[p.getDay()] : ''; };
const sizeTxt = (b) => !b ? '' : b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const clientOf = (c) => S.db.clients.find((x) => x.id === c.clientId);
const comm = (id) => S.db.commissions.find((c) => c.id === id);
const client = (id) => S.db.clients.find((c) => c.id === id);
const nickOf = (cl) => cl ? pv(cl.nickname || cl.name || '（未命名）') : '（未指定）';
const initial = (cl) => (nickOf(cl).trim()[0] || '?').toUpperCase();
const optList = (arr, sel) => arr.map((v) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = tr(msg); t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

async function commit(msg) {
  S.pendingDb = null; // 對話框期間收到的舊資料不再套用，以這次送出的為準
  S.db.commissions.forEach((c) => { if (c._touch) { c.updatedAt = M.today(); delete c._touch; } });
  await api.putDb(S.db);
  if (msg) toast(msg);
  render();
}
function touch(c) { c._touch = true; }

// ───────── 路由 ─────────
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return { name: name || 'overview', id: id || '' };
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

function render() {
  if (!S.db) return;
  document.body.classList.toggle('privacy', PV());
  const r = route();
  const views = { overview: vOverview, c: vCommission, clients: vClients, client: vClient, payments: vPayments, calendar: vCalendar, gallery: vGallery, sync: vSync, settings: vSettings, more: vMore, mycard: vMyCard };
  const navKey = { c: 'overview', client: 'clients' }[r.name] || r.name;
  document.querySelectorAll('#side a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey));
  const tabKey = ['gallery', 'sync', 'settings', 'mycard'].includes(navKey) ? 'more' : navKey;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.nav === tabKey));
  sideNav();
  const fn = views[r.name];
  const scroll = $('#view').scrollTop;
  $('#view').innerHTML = tr(fn ? fn(r.id) : vOverview());
  if (render._last === location.hash) $('#view').scrollTop = scroll;
  render._last = location.hash;
  sideStatus();
  if (r.name === 'mycard') afterRenderCard();
  quickRoutes(r);
}

function quickRoutes(r) {
  if (r.name === 'new') { history.replaceState(null, '', '#/overview'); render(); formCommission(); }
  if (r.name === 'quickpay') { history.replaceState(null, '', '#/overview'); render(); pickCommission('記一筆收款', (c) => formPayment(c)); }
  if (r.name === 'quickrev') { history.replaceState(null, '', '#/overview'); render(); pickCommission('上傳修改圖', (c) => { go(`#/c/${c.id}`); pickInto('rev', c.id); }); }
}

function sideStatus() {
  const m = S.db.meta;
  const sync = !S.db.settings.sync.url ? 'Google 表格：未設定'
    : S.syncRunning ? '同步中…'
      : m.lastSyncError ? `同步失敗：${new Date(m.lastSyncError.at).toLocaleString('zh-TW', { hour12: false })}`
        : m.lastSync ? `上次同步：${new Date(m.lastSync).toLocaleString('zh-TW', { hour12: false })}` : '尚未同步';
  const bk = !S.db.settings.backupFolders.length ? '⚠ 尚未設定備份'
    : S.backupRunning ? '備份中…'
      : m.lastBackup ? `上次備份：${new Date(m.lastBackup.at).toLocaleString('zh-TW', { hour12: false })}` : '尚未備份';
  const up = m.update && m.update.newer && m.update.latest ? `<br><a href="#/settings" class="side-up">● 有新版本 v${esc(m.update.latest.version)}</a>` : '';
  const cm = S.db.meta.cloud;
  const cloud = !S.cloud || !S.cloud.effective || !S.cloud.effective.url ? '' : S.cloudRunning ? '<br>手機同步中…'
    : cm && cm.error ? `<br><span class="side-err">手機同步失敗</span>` : cm && cm.at ? `<br>手機同步：${esc(new Date(cm.at).toLocaleString('zh-TW', { hour12: false }))}` : '';
  $('#side-status').innerHTML = tr(`${esc(sync)}<br>${esc(WEB() ? '備份：用「設定與備份 › 匯出備份檔」' : bk)}${cloud}${up}`);
  const pb = $('#privacy-btn');
  if (pb) { pb.textContent = PV() ? '隱私模式：開' : '隱私模式：關'; pb.classList.toggle('on', PV()); pb.setAttribute('aria-pressed', String(PV())); }
}

// 側邊選單：依帳本換用詞、切換鈕狀態；委託者帳沒有桌面小工具
function sideNav() {
  document.querySelectorAll('#side a[data-nav], #tabs a[data-nav]').forEach((a) => {
    if (!a.dataset.label) a.dataset.label = a.textContent;
    a.textContent = M.swapTerms(a.dataset.label, BOOK());
  });
  document.querySelectorAll('[data-book]').forEach((b) => { const on = b.dataset.book === BOOK(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const w = $('#side [data-act=openWidget]'); if (w) w.hidden = CLIENT() || WEB();
  document.title = '繪師委託帳本';
}

// ───────── 流程：進度變更、交付檢查、結案、收款連動 ─────────
function closeCommission(c) {
  c.closed = true; c.closedAt = M.today();
  if (!c.deliveredAt) c.deliveredAt = M.today();
  const last = S.db.settings.stages.filter((s) => s.done).pop(); if (last) c.stageId = last.id;
  touch(c);
}

// 點進度條、推進、拖曳都走這裡
async function changeStage(id, stageId) {
  const c = comm(id); if (!c) return;
  const before = M.isDelivered(S.db, c);
  c.closed = false; c.closedAt = '';
  c.stageId = stageId;
  const after = M.isDelivered(S.db, c);
  if (after && !before) c.deliveredAt = M.today();
  if (!after) c.deliveredAt = '';
  touch(c);
  await commit(`進度改為「${M.stageOf(S.db, c).name}」`);
  if (after && !before) await deliverCheck(id);
}

// 剛交付：提醒收尾款、放完成作品、放原檔；都好了就問要不要結案
async function deliverCheck(id) {
  const c = comm(id); if (!c) return;
  const todo = [];
  if (M.unpaid(c) > 0) todo.push(['pay', `還有 ${money(M.unpaid(c))} 尾款未收`, '記一筆收款']);
  if (!c.finals.length) todo.push(['finals', '還沒放完成作品', '放完成作品']);
  if (!c.sourceFiles.length && !CLIENT()) todo.push(['source', '還沒放繪圖原檔備份', '放繪圖原檔']);
  if (!todo.length) return maybeClose(id);
  openModal(`<h2>已交付「${esc(c.title || c.type)}」</h2><p class="sub">還有幾件事可以順手完成：</p>
    <div class="mt">${todo.map(([k, t, b]) => `<div class="file-row"><span class="grow">${esc(t)}</span><button class="btn sm" data-dv="${k}">${b}</button></div>`).join('')}</div>
    <div class="foot"><button class="btn" data-act="close">稍後再說</button></div>`, {
    onOpen: (root) => root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dv]'); if (!b) return;
      const k = b.dataset.dv; S.modal = null; closeModal();
      if (k === 'pay') formPayment(comm(id)); else pickInto(k, id);
    })
  });
}

async function maybeClose(id) {
  const c = comm(id);
  if (!c || c.closed || !M.isDelivered(S.db, c) || !(Number(c.price) > 0) || M.unpaid(c) > 0) return;
  if (!(await confirmBox('款項已收齊，要結案嗎？', `「${c.title || c.type}」已交付，款項也收齊了。結案後會從看板移到「已結案」。`, '結案'))) return;
  closeCommission(comm(id));
  await commit('已結案');
}

// 記了一筆已收款項之後：還在收訂金之前就問要不要推進；交付後收齊就問要不要結案
async function afterPayment(id, paidNow) {
  const c = comm(id); if (!c || !paidNow) return;
  const ds = M.depositStage(S.db);
  const di = ds ? S.db.settings.stages.indexOf(ds) : -1;
  if (ds && !c.closed && M.stageIndex(S.db, c) < di) {
    if (await confirmBox(`要把進度推到「${ds.name}」嗎？`, '已經記錄收到款項，目前進度還在前面的階段。', '推進')) await changeStage(id, ds.id);
    return;
  }
  await maybeClose(id);
}

// ───────── 共用元件 ─────────
// 這兩個回傳的是固定用詞，常被 esc 包起來，所以在這裡先換成委託者用詞
function deadlineInfo(c) { const r = deadlineInfo0(c); r.txt = M.swapTerms(r.txt, BOOK()); return r; }
function deadlineInfo0(c) {
  if (c.closed) return { txt: '已結案', cls: '' };
  if (M.isDelivered(S.db, c)) return { txt: '已交付', cls: '' };
  const left = M.daysLeft(c.deadline);
  if (left === null) return { txt: '死線未定', cls: '' };
  if (left < 0) return { txt: `超過 ${-left} 天`, cls: 'badc', left };
  if (left === 0) return { txt: '今天到期', cls: 'badc', left };
  if (left <= S.db.settings.upcomingDays) return { txt: `剩 ${left} 天（${md(c.deadline)}）`, cls: 'warnc', left };
  return { txt: `死線 ${md(c.deadline)}`, cls: '', left };
}
function payInfo(c) { return M.swapTerms(payInfo0(c), BOOK()); }
function payInfo0(c) {
  const price = Number(c.price) || 0, paid = M.paidTotal(c);
  if (!price) return paid ? `已收 ${money(paid)}` : '未報價';
  if (paid >= price) return '已收齊 ✓';
  if (!paid) return '尚未收款';
  return `已收 ${Math.round((paid / price) * 100)}%`;
}

function thumbs(list, slot, owner) {
  if (!list.length) return '';
  return `<div class="thumbs">${list.map((f) => `
    <figure class="thumb">
      <button class="img" data-act="view" data-slot="${slot}" data-owner="${owner}" data-fid="${f.id}" aria-label="檢視 ${esc(f.name)}">
        ${isImg(f) ? `<img src="${imgUrl(f.file)}" alt="" loading="lazy">` : `<span class="file-ico">${esc(extOf(f))}</span>`}
      </button>
      <figcaption><textarea class="cap" rows="2" data-chg="caption" data-slot="${slot}" data-owner="${owner}" data-fid="${f.id}" placeholder="加註解…" aria-label="${esc(f.name)} 的註解">${esc(f.caption)}</textarea><span class="fname" title="${esc(f.name)}">${esc(f.name)}</span></figcaption>
      <button class="x" data-act="rmFile" data-slot="${slot}" data-owner="${owner}" data-fid="${f.id}" aria-label="移除">×</button>
    </figure>`).join('')}</div>`;
}
function dropZone(slot, owner, text) {
  return `<div class="drop-zone mt" data-drop="${slot}" data-owner="${owner}" data-act="pick" data-slot="${slot}" role="button" tabindex="0">${esc(text)}</div>`;
}

// 附件欄位對應
const SLOTS = {
  rev: { kind: 'revisions', images: true, list: (id) => comm(id).revisions.map((r) => r.image).filter(Boolean) },
  refs: { kind: 'refs', images: true, list: (id) => comm(id).refs },
  finals: { kind: 'finals', images: true, list: (id) => comm(id).finals },
  source: { kind: 'source', images: false, list: (id) => comm(id).sourceFiles },
  clientRefs: { kind: 'refs', images: true, list: (id) => client(id).refs },
  proof: { kind: 'proof', images: true, list: () => [] }
};

async function addFiles(slot, owner, refs) {
  if (!refs.length) return;
  if (slot === 'rev') {
    const c = comm(owner);
    for (const f of refs) {
      const n = c.revisions.length + 1;
      c.revisions.push({ id: uid(), ver: `v${n}`, title: M.stageOf(S.db, c).name, date: M.today(), image: f, feedback: '', counted: n > 1 });
    }
    touch(c);
  } else if (slot === 'clientRefs') {
    client(owner).refs.push(...refs);
  } else {
    const c = comm(owner);
    (slot === 'source' ? c.sourceFiles : c[slot]).push(...refs);
    touch(c);
  }
  await commit(`已加入 ${refs.length} 個檔案`);
  const risky = refs.filter((f) => RISKY.test(f.name));
  if (risky.length) toast(`注意：${risky.map((f) => f.name).join('、')} 可能是程式檔，為了安全，工具裡不能直接開啟`, 6000);
}
async function pickInto(slot, owner) {
  const sl = SLOTS[slot];
  const refs = await api.pickFiles(sl.kind, { images: sl.images });
  await addFiles(slot, owner, refs);
}

// ───────── 委託總覽 ─────────
function filtered() {
  const v = S.view, q = v.q.trim().toLowerCase();
  const list = S.db.commissions.filter((c) => {
    if (!v.showClosed && c.closed) return false;
    if (v.type && c.type !== v.type) return false;
    if (!q) return true;
    const cl = clientOf(c) || {};
    return [c.code, c.title, c.type, cl.name, cl.nickname, c.notes].join(' ').toLowerCase().includes(q);
  });
  const key = { deadline: (c) => c.deadline || '9999-99-99', start: (c) => c.startDate, updated: (c) => c.updatedAt };
  const k = key[v.sort] || key.deadline;
  list.sort((a, b) => v.sort === 'deadline' ? k(a).localeCompare(k(b)) : k(b).localeCompare(k(a)));
  return list;
}

function vOverview() {
  const st = M.stats(S.db);
  const set = S.db.settings, v = S.view;
  const list = filtered();
  const now = new Date();
  const types = [...new Set([...set.commissionTypes, ...S.db.commissions.map((c) => c.type).filter(Boolean)])];
  let body;
  if (!S.db.commissions.length) {
    body = `<div class="panel empty"><h2>還沒有任何委託</h2><p>按右上角「＋ 新增委託」建立第一筆，委託人資料也可以在那裡一起建立。</p><button class="btn pri" data-act="newCommission">＋ 新增委託</button></div>`;
  } else if (v.mode === 'board') {
    const cols = set.stages.map((s) => ({ id: s.id, name: s.name, items: list.filter((c) => !c.closed && c.stageId === s.id) }));
    // 階段被刪掉的委託放到第一欄
    const known = new Set(set.stages.map((s) => s.id));
    cols[0].items.push(...list.filter((c) => !c.closed && !known.has(c.stageId)));
    if (v.showClosed) cols.push({ id: '__closed', name: '結案', items: list.filter((c) => c.closed) });
    body = `<div class="board" style="grid-template-columns:repeat(${cols.length},minmax(150px,1fr))">${cols.map((col) => `
      <section class="colm" data-stage="${col.id}" aria-label="${esc(col.name)}">
        <div class="colm-h">${esc(col.name)}<span>${col.items.length}</span></div>
        ${col.items.map(cardHtml).join('')}
      </section>`).join('')}</div>
      <p class="hint">提示：把卡片拖到其他欄就能改變進度。</p>`;
  } else {
    body = `<div class="panel scroll-x"><table class="t" style="min-width:900px">
      <thead><tr><th>編號</th><th>委託人</th><th>項目</th><th>類型</th><th>進度</th><th>死線</th><th>報價</th><th>收款</th><th>修改</th>${CLIENT() ? '' : '<th>原檔</th>'}</tr></thead>
      <tbody>${list.map((c) => {
        const d = deadlineInfo(c);
        return `<tr class="click" data-act="openC" data-id="${c.id}">
          <td>${esc(c.code)}</td><td>${esc(nickOf(clientOf(c)))}</td><td>${esc(c.title)}</td><td>${esc(c.type)}</td>
          <td>${esc(c.closed ? '結案' : M.stageOf(S.db, c).name)}</td><td class="${d.cls}">${esc(d.txt)}</td>
          <td>${money(c.price)}</td><td>${esc(payInfo(c))}</td><td>${M.countedRevisions(c)} / ${c.freeRevisions}</td>
          ${CLIENT() ? '' : `<td>${c.sourceFiles.length ? '✓' : (M.isDelivered(S.db, c) || c.closed ? '<span class="tag warn">缺</span>' : '—')}</td>`}</tr>`;
      }).join('') || '<tr><td colspan="10" class="empty">沒有符合條件的委託</td></tr>'}</tbody></table></div>`;
  }
  return `
  <div class="between">
    <div><h1>委託總覽</h1><div class="sub">${now.getFullYear()} 年 ${now.getMonth() + 1} 月</div></div>
    <div class="row">
      <label class="search"><span aria-hidden="true">🔍</span><input type="search" data-input="q" value="${esc(v.q)}" placeholder="搜尋委託人、暱稱、編號、項目" aria-label="搜尋"></label>
      <button class="btn" data-act="exportXlsx">匯出 Excel</button>
      <button class="btn" data-act="exportCsv">匯出 CSV</button>
      <button class="btn" data-act="followCase" title="貼上對方給的共享個案網址，雙方同步進度與對話">加入共享個案</button>
      <button class="btn pri" data-act="newCommission">＋ 新增委託</button>
    </div>
  </div>
  <div class="stats mt">
    <div class="stat"><div class="sub">進行中</div><div class="n">${st.active} <small>件</small></div></div>
    <div class="stat warn"><div class="sub">${set.upcomingDays} 天內死線</div><div class="n">${st.upcoming} <small>件</small></div></div>
    <div class="stat"><div class="sub">本月已收款</div><div class="n">${money(st.monthPaid)}</div></div>
    <div class="stat"><div class="sub">待收款</div><div class="n">${money(st.pending)}</div></div>
  </div>
  <div class="row mt">
    <button class="pill ${v.mode === 'board' ? 'on' : ''}" data-act="mode" data-v="board">看板</button>
    <button class="pill ${v.mode === 'list' ? 'on' : ''}" data-act="mode" data-v="list">列表</button>
    <a class="pill" href="#/calendar" style="display:inline-flex;align-items:center;color:inherit;text-decoration:none">行事曆</a>
    <span class="grow"></span>
    <label class="chk"><input type="checkbox" data-chg="showClosed" ${v.showClosed ? 'checked' : ''}> 顯示已結案</label>
    <select data-chg="type" aria-label="類型篩選" style="width:auto"><option value="">類型：全部</option>${optList(types, v.type)}</select>
    <select data-chg="sort" aria-label="排序" style="width:auto">
      <option value="deadline"${v.sort === 'deadline' ? ' selected' : ''}>依死線排序</option>
      <option value="start"${v.sort === 'start' ? ' selected' : ''}>依接單日（新到舊）</option>
      <option value="updated"${v.sort === 'updated' ? ' selected' : ''}>依最近更新</option>
    </select>
  </div>
  <div class="mt">${body}</div>
  ${CLIENT() && S.db.commissions.length ? clientPanels() : ''}`;
}

// 委託者帳總覽下方：該付款了、即將交稿
function clientPanels() {
  const open = S.db.commissions.filter((c) => !c.closed);
  const toPay = open.filter((c) => M.unpaid(c) > 0 && (M.isDelivered(S.db, c) || c.payments.some((p) => p.status !== 'paid')))
    .sort((a, b) => M.unpaid(b) - M.unpaid(a));
  const soon = M.upcoming(S.db).slice(0, 6);
  const row = (c, right, cls) => `<a class="between plist" href="#/c/${c.id}"><span>${esc(c.title || c.type)}・${esc(nickOf(clientOf(c)))}</span><span class="${cls}">${right}</span></a>`;
  return `<div class="split mt">
    <section class="panel main"><h2>該付款了</h2><div class="mt">${toPay.map((c) => row(c, `${M.isDelivered(S.db, c) ? '尾款' : '待付'} ${money(M.unpaid(c))}`, 'warnc')).join('') || '<div class="sub">目前沒有要付的款項</div>'}</div>
      <p class="hint">已收稿但還沒付清，或登記了「未付」的款項會列在這裡。</p></section>
    <section class="panel aside"><h2>即將交稿</h2><div class="mt">${soon.map((x) => row(x.c, esc(deadlineInfo(x.c).txt), deadlineInfo(x.c).cls)).join('') || '<div class="sub">最近沒有預計交稿的委託</div>'}</div></section>
  </div>`;
}

function cardHtml(c) {
  const cl = clientOf(c), d = deadlineInfo(c);
  const missing = !CLIENT() && (M.isDelivered(S.db, c) || c.closed) && !c.sourceFiles.length;
  return `<a href="#/c/${c.id}" class="card" draggable="true" data-card="${c.id}">
    <div class="row" style="gap:10px;flex-wrap:nowrap">
      <div class="av">${esc(initial(cl))}</div>
      <div style="min-width:0"><div style="font-weight:700">${esc(nickOf(cl))}</div><div class="sub" style="font-size:12px">${esc(c.title || c.type)}</div></div>
    </div>
    <div class="between" style="margin-top:9px;font-size:12px"><span class="${d.cls}">${esc(d.txt)}</span><span class="sub" style="font-size:12px">${esc(payInfo(c))}</span></div>
    ${missing ? '<div style="margin-top:6px"><span class="tag warn">缺繪圖原檔</span></div>' : ''}
    <div class="bar"><i style="width:${M.progressPct(S.db, c)}%"></i></div>
  </a>`;
}

// ───────── 單筆委託 ─────────
function vCommission(id) {
  const c = comm(id);
  if (!c) return `<div class="panel empty">找不到這筆委託。<a href="#/overview">回總覽</a></div>`;
  const cl = clientOf(c), set = S.db.settings, idx = M.stageIndex(S.db, c), d = deadlineInfo(c);
  const price = Number(c.price) || 0, paid = M.paidTotal(c);
  const revs = c.revisions.slice().reverse();
  const used = M.countedRevisions(c);
  const lastBk = S.db.meta.lastBackup;
  const bkOk = lastBk && lastBk.results.length && lastBk.results.every((r) => r.ok) ? Date.parse(lastBk.at) : 0;
  const newSince = c.sourceFiles.filter((f) => (f.addedTs || Date.parse(f.addedAt + 'T23:59:59')) > bkOk).length;
  const next = set.stages[idx + 1];
  return `
  <div class="between" style="align-items:flex-start">
    <div>
      <a href="#/overview" class="sub">← 回委託總覽</a>
      <h1 style="margin-top:6px">${esc(c.title || c.type || '（未命名委託）')} <span class="sub" style="font-size:14px;font-weight:400">#${esc(c.code)}</span>
        ${c.closed ? '<span class="tag">已結案</span>' : ''}</h1>
      <div class="sub" style="margin-top:6px">委託人：${cl ? `<a href="#/client/${cl.id}">${esc(nickOf(cl))}${cl.name && cl.nickname ? `（${esc(pv(cl.name))}）` : ''}</a>` : '未指定'}
        ｜類型：${esc(c.type || '—')}｜接單日 ${esc(c.startDate || '—')}${CLIENT() && cl && cl.queueUrl ? `｜<a href="#" data-act="ext" data-url="${esc(cl.queueUrl)}">繪師排單頁 ↗</a>` : ''}</div>
    </div>
    <div class="row">
      <button class="btn" data-act="editC" data-id="${c.id}">編輯</button>
      <button class="btn" data-act="toggleClose" data-id="${c.id}">${c.closed ? '重新開啟' : '結案'}</button>
      <button class="btn danger" data-act="delC" data-id="${c.id}">刪除</button>
      ${!c.closed && next ? `<button class="btn pri" data-act="nextStage" data-id="${c.id}">推進到「${esc(next.name)}」</button>` : ''}
    </div>
  </div>

  <ol class="steps mt" aria-label="委託進度">${set.stages.map((s, i) => `
    <li class="${i < idx || c.closed ? 'past' : i === idx ? 'cur' : ''}">
      <button data-act="setStage" data-id="${c.id}" data-stage="${s.id}" aria-current="${i === idx ? 'step' : 'false'}">
        <span class="dot">${i < idx || c.closed ? '✓' : i + 1}</span><span>${esc(s.name)}</span></button></li>`).join('')}
  </ol>

  <div class="split mt">
    <div class="main">
      <section class="panel">
        <div class="between">
          <h2>修改過程圖面紀錄</h2>
          <div class="row">
            <span class="sub">已計修改 <b class="${used > c.freeRevisions ? 'badc' : ''}">${used}</b> / 免費 ${c.freeRevisions} 次</span>
            <button class="btn sm" data-act="compare" data-id="${c.id}" ${S.view.cmp.length === 2 ? '' : 'disabled'}>並排比較（勾 2 張）</button>
          </div>
        </div>
        ${used > c.freeRevisions ? `<div class="warnpanel mt" style="padding:10px 14px">已超過免費修改次數 ${used - c.freeRevisions} 次，記得和委託人確認加價。</div>` : ''}
        ${dropZone('rev', c.id, '＋ 上傳新版本：把圖拖到這裡，或點一下選檔（每張圖會建立一個版本）')}
        <div class="mt">${revs.map((r) => `
          <div class="rev">
            <button class="img" data-act="viewRev" data-owner="${c.id}" data-rid="${r.id}" aria-label="檢視 ${esc(r.ver)}">${r.image && isImg(r.image) ? `<img src="${imgUrl(r.image.file)}" alt="" loading="lazy">` : ''}</button>
            <div class="grow col" style="gap:6px;min-width:0">
              <div class="row" style="gap:8px;flex-wrap:nowrap">
                <span class="ver">${esc(r.ver)}</span>
                <input type="text" value="${esc(r.title)}" data-chg="revField" data-f="title" data-owner="${c.id}" data-rid="${r.id}" aria-label="版本名稱" style="flex:1;min-width:80px;height:32px">
                <input type="date" value="${esc(r.date)}" data-chg="revField" data-f="date" data-owner="${c.id}" data-rid="${r.id}" aria-label="日期" style="width:150px;height:32px">
                <label class="chk sub" style="white-space:nowrap"><input type="checkbox" data-chg="cmpSel" data-rid="${r.id}" ${S.view.cmp.includes(r.id) ? 'checked' : ''}> 比較</label>
                <button class="btn sm ghost danger" style="padding:0 6px" data-act="delRev" data-owner="${c.id}" data-rid="${r.id}">刪除</button>
              </div>
              <textarea data-chg="revField" data-f="feedback" data-owner="${c.id}" data-rid="${r.id}" placeholder="註解／委託人回饋（這一版改了什麼）" aria-label="註解與回饋">${esc(r.feedback)}</textarea>
              <label class="chk sub"><input type="checkbox" data-chg="revField" data-f="counted" data-owner="${c.id}" data-rid="${r.id}" ${r.counted ? 'checked' : ''}> 計入修改次數</label>
            </div>
          </div>`).join('') || '<div class="empty">還沒有任何版本</div>'}</div>
      </section>
      <section class="panel">
        <h2>參考資料（這筆委託）</h2>
        <div class="mt">${thumbs(c.refs, 'refs', c.id)}</div>
        ${dropZone('refs', c.id, '＋ 拖曳或點選加入參考圖、委託單截圖')}
        ${refItemsBlock('comm', c.id, c.refItems)}
        ${cl && cl.refs.length ? `<p class="hint">委託人的角色設定圖在 <a href="#/client/${cl.id}">委託人資料卡</a>（${cl.refs.length} 張）。</p>` : ''}
      </section>
      <section class="panel">
        <h2>完成作品</h2>
        <div class="mt">${thumbs(c.finals, 'finals', c.id)}</div>
        ${dropZone('finals', c.id, '＋ 拖曳或點選加入完稿圖（交付給委託人的版本）')}
      </section>
    </div>

    <aside class="aside">
      ${casePanel(c)}
      <section class="${d.cls ? 'warnpanel' : 'panel'}">
        <h2>死線</h2>
        <div style="font-size:28px;font-weight:700;margin-top:8px">${c.deadline ? `${md(c.deadline)}（${wk(c.deadline)}）` : '未定'}</div>
        <div style="margin-top:4px">${esc(d.txt)}</div>
        <div class="mt">${c.milestones.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((m) => `
          <div class="ms ${m.done ? 'done' : ''}">
            <input type="checkbox" data-chg="msDone" data-owner="${c.id}" data-mid="${m.id}" ${m.done ? 'checked' : ''} aria-label="完成 ${esc(m.name)}">
            <span class="grow">${esc(m.name)}</span><span>${esc(md(m.date))}</span>
            <button class="btn sm ghost" data-act="delMs" data-owner="${c.id}" data-mid="${m.id}" aria-label="刪除階段日期">×</button>
          </div>`).join('') || '<div class="hint">可以替每個階段設定交付日期，例如草稿、線稿、上色。</div>'}</div>
        <form class="col mt" data-form="addMs" data-owner="${c.id}" style="gap:8px">
          <input type="text" name="name" placeholder="新增階段日期（如：線稿交付）" aria-label="階段名稱" list="stage-names">
          <div class="row" style="flex-wrap:nowrap"><input type="date" name="date" aria-label="日期"><button class="btn sm" type="submit">加入</button></div>
        </form>
        <button class="btn sm mt" data-act="autoMs" data-id="${c.id}" ${c.deadline ? '' : 'disabled'} title="把製作中的各階段，平均排在今天到死線之間">依死線自動排階段日期</button>
        <datalist id="stage-names">${set.stages.map((s) => `<option value="${esc(s.name)}交付">`).join('')}</datalist>
      </section>

      <section class="panel">
        <div class="between"><h2>收款紀錄</h2><span class="sub">報價 ${money(price)}</span></div>
        <div class="bar big mt"><i style="width:${price ? Math.min(100, (paid / price) * 100) : 0}%"></i></div>
        <div class="sub" style="margin-top:6px">已收 ${money(paid)}${price ? `（${Math.round((paid / price) * 100)}%）` : ''}｜未收 ${money(M.unpaid(c))}</div>
        <table class="t mt"><thead><tr><th>項目</th><th>金額</th><th>狀態</th><th></th></tr></thead><tbody>
        ${c.payments.map((p) => `<tr>
          <td><span style="white-space:nowrap">${esc(p.label)}</span>${p.proof ? ` <button class="btn sm ghost" style="padding:0 4px" data-act="viewProof" data-owner="${c.id}" data-pid="${p.id}" aria-label="看匯款截圖">🧾</button>` : ''}<div class="sub" style="font-size:12px">${esc([p.method, p.source, pv(M.accountLabel(S.db, p.account)), CLIENT() && p.payer ? '→ ' + pv(p.payer) : ''].filter(Boolean).join('｜'))}</div>${p.note ? `<div class="sub" style="font-size:12px;white-space:pre-wrap">${esc(p.note)}</div>` : ''}</td>
          <td>${amt(p.amount)}</td>
          <td><button class="btn sm ${p.status === 'paid' ? '' : 'danger'}" data-act="payToggle" data-owner="${c.id}" data-pid="${p.id}">${p.status === 'paid' ? `${esc(md(p.date))} 已收` : '未收'}</button></td>
          <td><button class="btn sm ghost" data-act="payEdit" data-owner="${c.id}" data-pid="${p.id}">編輯</button></td></tr>`).join('') || '<tr><td colspan="4" class="sub">還沒有收款紀錄</td></tr>'}
        </tbody></table>
        <button class="btn mt" style="width:100%" data-act="payAdd" data-id="${c.id}">＋ 記一筆收款（可附匯款截圖）</button>
      </section>

      ${CLIENT() ? '' : `<section class="panel">
        <div class="between"><h2>繪圖原檔備份</h2><span class="sub">${c.sourceFiles.length} 個檔案</span></div>
        <p class="hint">PSD、CLIP、SAI、KRA、Procreate 等原始檔放在這裡，會一起複製到所有備份位置，電腦壞掉也找得回來。</p>
        <div>${c.sourceFiles.map((f) => `
          <div class="file-row"><span class="file-ico">${esc(extOf(f))}</span>
            <div class="grow" style="min-width:0"><div style="word-break:break-all">${esc(f.name)}</div><div class="sub" style="font-size:12px">${sizeTxt(f.size)}｜${esc(f.addedAt)}</div>
              <input type="text" class="cap-line" value="${esc(f.caption)}" data-chg="caption" data-slot="source" data-owner="${c.id}" data-fid="${f.id}" placeholder="檔案說明（例：最終版、含拆件、印刷用 CMYK）" aria-label="檔案說明"></div>
            <button class="btn sm" data-act="openFile" data-rel="${esc(f.file)}">開啟</button>
            <button class="btn sm ghost" data-act="showFile" data-rel="${esc(f.file)}">位置</button>
            <button class="btn sm ghost danger" data-act="rmFile" data-slot="source" data-owner="${c.id}" data-fid="${f.id}" aria-label="移除">×</button>
          </div>`).join('')}</div>
        ${dropZone('source', c.id, '＋ 拖曳原檔到這裡，或點選選檔')}
        <div class="mt hint">${!set.backupFolders.length
          ? '<span class="badc">⚠ 還沒有設定備份資料夾</span>，原檔目前只存在這台電腦。<a href="#/settings">前往設定備份</a>'
          : newSince ? `<span class="warnc">有 ${newSince} 個新檔案還沒備份</span>，會在一分鐘內自動備份。<button class="btn sm" data-act="runBackup">立即備份</button>`
            : `✓ 已備份到 ${set.backupFolders.length} 個位置（${lastBk ? new Date(lastBk.at).toLocaleString('zh-TW', { hour12: false }) : ''}）`}</div>
      </section>`}

      <section class="panel" style="line-height:1.8">
        <div class="between"><h2>委託內容與授權</h2><div class="row">${CLIENT() ? '' : `<button class="btn sm ghost" data-act="saveTpl" data-id="${c.id}" title="把這筆的類型、價格、規格、授權存成價目表方案">存成方案</button>`}<button class="btn sm" data-act="editC" data-id="${c.id}">編輯</button></div></div>
        <div class="mt"><b>規格</b>：${esc(c.spec || '—')}</div>
        <div><b>授權</b>：${esc(c.license || '—')}</div>
        <div><b>放作品集</b>：${c.portfolioOk ? '可以（委託人已同意）' : '未同意／未確認'}</div>
        ${CLIENT() ? '' : `<div><b>公開排單</b>：${{ nick: '顯示暱稱', anon: '匿名（保密委託）', hidden: '不公開' }[c.publicMode || 'nick']}${c.publicNote ? `｜${esc(c.publicNote)}` : ''}</div>`}
        ${c.notes ? `<div><b>私人備註</b>：<span style="white-space:pre-wrap">${esc(c.notes)}</span></div>` : ''}
      </section>
    </aside>
  </div>`;
}

// ───────── 委託人 ─────────
// 所有標籤與使用次數（多到少）
function allTags() {
  const m = new Map();
  S.db.clients.forEach((cl) => cl.tags.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'));
}
// 名冊搜尋：名字、暱稱、標籤、社群、聯繫方式、備註、委託項目
function clientText(cl) {
  const cs = S.db.commissions.filter((c) => c.clientId === cl.id);
  return [cl.name, cl.nickname, cl.tags.join(' '), cl.socials.map((x) => x.platform + ' ' + x.url).join(' '), cl.contacts.map((x) => x.type + ' ' + x.value).join(' '),
    cl.notes, cl.terms, (cl.payMethods || []).map((x) => x.label || '').join(' '), cs.map((c) => c.code + ' ' + c.title + ' ' + c.type).join(' ')].join(' ').toLowerCase();
}
function vClients() {
  const q = S.view.q.trim().toLowerCase(), tag = S.view.ctag;
  const tags = allTags();
  const list = S.db.clients.filter((cl) => (!tag || cl.tags.includes(tag)) && (!q || q.split(/\s+/).every((w) => clientText(cl).includes(w))))
    .sort((a, b) => nickOf(a).localeCompare(nickOf(b), 'zh-Hant'));
  return `<div class="between"><h1>委託人名冊</h1>
    <div class="row"><label class="search"><span aria-hidden="true">🔍</span><input type="search" data-input="q" value="${esc(S.view.q)}" placeholder="搜尋名字、標籤、備註、委託項目" aria-label="搜尋"></label>
    <button class="btn" data-act="cardPaste">貼上名片代碼</button>
    <button class="btn pri" data-act="newClient">＋ 新增委託人</button></div></div>
    ${tags.length ? `<div class="tagbar mt" role="group" aria-label="依標籤篩選"><button class="tchip${tag ? '' : ' on'}" data-act="ctag" data-tag="" aria-pressed="${!tag}">全部 ${S.db.clients.length}</button>${tags.map(([t, n]) => `<button class="tchip${t === tag ? ' on' : ''}" data-act="ctag" data-tag="${esc(t)}" aria-pressed="${t === tag}">#${esc(t)} ${n}</button>`).join('')}</div>` : ''}
    ${q || tag ? `<p class="sub" style="margin:8px 0 0">找到 ${list.length} 位</p>` : ''}
    <div class="cgrid mt">${list.map((cl) => {
      const cs = S.db.commissions.filter((c) => c.clientId === cl.id);
      const act = cs.filter((c) => !c.closed).length;
      return `<button class="ccard" data-act="openClient" data-id="${cl.id}">
        <div class="av">${esc(initial(cl))}</div>
        <div style="min-width:0"><div style="font-weight:700">${esc(nickOf(cl))}</div>
        <div class="sub" style="font-size:12px">${esc(pv(cl.name || ''))}${cl.name && cs.length ? '｜' : ''}${cs.length ? `委託 ${cs.length} 件${act ? `（進行中 ${act}）` : ''}` : ''}</div>
        <div style="margin-top:4px">${cl.tags.slice(0, 4).map((t) => `<span class="tag pri${t === tag ? ' hit' : ''}">#${esc(t)}</span>`).join(' ')}</div></div></button>`;
    }).join('') || `<div class="panel empty">${q || tag ? '找不到符合的委託人' : '還沒有委託人'}</div>`}</div>`;
}

// 繪師資料卡（委託者帳）：排單與價目、繪師的收款方式
function artistExtras(cl) {
  const link = (u, t) => u ? `<div><a href="#" data-act="ext" data-url="${esc(u)}">${t} ↗</a></div>` : '';
  const pay = cl.payMethods.filter((x) => x.label);
  return `<div class="infobox"><h3 class="sub" style="font-weight:500;margin-bottom:6px">排單與價目</h3>
      ${link(cl.queueUrl, '排單頁')}${link(cl.priceUrl, '價目表')}
      ${cl.terms ? `<div style="white-space:pre-wrap;margin-top:4px">${esc(cl.terms)}</div>` : ''}
      ${!cl.queueUrl && !cl.priceUrl && !cl.terms ? '<div class="sub">按「編輯資料」可以加上排單頁、價目表和委託須知</div>' : ''}</div>
    <div class="infobox"><h3 class="sub" style="font-weight:500;margin-bottom:6px">繪師的收款方式</h3>
      ${pay.map((x, i) => `<div>${i === 0 ? '<b>主要</b>　' : ''}${esc(pv(x.label))}${x.detail ? `<span class="sub">　${esc(pv(x.detail))}</span>` : ''}</div>`).join('') || '<div class="sub">記下要轉帳到哪裡，記一筆付款時就能直接選</div>'}</div>`;
}

function vClient(id) {
  const cl = client(id);
  if (!cl) return `<div class="panel empty">找不到這位委託人。<a href="#/clients">回名冊</a></div>`;
  const cs = S.db.commissions.filter((c) => c.clientId === cl.id).sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const finals = cs.flatMap((c) => c.finals.map((f) => ({ f, c })));
  const total = cs.reduce((a, c) => a + (Number(c.price) || 0), 0);
  const logs = cl.logs.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const channels = [...new Set([...cl.contacts.map((x) => x.type), 'Discord', 'LINE', 'Email', 'X 私訊', 'FB 私訊', '其他'])];
  return `
  <div class="split">
    <div class="aside" style="max-width:420px">
      <a href="#/clients" class="sub">← 委託人名冊</a>
      <section class="panel col">
        <div class="row" style="flex-wrap:nowrap"><div class="av lg">${esc(initial(cl))}</div>
          <div><h1 style="font-size:22px">${esc(nickOf(cl))}</h1><div class="sub">${cl.name ? `本名：${esc(pv(cl.name))}` : ''}${cl.nickname && cl.name ? '｜' : ''}${cl.nickname ? `暱稱：${esc(pv(cl.nickname))}` : ''}</div></div></div>
        <div class="row" style="gap:6px">${CLIENT() && cl.openStatus ? `<span class="tag ${cl.openStatus === '開放接單' ? 'pri' : 'warn'}">${esc(cl.openStatus)}</span>` : ''}${cl.tags.map((t) => `<span class="tag pri tagx"><button type="button" class="tlink" data-act="ctagGo" data-tag="${esc(t)}" title="看所有有這個標籤的委託人">#${esc(t)}</button><button type="button" class="tdel" data-act="tagDel" data-id="${cl.id}" data-tag="${esc(t)}" aria-label="移除標籤 ${esc(t)}">×</button></span>`).join('')}
          <form class="tagadd" data-form="tagAdd" data-owner="${cl.id}"><input type="text" name="tag" list="alltags-dl" placeholder="＋ 標籤" aria-label="新增標籤"><datalist id="alltags-dl">${allTags().filter(([t]) => !cl.tags.includes(t)).map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist></form></div>
        ${CLIENT() ? artistExtras(cl) : ''}
        <div><h3 class="sub" style="font-weight:500;margin-bottom:6px">社群連結</h3>
          ${cl.socials.map((s) => `<div><a href="${esc(s.url)}" data-act="ext" data-url="${esc(s.url)}">${esc(s.platform)}　${PV() ? '（隱私模式）' : esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))} ↗</a></div>`).join('') || '<div class="sub">—</div>'}</div>
        <div><h3 class="sub" style="font-weight:500;margin-bottom:6px">聯繫管道</h3>
          ${cl.contacts.map((x) => `<div>${x.primary ? '<b>主要</b>　' : ''}${esc(x.type)}：${esc(pv(x.value))}</div>`).join('') || '<div class="sub">—</div>'}
          ${cl.replyTime ? `<div class="sub">回覆時段：${esc(cl.replyTime)}</div>` : ''}</div>
        <div><h3 class="sub" style="font-weight:500;margin-bottom:6px">私人備註（不會出現在公開排單和表格）</h3>
          <div style="white-space:pre-wrap;background:var(--stripe);border:1px solid var(--line2);border-radius:8px;padding:10px;line-height:1.7">${PV() ? '（隱私模式中不顯示）' : esc(cl.notes || '—')}</div></div>
        <div class="row"><button class="btn" data-act="editClient" data-id="${cl.id}">編輯資料</button><button class="btn pri" data-act="newCommissionFor" data-id="${cl.id}">＋ 為他新增委託</button>
          <span class="grow"></span><button class="btn sm ghost danger" data-act="delClient" data-id="${cl.id}">刪除</button></div>
      </section>
      <section class="panel">
        <h2>聯繫簡易紀錄</h2>
        <form class="col mt" data-form="addLog" data-owner="${cl.id}" style="gap:8px">
          <div class="row" style="flex-wrap:nowrap"><input type="date" name="date" value="${M.today()}" aria-label="日期" style="width:150px">
            <select name="channel" aria-label="管道">${optList(channels, (cl.contacts.find((x) => x.primary) || {}).type)}</select></div>
          <div class="row" style="flex-wrap:nowrap"><input type="text" name="text" placeholder="聊了什麼（例：傳草稿，對方要改手勢）" aria-label="內容"><button class="btn sm" type="submit">記錄</button></div>
        </form>
        <div class="col mt" style="gap:10px">${logs.map((l) => `<div class="between" style="align-items:flex-start;flex-wrap:nowrap"><div><span class="sub">${esc(md(l.date))} ${esc(l.channel)}</span><br>${PV() ? '（隱私模式中不顯示）' : esc(l.text)}</div>
          <button class="btn sm ghost" data-act="delLog" data-owner="${cl.id}" data-lid="${l.id}" aria-label="刪除紀錄">×</button></div>`).join('') || '<div class="sub">還沒有紀錄</div>'}</div>
      </section>
    </div>
    <div class="main" style="padding-top:26px">
      <section class="panel"><h2>設定圖／參考資料</h2>
        <div class="mt">${thumbs(cl.refs, 'clientRefs', cl.id)}</div>
        ${dropZone('clientRefs', cl.id, '＋ 拖曳角色設定圖、配色表、參考姿勢到這裡')}
        ${refItemsBlock('client', cl.id, cl.refItems)}</section>
      <section class="panel"><h2>完成作品</h2>
        <div class="thumbs mt">${finals.map(({ f, c }) => `<figure class="thumb"><button class="img" data-act="view" data-slot="finals" data-owner="${c.id}" data-fid="${f.id}" aria-label="檢視">${isImg(f) ? `<img src="${imgUrl(f.file)}" alt="" loading="lazy">` : `<span class="file-ico">${esc(extOf(f))}</span>`}</button>
          <figcaption>${esc(c.title)}（${esc((c.closedAt || c.startDate || '').slice(0, 7))}）</figcaption></figure>`).join('') || '<div class="sub">委託完成後，在單筆委託裡加入完稿圖就會出現在這裡。</div>'}</div></section>
      <section class="panel"><h2>委託歷史</h2>
        <div class="scroll-x mt"><table class="t" style="min-width:560px"><thead><tr><th>編號</th><th>項目</th><th>金額</th><th>狀態</th><th>死線／交付</th></tr></thead><tbody>
        ${cs.map((c) => `<tr class="click" data-act="openC" data-id="${c.id}"><td>${esc(c.code)}</td><td>${esc(c.title)}</td><td>${money(c.price)}</td>
          <td>${c.closed ? '<span style="color:var(--ok)">結案</span>' : `<span class="warnc">${esc(M.stageOf(S.db, c).name)}</span>`}</td><td>${esc(c.closed ? (c.closedAt || '') : (c.deadline || '未定'))}</td></tr>`).join('') || '<tr><td colspan="5" class="sub">還沒有委託</td></tr>'}
        </tbody></table></div>
        <div class="sub mt">累計委託 ${cs.length} 件｜累計金額 ${money(total)}${CLIENT() ? `｜已付 ${money(cs.reduce((a, c) => a + M.paidTotal(c), 0))}｜還沒付 ${money(cs.filter((c) => !c.closed).reduce((a, c) => a + M.unpaid(c), 0))}` : ''}</div></section>
    </div>
  </div>`;
}

// ───────── 收款紀錄 ─────────
function vPayments() {
  const v = S.view;
  const all = [];
  for (const c of S.db.commissions) for (const p of c.payments) all.push({ p, c });
  const months = [...new Set(all.map((x) => (x.p.date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const list = all.filter(({ p }) => (!v.payMonth || (p.date || '').startsWith(v.payMonth)) && (!v.payStatus || p.status === v.payStatus)
      && (!v.payAccount || (v.payAccount === '__none' ? !p.account : p.account === v.payAccount)) && (!v.paySource || (p.source || '') === v.paySource))
    .sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
  const sumPaid = list.filter((x) => x.p.status === 'paid').reduce((a, x) => a + (Number(x.p.amount) || 0), 0);
  const sumPend = list.filter((x) => x.p.status !== 'paid').reduce((a, x) => a + (Number(x.p.amount) || 0), 0);
  const noPay = S.db.commissions.filter((c) => !c.closed && M.unpaid(c) > 0);
  const byAcc = {};
  for (const { p } of list) if (p.status === 'paid') { const k = M.accountLabel(S.db, p.account) || '未指定帳戶'; byAcc[k] = (byAcc[k] || 0) + (Number(p.amount) || 0); }
  const sources = [...new Set(all.map((x) => x.p.source).filter(Boolean))];
  return `<div class="between"><h1>收款紀錄</h1><div class="row">
    <select data-chg="payAccount" aria-label="收款帳戶" style="width:auto"><option value="">全部帳戶</option>${S.db.settings.payAccounts.map((a) => `<option value="${a.id}"${a.id === v.payAccount ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}<option value="__none"${v.payAccount === '__none' ? ' selected' : ''}>未指定帳戶</option></select>
    <select data-chg="paySource" aria-label="款項來源" style="width:auto"><option value="">全部來源</option>${optList(sources, v.paySource)}</select>
    <select data-chg="payMonth" aria-label="月份" style="width:auto"><option value="">全部月份</option>${months.map((m) => `<option value="${m}"${m === v.payMonth ? ' selected' : ''}>${m.replace('-', ' 年 ')} 月</option>`).join('')}</select>
    <select data-chg="payStatus" aria-label="狀態" style="width:auto"><option value="">全部狀態</option><option value="paid"${v.payStatus === 'paid' ? ' selected' : ''}>已收</option><option value="pending"${v.payStatus === 'pending' ? ' selected' : ''}>未收</option></select>
    <button class="btn pri" data-act="quickPay">＋ 記一筆收款</button></div></div>
  <div class="stats mt" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="stat"><div class="sub">已收（篩選範圍）</div><div class="n">${money(sumPaid)}</div></div>
    <div class="stat"><div class="sub">已登記未收</div><div class="n">${money(sumPend)}</div></div>
    <div class="stat warn"><div class="sub">進行中委託尚未收齊</div><div class="n">${noPay.length} <small>件，共 ${money(noPay.reduce((a, c) => a + M.unpaid(c), 0))}</small></div></div>
  </div>
  ${Object.keys(byAcc).length ? `<div class="row mt sub">已收款依帳戶：${Object.entries(byAcc).map(([k, n]) => `<span class="tag pri">${esc(pv(k))} ${money(n)}</span>`).join(' ')}</div>` : ''}
  <div class="panel mt scroll-x"><table class="t" style="min-width:980px"><thead><tr><th>日期</th><th>委託</th><th>委託人</th><th>款項</th><th>金額</th><th>方式</th><th>款項來源</th><th>收款帳戶</th><th>付款人／後五碼</th><th>狀態</th></tr></thead><tbody>
  ${list.map(({ p, c }) => `<tr class="click" data-act="openC" data-id="${c.id}"><td>${esc(p.date || '—')}</td><td>${esc(c.code)} ${esc(c.title)}</td><td>${esc(nickOf(clientOf(c)))}</td>
    <td>${esc(p.label)}${p.note ? `<div class="sub" style="font-size:12px">${esc(p.note)}</div>` : ''}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td><td>${esc(p.source || '—')}</td><td>${esc(pv(M.accountLabel(S.db, p.account)) || '—')}</td><td>${esc(pv(p.payer) || '—')}</td>
    <td>${p.status === 'paid' ? '<span style="color:var(--ok)">已收</span>' : '<span class="warnc">未收</span>'}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">沒有紀錄</td></tr>'}
  </tbody></table></div>`;
}

// ───────── 死線行事曆 ─────────
function vCalendar() {
  const now = new Date();
  const base = S.view.calMonth ? M.parseDate(S.view.calMonth + '-01') : new Date(now.getFullYear(), now.getMonth(), 1);
  const y = base.getFullYear(), mo = base.getMonth();
  const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay());
  const events = {};
  const add = (d, e) => { (events[d] = events[d] || []).push(e); };
  for (const c of S.db.commissions) {
    if (c.closed) continue;
    const nick = nickOf(clientOf(c));
    if (c.deadline && !M.isDelivered(S.db, c)) add(c.deadline, { cls: 'dl', txt: `死線｜${nick} ${c.title}`, id: c.id });
    for (const m of c.milestones) if (m.date && !m.done) add(m.date, { cls: 'ms', txt: `${m.name}｜${nick}`, id: c.id });
  }
  const todayS = M.today();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ds = M.fmtDate(d);
    cells += `<div class="d ${d.getMonth() !== mo ? 'out' : ''} ${ds === todayS ? 'today' : ''}"><span class="num">${d.getDate()}</span>
      ${(events[ds] || []).map((e) => `<button class="chip ${e.cls}" data-act="openC" data-id="${e.id}" title="${esc(e.txt)}">${esc(e.txt)}</button>`).join('')}</div>`;
  }
  const prev = M.fmtDate(new Date(y, mo - 1, 1)).slice(0, 7), nextM = M.fmtDate(new Date(y, mo + 1, 1)).slice(0, 7);
  return `<div class="between"><h1>死線行事曆</h1><div class="row">
    <button class="btn" data-act="calMonth" data-v="${prev}">← 上個月</button><b style="min-width:110px;text-align:center">${y} 年 ${mo + 1} 月</b>
    <button class="btn" data-act="calMonth" data-v="${nextM}">下個月 →</button><button class="btn" data-act="calMonth" data-v="">今天</button></div></div>
    <div class="row mt sub"><span class="chip dl" style="width:auto">死線</span><span class="chip ms" style="width:auto">階段交付日</span></div>
    <div class="cal mt">${'日一二三四五六'.split('').map((w) => `<div class="h">${w}</div>`).join('')}${cells}</div>`;
}

// ───────── 作品圖庫 ─────────
function vGallery() {
  const items = [];
  for (const c of S.db.commissions) {
    for (const f of c.finals) items.push({ f, c, slot: 'finals', label: '完稿' });
    if (S.view.galleryRev) for (const r of c.revisions) if (r.image) items.push({ f: r.image, c, slot: 'rev', label: r.ver, rid: r.id });
  }
  items.sort((a, b) => (b.f.addedAt || '').localeCompare(a.f.addedAt || ''));
  const gc = galleryCols();
  return `<div class="between"><h1>作品圖庫</h1><div class="row"><label class="chk"><input type="checkbox" data-chg="galleryRev" ${S.view.galleryRev ? 'checked' : ''}> 也顯示修改過程圖</label>
    <div class="seg" role="group" aria-label="一排幾張">${['3', '6', '8'].map((n) => `<button type="button" data-act="gcols" data-v="${n}" aria-pressed="${n === gc}" class="${n === gc ? 'on' : ''}">${n} 欄</button>`).join('')}</div></div></div>
  <div class="thumbs gal gcols-${gc} mt">${items.map((x) => `
    <figure class="thumb"><button class="img" data-act="${x.slot === 'rev' ? 'viewRev' : 'view'}" data-slot="${x.slot}" data-owner="${x.c.id}" data-fid="${x.f.id}" data-rid="${x.rid || ''}" aria-label="檢視">
      ${isImg(x.f) ? `<img src="${imgUrl(x.f.file)}" alt="" loading="lazy">` : `<span class="file-ico">${esc(extOf(x.f))}</span>`}</button>
      <figcaption><a href="#/c/${x.c.id}">${esc(nickOf(clientOf(x.c)))}｜${esc(x.c.title)}</a> <span class="sub">${esc(x.label)}</span>${x.f.caption ? `<div class="sub" style="font-size:12px;white-space:pre-wrap">${esc(x.f.caption)}</div>` : ''}</figcaption></figure>`).join('') || '<div class="panel empty">還沒有作品。在單筆委託的「完成作品」加入完稿圖就會出現在這裡。</div>'}</div>`;
}

// ───────── Google 表格同步 ─────────
function vSync() {
  const s = S.db.settings.sync, m = S.db.meta, pp = S.db.settings.publicPage;
  const pv = S.syncPreview;
  const cl = CLIENT();
  if (!pv && !cl) api.syncPreview().then((p) => { S.syncPreview = p; if (route().name === 'sync') render(); });
  const status = S.syncRunning ? '同步中…'
    : m.lastSyncError ? `<span class="badc">上次同步失敗</span>：${esc(m.lastSyncError.message)}`
      : m.lastSync ? `✓ 上次同步：${new Date(m.lastSync).toLocaleString('zh-TW', { hour12: false })}` : '還沒同步過';
  return `<div class="between"><h1>Google 表格同步</h1><div class="row">
    ${m.sheetUrl ? `<button class="btn" data-act="ext" data-url="${esc(m.sheetUrl)}">開啟 Google 表格 ↗</button>` : ''}
    <button class="btn" data-act="exportXlsx">匯出 Excel</button>
    <button class="btn pri" data-act="runSync" ${s.url && !S.syncRunning ? '' : 'disabled'}>立即同步</button></div></div>
  <div class="sub mt">${status}</div>
  <div class="warnpanel mt" style="padding:10px 14px;line-height:1.7"><b>請不要把整份試算表設成「知道連結的人都能檢視」</b>，裡面也有收款明細和內部資料。${cl ? '' : '要給委託人看進度，請分享下方的「公開網址」。'}如果以前用過「檔案 › 共用 › 發布到網路」，請回到試算表取消發布。</div>
  ${s.url && m.pageVer && m.pageVer < 4 ? '<div class="warnpanel mt" style="padding:10px 14px">v1.4 更新了同步腳本（新增共享個案頁）。請按「複製同步腳本」，到 Apps Script 全部貼上取代，再到「部署 › 管理部署作業 › 編輯 › 版本：新版本」重新部署一次。</div>' : ''}
  ${cloudPanel()}
  <div class="split mt">
    <div class="aside" style="max-width:460px">
      <section class="panel col">
        <h2>連線設定</h2>
        <label class="f">Apps Script 網頁應用程式網址（/exec 結尾）
          <input type="url" data-chg="syncUrl" value="${esc(s.url)}" placeholder="https://script.google.com/macros/s/……/exec"></label>
        <div class="f"><span>同步密碼（已自動放進腳本裡）</span>
          <div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${esc(s.token || '（尚未產生）')}" class="mono" aria-label="同步密碼">
          <button class="btn sm" data-act="newToken">${s.token ? '重新產生' : '產生'}</button></div></div>
        <button class="btn" data-act="copyScript">複製同步腳本</button>
        <label class="chk"><input type="checkbox" data-chg="syncAuto" ${s.auto ? 'checked' : ''}> 資料有變動就自動同步（約 20 秒後）</label>
      </section>
      <section class="panel col" style="gap:4px">
        <h2 style="margin-bottom:6px">要同步的工作表</h2>
        ${[['public', '公開排單（表格＋網頁）'], ['internal', '內部進度總表'], ['payments', '收款明細'], ['clients', '委託人名冊（含聯繫方式，請勿公開分享）']].filter(([k]) => !(cl && k === 'public')).map(([k, t]) =>
          `<label class="chk"><input type="checkbox" data-chg="syncSheet" data-k="${k}" ${s.sheets[k] ? 'checked' : ''}> ${t}</label>`).join('')}
        ${cl ? '<p class="hint">委託者帳的工作表名稱前面會加上「委託者｜」，可以和繪師帳放在同一份試算表。</p>' : ''}
      </section>
      ${cl ? '' : `<section class="panel col" style="gap:4px">
        <h2 style="margin:0 0 6px">公開排單</h2>
        <label class="f">繪師名稱（標題）<input type="text" data-chg="artistName" value="${esc(S.db.settings.artistName)}" placeholder="你的名字"></label>
        <label class="f mt">接單狀態<input type="text" data-chg="statusText" value="${esc(s.statusText)}" placeholder="例：接單中（剩 2 個名額）"></label>
        <label class="chk mt"><input type="checkbox" data-chg="maskNames" ${s.maskNames ? 'checked' : ''}> 暱稱打碼（例：星○）</label>
        <p class="hint">只會公開暱稱、項目、進度、預計交付和「公開排單備註」，不會放本名、金額和聯繫方式。個別委託可以在「編輯委託」設成匿名或不公開。</p>
      </section>
      <section class="panel col">
        <h2>公開排單網頁</h2>
        <label class="f">預設檢視<select data-chg="ppView"><option value="list"${pp.view === 'list' ? ' selected' : ''}>清單（依狀態分組）</option><option value="board"${pp.view === 'board' ? ' selected' : ''}>看板（依進度分欄）</option></select></label>
        <label class="f">同一組裡的排列<select data-chg="ppSort"><option value="due"${pp.sort === 'due' ? ' selected' : ''}>預計交付日早的在前</option><option value="start"${pp.sort === 'start' ? ' selected' : ''}>接單日早的在前</option></select></label>
        <label class="f">委託洽詢方式<input type="text" data-chg="ppContact" value="${esc(pp.contact)}" placeholder="例：X 私訊 @你的帳號"></label>
        <label class="f">公告（顯示在最上方，可留空）<textarea data-chg="ppNote" placeholder="例：12 月開放 3 個名額，1/5 前交付">${esc(pp.note)}</textarea></label>
        <label class="chk"><input type="checkbox" data-chg="ppShowDelivered" ${pp.showDelivered ? 'checked' : ''}> 顯示最近已交付的委託</label>
        <label class="f">已結案的委託保留幾天<input type="number" min="0" max="365" data-chg="ppDays" value="${pp.deliveredDays}"></label>
        <div class="row"><button class="btn" data-act="openPublic">在瀏覽器預覽</button><button class="btn" data-act="exportPublic">匯出 HTML 檔</button></div>
        <div class="f"><span>公開網址（同步後就會更新）</span>
          ${s.url ? `<div class="row" style="flex-wrap:nowrap"><input type="text" readonly class="mono" value="${esc(s.url)}" aria-label="公開網址"><button class="btn sm" data-act="copyPublicUrl">複製</button></div>
          <span class="hint">這個 Apps Script 網址打開就是排單網頁，可以放在 X 個人簡介。網址太長可以用短網址服務縮短。</span>`
          : '<span class="hint">完成右邊的「第一次設定步驟」後，就會有公開網址。</span>'}</div>
      </section>`}
    </div>
    <div class="main">
      <section class="panel">
        <h2>第一次設定步驟（約 5 分鐘）</h2>
        <ol class="guide">
          <li>按左邊「產生」同步密碼，再按「複製同步腳本」。</li>
          <li>到 Google 雲端硬碟新增一份空白的 Google 試算表，名稱隨意（例：委託進度）。</li>
          <li>在試算表選單點 <b>擴充功能 › Apps Script</b>，把原本的程式碼全部刪掉，貼上剛剛複製的腳本，按儲存。</li>
          <li>右上角 <b>部署 › 新增部署作業</b>，類型選 <b>網頁應用程式</b>；「執行身分」選<b>我</b>，「誰可以存取」選<b>所有人</b>，按部署並授權（出現「Google 尚未驗證這個應用程式」時，點「進階」再點「前往」）。</li>
          <li>複製部署完成後的「網頁應用程式網址」（<span class="mono">/exec</span> 結尾），貼到左邊，再按「立即同步」。</li>
          ${cl ? '' : '<li>想讓委託人查進度：同一個 <span class="mono">/exec</span> 網址直接打開就是<b>公開排單網頁</b>（清單／看板可切換），把它貼到 X 置頂或委託頁就好。</li>'}
          <li>手機也要用：在上方「電腦與手機同步」複製<b>連線代碼</b>，到手機版的同一頁貼上，兩邊的資料就會自動同步。</li>
        </ol>
        <p class="hint">「所有人」的意思是知道網址的人可以呼叫這個腳本，但沒有同步密碼就不能寫入。之後如果重新產生密碼，要重新複製腳本貼上，並在「部署 › 管理部署作業」編輯成新版本。</p>
      </section>
      ${cl ? '' : `<section class="panel">
        <h2>公開排單表預覽</h2>
        ${pv ? `<div class="mt" style="border:1px solid var(--line3);border-radius:8px;overflow:hidden">
          <div style="padding:10px 14px;background:var(--side);color:#fff;font-weight:700">${esc(pv.title)}</div>
          <div class="scroll-x"><table class="t"><thead><tr>${pv.header.map((hh) => `<th style="padding-left:12px">${esc(hh)}</th>`).join('')}</tr></thead>
          <tbody>${pv.rows.map((r) => `<tr>${r.map((x) => `<td style="padding-left:12px">${esc(x)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${pv.header.length}" class="sub" style="padding-left:12px">目前沒有進行中的委託</td></tr>`}</tbody></table></div></div>` : '<div class="sub">載入中…</div>'}
      </section>`}
    </div>
  </div>`;
}

// 電腦與手機同步：兩本帳一起同步到使用者自己的 Google 試算表
function cloudPanel() {
  const c = S.cloud || {}, eff = c.effective || {};
  const m = S.db.meta.cloud || {};
  const status = S.cloudRunning ? '同步中…' : m.error ? `<span class="badc">同步失敗</span>：${esc(m.error)}` : m.at ? `✓ 上次同步：${esc(new Date(m.at).toLocaleString('zh-TW', { hour12: false }))}` : '還沒同步過';
  return `<section class="panel mt col">
    <div class="between"><h2>電腦與手機同步</h2><button class="btn pri" data-act="runCloud" ${eff.url && !S.cloudRunning ? '' : 'disabled'}>立即同步</button></div>
    <p class="hint" style="margin:0">繪師帳和委託者帳會一起存到你自己的 Google 試算表（隱藏的工作表），電腦和手機打開時會自動拉取、修改後約 15 秒自動上傳。圖片檔案不會同步，只同步文字資料。</p>
    <div class="sub">${eff.url ? status : '還沒設定：先完成下方的「第一次設定步驟」，或在手機版貼上電腦給的連線代碼。'}</div>
    ${eff.url && eff.token ? `<div class="f"><span>連線代碼（給另一台裝置用，請不要公開）</span>
      <div class="row" style="flex-wrap:nowrap"><input type="text" readonly class="mono" value="${esc(c.code || '')}" aria-label="連線代碼"><button class="btn sm" data-act="copyCode">複製</button></div></div>` : ''}
    <form class="row" data-form="cloudCode" style="flex-wrap:nowrap"><input type="text" name="code" placeholder="貼上另一台裝置的連線代碼（AL1- 開頭）" aria-label="貼上連線代碼"><button class="btn sm" type="submit">連線</button></form>
    <label class="chk"><input type="checkbox" data-chg="cloudAuto" ${c.auto !== false ? 'checked' : ''}> 自動同步</label>
  </section>`;
}

// ───────── 設定與備份 ─────────
function vSettings() {
  const set = S.db.settings, lb = S.db.meta.lastBackup, info = S.info || {};
  const used = (sid) => S.db.commissions.filter((c) => c.stageId === sid).length;
  return `<h1>設定與備份</h1>
  <div class="split mt">
    <div class="main">
      <section class="panel col">
        <h2>外觀</h2>
        <div class="seg theme-seg" role="group" aria-label="外觀">${Object.entries(THEMES).map(([k, v]) => `<button type="button" data-act="theme" data-v="${k}" class="${themePref() === k ? 'on' : ''}" aria-pressed="${themePref() === k}">${v}</button>`).join('')}</div>
        <h3 class="sub" style="font-weight:500;margin:4px 0 0">畫面大小</h3>
        <div class="seg" role="group" aria-label="畫面大小" style="max-width:560px">${ZOOM_LIST.map(([k, v]) => `<button type="button" data-act="zoom" data-v="${k}" class="${zoomPref() === k ? 'on' : ''}" aria-pressed="${zoomPref() === k}">${v}</button>`).join('')}</div>
      </section>
      ${WEB() ? `<section class="panel col">
        <h2>備份</h2>
        <p class="hint" style="margin:0">手機版的資料存在這支手機的瀏覽器裡。建議設定「電腦與手機同步」（在 Google 表格同步頁），文字資料就會存一份在你的 Google 試算表。圖片不會同步，可以定期匯出備份檔存到雲端硬碟。</p>
        <div class="row"><button class="btn pri" data-act="runBackup">匯出備份檔（含圖片）</button><button class="btn" data-act="restore">從備份檔還原…</button><button class="btn" data-act="checkMissing">檢查遺失的附件</button></div>
        ${S.db.meta.lastBackup ? `<div class="sub">上次匯出：${esc(new Date(S.db.meta.lastBackup.at).toLocaleString('zh-TW', { hour12: false }))}</div>` : ''}
      </section>` : `<section class="panel col">
        <div class="between"><h2>備份</h2><div class="row"><button class="btn" data-act="addBackup">＋ 新增備份位置</button><button class="btn pri" data-act="runBackup" ${set.backupFolders.length && !S.backupRunning ? '' : 'disabled'}>${S.backupRunning ? '備份中…' : '立即備份'}</button></div></div>
        <p class="hint">備份會複製全部資料、修改過程圖、成品圖、設定圖和繪圖原檔。建議設兩個位置：<br>
          ① <b>Google 雲端硬碟電腦版</b>的資料夾（例如 <span class="mono">G:\\我的雲端硬碟</span>），檔案會自動上傳到雲端，大型 PSD 也沒問題；<br>
          ② 外接硬碟或另一顆硬碟。<br>每次修改資料一分鐘後、開機時、和每 6 小時會自動備份；只複製有變動的檔案。</p>
        ${set.backupFolders.map((f) => {
          const r = lb && lb.results.find((x) => x.folder === f);
          return `<div class="file-row"><span class="file-ico">📁</span><div class="grow" style="min-width:0"><div style="word-break:break-all">${esc(f)}</div>
            <div class="sub" style="font-size:12px">${r ? (r.ok ? `✓ ${new Date(lb.at).toLocaleString('zh-TW', { hour12: false })} 備份成功（新複製 ${r.copied} 個檔案）` : `<span class="badc">失敗：${esc(r.error)}</span>`) : '尚未備份'}</div></div>
            <button class="btn sm ghost danger" data-act="rmBackup" data-v="${esc(f)}">移除</button></div>`;
        }).join('') || '<div class="warnpanel" style="padding:12px">⚠ 還沒有設定備份位置，電腦壞掉時資料和原檔都救不回來。</div>'}
        <label class="chk"><input type="checkbox" data-chg="autoBackup" ${set.autoBackup ? 'checked' : ''}> 自動備份</label>
        <div class="row"><button class="btn" data-act="restore">從備份還原…</button><button class="btn" data-act="checkMissing">檢查遺失的附件</button></div>
        <p class="hint" style="margin:0">繪師帳和委託者帳會一起備份到同一個位置。</p>
      </section>`}

      <section class="panel col">
        <div class="between"><h2>進度階段</h2><button class="btn" data-act="addStage">＋ 新增階段</button></div>
        <p class="hint">${CLIENT() ? '可以改名、調整順序、增減。設為「已交付」的階段代表已經收到完稿，不會再跳交稿提醒。' : '可以改名、調整順序、增減。「公開分組」決定這個階段在公開排單上歸類為準備中、製作中或已交付；設為「已交付」的階段不會再跳死線提醒。'}</p>
        ${set.stages.map((s, i) => `<div class="row" style="flex-wrap:nowrap">
          <span class="sub" style="width:22px">${i + 1}</span>
          <input type="text" value="${esc(s.name)}" data-chg="stageName" data-id="${s.id}" aria-label="階段名稱">
          <select data-chg="stageGroup" data-id="${s.id}" aria-label="${esc(s.name)} 的公開分組" style="width:120px"><option value="prep"${s.group === 'prep' ? ' selected' : ''}>準備中</option><option value="work"${s.group === 'work' ? ' selected' : ''}>製作中</option><option value="done"${s.group === 'done' ? ' selected' : ''}>已交付</option></select>
          <button class="btn sm" data-act="moveStage" data-id="${s.id}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
          <button class="btn sm" data-act="moveStage" data-id="${s.id}" data-v="1" ${i === set.stages.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
          <button class="btn sm ghost danger" style="min-width:84px" data-act="delStage" data-id="${s.id}" ${set.stages.length <= 1 ? 'disabled' : ''}>刪除${used(s.id) ? `（${used(s.id)}）` : ''}</button></div>`).join('')}
      </section>

      ${CLIENT() ? '' : `<section class="panel col">
        <div class="between"><h2>價目表（方案範本）</h2><button class="btn" data-act="addTpl">＋ 新增方案</button></div>
        <p class="hint" style="margin:0">新增委託時選一個方案，就會自動帶入類型、價格、免費修改次數、規格、授權和公開方式；填了「製作天數」還會自動算出死線。也可以在單筆委託按「存成方案」。</p>
        ${set.priceTemplates.map((t) => `<div class="tpl">
          <div class="fgrid" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:8px">
            <label class="f">方案名稱<input type="text" value="${esc(t.name)}" data-chg="tpl" data-f="name" data-id="${t.id}"></label>
            <label class="f">類型<input type="text" value="${esc(t.type)}" data-chg="tpl" data-f="type" data-id="${t.id}" list="tpl-types"></label>
            <label class="f">價格<input type="number" min="0" value="${esc(t.price)}" data-chg="tpl" data-f="price" data-id="${t.id}"></label>
            <label class="f">免費修改次數<input type="number" min="0" value="${esc(t.freeRevisions)}" data-chg="tpl" data-f="freeRevisions" data-id="${t.id}"></label>
            <label class="f">製作天數<input type="number" min="0" value="${esc(t.days)}" data-chg="tpl" data-f="days" data-id="${t.id}"></label>
            <label class="f">公開方式<select data-chg="tpl" data-f="publicMode" data-id="${t.id}"><option value="nick"${t.publicMode === 'nick' ? ' selected' : ''}>顯示暱稱</option><option value="anon"${t.publicMode === 'anon' ? ' selected' : ''}>匿名</option><option value="hidden"${t.publicMode === 'hidden' ? ' selected' : ''}>不公開</option></select></label>
            <label class="f" style="grid-column:span 2">授權範圍<input type="text" value="${esc(t.license)}" data-chg="tpl" data-f="license" data-id="${t.id}"></label>
            <label class="f" style="grid-column:1/-1">規格<input type="text" value="${esc(t.spec)}" data-chg="tpl" data-f="spec" data-id="${t.id}"></label>
          </div>
          <div style="text-align:right"><button class="btn sm ghost danger" data-act="rmTpl" data-id="${t.id}">刪除方案</button></div>
        </div>`).join('') || '<div class="sub">還沒有方案</div>'}
        <datalist id="tpl-types">${set.commissionTypes.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      </section>`}
    </div>
    <div class="aside">
      <section class="panel col">
        <h2>死線與提醒</h2>
        <label class="f">「即將到期」的範圍（天）<input type="number" min="1" max="120" data-chg="upcomingDays" value="${set.upcomingDays}"></label>
        <label class="f">提前幾天跳通知（用逗號分隔）<input type="text" data-chg="reminderDays" value="${esc(set.reminderDays.join(', '))}"></label>
        <label class="f">交付後幾天還沒收齊尾款就提醒（0＝不提醒）<input type="number" min="0" max="90" data-chg="unpaidRemindDays" value="${set.unpaidRemindDays}"></label>
        <label class="f">預設免費修改次數<input type="number" min="0" max="50" data-chg="freeRevisions" value="${set.freeRevisions}"></label>
        <div class="f">委託類型選項<span class="hint" style="margin:0">點一下可以改名，按 × 刪除，按 ＋ 新增</span>${chipEditor('commissionTypes', set.commissionTypes, '新增類型')}</div>
        ${(() => {
          const known = !S.view.customCur && CURRENCIES.some(([v]) => v === set.currency);
          return `<label class="f">貨幣符號<select data-chg="currencySel">${CURRENCIES.map(([v, n]) => `<option value="${esc(v)}"${v === set.currency ? ' selected' : ''}>${esc(v)}｜${esc(n)}</option>`).join('')}<option value="__c"${known ? '' : ' selected'}>自訂…</option></select>
          ${known ? '' : `<input type="text" data-chg="currency" value="${esc(set.currency)}" placeholder="輸入貨幣符號" aria-label="自訂貨幣符號" style="margin-top:6px">`}</label>`;
        })()}
      </section>
      <section class="panel col">
        <h2>收款帳戶</h2>
        <p class="hint" style="margin:0">記錄錢收到哪裡，方便對帳。<b>建議只寫銀行名稱和末五碼</b>，不要存完整帳號。</p>
        ${set.payAccounts.map((a) => `<div class="row" style="flex-wrap:nowrap">
          <input type="text" value="${esc(a.label)}" data-chg="accLabel" data-id="${a.id}" aria-label="帳戶名稱" placeholder="名稱" style="flex:1">
          <input type="text" value="${esc(a.detail)}" data-chg="accDetail" data-id="${a.id}" aria-label="帳戶說明" placeholder="說明" style="flex:1">
          <button class="btn sm ghost danger" data-act="rmAccount" data-id="${a.id}" aria-label="刪除帳戶">×</button></div>`).join('') || '<div class="sub">還沒有收款帳戶</div>'}
        <form class="row" data-form="addAccount" style="flex-wrap:nowrap">
          <input type="text" name="label" placeholder="名稱" title="例：中信 末五碼 12345（不要填完整帳號）" aria-label="帳戶名稱" style="flex:1">
          <input type="text" name="detail" placeholder="說明" title="例：委託專用" aria-label="帳戶說明" style="flex:1">
          <button class="btn sm" type="submit">新增</button></form>
        <div class="f">款項來源選項<span class="hint" style="margin:0">點一下可以改名，按 × 刪除，按 ＋ 新增</span>${chipEditor('paySources', set.paySources, '新增來源')}</div>
      </section>
      <section class="panel col" style="gap:4px">
        <h2 style="margin-bottom:6px">${CLIENT() || WEB() ? '顯示' : '小工具與啟動'}</h2>
        ${CLIENT() || WEB() ? '' : `<label class="chk"><input type="checkbox" data-chg="widgetOnTop" ${set.widgetOnTop ? 'checked' : ''}> 小工具固定在最上層</label>
        <label class="chk"><input type="checkbox" data-chg="autostart" ${set.autostart ? 'checked' : ''}> 開機時自動開啟小工具</label>`}
        ${WEB() ? '' : `<label class="chk"><input type="checkbox" data-chg="closeToTray" ${set.closeToTray ? 'checked' : ''}> 關閉視窗時縮到右下角系統匣（才收得到提醒）</label>`}
        <label class="chk"><input type="checkbox" data-chg="privacyMode" ${set.privacyMode ? 'checked' : ''}> 隱私模式（直播、截圖時把名字、金額、圖片打碼，通知也會打碼）</label>
      </section>
      ${info.portable ? `<section class="panel col">
        <h2>免安裝版</h2>
        <p class="hint" style="margin:0">資料存在程式資料夾裡的 <span class="mono">data</span>。整個資料夾複製到隨身碟或其他電腦就能直接用，資料會跟著走。</p>
        <p class="hint" style="margin:0">免安裝版沒有開始功能表捷徑，Windows 可能不會顯示死線通知。按下面的按鈕建立捷徑就能收到通知（搬移資料夾後要再按一次）。</p>
        <button class="btn" data-act="createShortcuts">建立桌面與開始功能表捷徑</button>
      </section>` : ''}
      ${WEB() ? '' : `<section class="panel col">
        <h2>資料位置</h2>
        <div class="mono" style="word-break:break-all">${esc(info.dataDir || '')}</div>
        <div class="row"><button class="btn" data-act="openDataDir">開啟資料夾</button><button class="btn" data-act="changeDataDir">搬移到其他位置…</button></div>
      </section>`}
      <section class="panel" style="line-height:1.8">
        <h2>關於</h2>
        <div class="mt">繪師委託帳本 v${esc(info.version || '')}${WEB() ? '（手機版）' : ''}｜目前：${CLIENT() ? '委託者帳' : '繪師帳'}</div>
        <div>製作人 肯茲</div>
        <div>問題回報與功能建議：<a href="mailto:leihustore@gmail.com" data-act="ext" data-url="mailto:leihustore@gmail.com">leihustore@gmail.com</a></div>
        <div class="row mt"><button class="btn sm" data-act="exportDiag">匯出診斷資訊</button><button class="btn sm" data-act="runWizard">重新執行首次設定</button></div>
        <p class="hint" style="margin:6px 0 0">回報問題時請寄「診斷資訊」檔，裡面只有版本、設定和錯誤紀錄，不含委託人資料。<b>請不要直接寄整個資料夾。</b></p>
      </section>
      ${WEB() ? '<section class="panel col"><h2>版本更新</h2><p class="hint" style="margin:0">手機版打開時會自動更新到最新版本，不用重新安裝。</p></section>' : `<section class="panel col">
        <h2>版本更新</h2>
        ${(() => {
          const u = S.db.meta.update || {}; const L = u.latest;
          const head = `<div>目前版本 v${esc(info.version || '')}${u.checkedAt ? `｜上次檢查 ${new Date(u.checkedAt).toLocaleString('zh-TW', { hour12: false })}` : ''}</div>`;
          if (u.error) return head + `<div class="badc">檢查失敗：${esc(u.error)}</div>`;
          if (u.newer && L) return head + `<div class="warnpanel" style="padding:12px 14px;line-height:1.7"><b>有新版本 v${esc(L.version)}</b>${L.date ? `（${esc(L.date)}）` : ''}
            ${L.notes.length ? `<ul style="margin:6px 0;padding-left:20px">${L.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            ${L.files.length ? `<details><summary>檔案檢查碼（SHA-256）</summary>${L.files.map((f) => `<div class="mono" style="word-break:break-all;margin-top:4px">${esc(f.name)}<br>${esc(f.sha256)}</div>`).join('')}<p class="hint">下載後可以在 PowerShell 輸入 <span class="mono">Get-FileHash 檔名</span> 比對，數字一樣就代表檔案沒被改過。</p></details>` : ''}
            <div class="mt"><button class="btn pri sm" data-act="openUpdate" ${L.page ? '' : 'disabled'}>開啟下載頁</button></div></div>`;
          return head + (L ? '<div style="color:var(--ok)">✓ 已是最新版本</div>' : '');
        })()}
        <div class="row"><button class="btn sm" data-act="checkUpdate">立即檢查更新</button></div>
        <label class="chk"><input type="checkbox" data-chg="autoUpdateCheck" ${set.autoUpdateCheck ? 'checked' : ''}> 自動檢查新版本（只會通知，不會自動下載安裝）</label>
        <details><summary class="sub">進階：版本資訊網址</summary>
          <label class="f mt">${info.hasBuiltinUpdateUrl ? '留空就使用內建網址' : '這一版沒有內建網址，請填入開發者提供的連結'}<input type="url" data-chg="updateUrl" value="${esc(set.updateUrl)}" placeholder="Google 雲端硬碟的分享連結或 https 網址"></label>
        </details>
      </section>`}
    </div>
  </div>`;
}

// 手機版「更多」：放不進底部分頁列的頁面
function vMore() {
  return `<h1>更多</h1>
  <div class="more-list mt">
    <a href="#/mycard">我的資料卡（分享給別人）</a>
    <a href="#/gallery">作品圖庫</a>
    <a href="#/sync">Google 表格同步・電腦與手機同步</a>
    <a href="#/settings">設定與備份・深色模式</a>
    <a href="#" data-act="exportXlsx">匯出 Excel</a>
    <a href="#" data-act="exportCsv">匯出 CSV</a>
  </div>
  <p class="hint mt">製作人 肯茲｜問題回報 leihustore@gmail.com</p>`;
}

// ───────── 對話框 ─────────
function openModal(html, opts = {}) {
  closeModal(true);
  const root = $('#modal-root');
  const note = PV() && /<form/.test(html) && /<input|<textarea/.test(html) ? '<div class="priv-note">隱私模式中：表單裡的資料不會打碼，直播或截圖時請注意。</div>' : '';
  root.innerHTML = tr(`<div class="modal-bg" data-bg="1"><div class="modal ${opts.wide ? 'wide' : ''} ${opts.cls || ''}" role="dialog" aria-modal="true">${note}${html}</div></div>`);
  S.modal = opts;
  const f = root.querySelector('form');
  if (f) { opts.hasForm = true; f.addEventListener('input', () => { opts.dirty = true; }); f.addEventListener('change', () => { opts.dirty = true; }); }
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await opts.onSubmit(new FormData(f), f);
    if (ok !== false) closeModal();
  });
  const first = root.querySelector('input:not([type=hidden]),select,textarea,button');
  if (first) first.focus();
  if (opts.onOpen) opts.onOpen(root);
}
function closeModal(silent) {
  $('#modal-root').innerHTML = '';
  const had = S.modal; S.modal = null;
  if (had && had.onClose) had.onClose();
  if (S.pendingDb && !silent) { S.db = S.pendingDb; S.pendingDb = null; render(); }
}
function confirmBox(msg, detail, okText = '確定') {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(msg)}</h2>${detail ? `<p class="sub" style="line-height:1.7">${esc(detail)}</p>` : ''}
      <form><div class="foot"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">${esc(okText)}</button></div></form>`,
    { onSubmit: () => { resolve(true); }, onClose: () => resolve(false) });
  });
}

function formCommission(c, presetClient) {
  const isNew = !c;
  const set = S.db.settings;
  c = c || { title: '', type: '', clientId: presetClient || '', startDate: M.today(), deadline: '', price: '', freeRevisions: set.freeRevisions, spec: '', license: '個人使用', portfolioOk: false, publicNote: '', notes: '', stageId: set.stages[0].id };
  const clients = S.db.clients.slice().sort((a, b) => nickOf(a).localeCompare(nickOf(b), 'zh-Hant'));
  const tpls = CLIENT() ? [] : set.priceTemplates;
  // 委託者帳新增委託：「快速記錄」只填必要的，「完整」才顯示全部欄位
  const canQuick = CLIENT() && isNew;
  const quick = canQuick && set.entryMode !== 'full';
  openModal(`<h2>${isNew ? '新增委託' : '編輯委託'}</h2>
  ${canQuick ? `<div class="seg mt" role="group" aria-label="輸入方式"><button type="button" data-entry="quick" aria-pressed="${quick}" class="${quick ? 'on' : ''}">快速記錄</button><button type="button" data-entry="full" aria-pressed="${!quick}" class="${quick ? '' : 'on'}">完整</button></div>
  <p class="hint" data-entry-hint style="margin:6px 0 0">${quick ? '只填必要的，其他之後在單筆委託裡補。會記住你上次選的方式。' : '所有欄位都在這裡；已經填的內容切換時會保留。'}</p>` : ''}
  <form class="fgrid mt ${quick ? 'qmode' : ''}">
    ${isNew && tpls.length ? `<label class="f full">套用價目表方案<select data-tpl><option value="">（不套用）</option>${tpls.map((t) => `<option value="${t.id}">${esc(t.name)}${Number(t.price) ? `｜${money(t.price)}` : ''}</option>`).join('')}</select></label>` : ''}
    ${isNew && !tpls.length && !CLIENT() ? '<p class="hint full" style="margin:0">小提示：在「設定與備份 › 價目表」建立方案後，新增委託時就能自動帶入價格、規格與授權。</p>' : ''}
    <label class="f" data-q>委託人
      <select name="clientId" data-newclient>${clients.map((cl) => `<option value="${cl.id}"${cl.id === c.clientId ? ' selected' : ''}>${esc(nickOf(cl))}${cl.name && cl.nickname ? `（${esc(cl.name)}）` : ''}</option>`).join('')}
      <option value="__new"${!c.clientId ? ' selected' : ''}>＋ 新委託人…</option></select></label>
    <label class="f" data-newclient-box data-q>新委託人暱稱<input type="text" name="newClient" placeholder="${CLIENT() ? '輸入名字就會建立一張繪師資料卡' : '之後可以再補完整資料'}"></label>
    <label class="f" data-q>${CLIENT() ? '委託什麼' : '項目名稱'}<input type="text" name="title" value="${esc(c.title)}" placeholder="例：VTuber 立繪拆件" required></label>
    ${(() => {
      // 類型用一般下拉選單（不會因為已經有值就只剩篩選結果）；選「其他…」才自己輸入
      const opts = [...new Set([...set.commissionTypes, ...(c.type ? [c.type] : [])])];
      return `<label class="f">類型<select name="type" data-typesel><option value="">（不分類）</option>${opts.map((t) => `<option value="${esc(t)}"${t === c.type ? ' selected' : ''}>${esc(t)}</option>`).join('')}<option value="__c">其他（自己輸入）…</option></select>
      <input type="text" name="typeCustom" data-typecustom placeholder="輸入類型名稱" aria-label="自訂類型" style="display:none;margin-top:6px"></label>`;
    })()}
    <label class="f">接單日<input type="date" name="startDate" value="${esc(c.startDate)}"></label>
    <label class="f" data-q>死線${CLIENT() ? '（可不填）' : ''}<input type="date" name="deadline" value="${esc(c.deadline)}"></label>
    <label class="f" data-q>報價金額<input type="number" min="0" name="price" value="${esc(c.price)}"></label>
    ${canQuick ? '<label class="f" data-q>已付訂金（沒付就留空）<input type="number" min="0" name="paidNow" placeholder="例：2000"></label>' : ''}
    <label class="f">免費修改次數<input type="number" min="0" name="freeRevisions" value="${esc(c.freeRevisions)}"></label>
    ${isNew ? `<label class="f">目前進度<select name="stageId">${set.stages.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>${canQuick ? '' : '<span></span>'}` : ''}
    <label class="f full">規格<input type="text" name="spec" value="${esc(c.spec)}" placeholder="例：全身、PSD 拆件約 60 層、4000×6000 px"></label>
    <label class="f full">授權範圍<input type="text" name="license" value="${esc(c.license)}" list="lic-dl" placeholder="例：個人使用，商用另議"><datalist id="lic-dl"><option value="個人使用"><option value="個人直播使用，商用需另議"><option value="商業使用（含周邊）"><option value="買斷"></datalist></label>
    <label class="chk full"><input type="checkbox" name="portfolioOk" ${c.portfolioOk ? 'checked' : ''}> 委託人同意完稿後放作品集</label>
    ${CLIENT() ? '' : `<label class="f">公開排單顯示方式<select name="publicMode">
      <option value="nick"${(c.publicMode || 'nick') === 'nick' ? ' selected' : ''}>顯示委託人暱稱</option>
      <option value="anon"${c.publicMode === 'anon' ? ' selected' : ''}>匿名（顯示為「保密委託」）</option>
      <option value="hidden"${c.publicMode === 'hidden' ? ' selected' : ''}>不放上公開排單</option></select><span class="hint" data-pm-hint></span></label>
    <label class="f">公開排單備註<input type="text" name="publicNote" value="${esc(c.publicNote)}" placeholder="會顯示在公開排單上"></label>`}
    <label class="f full" data-q>${CLIENT() ? '備註（可不填）' : '私人備註'}<textarea name="notes" placeholder="${CLIENT() ? '例：Discord 談的，要加手勢' : ''}">${esc(c.notes)}</textarea></label>
    <div class="foot full"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">${isNew ? '建立' : '儲存'}</button></div>
  </form>`, {
    wide: false,
    onOpen: (root) => {
      const sel = root.querySelector('[data-newclient]'), box = root.querySelector('[data-newclient-box]');
      const upd = () => { box.style.display = sel.value === '__new' ? '' : 'none'; };
      sel.addEventListener('change', upd); upd();
      const f = root.querySelector('form');
      root.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => {
        const q = b.dataset.entry === 'quick';
        f.classList.toggle('qmode', q);
        root.querySelectorAll('[data-entry]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        root.querySelector('[data-entry-hint]').textContent = q ? '只填必要的，其他之後在單筆委託裡補。會記住你上次選的方式。' : '所有欄位都在這裡；已經填的內容切換時會保留。';
        set.entryMode = q ? 'quick' : 'full';
      }));
      const pm = f.publicMode || { value: 'nick' }, hint = root.querySelector('[data-pm-hint]') || {};
      const tSel = f.type, tCus = f.typeCustom;
      const getType = () => (tSel.value === '__c' ? tCus.value : tSel.value).trim();
      const showCus = () => { const on = tSel.value === '__c'; tCus.style.display = on ? '' : 'none'; if (on) tCus.focus(); };
      const setType = (v) => {
        if (!v) { tSel.value = ''; } else if ([...tSel.options].some((o) => o.value === v && v !== '__c')) { tSel.value = v; } else { tSel.value = '__c'; tCus.value = v; }
        tCus.style.display = tSel.value === '__c' ? '' : 'none';
      };
      const onType = () => {
        if (getType() === '商業案' && pm.value === 'nick' && f.publicMode) { pm.value = 'anon'; hint.textContent = '商業案已自動改為匿名顯示，可以再自己調整'; }
      };
      tSel.addEventListener('change', () => { showCus(); onType(); }); tCus.addEventListener('input', onType);
      const tsel = root.querySelector('[data-tpl]');
      if (tsel) tsel.addEventListener('change', () => {
        const t = tpls.find((x) => x.id === tsel.value); if (!t) return;
        if (t.type) setType(t.type);
        if (!f.title.value.trim()) f.title.value = t.type || t.name;
        if (t.price !== '' && t.price !== undefined) f.price.value = t.price;
        if (t.freeRevisions !== '' && t.freeRevisions !== undefined) f.freeRevisions.value = t.freeRevisions;
        if (t.spec) f.spec.value = t.spec;
        if (t.license) f.license.value = t.license;
        if (t.publicMode) pm.value = t.publicMode;
        if (Number(t.days) > 0 && !f.deadline.value) {
          const base = M.parseDate(f.startDate.value) || new Date();
          f.deadline.value = M.fmtDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(t.days)));
        }
        onType();
        toast(`已套用「${t.name}」`);
      });
    },
    onSubmit: async (fd) => {
      let clientId = fd.get('clientId');
      if (clientId === '__new') {
        const nick = String(fd.get('newClient') || '').trim();
        if (!nick) { toast('請填新委託人的暱稱'); return false; }
        const cl = { id: uid(), name: '', nickname: nick, tags: [], socials: [], contacts: [], replyTime: '', notes: '', refs: [], refItems: [], logs: [], createdAt: M.today(), queueUrl: '', priceUrl: '', terms: '', payMethods: [], openStatus: '' };
        S.db.clients.push(cl); clientId = cl.id;
      }
      const target = isNew ? { id: uid(), code: await api.nextCode(), milestones: [], payments: [], revisions: [], refs: [], refItems: [], finals: [], sourceFiles: [], closed: false, createdAt: M.today() } : c;
      Object.assign(target, {
        clientId, title: String(fd.get('title') || '').trim(), type: String((fd.get('type') === '__c' ? fd.get('typeCustom') : fd.get('type')) || '').trim(),
        startDate: fd.get('startDate') || '', deadline: fd.get('deadline') || '', price: Number(fd.get('price')) || 0,
        freeRevisions: Number(fd.get('freeRevisions')) || 0, spec: fd.get('spec') || '', license: fd.get('license') || '',
        portfolioOk: !!fd.get('portfolioOk'), publicNote: fd.get('publicNote') || '', publicMode: fd.get('publicMode') || 'nick', notes: fd.get('notes') || ''
      });
      if (isNew) {
        target.stageId = fd.get('stageId') || set.stages[0].id;
        if (target.type && !set.commissionTypes.includes(target.type)) set.commissionTypes.push(target.type);
        // 快速記錄：順手記下已付的訂金，進度也跟著推到「已付訂金」
        const paidNow = Number(fd.get('paidNow')) || 0;
        if (paidNow > 0) {
          target.payments.push({ id: uid(), label: '訂金', amount: paidNow, method: '', date: M.today(), status: 'paid', proof: null, source: '', account: '', payer: '', note: '' });
          const ds = M.depositStage(S.db);
          if (ds && set.stages.indexOf(ds) > set.stages.findIndex((x) => x.id === target.stageId)) target.stageId = ds.id;
        }
        S.db.commissions.push(target);
      }
      touch(target);
      S.modal = null;
      await commit(isNew ? '已建立委託' : '已儲存');
      if (isNew) go(`#/c/${target.id}`);
    }
  });
}

const PLATFORMS = ['X', 'Facebook', 'Instagram', 'Threads', 'Bluesky', '噗浪', 'Twitch', 'YouTube', 'Pixiv', 'Discord', '網站', '其他'];
const CONTACTS = ['Discord', 'LINE', 'Email', 'X 私訊', 'FB 私訊', 'IG 私訊', 'Telegram', '電話', '其他'];

function formClient(cl) {
  const isNew = !cl;
  cl = cl || { name: '', nickname: '', tags: [], socials: [], contacts: [], replyTime: '', notes: '', queueUrl: '', priceUrl: '', terms: '', payMethods: [], openStatus: '' };
  const pmText = (cl.payMethods || []).map((x) => [x.label, x.detail].filter(Boolean).join('｜')).join('\n');
  const socials = cl.socials.length ? cl.socials : [{ platform: 'X', url: '' }, { platform: 'Facebook', url: '' }];
  const contacts = cl.contacts.length ? cl.contacts : [{ type: 'Discord', value: '', primary: true }];
  const sRow = (s) => `<div class="subrow"><select name="sp">${optList(PLATFORMS, s.platform)}</select><input type="text" name="su" value="${esc(s.url)}" placeholder="網址或帳號"><button type="button" class="btn sm ghost" data-rmrow aria-label="移除">×</button></div>`;
  const cRow = (x, i) => `<div class="subrow" style="grid-template-columns:140px 1fr 70px 36px"><select name="ct">${optList(CONTACTS, x.type)}</select><input type="text" name="cv" value="${esc(x.value)}" placeholder="帳號、ID 或信箱">
    <label class="chk sub"><input type="radio" name="cprimary" value="${i}" ${x.primary ? 'checked' : ''}> 主要</label><button type="button" class="btn sm ghost" data-rmrow aria-label="移除">×</button></div>`;
  openModal(`<h2>${isNew ? '新增委託人' : '編輯委託人'}</h2>
  <form class="fgrid mt">
    <label class="f">姓名<input type="text" name="name" value="${esc(cl.name)}"></label>
    <label class="f">暱稱<input type="text" name="nickname" value="${esc(cl.nickname)}"></label>
    <label class="f full">標籤（用逗號分隔）<input type="text" name="tags" value="${esc(cl.tags.join(', '))}" placeholder="例：回頭客, 付款準時, VTuber">
      ${allTags().length ? `<span class="row" style="gap:6px;margin-top:4px">${allTags().slice(0, 12).map(([t]) => `<button type="button" class="tchip sm" data-tagpick="${esc(t)}">#${esc(t)}</button>`).join('')}</span>` : ''}</label>
    <div class="f full"><span>社群連結</span><div data-rows="s">${socials.map(sRow).join('')}</div><button type="button" class="btn sm" data-addrow="s" style="width:max-content">＋ 新增社群</button></div>
    <div class="f full"><span>聯繫管道</span><div data-rows="c">${contacts.map(cRow).join('')}</div><button type="button" class="btn sm" data-addrow="c" style="width:max-content">＋ 新增聯繫方式</button></div>
    <label class="f full">回覆時段<input type="text" name="replyTime" value="${esc(cl.replyTime)}" placeholder="例：平日晚上"></label>
    ${CLIENT() ? `<label class="f">接單狀態<select name="openStatus"><option value="">（未填）</option>${optList(['開放接單', '暫停接單', '只接熟客'], cl.openStatus || '')}</select></label><span></span>
    <label class="f">排單頁網址<input type="url" name="queueUrl" value="${esc(cl.queueUrl)}" placeholder="https://"></label>
    <label class="f">價目表網址<input type="url" name="priceUrl" value="${esc(cl.priceUrl)}" placeholder="https://"></label>
    <label class="f full">委託須知<textarea name="terms" placeholder="例：訂金 50%，草稿後不退款；修改 3 次內免費">${esc(cl.terms)}</textarea></label>
    <label class="f full">繪師的收款方式（一行一個，第一行是主要；「｜」後面可寫說明）<textarea name="payMethods" placeholder="郵局轉帳 末五碼 12345｜戶名 王小明&#10;VGen">${esc(pmText)}</textarea><span class="hint">建議只寫銀行和末五碼，不要存完整帳號。</span></label>` : ''}
    <label class="f full">私人備註（喜好、雷點、注意事項，不會出現在公開排單和表格）<textarea name="notes">${esc(cl.notes)}</textarea></label>
    <div class="foot full"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">${isNew ? '建立' : '儲存'}</button></div>
  </form>`, {
    onOpen: (root) => {
      root.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-rmrow]'); if (rm) { rm.parentElement.remove(); return; }
        const add = e.target.closest('[data-addrow]');
        if (add) {
          const box = root.querySelector(`[data-rows="${add.dataset.addrow}"]`);
          box.insertAdjacentHTML('beforeend', tr(add.dataset.addrow === 's' ? sRow({ platform: 'X', url: '' }) : cRow({ type: 'Discord', value: '' }, box.children.length)));
          box.querySelectorAll('input[name=cprimary]').forEach((r, i) => { r.value = i; });
        }
      });
    },
    onSubmit: async (fd, form) => {
      const sp = fd.getAll('sp'), su = fd.getAll('su'), ct = fd.getAll('ct'), cv = fd.getAll('cv');
      const pri = Number(fd.get('cprimary') ?? 0);
      const normUrl = (p, u) => {
        u = u.trim(); if (!u) return '';
        if (/^https?:\/\//i.test(u)) return u;
        const h = u.replace(/^@/, '');
        const map = { X: 'https://x.com/', Instagram: 'https://instagram.com/', Threads: 'https://threads.net/@', Twitch: 'https://twitch.tv/', 噗浪: 'https://plurk.com/', Facebook: 'https://facebook.com/', Bluesky: 'https://bsky.app/profile/' };
        if (map[p] && !h.includes('.')) return map[p] + h;
        return /\./.test(h) ? 'https://' + h.replace(/^\/+/, '') : (map[p] ? map[p] + h : u);
      };
      const data = {
        name: String(fd.get('name') || '').trim(), nickname: String(fd.get('nickname') || '').trim(),
        tags: String(fd.get('tags') || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean),
        socials: sp.map((p, i) => ({ platform: p, url: normUrl(p, su[i] || '') })).filter((s) => s.url),
        contacts: ct.map((t, i) => ({ type: t, value: String(cv[i] || '').trim(), primary: i === pri })).filter((x) => x.value),
        replyTime: fd.get('replyTime') || '', notes: fd.get('notes') || ''
      };
      if (CLIENT()) {
        Object.assign(data, {
          openStatus: fd.get('openStatus') || '', queueUrl: String(fd.get('queueUrl') || '').trim(), priceUrl: String(fd.get('priceUrl') || '').trim(), terms: fd.get('terms') || '',
          payMethods: String(fd.get('payMethods') || '').split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [label, ...rest] = l.split('｜'); return { label: label.trim(), detail: rest.join('｜').trim() }; })
        });
      }
      if (!data.name && !data.nickname) { toast('姓名或暱稱至少填一個'); return false; }
      if (data.contacts.length && !data.contacts.some((x) => x.primary)) data.contacts[0].primary = true;
      let target = cl;
      if (isNew) { target = { id: uid(), refs: [], refItems: [], logs: [], createdAt: M.today() }; S.db.clients.push(target); }
      Object.assign(target, data);
      S.modal = null;
      await commit(isNew ? '已建立委託人' : '已儲存');
      if (isNew) go(`#/client/${target.id}`);
    }
  });
}

const PAY_LABELS = ['訂金', '尾款', '全額', '加購', '急件費', '修改加價', '其他'];
const PAY_METHODS = ['銀行轉帳', 'LINE Pay', '街口支付', 'PayPal', '現金', '超商代碼', '其他'];
function formPayment(c, p) {
  const isNew = !p;
  const unpaidNow = M.unpaid(c);
  const lastP = c.payments[c.payments.length - 1];
  p = p || { label: c.payments.length ? '尾款' : '訂金', amount: c.payments.length ? unpaidNow : Math.round((Number(c.price) || 0) / 2), method: lastP ? lastP.method : '銀行轉帳', status: 'paid', date: M.today(), proof: null,
    source: lastP ? lastP.source : '', account: lastP ? lastP.account : (S.db.settings.payAccounts[0] || {}).id || '', payer: lastP ? lastP.payer : '', note: '' };
  let proof = p.proof;
  // 委託者帳：繪師的收款方式帶進「付到繪師的哪個帳戶」；也有快速／完整兩種輸入
  const artist = CLIENT() ? clientOf(c) : null;
  const artistPay = artist ? artist.payMethods.filter((x) => x.label).map((x) => x.label) : [];
  if (CLIENT() && isNew && !p.payer && artistPay[0]) p.payer = artistPay[0];
  const canQuick = CLIENT() && isNew;
  const quick = canQuick && S.db.settings.entryMode !== 'full';
  openModal(`<h2>${isNew ? '記一筆收款' : '編輯收款'}｜${esc(c.title)}</h2>
  ${canQuick ? `<div class="seg mt" role="group" aria-label="輸入方式"><button type="button" data-entry="quick" aria-pressed="${quick}" class="${quick ? 'on' : ''}">快速記錄</button><button type="button" data-entry="full" aria-pressed="${!quick}" class="${quick ? '' : 'on'}">完整</button></div>` : ''}
  <form class="fgrid mt ${quick ? 'qmode' : ''}">
    <label class="f" data-q>款項<input type="text" name="label" value="${esc(p.label)}" list="pl-dl"><datalist id="pl-dl">${PAY_LABELS.map((x) => `<option value="${x}">`).join('')}</datalist></label>
    <label class="f" data-q>金額<input type="number" min="0" name="amount" value="${esc(p.amount)}" required></label>
    <label class="f">付款方式<input type="text" name="method" value="${esc(p.method)}" list="pm-dl"><datalist id="pm-dl">${PAY_METHODS.map((x) => `<option value="${x}">`).join('')}</datalist></label>
    <label class="f" data-q>日期<input type="date" name="date" value="${esc(p.date)}"></label>
    <label class="f" data-q>狀態<select name="status"><option value="paid"${p.status === 'paid' ? ' selected' : ''}>已收</option><option value="pending"${p.status !== 'paid' ? ' selected' : ''}>未收（預計收款）</option></select></label>
    <label class="f">款項來源<input type="text" name="source" value="${esc(p.source)}" list="ps-dl" placeholder="例：委託人本人、代付、Skeb"><datalist id="ps-dl">${S.db.settings.paySources.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <label class="f">收款帳戶<select name="account"><option value="">（未指定）</option>${S.db.settings.payAccounts.map((a) => `<option value="${a.id}"${a.id === p.account ? ' selected' : ''}>${esc(a.label)}</option>`).join('')}</select>
      ${S.db.settings.payAccounts.length ? '' : '<span class="hint">到「設定與備份 › 收款帳戶」新增後就能選</span>'}</label>
    <label class="f">付款人／轉帳後五碼<input type="text" name="payer" value="${esc(p.payer)}" list="payer-dl" placeholder="${CLIENT() ? '例：郵局 末五碼 12345（繪師資料卡填了就能直接選）' : '對帳用，例：王小明、末五碼 12345'}"><datalist id="payer-dl">${artistPay.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
    <div class="f"><span>匯款截圖</span><div class="row"><button type="button" class="btn sm" data-pickproof>選擇圖片</button><span class="sub" data-proofname>${esc(proof ? proof.name : '未附')}</span></div></div>
    <label class="f full">備註<textarea name="note" placeholder="例：分兩次匯、平台手續費 10%、對方用公司名義付款">${esc(p.note)}</textarea></label>
    <div class="foot full">${!isNew ? '<button type="button" class="btn danger" data-delpay style="margin-right:auto">刪除這筆</button>' : ''}<button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">儲存</button></div>
  </form>`, {
    onOpen: (root) => {
      const f = root.querySelector('form');
      root.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => {
        const q = b.dataset.entry === 'quick';
        f.classList.toggle('qmode', q);
        root.querySelectorAll('[data-entry]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        S.db.settings.entryMode = q ? 'quick' : 'full';
      }));
      root.querySelector('[data-pickproof]').addEventListener('click', async () => {
        const r = await api.pickFiles('proof', { images: true, single: true });
        if (r[0]) { proof = r[0]; root.querySelector('[data-proofname]').textContent = proof.name; }
      });
      const del = root.querySelector('[data-delpay]');
      if (del) del.addEventListener('click', async () => {
        c.payments = c.payments.filter((x) => x.id !== p.id); touch(c);
        S.modal = null; closeModal(); await commit('已刪除');
      });
    },
    onSubmit: async (fd) => {
      const data = {
        label: fd.get('label') || '款項', amount: Number(fd.get('amount')) || 0, method: fd.get('method') || '', date: fd.get('date') || '', status: fd.get('status'), proof,
        source: String(fd.get('source') || '').trim(), account: fd.get('account') || '', payer: String(fd.get('payer') || '').trim(), note: fd.get('note') || ''
      };
      if (data.source && !S.db.settings.paySources.includes(data.source)) S.db.settings.paySources.push(data.source);
      if (isNew) c.payments.push({ id: uid(), ...data }); else Object.assign(p, data);
      touch(c);
      S.modal = null;
      await commit('已記錄收款');
      const cid = c.id, paidNow = data.status === 'paid';
      setTimeout(() => afterPayment(cid, paidNow), 0);
    }
  });
}

function setupWizard() {
  const set = S.db.settings;
  openModal(`<h2>歡迎使用繪師委託帳本</h2>
  <p class="sub" style="line-height:1.7">先花一分鐘設定幾個項目，之後都可以在「設定與備份」修改。</p>
  <form class="col mt" style="gap:16px">
    <div class="f"><span>你主要用來記什麼？（兩本帳分開存，之後隨時可以在左上角切換）</span>
      <label class="chk"><input type="radio" name="book" value="artist" ${BOOK() === 'artist' ? 'checked' : ''}> 我是繪師：記錄接到的委託、收款、死線</label>
      <label class="chk"><input type="radio" name="book" value="client" ${BOOK() === 'client' ? 'checked' : ''}> 我是委託者：記錄我委託繪師的進度、付款、交稿日</label></div>
    <label class="f" data-wz-artist>繪師名稱（公開排單的標題）<input type="text" name="artistName" value="${esc(set.artistName)}" placeholder="你的名字"></label>
    ${WEB() ? '' : `<div class="f"><span>備份位置（強烈建議）</span>
      <span class="hint">選 Google 雲端硬碟電腦版的資料夾或外接硬碟，資料、圖片和繪圖原檔都會自動備份過去，電腦壞掉也救得回來。</span>
      <div class="row"><button type="button" class="btn sm" data-wz="backup">選擇備份資料夾</button><span class="sub" data-wz-bk>${set.backupFolders.length ? `已設定 ${set.backupFolders.length} 個` : '尚未設定'}</span></div></div>`}
    <label class="f">收款帳戶（選填）<input type="text" name="account" placeholder="例：中信 末五碼 12345（不要填完整帳號）"></label>
    ${WEB() ? '' : `<label class="chk" data-wz-artist><input type="checkbox" name="autostart" ${set.autostart ? 'checked' : ''}> 開機時自動開啟桌面小工具</label>`}
    <p class="hint" style="margin:0">價目表、Google 表格同步和公開排單網頁，之後可以在「設定與備份」與「Google 表格同步」頁設定。</p>
    <div class="foot"><button type="button" class="btn" data-wz="later">稍後再說</button><button class="btn pri" type="submit">完成</button></div>
  </form>`, {
    onOpen: (root) => {
      const showArtist = () => { const v = (root.querySelector('input[name=book]:checked') || {}).value; root.querySelectorAll('[data-wz-artist]').forEach((x) => { x.hidden = v === 'client'; }); };
      root.querySelectorAll('input[name=book]').forEach((r) => r.addEventListener('change', showArtist)); showArtist();
      root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-wz]'); if (!b) return;
      if (b.dataset.wz === 'backup') {
        const r = await api.addBackupFolder();
        if (r && r.error) toast(r.error);
        else if (r) {
          const fresh = await api.getDb();
          S.db.settings.backupFolders = fresh.settings.backupFolders;
          root.querySelector('[data-wz-bk]').textContent = `已設定 ${S.db.settings.backupFolders.length} 個`;
        }
      }
      if (b.dataset.wz === 'later') {
        S.db.settings.setupDone = true; S.modal = null; closeModal();
        await commit('之後可以在「設定與備份」重新執行首次設定');
      }
    });
    },
    onSubmit: async (fd) => {
      const want = fd.get('book') || BOOK();
      if (want !== BOOK()) {
        // 選了另一本帳：兩本帳都標記完成，切過去
        S.db.settings.setupDone = true; await commit();
        await switchBook(want, true);
      }
      const st = S.db.settings;
      st.artistName = String(fd.get('artistName') || '').trim();
      const acc = String(fd.get('account') || '').trim();
      if (acc && !st.payAccounts.some((a) => a.label === acc)) st.payAccounts.push({ id: 'acc_' + uid().slice(0, 8), label: acc, detail: '' });
      const auto = !!fd.get('autostart');
      st.autostart = auto;
      st.setupDone = true;
      S.modal = null;
      await commit(WEB() ? '設定完成。記得到「Google 表格同步」設定電腦與手機同步' : st.backupFolders.length ? '設定完成' : '設定完成。記得之後到「設定與備份」設定備份位置');
      if (!CLIENT()) await api.setAutostart(auto);
    }
  });
}

function pickCommission(title, then) {
  const list = S.db.commissions.filter((c) => !c.closed).sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  if (!list.length) { toast('目前沒有進行中的委託'); return; }
  openModal(`<h2>${esc(title)}：選擇委託</h2><form class="col mt">
    <select name="cid" size="8" style="height:auto" required>${list.map((c, i) => `<option value="${c.id}"${i === 0 ? ' selected' : ''}>${esc(nickOf(clientOf(c)))}｜${esc(c.title)}（${esc(c.code)}）</option>`).join('')}</select>
    <div class="foot"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">下一步</button></div></form>`, {
    onSubmit: (fd) => { const c = comm(fd.get('cid')); S.modal = null; closeModal(); setTimeout(() => then(c), 0); return false; }
  });
}

function viewer(items, index) {
  let i = index;
  const draw = () => {
    const it = items[i];
    openModal(`<div class="between"><b>${esc(it.title || it.f.name)}</b><div class="row">
      <span class="sub" style="color:#aaa">${i + 1} / ${items.length}</span>
      <button class="btn sm" data-v="prev" ${i === 0 ? 'disabled' : ''}>←</button><button class="btn sm" data-v="next" ${i === items.length - 1 ? 'disabled' : ''}>→</button>
      <button class="btn sm" data-v="open">用預設程式開啟</button><button class="btn sm" data-v="show">在資料夾中顯示</button><button class="btn sm" data-act="close">關閉</button></div></div>
      <div class="mt">${isImg(it.f) ? `<img src="${imgUrl(it.f.file)}" alt="${esc(it.f.name)}">` : `<div class="empty">這個檔案無法預覽：${esc(it.f.name)}</div>`}</div>
      ${it.note ? `<p style="color:#ddd;white-space:pre-wrap">${esc(it.note)}</p>` : ''}`, {
      cls: 'viewer wide',
      onOpen: (root) => root.querySelector('.modal').addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        if (b.dataset.v === 'prev' && i > 0) { i--; draw(); }
        if (b.dataset.v === 'next' && i < items.length - 1) { i++; draw(); }
        if (b.dataset.v === 'open') api.openFile(it.f.file);
        if (b.dataset.v === 'show') api.showFile(it.f.file);
      })
    });
    S.modal.viewer = { prev: () => { if (i > 0) { i--; draw(); } }, next: () => { if (i < items.length - 1) { i++; draw(); } } };
  };
  draw();
}

// ───────── 動作 ─────────
async function switchBook(b, silent) {
  if (b === BOOK()) return;
  closeModal(true);
  S.db = await api.switchBook(b);
  S.syncPreview = null;
  S.view = Object.assign(S.view, { q: '', type: '', payAccount: '', paySource: '', cmp: [], ctag: '' });
  // 切到另一本帳時不再跳首次設定（備份位置兩本帳共用）
  if (!S.db.settings.setupDone) { S.db.settings.setupDone = true; await api.putDb(S.db); }
  if (location.hash === '#/overview') render(); else location.hash = '#/overview';
  if (!silent) toast(b === 'client' ? '已切換到委託者帳：記錄你委託繪師的進度與付款' : '已切換到繪師帳：記錄你接的委託');
}

// 參考資料的網址與文字紀錄（圖片以外的參考：Pinterest、雲端資料夾、文字設定）
const isUrl = (t) => /^https?:\/\/\S+$/i.test(t);
function refItemsBlock(kind, owner, items) {
  const rows = (items || []).map((r) => {
    const body = PV() ? '<span class="sub">（隱私模式中不顯示）</span>'
      : r.url ? `<a href="#" data-act="ext" data-url="${esc(r.url)}">🔗 ${esc(r.title || r.url.replace(/^https?:\/\/(www\.)?/, ''))} ↗</a>`
        : `<div style="white-space:pre-wrap">${esc(r.text)}</div>`;
    return `<div class="refitem">${r.url ? '' : '<span class="ri-ico" aria-hidden="true">📝</span>'}<div style="flex:1;min-width:0;word-break:break-all">${body}${r.url && r.text && !PV() ? `<div class="sub" style="white-space:pre-wrap">${esc(r.text)}</div>` : ''}</div>
      <button class="btn sm ghost" data-act="delRefItem" data-kind="${kind}" data-owner="${owner}" data-rid="${r.id}" aria-label="刪除這筆參考">×</button></div>`;
  }).join('');
  return `<div class="refitems mt">${rows}</div>
  <form class="row mt" data-form="addRefItem" data-kind="${kind}" data-owner="${owner}" style="flex-wrap:nowrap;align-items:flex-start">
    <textarea name="v" rows="1" placeholder="貼上網址，或輸入文字說明（例：髮色 #3B2A4F、左眼有痣）" aria-label="新增網址或文字參考" style="flex:1;min-height:38px"></textarea>
    <button class="btn sm" type="submit">加入</button></form>`;
}
const refOwner = (kind, id) => (kind === 'client' ? client(id) : comm(id));

// ───────── 我的資料卡（可分享：圖片＋名片代碼）─────────
const ROLE_NAME = () => (CLIENT() ? '委託者' : '繪師');
function myProfile() {
  const set = S.db.settings;
  const p = Object.assign(Card.emptyProfile(), set.profile || {});
  if (!set.profile) { p.nickname = CLIENT() ? '' : (set.artistName || ''); p.types = CLIENT() ? [] : set.commissionTypes.slice(0, 6); }
  return p;
}
function vMyCard() {
  const p = myProfile(), role = CLIENT() ? 'client' : 'artist';
  const filled = !!(S.db.settings.profile && p.nickname);
  return `<div class="between"><h1>我的資料卡</h1><div class="row">
    <button class="btn" data-act="cardEdit">${filled ? '編輯資料卡' : '開始填寫'}</button>
    <button class="btn" data-act="cardCopy" ${filled ? '' : 'disabled'}>複製名片代碼</button>
    <button class="btn pri" data-act="cardImage" ${filled ? '' : 'disabled'}>${WEB() ? '分享／下載圖片' : '下載圖片'}</button></div></div>
  <p class="hint">做一張${ROLE_NAME()}資料卡傳給對方，${CLIENT() ? '繪師' : '委託人'}一看就知道怎麼聯絡你${CLIENT() ? '' : '、接哪些委託'}。圖片可以貼到社群或私訊；對方如果也用繪師委託帳本，到名冊按「貼上名片代碼」就會直接建立一張資料卡。</p>
  <div class="warnpanel mt" style="padding:10px 14px;line-height:1.7">資料卡會給別人看，<b>不要放完整銀行帳號、地址或電話</b>。收款方式只寫名稱（例：郵局轉帳、VGen），帳號等成交後再私下給。</div>
  <div class="mt cardprev-wrap">${filled ? (PV() ? '<div class="panel empty">隱私模式中不顯示資料卡預覽</div>' : `<canvas id="cardprev" aria-label="資料卡預覽" role="img"></canvas>`) : '<div class="panel empty">還沒有填寫資料卡。按「開始填寫」，填好就能產生圖片和名片代碼。</div>'}</div>
  <section class="panel col mt">
    <h2>收到別人的名片代碼？</h2>
    <p class="hint" style="margin:0">到「委託人名冊」按「貼上名片代碼」，或直接在這裡貼上。</p>
    <form class="row" data-form="cardImport" style="flex-wrap:nowrap"><input type="text" name="code" placeholder="貼上 ALCARD1- 開頭的代碼" aria-label="貼上名片代碼" style="flex:1"><button class="btn sm" type="submit">加入名冊</button></form>
  </section>`;
}
function afterRenderCard() {
  const cv = $('#cardprev'); if (!cv) return;
  drawCard(cv, Card.clean(myProfile(), CLIENT() ? 'client' : 'artist'));
}

// 以 canvas 畫資料卡（1080 寬，高度依內容）
function drawCard(cv, p) {
  const W = 1080, PAD = 72, FONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif';
  const ctx0 = cv.getContext('2d');
  const wrap = (ctx, text, max) => {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const ch of para) { if (ctx.measureText(line + ch).width > max && line) { lines.push(line); line = ch; } else line += ch; }
      lines.push(line);
    }
    return lines;
  };
  const sections = [];
  if (p.role === 'artist' && p.types.length) sections.push({ h: '接的委託', chips: p.types });
  if (p.contacts.length) sections.push({ h: '聯繫方式', rows: p.contacts.map((c) => [c.type, c.value]) });
  if (p.socials.length) sections.push({ h: '社群', rows: p.socials.map((s) => [s.platform, s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')]) });
  if (p.role === 'artist') {
    const links = [p.queueUrl && ['排單', p.queueUrl.replace(/^https?:\/\/(www\.)?/, '')], p.priceUrl && ['價目表', p.priceUrl.replace(/^https?:\/\/(www\.)?/, '')]].filter(Boolean);
    if (links.length) sections.push({ h: '排單與價目', rows: links });
    if (p.payMethods.length) sections.push({ h: '收款方式', chips: p.payMethods });
    if (p.terms) sections.push({ h: '委託須知', text: p.terms, maxLines: 9 });
  }
  if (p.replyTime) sections.push({ h: '回覆時段', text: p.replyTime, maxLines: 2 });
  // 先量高度再畫
  const layout = (ctx, draw) => {
    let y = 0;
    const header = 300;
    if (draw) {
      ctx.fillStyle = '#F7F5EF'; ctx.fillRect(0, 0, W, cv.height);
      ctx.fillStyle = '#1E3F3B'; ctx.fillRect(0, 0, W, header);
      ctx.fillStyle = '#2A6B60'; ctx.beginPath(); ctx.arc(PAD + 70, 150, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 64px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText([...p.nickname][0] || '?', PAD + 70, 154); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = `700 60px ${FONT}`; ctx.fillText(p.nickname.slice(0, 16), PAD + 170, 140);
      ctx.font = `400 30px ${FONT}`; ctx.fillStyle = '#A9C2BD';
      ctx.fillText(p.role === 'artist' ? '繪師資料卡' : '委託者資料卡', PAD + 172, 196);
      if (p.openStatus) {
        ctx.font = `700 28px ${FONT}`; const tw = ctx.measureText(p.openStatus).width + 44;
        const x = W - PAD - tw; ctx.fillStyle = p.openStatus === '開放接單' ? '#3FA37A' : '#C9822B';
        ctx.beginPath(); ctx.roundRect(x, 64, tw, 52, 26); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(p.openStatus, x + 22, 100);
      }
    }
    y = header + 56;
    if (p.intro) {
      ctx.font = `400 36px ${FONT}`; const ls = wrap(ctx, p.intro, W - PAD * 2).slice(0, 5);
      ls.forEach((l, i) => { if (draw) { ctx.fillStyle = '#26302E'; ctx.fillText(l, PAD, y + 36 + i * 54); } });
      y += ls.length * 54 + 30;
    }
    for (const s of sections) {
      y += 24;
      if (draw) { ctx.fillStyle = '#2A6B60'; ctx.font = `700 30px ${FONT}`; ctx.fillText(s.h, PAD, y + 30); ctx.fillStyle = '#E2DED3'; ctx.fillRect(PAD, y + 50, W - PAD * 2, 2); }
      y += 76;
      if (s.chips) {
        ctx.font = `400 30px ${FONT}`; let x = PAD;
        for (const c of s.chips) {
          const w = ctx.measureText(c).width + 40;
          if (x + w > W - PAD) { x = PAD; y += 64; }
          if (draw) { ctx.fillStyle = '#E6EFEC'; ctx.beginPath(); ctx.roundRect(x, y, w, 50, 25); ctx.fill(); ctx.fillStyle = '#1E3F3B'; ctx.fillText(c, x + 20, y + 36); }
          x += w + 14;
        }
        y += 64;
      }
      if (s.rows) {
        for (const [k, v] of s.rows) {
          ctx.font = `700 30px ${FONT}`;
          if (draw) { ctx.fillStyle = '#6B746F'; ctx.fillText(k, PAD, y + 34); }
          ctx.font = `400 32px ${FONT}`;
          const ls = wrap(ctx, v, W - PAD * 2 - 200).slice(0, 2);
          ls.forEach((l, i) => { if (draw) { ctx.fillStyle = '#26302E'; ctx.fillText(l, PAD + 200, y + 34 + i * 44); } });
          y += Math.max(1, ls.length) * 44 + 14;
        }
      }
      if (s.text) {
        ctx.font = `400 30px ${FONT}`; let ls = wrap(ctx, s.text, W - PAD * 2);
        if (ls.length > s.maxLines) { ls = ls.slice(0, s.maxLines); ls[ls.length - 1] += '…'; }
        ls.forEach((l, i) => { if (draw) { ctx.fillStyle = '#26302E'; ctx.fillText(l, PAD, y + 34 + i * 46); } });
        y += ls.length * 46 + 14;
      }
    }
    y += 40;
    if (draw) {
      ctx.fillStyle = '#E2DED3'; ctx.fillRect(0, y, W, 2);
      ctx.fillStyle = '#8A918D'; ctx.font = `400 24px ${FONT}`;
      ctx.fillText('繪師委託帳本・用 App 的「貼上名片代碼」可直接加入名冊', PAD, y + 52);
    }
    return y + 90;
  };
  cv.width = W; cv.height = 10;
  const h = layout(ctx0, false);
  cv.height = h;
  layout(cv.getContext('2d'), true);
}

function formMyCard() {
  const p = myProfile(), artist = !CLIENT();
  const socials = p.socials.length ? p.socials : [{ platform: 'X', url: '' }];
  const contacts = p.contacts.length ? p.contacts : [{ type: 'Discord', value: '' }];
  const sRow = (s) => `<div class="subrow"><select name="sp">${optList(PLATFORMS, s.platform)}</select><input type="text" name="su" value="${esc(s.url)}" placeholder="https:// 網址"><button type="button" class="btn sm ghost" data-rmrow aria-label="移除">×</button></div>`;
  const cRow = (x) => `<div class="subrow"><select name="ct">${optList(CONTACTS, x.type)}</select><input type="text" name="cv" value="${esc(x.value)}" placeholder="帳號、ID 或信箱"><button type="button" class="btn sm ghost" data-rmrow aria-label="移除">×</button></div>`;
  openModal(`<h2>編輯我的資料卡</h2>
  <form class="fgrid mt">
    <label class="f">顯示名稱<input type="text" name="nickname" value="${esc(p.nickname)}" maxlength="60" required></label>
    ${artist ? `<label class="f">接單狀態<select name="openStatus"><option value="">（不顯示）</option>${optList(['開放接單', '暫停接單', '只接熟客'], p.openStatus)}</select></label>` : '<span></span>'}
    <label class="f full">一句話介紹<textarea name="intro" maxlength="200" placeholder="${artist ? '例：擅長日系厚塗、VTuber 立繪，接急件' : '例：VTuber，喜歡可愛風格，常委託頭像和表符'}">${esc(p.intro)}</textarea></label>
    ${artist ? `<label class="f full">接的委託（用逗號分隔）<input type="text" name="types" value="${esc(p.types.join(', '))}"></label>
    <label class="f">排單頁網址<input type="text" inputmode="url" name="queueUrl" value="${esc(p.queueUrl)}" placeholder="https://"></label>
    <label class="f">價目表網址<input type="text" inputmode="url" name="priceUrl" value="${esc(p.priceUrl)}" placeholder="https://"></label>
    <label class="f full">收款方式（只寫名稱，用逗號分隔）<input type="text" name="payMethods" value="${esc(p.payMethods.join(', '))}" placeholder="例：郵局轉帳, LINE Pay, VGen"></label>
    <label class="f full">委託須知<textarea name="terms" maxlength="1500" placeholder="例：訂金 50%，草稿後不退款；修改 3 次內免費">${esc(p.terms)}</textarea></label>` : ''}
    <div class="f full"><span>聯繫方式</span><div data-rows="c">${contacts.map(cRow).join('')}</div><button type="button" class="btn sm" data-addrow="c" style="width:max-content">＋ 新增聯繫方式</button></div>
    <div class="f full"><span>社群連結</span><div data-rows="s">${socials.map(sRow).join('')}</div><button type="button" class="btn sm" data-addrow="s" style="width:max-content">＋ 新增社群</button></div>
    <label class="f full">回覆時段<input type="text" name="replyTime" value="${esc(p.replyTime)}" placeholder="例：平日晚上 8 點後"></label>
    <div class="foot full"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">儲存</button></div>
  </form>`, {
    onOpen: (root) => root.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rmrow]'); if (rm) { rm.parentElement.remove(); return; }
      const add = e.target.closest('[data-addrow]');
      if (add) root.querySelector(`[data-rows="${add.dataset.addrow}"]`).insertAdjacentHTML('beforeend', tr(add.dataset.addrow === 's' ? sRow({ platform: 'X', url: '' }) : cRow({ type: 'Discord', value: '' })));
    }),
    onSubmit: async (fd) => {
      const list = (k) => String(fd.get(k) || '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
      const su = fd.getAll('su'), cv = fd.getAll('cv');
      const fixUrl = (u) => { u = String(u || '').trim(); return !u || /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, ''); };
      const raw = {
        nickname: fd.get('nickname'), intro: fd.get('intro'), replyTime: fd.get('replyTime'),
        socials: fd.getAll('sp').map((pl, i) => ({ platform: pl, url: fixUrl(su[i]) })),
        contacts: fd.getAll('ct').map((t, i) => ({ type: t, value: cv[i] })),
        openStatus: fd.get('openStatus') || '', types: list('types'), queueUrl: fixUrl(fd.get('queueUrl')), priceUrl: fixUrl(fd.get('priceUrl')),
        payMethods: list('payMethods'), terms: fd.get('terms') || ''
      };
      const clean = Card.clean(raw, CLIENT() ? 'client' : 'artist');
      if (!clean.nickname) { toast('請填顯示名稱'); return false; }
      if (/\d{10,}/.test([clean.terms || "", ...(clean.payMethods || []), ...clean.contacts.map((c) => c.value)].join(' ').replace(/[\s-]/g, ''))) {
        if (!confirm('資料卡裡好像有一長串數字（帳號或電話？）。資料卡會給別人看，確定要放嗎？')) return false;
      }
      delete clean.role;
      S.db.settings.profile = clean;
      S.modal = null;
      await commit('已儲存資料卡');
    }
  });
}

// 貼上名片代碼 → 加進名冊
async function importCard(text) {
  const r = Card.decode(text);
  if (r.error) { toast(r.error, 4000); return false; }
  const p = r.profile, { fields, note } = Card.toClientFields(p);
  const same = S.db.clients.find((cl) => (cl.nickname || cl.name) === p.nickname);
  const apply = async (target, isNew) => {
    if (isNew) { target = Object.assign({ id: uid(), name: '', tags: [], refs: [], refItems: [], logs: [], notes: '', createdAt: M.today(), queueUrl: '', priceUrl: '', terms: '', payMethods: [], openStatus: '' }, fields); S.db.clients.push(target); }
    else {
      // 更新：對方給的欄位蓋過去，自己的標籤、備註、紀錄保留
      for (const [k, v] of Object.entries(fields)) { if (k === 'name') continue; if (Array.isArray(v) ? v.length : v) target[k] = v; }
    }
    if (note) target.logs.push({ id: uid(), date: M.today(), channel: '名片代碼', text: note });
    S.modal = null;
    await commit(isNew ? `已加入「${p.nickname}」` : `已更新「${p.nickname}」的資料卡`);
    go(`#/client/${target.id}`);
  };
  if (!same) { await apply(null, true); return true; }
  openModal(`<h2>名冊裡已經有「${esc(p.nickname)}」</h2>
    <p>要用名片代碼更新這張資料卡，還是另外新增一張？更新時，你自己加的標籤、備註和聯繫紀錄都會保留。</p>
    <div class="foot"><button class="btn" data-act="close">取消</button><button class="btn" data-cardnew>另外新增</button><button class="btn pri" data-cardupd>更新資料卡</button></div>`, {
    onOpen: (root) => {
      root.querySelector('[data-cardnew]').addEventListener('click', () => apply(null, true));
      root.querySelector('[data-cardupd]').addEventListener('click', () => apply(same, false));
    }
  });
  return true;
}
function formCardImport() {
  openModal(`<h2>貼上名片代碼</h2>
  <form class="col mt" style="gap:10px">
    <p class="hint" style="margin:0">對方在「我的資料卡」按「複製名片代碼」後傳給你，整段貼上就好（多貼到其他文字也沒關係）。</p>
    <textarea name="code" rows="4" placeholder="ALCARD1-……" aria-label="名片代碼" required></textarea>
    <div class="foot"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">加入名冊</button></div>
  </form>`, { onSubmit: async (fd) => { const ok = await importCard(fd.get('code')); return ok ? undefined : false; } });
}

// ───────── 共享個案頁與雙方同步 ─────────
function newCaseKey() {
  const b = new Uint8Array(18); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const scriptUrl = () => ((S.cloud && S.cloud.effective && S.cloud.effective.url) || S.db.settings.sync.url || '');
function casePanel(c) {
  const sh = c.share, fo = c.follow, other = CLIENT() ? '繪師' : '委託人';
  const thread = (c.thread || []);
  const convo = `<div class="thread mt" aria-label="對話">${thread.length ? thread.slice(-50).map((m) => `<div class="tmsg ${m.from === 'me' ? 'me' : ''}">
      <div class="tn">${esc(m.from === 'me' ? '我' : (m.name || other))}・${esc(String(m.at || '').slice(5, 16).replace('T', ' '))}${m.from === 'me' && !m.sent ? '・<span style="color:var(--warn,#B4501A)">等待同步送出</span>' : ''}</div>
      <div class="tb">${PV() ? '（隱私模式）' : esc(m.text)}</div></div>`).join('') : '<div class="sub">還沒有訊息</div>'}</div>
    <form class="col mt" data-form="caseMsg" data-id="${c.id}" style="gap:6px"><textarea name="text" rows="2" maxlength="1000" placeholder="傳訊息給${other}（下次同步時送出）" aria-label="傳訊息"></textarea>
      <div class="row" style="justify-content:flex-end"><button class="btn sm" type="button" data-act="runCloud">立即同步</button><button class="btn sm pri" type="submit">送出</button></div></form>`;
  if (fo) {
    const d = c.followData;
    return `<section class="panel col"><div class="between"><h2>共享個案（雙方同步）</h2><button class="btn sm ghost" data-act="caseUnfollow" data-id="${c.id}">停止追蹤</button></div>
      ${fo.error ? `<div class="badc">${esc(fo.error)}</div>` : ''}
      ${d ? `<div class="sub">${esc(d.owner || other)} 分享的進度${d.updated ? `｜更新於 ${esc(d.updated.slice(5, 16).replace('T', ' '))}` : ''}</div>
        <div><b>${d.closed ? '已結案' : esc(d.stages[d.stage] || '')}</b>${d.deadline ? `｜交稿日 ${esc(d.deadline)}` : ''}</div>
        ${d.pay ? `<div class="sub">金額 ${esc(d.pay.currency)} ${amt(d.pay.price)}｜已付 ${esc(d.pay.currency)} ${amt(d.pay.paid)}</div>` : ''}
        ${d.milestones.length ? `<div class="sub">${d.milestones.map((m) => `${m.done ? '✓' : '○'} ${esc(m.name)} ${esc(m.date)}`).join('<br>')}</div>` : ''}
        ${d.note ? `<div style="white-space:pre-wrap;font-size:14px" class="refitem">${PV() ? '（隱私模式）' : esc(d.note)}</div>` : ''}` : '<div class="sub">同步後就會顯示對方的進度</div>'}
      <p class="hint" style="margin:0">對方更新進度、交稿日時，這一單會自動跟著改。</p>
      ${convo}</section>`;
  }
  if (!sh || !sh.on) {
    return `<section class="panel col"><h2>共享個案頁</h2>
      <p class="hint" style="margin:0">產生一個網址給${other}：可以看進度、交稿日和你寫的備註，也能直接留言，留言會自動進到聯繫紀錄。對方如果也用繪師委託帳本，貼上網址就能雙方同步。</p>
      ${scriptUrl() ? `<button class="btn" data-act="caseShare" data-id="${c.id}">開啟共享</button>` : `<div class="sub">要先在「<a href="#/sync">Google 表格同步</a>」設定好你的 Apps Script。</div>`}
      ${thread.length ? convo : ''}</section>`;
  }
  const link = Cloud.caseLink(scriptUrl(), sh.key);
  return `<section class="panel col"><div class="between"><h2>共享個案頁</h2><button class="btn sm ghost" data-act="caseStop" data-id="${c.id}">停止共享</button></div>
    ${S.db.meta.caseError ? `<div class="badc">${esc(S.db.meta.caseError)}</div>` : ''}
    <div class="row" style="flex-wrap:nowrap"><input type="text" readonly value="${esc(link)}" aria-label="共享網址" style="flex:1;font-size:12px"><button class="btn sm" data-act="caseCopy" data-id="${c.id}">複製</button></div>
    <label class="f">給對方看的備註<textarea data-chg="caseNote" data-id="${c.id}" rows="3" placeholder="例：草稿預計週五給你看；顏色有想改的可以直接留言">${esc(sh.note || '')}</textarea></label>
    <label class="chk"><input type="checkbox" data-chg="casePay" data-id="${c.id}" ${sh.showPay ? 'checked' : ''}> 顯示金額與已付款</label>
    <p class="hint" style="margin:0">對方只看得到進度、交稿日、階段日期、這裡的備註和對話。內容在同步時更新。</p>
    ${convo}</section>`;
}
function formFollowCase() {
  openModal(`<h2>加入對方分享的個案</h2>
  <form class="col mt" style="gap:10px">
    <p class="hint" style="margin:0">對方在繪師委託帳本開啟「共享個案頁」後會給你一個網址。貼上後，這一單的進度、交稿日和對話會自動同步。</p>
    <textarea name="link" rows="3" placeholder="https://script.google.com/macros/s/……/exec?c=……" aria-label="共享網址" required></textarea>
    <div class="foot"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri" type="submit">加入</button></div>
  </form>`, {
    onSubmit: async (fd) => {
      const lk = Cloud.parseCaseLink(fd.get('link'));
      if (!lk) { toast('網址不正確，請確認是對方給的共享個案網址（含 ?c=）', 4000); return false; }
      const dup = S.db.commissions.find((x) => x.follow && x.follow.key === lk.key);
      if (dup) { S.modal = null; go(`#/c/${dup.id}`); toast('這一單已經在追蹤了'); return; }
      const c = { id: uid(), code: await api.nextCode(), clientId: '', title: '共享個案（同步中…）', milestones: [], payments: [], revisions: [], refs: [], refItems: [], finals: [], sourceFiles: [], thread: [], closed: false, createdAt: M.today(), stageId: S.db.settings.stages[0].id, follow: { url: lk.url, key: lk.key } };
      S.db.commissions.push(c); touch(c);
      S.modal = null;
      await commit('已加入，正在同步…');
      go(`#/c/${c.id}`);
      await A.runCloud();
      // 第一次同步後補上標題與委託人（找不到就建立一張資料卡）
      S.db = await api.getDb();
      const c2 = comm(c.id);
      if (c2 && c2.followData) {
        const d = c2.followData;
        if (c2.title.startsWith('共享個案')) c2.title = d.title || c2.title;
        if (!c2.clientId && d.owner) {
          let cl = S.db.clients.find((x) => (x.nickname || x.name) === d.owner);
          if (!cl) { cl = { id: uid(), name: '', nickname: d.owner, tags: [], socials: [], contacts: [], replyTime: '', notes: '', refs: [], refItems: [], logs: [], createdAt: M.today(), queueUrl: '', priceUrl: '', terms: '', payMethods: [], openStatus: '' }; S.db.clients.push(cl); }
          c2.clientId = cl.id;
        }
        touch(c2); await commit();
      } else render();
    }
  });
}

// ───────── 泡泡標籤編輯（委託類型、款項來源）─────────
const CHIP_LISTS = {
  commissionTypes: { rename: (from, to) => S.db.commissions.forEach((c) => { if (c.type === from) { c.type = to; touch(c); } }) },
  paySources: { rename: (from, to) => S.db.commissions.forEach((c) => { let hit = false; c.payments.forEach((p) => { if (p.source === from) { p.source = to; hit = true; } }); if (hit) touch(c); }) }
};
function chipEditor(key, list, addLabel) {
  return `<div class="chipedit" data-chipkey="${key}">${list.map((t, i) => `<span class="tchip tagx ce"><button type="button" data-act="ceEdit" data-key="${key}" data-i="${i}" title="點一下改名">${esc(t)}</button><button type="button" class="tdel" data-act="ceDel" data-key="${key}" data-i="${i}" aria-label="刪除">×</button></span>`).join('')}
    <button type="button" class="tchip ce-add" data-act="ceAdd" data-key="${key}" aria-label="${addLabel}" title="${addLabel}">＋</button></div>`;
}
// 把泡泡換成輸入框；Enter 或點別處就儲存，Esc 取消
function chipInput(anchor, key, i) {
  const list = S.db.settings[key];
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'ce-input'; inp.value = i >= 0 ? list[i] : '';
  inp.setAttribute('aria-label', i >= 0 ? '修改名稱' : '新增名稱');
  anchor.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (!save) { render(); return; }
    if (i >= 0) {
      const old = list[i];
      if (!v) { list.splice(i, 1); await commit(`已刪除「${old}」`); return; }
      if (v === old) { render(); return; }
      if (list.includes(v)) { toast(`「${v}」已經有了`); render(); return; }
      list[i] = v; CHIP_LISTS[key].rename(old, v);
      await commit(`已改成「${v}」`); return;
    }
    if (!v) { render(); return; }
    if (list.includes(v)) { toast(`「${v}」已經有了`); render(); return; }
    list.push(v); await commit(`已新增「${v}」`);
    // 連續新增：再開一個輸入框
    const add = $(`[data-chipkey="${key}"] .ce-add`); if (add && save === 'enter') chipInput(add, key, -1);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish('enter'); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}

const A = {
  close: () => closeModal(),
  book: (el) => switchBook(el.dataset.book),
  runCloud: async () => {
    S.cloudRunning = true; render();
    const r = await api.runCloud();
    S.cloudRunning = false; S.db = await api.getDb(); render();
    const rs = Object.values(r || {}).filter((x) => x && !(x.ok === false && /還沒有設定同步/.test(x.error || '')));
    const bad = rs.find((x) => !x.ok), inc = rs.reduce((a, x) => a + (x.incoming || 0), 0);
    toast(bad ? `同步失敗：${bad.error}` : !rs.length ? '還沒有設定同步' : `${rs.every((x) => x.casesOnly) ? '共享個案已更新' : '電腦與手機已同步'}${inc ? `，收到 ${inc} 則新訊息` : ''}`, 5000);
  },
  copyCode: async () => { await api.copyText((S.cloud || {}).code || ''); toast('已複製連線代碼，到另一台裝置的「Google 表格同步 › 電腦與手機同步」貼上'); },
  openWidget: () => api.openWidget(),
  newCommission: () => formCommission(),
  newCommissionFor: (el) => formCommission(null, el.dataset.id),
  editC: (el) => formCommission(comm(el.dataset.id)),
  openC: (el) => go(`#/c/${el.dataset.id}`),
  openClient: (el) => go(`#/client/${el.dataset.id}`),
  zoom: (el) => { try { localStorage.setItem('al-zoom', el.dataset.v); } catch (e) { /* 忽略 */ } applyZoom(); render(); },
  cardEdit: () => formMyCard(),
  caseShare: async (el) => { const c = comm(el.dataset.id); c.share = Object.assign({ key: newCaseKey(), note: '', showPay: false }, c.share || {}, { on: true }); touch(c); await commit('已開啟共享，同步後網址就能用'); A.runCloud(); },
  caseStop: async (el) => { const c = comm(el.dataset.id); if (!confirm('停止共享後，原本的網址就打不開了。確定嗎？')) return; c.share.on = false; touch(c); await commit('已停止共享'); A.runCloud(); },
  caseCopy: async (el) => { const c = comm(el.dataset.id); await api.copyText(Cloud.caseLink(scriptUrl(), c.share.key)); toast('已複製共享網址'); },
  caseUnfollow: async (el) => { const c = comm(el.dataset.id); if (!confirm('停止追蹤後，這一單會留在帳本裡，但不會再跟對方同步。確定嗎？')) return; delete c.follow; touch(c); await commit('已停止追蹤'); },
  followCase: () => formFollowCase(),
  cardPaste: () => formCardImport(),
  cardCopy: async () => {
    const p = myProfile();
    await api.copyText(`${p.nickname} 的${ROLE_NAME()}資料卡（繪師委託帳本名片代碼，貼到 App 就能加入名冊）\n${Card.encode(p, CLIENT() ? 'client' : 'artist')}`);
    toast('已複製名片代碼，貼給對方就好');
  },
  cardImage: async () => {
    const cv = document.createElement('canvas');
    drawCard(cv, Card.clean(myProfile(), CLIENT() ? 'client' : 'artist'));
    const r = await api.saveImage(`${myProfile().nickname || '我'}-資料卡.png`, cv.toDataURL('image/png'));
    if (r && r.ok) toast(r.shared ? '已開啟分享' : '已存好資料卡圖片');
  },
  delRefItem: async (el) => {
    const o = refOwner(el.dataset.kind, el.dataset.owner); if (!o) return;
    o.refItems = (o.refItems || []).filter((r) => r.id !== el.dataset.rid); if (el.dataset.kind === 'comm') touch(o);
    await commit('已刪除');
  },
  ceEdit: (el) => chipInput(el.closest('.ce'), el.dataset.key, Number(el.dataset.i)),
  ceAdd: (el) => chipInput(el, el.dataset.key, -1),
  ceDel: async (el) => { const list = S.db.settings[el.dataset.key]; const [old] = list.splice(Number(el.dataset.i), 1); await commit(`已刪除「${old}」`); },
  gcols: (el) => { try { localStorage.setItem('al-gcols', el.dataset.v); } catch (e) { /* 忽略 */ } render(); },
  theme: (el) => { try { localStorage.setItem('al-theme', el.dataset.v); } catch (e) { /* 忽略 */ } applyTheme(); render(); },
  ctag: (el) => { S.view.ctag = S.view.ctag === el.dataset.tag ? '' : el.dataset.tag; render(); },
  ctagGo: (el) => { S.view.ctag = el.dataset.tag; S.view.q = ''; go('#/clients'); },
  tagDel: async (el) => { const cl = client(el.dataset.id); if (!cl) return; cl.tags = cl.tags.filter((t) => t !== el.dataset.tag); await commit('已移除標籤'); },
  newClient: () => formClient(),
  editClient: (el) => formClient(client(el.dataset.id)),
  mode: (el) => { S.view.mode = el.dataset.v; render(); },
  calMonth: (el) => { S.view.calMonth = el.dataset.v || null; render(); },
  exportXlsx: async () => { const r = await api.exportXlsx(); if (r.ok) toast('已匯出 Excel'); },
  exportCsv: async () => { const r = await api.exportCsv(); if (r.ok) toast('已匯出 CSV'); },
  ext: (el) => api.openExternal(el.dataset.url),
  quickPay: () => pickCommission('記一筆收款', (c) => formPayment(c)),

  setStage: (el) => changeStage(el.dataset.id, el.dataset.stage),
  nextStage: async (el) => {
    const c = comm(el.dataset.id); const st = S.db.settings.stages; const i = M.stageIndex(S.db, c);
    if (st[i + 1]) await changeStage(c.id, st[i + 1].id);
  },
  autoMs: async (el) => {
    const c = comm(el.dataset.id);
    const add = M.autoMilestones(S.db, c);
    if (!add.length) { toast(c.deadline ? '各階段的日期都已經有了' : '請先設定死線'); return; }
    c.milestones.push(...add.map((m) => ({ id: uid(), name: m.name, date: m.date, done: false })));
    touch(c); await commit(`已依死線排好 ${add.length} 個階段日期，可以再自己調整`);
  },
  saveTpl: async (el) => {
    const c = comm(el.dataset.id);
    const days = c.deadline && c.startDate ? Math.max(0, Math.round((M.parseDate(c.deadline) - M.parseDate(c.startDate)) / 86400000)) : 0;
    S.db.settings.priceTemplates.push({ id: 'tpl_' + uid().slice(0, 8), name: c.type || c.title || '新方案', type: c.type || '', price: Number(c.price) || 0, freeRevisions: c.freeRevisions, days, spec: c.spec || '', license: c.license || '', publicMode: c.publicMode || 'nick' });
    await commit('已存成價目表方案，可以到「設定與備份 › 價目表」調整');
  },
  addTpl: async () => {
    S.db.settings.priceTemplates.push({ id: 'tpl_' + uid().slice(0, 8), name: '新方案', type: '', price: 0, freeRevisions: S.db.settings.freeRevisions, days: 14, spec: '', license: '個人使用', publicMode: 'nick' });
    await commit('已新增方案');
  },
  rmTpl: async (el) => {
    const t = S.db.settings.priceTemplates.find((x) => x.id === el.dataset.id);
    if (!(await confirmBox(`刪除方案「${t.name}」？`, '已經建立的委託不會受影響。', '刪除'))) return;
    S.db.settings.priceTemplates = S.db.settings.priceTemplates.filter((x) => x.id !== t.id);
    await commit('已刪除方案');
  },
  checkUpdate: async () => {
    toast('檢查中…');
    const r = await api.checkUpdate();
    S.db = await api.getDb(); render();
    toast(!r.ok ? `檢查失敗：${r.error}` : r.newer ? `有新版本 v${r.latest.version}` : '目前已是最新版本', 4000);
  },
  openUpdate: async () => { if (!(await api.openUpdatePage())) toast('版本資訊裡沒有下載頁網址'); },
  exportDiag: async () => { const r = await api.exportDiagnostics(); if (r.ok) toast('已匯出診斷資訊，可以把這個檔案寄給開發者', 5000); },
  runWizard: () => setupWizard(),
  togglePrivacy: async () => { const on = !PV(); await api.setPrivacy(on); S.db.settings.privacyMode = on; render(); toast(on ? '隱私模式已開啟：名字、金額、圖片會打碼' : '已關閉隱私模式'); },
  toggleClose: async (el) => {
    const c = comm(el.dataset.id);
    if (!c.closed) {
      const warn = [];
      if (M.unpaid(c) > 0) warn.push(`還有 ${money(M.unpaid(c))} 未收`);
      if (!c.sourceFiles.length && !CLIENT()) warn.push('還沒有放繪圖原檔備份');
      if (warn.length && !(await confirmBox('確定要結案嗎？', warn.join('；'), '仍要結案'))) return;
      closeCommission(c);
    } else { c.closed = false; c.closedAt = ''; }
    touch(c); await commit(c.closed ? '已結案' : '已重新開啟');
  },
  delC: async (el) => {
    const c = comm(el.dataset.id);
    if (!(await confirmBox(`刪除委託「${c.title}」？`, '委託紀錄會刪除；附件檔案會移到資料夾裡的 _removed，不會立刻消失。', '刪除'))) return;
    for (const f of [...c.refs, ...c.finals, ...c.sourceFiles, ...c.revisions.map((r) => r.image)].filter(Boolean)) await api.trashFile(f.file);
    S.db.commissions = S.db.commissions.filter((x) => x.id !== c.id);
    await commit('已刪除'); go('#/overview');
  },
  delClient: async (el) => {
    const cl = client(el.dataset.id);
    const n = S.db.commissions.filter((c) => c.clientId === cl.id).length;
    if (n) { toast(`這位委託人還有 ${n} 筆委託，請先刪除或改到其他委託人`); return; }
    if (!(await confirmBox(`刪除委託人「${nickOf(cl)}」？`, '設定圖會移到資料夾裡的 _removed。', '刪除'))) return;
    for (const f of cl.refs) await api.trashFile(f.file);
    S.db.clients = S.db.clients.filter((x) => x.id !== cl.id);
    await commit('已刪除'); go('#/clients');
  },

  pick: (el) => pickInto(el.dataset.slot, el.dataset.owner),
  view: (el) => {
    const list = SLOTS[el.dataset.slot].list(el.dataset.owner);
    const items = list.map((f) => ({ f, title: f.name, note: f.caption ? `註解：${f.caption}` : '' }));
    viewer(items, Math.max(0, list.findIndex((f) => f.id === el.dataset.fid)));
  },
  viewRev: (el) => {
    const c = comm(el.dataset.owner);
    const revs = c.revisions.filter((r) => r.image).slice().reverse();
    const items = revs.map((r) => ({ f: r.image, title: `${r.ver}｜${r.title}｜${r.date}`, note: r.feedback ? `註解／回饋：${r.feedback}` : '' }));
    const idx = revs.findIndex((r) => r.id === el.dataset.rid);
    if (items.length) viewer(items, Math.max(0, idx));
  },
  viewProof: (el) => { const p = comm(el.dataset.owner).payments.find((x) => x.id === el.dataset.pid); if (p && p.proof) viewer([{ f: p.proof, title: `${p.label} 匯款截圖` }], 0); },
  rmFile: async (el) => {
    const { slot, owner, fid } = el.dataset;
    if (!(await confirmBox('移除這個檔案？', '檔案會移到資料夾裡的 _removed，不會立刻消失。', '移除'))) return;
    const holder = slot === 'clientRefs' ? client(owner) : comm(owner);
    const key = { refs: 'refs', clientRefs: 'refs', finals: 'finals', source: 'sourceFiles' }[slot];
    const f = holder[key].find((x) => x.id === fid);
    holder[key] = holder[key].filter((x) => x.id !== fid);
    if (f) await api.trashFile(f.file);
    if (slot !== 'clientRefs') touch(holder);
    await commit('已移除');
  },
  openFile: async (el) => {
    const r = await api.openFile(el.dataset.rel);
    if (r && r.blocked) toast('這個檔案可能是程式，為了安全不直接開啟，已經在資料夾中顯示', 5000);
    else if (r && r.error) toast('開啟失敗：' + r.error, 5000);
  },
  showFile: (el) => api.showFile(el.dataset.rel),
  delRev: async (el) => {
    const c = comm(el.dataset.owner); const r = c.revisions.find((x) => x.id === el.dataset.rid);
    if (!(await confirmBox(`刪除版本 ${r.ver}？`, '圖檔會移到 _removed。', '刪除'))) return;
    c.revisions = c.revisions.filter((x) => x.id !== r.id);
    if (r.image) await api.trashFile(r.image.file);
    S.view.cmp = S.view.cmp.filter((x) => x !== r.id);
    touch(c); await commit('已刪除版本');
  },
  compare: (el) => {
    const c = comm(el.dataset.id);
    const [a, b] = S.view.cmp.map((id) => c.revisions.find((r) => r.id === id)).filter(Boolean).sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    if (!a || !b) return;
    const side = (r) => `<div><div style="margin-bottom:6px"><span class="ver">${esc(r.ver)}</span> ${esc(r.title)}｜${esc(r.date)}</div>
      ${r.image && isImg(r.image) ? `<img src="${imgUrl(r.image.file)}" alt="">` : '<div class="empty">沒有圖</div>'}<p style="white-space:pre-wrap;color:#ddd">${esc(r.feedback)}</p></div>`;
    openModal(`<div class="between"><b>並排比較</b><button class="btn sm" data-act="close">關閉</button></div><div class="cmp mt">${side(a)}${side(b)}</div>`, { cls: 'viewer wide' });
  },
  delMs: async (el) => { const c = comm(el.dataset.owner); c.milestones = c.milestones.filter((m) => m.id !== el.dataset.mid); touch(c); await commit(); },
  payAdd: (el) => formPayment(comm(el.dataset.id)),
  payEdit: (el) => { const c = comm(el.dataset.owner); formPayment(c, c.payments.find((p) => p.id === el.dataset.pid)); },
  payToggle: async (el) => {
    const c = comm(el.dataset.owner); const p = c.payments.find((x) => x.id === el.dataset.pid);
    p.status = p.status === 'paid' ? 'pending' : 'paid';
    if (p.status === 'paid') p.date = M.today();
    touch(c); await commit(p.status === 'paid' ? '已標記為已收' : '已標記為未收');
    if (p.status === 'paid') await afterPayment(c.id, true);
  },
  delLog: async (el) => { const cl = client(el.dataset.owner); cl.logs = cl.logs.filter((l) => l.id !== el.dataset.lid); await commit(); },

  addBackup: async () => { const r = await api.addBackupFolder(); if (r && r.error) toast(r.error); else if (r) { S.db = await api.getDb(); render(); toast('已新增備份位置，開始備份…'); A.runBackup(); } },
  rmBackup: async (el) => { S.db.settings.backupFolders = S.db.settings.backupFolders.filter((f) => f !== el.dataset.v); await commit('已移除備份位置（已備份的檔案不會被刪）'); },
  runBackup: async () => {
    S.backupRunning = true; render();
    const r = await api.runBackup();
    S.backupRunning = false; S.db = await api.getDb(); render();
    toast(r.ok ? '備份完成' : `備份有問題：${r.error || r.results.filter((x) => !x.ok).map((x) => x.error).join('；')}`, 4000);
  },
  restore: async () => { const r = await api.restore(); if (r.ok) { S.db = await api.getDb(); render(); toast('已還原，原本的資料保留在：' + r.previous, 6000); } else if (r.error) toast(r.error, 5000); },
  checkMissing: async () => { const m = await api.missingFiles(); toast(m.length ? `有 ${m.length} 個附件找不到檔案，可以從備份還原` : '✓ 所有附件都在', 4000); },
  openDataDir: () => api.openDataDir(),
  createShortcuts: async () => { const r = await api.createShortcuts(); toast(r.ok ? '已建立捷徑，之後就能收到死線通知' : '建立失敗：' + r.error, 4000); },
  changeDataDir: async () => { const r = await api.changeDataDir(); if (r.ok) { S.info = await api.info(); S.db = await api.getDb(); render(); toast('資料已搬到：' + r.dataDir, 5000); } },

  addStage: async () => {
    const st = S.db.settings.stages;
    const s = { id: 'st_' + uid().slice(0, 8), name: '新階段', done: false, group: 'work' };
    const lastDone = st.length && st[st.length - 1].done;
    if (lastDone) st.splice(st.length - 1, 0, s); else st.push(s);
    await commit('已新增階段，可以直接改名');
  },
  moveStage: async (el) => {
    const st = S.db.settings.stages; const i = st.findIndex((s) => s.id === el.dataset.id); const j = i + Number(el.dataset.v);
    if (j < 0 || j >= st.length) return;
    [st[i], st[j]] = [st[j], st[i]]; await commit();
  },
  delStage: async (el) => {
    const st = S.db.settings.stages; const s = st.find((x) => x.id === el.dataset.id);
    const n = S.db.commissions.filter((c) => c.stageId === s.id).length;
    if (n) {
      const i = st.indexOf(s); const to = st[i - 1] || st[i + 1];
      if (!(await confirmBox(`刪除階段「${s.name}」？`, `有 ${n} 筆委託在這個階段，會移到「${to.name}」。`, '刪除'))) return;
      S.db.commissions.forEach((c) => { if (c.stageId === s.id) c.stageId = to.id; });
    }
    S.db.settings.stages = st.filter((x) => x.id !== s.id);
    await commit('已刪除階段');
  },

  runSync: async () => {
    S.syncRunning = true; render();
    const r = await api.runSync();
    S.syncRunning = false; S.db = await api.getDb(); S.syncPreview = null; render();
    toast(r.ok ? '已同步到 Google 表格' : `同步失敗：${r.error}`, 5000);
  },
  newToken: async () => {
    if (S.db.settings.sync.token && !(await confirmBox('重新產生同步密碼？', '舊的腳本會失效，需要重新複製腳本貼到 Apps Script 並重新部署；手機也要重新貼上連線代碼。', '重新產生'))) return;
    await api.newToken(); S.db = await api.getDb(); S.cloud = await api.cloudGet(); render(); toast('已產生同步密碼');
  },
  openPublic: () => api.openPublicPage(),
  exportPublic: async () => { const r = await api.exportPublicPage(); if (r.ok) toast('已匯出排單網頁'); },
  copyPublicUrl: async () => { await api.copyText(S.db.settings.sync.url); toast('已複製公開網址'); },
  rmAccount: async (el) => {
    const used = S.db.commissions.some((c) => c.payments.some((p) => p.account === el.dataset.id));
    if (used && !(await confirmBox('刪除這個收款帳戶？', '已經有收款紀錄用到它，刪除後那些紀錄會顯示為「未指定帳戶」。', '刪除'))) return;
    S.db.settings.payAccounts = S.db.settings.payAccounts.filter((a) => a.id !== el.dataset.id);
    await commit('已刪除收款帳戶');
  },
  copyScript: async () => {
    if (!S.db.settings.sync.token) { await api.newToken(); S.db = await api.getDb(); render(); }
    const code = await api.syncScript();
    await api.copyText(code);
    toast('已複製同步腳本，到 Apps Script 貼上即可');
  }
};

// 欄位變更
const C = {
  caseNote: async (el) => { const c = comm(el.dataset.id); c.share.note = el.value.slice(0, 3000); touch(c); await commit('已儲存，同步後對方就會看到'); },
  casePay: async (el) => { const c = comm(el.dataset.id); c.share.showPay = el.checked; touch(c); await commit(); },
  tpl: async (el) => {
    const t = S.db.settings.priceTemplates.find((x) => x.id === el.dataset.id); if (!t) return;
    const f = el.dataset.f;
    t[f] = ['price', 'freeRevisions', 'days'].includes(f) ? Math.max(0, Number(el.value) || 0) : el.value.trim();
    await commit();
  },
  unpaidRemindDays: async (el) => { S.db.settings.unpaidRemindDays = Math.max(0, Number(el.value) || 0); await commit('已儲存'); },
  privacyMode: async (el) => { await api.setPrivacy(el.checked); S.db.settings.privacyMode = el.checked; render(); },
  autoUpdateCheck: async (el) => { S.db.settings.autoUpdateCheck = el.checked; await commit(); },
  updateUrl: async (el) => { S.db.settings.updateUrl = el.value.trim(); await commit('已儲存'); },
  caption: async (el) => {
    const { slot, owner, fid } = el.dataset;
    const holder = slot === 'clientRefs' ? client(owner) : comm(owner);
    const key = { refs: 'refs', clientRefs: 'refs', finals: 'finals', source: 'sourceFiles' }[slot];
    const f = holder && holder[key].find((x) => x.id === fid);
    if (!f) return;
    f.caption = el.value;
    if (slot !== 'clientRefs') touch(holder);
    await commit();
  },
  payAccount: (el) => { S.view.payAccount = el.value; render(); },
  paySource: (el) => { S.view.paySource = el.value; render(); },
  accLabel: async (el) => { const a = S.db.settings.payAccounts.find((x) => x.id === el.dataset.id); a.label = el.value.trim() || a.label; await commit(); },
  accDetail: async (el) => { const a = S.db.settings.payAccounts.find((x) => x.id === el.dataset.id); a.detail = el.value.trim(); await commit(); },
  paySources: async (el) => { S.db.settings.paySources = el.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean); await commit('已儲存'); },
  ppView: async (el) => { S.db.settings.publicPage.view = el.value; await commit(); },
  ppSort: async (el) => { S.db.settings.publicPage.sort = el.value; await commit(); },
  ppContact: async (el) => { S.db.settings.publicPage.contact = el.value.trim(); await commit(); },
  ppNote: async (el) => { S.db.settings.publicPage.note = el.value; await commit(); },
  ppShowDelivered: async (el) => { S.db.settings.publicPage.showDelivered = el.checked; await commit(); },
  ppDays: async (el) => { S.db.settings.publicPage.deliveredDays = Math.max(0, Number(el.value) || 0); await commit(); },
  showClosed: (el) => { S.view.showClosed = el.checked; render(); },
  type: (el) => { S.view.type = el.value; render(); },
  sort: (el) => { S.view.sort = el.value; render(); },
  payMonth: (el) => { S.view.payMonth = el.value; render(); },
  payStatus: (el) => { S.view.payStatus = el.value; render(); },
  galleryRev: (el) => { S.view.galleryRev = el.checked; render(); },
  cmpSel: (el) => {
    const id = el.dataset.rid;
    S.view.cmp = el.checked ? [...S.view.cmp.filter((x) => x !== id), id].slice(-2) : S.view.cmp.filter((x) => x !== id);
    render();
  },
  revField: async (el) => {
    const c = comm(el.dataset.owner); const r = c.revisions.find((x) => x.id === el.dataset.rid);
    r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    touch(c); await commit();
  },
  msDone: async (el) => { const c = comm(el.dataset.owner); const m = c.milestones.find((x) => x.id === el.dataset.mid); m.done = el.checked; touch(c); await commit(); },
  syncUrl: async (el) => { S.db.settings.sync.url = el.value.trim(); await commit('已儲存網址'); S.cloud = await api.cloudGet(); render(); },
  cloudAuto: async (el) => { S.cloud = await api.cloudSet({ auto: el.checked }); },
  syncAuto: async (el) => { S.db.settings.sync.auto = el.checked; await commit(); },
  syncSheet: async (el) => { S.db.settings.sync.sheets[el.dataset.k] = el.checked; await commit(); },
  artistName: async (el) => { S.db.settings.artistName = el.value.trim(); S.syncPreview = null; await commit(); },
  statusText: async (el) => { S.db.settings.sync.statusText = el.value.trim(); S.syncPreview = null; await commit(); },
  maskNames: async (el) => { S.db.settings.sync.maskNames = el.checked; S.syncPreview = null; await commit(); },
  autoBackup: async (el) => { S.db.settings.autoBackup = el.checked; await commit(); },
  stageName: async (el) => { const s = S.db.settings.stages.find((x) => x.id === el.dataset.id); s.name = el.value.trim() || s.name; await commit(); },
  stageGroup: async (el) => { const s = S.db.settings.stages.find((x) => x.id === el.dataset.id); s.group = el.value; s.done = el.value === 'done'; await commit(); },
  upcomingDays: async (el) => { S.db.settings.upcomingDays = Math.max(1, Number(el.value) || 15); await commit('已儲存'); },
  reminderDays: async (el) => { S.db.settings.reminderDays = el.value.split(/[,，\s]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0); await commit('已儲存'); },
  freeRevisions: async (el) => { S.db.settings.freeRevisions = Math.max(0, Number(el.value) || 0); await commit('已儲存'); },
  commissionTypes: async (el) => { S.db.settings.commissionTypes = el.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean); await commit('已儲存'); },
  currencySel: async (el) => {
    if (el.value === '__c') { S.view.customCur = true; render(); const i = $('[data-chg=currency]'); if (i) { i.value = ''; i.focus(); } return; }
    S.db.settings.currency = el.value; await commit('已儲存');
  },
  currency: async (el) => { S.db.settings.currency = el.value.trim() || 'NT$'; await commit('已儲存'); },
  widgetOnTop: async (el) => { await api.setOnTop(el.checked); S.db.settings.widgetOnTop = el.checked; },
  autostart: async (el) => { await api.setAutostart(el.checked); S.db.settings.autostart = el.checked; toast(el.checked ? '開機會自動開啟小工具' : '已取消開機啟動'); },
  closeToTray: async (el) => { S.db.settings.closeToTray = el.checked; await commit(); }
};

// ───────── 事件綁定 ─────────
document.addEventListener('click', (e) => {
  if (e.target.dataset && e.target.dataset.bg && S.modal) {
    // 有表單的視窗點外面不關閉，避免打到一半的內容不見；要關請按「取消」
    if (S.modal.hasForm) { const m = $('#modal-root .modal'); if (m) { m.classList.remove('nudge'); void m.offsetWidth; m.classList.add('nudge'); } return; }
    closeModal(); return;
  }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.modal) {
    if (S.modal.dirty && !(S.modal.escAt && Date.now() - S.modal.escAt < 2500)) { S.modal.escAt = Date.now(); toast('再按一次 Esc 會放棄這次輸入的內容'); return; }
    closeModal();
  }
  if (S.modal && S.modal.viewer && e.key === 'ArrowLeft') S.modal.viewer.prev();
  if (S.modal && S.modal.viewer && e.key === 'ArrowRight') S.modal.viewer.next();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.drop-zone')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tagpick]'); if (!b) return;
  const inp = b.closest('label').querySelector('input[name="tags"]');
  const cur = inp.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
  if (!cur.includes(b.dataset.tagpick)) inp.value = [...cur, b.dataset.tagpick].join(', ');
  b.classList.add('on');
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]');
  if (el && C[el.dataset.chg]) C[el.dataset.chg](el);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (!el) return;
  S.view[el.dataset.input] = el.value;
  clearTimeout(S._qt);
  S._qt = setTimeout(() => {
    const pos = el.selectionStart; render();
    const ni = $(`[data-input="${el.dataset.input}"]`); if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (er) { /* 忽略 */ } }
  }, 200);
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (f.dataset.form === 'addMs') {
    const name = String(fd.get('name') || '').trim(); if (!name) { toast('請填階段名稱'); return; }
    const c = comm(f.dataset.owner); c.milestones.push({ id: uid(), name, date: fd.get('date') || '', done: false }); touch(c); await commit();
  }
  if (f.dataset.form === 'addAccount') {
    const label = String(fd.get('label') || '').trim(); if (!label) { toast('請填帳戶名稱'); return; }
    S.db.settings.payAccounts.push({ id: 'acc_' + uid().slice(0, 8), label, detail: String(fd.get('detail') || '').trim() });
    await commit('已新增收款帳戶');
  }
  if (f.dataset.form === 'cloudCode') {
    const r = await api.cloudSet({ code: String(fd.get('code') || '') });
    if (r.error) { toast(r.error); return; }
    S.cloud = r; render(); toast('已連線，開始同步…'); A.runCloud();
  }
  if (f.dataset.form === 'tagAdd') {
    const cl = client(f.dataset.owner); if (!cl) return;
    const add = String(fd.get('tag') || '').split(/[,，、]/).map((x) => x.trim().replace(/^#/, '')).filter((x) => x && !cl.tags.includes(x));
    if (!add.length) return;
    cl.tags.push(...add); await commit('已加上標籤');
    const ni = document.querySelector('[data-form="tagAdd"] input'); if (ni) ni.focus();
  }
  if (f.dataset.form === 'caseMsg') {
    const c = comm(f.dataset.id); const text = String(fd.get('text') || '').trim(); if (!c || !text) return;
    (c.thread = c.thread || []).push({ id: 'm' + uid().replace(/-/g, '').slice(0, 20), from: 'me', name: '', text: text.slice(0, 1000), at: new Date().toISOString(), sent: false });
    touch(c); await commit(); A.runCloud(); return;
  }
  if (f.dataset.form === 'cardImport') { await importCard(fd.get('code')); return; }
  if (f.dataset.form === 'addRefItem') {
    const o = refOwner(f.dataset.kind, f.dataset.owner); if (!o) return;
    const v = String(fd.get('v') || '').trim(); if (!v) return;
    // 第一行是網址就存成連結，後面的字當說明；否則整段存成文字
    const [first, ...rest] = v.split('\n');
    const item = isUrl(first.trim()) ? { id: uid(), url: first.trim(), text: rest.join('\n').trim() } : { id: uid(), url: '', text: v };
    item.addedAt = new Date().toISOString();
    (o.refItems = o.refItems || []).push(item); if (f.dataset.kind === 'comm') touch(o);
    await commit(item.url ? '已加入網址' : '已加入文字');
  }
  if (f.dataset.form === 'addLog') {
    const text = String(fd.get('text') || '').trim(); if (!text) return;
    const cl = client(f.dataset.owner); cl.logs.push({ id: uid(), date: fd.get('date') || M.today(), channel: fd.get('channel') || '', text }); await commit();
  }
});

// 拖曳：卡片換欄、檔案拖進來
document.addEventListener('dragstart', (e) => {
  const card = e.target.closest('[data-card]');
  if (card) { e.dataTransfer.setData('text/x-cid', card.dataset.card); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); }
});
document.addEventListener('dragend', (e) => { const card = e.target.closest && e.target.closest('[data-card]'); if (card) card.classList.remove('dragging'); });
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.querySelectorAll('.over,.drop').forEach((x) => x.classList.remove('over', 'drop'));
  const dz = e.target.closest('.drop-zone'); if (dz && e.dataTransfer.types.includes('Files')) dz.classList.add('over');
  const col = e.target.closest('.colm'); if (col && e.dataTransfer.types.includes('text/x-cid')) col.classList.add('drop');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.querySelectorAll('.over,.drop').forEach((x) => x.classList.remove('over', 'drop')); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.querySelectorAll('.over,.drop').forEach((x) => x.classList.remove('over', 'drop'));
  const cid = e.dataTransfer.getData('text/x-cid');
  const col = e.target.closest('.colm');
  if (cid && col) {
    const c = comm(cid); const sid = col.dataset.stage;
    if (sid === '__closed') { closeCommission(c); await commit(`「${c.title}」→ 結案`); } else await changeStage(cid, sid);
    return;
  }
  const dz = e.target.closest('.drop-zone');
  if (dz && e.dataTransfer.files.length) {
    const paths = api.pathsOf(e.dataTransfer.files);
    const kind = SLOTS[dz.dataset.drop].kind;
    toast('複製檔案中…', 10000);
    try { const refs = await api.importFiles(paths, kind); await addFiles(dz.dataset.drop, dz.dataset.owner, refs); } catch (err) { toast('加入失敗：' + err.message, 5000); }
  }
});

window.addEventListener('hashchange', () => { S.view.cmp = []; S.view.q = ''; render(); $('#view').scrollTop = 0; });

// ───────── 啟動 ─────────
(async () => {
  S.info = await api.info();
  S.db = await api.getDb();
  S.cloud = api.cloudGet ? await api.cloudGet() : null;
  if (api.onCloudState) api.onCloudState((x) => { S.cloudRunning = x.running; if (!S.modal) { if (!x.running) render(); else sideStatus(); } });
  api.onDbChanged((db) => {
    if (JSON.stringify(db) === JSON.stringify(S.db)) return;
    if (S.modal) { S.pendingDb = db; return; }
    S.db = db; S.syncPreview = null; render();
  });
  api.onNav((r) => { location.hash = r.replace(/^#?/, '#'); });
  api.onSyncState((s) => { S.syncRunning = s.running; if (!S.modal) sideStatus(); });
  api.onBackupState((s) => { S.backupRunning = s.running; if (!S.modal) sideStatus(); });
  if (!location.hash) history.replaceState(null, '', '#/overview');
  render();
  if (!S.db.settings.setupDone) setupWizard();
})();
