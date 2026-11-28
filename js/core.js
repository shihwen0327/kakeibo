/* Wen 記帳 — 核心：工具、資料、CSV 匯入、儲存（Claude／Google 試算表／這台裝置） */
'use strict';
const W = window.W = {};
{
const pad = n => String(n).padStart(2, '0');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ds = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const dd = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 12);
const addD = (s, n) => { const d = dd(s); d.setDate(d.getDate() + n); return ds(d); };
const today = () => ds(new Date());
const wd = s => '日一二三四五六'[dd(s).getDay()];
const md = s => `${+s.slice(4, 6)}月${+s.slice(6, 8)}日`;
const ymd = s => `${s.slice(0, 4)}/${+s.slice(4, 6)}/${+s.slice(6, 8)}`;
const reiwa = y => y >= 2019 ? `令和${y - 2018}年` : `平成${y - 1988}年`;
const yen = n => Math.round(n).toLocaleString('ja-JP');
const amt = (n, cur = 'JPY') => cur === 'USD' ? (+n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : Math.round(n).toLocaleString('ja-JP');
const CURSYM = {JPY: '¥', TWD: 'NT$', USD: 'US$'};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase();
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
Object.assign(W, {pad, esc, ds, dd, addD, today, wd, md, ymd, reiwa, yen, amt, CURSYM, uid, clone, sleep});

const S = W.S = {meta: null, ps: {}, months: {}, recs: [], offline: ''};
const newMeta = () => ({v: 4, seedPs: 3, purge20261110: true, imports: [], settings: {monthStart: 1}});
W.newMeta = newMeta;

/* ================= 儲存後端 =================
 * claude：Claude 的 artifact 資料庫（在 Claude 裡測試用）
 * gas   ：Google Apps Script＋Google 試算表（獨立版，放 GitHub Pages）
 * local ：只存這台裝置的瀏覽器 */
const GASKEY = 'wen_gas', LS = 'wenkakeibo4';
function docBackend(kind, db, uidv) {
  const col = () => db.collection('data/users/' + uidv);
  const write = async (key, body) => {
    if (kind === 'claude') { try { await col().doc(key).set(body); } catch (e) { if (e && e.code === 'unavailable') { await sleep(700); await col().doc(key).set(body); } else throw e; } }
    else { const all = JSON.parse(localStorage.getItem(LS) || '{}'); all[key] = body; localStorage.setItem(LS, JSON.stringify(all)); }
  };
  const Q = {};
  const bodyOf = k => k === 'meta' ? S.meta : k === 'ps' ? {slips: S.ps} : (S.months[k.slice(1)] || {r: {}});
  const persist = k => { const q = Q[k] || (Q[k] = {running: false, dirty: false}); q.dirty = true; if (!q.running) run(k); };
  async function run(k) { const q = Q[k]; q.running = true; while (q.dirty) { q.dirty = false; try { await write(k, clone(bodyOf(k))); } catch (e) { W.toast?.(e && e.code === 'quota_exceeded' ? '空間已滿，無法儲存' : '儲存失敗，請稍後再試'); break; } } q.running = false; }
  return {kind,
    async load() {
      let all = {};
      if (kind === 'claude') { const snap = await Promise.race([col().get(), sleep(15000).then(() => { throw new Error('連不到 Claude 的資料庫'); })]); for (const d of snap.docs) all[d.id] = clone(d.data()); }
      else all = JSON.parse(localStorage.getItem(LS) || '{}');
      if (!all.meta) return null;
      const recs = []; for (const k in all) if (/^r\d{6}$/.test(k)) for (const id in all[k].r) recs.push(all[k].r[id]);
      return {meta: all.meta, slips: Object.values((all.ps && all.ps.slips) || {}), recs};
    },
    putRecs(recs, oldKeys) { const ks = new Set(oldKeys || []); recs.forEach(r => ks.add('r' + r.d.slice(0, 6))); ks.forEach(persist); },
    delRecs(keys) { new Set(keys).forEach(persist); },
    putSlip() { persist('ps'); }, delSlip() { persist('ps'); }, putMeta() { persist('meta'); },
    async seedAll(recKeys, prog) { const ks = [...recKeys]; let i = 0; await write('ps', {slips: S.ps}); for (const k of ks) { await write('r' + k, S.months[k]); prog(++i, ks.length); } await write('meta', S.meta); },
    async flush() { for (let i = 0; i < 600; i++) { if (!Object.values(Q).some(q => q.running || q.dirty)) return; await sleep(100); } },
    busy: () => Object.values(Q).some(q => q.running || q.dirty)
  };
}
function gasBackend(cfg) {
  let chain = Promise.resolve(), pending = 0;
  const call = async (action, payload = {}) => {
    const res = await fetch(cfg.url, {method: 'POST', body: JSON.stringify({token: cfg.token, action, ...payload})});
    if (!res.ok) throw new Error('伺服器回應 ' + res.status); const j = await res.json(); if (!j.ok) throw new Error(j.error || '伺服器錯誤'); return j;
  };
  const queue = (action, payload) => { pending++; chain = chain.then(() => call(action, payload)).catch(e => { W.toast?.('同步到 Google 試算表失敗：' + e.message); }).finally(() => pending--); return chain; };
  const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  return {kind: 'gas', call,
    async load() { const j = await call('load'); if (!j.meta) return null; return {meta: j.meta, slips: j.slips, recs: j.recs}; },
    putRecs(recs) { for (const c of chunks(recs, 800)) queue('putRecs', {recs: c}); },
    delRecs(keys, ids) { if (ids.length) queue('delRecs', {ids}); },
    putSlip(p) { queue('putSlip', {slip: p}); }, delSlip(id) { queue('delSlip', {id}); }, putMeta() { queue('putMeta', {meta: S.meta}); },
    async seedAll(recKeys, prog) { const recs = S.recs; const cs = chunks(recs, 800); let i = 0; const n = cs.length + 2;
      await call('putSlips', {slips: Object.values(S.ps)}); prog(++i, n); for (const c of cs) { await call('putRecs', {recs: c}); prog(++i, n); } await call('putMeta', {meta: S.meta}); prog(++i, n); },
    async saveFile(blob, name, folder) { const b64 = await new Promise((ok, ng) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ng; fr.readAsDataURL(blob); });
      const j = await call('saveFile', {name, folder, mime: blob.type || 'application/octet-stream', base64: b64}); return 'gd:' + j.id; },
    async flush() { await chain; }, busy: () => pending > 0
  };
}
const Store = W.Store = {mode: 'local', be: null, assets: null, dl: null, inClaude: false,
  gasCfg() { try { return JSON.parse(localStorage.getItem(GASKEY) || 'null'); } catch (e) { return null; } },
  setGas(cfg) { if (cfg) { localStorage.setItem(GASKEY, JSON.stringify(cfg)); localStorage.removeItem(LS + ':local'); } else localStorage.removeItem(GASKEY); },
  async init() {
    if (window.claude && claude.use) {
      this.inClaude = true;
      try { const [db, u] = await Promise.all([claude.use('db'), claude.use('user')]); const id = u ? await u.id() : null;
        claude.use('assets').then(a => this.assets = a).catch(() => {}); claude.use('downloads').then(d => this.dl = d).catch(() => {});
        if (db && id) { this.mode = 'claude'; this.be = docBackend('claude', db, id); return; } } catch (e) {}
    }
    const g = this.gasCfg(); if (g && g.url) { this.mode = 'gas'; this.be = gasBackend(g); return; }
    let loc = null; try { loc = localStorage.getItem(LS + ':local') || localStorage.getItem(LS); } catch (e) {}
    this.mode = this.inClaude || loc ? 'local' : 'setup'; this.be = docBackend('local');
  },
  useLocal() { try { localStorage.setItem(LS + ':local', '1'); } catch (e) {} this.mode = 'local'; this.be = docBackend('local'); },
  label() { return {claude: 'Claude（測試用）', gas: 'Google 試算表', local: '這台裝置的瀏覽器'}[this.mode] || ''; }
};

