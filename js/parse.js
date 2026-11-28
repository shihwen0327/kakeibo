/* Wen 記帳 — 薪資單 PDF 判讀（不靠 Claude：讀 PDF 裡的文字，照各公司格式的規則抓數字）
 * 新公司格式：在 PROFILES 加一組 {name, detect(text), parse(rows, text)}。 */
'use strict';
(function (root) {
const pad = n => String(n).padStart(2, '0');
/* PDF 常用「部首」字形（例：⺠、⽉），先換回一般漢字 */
const RAD = {'⺠': '民', '⻑': '長', '⻄': '西', '⻝': '食', '⻘': '青', '⺟': '母', '⻭': '歯', '⻤': '鬼', '⺤': '爪', '⺩': '王', '⻆': '角', '⻌': '辶', '⻏': '阝'};
const norm = s => String(s).normalize('NFKC').replace(/[⺀-⻿]/g, c => RAD[c] || c).replace(/\u0000/g, '→').replace(/\s+/g, ' ').trim();
const isNum = s => /^[-−▲△]?\s?[\d,]+$/.test(s);
const num = s => { const neg = /^[-−▲△]/.test(s); const n = +String(s).replace(/[^\d]/g, ''); return neg ? -n : n; };

/* pdf.js 的文字項目 → 依 y 分列（由上到下），每列依 x 排序 */
function toRows(items) {
  const its = items.map(it => ({s: norm(it.str), x: it.transform[4], y: it.transform[5], w: it.width})).filter(it => it.s);
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of its) { const r = rows.find(r => Math.abs(r.y - it.y) < 3); if (r) r.items.push(it); else rows.push({y: it.y, items: [it]}); }
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x)); rows.sort((a, b) => b.y - a.y);
  return rows;
}

/* ---- 日本假日（算支払日用） ---- */
const dsOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const addDay = (s, n) => { const d = new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n, 12); return dsOf(d); };
const dow = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12).getDay();
const HC = {};
function holidays(y) {
  if (HC[y]) return HC[y];
  const H = new Set(), a = (m, d) => H.add(`${y}-${pad(m)}-${pad(d)}`); const nth = (m, n) => { const f = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - f) % 7) + (n - 1) * 7; };
  a(1, 1); a(1, nth(1, 2)); a(2, 11); a(2, 23); a(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))); a(4, 29); a(5, 3); a(5, 4); a(5, 5);
  a(7, nth(7, 3)); a(8, 11); a(9, nth(9, 3)); a(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4))); a(10, nth(10, 2)); a(11, 3); a(11, 23);
  for (const s of [...H].sort()) if (dow(s) === 0) { let t = addDay(s, 1); while (H.has(t)) t = addDay(t, 1); H.add(t); }
  for (const s of [...H]) { const b = addDay(s, 1), c = addDay(s, 2); if (H.has(c) && !H.has(b) && dow(b) !== 0) H.add(b); }
  return HC[y] = H;
}
const isOff = s => dow(s) === 0 || dow(s) === 6 || holidays(+s.slice(0, 4)).has(s);
/* 每月 day 日發薪，遇週末／假日提前 */
function payDay(y, m, day = 10) { let s = `${y}-${pad(m)}-${pad(day)}`; while (isOff(s)) s = addDay(s, -1); return s; }

