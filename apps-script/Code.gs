/**
 * Wen 記帳 — Google Apps Script 後端
 * 資料存在你自己的 Google 試算表「Wen 記帳 薪資與收支」；薪資單 PDF、匯入的 CSV 存在 Google Drive「Wen 記帳」資料夾。
 *
 * 第一次設定：
 *  1. 到 script.google.com 新增專案，把這個檔案的內容貼進 Code.gs。
 *  2. 上方選「setup」→ 執行 → 允許權限。執行紀錄會列出試算表網址和「密碼」。
 *  3. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署，複製網址。
 *  4. 在 App 輸入網址和密碼。
 * 沒有密碼的人打不開資料；密碼只存在你的裝置上。
 */
const SHEETS = {
  rec: {name: '收支紀錄', head: ['UUID', '日期', '收支', '類別', '大類別', '金額', '幣別', '成員', '帳戶', '標籤', '備註', '每日家計簿最後更新']},
  slip: {name: '薪資單', head: ['ID', '種類', '公司', '勤務月', '支払日', '總支給', '社會保險', '所得税', '住民税', '其他扣除', '控除合計', '實領', 'PDF', '明細(JSON)']},
  meta: {name: '設定', head: ['key', 'value']}
};

function setup() {
  const P = PropertiesService.getScriptProperties();
  let id = P.getProperty('SHEET_ID'), ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else { ss = SpreadsheetApp.create('Wen 記帳 薪資與收支'); P.setProperty('SHEET_ID', ss.getId()); }
  for (const k in SHEETS) sheet_(ss, k);
  const first = ss.getSheets()[0]; if (first.getName() === 'Sheet1' || first.getName() === '工作表1') { if (ss.getSheets().length > 1) ss.deleteSheet(first); }
  if (!P.getProperty('FOLDER_ID')) P.setProperty('FOLDER_ID', DriveApp.createFolder('Wen 記帳').getId());
  if (!P.getProperty('TOKEN')) P.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('試算表：' + ss.getUrl());
  Logger.log('密碼：' + P.getProperty('TOKEN'));
}

function doGet() { return out_({ok: true, app: 'Wen 記帳'}); }
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const P = PropertiesService.getScriptProperties();
    if (!P.getProperty('TOKEN') || req.token !== P.getProperty('TOKEN')) return out_({ok: false, error: '密碼不對'});
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { return out_(Object.assign({ok: true}, ACTIONS[req.action] ? ACTIONS[req.action](req) : {ok: false, error: '不支援的動作 ' + req.action})); }
    finally { lock.releaseLock(); }
  } catch (err) { return out_({ok: false, error: String(err && err.message || err)}); }
}

const ACTIONS = {
  ping: () => ({}),
  load: () => {
    const ss = ss_(); const metaRow = rows_(sheet_(ss, 'meta')).find(r => r[0] === 'meta');
    if (!metaRow) return {meta: null};
    return {meta: JSON.parse(metaRow[1]), slips: rows_(sheet_(ss, 'slip')).map(slipFromRow_), recs: rows_(sheet_(ss, 'rec')).map(recFromRow_)};
  },
  putRecs: req => { upsert_(sheet_(ss_(), 'rec'), req.recs.map(recToRow_)); return {n: req.recs.length}; },
  delRecs: req => ({n: remove_(sheet_(ss_(), 'rec'), req.ids)}),
  putSlip: req => { upsert_(sheet_(ss_(), 'slip'), [slipToRow_(req.slip)]); return {}; },
  putSlips: req => { upsert_(sheet_(ss_(), 'slip'), req.slips.map(slipToRow_)); return {n: req.slips.length}; },
  delSlip: req => ({n: remove_(sheet_(ss_(), 'slip'), [req.id])}),
  putMeta: req => { upsert_(sheet_(ss_(), 'meta'), [['meta', JSON.stringify(req.meta)]]); return {}; },
  saveFile: req => {
    const P = PropertiesService.getScriptProperties(); const root = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
    const name = String(req.folder || '其他'); const it = root.getFoldersByName(name); const folder = it.hasNext() ? it.next() : root.createFolder(name);
    const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mime || 'application/octet-stream', req.name || 'file');
    const f = folder.createFile(blob); return {id: f.getId(), url: f.getUrl()};
  }
};

