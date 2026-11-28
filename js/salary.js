/* Wen 記帳 v3 — 薪資明細 */
'use strict';
{
const {S, I, esc, yen} = W;
const U = W.U = {tab: 'pay', year: null};
const sum = o => Object.values(o || {}).reduce((s, v) => s + (+v || 0), 0);
const label = p => p.kind === '賞与' ? (p.title || `${p.payDate.slice(0, 4)} 賞与`) : `${p.workMonth ? `${+p.workMonth.slice(5, 7)}月分` : ''}`;

const short = c => String(c || '').replace(/（.*?）/, '').replace(/株式会社\s*/, '').trim();
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const MM = p => p.payDate.slice(5, 7);
const slipName = p => p.kind === '賞与' ? (p.title || '賞与') : (label(p) || '給与');
const OV = {net: ['實領', p => +p.net || 0], ded: ['控除', p => +p.deduction || 0], soc: ['社保', p => W.split(p).social], tax: ['稅金', p => { const x = W.split(p); return x.itax + x.rtax; }]};
const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
W.renderSalary = () => {
  const all = W.slips(); const years = [...new Set([...all.map(p => p.payDate.slice(0, 4)), ...W.gensen().map(g => String(g.year))])].sort();
  if (!U.year) U.year = years.at(-1) || String(new Date().getFullYear());
  if (!U.sub) U.sub = 'ov';
  const L = all.filter(p => p.payDate.startsWith(U.year));
  const tot = {gross: 0, bonus: 0};
  for (const p of L) { tot.gross += +p.gross; if (p.kind === '賞与') tot.bonus += +p.gross; }
  const yi = years.indexOf(U.year);
  const cos = []; for (const p of L.slice().reverse()) if (!cos.includes(p.company)) cos.push(p.company);
  let h = `<div class="top"><span class="sp"></span><button class="cb" data-add aria-label="新增">${I.plus}</button><span class="t">薪資</span></div>`;
  if (S.offline) h += `<div class="banner">${esc(S.offline)}</div>`;
  if (U.sub !== 'ls') h += `<div class="pnav"><button class="ar" data-y="${years[yi - 1] || ''}" ${yi > 0 ? '' : 'disabled'} aria-label="前一年">‹</button><span class="lb nolb">${U.year} 年<small>（${W.reiwa(+U.year)}）</small></span><button class="ar" data-y="${years[yi + 1] || ''}" ${yi >= 0 && yi < years.length - 1 ? '' : 'disabled'} aria-label="後一年">›</button></div>`;
  h += `<div class="segc" role="tablist">${[['ov', '總覽'], ['ls', '明細'], ['tx', '稅金']].map(([k, t]) => `<button role="tab" data-sub="${k}" class="${U.sub === k ? 'on' : ''}" aria-selected="${U.sub === k}">${t}</button>`).join('')}</div>`;

  if (U.sub === 'ov') {
    const tv = k => L.reduce((s, p) => s + OV[k][1](p), 0);
    h += `<div class="card hero2"><small>${U.year} 年總支給（依支払日）</small><b class="num">¥${yen(tot.gross)}</b>
      <div class="h2r">${['net', 'ded', 'soc', 'tax'].map(k => `<button class="h2b${U.ov === k ? ' on' : ''}" data-ov="${k}" aria-pressed="${U.ov === k}"><small>${OV[k][0]} <i class="cv">▾</i></small><span class="num${k === 'net' ? ' green' : ''}">¥${yen(tv(k))}</span></button>`).join('')}</div>${tot.bonus ? `<div class="note" style="margin-top:6px">其中賞与 ¥${yen(tot.bonus)}</div>` : ''}${L.length && !U.ov ? `<div class="note" style="margin-top:6px">點實領／控除／社保／稅金看每個月的金額</div>` : ''}</div>`;
    if (U.ov && L.length) h += monthList(L);
    if (L.length) h += `<div class="card"><div class="ch"><b>每月總支給與實領</b></div><div class="fig" id="payFig"></div>${W.legend([['總支給', '#8e8e93'], ['實領', '#4cc760'], ['控除（右軸）', '#f2a33a']])}</div>`;
    if (cos.length) h += `<div class="sec">各公司</div><div class="lst">${cos.map(c => { const Q = L.filter(p => p.company === c); const g = Q.reduce((a, p) => a + +p.gross, 0), n = Q.reduce((a, p) => a + +p.net, 0);
      return `<button class="li" data-co="${esc(c)}"><span class="l"><b>${esc(short(c))}</b><small>${Q.length} 份・${md(Q[0].payDate)}〜${md(Q.at(-1).payDate)} 支払</small></span><span class="r"><b class="num">${yen(g)}</b><small class="green num">實領 ${yen(n)}</small></span><span class="chev">›</span></button>`; }).join('')}</div>`;
    else h += `<div class="empty" style="padding:60px 16px">這一年沒有薪資單</div>`;
  }

  if (U.sub === 'ls') {
    const grid = U.view === 'grid';
    if (U.co && !cos.includes(U.co)) U.co = '';
    const LC = U.co ? L.filter(p => p.company === U.co) : L;
    const ms = [...new Set(LC.map(MM))].sort();
    if (U.fm && !ms.includes(U.fm)) U.fm = undefined;
    const fm = U.fm === undefined ? (ms.at(-1) || '') : U.fm;
    if (U.to && (!fm || U.to <= fm || !ms.includes(U.to))) U.to = '';
    const to = U.to || '', one = grid && fm && !to;
    const inR = p => !grid || !fm || (to ? MM(p) >= fm && MM(p) <= to : MM(p) === fm);
    h += `<div class="segc sm">${[['list', '清單'], ['grid', '逐項表']].map(([k, t]) => `<button data-view="${k}" class="${(grid ? 'grid' : 'list') === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    h += `<div class="flt"><label><span>年份</span><select data-f="year">${(years.length ? years : [U.year]).slice().reverse().map(y => opt(y, `${y} 年`, U.year)).join('')}</select></label>
      <label><span>公司</span><select data-f="co">${opt('', '全部公司', U.co || '')}${cos.map(c => opt(c, short(c), U.co)).join('')}</select></label>
      ${grid ? `<label><span>從（支払月）</span><select data-f="fm">${opt('', '全年', fm)}${ms.map(m => opt(m, `${+m} 月`, fm)).join('')}</select></label>
      <label><span>到</span><select data-f="to"${fm ? '' : ' disabled'}>${opt('', fm ? '（只看這個月）' : '—', to)}${ms.filter(m => fm && m > fm).map(m => opt(m, `${+m} 月`, to)).join('')}</select></label>` : ''}</div>`;
    const R0 = LC.filter(inR);
    if (!L.length) h += `<div class="empty" style="padding:60px 16px">這一年沒有薪資單</div>`;
    else if (!R0.length) h += `<div class="empty" style="padding:60px 16px">這段期間沒有薪資單</div>`;
    else if (one) {
      for (const p of R0.slice().reverse()) h += `<div class="sec">${esc(short(p.company))}・${esc(slipName(p))}<span class="secr num">${md(p.payDate)} 支払</span></div>${slipDetail(p)}<div class="bb"><button class="pb lnk" data-ps="${esc(p.id)}">${I.doc}<span>開啟（編輯・PDF）</span></button></div>`;
    } else for (const co of (U.co ? [U.co] : cos)) {
      const Q = R0.filter(p => p.company === co), R = Q.slice().reverse(); if (!Q.length) continue;
      h += `<div class="sec">${esc(short(co))}<span class="secr num">${grid && fm ? `${+fm}〜${+to} 月` : `${U.year} 年`} ${Q.length} 份</span></div>`;
      if (!grid) {
        const oth = all.filter(p => p.company === co && !p.payDate.startsWith(U.year)); const oy = [...new Set(oth.map(p => p.payDate.slice(0, 4)))].sort().reverse();
        if (oth.length) h += `<div class="othy">其他 ${oth.length} 份在 ${oy.map(y => `<button class="lk" data-y="${y}">${y} 年</button>`).join('、')}</div>`;
        h += `<div class="lst">${R.map(p => { const w = W.checkSlip(p).length;
          return `<button class="li" data-ps="${esc(p.id)}"><span class="l"><b>${p.kind === '賞与' ? '<span class="tagb">賞与</span> ' + esc(p.title || '') : esc(label(p))}${w ? ' <span class="red">⚠</span>' : ''}</b><small>${md(p.payDate)} 支払・總 <span class="num">${yen(p.gross)}</span>・扣 <span class="num">${yen(p.deduction)}</span></small></span><span class="r"><b class="green num">${yen(p.net)}</b><small>實領</small></span><span class="chev">›</span></button>`; }).join('')}</div>`;
      } else {
        const cols = key => { const o = []; for (const p of R) for (const k of Object.keys(p[key] || {})) if (!o.includes(k) && Q.some(q => +(q[key] || {})[k])) o.push(k); return o; };
        const PC = cols('pay'), DC = cols('deduct');
        const sm = f => Q.reduce((t, p) => t + (+f(p) || 0), 0);
        const cell = (o, k) => { const v = (o || {})[k]; return `<td class="n">${v == null || v === '' ? '<span class="dim">—</span>' : yen(v)}</td>`; };
        h += `<div class="scroll grid"><table class="tbl mt dt"><thead>
          <tr class="grp"><th></th><th class="n gp" colspan="${PC.length + 1}">支給</th><th class="n gd" colspan="${DC.length + 1}">控除</th><th></th></tr>
          <tr><th>月分</th>${PC.map(k => `<th class="n">${esc(k)}</th>`).join('')}<th class="n">總支給額</th>${DC.map(k => `<th class="n">${esc(k)}</th>`).join('')}<th class="n">控除合計</th><th class="n">差引支給額</th></tr></thead><tbody>`;
        for (const p of R) h += `<tr data-ps="${esc(p.id)}" tabindex="0"><td>${p.kind === '賞与' ? '<span class="tagb">賞与</span>' : esc(label(p))}<div class="co">${md(p.payDate)}</div></td>${PC.map(k => cell(p.pay, k)).join('')}<td class="n b">${yen(p.gross)}</td>${DC.map(k => cell(p.deduct, k)).join('')}<td class="n b">${yen(p.deduction)}</td><td class="n green b">${yen(p.net)}</td></tr>`;
        h += `</tbody><tfoot><tr><td>合計</td>${PC.map(k => `<td class="n">${yen(sm(p => (p.pay || {})[k]))}</td>`).join('')}<td class="n">${yen(sm(p => p.gross))}</td>${DC.map(k => `<td class="n">${yen(sm(p => (p.deduct || {})[k]))}</td>`).join('')}<td class="n">${yen(sm(p => p.deduction))}</td><td class="n green">${yen(sm(p => p.net))}</td></tr></tfoot></table></div>`;
      }
    }
    if (grid && !one && R0.length) h += `<div class="note" style="padding:8px 16px">項目照各公司薪資單；「—」表示那張沒有這個項目。表格可以左右滑動。</div>`;
  }

  if (U.sub === 'tx') {
    h += taxCards(+U.year);
    const G = W.gensen().filter(g => String(g.year) === U.year);
    if (G.length) h += `<div class="sec">源泉徴収票</div>`;
    for (const g of G) { const f = g.fields || {};
      if (g.sep) { h += `<div class="card"><div class="ch"><b>${esc(short(g.company))}<span class="tagb" style="margin-left:6px">另計</span></b><button class="lk" data-ps="${esc(g.id)}">查看 ›</button></div><table class="tbl sm tx">${Object.entries(f).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${yen(v)}</td></tr>`).join('')}</table>${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}</div>`; continue; }
      const co = L.filter(p => p.company === g.company); const s2 = co.reduce((a, p) => { const x = W.split(p); a.gross += +p.gross; a.social += x.social; a.itax += x.itax; return a; }, {gross: 0, social: 0, itax: 0});
      const rowc = (k, a, b) => { const ok = a == null || a === b; return `<tr><td>${k}</td><td class="n">${a == null ? '—' : yen(a)}</td><td class="n">${yen(b)}</td><td class="n ${ok ? 'green' : 'red'}">${a == null ? '' : ok ? '✓' : (b - a > 0 ? '+' : '') + yen(b - a)}</td></tr>`; };
      h += `<div class="card"><div class="ch"><b>${esc(short(g.company))}</b><button class="lk" data-ps="${esc(g.id)}">查看 ›</button></div>
        <table class="tbl sm tx tx4"><thead><tr><th></th><th class="n">源泉徴収票</th><th class="n">薪資單合計</th><th class="n">差</th></tr></thead><tbody>${rowc('支払金額', f['支払金額'], s2.gross)}${rowc('社会保険料', f['社会保険料等の金額'], s2.social)}${rowc('源泉徴収税額', f['源泉徴収税額'], s2.itax)}</tbody></table>${g.note ? `<div class="note">${esc(g.note)}</div>` : ''}</div>`; }
    if (!h.includes('class="card')) h += `<div class="empty" style="padding:60px 16px">這一年沒有稅金資料</div>`;
  }

  const app = W.$('#app'); app.innerHTML = h;
  const fig = app.querySelector('#payFig');
  if (fig) { const ym = []; for (let m = 1; m <= 12; m++) ym.push(`${U.year}-${W.pad(m)}`);
    const by = m => L.filter(p => p.payDate.slice(0, 7) === m);
    W.barChart(fig, ym.map(m => `${+m.slice(5)}`), [{name: '總支給', color: '#8e8e93', vals: ym.map(m => by(m).reduce((s, p) => s + +p.gross, 0))}, {name: '實領', color: '#4cc760', vals: ym.map(m => by(m).reduce((s, p) => s + +p.net, 0))}],
      {line: {color: '#f2a33a', vals: ym.map(m => by(m).reduce((s, p) => s + (+p.deduction || 0), 0))}}); }
  app.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { if (b.dataset.y) { U.year = b.dataset.y; U.ovOpen = null; U.fm = undefined; U.to = ''; W.render(); } });
  app.querySelectorAll('[data-ov]').forEach(b => b.onclick = () => { U.ov = U.ov === b.dataset.ov ? null : b.dataset.ov; U.ovOpen = null; W.render(); });
  app.querySelectorAll('[data-om]').forEach(b => b.onclick = () => { U.ovOpen = U.ovOpen === b.dataset.om ? null : b.dataset.om; W.render(); });
  app.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { const f = s.dataset.f, v = s.value;
    if (f === 'year') { U.year = v; U.fm = undefined; U.to = ''; } else if (f === 'co') { U.co = v; U.fm = undefined; U.to = ''; } else if (f === 'fm') { U.fm = v; U.to = ''; } else U.to = v;
    W.render(); });
  app.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { U.sub = b.dataset.sub; W.render(); window.scrollTo(0, 0); });
  app.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { U.view = b.dataset.view; W.render(); });
  app.querySelectorAll('[data-co]').forEach(b => b.onclick = () => { U.sub = 'ls'; U.co = b.dataset.co; U.fm = undefined; U.to = ''; W.render(); window.scrollTo(0, 0); });
  app.querySelectorAll('[data-ps]').forEach(r => r.onclick = () => openSlip(r.dataset.ps));
  const aj = app.querySelector('[data-addj]'); if (aj) aj.onclick = () => editJumin(null);
  app.querySelector('[data-add]').onclick = e => W.popover(e.currentTarget, [{t: '上傳薪資單 PDF', icon: I.up, f: () => upload('slip')}, {t: '上傳源泉徴収票 PDF', icon: I.up, f: () => upload('gensen')}, {t: '手動新增薪資單', icon: I.pen, f: () => editSlip(null)}, {t: '手動新增源泉徴収票', icon: I.pen, f: () => editGensen(null)}, {t: '新增住民税（自繳）', icon: I.pen, f: () => editJumin(null)}]);
};