/* 檔案（薪資單 PDF、匯入的 CSV）：Claude 版存 artifact，獨立版存 Google Drive */
W.uploadFile = async (blob, name, folder) => {
  if (Store.mode === 'gas') return Store.be.saveFile(blob, name, folder);
  if (Store.mode === 'claude' && Store.assets) { const r = await Store.assets.upload(blob, {type: blob.type || 'application/pdf'}); return r.id; }
  return null;
};
W.fileUrl = ref => !ref ? '' : String(ref).startsWith('gd:') ? 'https://drive.google.com/file/d/' + encodeURIComponent(ref.slice(3)) + '/view' : '/_blob/' + ref;
W.canFiles = () => Store.mode === 'gas' || (Store.mode === 'claude' && !!Store.assets);
W.download = async (name, text) => {
  if (Store.dl) { try { await Store.dl.save({filename: name, data: text}); } catch (e) { if (e && e.code !== 'cancelled') W.toast('沒有下載'); } return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type: 'text/csv'})); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

/* ================= 資料 ================= */
function setData(d) {
  S.meta = d.meta; S.meta.settings = {monthStart: 1, ...(S.meta.settings || {})}; S.meta.imports = S.meta.imports || [];
  S.ps = {}; for (const p of d.slips || []) S.ps[p.id] = p;
  S.months = {}; for (const r of d.recs || []) { const k = r.d.slice(0, 6); (S.months[k] || (S.months[k] = {r: {}})).r[r.id] = r; }
  rebuild();
}
function rebuild() { const out = []; for (const k in S.months) for (const id in S.months[k].r) out.push(S.months[k].r[id]); out.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : (a.upd < b.upd ? 1 : -1)); S.recs = out; }
const ms = () => S.meta.settings.monthStart || 1;
function monthKey(d) { let y = +d.slice(0, 4), m = +d.slice(4, 6); if (+d.slice(6, 8) < ms()) { m--; if (!m) { m = 12; y--; } } return `${y}${pad(m)}`; }
function monthRange(k) { const y = +k.slice(0, 4), m = +k.slice(4, 6); const a = `${k}${pad(ms())}`; let ny = y, nm = m + 1; if (nm > 12) { nm = 1; ny++; } return [a, addD(`${ny}${pad(nm)}${pad(ms())}`, -1)]; }
const shiftKey = (k, n) => { const t = +k.slice(0, 4) * 12 + +k.slice(4, 6) - 1 + n; return `${Math.floor(t / 12)}${pad(t % 12 + 1)}`; };
Object.assign(W, {setData, rebuild, monthKey, monthRange, shiftKey});
W.saveMeta = () => Store.be.putMeta();
W.putSlip = p => { S.ps[p.id] = p; Store.be.putSlip(p); };
W.delSlip = id => { delete S.ps[id]; Store.be.delSlip(id); };
W.flush = () => Store.be.flush();

