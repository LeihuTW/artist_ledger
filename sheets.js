(function () {
'use strict';
// 產生要同步到 Google 表格、或匯出 Excel 的表格內容（電腦版與手機版共用）
const M = typeof module !== 'undefined' && module.exports ? require('./model') : window.Model;

function mask(name) {
  const s = String(name || '');
  if (s.length <= 1) return s + '○';
  return s[0] + '○'.repeat(Math.min(3, s.length - 1));
}

function publicSheet(db, now) {
  const set = db.settings;
  const GROUP = { prep: '準備中', work: '製作中', done: '已交付' };
  const order = { prep: 1, work: 0, done: 2 };
  const rows = db.commissions
    .filter((c) => !c.closed && c.publicMode !== 'hidden')
    .map((c) => ({ c, st: M.stageOf(db, c) }))
    .sort((a, b) => (order[a.st.group] - order[b.st.group]) || (a.c.deadline || '9999').localeCompare(b.c.deadline || '9999'))
    .map(({ c, st }) => {
      const nick = M.clientName(db, c.clientId, true);
      const who = c.publicMode === 'anon' ? '保密委託' : (set.sync.maskNames ? mask(nick) : nick);
      return [
        GROUP[st.group] || '製作中',
        who,
        c.publicMode === 'anon' ? (c.type || '委託') : (c.title || c.type),
        st.done ? '已交付' : st.name,
        st.done ? '已交付' : (c.deadline || '未定'),
        c.publicNote || ''
      ];
    });
  const title = `${set.artistName || '繪師'} 的委託排單｜${set.sync.statusText || ''}`.replace(/｜$/, '');
  return {
    name: '公開排單表',
    title,
    header: ['狀態', '委託人', '項目', '進度', '預計交付', '備註'],
    rows,
    updated: stamp(now)
  };
}

function internalSheet(db, now) {
  const rows = db.commissions
    .slice()
    .sort((a, b) => (a.closed - b.closed) || (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .map((c) => {
      const cl = db.clients.find((x) => x.id === c.clientId) || {};
      const left = M.isWorking(db, c) ? M.daysLeft(c.deadline, now) : null;
      return [
        c.code, cl.name || '', cl.nickname || '', c.title, c.type,
        c.closed ? '結案' : M.stageOf(db, c).name,
        c.startDate, c.deadline, left === null ? '' : left,
        Number(c.price) || 0, M.paidTotal(c), M.unpaid(c),
        `${M.countedRevisions(c)} / ${c.freeRevisions}`,
        c.sourceFiles.length ? `有（${c.sourceFiles.length}）` : '無',
        c.license || ''
      ];
    });
  return {
    name: '內部進度總表',
    header: ['編號', '委託人', '暱稱', '項目', '類型', '進度', '接單日', '死線', '剩餘天數', '報價', '已收', '未收', '修改次數', '繪圖原檔', '授權'],
    rows,
    updated: stamp(now)
  };
}

function paymentSheet(db, now) {
  const rows = [];
  for (const c of db.commissions) {
    for (const p of c.payments) {
      rows.push([p.date || '', c.code, M.clientName(db, c.clientId), c.title, p.label, Number(p.amount) || 0, p.method || '',
        p.source || '', M.accountLabel(db, p.account), p.payer || '', p.status === 'paid' ? '已收' : '未收', p.note || '']);
    }
  }
  rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  return { name: '收款明細', header: ['日期', '編號', '委託人', '項目', '款項', '金額', '方式', '款項來源', '收款帳戶', '付款人／後五碼', '狀態', '備註'], rows, updated: stamp(now) };
}

function clientSheet(db, now) {
  const rows = db.clients.map((cl) => {
    const cs = db.commissions.filter((c) => c.clientId === cl.id);
    const primary = cl.contacts.find((x) => x.primary) || cl.contacts[0];
    return [
      cl.name, cl.nickname,
      cl.socials.map((s) => `${s.platform} ${s.url}`).join('\n'),
      primary ? `${primary.type}：${primary.value}` : '',
      cl.tags.join('、'), cs.length,
      cs.reduce((a, c) => a + (Number(c.price) || 0), 0)
    ];
  });
  return { name: '委託人名冊', header: ['姓名', '暱稱', '社群', '主要聯繫', '標籤', '委託件數', '累計金額'], rows, updated: stamp(now) };
}

function stamp(now) {
  const d = now || new Date();
  return `${M.fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 委託者帳：表名、欄名換成委託者用詞，拿掉繪圖原檔欄；同步到試算表時表名加上「委託者｜」避免和繪師帳重疊
function forBook(db, sh, prefix) {
  if (db.book !== 'client') return sh;
  const drop = sh.header.indexOf('繪圖原檔');
  const keep = (row) => row.filter((x, i) => i !== drop);
  const word = (v) => (v === '已收' ? '已付' : v === '未收' ? '未付' : v);
  return Object.assign({}, sh, {
    name: (prefix ? '委託者｜' : '') + M.swapTerms(sh.name, 'client'),
    title: sh.title ? M.swapTerms(sh.title, 'client') : sh.title,
    header: keep(sh.header.map((h) => M.swapTerms(h, 'client'))),
    rows: sh.rows.map((r) => keep(r).map(word))
  });
}

// 依同步設定挑出工作表
function syncSheets(db, now) {
  const on = db.settings.sync.sheets;
  const client = db.book === 'client';
  const out = [];
  if (on.public && !client) out.push(publicSheet(db, now));
  if (on.internal) out.push(internalSheet(db, now));
  if (on.payments) out.push(paymentSheet(db, now));
  if (on.clients) out.push(clientSheet(db, now));
  return out.map((sh) => forBook(db, sh, true));
}

function allSheets(db, now) {
  const list = [internalSheet(db, now), paymentSheet(db, now), clientSheet(db, now)];
  if (db.book !== 'client') list.push(publicSheet(db, now));
  return list.map((sh) => forBook(db, sh, false));
}
function csvSheet(db, now) { return forBook(db, internalSheet(db, now), false); }

const API = { publicSheet, internalSheet, paymentSheet, clientSheet, syncSheets, allSheets, csvSheet, mask };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.Sheets = API;
})();
