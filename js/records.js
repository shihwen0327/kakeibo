/* Wen 記帳 v3 — 收支紀錄（留存資料瀏覽、搜尋、每月彙總） */
'use strict';
{
const {S, I, esc, yen} = W;
const R = W.R = {mk: null, cur: 'JPY', q: '', sy: null, scur: 'JPY', skind: 0};
const CURS = [['JPY', '日圓'], ['TWD', '台幣'], ['USD', '美元']];
const amt = r => `${r.cur !== 'JPY' ? `<small>${W.CURSYM[r.cur] || r.cur}</small>` : ''}${W.amt(r.a, r.cur)}`;
const row = (r, date) => `<div class="row" data-r="${esc(r.id)}" role="button" tabindex="0"><div class="mid"><div class="t1">${esc(r.c)}${r.p ? `<span class="sub" style="font-size:13px"> ${esc(r.p)}</span>` : ''}</div>
  <div class="t2">${date ? W.ymd(r.d) + '・' : ''}${esc(r.ac)}${r.m && r.m !== '自己' ? '・' + esc(r.m) : ''}${r.memo ? '・' + esc(r.memo) : ''}</div>${r.tg.length ? `<div class="tg">${r.tg.map(t => `<span class="pill">${esc(t)}</span>`).join('')}</div>` : ''}</div>
  <div class="r"><b class="${r.t ? 'green' : ''}">${amt(r)}</b></div></div>`;
function totals(L) { const o = {}; for (const r of L) { const x = o[r.cur] || (o[r.cur] = {i: 0, e: 0}); if (r.t) x.i += r.a; else x.e += r.a; } return o; }
const totHtml = (o, cur) => { const x = o[cur] || {i: 0, e: 0}; const n = x.i - x.e; return `<div class="g3"><div><small>收入</small><b class="green">${W.amt(x.i, cur)}</b></div><div><small>支出</small><b class="red">${W.amt(x.e, cur)}</b></div><div><small>收支</small><b class="${n < 0 ? 'red' : 'green'}">${W.amt(Math.abs(n), cur)}</b></div></div>`; };
function bindRows(root) { root.querySelectorAll('[data-r]').forEach(el => el.onclick = () => detail(el.dataset.r)); }
function detail(id) {
  const [, r] = W.findRec(id); if (!r) return;
  W.page('push', pg => { pg.in.innerHTML = W.head(W.bx('back', I.back, '返回'), '紀錄內容') + `<div class="hero"><small>${esc(r.t ? '收入' : '支出')}・${esc(r.c)}</small><b class="${r.t ? 'green' : ''}">${W.CURSYM[r.cur] || ''}${W.amt(r.a, r.cur)}</b><span>${W.ymd(r.d)}（${W.wd(r.d)}）</span></div>
    <div class="card"><table class="tbl sm">${[['類別', r.c], ['大類別', r.p || '—'], ['帳戶', r.ac], ['幣別', r.cur], ['成員', r.m], ['標籤', r.tg.join('、') || '—'], ['備註', r.memo || '—'], ['每日家計簿最後更新', r.upd || '—'], ['UUID', r.id]].map(([k, v]) => `<tr><td>${k}</td><td class="n" style="white-space:normal;word-break:break-all">${esc(v)}</td></tr>`).join('')}</table></div>
    <div class="note" style="padding:0 16px">這是從每日家計簿匯入的留存資料。要修改請在每日家計簿改，下個月匯入 CSV 時會自動更新。</div>`;
    pg.in.querySelector('[data-back]').onclick = () => pg.close(); });
}

W.renderRecords = () => {
  if (!R.mk) R.mk = W.monthKey(W.today());
  const [a, b] = W.monthRange(R.mk); const L = S.recs.filter(r => r.d >= a && r.d <= b); const tot = totals(L);
  const curs = CURS.filter(([c]) => c === 'JPY' || tot[c]); if (!curs.some(([c]) => c === R.cur)) R.cur = 'JPY';
  const V = L.filter(r => r.cur === R.cur);
  let h = `<div class="top"><span class="sp"></span><button class="cb" data-s aria-label="搜尋">${I.search}</button><span class="t">收支紀錄</span></div>
    <div class="pnav"><button class="ar" data-m="-1" aria-label="上個月">‹</button><button class="lb" data-today>${R.mk.slice(0, 4)}年${+R.mk.slice(4)}月</button><button class="ar" data-m="1" aria-label="下個月">›</button></div>
    <div class="sub" style="text-align:center;font-size:12px;margin:-6px 0 8px">${W.md(a)}〜${W.md(b)}・${L.length} 筆</div>
    ${curs.length > 1 ? `<div style="display:flex;justify-content:center;padding-bottom:10px">${W.seg('cur', curs, R.cur)}</div>` : ''}${totHtml(tot, R.cur)}`;
  const byD = {}; for (const r of V) (byD[r.d] || (byD[r.d] = [])).push(r);
  const days = Object.keys(byD).sort().reverse();
  if (!days.length) h += '<div class="empty">這個月沒有紀錄</div>';
  for (const d of days) { const x = byD[d]; const e = x.filter(r => !r.t).reduce((s, r) => s + r.a, 0), i = x.filter(r => r.t).reduce((s, r) => s + r.a, 0);
    h += `<div class="dh"><b>${W.md(d)}（${W.wd(d)}）</b><span>${e ? '支出 ' + W.amt(e, R.cur) : ''}${e && i ? '　' : ''}${i ? '收入 ' + W.amt(i, R.cur) : ''}</span></div><div class="list">${x.map(r => row(r)).join('')}</div>`; }
  const app = W.$('#app'); app.innerHTML = h;
  app.querySelectorAll('[data-m]').forEach(x => x.onclick = () => { R.mk = W.shiftKey(R.mk, +x.dataset.m); W.render(); });
  app.querySelector('[data-today]').onclick = () => { R.mk = W.monthKey(W.today()); W.render(); };
  app.querySelectorAll('[data-cur]').forEach(x => x.onclick = () => { R.cur = x.dataset.cur; W.render(); });
  app.querySelector('[data-s]').onclick = openSearch; bindRows(app);
};
function openSearch() {
  W.page('push', pg => {
    if (!pg.in.innerHTML) { pg.in.innerHTML = W.head(W.bx('back', I.back, '返回'), '搜尋') + `<div style="padding:0 16px 10px"><div class="cap" style="width:100%;height:44px;padding:0 14px;gap:8px">${I.search}<input id="sq" placeholder="類別、備註、帳戶、標籤、金額、日期 20261123" autocomplete="off"></div></div><div id="sr"></div>`;
      pg.in.querySelector('[data-back]').onclick = () => pg.close(); const inp = pg.in.querySelector('#sq'); inp.value = R.q; inp.oninput = () => { R.q = inp.value.trim(); draw(); }; setTimeout(() => inp.focus(), 80); }
    draw();
    function draw() { const box = pg.in.querySelector('#sr'); if (!R.q) { box.innerHTML = '<div class="empty">輸入關鍵字，搜尋全部留存紀錄</div>'; return; }
      const ws = R.q.toLowerCase().split(/\s+/); const L = S.recs.filter(r => { const hay = [r.c, r.p, r.memo, r.ac, r.m, r.cur, r.d, String(r.a), ...r.tg].join(' ').toLowerCase(); return ws.every(w => hay.includes(w)); });
      const tot = totals(L); box.innerHTML = `<div class="gh">${L.length} 筆${L.length > 500 ? '（只列出最新 500 筆）' : ''}</div>${Object.keys(tot).map(c => `<div class="gh" style="padding-top:0">${c}：支出 ${W.amt(tot[c].e, c)}・收入 ${W.amt(tot[c].i, c)}</div>`).join('')}<div class="list">${L.slice(0, 500).map(r => row(r, true)).join('')}</div>`; bindRows(box); }
  });
}

/* ---- 每月彙總 ---- */
W.renderSummary = () => {
  const years = [...new Set(S.recs.map(r => W.monthKey(r.d).slice(0, 4)))].sort(); if (!R.sy) R.sy = W.monthKey(W.today()).slice(0, 4);
  const ks = []; for (let m = 1; m <= 12; m++) ks.push(`${R.sy}${W.pad(m)}`);
  const L = S.recs.filter(r => r.cur === R.scur && r.t === R.skind && ks.includes(W.monthKey(r.d)));
  const has = c => S.recs.some(r => r.cur === c && W.monthKey(r.d).startsWith(R.sy));
  const curs = CURS.filter(([c]) => c === R.scur || has(c));
  const grid = {}, gpar = {}; for (const r of L) { const g = r.p || r.c; const k = W.monthKey(r.d); ((grid[g] || (grid[g] = {}))[r.c] || (grid[g][r.c] = {}))[k] = ((grid[g][r.c] || {})[k] || 0) + r.a; gpar[g] = !!r.p; }
  const colTot = k => L.filter(r => W.monthKey(r.d) === k).reduce((s, r) => s + r.a, 0);
  const sumO = o => Object.values(o).reduce((s, v) => s + v, 0);
  const groups = Object.keys(grid).map(g => { const cats = Object.keys(grid[g]).map(c => ({c, m: grid[g][c], t: sumO(grid[g][c])})).sort((a, b) => b.t - a.t); const m = {}; for (const c of cats) for (const k in c.m) m[k] = (m[k] || 0) + c.m[k]; return {g, par: gpar[g], cats, m, t: sumO(m)}; }).sort((a, b) => b.t - a.t);
  const total = L.reduce((s, r) => s + r.a, 0); const nonEmpty = ks.filter(k => colTot(k)).length || 1;
  const yi = years.indexOf(R.sy); const f = v => v ? W.amt(v, R.scur) : '';
  let h = `<div class="top"><span class="t">每月彙總</span></div>
    <div class="pnav"><button class="ar" data-y="${years[yi - 1] || ''}" ${yi > 0 ? '' : 'disabled'} aria-label="前一年">‹</button><span class="lb">${R.sy} 年</span><button class="ar" data-y="${years[yi + 1] || ''}" ${yi >= 0 && yi < years.length - 1 ? '' : 'disabled'} aria-label="後一年">›</button></div>
    <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;padding-bottom:10px">${W.seg('kind', [[0, '支出'], [1, '收入']], R.skind)}${curs.length > 1 ? W.seg('scur', curs, R.scur) : ''}</div>
    <div class="g3"><div><small>全年${R.skind ? '收入' : '支出'}</small><b class="${R.skind ? 'green' : 'red'}">${W.amt(total, R.scur)}</b></div><div><small>月平均（${nonEmpty} 個月）</small><b>${W.amt(total / nonEmpty, R.scur)}</b></div><div><small>筆數</small><b>${L.length}</b></div></div>
    <div class="card"><div class="fig" id="sumFig" style="height:200px"></div></div>
    <div class="note" style="padding:4px 16px 8px">${S.meta.settings.monthStart === 1 ? '月份＝日曆月' : `月份＝每月 ${S.meta.settings.monthStart} 日到下個月 ${S.meta.settings.monthStart - 1} 日`}。點金額可以看明細。</div>
    <div class="scroll"><table class="tbl mt sum"><thead><tr><th class="st">類別</th>${ks.map(k => `<th class="n">${+k.slice(4)}月</th>`).join('')}<th class="n">合計</th><th class="n">月平均</th></tr></thead><tbody>`;
  for (const G of groups) {
    h += `<tr class="${G.par ? 'pr' : ''}"><td class="st">${esc(G.g)}</td>${ks.map(k => `<td class="n" data-cell="${esc(G.g)}||${k}">${f(G.m[k])}</td>`).join('')}<td class="n"><b>${f(G.t)}</b></td><td class="n">${f(G.t / nonEmpty)}</td></tr>`;
    if (G.par) for (const c of G.cats) h += `<tr class="cr"><td class="st">　${esc(c.c)}</td>${ks.map(k => `<td class="n" data-cell="${esc(G.g)}|${esc(c.c)}|${k}">${f(c.m[k])}</td>`).join('')}<td class="n">${f(c.t)}</td><td class="n">${f(c.t / nonEmpty)}</td></tr>`;
  }
  if (!groups.length) h += `<tr><td colspan="15" class="empty" style="padding:40px">這一年沒有紀錄</td></tr>`;
  h += `</tbody><tfoot><tr><td class="st">合計</td>${ks.map(k => `<td class="n">${f(colTot(k))}</td>`).join('')}<td class="n">${f(total)}</td><td class="n">${f(total / nonEmpty)}</td></tr></tfoot></table></div><div style="height:20px"></div>`;
  const app = W.$('#app'); app.innerHTML = h;
  W.barChart(app.querySelector('#sumFig'), ks.map(k => `${+k.slice(4)}月`), [{name: R.skind ? '收入' : '支出', color: R.skind ? '#4cc760' : '#e8493c', vals: ks.map(colTot)}]);
  app.querySelectorAll('[data-y]').forEach(x => x.onclick = () => { if (x.dataset.y) { R.sy = x.dataset.y; W.render(); } });
  app.querySelectorAll('[data-kind]').forEach(x => x.onclick = () => { R.skind = +x.dataset.kind; W.render(); });
  app.querySelectorAll('[data-scur]').forEach(x => x.onclick = () => { R.scur = x.dataset.scur; W.render(); });
  app.querySelectorAll('[data-cell]').forEach(td => { if (!td.textContent) return; td.classList.add('tap'); td.onclick = () => { const [g, c, k] = td.dataset.cell.split('|'); const [a, b] = W.monthRange(k);
    const M = L.filter(r => (r.p || r.c) === g && (!c || r.c === c) && r.d >= a && r.d <= b);
    W.page('push', pg => { pg.in.innerHTML = W.head(W.bx('back', I.back, '返回'), `${c || g}・${+k.slice(4)}月`) + `<div class="gh">${M.length} 筆・合計 ${W.amt(M.reduce((s, r) => s + r.a, 0), R.scur)}</div><div class="list">${M.map(r => row(r, true)).join('')}</div>`; pg.in.querySelector('[data-back]').onclick = () => pg.close(); bindRows(pg.in); }); }; });
};
}