/* 總覽：實領／控除／稅金 每月清單，點月份展開細項 */
function monthList(L) {
  const [name, f] = OV[U.ov]; const by = {}; for (const p of L) (by[MM(p)] = by[MM(p)] || []).push(p);
  let h = `<div class="sec">${name}・每月（依支払日）<span class="secr num">合計 ¥${yen(L.reduce((s, p) => s + f(p), 0))}</span></div><div class="lst">`;
  for (const m of Object.keys(by).sort()) { const Q = by[m], open = U.ovOpen === m;
    h += `<button class="li" data-om="${m}" aria-expanded="${open}"><span class="l"><b>${+m} 月</b><small>${Q.map(p => esc(slipName(p))).join('・')}</small></span><span class="r"><b class="num${U.ov === 'net' ? ' green' : ''}">${yen(Q.reduce((s, p) => s + f(p), 0))}</b></span><span class="chev${open ? ' op' : ''}">›</span></button>`;
    if (open) h += `<div class="mx">${Q.map(monthDetail).join('')}</div>`; }
  h += '</div>';
  if (U.ov === 'soc') h += `<div class="note" style="padding:0 20px 4px">社保＝健康保険（含介護保険）、厚生年金、雇用保険等社会保険料。</div>`;
  if (U.ov === 'tax') h += `<div class="note" style="padding:0 20px 4px">稅金＝薪資單上扣的所得税（含年末調整）＋住民税（特別徴収）。<button class="lk" data-sub="tx">所得税試算・住民税 ›</button></div>`;
  return h;
}
function monthDetail(p) {
  const rows = (o, keep, cls = '') => Object.entries(o || {}).filter(([k, v]) => +v && (!keep || keep(k))).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n ${cls}">${yen(v)}</td></tr>`).join('');
  let t;
  if (U.ov === 'net') t = `${rows(p.pay)}<tr class="tt"><td>總支給額</td><td class="n">${yen(p.gross)}</td></tr><tr><td>控除合計</td><td class="n red">−${yen(p.deduction)}</td></tr><tr class="tt"><td>實領</td><td class="n green">${yen(p.net)}</td></tr>`;
  else if (U.ov === 'ded') t = `${rows(p.deduct, null, 'red')}<tr class="tt"><td>控除合計</td><td class="n red">${yen(p.deduction)}</td></tr>`;
  else if (U.ov === 'soc') t = `${rows(p.deduct, W.isSocial) || '<tr><td class="sub">這份沒有扣社保</td><td></td></tr>'}<tr class="tt"><td>社保合計</td><td class="n">${yen(OV.soc[1](p))}</td></tr>`;
  else t = `${rows(p.deduct, W.isTax) || '<tr><td class="sub">這份沒有扣稅</td><td></td></tr>'}<tr class="tt"><td>稅金合計</td><td class="n">${yen(OV.tax[1](p))}</td></tr>`;
  return `<div class="mxh"><span>${esc(slipName(p))}・${esc(short(p.company))}・${md(p.payDate)} 支払</span><button class="lk" data-ps="${esc(p.id)}">完整明細 ›</button></div><table class="tbl sm">${t}</table>`;
}
/* 一份薪資單的細項（明細頁單月、薪資單頁共用） */
function slipDetail(p) {
  const w = W.checkSlip(p);
  const tbl = (o, cls) => Object.entries(o || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n ${cls || ''}">${yen(v)}</td></tr>`).join('');
  return `${w.length ? `<div class="banner">${w.map(esc).join('<br>')}</div>` : ''}
    <div class="g4 c3"><div><small>總支給</small><b>${yen(p.gross)}</b></div><div><small>控除合計</small><b>${yen(p.deduction)}</b></div><div><small>實領</small><b class="green">${yen(p.net)}</b></div></div>
    <div class="sec">支給</div><div class="card"><table class="tbl sm">${tbl(p.pay)}<tr class="tt"><td>總支給額</td><td class="n">${yen(p.gross)}</td></tr></table></div>
    <div class="sec">控除</div><div class="card"><table class="tbl sm">${tbl(p.deduct, 'red')}<tr class="tt"><td>控除合計</td><td class="n red">${yen(p.deduction)}</td></tr></table></div>
    ${Object.keys(p.attendance || {}).length ? `<div class="sec">勤怠</div><div class="card"><table class="tbl sm">${Object.entries(p.attendance).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(v)}</td></tr>`).join('')}</table></div>` : ''}
    ${p.note ? `<div class="note" style="padding:0 16px">${esc(p.note)}</div>` : ''}`;
}

function taxCards(y) {
  const t = W.taxYear(y); let h = '';
  if (t.inc) {
    const rr = t.rows.map(r => `<tr><td>${esc(r.company.replace(/（.*?）/, '').replace(/株式会社\s*/, ''))}<div class="co">${r.src}${r.est ? `＋推估 ${r.est} 個月` : ''}</div></td><td class="n">${yen(r.inc)}</td><td class="n">${yen(r.soc)}</td><td class="n">${yen(r.wh)}</td></tr>`).join('');
    const d = t.diff;
    h += `<div class="sec">所得税試算</div><div class="card">
      <table class="tbl sm tx tx4"><thead><tr><th></th><th class="n">給与收入</th><th class="n">社保</th><th class="n">已扣稅</th></tr></thead><tbody>${rr}</tbody>
      <tfoot><tr><td>合計</td><td class="n">${yen(t.inc)}</td><td class="n">${yen(t.soc)}</td><td class="n">${yen(t.wh)}</td></tr></tfoot></table>
      <table class="tbl sm tx" style="margin-top:8px"><tr><td>給与所得（扣給与所得控除後）</td><td class="n">${yen(t.kyu)}</td></tr><tr><td>減 社会保険料</td><td class="n">${yen(t.soc)}</td></tr><tr><td>減 基礎控除</td><td class="n">${yen(t.kiso)}</td></tr>
      <tr><td>課税所得</td><td class="n">${yen(t.taxable)}</td></tr>${t.teigaku ? `<tr><td>減 定額減税</td><td class="n">${yen(t.teigaku)}</td></tr>` : ''}<tr><td>全年應繳（含復興特別所得税）</td><td class="n">${yen(t.total)}</td></tr><tr><td>已扣</td><td class="n">${yen(t.wh)}</td></tr>
      </table><div class="bigr"><span>${d >= 0 ? '預估可退' : '預估要補'}</span><b class="num ${d >= 0 ? 'green' : 'red'}">¥${yen(Math.abs(d))}</b></div>
      <div class="note">未計生命保険料、医療費、iDeCo、ふるさと納税等其他扣除；非課稅通勤手当、宿直手当非課稅部分不算收入。${t.est ? `還沒拿到的 ${t.est} 個月用最後一張薪資單推估。` : ''}僅供參考，以確定申告／年末調整為準。</div></div>`;
  }
  const paid = W.juminPaid(y), cur = W.juminEst(y), nxt = W.juminEst(y + 1);
  if (paid.items.length || cur || nxt) {
    h += `<div class="sec">住民税<button class="lk secr" data-addj>＋ 自繳紀錄</button></div><div class="card">
      <div class="sub" style="font-size:13px;margin-bottom:4px">${y} 年度（${y}/6〜${y + 1}/5，依 ${y - 1} 年收入）</div>
      <table class="tbl sm tx tj">${paid.items.map(i => `<tr ${i.kind === '普通徴収' ? `data-ps="${esc(i.id)}" tabindex="0"` : ''}><td>${+i.d.slice(5, 7)}/${+i.d.slice(8, 10)}${i.d.slice(0, 4) != y ? `<span class="co"> ${i.d.slice(0, 4)}</span>` : ''}</td><td>${i.kind}${i.note ? `<div class="co">${esc(i.note)}</div>` : ''}</td><td class="n">${yen(i.amt)}</td></tr>`).join('') || '<tr><td colspan="3" class="sub">沒有紀錄</td></tr>'}
      <tr class="tt"><td colspan="2">已繳合計</td><td class="n">${yen(paid.total)}</td></tr>${cur ? `<tr><td colspan="2">試算全年（參考）</td><td class="n">約 ${yen(cur.total)}</td></tr>` : ''}</table>
      ${nxt ? `<div class="sub" style="font-size:13px;margin:12px 0 4px">${y + 1} 年度試算（${y + 1}/6〜${y + 2}/5，依 ${y} 年收入${nxt.est ? '，含推估' : ''}）</div>
      <table class="tbl sm tx"><tr><td>課稅所得（給与所得−社保−43 萬）</td><td class="n">${yen(nxt.taxable)}</td></tr><tr><td>所得割 10%（減調整控除 2,500）</td><td class="n">${yen(nxt.shotoku)}</td></tr><tr><td>均等割</td><td class="n">${yen(nxt.kinto)}</td></tr>
      <tr class="tt"><td>全年約</td><td class="n">${yen(nxt.total)}</td></tr><tr><td>每月約（特別徴収 12 期）</td><td class="n">${yen(nxt.monthly)}</td></tr>${cur ? `<tr><td>比 ${y} 年度試算</td><td class="n ${nxt.total > cur.total ? 'red' : 'green'}">${nxt.total >= cur.total ? '+' : '−'}${yen(Math.abs(nxt.total - cur.total))}</td></tr>` : ''}</table>` : ''}
      <div class="note">住民税的基礎控除是 43 萬（沒跟所得税一起調高）。均等割以約 5,500 計，實際以住民税決定通知書為準。</div></div>`;
  }
  return h;
}
function editJumin(src) {
  const p = src ? W.clone(src) : {id: 'jumin-' + W.uid().slice(0, 8), kind: '住民税', payDate: W.today().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), amount: '', fiscal: '', note: '', gross: 0};
  W.page('modal', pg => {
    pg.in.innerHTML = W.head(W.bx('x', I.x, '取消'), '住民税（自繳）', '<button class="pb" data-ok>儲存</button>') +
      `<div class="fc"><label class="fr"><span class="k">繳納日</span><input id="jd" type="date" value="${esc(p.payDate)}"></label><label class="fr"><span class="k">金額</span><input id="ja" inputmode="numeric" value="${esc(p.amount)}"></label><label class="fr"><span class="k">年度</span><input id="jf" inputmode="numeric" placeholder="不填＝依繳納日" value="${esc(p.fiscal || '')}"></label></div>
      <div class="sec">備註</div><div class="fc memo"><textarea id="jn" rows="2" placeholder="例：2026 年度 1 期">${esc(p.note || '')}</textarea></div>${src ? '<div class="bb"><button class="pb" data-del style="color:var(--red)">刪除</button></div>' : ''}`;
    const g = q => pg.in.querySelector(q);
    g('[data-x]').onclick = () => pg.close();
    if (g('[data-del]')) g('[data-del]').onclick = () => W.confirm('刪除這筆住民税紀錄？', '', '刪除', () => { W.delSlip(p.id); pg.close(); W.render(); });
    g('[data-ok]').onclick = () => { p.payDate = g('#jd').value; p.amount = +String(g('#ja').value).replace(/[^\d]/g, '') || 0; const f = g('#jf').value.trim(); p.fiscal = f; p.note = g('#jn').value.trim();
      if (!p.payDate) return W.toast('請填繳納日'); if (!p.amount) return W.toast('請填金額'); if (f && !/^\d{4}$/.test(f)) return W.toast('年度請填西元年，例如 2026');
      W.putSlip(p); pg.close(); W.render(); W.toast('已儲存'); };
  });
}

function pdfLink(p) { return p.pdf ? `<a class="pb lnk" href="${esc(W.fileUrl(p.pdf))}" target="_blank" rel="noopener">${I.doc}<span>原始 PDF</span></a>` : ''; }
function openSlip(id) {
  if (S.ps[id] && S.ps[id].kind === '住民税') return editJumin(S.ps[id]);
  W.page('push', pg => {
    const p = S.ps[id]; if (!p) return pg.close();
    if (p.kind === '源泉徴収票') {
      pg.in.innerHTML = W.head(W.bx('back', I.back, '返回'), `${p.year} 年 源泉徴収票`, '<button class="pb" data-ed>編輯</button>') + `<div class="card"><div class="sub">${esc(p.company)}</div>
        <table class="tbl sm">${Object.entries(p.fields || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${yen(v)}</td></tr>`).join('')}</table>${p.note ? `<div class="note">${esc(p.note)}</div>` : ''}</div><div class="bb">${pdfLink(p)}<button class="pb" data-del style="color:var(--red)">刪除</button></div>`;
    } else {
      pg.in.innerHTML = W.head(W.bx('back', I.back, '返回'), p.kind === '賞与' ? '賞与明細' : '薪資明細', '<button class="pb" data-ed>編輯</button>') +
        `<div class="hero" style="padding-top:4px"><small>${esc(p.company)}</small><b class="green">¥${yen(p.net)}</b><span>實領・${W.ymd(p.payDate.replace(/-/g, ''))} 支払${p.workMonth && p.kind !== '賞与' ? `・${p.workMonth.replace('-', '年')}月分` : ''}</span></div>
        ${slipDetail(p)}<div class="bb">${pdfLink(p)}<button class="pb" data-del style="color:var(--red)">刪除</button></div>`;
    }
    pg.in.querySelector('[data-back]').onclick = () => pg.close();
    pg.in.querySelector('[data-ed]').onclick = () => p.kind === '源泉徴収票' ? editGensen(p) : editSlip(p);
    pg.in.querySelector('[data-del]').onclick = () => W.confirm('刪除這份紀錄？', '刪除後無法復原（原始 PDF 檔案會保留）。', '刪除', () => { W.delSlip(id); pg.close(); W.render(); });
  });
}