/* ---- CSV ---- */
function parseCsv(text) {
  text = text.replace(/^﻿/, ''); const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = []; } else f += c; }
  row.push(f); if (row.some(x => x !== '')) rows.push(row); return rows;
}
const NEED = ['日期', '類別', '金額', '幣別', '帳戶', '收支區分', 'UUID'];
function csvToRecords(text) {
  const rows = parseCsv(text); if (!rows.length) throw new Error('檔案是空的');
  const h = rows[0].map(x => x.trim()); const miss = NEED.filter(k => !h.includes(k)); if (miss.length) throw new Error('不是每日家計簿匯出的 CSV（缺少欄位：' + miss.join('、') + '）');
  const ix = k => h.indexOf(k); const out = [], bad = [];
  rows.slice(1).forEach((r, i) => { const g = k => ix(k) >= 0 ? String(r[ix(k)] ?? '').trim() : '';
    const d = g('日期').replace(/\D/g, ''), a = parseFloat(g('金額').replace(/,/g, '')), id = g('UUID');
    if (d.length !== 8 || !isFinite(a) || !id) { bad.push(i + 2); return; }
    out.push({id, d, t: g('收支區分') === '收' ? 1 : 0, c: g('類別'), p: g('大類別'), a, cur: g('幣別') || 'JPY', m: g('成員'), ac: g('帳戶'), tg: g('標籤') ? g('標籤').split('|').map(x => x.trim()).filter(Boolean) : [], memo: g('備註'), upd: g('上次更新')}); });
  return {recs: out, bad};
}
const FIELDS = ['d', 't', 'c', 'p', 'a', 'cur', 'm', 'ac', 'tg', 'memo', 'upd'];
const same = (x, y) => FIELDS.every(k => JSON.stringify(x[k]) === JSON.stringify(y[k]));
function findRec(id) { for (const k in S.months) if (S.months[k].r[id]) return [k, S.months[k].r[id]]; return [null, null]; }
function planImport(recs) {
  const ids = new Set(recs.map(r => r.id)); let lo = '99999999', hi = '00000000'; for (const r of recs) { if (r.d < lo) lo = r.d; if (r.d > hi) hi = r.d; }
  const add = [], upd = [], keep = [];
  for (const r of recs) { const [, o] = findRec(r.id); if (!o) add.push(r); else if (!same(o, r)) upd.push({old: o, rec: r}); else keep.push(r); }
  const gone = S.recs.filter(r => r.d >= lo && r.d <= hi && !ids.has(r.id));
  return {add, upd, keep, gone, lo, hi, total: recs.length};
}
function applyImport(plan, delGone) {
  const oldKeys = [], put = [];
  const place = r => { const [k] = findRec(r.id); const nk = r.d.slice(0, 6); if (k && k !== nk) { delete S.months[k].r[r.id]; oldKeys.push('r' + k); } (S.months[nk] || (S.months[nk] = {r: {}})).r[r.id] = r; put.push(r); };
  plan.add.forEach(place); plan.upd.forEach(x => place(x.rec));
  const delKeys = [], delIds = [];
  if (delGone) for (const r of plan.gone) { const [k] = findRec(r.id); if (k) { delete S.months[k].r[r.id]; delKeys.push('r' + k); delIds.push(r.id); } }
  rebuild();
  if (put.length) Store.be.putRecs(put, oldKeys); if (delIds.length) Store.be.delRecs(delKeys, delIds);
}
Object.assign(W, {parseCsv, csvToRecords, planImport, applyImport, findRec});

