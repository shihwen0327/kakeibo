/**
 * Wen 記帳 — Google Apps Script 後端
 * 資料存在這個 Google 試算表；手機 App 和 iPhone 捷徑都呼叫這支 Web App。
 * 第一次使用：在編輯器選 setup 執行一次（會建分頁、預設資料、每日排程，並產生 API 金鑰）。
 */

var SHEETS = {
  tx: ['id', 'date', 'type', 'category', 'group', 'amount', 'currency', 'account', 'member', 'tags', 'note', 'source', 'extId', 'status', 'createdAt', 'updatedAt'],
  categories: ['name', 'group', 'type', 'emoji', 'order', 'excludeBudget'],
  budgets: ['category', 'period', 'amount'],
  accounts: ['name', 'type', 'icon', 'color', 'closeDay', 'payDay', 'payAccount', 'order', 'active'],
  recurring: ['id', 'name', 'category', 'amount', 'account', 'day', 'active', 'note'],
  rules: ['keyword', 'category', 'account'],
  cards: ['keyword', 'account'],
  funds: ['id', 'date', 'fund', 'amount', 'note'],
  payslips: ['id', 'month', 'payDate', 'gross', 'deduction', 'net', 'items', 'createdAt'],
  settings: ['key', 'value']
};
var SHEET_NAMES = { tx: 'Transactions', categories: 'Categories', budgets: 'Budgets', accounts: 'Accounts', recurring: 'Recurring', rules: 'Rules', cards: 'Cards', funds: 'Funds', payslips: 'Payslips', settings: 'Settings' };
var EDITABLE = ['categories', 'budgets', 'accounts', 'recurring', 'rules', 'cards'];

/* ===================== 初始化 ===================== */

/* 從試算表「擴充功能」打開的專案直接用那份試算表；
   在 script.google.com 直接新增的專案，第一次執行 setup 會自動建立一份「Wen 記帳資料」試算表 */
function ss_() {
  var a = SpreadsheetApp.getActive();
  if (a) return a;
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var n = SpreadsheetApp.create('Wen 記帳資料');
  props.setProperty('SHEET_ID', n.getId());
  return n;
}

function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (k) {
    var sh = ss.getSheetByName(SHEET_NAMES[k]) || ss.insertSheet(SHEET_NAMES[k]);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[k].length).setValues([SHEETS[k]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  ss.getSheetByName(SHEET_NAMES.tx).getRange('B:B').setNumberFormat('@');
  ss.getSheetByName(SHEET_NAMES.tx).getRange('M:M').setNumberFormat('@');
  ss.getSheetByName(SHEET_NAMES.funds).getRange('B:B').setNumberFormat('@');
  ss.getSheetByName(SHEET_NAMES.payslips).getRange('B:C').setNumberFormat('@');
  seedDefaults_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));
  setSetting_('apiToken', props.getProperty('TOKEN'));
  if (!settingsMap_().budgetStart) setSetting_('budgetStart', cycleOf_(todayStr_(), 10).start); // 年預算從開始用這個 App 的那一期算
  installTriggers();
  ['工作表1', 'Sheet1', 'シート1'].forEach(function (n) { var s = ss.getSheetByName(n); if (s && s.getLastRow() === 0) ss.deleteSheet(s); });
  Logger.log('API 金鑰：' + props.getProperty('TOKEN'));
  Logger.log('資料試算表：' + ss.getUrl());
  return props.getProperty('TOKEN');
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runRecurring') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runRecurring').timeBased().everyDays(1).atHour(6).inTimezone('Asia/Tokyo').create();
}

