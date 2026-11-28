/* Wen 記帳 — 主控 */
'use strict';
{
const {S, esc} = W;
W.render = () => {
  if (!S.meta) return;
  W.$$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === W.U.tab));
  const y = window.scrollY;
  ({pay: W.renderSalary, rec: W.renderRecords, sum: W.renderSummary, data: W.renderData})[W.U.tab]();
  window.scrollTo(0, y);
};
W.setTab = t => { W.U.tab = t; window.scrollTo(0, 0); W.render(); };
W.$$('#tabs button').forEach(b => b.onclick = () => W.setTab(b.dataset.tab));
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(W.render, 250); });
addEventListener('beforeunload', e => { if (W.Store.be?.busy?.()) { e.preventDefault(); e.returnValue = ''; } });

/* 連線設定：Google Apps Script 的網址和密碼（只存在這台裝置） */
W.openConnect = (fromSettings) => {
  const g = W.Store.gasCfg() || {};
  const html = `<div style="max-width:420px;margin:0 auto;padding:24px 16px">
    <div style="font-size:40px;text-align:center">📒</div><h2 style="text-align:center;margin:6px 0 4px">Wen 記帳</h2>
    <p class="note" style="text-align:center">連到你自己的 Google 試算表。網址和密碼在 Apps Script 部署後取得，只會存在這台裝置。</p>
    <div class="fc" style="margin:16px 0"><label class="fr"><span class="k">網址</span><input id="cu" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(g.url || '')}" autocomplete="off"></label>
    <label class="fr"><span class="k">密碼</span><input id="ct" placeholder="setup 時產生的密碼" value="${esc(g.token || '')}" autocomplete="off"></label></div>
    <button class="pb big" id="cgo">連線</button><p id="cmsg" class="note" style="text-align:center;min-height:20px;margin-top:10px"></p>
    <div class="bb" style="flex-direction:column;padding:0">${fromSettings && g.url ? '<button class="pb" id="coff" style="width:100%;color:var(--red)">中斷連線（資料留在試算表）</button>' : ''}<button class="pb" id="cloc" style="width:100%">${fromSettings ? '取消' : '先不連線，只存在這台裝置'}</button></div></div>`;
  const pg = W.page('modal', p => { p.in.innerHTML = html;
    const g2 = s => p.in.querySelector(s);
    g2('#cgo').onclick = async () => { const url = g2('#cu').value.trim(), token = g2('#ct').value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) return g2('#cmsg').textContent = '網址要是 https://script.google.com/… 開頭';
      if (!token) return g2('#cmsg').textContent = '請輸入密碼';
      g2('#cgo').disabled = true; g2('#cmsg').textContent = '連線中…';
      try { const res = await fetch(url, {method: 'POST', body: JSON.stringify({token, action: 'ping'})}); const j = await res.json(); if (!j.ok) throw new Error(j.error || '密碼不對');
        W.Store.setGas({url, token}); location.reload(); }
      catch (e) { g2('#cmsg').textContent = '連不上：' + e.message; g2('#cgo').disabled = false; } };
    g2('#cloc').onclick = () => { if (fromSettings) return p.close(); p.close(); W.Store.useLocal(); boot2(); };
    if (g2('#coff')) g2('#coff').onclick = () => W.confirm('中斷連線？', '這台裝置之後會看不到資料，資料仍在你的 Google 試算表。', '中斷', () => { W.Store.setGas(null); location.reload(); });
  });
  return pg;
};
async function welcome() {
  const seed = await W.hasSeed();
  W.$('#app').innerHTML = `<div class="loading"><div style="max-width:340px">
    <div style="font-size:44px">📒</div><h2 style="margin:8px 0">Wen 記帳</h2>
    <p class="sub" style="font-size:15px">還沒有資料。${seed ? '可以載入內建的薪資單與收支紀錄，或' : ''}匯入之前下載的備份檔（wen-kakeibo-backup-….json），也可以直接開始，之後再上傳薪資單、匯入 CSV。</p>
    <p class="sub" style="font-size:13px">儲存位置：${esc(W.Store.label())}</p>
    <div class="bb" style="flex-direction:column;gap:10px">${seed ? '<button class="pb big" id="go">載入內建資料</button>' : ''}<button class="pb big" id="bk" ${seed ? 'style="background:#2c2c2e"' : ''}>匯入備份檔</button><button class="pb" id="emp">直接開始（空白）</button></div><p id="prog" class="sub" style="font-size:13px"></p></div></div>`;
  const prog = (i, n) => W.$('#prog').textContent = `寫入中… ${i}/${n}`;
  const lock = v => W.$$('.loading button').forEach(b => b.disabled = v);
  const run = async f => { lock(true); try { await f(); start(); } catch (e) { W.$('#prog').textContent = '失敗：' + (e && (e.code || e.message) || '請重新整理再試'); lock(false); } };
  if (seed) W.$('#go').onclick = () => run(() => W.seed(prog));
  W.$('#bk').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json'; i.onchange = () => i.files[0] && run(async () => W.importBackup(await W.readBackup(i.files[0]), prog)); i.click(); };
  W.$('#emp').onclick = () => run(() => W.importBackup({app: 'wen-kakeibo', slips: [], recs: []}, prog));
}
function start() { W.$('#tabs').hidden = false; W.render(); }
async function boot2() {
  let d = null;
  try { d = await W.Store.be.load(); }
  catch (e) { W.$('#app').innerHTML = `<div class="loading"><div><p>讀取資料失敗：${esc(e.message || e.code || '')}</p><p class="note">請確認網路後重新整理。</p>${W.Store.mode === 'gas' ? '<button class="pb" id="rc">檢查連線設定</button>' : ''}</div></div>`; const rc = W.$('#rc'); if (rc) rc.onclick = () => W.openConnect(true); return; }
  if (W.Store.mode === 'local') S.offline = W.Store.inClaude ? '沒有連到 Claude 的資料庫（未登入或預覽模式），資料只存在這台裝置的瀏覽器。' : '目前只存在這台裝置。到「資料 → 儲存位置」可以連到 Google 試算表。';
  if (!d) return welcome();
  W.setData(d);
  try { await W.seedUpdate(); } catch (e) {}
  try { if (W.purgeOnce()) await W.flush(); } catch (e) { console.error("purge", e); }
  start();
}
(async () => { await W.Store.init(); if (W.Store.mode === 'setup') return W.openConnect(false); boot2(); })();
}