/* ---- 薪資 ---- */
const SOCIAL = /健康保険|厚生年金|雇用保険|介護保険|子ども|子育て|子供/, ITAX = /所得税|年末調整/, RTAX = /住民税|地方税/;
function split(p) { const o = {social: 0, itax: 0, rtax: 0, other: 0}; for (const [k, v] of Object.entries(p.deduct || {})) { const n = +v || 0; if (SOCIAL.test(k)) o.social += n; else if (ITAX.test(k)) o.itax += n; else if (RTAX.test(k)) o.rtax += n; else o.other += n; } return o; }
const slips = () => Object.values(S.ps).filter(p => p.kind === '給与' || p.kind === '賞与').sort((a, b) => a.payDate < b.payDate ? -1 : 1);
const gensen = () => Object.values(S.ps).filter(p => p.kind === '源泉徴収票');
function checkSlip(p) { const w = []; const sp = Object.values(p.pay || {}).reduce((s, v) => s + (+v || 0), 0), sd = Object.values(p.deduct || {}).reduce((s, v) => s + (+v || 0), 0);
  if (sp !== +p.gross) w.push(`支給項目合計 ${yen(sp)} ≠ 總支給 ${yen(p.gross)}`); if (sd !== +p.deduction) w.push(`扣除項目合計 ${yen(sd)} ≠ 扣除合計 ${yen(p.deduction)}`);
  if (+p.gross - +p.deduction !== +p.net) w.push(`總支給 − 扣除 = ${yen(p.gross - p.deduction)}，和實領 ${yen(p.net)} 不同`); return w; }