function seedDefaults_() {
  seed_('categories', DEFAULT_CATEGORIES.map(function (c, i) { return { name: c[0], group: c[1], type: c[2], emoji: c[3], order: i + 1, excludeBudget: c[4] ? 'TRUE' : '' }; }));
  seed_('budgets', DEFAULT_BUDGETS.map(function (b) { return { category: b[0], period: b[1], amount: b[2] }; }));
  seed_('accounts', DEFAULT_ACCOUNTS.map(function (a, i) { return { name: a[0], type: a[1], color: a[2], closeDay: a[3] || '', payDay: a[4] || '', payAccount: a[5] || '', order: i + 1, active: 'TRUE', icon: '' }; }));
  seed_('recurring', DEFAULT_RECURRING.map(function (r, i) { return { id: 'r' + (i + 1), name: r[0], category: r[1], amount: r[2], account: r[3], day: r[4], active: 'TRUE', note: r[0] }; }));
  seed_('rules', DEFAULT_RULES.map(function (r) { return { keyword: r[0], category: r[1], account: '' }; }));
  seed_('cards', DEFAULT_CARDS.map(function (r) { return { keyword: r[0], account: r[1] }; }));
  seed_('settings', DEFAULT_SETTINGS.map(function (r) { return { key: r[0], value: r[1] }; }));
}
function seed_(k, rows) { if (sheet_(k).getLastRow() <= 1) appendObjects_(k, rows); }

