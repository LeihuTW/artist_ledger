(function () {
'use strict';
// 公開排單網頁：從資料產生一個獨立的 HTML（清單＋看板兩種檢視），匯出檔案與 Google Apps Script 共用
const M = (typeof module !== 'undefined' && module.exports) ? require('./model') : window.Model;

const GROUP_NAME = { prep: '準備中', work: '製作中', done: '已交付' };

function buildData(db, now) {
  const n = now || new Date();
  const set = db.settings, pp = set.publicPage;
  const stages = set.stages;
  const doneDays = Number(pp.deliveredDays) || 30;
  const cutoff = M.fmtDate(new Date(n.getFullYear(), n.getMonth(), n.getDate() - doneDays));
  const items = [];
  for (const c of db.commissions) {
    if (c.publicMode === 'hidden') continue;
    const st = M.stageOf(db, c);
    const delivered = c.closed || st.done;
    if (c.closed && !(pp.showDelivered && (c.closedAt || '') >= cutoff)) continue;
    if (delivered && !pp.showDelivered) continue;
    const nick = M.clientName(db, c.clientId, true);
    const anon = c.publicMode === 'anon';
    const idx = c.closed ? stages.length - 1 : Math.max(0, stages.findIndex((s) => s.id === c.stageId));
    items.push({
      who: anon ? '保密委託' : (set.sync.maskNames ? maskName(nick) : nick),
      item: anon ? (c.type || '委託') : (c.title || c.type || '委託'),
      stage: delivered ? '已交付' : st.name,
      stageId: delivered ? '__done' : st.id,
      idx, group: delivered ? 'done' : st.group,
      due: delivered ? (c.closedAt || '') : (c.deadline || ''),
      start: c.startDate || '',
      note: c.publicNote || ''
    });
  }
  const sortKey = pp.sort === 'start' ? (x) => x.start || '9999' : (x) => x.due || '9999';
  items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const workStages = stages.filter((s) => s.group === 'work');
  return {
    artist: set.artistName || '繪師',
    status: set.sync.statusText || '',
    contact: pp.contact || '',
    note: pp.note || '',
    view: pp.view === 'board' ? 'board' : 'list',
    updated: `${M.fmtDate(n).replace(/-/g, '/')} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`,
    stageNames: stages.map((s) => s.name),
    columns: [{ id: 'prep', name: '準備中' }, ...workStages.map((s) => ({ id: s.id, name: s.name })), { id: '__done', name: '已交付' }],
    items,
    counts: { prep: items.filter((x) => x.group === 'prep').length, work: items.filter((x) => x.group === 'work').length, done: items.filter((x) => x.group === 'done').length }
  };
}

function maskName(s) {
  s = String(s || '');
  return s.length <= 1 ? s + '○' : s[0] + '○'.repeat(Math.min(3, s.length - 1));
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${Number(m[1])}/${Number(m[2])}` : ''; };

function bar(d, it) {
  const total = d.stageNames.length;
  let h = '';
  for (let i = 0; i < total; i++) {
    const cls = it.group === 'done' || i < it.idx ? 'on' : (i === it.idx ? 'cur' : '');
    h += `<i class="${cls}"></i>`;
  }
  return `<div class="bar" aria-hidden="true">${h}</div>`;
}

function card(d, it) {
  const due = it.group === 'done' ? (it.due ? `${md(it.due)} 交付` : '') : (it.due ? `預計 ${md(it.due)}` : '時間未定');
  return `<li class="card g-${it.group}">
    <div class="who"><b>${esc(it.who)}</b><span>${esc(it.item)}</span></div>
    ${bar(d, it)}
    <div class="meta"><span class="st">${esc(it.stage)}</span><span>${esc(due)}</span></div>
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}
  </li>`;
}

function renderHtml(d) {
  const hint = { work: '以下委託同時進行中，不代表先後順序', prep: '確認內容、報價或等待開工', done: `最近交付的委託` };
  const list = ['work', 'prep', 'done'].map((g) => {
    const its = d.items.filter((x) => x.group === g);
    if (!its.length) return '';
    return `<section class="grp"><h2>${GROUP_NAME[g]}<em>${its.length}</em></h2><p class="hint">${hint[g]}</p><ul class="cards">${its.map((it) => card(d, it)).join('')}</ul></section>`;
  }).join('') || '<p class="empty">目前沒有委託</p>';
  const board = `<div class="board">${d.columns.map((col, i) => {
    const its = d.items.filter((x) => col.id === 'prep' ? x.group === 'prep' : x.stageId === col.id);
    return `<section class="col c${i % 5}${col.id === '__done' ? ' cdone' : ''}"><h2>${esc(col.name)}<em>${its.length}</em></h2><ul class="cards">${its.map((it) => card(d, it)).join('') || '<li class="none">—</li>'}</ul></section>`;
  }).join('')}</div>`;
  return `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.artist)} 的委託排單</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#F6F4EF;color:#1F1D1A;font-family:"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",system-ui,sans-serif;line-height:1.5}