const jumin = () => Object.values(S.ps).filter(p => p.kind === '住民税').sort((a, b) => a.payDate < b.payDate ? -1 : 1);
const isTax = k => ITAX.test(k) || RTAX.test(k), isSocial = k => SOCIAL.test(k);
Object.assign(W, {split, slips, gensen, jumin, checkSlip, isTax, isSocial});

/* ---- 稅金試算（所得税＝曆年；住民税＝年度 6 月〜翌年 5 月，依前一年收入） ---- */
const NONTAX = /非課税/;
// 給与所得控除後の金額（簡易表的 4,000 円單位）；y＝所得年
function kyuyoShotoku(x, y) {
  const mn = y <= 2024 ? 550000 : y === 2025 ? 650000 : 740000;
  if (x < 1628000 + (y >= 2025 ? 272000 : 0)) return Math.max(0, x - mn);
  if (x < 6600000) { const a = Math.floor(x / 4000) * 4000; return x <= 1800000 ? Math.floor(a * 0.6 + 100000) : x <= 3600000 ? Math.floor(a * 0.7 - 80000) : Math.floor(a * 0.8 - 440000); }
  if (x <= 8500000) return Math.floor(x * 0.9 - 1100000);
  return x - 1950000;
}
function kisoShotoku(y, g) {   // 所得税的基礎控除（國稅廳：令和7年度・令和8年度改正）
  if (y <= 2024) return g <= 24000000 ? 480000 : 0;
  if (y === 2025) return g <= 1320000 ? 950000 : g <= 3360000 ? 880000 : g <= 4890000 ? 680000 : g <= 6550000 ? 630000 : g <= 23500000 ? 580000 : 480000;
  return g <= 4890000 ? 1040000 : g <= 6550000 ? 670000 : g <= 23500000 ? 620000 : 480000;   // 2026 年起（2027 年後如再改要更新）
}
function incomeTax(t) { const B = [[1950000, .05, 0], [3300000, .1, 97500], [6950000, .2, 427500], [9000000, .23, 636000], [18000000, .33, 1536000], [40000000, .4, 2796000], [1e15, .45, 4796000]]; const [, r, d] = B.find(b => t <= b[0]); return Math.max(0, t * r - d); }
// 一年的所得税試算：有源泉徴収票的公司用源泉徴収票，其餘用薪資單；當年還沒發完的月份用最後一張薪資單推估
W.taxYear = (y, opt = {}) => {
  y = +y; const L = slips().filter(p => +p.payDate.slice(0, 4) === y), G = gensen().filter(g => +g.year === y);
  const rows = []; let inc = 0, soc = 0, wh = 0, est = 0;
  const gcos = new Set(G.filter(g => !g.sep).map(g => g.company));
  for (const g of G) { const f = g.fields || {}; const r = {src: g.sep ? '源泉徴収票（另計）' : '源泉徴収票', company: g.company, inc: +f['支払金額'] || 0, soc: +f['社会保険料等の金額'] || 0, wh: +f['源泉徴収税額'] || 0}; rows.push(r); }
  const cos = [...new Set(L.map(p => p.company))].filter(c => !gcos.has(c));
  for (const c of cos) { const Q = L.filter(p => p.company === c); const r = {src: '薪資單', company: c, inc: 0, soc: 0, wh: 0, n: Q.length};
    for (const p of Q) { r.inc += +p.gross - Object.entries(p.pay || {}).filter(([k]) => NONTAX.test(k)).reduce((a, [, v]) => a + (+v || 0), 0); const x = split(p); r.soc += x.social; r.wh += x.itax; }
    // 推估：今年、這家是最後一家、最後一張不是 12 月支付 → 用最後一張月薪補到 12 月
    const last = Q.filter(p => p.kind === '給与').at(-1), now = new Date();
    if (last && y === now.getFullYear() && c === L.at(-1).company && last.payDate.slice(0, 4) == y) {
      const m = +last.payDate.slice(5, 7); const k = 12 - m;
      if (k > 0) { const x = split(last); const gi = +last.gross - Object.entries(last.pay || {}).filter(([kk]) => NONTAX.test(kk)).reduce((a, [, v]) => a + (+v || 0), 0);
        r.inc += gi * k; r.soc += x.social * k; r.wh += x.itax * k; r.est = k; est += k; } }
    rows.push(r); }
  for (const r of rows) { inc += r.inc; soc += r.soc; wh += r.wh; }
  const kyu = kyuyoShotoku(inc, y), kiso = kisoShotoku(y, kyu);
  const taxable = Math.max(0, Math.floor((kyu - soc - kiso) / 1000) * 1000);
  let tax = incomeTax(taxable); const teigaku = y === 2024 ? Math.min(30000, tax) : 0; tax -= teigaku;
  const total = Math.floor(tax * 1.021 / 100) * 100;
  return {year: y, rows, inc, kyu, soc, kiso, taxable, teigaku, total, wh, diff: wh - total, est};
};
// 住民税：fy 年度＝fy/6〜fy+1/5；試算依 fy-1 年收入（所得割 10%＋均等割；調整控除 2,500）
W.JUMIN_KINTO = 5500;   // 均等割：市 3,000＋縣 1,000（部分縣另有森林／環境稅 500）＋森林環境税 1,000
W.juminEst = fy => {
  const t = W.taxYear(fy - 1); if (!t.inc) return null;
  const taxable = Math.max(0, Math.floor((t.kyu - t.soc - 430000) / 1000) * 1000);
  const shotoku = Math.max(0, Math.floor(taxable * 0.1) - (taxable ? 2500 : 0));
  const total = shotoku + (t.kyu > 450000 ? W.JUMIN_KINTO : 0);
  return {fy, base: t, taxable, shotoku, kinto: total - shotoku, total, monthly: Math.round(total / 12), est: t.est};
};
// 某年度實際繳過的住民税：自繳（普通徴収）＋薪資單扣的（特別徴収，支払日在 fy/6〜fy+1/5）
W.juminPaid = fy => {
  const a = `${fy}-06-01`, b = `${fy + 1}-06-01`; const items = [];
  for (const j of jumin()) if ((+j.fiscal || +j.payDate.slice(0, 4)) === fy) items.push({d: j.payDate, kind: '普通徴収', amt: +j.amount || 0, id: j.id, note: j.note});
  for (const p of slips()) if (p.payDate >= a && p.payDate < b) { const r = Object.entries(p.deduct || {}).filter(([k]) => RTAX.test(k)).reduce((s, [, v]) => s + (+v || 0), 0); if (r) items.push({d: p.payDate, kind: '特別徴収', amt: r, id: p.id}); }
  items.sort((x, y) => x.d < y.d ? -1 : 1); return {items, total: items.reduce((s, x) => s + x.amt, 0)};
};