/* [名稱, 大類別, 收/支, emoji, 不算預算] */
var DEFAULT_CATEGORIES = [
  ['食材', '吃', '支', '🥩'], ['早餐', '吃', '支', '🍞'], ['午餐', '吃', '支', '🍔'], ['晚餐', '吃', '支', '🍴'],
  ['宵夜', '吃', '支', '🍰'], ['點心', '吃', '支', '🍦'], ['飲料', '吃', '支', '🍹'],
  ['日常用品', '生活', '支', '🛍️'], ['服飾', '生活', '支', '👕'], ['美容美髮', '生活', '支', '💄'], ['醫療保健', '生活', '支', '💊'], ['レジ袋', '生活', '支', '🛍'],
  ['房租', '住', '支', '🏡'], ['電', '住', '支', '💡'], ['瓦斯', '住', '支', '🔥'], ['水', '住', '支', '💧'], ['水電瓦斯', '住', '支', '💡'],
  ['ネットワーク', '住', '支', '📱'], ['會員費', '住', '支', '⭐'],
  ['汽油', '車', '支', '⛽'], ['汽車', '車', '支', '🚗'], ['保險', '車', '支', '☂️'], ['R15M', '車', '支', '🏍️'],
  ['交通', '交通', '支', '🚆'],
  ['娛樂', '娛樂', '支', '🎤'], ['交際應酬', '娛樂', '支', '🍻'], ['健身', '娛樂', '支', '🏸'],
  ['學習深造', '學習', '支', '📖'], ['教育', '學習', '支', '🎓'],
  ['住宿', '旅遊', '支', '🏯'], ['出去玩早餐', '旅遊', '支', '🍞'], ['出去玩午餐', '旅遊', '支', '🍔'], ['出去玩晚餐', '旅遊', '支', '🍴'],
  ['出去玩點心', '旅遊', '支', '🍰'], ['出去玩飲料', '旅遊', '支', '🍹'], ['出去玩買醉', '旅遊', '支', '🍻'], ['出去玩搭車車', '旅遊', '支', '🚆'],
  ['搭灰機', '旅遊', '支', '✈️'], ['出去玩門票', '旅遊', '支', '🎫'], ['ロッカー', '旅遊', '支', '📫'],
  ['稅金', '其他', '支', '💸'], ['郵寄', '其他', '支', '📫'], ['運賃', '其他', '支', '🚚'], ['まとめ', '其他', '支', '🛍️'],
  ['轉帳手續費', '其他', '支', '🏦'], ['國際匯款', '其他', '支', '💸', true], ['公司', '其他', '支', '💼', true], ['待分類', '其他', '支', '❓'],
  ['工資', '收入', '收', '💴'], ['獎金', '收入', '收', '🎁'], ['副業', '收入', '收', '💼'], ['退費', '收入', '收', '↩️'],
  ['投資', '收入', '收', '📈'], ['點數', '收入', '收', '🪙'], ['代收', '收入', '收', '📥']
];
/* 類別名稱前面加 # 代表整個大類別的預算 */
var DEFAULT_BUDGETS = [
  ['食材', 'month', 27000], ['午餐', 'month', 7000], ['晚餐', 'month', 5000], ['早餐', 'month', 2000],
  ['飲料', 'month', 2000], ['點心', 'month', 1500], ['宵夜', 'month', 500],
  ['日常用品', 'month', 6000], ['服飾', 'month', 2000], ['美容美髮', 'month', 2000], ['醫療保健', 'month', 2455],
  ['房租', 'month', 35545], ['瓦斯', 'month', 7000], ['電', 'month', 5000], ['水', 'month', 1500],
  ['ネットワーク', 'month', 8000], ['會員費', 'month', 1000],
  ['汽油', 'month', 15000], ['娛樂', 'month', 4000], ['交際應酬', 'month', 2000],
  ['汽車', 'year', 96000], ['#旅遊', 'year', 60000]
];
/* [名稱, 種類, 顏色, 結帳日, 繳款日, 扣款帳戶] 種類：bank/debit/credit/emoney/cash/foreign */
var DEFAULT_ACCOUNTS = [
  ['ゆうちょ', 'bank', '#2e7d32'], ['ゆうちょデビット', 'debit', '#43a047'], ['Epos', 'credit', '#c62828', 27, 27, 'ゆうちょ'],
  ['Pay Pay', 'emoney', '#e53935'], ['Suica', 'emoney', '#7cb342'], ['Nanako', 'emoney', '#f9a825'],
  ['Revolut', 'debit', '#455a64'], ['日圓現金', 'cash', '#8d6e63'], ['スターバックス', 'emoney', '#00796b'], ['SU PAY', 'emoney', '#6a1b9a'],
  ['Wise JPY', 'bank', '#9ccc65'], ['Line Bank', 'foreign', '#1b5e20'], ['中信', 'foreign', '#00695c'], ['現金', 'foreign', '#795548']
];
/* [名稱, 類別, 金額, 帳戶, 每月幾號] */
var DEFAULT_RECURRING = [
  ['房租', '房租', 35545, 'ゆうちょ', 27], ['手機', 'ネットワーク', 3900, 'ゆうちょ', 27], ['家用網路', 'ネットワーク', 4048, 'ゆうちょ', 27],
  ['Amazon Prime', '會員費', 600, 'Pay Pay', 14], ['Spotify', '會員費', 313, 'Pay Pay', 1]
];
var DEFAULT_RULES = [
  ['ENEOS', '汽油'], ['エネオス', '汽油'], ['出光', '汽油'], ['apollostation', '汽油'], ['コスモ石油', '汽油'], ['Shell', '汽油'],
  ['スターバックス', '飲料'], ['STARBUCKS', '飲料'],
  ['ゆめタウン', '食材'], ['サンリブ', '食材'], ['マルショク', '食材'], ['トライアル', '食材'], ['TRIAL', '食材'],
  ['イオン', '食材'], ['AEON', '食材'], ['ハローデイ', '食材'], ['ロッキー', '食材'], ['業務スーパー', '食材'],
  ['ドラッグストアコスモス', '日常用品'], ['DRUG COSMOS', '日常用品'], ['ダイソー', '日常用品'], ['DAISO', '日常用品'],
  ['ニトリ', '日常用品'], ['無印良品', '日常用品'], ['ユニクロ', '服飾'], ['UNIQLO', '服飾'],
  ['Amazon Prime', '會員費'], ['Spotify', '會員費'], ['Netflix', '會員費'],
  ['マクドナルド', '午餐'], ['McDonald', '午餐'], ['すき家', '午餐'], ['吉野家', '午餐']
];
var DEFAULT_CARDS = [
  ['epos', 'Epos'], ['エポス', 'Epos'], ['revolut', 'Revolut'], ['suica', 'Suica'], ['nanaco', 'Nanako'],
  ['ゆうちょ', 'ゆうちょデビット'], ['jp bank', 'ゆうちょデビット'], ['japan post', 'ゆうちょデビット']
];
var DEFAULT_SETTINGS = [
  ['cycleStartDay', '10'], ['payDay', '10'], ['twdRate', '4.8'], ['alertPercent', '80'],
  ['fund_緊急預備金_target', '450000'], ['fund_緊急預備金_monthly', '15500'],
  ['fund_台灣準備金_target', '90000'], ['fund_台灣準備金_monthly', '30000'],
  ['fund_NISA_target', '0'], ['fund_NISA_monthly', '0']
];