.wrap{max-width:1160px;margin:0 auto;padding:40px 20px 56px}
header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px}
.eyebrow{font-size:13px;font-weight:700;color:#2F5D57;letter-spacing:2px}
h1{margin:2px 0 0;font-size:clamp(26px,5vw,40px);font-weight:900;line-height:1.2}
.upd{font-size:13px;color:#5E5A53;margin-top:4px}
.status{display:inline-flex;align-items:center;gap:8px;background:#E3ECEA;color:#1E3F3B;border-radius:999px;padding:9px 16px;font-weight:700}
.status:before{content:"";width:9px;height:9px;border-radius:50%;background:#2F8F6B}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:24px 0 18px}
.stats div{background:#fff;border:1px solid #E6E1D7;border-radius:14px;padding:12px 16px;font-size:13px;color:#5E5A53}
.stats b{display:block;font-size:26px;color:#1F1D1A}
.tabs{display:flex;gap:6px;margin-bottom:18px}
.tabs button{font:inherit;font-size:14px;height:40px;padding:0 18px;border-radius:20px;border:1px solid #D6D0C4;background:#fff;color:#1F1D1A;cursor:pointer}
.tabs button[aria-pressed=true]{background:#1F1D1A;border-color:#1F1D1A;color:#fff}
.note-top{background:#fff;border:1px solid #E6E1D7;border-radius:14px;padding:12px 16px;margin-bottom:18px;white-space:pre-wrap}
.grp{margin-bottom:26px}.grp h2,.col h2{font-size:19px;margin:0;display:flex;align-items:center;gap:8px}
h2 em{font-style:normal;font-size:13px;background:#fff;border:1px solid #E6E1D7;border-radius:999px;padding:1px 9px;color:#5E5A53}
.hint{margin:2px 0 10px;font-size:13px;color:#5E5A53}
.cards{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.grp .cards{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{background:#fff;border:1px solid #E6E1D7;border-radius:14px;padding:14px 16px}
.who b{display:block;font-size:17px}.who span{font-size:14px;color:#5E5A53}
.bar{display:flex;gap:3px;margin:10px 0 6px}.bar i{flex:1;height:7px;border-radius:4px;background:#EDEAE2}
.bar i.on{background:#2F5D57}.bar i.cur{background:#E08A4F}
.meta{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#5E5A53}
.st{font-weight:700;color:#B4501A}.g-done .st{color:#2F5D57}.g-prep .st{color:#5E5A53}
.note{margin:8px 0 0;font-size:13px;color:#3D3A35;background:#F6F4EF;border-radius:8px;padding:6px 10px}
.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;align-items:start}
.col{border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px}
.col h2{justify-content:space-between;padding:2px 4px 4px}.col h2 em{border:0}
.c0{background:#ECE8F6}.c0 h2{color:#4F3780}.c1{background:#FDE9DC}.c1 h2{color:#8A3A10}.c2{background:#FFF3C9}.c2 h2{color:#6B4E00}
.c3{background:#E4EEF8}.c3 h2{color:#1F4E79}.c4{background:#F6E4EE}.c4 h2{color:#7A2D57}.cdone{background:#DDEFE8}.cdone h2{color:#1E5A46}
.col .card{border:0;box-shadow:0 2px 0 rgba(0,0,0,.05)}.none{color:#5E5A53;text-align:center;padding:8px}
.empty{color:#5E5A53;text-align:center;padding:40px}
footer{margin-top:28px;padding-top:16px;border-top:1px solid #DDD8CE;display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:14px;color:#5E5A53}
[hidden]{display:none!important}
@media(max-width:560px){.wrap{padding:28px 14px 40px}.stats b{font-size:22px}}
</style></head>
<body><div class="wrap">
<header><div><div class="eyebrow">COMMISSION QUEUE</div><h1>${esc(d.artist)} 的委託排單</h1><div class="upd">最後更新：${esc(d.updated)}</div></div>
${d.status ? `<div class="status">${esc(d.status)}</div>` : ''}</header>
<div class="stats"><div>製作中<b>${d.counts.work}</b></div><div>準備中<b>${d.counts.prep}</b></div><div>近期已交付<b>${d.counts.done}</b></div></div>
${d.note ? `<div class="note-top">${esc(d.note)}</div>` : ''}
<div class="tabs" role="group" aria-label="檢視方式"><button type="button" data-v="list" aria-pressed="${d.view === 'list'}">清單</button><button type="button" data-v="board" aria-pressed="${d.view === 'board'}">看板</button></div>
<div id="v-list"${d.view === 'list' ? '' : ' hidden'}>${list}</div>
<div id="v-board"${d.view === 'board' ? '' : ' hidden'}>${board}</div>
<footer><span>${d.contact ? `委託洽詢：${esc(d.contact)}` : ''}</span><span>只顯示暱稱與進度，不公開金額與個人資料</span></footer>
</div>
<script>
document.querySelectorAll('.tabs button').forEach(function(b){b.addEventListener('click',function(){
  var v=b.getAttribute('data-v');
  document.querySelectorAll('.tabs button').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
  document.getElementById('v-list').hidden=v!=='list';document.getElementById('v-board').hidden=v!=='board';
})});
</script>
</body></html>`;
}

const API = { buildData, renderHtml, render: (db, now) => renderHtml(buildData(db, now)) };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.PublicPage = API;
})();
