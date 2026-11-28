/* Wen 記帳 v3 — 資料：每月匯入 CSV、匯入紀錄、匯出、設定 */
'use strict';
{
const {S, I, esc, yen} = W;
W.renderData = () => {
  const n = S.recs.length; const byCur = {}; for (const r of S.recs) byCur[r.cur] = (byCur[r.cur] || 0) + 1;
  const lo = S.recs.at(-1)?.d, hi = S.recs[0]?.d; const last = S.meta.imports.filter(x => !x.manual).at(-1);
  const lastM = W.shiftKey(W.today().slice(0, 6), -1);
  let h = `<div class="top"><span class="t">資料</span></div>${S.offline ? `<div class="banner">${esc(S.offline)}</div>` : ''}
    <div class="card"><div class="ch"><b>匯入每日家計簿 CSV</b></div><div class="note" style="margin:0 0 12px">每月初在每日家計簿匯出 CSV（例如 ${lastM.slice(0, 4)} 年 ${+lastM.slice(4)} 月分），選這裡上傳。用 UUID 判斷：新紀錄加入、改過的更新、相同的略過，重複上傳也不會重複。</div>
    <button class="pb big" data-imp>${I.up}<span>選擇 CSV 檔案</span></button>${last ? `<div class="note" style="margin-top:10px">上次匯入：${new Date(last.at).toLocaleDateString('ja-JP')}・${esc(last.file)}</div>` : ''}</div>
    <div class="sec">留存資料</div><div class="sl">
      <div class="sr"><span class="k">收支紀錄</span><span class="v">${n.toLocaleString()} 筆</span></div>
      <div class="sr"><span class="k">幣別</span><span class="v">${Object.entries(byCur).map(([c, k]) => `${c} ${k.toLocaleString()}`).join('・')}</span></div>
      <div class="sr"><span class="k">日期範圍</span><span class="v">${lo ? `${W.ymd(lo)}〜${W.ymd(hi)}` : '—'}</span></div>
      <div class="sr"><span class="k">薪資單</span><span class="v">${W.slips().length} 份・源泉徴収票 ${W.gensen().length} 張</span></div>
      <button class="sr" data-conn><span class="k">儲存位置</span><span class="v">${esc(W.Store.label())}</span>${W.Store.inClaude ? '' : '<span class="gt">›</span>'}</button></div>
    <div class="sec">匯入紀錄</div><div class="sl">${S.meta.imports.slice().reverse().map(x => `<div class="sr" style="align-items:flex-start;padding-top:10px;padding-bottom:10px"><span class="k" style="white-space:normal"><span style="font-size:15px">${new Date(x.at).toLocaleString('ja-JP', {dateStyle: 'short', timeStyle: 'short'})}</span><br><span class="sub" style="font-size:13px">${esc(x.file)}${x.note ? '・' + esc(x.note) : ''}</span><br><span style="font-size:13px">共 ${x.total} 筆：新增 <b class="green">${x.add}</b>・更新 <b>${x.upd}</b>・刪除 <b class="red">${x.del}</b></span></span>${x.csv ? `<a class="lk" href="${esc(W.fileUrl(x.csv))}" target="_blank" rel="noopener">原檔</a>` : ''}</div>`).join('') || '<div class="sr"><span class="k sub">還沒有</span></div>'}</div>
    <div class="sec">設定與匯出</div><div class="sl">
      <button class="sr" data-ms><span class="k">彙總的月份起算日</span><span class="v">${S.meta.settings.monthStart === 1 ? '每月 1 日（日曆月）' : `每月 ${S.meta.settings.monthStart} 日`}</span><span class="gt">›</span></button>
      <button class="sr" data-exr><span class="k">匯出全部收支紀錄（CSV）</span><span class="gt">›</span></button>
      <button class="sr" data-exp><span class="k">匯出薪資明細（CSV）</span><span class="gt">›</span></button>
      <button class="sr" data-bak><span class="k">下載完整備份（JSON）</span><span class="gt">›</span></button>
      <button class="sr" data-rst><span class="k">從備份檔還原</span><span class="gt">›</span></button></div><div style="height:20px"></div>`;
  const app = W.$('#app'); app.innerHTML = h;
  app.querySelector('[data-imp]').onclick = pickCsv;
  app.querySelector('[data-ms]').onclick = e => W.popover(e.currentTarget, [1, 10].map(v => ({t: v === 1 ? '每月 1 日（日曆月）' : '每月 10 日（10 日到下月 9 日）', f: () => { S.meta.settings.monthStart = v; W.saveMeta(); W.R.mk = null; W.R.sy = null; W.render(); }})));
  app.querySelector('[data-bak]').onclick = () => { W.exportBackup(); W.toast('已下載備份檔'); };
  app.querySelector('[data-rst]').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => { const f = i.files[0]; if (!f) return; let o; try { o = await W.readBackup(f); } catch (e) { return W.toast(e.message || '讀不到這個檔案'); }
      W.confirm('從備份檔還原？', `薪資單等 ${o.slips.length} 筆、收支 ${o.recs.length} 筆（${(o.at || '').slice(0, 10)} 匯出）。同一筆會被備份蓋過，目前多出來的資料保留。`, '還原', async () => {
        const merged = {app: 'wen-kakeibo', at: o.at, meta: Object.assign({}, S.meta, {settings: (o.meta || {}).settings || S.meta.settings}), slips: [...Object.values(S.ps).filter(p => !o.slips.some(x => x.id === p.id)), ...o.slips], recs: [...S.recs.filter(r => !o.recs.some(x => x[0] === r.id)).map(r => [r.id, r.d, r.t, r.c, r.p, r.a, r.cur, r.m, r.ac, (r.tg || []).join('|'), r.memo, r.upd]), ...o.recs]};
        W.toast('還原中…'); try { await W.importBackup(merged, () => {}); W.render(); W.toast('已還原'); } catch (e) { W.toast('還原失敗：' + (e.message || '')); } }); };
    i.click(); };
  app.querySelector('[data-exr]').onclick = exportRecs; const cn = app.querySelector('[data-conn]'); if (cn && !W.Store.inClaude) cn.onclick = () => W.openConnect(true); app.querySelector('[data-exp]').onclick = exportPay;
};
function pickCsv() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,text/csv'; inp.onchange = () => inp.files[0] && readCsv(inp.files[0]); inp.click(); }
async function readCsv(file) {
  const buf = await file.arrayBuffer(); let text; let utf8 = true;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(buf); } catch (e) { utf8 = false; text = new TextDecoder('shift_jis').decode(buf); }
  let parsed; try { parsed = W.csvToRecords(text); } catch (e) { return W.alert('無法匯入', e.message, [{t: '好'}]); }
  if (!parsed.recs.length) return W.alert('無法匯入', '這個檔案裡沒有紀錄。', [{t: '好'}]);
  const plan = W.planImport(parsed.recs); let delGone = false;
  W.page('modal', pg => {
    const curC = {}; for (const r of parsed.recs) curC[r.cur] = (curC[r.cur] || 0) + 1;
    const li = (r, cls) => `<div class="row"><div class="mid"><div class="t1" style="font-size:16px">${esc(r.c)}<span class="sub" style="font-size:13px"> ${esc(r.ac)}</span></div><div class="t2">${W.ymd(r.d)}${r.memo ? '・' + esc(r.memo) : ''}</div></div><div class="r"><b class="${cls || ''}" style="font-size:16px">${r.cur !== 'JPY' ? r.cur + ' ' : ''}${W.amt(r.a, r.cur)}</b></div></div>`;
    const diff = x => { const ch = ['d', 'c', 'a', 'ac', 'memo', 'tg', 'm', 'cur', 't', 'p'].filter(k => JSON.stringify(x.old[k]) !== JSON.stringify(x.rec[k])); return ch.map(k => ({d: '日期', c: '類別', a: '金額', ac: '帳戶', memo: '備註', tg: '標籤', m: '成員', cur: '幣別', t: '收支', p: '大類別'}[k])).join('、') || '更新時間'; };
    pg.in.innerHTML = W.head(W.bx('x', I.x, '取消'), '確認匯入', `<button class="pb" data-ok ${plan.add.length + plan.upd.length || delGone ? '' : ''}>匯入</button>`) +
      `<div class="card"><div class="sub" style="font-size:13px;word-break:break-all">${esc(file.name)}</div><div style="margin-top:6px">${parsed.recs.length} 筆・${W.ymd(plan.lo)}〜${W.ymd(plan.hi)}</div><div class="sub" style="font-size:13px">${Object.entries(curC).map(([c, k]) => `${c} ${k}`).join('・')}${parsed.bad.length ? `・格式不對略過 ${parsed.bad.length} 列（第 ${parsed.bad.slice(0, 5).join('、')} 列）` : ''}${utf8 ? '' : '・以 Shift_JIS 讀取'}</div></div>
      <div class="g3"><div><small>新增</small><b class="green">${plan.add.length}</b></div><div><small>更新</small><b>${plan.upd.length}</b></div><div><small>相同略過</small><b class="sub">${plan.keep.length}</b></div></div>
      ${plan.gone.length ? `<div class="card"><label style="display:flex;gap:12px;align-items:center"><span style="flex:1"><b>同步刪除 ${plan.gone.length} 筆</b><br><span class="note">這段日期內留存資料有、但這次 CSV 沒有的紀錄（通常是在每日家計簿刪掉的）。如果這次匯出的只是部分帳本或部分幣別，請不要勾。</span></span><span class="sw"><input type="checkbox" data-del aria-label="同步刪除"><i></i></span></label></div>` : ''}
      ${plan.add.length ? `<div class="sec">新增（${plan.add.length}）</div><div class="list">${plan.add.slice(0, 60).map(r => li(r, r.t ? 'green' : '')).join('')}</div>${plan.add.length > 60 ? `<div class="gh">…還有 ${plan.add.length - 60} 筆</div>` : ''}` : ''}
      ${plan.upd.length ? `<div class="sec">更新（${plan.upd.length}）</div><div class="list">${plan.upd.slice(0, 60).map(x => li(x.rec) .replace('</div></div><div class="r">', `・改了${esc(diff(x))}</div></div><div class="r">`)).join('')}</div>` : ''}
      ${plan.gone.length ? `<div class="sec">CSV 裡沒有的（${plan.gone.length}）</div><div class="list">${plan.gone.slice(0, 60).map(r => li(r, 'red')).join('')}</div>` : ''}
      ${!plan.add.length && !plan.upd.length && !plan.gone.length ? '<div class="empty" style="padding:40px">全部都已經存過了，沒有要更新的</div>' : ''}<div style="height:30px"></div>`;
    pg.in.querySelector('[data-x]').onclick = () => pg.close();
    const dc = pg.in.querySelector('[data-del]'); if (dc) dc.onchange = () => delGone = dc.checked;
    pg.in.querySelector('[data-ok]').onclick = async () => {
      const btn = pg.in.querySelector('[data-ok]'); btn.disabled = true; btn.textContent = '匯入中…';
      W.applyImport(plan, delGone);
      let csv = null; if (W.canFiles() && utf8) { try { csv = await W.uploadFile(new Blob([buf], {type: 'text/csv'}), file.name, 'CSV'); } catch (e) {} }
      S.meta.imports.push({at: new Date().toISOString(), file: file.name, total: parsed.recs.length, add: plan.add.length, upd: plan.upd.length, del: delGone ? plan.gone.length : 0, csv});
      W.saveMeta(); await W.flush(); pg.close(); W.render();
      W.toast(`已匯入：新增 ${plan.add.length}、更新 ${plan.upd.length}${delGone ? `、刪除 ${plan.gone.length}` : ''}`);
    };
  });
}
const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const save = (name, text) => W.download(name, '\ufeff' + text);
function exportRecs() {
  const L = ['日期,類別,大類別,金額,幣別,成員,帳戶,標籤,備註,收支區分,上次更新,UUID'];
  for (const r of S.recs.slice().reverse()) L.push([r.d, r.c, r.p, r.a, r.cur, r.m, r.ac, r.tg.join('|'), r.memo, r.t ? '收' : '支', r.upd, r.id].map(q).join(','));
  save(`Wen記帳_收支留存_${W.today()}.csv`, L.join('\n'));
}
function exportPay() {
  const P = W.slips(); const pk = [...new Set(P.flatMap(p => Object.keys(p.pay)))], dk = [...new Set(P.flatMap(p => Object.keys(p.deduct)))];
  const L = [['支払日', '勤務月', '種類', '公司', '總支給', '控除合計', '實領', ...pk.map(k => '支給:' + k), ...dk.map(k => '控除:' + k)].map(q).join(',')];
  for (const p of P) L.push([p.payDate, p.workMonth, p.kind, p.company, p.gross, p.deduction, p.net, ...pk.map(k => p.pay[k] ?? ''), ...dk.map(k => p.deduct[k] ?? '')].map(q).join(','));
  save(`Wen記帳_薪資明細_${W.today()}.csv`, L.join('\n'));
}
}