/* ===================== 入口 ===================== */

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = e.parameter || {}; }
  return handle_(body);
}

function handle_(req) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || String(req.token) !== token) return out_({ ok: false, error: 'API 金鑰錯誤' }, req);
    var fn = ACTIONS[req.action];
    if (!fn) return out_({ ok: false, error: '未知的動作：' + req.action }, req);
    var res = fn(req) || {};
    res.ok = true;
    return out_(res, req);
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) }, req);
  }
}

/* 捷徑呼叫時回傳一行文字，直接拿來當通知內容 */
function out_(obj, req) {
  if (obj._text !== undefined) return ContentService.createTextOutput(obj._text);
  if (!obj.ok && req && req.text) return ContentService.createTextOutput('錯誤：' + obj.error);
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

var ACTIONS = {
  bootstrap: function () {
    var o = {};
    Object.keys(SHEETS).forEach(function (k) { if (k !== 'settings') o[k] = readObjects_(k); });
    o.settings = settingsMap_();
    o.serverTime = nowIso_();
    return o;
  },
  add: function (req) {
    var list = req.txs || [req.tx];
    return { added: withLock_(function () { return appendTx_(list); }) };
  },
  update: function (req) {
    var list = req.txs || [req.tx];
    return withLock_(function () { var n = 0; list.forEach(function (t) { n += updateRow_('tx', t); }); return { updated: n }; });
  },
  remove: function (req) {
    return withLock_(function () { return { removed: deleteRow_('tx', req.id) }; });
  },
  saveTable: function (req) {
    if (EDITABLE.indexOf(req.table) < 0) throw new Error('不能覆蓋這張表');
    return withLock_(function () { writeObjects_(req.table, req.rows || []); return { saved: (req.rows || []).length }; });
  },
  saveSettings: function (req) {
    withLock_(function () { Object.keys(req.settings || {}).forEach(function (k) { setSetting_(k, req.settings[k]); }); });
    return { settings: settingsMap_() };
  },
  addFund: function (req) {
    var f = req.fund; f.id = f.id || Utilities.getUuid();
    withLock_(function () { appendObjects_('funds', [f]); });
    return { fund: f };
  },
  removeFund: function (req) { return withLock_(function () { return { removed: deleteRow_('funds', req.id) }; }); },

  /* iPhone 錢包自動化：merchant / amount / card */
  wallet: function (req) {
    var amount = parseAmount_(req.amount);
    if (!amount) return { _text: '沒有記帳：讀不到金額（' + req.amount + '）' };
    var merchant = String(req.merchant || '').trim();
    var account = matchCard_(req.card) || String(req.card || '');
    var category = matchRule_(merchant);
    var tx = { id: Utilities.getUuid(), date: todayStr_(), type: '支', category: category || '待分類', amount: amount, currency: 'JPY', account: account, member: '自己', note: merchant, source: 'wallet', status: category ? 'ok' : 'inbox' };
    withLock_(function () { appendTx_([tx]); });
    return { _text: txMessage_(tx) };
  },
  /* 關閉 PayPay 時跳出的捷徑：amount / category / note */
  quick: function (req) {
    var amount = parseAmount_(req.amount);
    if (!amount) return { _text: '沒有記帳（金額空白）' };
    var cat = String(req.category || '').trim() || '待分類';
    var tx = { id: Utilities.getUuid(), date: req.date || todayStr_(), type: req.type || '支', category: cat, amount: amount, currency: 'JPY', account: req.account || 'Pay Pay', member: '自己', note: req.note || '', source: 'paypay-quick', status: cat === '待分類' ? 'inbox' : 'ok' };
    withLock_(function () { appendTx_([tx]); });
    return { _text: txMessage_(tx) };
  },
  categoryList: function () {
    var names = readObjects_('categories').filter(function (c) { return c.type === '支' && c.group !== '旅遊' && c.name !== '水電瓦斯' && c.name !== '待分類'; })
      .sort(function (a, b) { return Number(a.order) - Number(b.order); }).map(function (c) { return c.name; });
    return { _text: names.join('\n') };
  },
  /* 每天 / 每週摘要通知 */
  summary: function (req) { return { _text: summaryText_(req.period === 'week' ? 'week' : 'day') }; },

  ocr: function (req) {
    var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mimeType || 'application/pdf', req.filename || 'payslip.pdf');
    var file = Drive.Files.create({ name: 'ocr-tmp-' + Date.now(), mimeType: 'application/vnd.google-apps.document' }, blob, { ocrLanguage: 'ja' });
    var text = DocumentApp.openById(file.id).getBody().getText();
    Drive.Files.remove(file.id);
    return { text: text };
  },
  savePayslip: function (req) {
    var p = req.payslip;
    p.id = p.id || ('payslip-' + p.month);
    var items = typeof p.items === 'string' ? p.items : JSON.stringify(p.items || {});
    withLock_(function () {
      deleteRow_('payslips', p.id);
      appendObjects_('payslips', [{ id: p.id, month: p.month, payDate: p.payDate, gross: p.gross, deduction: p.deduction, net: p.net, items: items, createdAt: nowIso_() }]);
      if (req.addIncome) appendTx_([{ id: 'salary-' + p.month, date: p.payDate, type: '收', category: '工資', amount: p.net, currency: 'JPY', account: 'ゆうちょ', member: '自己', note: p.month + ' 薪資（明細判讀）', source: 'payslip', extId: p.id, status: 'ok' }]);
    });
    return { payslip: p };
  },
  removePayslip: function (req) { return withLock_(function () { return { removed: deleteRow_('payslips', req.id) }; }); },
  runRecurring: function () { return { created: runRecurring() }; },

  /* 從雲端硬碟裡的試算表（舊記帳 App 匯出的 CSV 轉成的）匯入，用 UUID 判斷不重複 */
  importSheet: function (req) {
    var vals = SpreadsheetApp.openById(req.fileId).getSheets()[0].getDataRange().getValues();
    var head = vals[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
    var col = function (n) { return head.indexOf(n); };
    var c = { date: col('日期'), cat: col('類別'), grp: col('大類別'), amt: col('金額'), cur: col('貨幣'), mem: col('成員'), acc: col('帳戶'), tag: col('標籤'), note: col('備註'), io: col('收支區分'), id: col('UUID') };
    var txs = [];
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i], d = r[c.date];
      d = d instanceof Date ? fmt_(d) : String(d).replace(/^(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3');
      var amount = Number(String(r[c.amt]).replace(/,/g, ''));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !amount) continue;
      txs.push({ id: String(r[c.id] || ('legacy-' + d + '-' + i)), date: d, type: r[c.io] === '收' ? '收' : '支', category: String(r[c.cat] || '待分類'), group: String(r[c.grp] || ''),
        amount: amount, currency: String(r[c.cur] || 'JPY'), account: String(r[c.acc] || ''), member: String(r[c.mem] || '自己'), tags: String(r[c.tag] || ''), note: String(r[c.note] || ''), source: 'import', status: 'ok' });
    }
    return { rows: txs.length, added: withLock_(function () { return appendTx_(txs); }) };
  }
};