/* ---- 編輯（也用在 PDF 判讀後的確認） ---- */
function kvRows(name, o) { return Object.entries(o).map(([k, v], i) => `<div class="kv" data-g="${name}"><input class="k" value="${esc(k)}" aria-label="項目名稱"><input class="v" inputmode="numeric" value="${esc(v)}" aria-label="金額"><button class="rm" data-rm aria-label="刪除這一列">×</button></div>`).join('') + `<button class="addrow" data-addrow="${name}">＋ 新增一列</button>`; }
function readKv(root, name) { const o = {}; root.querySelectorAll(`.kv[data-g="${name}"]`).forEach(r => { const k = r.querySelector('.k').value.trim(); const v = r.querySelector('.v').value.replace(/[,，\s]/g, ''); if (k) o[k] = name === 'attendance' ? v : (Math.round(+v) || 0); }); return o; }
function editSlip(src, opts = {}) {
  const p = src ? W.clone(src) : {id: 'payslip-' + W.uid().slice(0, 8), kind: '給与', company: W.slips().at(-1)?.company || '', workMonth: '', payDate: '', pay: {}, deduct: {}, attendance: {}, gross: 0, deduction: 0, net: 0, note: ''};
  W.page('modal', pg => {
    pg.in.innerHTML = W.head(W.bx('x', I.x, '取消'), opts.title || (src ? '編輯薪資單' : '新增薪資單'), '<button class="pb" data-ok>儲存</button>') +
      (opts.msg ? `<div class="banner ${opts.ok ? 'okb' : ''}">${esc(opts.msg)}</div>` : '') +
      `<div class="fc"><label class="fr"><span class="k">種類</span><select id="sk"><option ${p.kind === '給与' ? 'selected' : ''}>給与</option><option ${p.kind === '賞与' ? 'selected' : ''}>賞与</option></select></label>
      <label class="fr"><span class="k">公司</span><input id="sc" value="${esc(p.company)}"></label>
      <label class="fr"><span class="k">勤務月</span><input id="sw" type="month" value="${esc(p.workMonth)}"></label>
      <label class="fr"><span class="k">支払日</span><input id="sd" type="date" value="${esc(p.payDate)}"></label>
      ${p.kind === '賞与' ? `<label class="fr"><span class="k">標題</span><input id="st" value="${esc(p.title || '')}" placeholder="例：2026年上期 賞与"></label>` : ''}</div>
      <div class="sec">支給</div><div class="fc kvs" id="gPay">${kvRows('pay', p.pay)}</div>
      <div class="sec">控除</div><div class="fc kvs" id="gDed">${kvRows('deduct', p.deduct)}</div>
      <div class="sec">勤怠（選填）</div><div class="fc kvs">${kvRows('attendance', p.attendance || {})}</div>
      <div class="sec">合計（照明細上印的數字）</div><div class="fc"><label class="fr"><span class="k">總支給額</span><input id="tg" inputmode="numeric" value="${p.gross || ''}"></label><label class="fr"><span class="k">控除合計</span><input id="td" inputmode="numeric" value="${p.deduction || ''}"></label><label class="fr"><span class="k">差引支給額（實領）</span><input id="tn" inputmode="numeric" value="${p.net || ''}"></label></div>
      <div id="chk" class="note" style="padding:0 16px"></div>
      <div class="sec">備註</div><div class="fc memo"><textarea id="sn" rows="2">${esc(p.note || '')}</textarea></div>${p.pdf ? `<div class="bb">${pdfLink(p)}</div>` : ''}<div style="height:30px"></div>`;
    const g = s => pg.in.querySelector(s);
    const collect = () => { p.kind = g('#sk').value; p.company = g('#sc').value.trim(); p.workMonth = g('#sw').value; p.payDate = g('#sd').value; if (g('#st')) p.title = g('#st').value.trim();
      p.pay = readKv(pg.in, 'pay'); p.deduct = readKv(pg.in, 'deduct'); p.attendance = readKv(pg.in, 'attendance'); const n = s => Math.round(+g(s).value.replace(/[,，\s]/g, '')) || 0; p.gross = n('#tg'); p.deduction = n('#td'); p.net = n('#tn'); p.note = g('#sn').value.trim(); };
    const check = () => { collect(); const w = W.checkSlip(p); g('#chk').innerHTML = w.length ? w.map(x => `<span class="red">⚠ ${esc(x)}</span>`).join('<br>') : '<span class="green">✓ 支給、控除、實領三個合計都對得上</span>'; };
    pg.in.oninput = check; check();
    g('[data-x]').onclick = () => pg.close();
    g('#sk').onchange = () => { collect(); pg.refresh(); };
    pg.in.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { b.parentElement.remove(); check(); });
    pg.in.querySelectorAll('[data-addrow]').forEach(b => b.onclick = () => { collect(); p[b.dataset.addrow] = {...p[b.dataset.addrow], ['']: ''}; pg.refresh(); });
    g('[data-ok]').onclick = () => { collect(); if (!/^\d{4}-\d{2}-\d{2}$/.test(p.payDate)) return W.toast('請填支払日');
      if (!p.workMonth && p.kind === '給与') return W.toast('請填勤務月');
      const save = () => { if (src && src.id !== p.id && S.ps[src.id]) W.delSlip(src.id); W.putSlip(p); pg.close(); U.year = p.payDate.slice(0, 4); W.render(); W.refreshAll(); W.toast('已儲存'); };
      const fresh = !src || opts.fresh;
      if (fresh && S.ps[p.id]) { const o = S.ps[p.id]; return W.alert('已經有這個月的薪資單', `${o.payDate} 支払 ${o.company}，實領 ${yen(o.net)}。要用這份取代嗎？`, [{t: '取消'}, {t: '取代', s: 'd', f: save}]); }
      const dup = W.slips().find(x => x.id !== p.id && x.payDate === p.payDate && x.kind === p.kind && x.company === p.company);
      const w = W.checkSlip(p);
      if (dup) return W.alert('已經有同一天的薪資單', `${dup.payDate} ${dup.company}。要用這份取代嗎？`, [{t: '取消'}, {t: '取代', s: 'd', f: () => { W.delSlip(dup.id); save(); }}]);
      if (w.length) return W.alert('合計對不上', w.join('\n'), [{t: '回去修改'}, {t: '照樣儲存', s: 'b', f: save}]);
      save(); };
  });
}
function editGensen(src, opts = {}) {
  const F = ['支払金額', '給与所得控除後の金額', '所得控除の額の合計額', '源泉徴収税額', '社会保険料等の金額'];
  const p = src ? W.clone(src) : {id: 'gensen-' + W.uid().slice(0, 8), kind: '源泉徴収票', company: '', year: String(new Date().getFullYear() - 1), fields: {}, note: ''};
  W.page('modal', pg => {
    pg.in.innerHTML = W.head(W.bx('x', I.x, '取消'), opts.title || '源泉徴収票', '<button class="pb" data-ok>儲存</button>') + (opts.msg ? `<div class="banner ${opts.ok ? 'okb' : ''}">${esc(opts.msg)}</div>` : '') +
      `<div class="fc"><label class="fr"><span class="k">年分</span><input id="gy" inputmode="numeric" value="${esc(p.year)}"></label><label class="fr"><span class="k">公司</span><input id="gc" value="${esc(p.company)}"></label></div>
      <div class="fc kvs">${kvRows('fields', Object.fromEntries([...F.map(k => [k, p.fields[k] ?? '']), ...Object.entries(p.fields).filter(([k]) => !F.includes(k))]))}</div>
      <div class="sec">備註</div><div class="fc memo"><textarea id="gn" rows="2">${esc(p.note || '')}</textarea></div>${p.pdf ? `<div class="bb">${pdfLink(p)}</div>` : ''}`;
    const g = s => pg.in.querySelector(s);
    g('[data-x]').onclick = () => pg.close();
    pg.in.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => b.parentElement.remove());
    pg.in.querySelectorAll('[data-addrow]').forEach(b => b.onclick = () => { p.fields = {...readKv(pg.in, 'fields'), ['']: ''}; pg.refresh(); });
    g('[data-ok]').onclick = () => { p.year = g('#gy').value.trim(); p.company = g('#gc').value.trim(); p.note = g('#gn').value.trim(); p.fields = Object.fromEntries(Object.entries(readKv(pg.in, 'fields')).filter(([, v]) => v !== 0 || true)); p.gross = p.fields['支払金額'] || 0;
      if (!/^\d{4}$/.test(p.year)) return W.toast('請填年分（西元，例如 2026）'); W.putSlip(p); pg.close(); U.year = p.year; W.render(); W.refreshAll(); W.toast('已儲存'); };
  });
}

