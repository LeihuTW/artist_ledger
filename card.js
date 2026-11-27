(function () {
'use strict';
// 可分享的資料卡：「名片代碼」編碼／解碼（主程式、手機版、測試共用，不依賴 Electron）
// 代碼只放文字資料，不放圖片、不放完整帳號；對方貼上後會變成名冊裡的一張資料卡。

const PREFIX = 'ALCARD1-';
const LIM = { short: 60, mid: 200, long: 1500, list: 12 };

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const okUrl = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href.slice(0, 400) : ''; } catch (e) { return ''; } };

function emptyProfile() {
  return { nickname: '', intro: '', openStatus: '', types: [], queueUrl: '', priceUrl: '', terms: '', socials: [], contacts: [], replyTime: '', payMethods: [], showTypes: true };
}

// 只留下允許的欄位，長度與數量都有上限
function clean(p, role) {
  p = p || {};
  const out = {
    role: role === 'client' ? 'client' : 'artist',
    nickname: str(p.nickname, LIM.short),
    intro: str(p.intro, LIM.mid),
    replyTime: str(p.replyTime, LIM.short),
    socials: (Array.isArray(p.socials) ? p.socials : []).slice(0, LIM.list).map((s) => ({ platform: str(s && s.platform, 20), url: okUrl(s && s.url) })).filter((s) => s.url),
    contacts: (Array.isArray(p.contacts) ? p.contacts : []).slice(0, LIM.list).map((c) => ({ type: str(c && c.type, 20), value: str(c && c.value, LIM.short) })).filter((c) => c.value)
  };
  if (out.role === 'artist') {
    Object.assign(out, {
      openStatus: ['開放接單', '暫停接單', '只接熟客'].includes(p.openStatus) ? p.openStatus : '',
      types: (Array.isArray(p.types) ? p.types : []).slice(0, LIM.list).map((t) => str(t, 30)).filter(Boolean),
      queueUrl: okUrl(p.queueUrl), priceUrl: okUrl(p.priceUrl),
      terms: str(p.terms, LIM.long),
      // 收款方式只寫名稱（例：郵局轉帳、VGen），完整帳號請私下給
      payMethods: (Array.isArray(p.payMethods) ? p.payMethods : []).slice(0, LIM.list).map((m) => str(m, 40)).filter(Boolean)
    });
  }
  return out;
}

// base64url（支援中文）
function b64enc(s) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64dec(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encode(profile, role) {
  const p = clean(profile, role);
  return PREFIX + b64enc(JSON.stringify({ v: 1, app: 'ArtistLedger', ...p }));
}

// 從一段文字裡找出名片代碼（對方可能連同訊息一起貼上）
function decode(text) {
  const m = String(text || '').match(/ALCARD1-([A-Za-z0-9_-]+)/);
  if (!m) return { error: '找不到名片代碼（ALCARD1- 開頭）' };
  if (m[1].length > 20000) return { error: '代碼太長，可能不完整' };
  let j;
  try { j = JSON.parse(b64dec(m[1])); } catch (e) { return { error: '代碼不完整或已損毀，請請對方重新複製一次' }; }
  if (!j || j.app !== 'ArtistLedger' || j.v !== 1) return { error: '這不是繪師委託帳本的名片代碼' };
  const p = clean(j, j.role);
  if (!p.nickname) return { error: '名片代碼裡沒有名字' };
  return { profile: p };
}

// 名片 → 名冊裡的一筆資料（對方是繪師就填進繪師資料卡欄位）
function toClientFields(p) {
  const f = {
    name: '', nickname: p.nickname, socials: p.socials.slice(),
    contacts: p.contacts.map((c, i) => ({ type: c.type || '其他', value: c.value, primary: i === 0 })),
    replyTime: p.replyTime || ''
  };
  if (p.role === 'artist') {
    Object.assign(f, {
      openStatus: p.openStatus || '', queueUrl: p.queueUrl || '', priceUrl: p.priceUrl || '',
      terms: p.terms || '', payMethods: (p.payMethods || []).map((label) => ({ label, detail: '' }))
    });
  }
  const extra = [p.intro && `自我介紹：${p.intro}`, p.role === 'artist' && p.types && p.types.length && `接的類型：${p.types.join('、')}`].filter(Boolean).join('\n');
  return { fields: f, note: extra };
}

const API = { PREFIX, emptyProfile, clean, encode, decode, toClientFields };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else window.Card = API;
})();