/* ---- 試算表工具 ---- */
function ss_() { const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID'); if (!id) throw new Error('還沒執行 setup'); return SpreadsheetApp.openById(id); }
function sheet_(ss, key) {
  const def = SHEETS[key]; let sh = ss.getSheetByName(def.name);
  if (!sh) { sh = ss.insertSheet(def.name); sh.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function rows_(sh) { const n = sh.getLastRow() - 1; if (n < 1) return []; return sh.getRange(2, 1, n, sh.getLastColumn()).getValues().map(r => r.map(v => v instanceof Date ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss') : v)); }
/* 依第一欄的 ID 更新或新增；整張表一次寫回（幾千列也只要一兩秒） */
function upsert_(sh, newRows) {
  if (!newRows.length) return;
  const cur = rows_(sh); const idx = {}; cur.forEach((r, i) => idx[String(r[0])] = i);
  for (const r of newRows) { const i = idx[String(r[0])]; if (i == null) { idx[String(r[0])] = cur.length; cur.push(r); } else cur[i] = r; }
  write_(sh, cur);
}
function remove_(sh, ids) { const set = {}; ids.forEach(i => set[String(i)] = 1); const cur = rows_(sh); const keep = cur.filter(r => !set[String(r[0])]); if (keep.length !== cur.length) write_(sh, keep, cur.length); return cur.length - keep.length; }
function write_(sh, rows, oldLen) {
  const w = sh.getLastColumn() || rows[0]?.length || 1; const n = Math.max(oldLen || 0, sh.getLastRow() - 1);
  if (n > 0) sh.getRange(2, 1, n, w).clearContent();
  if (rows.length) { const width = Math.max(...rows.map(r => r.length)); sh.getRange(2, 1, rows.length, width).setValues(rows.map(r => { const a = r.slice(); while (a.length < width) a.push(''); return a; })); }
}
/* 日期、文字一律用文字格式寫入（開頭加 '），避免試算表自動轉成日期或數字 */
const txt_ = v => "'" + String(v == null ? '' : v);
const str_ = v => String(v == null ? '' : v).replace(/^'/, '');
function recToRow_(r) { return [r.id, txt_(r.d), r.t ? '收' : '支', txt_(r.c), txt_(r.p), +r.a, r.cur, txt_(r.m), txt_(r.ac), txt_((r.tg || []).join('|')), txt_(r.memo), txt_(r.upd)]; }
function recFromRow_(x) { return {id: str_(x[0]), d: str_(x[1]), t: x[2] === '收' ? 1 : 0, c: str_(x[3]), p: str_(x[4]), a: +x[5], cur: str_(x[6]) || 'JPY', m: str_(x[7]), ac: str_(x[8]), tg: str_(x[9]) ? str_(x[9]).split('|') : [], memo: str_(x[10]), upd: str_(x[11])}; }
const SOCIAL_ = /健康保険|厚生年金|雇用保険|介護保険|子ども|子育て|子供/, ITAX_ = /所得税|年末調整/, RTAX_ = /住民税|地方税/;
function slipToRow_(p) {
  const o = {s: 0, i: 0, r: 0, x: 0}; Object.keys(p.deduct || {}).forEach(k => { const v = +p.deduct[k] || 0; if (SOCIAL_.test(k)) o.s += v; else if (ITAX_.test(k)) o.i += v; else if (RTAX_.test(k)) o.r += v; else o.x += v; });
  return [p.id, p.kind, txt_(p.company), txt_(p.workMonth || p.year || ''), txt_(p.payDate || ''), +p.gross || 0, o.s, o.i, o.r, o.x, +p.deduction || 0, +p.net || 0, txt_(p.pdf || ''), JSON.stringify(p)];
}
function slipFromRow_(x) { return JSON.parse(str_(x[13])); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