/* ===================== 固定支出（每天 6 點跑） ===================== */

function runRecurring() {
  var today = todayStr_(), p = today.split('-').map(Number);
  var last = new Date(p[0], p[1], 0).getDate();
  var list = readObjects_('recurring').filter(function (r) { return String(r.active).toUpperCase() === 'TRUE' && Number(r.amount); });
  var txs = [], ym = today.slice(0, 7);
  /* 這個月已經手動記過同類別、同金額的就不重複記 */
  var seen = {};
  readObjects_('tx').forEach(function (t) { if (String(t.date).slice(0, 7) === ym) seen[t.category + '|' + Number(t.amount)] = true; });
  list.forEach(function (r) {
    var day = Math.min(Number(r.day) || 1, last);
    if (p[2] < day || seen[r.category + '|' + Number(r.amount)]) return;
    txs.push({ id: 'rec-' + r.id + '-' + ym, date: ym + '-' + ('0' + day).slice(-2), type: '支', category: r.category, amount: Number(r.amount), currency: 'JPY', account: r.account, member: '自己', note: r.note || r.name, source: 'recurring', status: 'ok' });
  });
  return withLock_(function () { return appendTx_(txs); });
}

/* ===================== 通知文字 ===================== */

function txMessage_(tx) {
  var head = '已記帳 ¥' + fmtN_(tx.amount) + '（' + tx.category + '／' + tx.account + '）' + (tx.note ? ' ' + tx.note : '');
  if (tx.status === 'inbox') return head + '\n→ 打開 App 的「待分類」選類別';
  var ctx = ctx_();
  var b = ctx.budgetOf(tx.category, tx.date);
  if (!b) return head;
  var pct = Math.round(b.spent / b.budget * 100);
  var tail = '\n' + b.label + ' 本期 ¥' + fmtN_(b.spent) + ' / ¥' + fmtN_(b.budget) + '（' + pct + '%）';
  if (pct >= 100) tail += ' ⚠️ 已超支';
  else if (pct >= ctx.alert) tail += ' ⚠️ 快用完了';
  return head + tail;
}