/* ---- 上傳 PDF → 保存原檔 → 照格式規則讀出數字 → 確認 ---- */
let pdfjsP = null;
const pdfjs = () => pdfjsP || (pdfjsP = import(new URL('vendor/pdf.min.js', location.href).href).then(m => { m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', location.href).href; return m; }));
async function pdfItems(file) {
  const lib = await pdfjs(); const doc = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise; const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 2); i++) pages.push((await (await doc.getPage(i)).getTextContent()).items);
  return pages;
}
function upload(kind) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf';
  inp.onchange = () => { const f = inp.files[0]; if (f) run(kind, f); }; inp.click();
}
async function run(kind, file) {
  let pdfId = null, res = null; const notes = [];
  W.toast('讀取中…');
  try { if (W.canFiles()) pdfId = await W.uploadFile(file, file.name, kind === 'gensen' ? '源泉徴収票' : '薪資單'); else notes.push('這個畫面不能保存原始 PDF，只存數字。'); }
  catch (e) { notes.push('原始 PDF 沒有存到（' + (e.code || e.message || '錯誤') + '）。'); }
  if (kind === 'gensen') return editGensen({id: 'gensen-' + W.uid().slice(0, 8), kind: '源泉徴収票', company: W.slips().at(-1)?.company || '', year: String(new Date().getFullYear() - 1), fields: {}, note: '', pdf: pdfId}, {title: '源泉徴収票', msg: '源泉徴収票請照票上手動填寫（原始 PDF 已附上）。' + notes.join(''), fresh: true});
  try { res = window.PayslipParser.parsePayslip(await pdfItems(file)); }
  catch (e) { res = {ok: false, reason: 'error', err: e.message}; }
  let p, msg, ok = false;
  if (res.ok) { const d = res.data; ok = !d.warn.length;
    p = {id: d.kind === '賞与' ? `payslip-${d.payDate.slice(0, 7)}-bonus` : `payslip-${d.workMonth}`, kind: d.kind, company: d.company, workMonth: d.workMonth, payDate: d.payDate, title: d.title, pay: d.pay, deduct: d.deduct, attendance: d.attendance, gross: d.gross, deduction: d.deduction, net: d.net, note: d.note, pdf: pdfId};
    msg = `已依「${d.profile}」格式讀出，請對照原始 PDF 確認後儲存。` + (d.payDateGuess ? `明細上沒有印支払日，先填 ${d.payDate}（每月 10 日，遇假日提前），不對請修改。` : '') + (d.warn.length ? ' ⚠ ' + d.warn.join('；') : '') + (notes.length ? ' ' + notes.join('') : ''); }
  else { p = null; msg = (res.reason === 'scan' ? '這個 PDF 裡沒有文字（可能是掃描檔），請手動填寫。' : res.reason === 'unknown' ? '還沒有這種薪資單格式的讀法，請手動填寫；之後可以把這個 PDF 給我加上讀法。' : '讀取 PDF 失敗（' + (res.err || '') + '），請手動填寫。') + notes.join('');
    p = {id: 'payslip-' + W.uid().slice(0, 8), kind: '給与', company: W.slips().at(-1)?.company || '', workMonth: '', payDate: '', pay: {}, deduct: {}, attendance: {}, gross: 0, deduction: 0, net: 0, note: '', pdf: pdfId}; }
  editSlip(p, {title: '確認薪資單', msg, ok, fresh: true});
}
}