/* ---- 首次建立：搬入 27 份薪資單＋3 張源泉徴収票＋3,414 筆收支（到 2026/11/9） ---- */
W.seed = async prog => {
  const [recs, ps] = await Promise.all([fetch('seed/records.json').then(r => r.json()), fetch('seed/payslips.json').then(r => r.json())]);
  const meta = newMeta(); meta.imports.push({at: new Date().toISOString(), file: '內建資料', total: recs.length, add: recs.length, upd: 0, del: 0, note: '初次匯入（每日家計簿 2026-11-25 匯出，全部幣別；只保留到 2026/11/9）'});
  setData({meta, slips: ps, recs: recs.map(([id, d, t, c, p, a, cur, m, ac, tg, memo, upd]) => ({id, d, t, c, p, a, cur, m, ac, tg: tg ? tg.split('|') : [], memo, upd}))});
  await Store.be.seedAll(Object.keys(S.months), prog);
};

/* 備份檔：整份資料（設定、匯入紀錄、薪資單、收支）存成一個 JSON；換儲存位置或上線時匯入 */
const packRec = r => [r.id, r.d, r.t, r.c, r.p, r.a, r.cur, r.m, r.ac, (r.tg || []).join('|'), r.memo, r.upd];
const unpackRec = ([id, d, t, c, p, a, cur, m, ac, tg, memo, upd]) => ({id, d, t, c, p, a, cur, m, ac, tg: tg ? tg.split('|') : [], memo, upd});
W.exportBackup = () => { const o = {app: 'wen-kakeibo', v: 1, at: new Date().toISOString(), meta: S.meta, slips: Object.values(S.ps), recs: S.recs.map(packRec)};
  W.download(`wen-kakeibo-backup-${today()}.json`, JSON.stringify(o)); };