function summaryText_(period) {
  var ctx = ctx_(), today = todayStr_();
  var c = cycleOf_(today, ctx.startDay);
  var spentCycle = ctx.spend(c.start, c.end), budget = ctx.monthBudgetTotal;
  var daysLeft = dayDiff_(c.end, today) + 1;
  var remain = budget - spentCycle;
  var lines = [];
  if (period === 'day') {
    var t = ctx.spend(today, today);
    lines.push('今天花了 ¥' + fmtN_(t));
  } else {
    var w0 = fmt_(new Date(new Date().getTime() - 7 * 86400000));
    var w = ctx.txIn(w0, today);
    lines.push('過去 7 天花了 ¥' + fmtN_(sum_(w)));
    var byCat = {};
    w.forEach(function (x) { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
    var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3);
    if (top.length) lines.push('最多：' + top.map(function (k) { return k + ' ¥' + fmtN_(byCat[k]); }).join('、'));
  }
  lines.push('本期（' + c.start.slice(5) + '～' + c.end.slice(5) + '）剩 ¥' + fmtN_(remain) + '，' + daysLeft + ' 天，每天可用 ¥' + fmtN_(Math.max(0, Math.floor(remain / daysLeft))));
  var warn = ctx.overList(c);
  if (warn.length) lines.push('⚠️ ' + warn.join('、'));
  var inbox = ctx.tx.filter(function (x) { return x.status === 'inbox'; }).length;
  if (inbox) lines.push('待分類 ' + inbox + ' 筆');
  if (period === 'week') {
    var bills = cardBills_(ctx);
    bills.forEach(function (b) { if (b.dueAmount > 0) lines.push(b.account + ' ' + b.due.slice(5) + ' 要繳 ¥' + fmtN_(b.dueAmount)); });
    var adv = ctx.tx.filter(function (x) { return x.member === '公司' && x.type === '支' && String(x.tags).indexOf('已退回') < 0; });
    if (adv.length) lines.push('公司代墊未退 ¥' + fmtN_(sum_(adv)) + '（' + adv.length + ' 筆）');
  }
  return lines.join('\n');
}

/* 預算計算共用 */
function ctx_() {
  var st = settingsMap_();
  var startDay = Number(st.cycleStartDay || 10);
  var cats = {};
  readObjects_('categories').forEach(function (c) { cats[c.name] = c; });
  var budgets = readObjects_('budgets');
  var tx = readObjects_('tx').filter(function (t) {
    var c = cats[t.category] || {};
    return t.type === '支' && t.currency === 'JPY' && t.member !== '公司' && String(c.excludeBudget).toUpperCase() !== 'TRUE';
  });
  function txIn(a, b) { return tx.filter(function (t) { return t.date >= a && t.date <= b; }); }
  function groupOf(name) { return (cats[name] || {}).group || ''; }
  var monthBudgets = budgets.filter(function (b) { return b.period === 'month'; });
  return {
    startDay: startDay, alert: Number(st.alertPercent || 80), tx: readObjects_('tx'), txIn: txIn,
    monthBudgetTotal: monthBudgets.reduce(function (s, b) { return s + Number(b.amount); }, 0),
    spend: function (a, b) {
      return sum_(txIn(a, b).filter(function (t) { return groupOf(t.category) !== '旅遊' && !yearOnly_(budgets, t.category); }));
    },
    budgetOf: function (cat, date) {
      var c = cycleOf_(date, startDay);
      var b = monthBudgets.filter(function (x) { return x.category === cat; })[0];
      if (b && Number(b.amount)) return { label: cat, budget: Number(b.amount), spent: sum_(txIn(c.start, c.end).filter(function (t) { return t.category === cat; })) };
      var g = groupOf(cat);
      var y = budgets.filter(function (x) { return x.period === 'year' && (x.category === cat || x.category === '#' + g); })[0];
      if (y && Number(y.amount)) {
        var ys = date.slice(0, 4) + '-01-01', ye = date.slice(0, 4) + '-12-31';
        if (st.budgetStart && st.budgetStart > ys) ys = st.budgetStart;
        var match = y.category.charAt(0) === '#' ? function (t) { return groupOf(t.category) === g; } : function (t) { return t.category === cat; };
        return { label: (y.category.charAt(0) === '#' ? g : cat) + '（年）', budget: Number(y.amount), spent: sum_(txIn(ys, ye).filter(match)) };
      }
      return null;
    },
    overList: function (c) {
      var out = [];
      monthBudgets.forEach(function (b) {
        var s = sum_(txIn(c.start, c.end).filter(function (t) { return t.category === b.category; }));
        var pct = Math.round(s / Number(b.amount) * 100);
        if (Number(b.amount) && pct >= Number(st.alertPercent || 80)) out.push(b.category + ' ' + pct + '%');
      });
      return out;
    },
    accounts: readObjects_('accounts')
  };
}
function yearOnly_(budgets, cat) { return budgets.some(function (b) { return b.period === 'year' && b.category === cat; }); }

/* 信用卡帳單：結帳日 closeDay、繳款日 payDay（隔月） */
function cardBills_(ctx) {
  var today = todayStr_();
  return ctx.accounts.filter(function (a) { return a.type === 'credit' && Number(a.closeDay); }).map(function (a) {
    var close = Number(a.closeDay), pay = Number(a.payDay || close);
    var p = today.split('-').map(Number);
    var lastClose = p[2] > close ? new Date(p[0], p[1] - 1, close) : new Date(p[0], p[1] - 2, close);
    var prevClose = new Date(lastClose.getFullYear(), lastClose.getMonth() - 1, close);
    var due = new Date(lastClose.getFullYear(), lastClose.getMonth() + 1, pay);
    var all = ctx.tx.filter(function (t) { return t.account === a.name && t.type === '支'; });
    var closed = all.filter(function (t) { return t.date > fmt_(prevClose) && t.date <= fmt_(lastClose); });
    var open = all.filter(function (t) { return t.date > fmt_(lastClose); });
    var st = settingsMap_(), key = a.name + '_' + fmt_(due);
    var amt = st['billAmt_' + key] !== undefined && st['billAmt_' + key] !== '' ? Number(st['billAmt_' + key]) : sum_(closed);
    return { account: a.name, due: fmt_(due), dueAmount: st['billPaid_' + key] === '1' ? 0 : amt, openAmount: sum_(open) };
  });
}

/* ===================== 小工具 ===================== */

function cycleOf_(dateStr, startDay) {
  var p = dateStr.split('-').map(Number), m = p[1] - 1;
  if (p[2] < startDay) m -= 1;
  return { start: fmt_(new Date(p[0], m, startDay)), end: fmt_(new Date(p[0], m + 1, startDay - 1)) };
}
function dayDiff_(a, b) {
  var x = a.split('-').map(Number), y = b.split('-').map(Number);
  return Math.round((new Date(x[0], x[1] - 1, x[2]) - new Date(y[0], y[1] - 1, y[2])) / 86400000);
}
function sum_(list) { return list.reduce(function (s, t) { return s + Number(t.amount); }, 0); }
function fmtN_(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function matchRule_(merchant) {
  if (!merchant) return '';
  var m = merchant.toLowerCase(), rules = readObjects_('rules');
  for (var i = 0; i < rules.length; i++) if (rules[i].keyword && m.indexOf(String(rules[i].keyword).toLowerCase()) >= 0) return rules[i].category;
  return '';
}
function matchCard_(card) {
  if (!card) return '';
  var c = String(card).toLowerCase(), cards = readObjects_('cards');
  for (var i = 0; i < cards.length; i++) if (cards[i].keyword && c.indexOf(String(cards[i].keyword).toLowerCase()) >= 0) return cards[i].account;
  return '';
}
function parseAmount_(v) {
  if (typeof v === 'number') return Math.round(Math.abs(v));
  var s = String(v || '').replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  var m = s.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Math.round(Number(m[0])) : 0;
}

/* ===================== 試算表讀寫 ===================== */

function sheet_(k) { return ss_().getSheetByName(SHEET_NAMES[k]); }

function readObjects_(k) {
  var sh = sheet_(k), n = sh.getLastRow(), head = SHEETS[k];
  if (n <= 1) return [];
  var vals = sh.getRange(2, 1, n - 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] === '' || vals[i][0] === null) continue;
    var o = {};
    for (var j = 0; j < head.length; j++) {
      var v = vals[i][j];
      if (v instanceof Date) {
        var hms = Utilities.formatDate(v, 'Asia/Tokyo', 'HH:mm:ss');
        v = (head[j] === 'date' || head[j] === 'payDate' || hms === '00:00:00') ? fmt_(v) : Utilities.formatDate(v, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
      }
      o[head[j]] = v === null ? '' : v;
    }
    if ('amount' in o) o.amount = Number(String(o.amount).replace(/,/g, '')) || 0;
    if ('active' in o) o.active = String(o.active).toUpperCase() === 'TRUE' ? 'TRUE' : '';
    out.push(o);
  }
  return out;
}

function rowsOf_(k, rows) {
  var head = SHEETS[k];
  return rows.map(function (r) { return head.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; }); });
}
function writeObjects_(k, rows) {
  var sh = sheet_(k), head = SHEETS[k];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, head.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rowsOf_(k, rows));
}
function appendObjects_(k, rows) {
  if (!rows.length) return;
  var sh = sheet_(k);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS[k].length).setValues(rowsOf_(k, rows));
}
function appendTx_(list) {
  var sh = sheet_('tx'), n = sh.getLastRow(), existing = {};
  if (n > 1) sh.getRange(2, 1, n - 1, 1).getValues().forEach(function (r) { existing[r[0]] = true; });
  var now = nowIso_(), rows = [];
  list.forEach(function (t) {
    if (!t) return;
    t.id = t.id || Utilities.getUuid();
    if (existing[t.id]) return;
    existing[t.id] = true;
    t.createdAt = t.createdAt || now; t.updatedAt = now; t.status = t.status || 'ok'; t.currency = t.currency || 'JPY';
    rows.push(t);
  });
  appendObjects_('tx', rows);
  return rows.length;
}
function findRow_(k, id) {
  var sh = sheet_(k), n = sh.getLastRow();
  if (n <= 1) return -1;
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function updateRow_(k, obj) {
  var r = findRow_(k, obj.id);
  if (r < 0) return 0;
  var head = SHEETS[k], sh = sheet_(k);
  var cur = sh.getRange(r, 1, 1, head.length).getValues()[0];
  obj.updatedAt = nowIso_();
  sh.getRange(r, 1, 1, head.length).setValues([head.map(function (h, j) { return obj[h] === undefined ? cur[j] : obj[h]; })]);
  return 1;
}
function deleteRow_(k, id) {
  var r = findRow_(k, id);
  if (r < 0) return 0;
  sheet_(k).deleteRow(r);
  return 1;
}
function settingsMap_() {
  var m = {};
  readObjects_('settings').forEach(function (r) { m[r.key] = String(r.value); });
  return m;
}
function setSetting_(key, value) {
  var sh = sheet_('settings'), n = sh.getLastRow();
  if (n > 1) {
    var keys = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function todayStr_() { return fmt_(new Date()); }
function fmt_(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
function nowIso_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss"); }