/* ---- 格式：freee 人事労務的給与明細／賞与明細 ---- */
const FREEE = {
  name: 'freee 給与明細',
  detect: t => /差引総支給額|差引支給額/.test(t) && /支払分/.test(t) && /支給/.test(t) && /控除/.test(t),
  parse(rows, text) {
    const all = rows.flatMap(r => r.items); const find = re => all.find(i => re.test(i.s));
    const out = {kind: /賞与/.test(text) ? '賞与' : '給与', company: '', workMonth: '', payDate: '', title: '', pay: {}, deduct: {}, attendance: {}, gross: 0, deduction: 0, net: 0, note: '', warn: []};
    const pm = text.match(/(\d{4})年\s?(\d{1,2})月\s?支払分/); if (pm) out.payMonth = `${pm[1]}-${pad(pm[2])}`;
    const co = find(/(株式会社|有限会社|合同会社)/); if (co) out.company = co.s.replace(/\s*[(（].*$/, '');
    const hP = all.find(i => i.s === '支給'), hD = all.find(i => i.s === '控除');
    if (!hP || !hD) { out.warn.push('找不到「支給」「控除」標題'); return out; }
    const split = (hP.x + hD.x) / 2;
    const end = rows.find(r => r.y < hP.y && r.items.some(i => i.s === '計'));
    for (const r of rows) {
      if (r.y >= hP.y - 1 || (end && r.y < end.y - 1)) continue;
      let cur = null; const pairs = [];
      for (const it of r.items) { if (isNum(it.s)) { if (cur) { pairs.push([cur, num(it.s), it.x]); cur = null; } } else cur = it; }
      for (const [lb, v] of pairs) { const left = lb.x < split;
        if (lb.s === '計') { if (left) out.gross = v; else out.deduction = v; }
        else (left ? out.pay : out.deduct)[lb.s] = v; }
    }
    const nl = find(/^差引(総)?支給額$/);
    if (nl) { const cand = all.filter(i => isNum(i.s) && i.y <= nl.y + 2 && i.y >= nl.y - 40 && i.x > nl.x).sort((a, b) => b.y - a.y); if (cand[0]) out.net = num(cand[0].s); }
    const at = find(/^勤怠\s*[(（]/);
    if (at) { const m = at.s.match(/(\d{4})年(\d{1,2})月\d{1,2}日\s*〜\s*(\d{4})年(\d{1,2})月\d{1,2}日/); if (m) out.workMonth = `${m[3]}-${pad(m[4])}`;
      const bk = find(/^備考$/); const lo = bk ? bk.y : -1e9;
      for (const r of rows) { if (r.y >= at.y - 1 || r.y <= lo + 1) continue; let cur = null;
        for (const it of r.items) { if (/^[\d.:]/.test(it.s)) { if (cur) out.attendance[cur] = (out.attendance[cur] ? out.attendance[cur] + ' ' : '') + it.s; } else cur = it.s; } } }
    const bk = find(/^備考$/);
    if (bk) out.note = rows.filter(r => r.y < bk.y - 1).map(r => r.items.map(i => i.s).join(' ')).filter(s => !/^\(?単位/.test(s)).join('\n').replace(/^- /gm, '');
    if (out.kind === '賞与') { out.title = pm ? `${pm[1]}年${+pm[2]}月 賞与` : '賞与'; out.workMonth = out.workMonth || ''; }
    if (!out.workMonth && out.payMonth && out.kind === '給与') { const [y, m] = out.payMonth.split('-').map(Number); out.workMonth = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; }
    if (out.payMonth) { const [y, m] = out.payMonth.split('-').map(Number); out.payDate = payDay(y, m, 10); out.payDateGuess = true; }
    return out;
  }
};
const PROFILES = [FREEE];

/* 主程式：pages = 各頁的 pdf.js textContent.items */
function parsePayslip(pagesItems) {
  const rows = toRows(pagesItems[0] || []); const text = rows.map(r => r.items.map(i => i.s).join(' ')).join('\n');
  if (!text.trim()) return {ok: false, reason: 'scan', text};
  const prof = PROFILES.find(p => p.detect(text));
  if (!prof) return {ok: false, reason: 'unknown', text};
  const d = prof.parse(rows, text); d.profile = prof.name;
  const sp = Object.values(d.pay).reduce((s, v) => s + v, 0), sd = Object.values(d.deduct).reduce((s, v) => s + v, 0);
  if (!d.gross) d.gross = sp; if (!d.deduction) d.deduction = sd;
  if (sp !== d.gross) d.warn.push(`支給項目合計 ${sp.toLocaleString()} 和「計」${d.gross.toLocaleString()} 不同`);
  if (sd !== d.deduction) d.warn.push(`控除項目合計 ${sd.toLocaleString()} 和「計」${d.deduction.toLocaleString()} 不同`);
  if (d.net && d.gross - d.deduction !== d.net) d.warn.push(`總支給 − 控除 = ${(d.gross - d.deduction).toLocaleString()}，和實領 ${d.net.toLocaleString()} 不同`);
  return {ok: true, data: d, text};
}
const api = {parsePayslip, toRows, norm, payDay, holidays, PROFILES};
if (typeof module !== 'undefined') module.exports = api; else root.PayslipParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