W.readBackup = async file => { const o = JSON.parse(await file.text()); if (o.app !== 'wen-kakeibo' || !Array.isArray(o.slips) || !Array.isArray(o.recs)) throw new Error('不是 Wen 記帳的備份檔'); return o; };
W.importBackup = async (o, prog) => {
  const meta = Object.assign(newMeta(), o.meta || {}); meta.imports = (meta.imports || []).concat([{at: new Date().toISOString(), manual: true, file: '備份檔', note: `匯入備份（${(o.at || '').slice(0, 10)} 匯出）：薪資單等 ${o.slips.length} 筆、收支 ${o.recs.length} 筆`, total: o.recs.length, add: o.recs.length, upd: 0, del: 0}]);
  setData({meta, slips: o.slips, recs: o.recs.map(unpackRec)});
  await Store.be.seedAll(Object.keys(S.months), prog);
};
W.hasSeed = async () => { try { const r = await fetch('seed/payslips.json', {method: 'HEAD'}); return r.ok; } catch (e) { return false; } };

/* 內建薪資資料更新：已建立過資料的，把新版內建的薪資單／源泉徴収票覆蓋進去（依 id） */
const SEED_PS = 3;
W.seedUpdate = async () => {
  if ((S.meta.seedPs || 1) >= SEED_PS) return 0;
  const r = await fetch('seed/payslips.json'); if (!r.ok) { S.meta.seedPs = SEED_PS; return 0; }
  const ps = await r.json();
  for (const p of ps) W.putSlip(p);
  S.meta.seedPs = SEED_PS; await W.saveMeta(); await W.flush(); return ps.length;
};

/* 一次性：刪除 2026/11/10 以後的收支紀錄（11 月還沒過完，之後匯入完整 CSV 再補） */
W.purgeOnce = () => {
  if (S.meta.purge20261110) return 0;
  const ids = [], keys = new Set();
  for (const k in S.months) for (const id in S.months[k].r) if (S.months[k].r[id].d >= '20261110') { delete S.months[k].r[id]; ids.push(id); keys.add('r' + k); }
  S.meta.purge20261110 = true;
  if (ids.length) { rebuild(); Store.be.delRecs([...keys], ids); S.meta.imports.push({at: new Date().toISOString(), manual: true, file: '手動刪除', note: '2026/11/10 以後的紀錄（11 月還沒過完，之後匯入完整 CSV 再補）', total: ids.length, add: 0, upd: 0, del: ids.length}); }
  W.saveMeta(); return ids.length;
};

}
