/* Wen 記帳 — 前端 */
(function () {
  'use strict';
  var L = window.Lib;
  var $app = document.getElementById('app');
  var FUNDS = ['緊急預備金', '台灣準備金', 'NISA'];
  var SOCIAL_RE = /保険|年金|支援金/;

  /* ===================== 狀態與儲存 ===================== */
  var S = {
    cfg: Object.assign({ url: '', token: '', book: 'main', joined: [], ownBooks: [] }, load('kk_cfg', {})),
    data: null,
    queue: load('kk_queue', []),
    tab: 'home', page: null, cycleOffset: 0, search: '', filterCat: '', filterAcc: '', syncing: false
  };
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('手機儲存空間不足：' + e.message); } }
  function dataKey(id) { return id && id !== 'main' ? 'kk_data_' + id : 'kk_data'; }
  function persist() { save(dataKey(S.cfg.book), S.data); save('kk_queue', S.queue); }
  function saveCfg() { save('kk_cfg', S.cfg); }
  S.data = load(dataKey(S.cfg.book), null);
  /* 帳本：自己的帳本用主金鑰＋book；別人共享給我的帳本用對方的網址＋帳本金鑰 */
  function bookEntry(id) {
    id = id || S.cfg.book || 'main';
    var j = S.cfg.joined.filter(function (b) { return b.id === id; })[0];
    if (j) return { id: id, name: j.name, url: j.url, token: j.token, remote: j.remote, joined: true };
    var o = S.cfg.ownBooks.filter(function (b) { return b.id === id; })[0];
    return { id: id, name: id === 'main' ? '我的帳本' : (o ? o.name : id), url: S.cfg.url, token: S.cfg.token, remote: id, joined: false };
  }
  function hasBackend() { return !!(S.cfg.url && S.cfg.token) || S.cfg.joined.length > 0; }
  function isOwnerMain() { return !bookEntry().joined && (S.cfg.book || 'main') === 'main'; }

  function D() { var d = S.data || { tx: [], categories: [], budgets: [], accounts: [], recurring: [], rules: [], cards: [], funds: [], payslips: [], settings: {} }; if (!d.trades) d.trades = []; if (!d.prices) d.prices = []; return d; }
  function setting(k, d) { var v = D().settings[k]; if (k === 'budgetStart' && v) v = String(v).slice(0, 10); return v === undefined || v === '' ? d : v; }
  function startDay() { return Number(setting('cycleStartDay', 10)) || 10; }

  /* ===================== 後端 ===================== */
  function api(action, payload, bookId) {
    var b = bookEntry(bookId);
    if (!b.url || !b.token) return Promise.reject(new Error('還沒設定伺服器網址和 API 金鑰'));
    var body = Object.assign({}, payload || {}, { action: action, token: b.token });
    if (b.remote && b.remote !== 'main') body.book = b.remote;
    return fetch(b.url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw new Error('伺服器回應不是 JSON：' + t.slice(0, 80)); }
        if (!j.ok) throw new Error(j.error || '伺服器錯誤');
        return j;
      });
  }

  /* 寫入動作先改本機，再排進佇列送出（離線也能記） */
  function enqueue(action, payload) {
    S.queue.push({ action: action, payload: payload, at: Date.now(), book: S.cfg.book || 'main' });
    persist();
    flush();
  }

  function flush() {
    if (S.syncing || !S.queue.length || !navigator.onLine) return Promise.resolve();
    S.syncing = true;
    var op = S.queue[0];
    return api(op.action, op.payload, op.book || 'main').then(function () {
      S.queue.shift(); persist(); S.syncing = false;
      return flush();
    }).catch(function (e) {
      S.syncing = false;
      if (/API 金鑰|未知的動作|不能覆蓋/.test(e.message)) { S.queue.shift(); persist(); toast('同步失敗並略過：' + e.message); }
    });
  }

  function refresh(quiet) {
    var bk = S.cfg.book || 'main';
    return flush().then(function () { return api('bootstrap', {}, bk); }).then(function (j) {
      delete j.ok;
      if (bk !== (S.cfg.book || 'main')) return;
      if (j.books) { S.cfg.ownBooks = j.books.filter(function (b) { return b.id !== 'main'; }); saveCfg(); }
      S.data = j; persist(); render();
      if (!quiet) toast('已同步');
    }).catch(function (e) { if (!quiet) toast('同步失敗：' + e.message); });
  }
  window.addEventListener('online', function () { flush(); });

  /* ===================== 小工具 ===================== */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function yen(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-¥' : '¥') + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(16).slice(2)).toUpperCase(); }
  function sum(list) { return list.reduce(function (s, t) { return s + Number(t.amount || 0); }, 0); }
  function toast(msg, ms) {
    [].forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); });
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, ms || 2600);
  }
  function catMap() { var m = {}; D().categories.forEach(function (c) { m[c.name] = c; }); return m; }
  function emoji(cat) { var c = catMap()[cat]; return c && c.emoji ? c.emoji : (cat === '待分類' ? '❓' : '•'); }
  function groupOf(cat) { var c = catMap()[cat]; return c ? c.group : ''; }
  function accMap() { var m = {}; D().accounts.forEach(function (a) { m[a.name] = a; }); return m; }
  function accIcon(name, big) {
    var a = accMap()[name] || {};
    var cls = 'acc-ic' + (big ? ' lg' : '');
    if (a.icon) return '<span class="' + cls + '"><img src="' + esc(a.icon) + '" alt=""></span>';
    var t = String(name || '?').replace(/\s/g, '').slice(0, name && /^[A-Za-z]/.test(name) ? 2 : 1);
    return '<span class="' + cls + '" style="background:' + esc(a.color || '#555') + '">' + esc(t) + '</span>';
  }
  function accCur(name) { var a = accMap()[name]; return a ? (a.currency || (a.type === 'foreign' ? 'TWD' : 'JPY')) : 'JPY'; }
  var CUR_SIGN = { JPY: '¥', TWD: 'NT$', USD: 'US$', EUR: '€', GBP: '£', KRW: '₩', CNY: 'CN¥', HKD: 'HK$', SGD: 'S$', AUD: 'A$', CAD: 'C$', VND: '₫', THB: '฿' };
  function money(n, cur) {
    cur = cur || 'JPY'; if (cur === 'JPY') return yen(n);
    var dec = /^(USD|EUR|GBP|AUD|CAD|SGD|CHF|NZD)$/.test(cur) ? 2 : 0, k = Math.pow(10, dec);
    n = Math.round((Number(n) || 0) * k) / k;
    return (n < 0 ? '-' : '') + (CUR_SIGN[cur] || cur + ' ') + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: dec });
  }
  function catVisible(c) { return String(c.hidden).toUpperCase() !== 'TRUE'; }
  /* 帳戶餘額：起始餘額（某天結束時）＋之後的收入－支出－轉出＋轉入 */
  function accBalance(a) {
    var inv = a.type === 'invest';
    if (!inv && (a.opening === '' || a.opening == null || !a.openingDate)) return null;
    var od = a.openingDate ? String(a.openingDate).slice(0, 10) : '', bal = Number(a.opening) || 0;
    if (inv) (D().trades || []).forEach(function (t) { if (t.account === a.name && t.date > od) bal += tradeCash(t); });
    D().tx.forEach(function (t) {
      if (t.date <= od) return;
      if (t.type === '轉') {
        if (t.account === a.name) bal -= Number(t.amount) || 0;
        if (t.toAccount === a.name) bal += Number(t.toAmount !== '' && t.toAmount != null ? t.toAmount : t.amount) || 0;
      } else if (t.account === a.name) bal += (t.type === '收' ? 1 : -1) * (Number(t.amount) || 0);
    });
    return bal;
  }
  function ensureCategory(name, group, type, em) {
    if (catMap()[name]) return;
    var max = D().categories.reduce(function (m, c) { return Math.max(m, Number(c.order) || 0); }, 0);
    D().categories.push({ name: name, group: group, type: type, emoji: em, order: max + 1, excludeBudget: '', hidden: '' });
    enqueue('saveTable', { table: 'categories', rows: D().categories });
  }
  function cycle(off) { return L.cycleOf(L.today(), startDay(), (off || 0)); }
  function isBudgetable(t) {
    var c = catMap()[t.category] || {};
    return t.type === '支' && (t.currency || 'JPY') === 'JPY' && t.member !== '公司' && String(c.excludeBudget).toUpperCase() !== 'TRUE';
  }
  function txIn(a, b, pred) { return D().tx.filter(function (t) { return t.date >= a && t.date <= b && (!pred || pred(t)); }); }
  function sortTx(list) { return list.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.createdAt).localeCompare(String(a.createdAt)); }); }
  function yearBudgetCats() { var o = {}; D().budgets.forEach(function (b) { if (b.period === 'year') o[b.category] = Number(b.amount); }); return o; }
  function inYearlyOnly(t) { var y = yearBudgetCats(); return y[t.category] !== undefined || y['#' + groupOf(t.category)] !== undefined; }

  /* 預算狀態：月預算（含類別） + 年預算 */
  function budgetState(off) {
    var c = cycle(off), monthly = D().budgets.filter(function (b) { return b.period === 'month' && Number(b.amount); });
    var cyc = txIn(c.start, c.end, isBudgetable);
    var rows = monthly.map(function (b) {
      var spent = sum(cyc.filter(function (t) { return t.category === b.category; }));
      return { category: b.category, group: groupOf(b.category) || '其他', budget: Number(b.amount), spent: spent };
    });
    var budgeted = {}; monthly.forEach(function (b) { budgeted[b.category] = 1; });
    var unbudgeted = cyc.filter(function (t) { return !budgeted[t.category] && !inYearlyOnly(t); });
    var total = rows.reduce(function (s, r) { return s + r.budget; }, 0);
    var spentAll = sum(cyc.filter(function (t) { return !inYearlyOnly(t); }));
    var y = L.today().slice(0, 4), ys = y + '-01-01', bs = setting('budgetStart', ''); if (bs > ys) ys = bs;
    var years = D().budgets.filter(function (b) { return b.period === 'year' && Number(b.amount); }).map(function (b) {
      var isG = b.category.charAt(0) === '#', g = b.category.slice(1);
      var spent = sum(txIn(ys, y + '-12-31', function (t) { return isBudgetable(t) && (isG ? groupOf(t.category) === g : t.category === b.category); }));
      return { category: isG ? g + '（整類）' : b.category, budget: Number(b.amount), spent: spent };
    });
    return { c: c, rows: rows, unbudgeted: unbudgeted, total: total, spent: spentAll, years: years };
  }
  function alertList(st) {
    var p = Number(setting('alertPercent', 80));
    return st.rows.concat(st.years).filter(function (r) { return r.budget && r.spent / r.budget * 100 >= p; })
      .map(function (r) { return { name: r.category, pct: Math.round(r.spent / r.budget * 100) }; })
      .sort(function (a, b) { return b.pct - a.pct; });
  }

  /* ===================== 畫面路由 ===================== */
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var t = b.dataset.tab;
    if (t === 'add') { openTxForm(); return; }
    S.tab = t; S.page = null; S.cycleOffset = 0; render(); window.scrollTo(0, 0);
  });

  function go(page) { S.page = page; render(); window.scrollTo(0, 0); }

  function render() {
    [].forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    if (!hasBackend()) { S.tab = 'more'; S.page = 'settings'; }
    var html;
    if (S.page) html = (PAGES[S.page] || PAGES.settings)();
    else html = ({ home: viewHome, list: viewList, budget: viewBudget, more: viewMore })[S.tab]();
    $app.innerHTML = html;
    bind();
  }

  /* data-act="名稱:參數" 的按鈕事件 */
  function bind() {
    [].forEach.call($app.querySelectorAll('[data-act]'), function (el) {
      el.addEventListener(el.tagName === 'SELECT' || el.tagName === 'INPUT' ? 'change' : 'click', function (e) {
        if (e.type === 'click') { var inner = e.target.closest('input,select,textarea,label,button,[data-act]'); if (inner && inner !== el && el.contains(inner)) return; }
        var parts = el.dataset.act.split(':'), fn = ACTS[parts[0]];
        if (fn) fn(parts.slice(1).join(':'), el, e);
      });
    });
    var s = $app.querySelector('#search');
    if (s) s.addEventListener('input', function () { S.search = s.value; clearTimeout(s._t); s._t = setTimeout(function () { var pos = s.selectionStart; render(); var n = $app.querySelector('#search'); n.focus(); n.setSelectionRange(pos, pos); }, 350); });
  }

  /* ===================== 總覽 ===================== */
  function viewHome() {
    var st = budgetState(0), c = st.c;
    var remain = st.total - st.spent, daysLeft = L.dayDiff(c.end, L.today()) + 1;
    var perDay = Math.max(0, Math.floor(remain / daysLeft));
    var spentToday = sum(txIn(L.today(), L.today(), function (t) { return isBudgetable(t) && !inYearlyOnly(t); }));
    var inbox = D().tx.filter(function (t) { return t.status === 'inbox'; });
    var al = alertList(st);
    var income = sum(txIn(c.start, c.end, function (t) { return t.type === '收' && (t.currency || 'JPY') === 'JPY'; }));
    var pct = st.total ? Math.min(100, st.spent / st.total * 100) : 0;
    var multi = S.cfg.ownBooks.length || S.cfg.joined.length;
    var h = '<div class="row between"><h1>' + (multi ? '<button class="ghost" style="font-size:20px;font-weight:700;padding:0;color:var(--text)" data-act="go:books">📒 ' + esc(bookEntry().name) + ' ▾</button>' : 'Wen 記帳') + '</h1><button class="ghost" data-act="sync">↻ 同步' + (S.queue.length ? '（' + S.queue.length + '）' : '') + '</button></div>';
    if (!S.data) h += '<div class="info">第一次使用：按「同步」從 Google 試算表讀取資料。</div>';
    h += '<div class="card"><div class="sub">本期 ' + c.label + '（剩 ' + daysLeft + ' 天）</div><div class="ring">' + donut(pct, st.spent > st.total ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)') +
      '<div class="grow"><div class="sub">剩餘預算</div><div class="big num ' + (remain < 0 ? 'neg' : 'pos') + '">' + yen(remain) + '</div>' +
      '<div class="sub num">已花 ' + yen(st.spent) + ' ／ 預算 ' + yen(st.total) + '</div></div></div>' +
      '<div class="grid2" style="margin-top:12px"><div><div class="sub">每天可用</div><div class="num" style="font-size:20px;font-weight:700">' + yen(perDay) + '</div></div>' +
      '<div><div class="sub">今天已花</div><div class="num" style="font-size:20px;font-weight:700;' + (spentToday > perDay ? 'color:var(--red)' : '') + '">' + yen(spentToday) + '</div></div></div>' +
      '<div class="sub" style="margin-top:8px">本期收入 ' + yen(income) + '</div></div>';
    var assetCard = assetTotals();
    if (assetCard.any) h += '<button class="card" style="width:100%;text-align:left" data-act="go:assets"><div class="row between"><span>💰 資產</span><span class="sub">›</span></div><div class="row between" style="margin-top:4px">' +
      assetCard.curs.map(function (c) { return '<div><div class="sub">' + c.label + '</div><div class="num" style="font-size:18px;font-weight:700">' + money(c.total, c.cur) + '</div></div>'; }).join('') + '</div></button>';
    al.forEach(function (a) { h += '<div class="alert ' + (a.pct >= 100 ? 'red' : '') + '">' + (a.pct >= 100 ? '⚠️ 已超支：' : '⚠️ 快用完：') + esc(a.name) + ' ' + a.pct + '%</div>'; });
    if (inbox.length) h += '<button class="card" style="width:100%;text-align:left" data-act="openInbox">❓ 待分類 <b>' + inbox.length + '</b> 筆，點這裡選類別 →</button>';
    var bills = cardBills().filter(function (b) { return b.dueAmount > 0; });
    bills.forEach(function (b) { h += '<div class="info">💳 ' + esc(b.account) + ' ' + b.due.slice(5).replace('-', '/') + ' 要繳 ' + yen(b.dueAmount) + '（目前累積下一期 ' + yen(b.openAmount) + '）</div>'; });
    var recent = sortTx(D().tx).slice(0, 8);
    h += '<h2>最近紀錄</h2><div class="card list">' + (recent.length ? recent.map(txRow).join('') : '<div class="empty">還沒有紀錄</div>') + '</div>';
    return h;
  }

  function donut(pct, color) {
    var r = 34, c = 2 * Math.PI * r, d = c * pct / 100;
    return '<svg width="88" height="88" viewBox="0 0 88 88"><circle cx="44" cy="44" r="' + r + '" fill="none" stroke="#2c2c2e" stroke-width="10"/>' +
      '<circle cx="44" cy="44" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + d + ' ' + c + '" transform="rotate(-90 44 44)"/>' +
      '<text x="44" y="49" text-anchor="middle" fill="#f2f2f7" font-size="16" font-weight="600">' + Math.round(pct) + '%</text></svg>';
  }

  function txRow(t) {
    if (t.type === '轉') {
      var cross = t.toCurrency && t.toCurrency !== (t.currency || 'JPY');
      return '<div class="tx" data-act="editTx:' + esc(t.id) + '"><div class="ic">' + (cross ? '💱' : '⇄') + '</div><div class="grow"><div>' + (cross ? '匯款' : '轉帳') + '</div>' +
        '<div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.account) + ' → ' + esc(t.toAccount) + (t.note ? '・' + esc(t.note) : '') + '</div></div>' +
        '<div class="amt num" style="text-align:right">' + money(t.amount, t.currency) + (cross ? '<div class="sub">→ ' + money(t.toAmount, t.toCurrency) + '</div>' : '') + '</div></div>';
    }
    var sign = t.type === '收' ? '+' : t.type === '轉' ? '' : '-';
    var cur = (t.currency || 'JPY') === 'JPY' ? yen(t.amount) : t.currency + ' ' + Number(t.amount).toLocaleString();
    var tags = [];
    if (t.status === 'inbox') tags.push('<span class="pill amber">待分類</span>');
    if (t.member === '公司') tags.push('<span class="pill">' + (String(t.tags).indexOf('已退回') >= 0 ? '公司・已退回' : '公司代墊') + '</span>');
    if (t.source === 'wallet') tags.push('<span class="pill">錢包</span>');
    if (t.source === 'recurring') tags.push('<span class="pill">固定</span>');
    if (Number(t.installments) > 1) tags.push('<span class="pill">分 ' + t.installments + ' 期</span>');
    tagsOf(t).filter(function (g) { return g !== '已退回'; }).forEach(function (g) { tags.push('<span class="pill">#' + esc(g) + '</span>'); });
    if (t.receipt) tags.push('📎');
    return '<div class="tx" data-act="editTx:' + esc(t.id) + '"><div class="ic">' + emoji(t.category) + '</div><div class="grow"><div>' + esc(t.category) + ' ' + tags.join(' ') + '</div>' +
      '<div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + accIcon(t.account).replace('acc-ic', 'acc-ic" style="width:16px;height:16px;font-size:9px;border-radius:4px;vertical-align:-3px') + ' ' + esc(t.account) + (t.note ? '・' + esc(t.note) : '') + '</div></div>' +
      '<div class="amt num ' + (t.type === '收' ? 'pos' : '') + '">' + sign + cur + '</div></div>';
  }

  /* ===================== 明細（搜尋、篩選、匯出） ===================== */
  function viewList() {
    var c = cycle(S.cycleOffset), q = S.search.trim().toLowerCase();
    var list;
    if (q || S.filterCat || S.filterAcc) {
      list = D().tx.filter(function (t) {
        if (S.filterCat && t.category !== S.filterCat) return false;
        if (S.filterAcc && t.account !== S.filterAcc && t.toAccount !== S.filterAcc) return false;
        if (!q) return true;
        return [t.category, t.account, t.toAccount, t.note, t.tags, String(t.amount)].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    } else list = txIn(c.start, c.end);
    list = sortTx(list);
    var searching = q || S.filterCat || S.filterAcc;
    var cats = Object.keys(catMap()), accs = D().accounts.map(function (a) { return a.name; });
    var mode = S.listMode || 'list';
    var h = '<div class="row between"><h1>明細</h1><div class="seg" style="width:140px">' + [['list', '列表'], ['cal', '月曆']].map(function (m) { return '<button data-act="listMode:' + m[0] + '" class="' + (mode === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div></div>';
    if (mode === 'cal') return h + viewCalendar();
    h += '<input id="search" placeholder="搜尋：店名、備註、類別、金額…" value="' + esc(S.search) + '">' +
      '<div class="grid2" style="margin-top:8px"><select data-act="filterCat"><option value="">全部類別</option>' + cats.map(function (x) { return '<option' + (x === S.filterCat ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select data-act="filterAcc"><option value="">全部帳戶</option>' + accs.map(function (x) { return '<option' + (x === S.filterAcc ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>';
    if (!searching) h += '<div class="row between" style="margin-top:10px"><button class="ghost" data-act="cyc:-1">‹ 上一期</button><b>' + c.label + '</b><button class="ghost" data-act="cyc:1">下一期 ›</button></div>';
    var out = sum(list.filter(function (t) { return t.type === '支' && (t.currency || 'JPY') === 'JPY'; }));
    var inc = sum(list.filter(function (t) { return t.type === '收' && (t.currency || 'JPY') === 'JPY'; }));
    h += '<div class="row between sub" style="margin:6px 0"><span>' + list.length + ' 筆・支出 ' + yen(out) + '・收入 ' + yen(inc) + '</span><button class="ghost" data-act="exportList">匯出 CSV</button></div>';
    var byDay = {};
    list.slice(0, 600).forEach(function (t) { (byDay[t.date] = byDay[t.date] || []).push(t); });
    var days = Object.keys(byDay).sort().reverse();
    if (!days.length) h += '<div class="empty">沒有紀錄</div>';
    days.forEach(function (d) {
      var dd = L.parseYmd(d), wd = '日一二三四五六'[dd.getDay()];
      h += '<div class="day-h"><span>' + d.slice(5).replace('-', '/') + '（' + wd + '）</span><span class="num">' + yen(sum(byDay[d].filter(function (t) { return t.type === '支' && (t.currency || 'JPY') === 'JPY'; }))) + '</span></div><div class="card list" style="margin:4px 0">' + byDay[d].map(txRow).join('') + '</div>';
    });
    if (list.length > 600) h += '<div class="sub">只顯示前 600 筆，請縮小搜尋範圍</div>';
    S._lastList = list;
    return h;
  }

  function viewCalendar() {
    var t0 = L.today().split('-').map(Number), base = new Date(t0[0], t0[1] - 1 + (S.calOffset || 0), 1);
    var y = base.getFullYear(), m = base.getMonth(), first = L.fmt(base), last = L.fmt(new Date(y, m + 1, 0));
    var list = txIn(first, last), by = {};
    list.forEach(function (t) {
      var d = by[t.date] = by[t.date] || { out: 0, inc: 0, n: 0 };
      d.n++; if ((t.currency || 'JPY') !== 'JPY') return;
      if (t.type === '支') d.out += Number(t.amount); else if (t.type === '收') d.inc += Number(t.amount);
    });
    var out = sum(list.filter(function (t) { return t.type === '支' && (t.currency || 'JPY') === 'JPY'; })), inc = sum(list.filter(function (t) { return t.type === '收' && (t.currency || 'JPY') === 'JPY'; }));
    var h = '<div class="row between"><button class="ghost" data-act="calMove:-1">‹</button><b>' + y + ' 年 ' + (m + 1) + ' 月</b><button class="ghost" data-act="calMove:1">›</button></div>' +
      '<div class="grid3 card" style="text-align:center"><div><div class="sub">支出</div><b class="num">' + yen(out) + '</b></div><div><div class="sub">收入</div><b class="num pos">' + yen(inc) + '</b></div><div><div class="sub">結餘</div><b class="num ' + (inc - out < 0 ? 'neg' : 'pos') + '">' + yen(inc - out) + '</b></div></div>';
    h += '<div class="cal">' + '日一二三四五六'.split('').map(function (w) { return '<div class="cal-h">' + w + '</div>'; }).join('');
    for (var i = 0; i < base.getDay(); i++) h += '<div></div>';
    var today = L.today();
    for (var d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
      var ds = L.fmt(new Date(y, m, d)), v = by[ds];
      h += '<div class="cal-d' + (ds === today ? ' today' : '') + (S.calDay === ds ? ' on' : '') + '" data-act="calDay:' + ds + '"><b>' + d + '</b>' +
        (v && v.out ? '<span class="neg">' + Math.round(v.out).toLocaleString() + '</span>' : '') + (v && v.inc ? '<span class="pos">+' + Math.round(v.inc).toLocaleString() + '</span>' : '') + (v && !v.out && !v.inc ? '<span class="sub">•</span>' : '') + '</div>';
    }
    h += '</div>';
    var day = S.calDay && S.calDay >= first && S.calDay <= last ? S.calDay : null;
    var show = sortTx(day ? list.filter(function (t) { return t.date === day; }) : []);
    if (day) h += '<h2>' + day.slice(5).replace('-', '/') + '（' + show.length + ' 筆）</h2><div class="card list">' + (show.length ? show.map(txRow).join('') : '<div class="empty">沒有紀錄</div>') + '</div>';
    else h += '<div class="sub" style="margin-top:8px">點日期看當天明細（金額只算日幣）</div>';
    return h;
  }

  /* ===================== 預算 ===================== */
  function viewBudget() {
    var st = budgetState(S.cycleOffset), groups = {};
    st.rows.forEach(function (r) { (groups[r.group] = groups[r.group] || []).push(r); });
    var h = '<div class="row between"><h1>預算</h1><button class="ghost" data-act="go:budgetEdit">編輯預算</button></div>' +
      '<div class="row between"><button class="ghost" data-act="cyc:-1">‹</button><b>' + st.c.label + '</b><button class="ghost" data-act="cyc:1">›</button></div>' +
      '<div class="card"><div class="row between"><span>月預算合計<br><span class="sub">不含年預算、台灣準備金、預備金</span></span><b class="num">' + yen(st.spent) + ' / ' + yen(st.total) + '</b></div>' + bar(st.spent, st.total) + '</div>';
    Object.keys(groups).forEach(function (g) {
      var rs = groups[g], gs = sum(rs.map(function (r) { return { amount: r.spent }; })), gb = sum(rs.map(function (r) { return { amount: r.budget }; }));
      h += '<h2>' + esc(g) + '　<span class="num">' + yen(gs) + ' / ' + yen(gb) + '</span></h2><div class="card">';
      rs.forEach(function (r) {
        h += '<div style="margin:8px 0"><div class="row between"><span>' + emoji(r.category) + ' ' + esc(r.category) + '</span><span class="num ' + (r.spent > r.budget ? 'neg' : '') + '">' + yen(r.spent) + ' / ' + yen(r.budget) + '</span></div>' + bar(r.spent, r.budget) +
          '<div class="sub">剩 ' + yen(r.budget - r.spent) + '</div></div>';
      });
      h += '</div>';
    });
    if (st.unbudgeted.length) {
      var u = {};
      st.unbudgeted.forEach(function (t) { u[t.category] = (u[t.category] || 0) + Number(t.amount); });
      h += '<h2>沒設預算的支出　<span class="num">' + yen(sum(st.unbudgeted)) + '</span></h2><div class="card list">' + Object.keys(u).sort(function (a, b) { return u[b] - u[a]; }).map(function (k) {
        return '<div class="row between"><span>' + emoji(k) + ' ' + esc(k) + '</span><span class="num">' + yen(u[k]) + '</span></div>';
      }).join('') + '</div>';
    }
    if (st.years.length) {
      h += '<h2>年預算（' + L.today().slice(0, 4) + (setting('budgetStart', '') > L.today().slice(0, 4) + '-01-01' ? '，從 ' + setting('budgetStart').slice(5).replace('-', '/') + ' 開始算' : '') + '）</h2><div class="card">';
      st.years.forEach(function (r) { h += '<div style="margin:8px 0"><div class="row between"><span>' + esc(r.category) + '</span><span class="num">' + yen(r.spent) + ' / ' + yen(r.budget) + '</span></div>' + bar(r.spent, r.budget) + '</div>'; });
      h += '</div>';
    }
    return h;
  }
  function bar(v, max) {
    var p = max ? v / max * 100 : 0, al = Number(setting('alertPercent', 80));
    return '<div class="bar ' + (p >= 100 ? 'red' : p >= al ? 'amber' : '') + '"><i style="width:' + Math.min(100, p).toFixed(1) + '%"></i></div>';
  }

  /* ===================== 更多 ===================== */
  function viewMore() {
    var inbox = D().tx.filter(function (t) { return t.status === 'inbox'; }).length;
    var adv = companyOpen();
    var own = isOwnerMain();
    var items = [
      ['books', '📒', '帳本與共享', bookEntry().name],
      ['report', '📊', '報表', ''], ['inbox', '❓', '待分類', inbox ? inbox + ' 筆' : ''],
      ['funds', '🐷', '預備金／台灣／NISA', ''], ['cards', '💳', '信用卡帳單', ''],
      ['company', '💼', '公司代墊', adv.length ? yen(sum(adv)) : ''], ['payslip', '🧾', '薪資明細', D().payslips.length + ' 份'],
      ['salary', '📈', '薪資與扣款分析', ''], ['jobsim', '🔁', '換工作試算', ''],
      ['assets', '💰', '資產（各幣別）', ''], ['invest', '📈', '投資', ''], ['loans', '🏦', '貸款', ''], ['tags', '🔖', '標籤', ''], ['categories', '🗂️', '支出／收入項目', ''],
      ['recurring', '🔂', '固定收支', ''], ['accounts', '💳', '帳戶（付款方式）與圖示', ''], ['rules', '🏷️', '自動分類規則', ''],
      ['import', '📥', '匯入（舊資料／PayPay CSV）', ''], ['shortcuts', '📲', 'iPhone 捷徑設定', ''], ['settings', '⚙️', '設定', '']
    ];
    var PERSONAL = ['funds', 'payslip', 'salary', 'jobsim', 'import', 'shortcuts'];
    if (!own) items = items.filter(function (i) { return PERSONAL.indexOf(i[0]) < 0; });
    return '<h1>更多</h1><div class="menu">' + items.map(function (i) { return '<button data-act="go:' + i[0] + '"><b>' + i[1] + '</b>' + i[2] + '<span class="sub">' + i[3] + '</span></button>'; }).join('') + '</div>';
  }
  function back(title) { return '<button class="back" data-act="back">‹ 返回</button><h1>' + title + '</h1>'; }

  var PAGES = {};

  /* ---------- 報表 ---------- */
  PAGES.report = function () {
    var cs = [];
    for (var i = -11; i <= 0; i++) cs.push(cycle(i));
    var series = cs.map(function (c) {
      return { label: c.start.slice(2, 7).replace('-', '/'), out: sum(txIn(c.start, c.end, isBudgetable)), inc: sum(txIn(c.start, c.end, function (t) { return t.type === '收' && (t.currency || 'JPY') === 'JPY' && t.category !== '退費'; })) };
    });
    var cur = cycle(S.cycleOffset), prev = cycle(S.cycleOffset - 1);
    var byCat = {}, prevCat = {};
    txIn(cur.start, cur.end, isBudgetable).forEach(function (t) { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
    txIn(prev.start, prev.end, isBudgetable).forEach(function (t) { prevCat[t.category] = (prevCat[t.category] || 0) + Number(t.amount); });
    var keys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var max = keys.length ? byCat[keys[0]] : 1;
    var byGroup = {};
    keys.forEach(function (k) { var g = groupOf(k) || '其他'; byGroup[g] = (byGroup[g] || 0) + byCat[k]; });
    var h = back('報表') + '<div class="card"><h3>每期支出與收入（近 12 期）</h3>' + barsChart(series) + '<div class="sub">灰：收入（不含退費）　綠：支出（不含公司代墊、國際匯款）</div></div>';
    h += '<div class="row between"><button class="ghost" data-act="cyc:-1">‹</button><b>' + cur.label + '</b><button class="ghost" data-act="cyc:1">›</button></div>';
    h += '<div class="card"><h3>大類別</h3>' + Object.keys(byGroup).sort(function (a, b) { return byGroup[b] - byGroup[a]; }).map(function (g) {
      return '<div class="row between" style="margin:4px 0"><span>' + esc(g) + '</span><span class="num">' + yen(byGroup[g]) + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="card"><h3>類別（和上一期比）</h3>' + keys.map(function (k) {
      var d = byCat[k] - (prevCat[k] || 0);
      return '<div style="margin:8px 0"><div class="row between"><span>' + emoji(k) + ' ' + esc(k) + '</span><span class="num">' + yen(byCat[k]) + ' <span class="' + (d > 0 ? 'neg' : 'pos') + '" style="font-size:12px">' + (d > 0 ? '▲' : '▼') + yen(Math.abs(d)).replace('¥', '') + '</span></span></div><div class="bar"><i style="width:' + (byCat[k] / max * 100) + '%"></i></div></div>';
    }).join('') + '</div>';
    return h;
  };
  function barsChart(series) {
    var W = 340, H = 170, top = 10, bot = 22, max = Math.max.apply(null, series.map(function (s) { return Math.max(s.out, s.inc); }).concat([1]));
    var bw = Math.min(34, (W - 30) / series.length), y = function (v) { return top + (H - top - bot) * (1 - v / max); };
    var g = '';
    series.forEach(function (s, i) {
      var x = 30 + i * bw;
      g += '<rect x="' + (x + 2) + '" y="' + y(s.inc) + '" width="' + (bw / 2 - 2) + '" height="' + (H - bot - y(s.inc)) + '" fill="#48484a"><title>' + s.label + ' 收入 ' + yen(s.inc) + '</title></rect>';
      g += '<rect x="' + (x + bw / 2) + '" y="' + y(s.out) + '" width="' + (bw / 2 - 2) + '" height="' + (H - bot - y(s.out)) + '" fill="#4cd964"><title>' + s.label + ' 支出 ' + yen(s.out) + '</title></rect>';
      if (i % 2 === 1 || i === series.length - 1) g += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" fill="#98989f" font-size="10" text-anchor="middle">' + s.label + '</text>';
    });
    [0, 0.5, 1].forEach(function (f) { g += '<text x="26" y="' + (y(max * f) + 4) + '" fill="#98989f" font-size="9" text-anchor="end">' + Math.round(max * f / 1000) + 'k</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }

  /* ---------- 待分類 ---------- */
  PAGES.inbox = function () {
    var list = sortTx(D().tx.filter(function (t) { return t.status === 'inbox'; }));
    return back('待分類') + '<div class="sub">錢包或 PayPay 自動記的帳，找不到對應類別時會放這裡。點一筆選類別，可以順便讓同一家店以後自動分類。</div>' +
      '<div class="card list">' + (list.length ? list.map(txRow).join('') : '<div class="empty">全部分類好了 👍</div>') + '</div>';
  };

  /* ---------- 預備金 / 台灣 / NISA ---------- */
  PAGES.funds = function () {
    var h = back('預備金／台灣／NISA');
    FUNDS.forEach(function (f) {
      var list = D().funds.filter(function (x) { return x.fund === f; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var bal = sum(list), target = Number(setting('fund_' + f + '_target', 0)), monthly = Number(setting('fund_' + f + '_monthly', 0));
      h += '<div class="card"><div class="row between"><h3>' + f + '</h3><span class="sub">每月 ' + yen(monthly) + '</span></div><div class="big num">' + yen(bal) + '</div>' +
        (target ? '<div class="sub">目標 ' + yen(target) + '（' + Math.round(bal / target * 100) + '%）' + (monthly && bal < target ? '，照每月 ' + yen(monthly) + ' 還要約 ' + Math.ceil((target - bal) / monthly) + ' 個月' : '') + '</div>' + bar(bal, target) : '') +
        '<div class="grid3" style="margin-top:10px"><button data-act="fundAdd:' + f + ':in">存入</button><button data-act="fundAdd:' + f + ':out">提出</button><button data-act="fundAdd:' + f + ':set">設定餘額</button></div>' +
        (list.length ? '<div class="list" style="margin-top:8px">' + list.slice(0, 6).map(function (x) {
          return '<div class="row between"><span class="sub">' + x.date + ' ' + esc(x.note || '') + '</span><span class="num ' + (x.amount < 0 ? 'neg' : 'pos') + '">' + (x.amount > 0 ? '+' : '') + yen(x.amount) + ' <button class="ghost" data-act="fundDel:' + x.id + '">✕</button></span></div>';
        }).join('') + '</div>' : '') + '</div>';
    });
    h += '<div class="sub">目標和每月金額在「設定」裡改。國際匯款實際匯出時，在台灣準備金按「提出」。</div>';
    return h;
  };

  /* ---------- 信用卡帳單 ---------- */
  function cardBills() {
    var today = L.today(), p = today.split('-').map(Number);
    return D().accounts.filter(function (a) { return a.type === 'credit' && Number(a.closeDay); }).map(function (a) {
      var close = Number(a.closeDay), pay = Number(a.payDay || close);
      var lastClose = p[2] > close ? new Date(p[0], p[1] - 1, close) : new Date(p[0], p[1] - 2, close);
      var prevClose = new Date(lastClose.getFullYear(), lastClose.getMonth() - 1, close);
      var due = new Date(lastClose.getFullYear(), lastClose.getMonth() + 1, pay);
      var nextDue = new Date(lastClose.getFullYear(), lastClose.getMonth() + 2, pay);
      var all = D().tx.filter(function (t) { return t.account === a.name && t.type === '支'; });
      var lc = L.fmt(lastClose), pc = L.fmt(prevClose);
      var nc = L.fmt(new Date(lastClose.getFullYear(), lastClose.getMonth() + 1, close));
      var closed = installParts(all, pc, lc);
      var open = installParts(all, lc, nc);
      var future = installParts(all.filter(function (t) { return Number(t.installments) > 1; }), nc, '9999');
      var dueLimit = L.fmt(new Date(due.getFullYear(), due.getMonth(), due.getDate() + 7));
      var payTx = D().tx.filter(function (t) { return t.type === '轉' && t.toAccount === a.name && t.date > L.fmt(lastClose) && t.date <= dueLimit; })[0];
      var paid = setting('billPaid_' + a.name + '_' + L.fmt(due)) === '1' || !!payTx;
      var actual = setting('billAmt_' + a.name + '_' + L.fmt(due), '');
      var billAmount = actual !== '' ? Number(actual) : sum(closed);
      var ps = new Date(prevClose.getFullYear(), prevClose.getMonth(), prevClose.getDate() + 1);
      return { account: a.name, period: L.fmt(ps) + '～' + lc, due: L.fmt(due), nextDue: L.fmt(nextDue), dueAmount: paid ? 0 : billAmount, billAmount: billAmount, calcAmount: sum(closed), actual: actual !== '', paid: paid, payTx: payTx, openAmount: sum(open), closed: closed, open: open, future: future };
    });
  }
  PAGES.cards = function () {
    var bills = cardBills();
    var h = back('信用卡帳單') + '<div class="sub">刷卡當下已經記成支出。繳卡費請用「轉帳」記（例如 ゆうちょ → Epos），不算支出，記了這期就會自動變成已繳。</div>';
    if (!bills.length) h += '<div class="empty">在「帳戶與圖示」把卡片種類設成信用卡，並填結帳日、繳款日。</div>';
    bills.forEach(function (b) {
      h += '<div class="card"><div class="row">' + accIcon(b.account, true) + '<div class="grow"><h3>' + esc(b.account) + '</h3><div class="sub">結帳期間 ' + b.period.replace(/\d{4}-/g, '').replace(/-/g, '/') + '</div></div></div>' +
        '<div class="grid2" style="margin-top:10px"><div><div class="sub">' + b.due.slice(5).replace('-', '/') + ' 要繳</div><div class="big num">' + yen(b.billAmount) + '</div>' + (b.paid ? '<span class="pill">已繳' + (b.payTx ? '（' + b.payTx.date.slice(5).replace('-', '/') + ' 從' + esc(b.payTx.account) + '）' : '') + '</span>' : '') + '</div>' +
        '<div><div class="sub">下一期累積（' + b.nextDue.slice(5).replace('-', '/') + ' 繳）</div><div class="big num">' + yen(b.openAmount) + '</div></div></div>' +
        (b.actual ? '<div class="sub">已改成帳單實際金額（照刷卡紀錄算是 ' + yen(b.calcAmount) + '）</div>' : '') +
        '<div class="grid2" style="margin-top:10px"><button data-act="billAmt:' + esc(b.account) + ':' + b.due + '">輸入帳單實際金額</button><button data-act="billPaid:' + esc(b.account) + ':' + b.due + '">' + (b.paid ? '改成未繳' : '標記這期已繳') + '</button></div>' +
        (b.future.length ? '<div class="sub" style="margin-top:8px">之後還有分期 ' + yen(sum(b.future)) + '（' + b.future.length + ' 期）</div>' : '') +
        '<h2>這期明細（' + b.closed.length + ' 筆）</h2><div class="list">' + sortTx(b.closed).map(function (t) { return txRow(t).replace('</div></div></div>', (t._part ? '<div class="sub">第 ' + t._part + ' 期</div>' : '') + '</div></div></div>'); }).join('') + '</div></div>';
    });
    return h;
  };

  /* ---------- 公司代墊 ---------- */
  function companyOpen() { return D().tx.filter(function (t) { return t.member === '公司' && t.type === '支' && String(t.tags).indexOf('已退回') < 0; }); }
  PAGES.company = function () {
    var open = sortTx(companyOpen());
    var done = sortTx(D().tx.filter(function (t) { return t.member === '公司' && t.type === '支' && String(t.tags).indexOf('已退回') >= 0; })).slice(0, 20);
    var h = back('公司代墊') + '<div class="sub">記帳時「成員」選「公司」就會算成代墊，不會算進你的預算。公司退錢後在這裡勾選標記。</div>' +
      '<div class="card"><div class="sub">還沒退回</div><div class="big num">' + yen(sum(open)) + '</div><div class="sub">' + open.length + ' 筆</div></div>';
    if (open.length) {
      h += '<div class="card list">' + open.map(function (t) {
        return '<div class="row"><input type="checkbox" class="advchk" value="' + esc(t.id) + '" style="width:22px;height:22px"><div class="grow">' + txRow(t) + '</div></div>';
      }).join('') + '</div><label class="row" style="margin:8px 0"><input type="checkbox" id="advIncome" style="width:20px;height:20px"> 同時記一筆「退費」收入（退回的錢會進你的帳戶時勾）</label>' +
        '<div class="grid2"><button class="primary" data-act="advDone">勾選的標記已退回</button><button data-act="advBefore">某日期以前全部標記</button></div>';
    }
    if (done.length) h += '<h2>最近已退回</h2><div class="card list">' + done.map(txRow).join('') + '</div>';
    return h;
  };

  /* ---------- 薪資明細 ---------- */
  PAGES.payslip = function () {
    var list = slips().sort(function (a, b) { return (a.payDate || a.month) < (b.payDate || b.month) ? 1 : -1; });
    var gs = D().payslips.filter(isGensen).sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    var h = back('薪資明細') + '<div class="card"><h3>上傳薪資單 PDF</h3><div class="sub">會自動讀出各項支給、社保、稅金和實領金額，確認後存檔。</div>' +
      '<input type="file" accept="application/pdf,image/*" data-act="payslipFile" style="margin-top:10px"></div><div id="psPreview"></div>';
    h += '<h2>已存的明細</h2><div class="card list">' + (list.length ? list.map(function (p) {
      var it = psItems(p);
      return '<div class="row between" data-act="psView:' + p.id + '"><span>' + esc(psLabel(p)) + (isBonus(p) ? ' <span class="tag">賞与</span>' : '') + '<br><span class="sub">' + esc((it.company || '').replace(/（.*）/, '') + (p.payDate ? '　' + p.payDate + ' 入帳' : '')) + '</span></span><span class="num">實領 ' + yen(p.net) + ' ›</span></div>';
    }).join('') : '<div class="empty">還沒有</div>') + '</div>';
    if (gs.length) h += '<h2>源泉徴収票</h2><div class="card list">' + gs.map(function (g) {
      var it = psItems(g);
      return '<div class="row between" data-act="psView:' + g.id + '"><span>' + esc(it.year || g.month) + ' 年<br><span class="sub">' + esc(it.company || '') + '</span></span><span class="num">支払金額 ' + yen(g.gross) + ' ›</span></div>';
    }).join('') + '</div>';
    return h;
  };
  function isGensen(p) { return /^gensen-/.test(p.id); }
  function slips() { return D().payslips.filter(function (p) { return !isGensen(p); }); }
  function isBonus(p) { return psItems(p).kind === '賞与' || /bonus/.test(p.id); }
  function psLabel(p) { var it = psItems(p); return it.title || (p.month + ' 支払分'); }
  function psItems(p) { try { return typeof p.items === 'string' ? JSON.parse(p.items || '{}') : (p.items || {}); } catch (e) { return {}; } }

  PAGES.salary = function () {
    var list = slips().sort(function (a, b) { return (a.payDate || a.month) < (b.payDate || b.month) ? -1 : 1; });
    var regular = list.filter(function (p) { return !isBonus(p); });
    var h = back('薪資與扣款分析');
    if (!list.length) return h + '<div class="empty">先到「薪資明細」上傳薪資單</div>';
    var series = regular.slice(-12).map(function (p) { return { label: p.month.slice(2).replace('-', '/'), inc: Number(p.gross), out: Number(p.net) }; });
    h += '<div class="card"><h3>每月總支給與實領</h3>' + barsChart(series) + '<div class="sub">灰：總支給　綠：實領（不含賞与，依支払月）</div></div>';
    var years = {};
    list.forEach(function (p) {
      var y = p.month.slice(0, 4), it = psItems(p), d = it.deduct || {};
      var o = years[y] = years[y] || { gross: 0, bonus: 0, social: 0, itax: 0, rtax: 0, net: 0, n: 0 };
      o.gross += Number(p.gross); o.net += Number(p.net);
      if (isBonus(p)) o.bonus += Number(p.gross); else o.n++;
      Object.keys(d).forEach(function (k) { if (SOCIAL_RE.test(k)) o.social += d[k]; else if (/所得税|年末調整/.test(k)) o.itax += d[k]; else if (/住民税/.test(k)) o.rtax += d[k]; });
    });
    h += '<div class="card scroll-x"><h3>年度統計（依支払月）</h3><table class="t"><tr><th>年</th><th>月數</th><th>總支給（年收）</th><th>其中賞与</th><th>社保</th><th>所得税</th><th>住民税</th><th>實領</th></tr>' +
      Object.keys(years).sort().reverse().map(function (y) { var o = years[y]; return '<tr><td>' + y + '</td><td>' + o.n + '</td><td>' + yen(o.gross) + '</td><td>' + (o.bonus ? yen(o.bonus) : '-') + '</td><td>' + yen(o.social) + '</td><td>' + yen(o.itax) + '</td><td>' + yen(o.rtax) + '</td><td>' + yen(o.net) + '</td></tr>'; }).join('') + '</table></div>';
    var gs = D().payslips.filter(isGensen).sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    if (gs.length) {
      h += '<div class="card scroll-x"><h3>和源泉徴収票對照</h3><div class="sub">薪資單合計＝同一年、同一家公司的薪資單（含賞与）；課稅額不含通勤等非課税項目。</div><table class="t"><tr><th>年／公司</th><th>項目</th><th>源泉徴収票</th><th>薪資單合計</th><th>差</th></tr>' +
        gs.map(function (g) {
          var gi = psItems(g), fld = gi.fields || {}, co = gi.company || '';
          var mine = list.filter(function (p) { return p.month.slice(0, 4) === String(gi.year || g.month) && (psItems(p).company || '') === co; });
          var tot = { pay: 0, social: 0, itax: 0 };
          mine.forEach(function (p) {
            var it = psItems(p), pay = it.pay || {}, d = it.deduct || {};
            tot.pay += Number(p.gross) - Object.keys(pay).filter(function (k) { return /非課税/.test(k); }).reduce(function (s, k) { return s + pay[k]; }, 0);
            Object.keys(d).forEach(function (k) { if (SOCIAL_RE.test(k)) tot.social += d[k]; else if (/所得税|年末調整/.test(k)) tot.itax += d[k]; });
          });
          var rows = [['支払金額', fld['支払金額'], tot.pay], ['社会保険料', fld['社会保険料等の金額'], tot.social], ['源泉徴収税額', fld['源泉徴収税額'], tot.itax]];
          return rows.map(function (r, i) {
            var diff = (r[1] || 0) - r[2];
            return '<tr>' + (i ? '' : '<td rowspan="3">' + esc(String(gi.year || g.month)) + '<br><span class="sub">' + esc(co.replace(/（.*）/, '')) + '・' + mine.length + ' 份</span></td>') + '<td>' + r[0] + '</td><td class="num">' + yen(r[1] || 0) + '</td><td class="num">' + yen(r[2]) + '</td><td class="num' + (diff ? ' warn' : '') + '">' + (diff ? diff.toLocaleString() : '一致') + '</td></tr>';
          }).join('') + (gi.note ? '<tr><td colspan="5" class="sub">' + esc(gi.note) + '</td></tr>' : '');
        }).join('') + '</table></div>';
    }
    var last = regular.slice(-6), keys = {};
    last.forEach(function (p) { Object.keys(psItems(p).deduct || {}).forEach(function (k) { keys[k] = 1; }); });
    h += '<div class="card scroll-x"><h3>社保與稅金繳納紀錄</h3><div class="sub">和前一個月差超過 10% 會標黃色</div><table class="t"><tr><th>項目</th>' + last.map(function (p) { return '<th>' + p.month.slice(2).replace('-', '/') + '</th>'; }).join('') + '</tr>' +
      Object.keys(keys).map(function (k) {
        return '<tr><td>' + esc(k) + '</td>' + last.map(function (p, i) {
          var v = (psItems(p).deduct || {})[k] || 0, pv = i ? ((psItems(last[i - 1]).deduct || {})[k] || 0) : v;
          var changed = i && Math.abs(v - pv) > Math.max(1, pv) * 0.1;
          return '<td class="num' + (changed ? ' warn' : '') + '">' + v.toLocaleString() + '</td>';
        }).join('') + '</tr>';
      }).join('') + '<tr><td><b>控除合計</b></td>' + last.map(function (p) { return '<td class="num"><b>' + Number(p.deduction).toLocaleString() + '</b></td>'; }).join('') + '</tr></table></div>';
    var lp = regular[regular.length - 1] || list[list.length - 1], li = psItems(lp), ld = li.deduct || {}, lpay = li.pay || {};
    var social = Object.keys(ld).filter(function (k) { return SOCIAL_RE.test(k); }).reduce(function (s, k) { return s + ld[k]; }, 0);
    var nontax = Object.keys(lpay).filter(function (k) { return /非課税/.test(k); }).reduce(function (s, k) { return s + lpay[k]; }, 0);
    h += '<div class="card"><h3>最新一期（' + lp.month + '）重點</h3><div class="sub">社保占課稅薪資 ' + (social / Math.max(1, lp.gross - nontax) * 100).toFixed(1) + '%，控除占總支給 ' + (lp.deduction / lp.gross * 100).toFixed(1) + '%。住民税 ' + yen(ld['住民税'] || 0) + ' 是從薪水扣（特別徴収），不用自己另外繳。</div></div>';
    return h;
  };

  /* ---------- 換工作試算 ---------- */
  PAGES.jobsim = function () {
    var list = slips().filter(function (p) { return !isBonus(p); }).sort(function (a, b) { return (a.payDate || a.month) < (b.payDate || b.month) ? -1 : 1; });
    var lp = list[list.length - 1];
    var it = lp ? psItems(lp) : { pay: {}, deduct: {} }, d = it.deduct || {}, pay = it.pay || {};
    var nontax = Object.keys(pay).filter(function (k) { return /非課税/.test(k); }).reduce(function (s, k) { return s + pay[k]; }, 0);
    var social = Object.keys(d).filter(function (k) { return SOCIAL_RE.test(k); }).reduce(function (s, k) { return s + d[k]; }, 0);
    var taxable = lp ? lp.gross - nontax : 0;
    var sRate = taxable ? social / taxable : 0.145;
    var iRate = taxable ? (d['所得税'] || 0) / Math.max(1, taxable - social) : 0.025;
    var rtax = d['住民税'] || 0;
    var v = S.sim || { base: 210000, allow: 0, commute: 0, otHours: 20, otBase: 160, bonusMonths: 4, rtax: rtax };
    S.sim = v;
    var otPay = Math.round(v.base / (v.otBase || 160) * 1.25 * v.otHours);
    var gross = v.base + v.allow + v.commute + otPay;
    var taxableNew = gross - v.commute;
    var sNew = Math.round(taxableNew * sRate);
    var iNew = Math.round(Math.max(0, taxableNew - sNew) * iRate);
    var netNew = gross - sNew - iNew - Number(v.rtax || 0);
    var bonus = v.base * v.bonusMonths;
    var bonusNet = Math.round(bonus * (1 - sRate) * (1 - Math.max(iRate * 1.6, 0.04)));
    var curNet = lp ? Number(lp.net) : 0;
    var monthlyBudget = D().budgets.reduce(function (s, b) { return s + (b.period === 'month' ? Number(b.amount) : Number(b.amount) / 12); }, 0) + Number(setting('fund_台灣準備金_monthly', 0));
    var h = back('換工作試算') + '<div class="sub">用你最新一期薪資單的社保率 ' + (sRate * 100).toFixed(1) + '%、所得税率 ' + (iRate * 100).toFixed(1) + '% 估算，只是概算。住民税第一年照舊（依前一年收入）。</div><div class="card">';
    [['base', '基本給（月）'], ['allow', '固定手当（月，課稅）'], ['commute', '通勤手当（非課稅）'], ['otHours', '預估加班時數（月）'], ['otBase', '月所定工時（算時薪用）'], ['bonusMonths', '賞与（一年幾個月）'], ['rtax', '住民税（月）']].forEach(function (f) {
      h += '<div class="edit-row"><span>' + f[1] + '</span><input type="number" inputmode="decimal" value="' + v[f[0]] + '" data-act="simSet:' + f[0] + '"></div>';
    });
    h += '</div><div class="card"><div class="row between"><span>加班費（1.25 倍）</span><span class="num">' + yen(otPay) + '</span></div>' +
      '<div class="row between"><span>月總支給</span><span class="num">' + yen(gross) + '</span></div>' +
      '<div class="row between"><span>社保／所得税／住民税</span><span class="num">-' + yen(sNew + iNew + Number(v.rtax || 0)).replace('¥', '') + '</span></div>' +
      '<div class="row between"><b>月實領（估）</b><b class="num">' + yen(netNew) + '</b></div>' +
      '<div class="row between sub"><span>現在月實領</span><span class="num">' + yen(curNet) + '（差 ' + yen(netNew - curNet) + '）</span></div>' +
      '<div class="row between" style="margin-top:8px"><span>賞与實領（估，一年）</span><span class="num">' + yen(bonusNet) + '</span></div>' +
      '<div class="row between"><b>年實領（估）</b><b class="num">' + yen(netNew * 12 + bonusNet) + '</b></div>' +
      '<div class="row between sub"><span>現在年實領</span><span class="num">' + yen(curNet * 12) + '（差 ' + yen(netNew * 12 + bonusNet - curNet * 12) + '）</span></div>' +
      '<div class="row between" style="margin-top:8px"><span>每月預算＋台灣準備金</span><span class="num">' + yen(monthlyBudget) + '</span></div>' +
      '<div class="row between"><span>不含賞与時每月</span><span class="num ' + (netNew - monthlyBudget < 0 ? 'neg' : 'pos') + '">' + yen(netNew - monthlyBudget) + '</span></div></div>';
    return h;
  };

  /* ---------- 固定支出 ---------- */
  PAGES.recurring = function () {
    var rows = D().recurring;
    var h = back('固定收支') + '<div class="sub">每天早上 6 點自動檢查，到了日子就記一筆（每月的支出若同月已有同類別同金額就不重複記）。可以是支出（房租、訂閱）、收入（薪水）或轉帳（儲值、還款）。電費、瓦斯費金額每月不同，請手動記。</div><div class="card">';
    rows.forEach(function (r, i) {
      var type = r.type || '支', freq = r.freq || 'month';
      h += '<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="seg" style="margin-bottom:6px">' + [['支', '支出'], ['收', '收入'], ['轉', '轉帳']].map(function (x) { return '<button data-act="recType:' + i + ':' + x[0] + '" class="' + (type === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="grid2"><input value="' + esc(r.name) + '" data-act="recSet:' + i + ':name" placeholder="名稱"><input type="number" value="' + r.amount + '" data-act="recSet:' + i + ':amount" placeholder="金額"></div>' +
        '<div class="grid2" style="margin-top:6px">' + (type === '轉' ? '<div><span class="sub">從</span>' + accSelect(r.account, 'recSet:' + i + ':account') + '</div><div><span class="sub">到</span>' + accSelect(r.toAccount, 'recSet:' + i + ':toAccount') + '</div>'
          : catSelectT(r.category, 'recSet:' + i + ':category', type) + accSelect(r.account, 'recSet:' + i + ':account')) + '</div>' +
        '<div class="grid3" style="margin-top:6px"><select data-act="recFreq:' + i + '">' + [['month', '每月'], ['week', '每週'], ['year', '每年']].map(function (x) { return '<option value="' + x[0] + '"' + (freq === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
        (freq === 'week' ? '<select data-act="recSet:' + i + ':day">' + '日一二三四五六'.split('').map(function (w, k) { return '<option value="' + k + '"' + (Number(r.day) % 7 === k ? ' selected' : '') + '>星期' + w + '</option>'; }).join('') + '</select><span></span>'
          : (freq === 'year' ? '<input type="number" min="1" max="12" value="' + (r.month || 1) + '" data-act="recSet:' + i + ':month" placeholder="月">' : '') + '<input type="number" min="1" max="31" value="' + r.day + '" data-act="recSet:' + i + ':day" placeholder="幾號">' + (freq === 'year' ? '' : '<span></span>')) + '</div>' +
        '<div class="row between" style="margin-top:4px"><label class="row sub"><input type="checkbox" ' + (r.active ? 'checked' : '') + ' data-act="recSet:' + i + ':active" style="width:18px;height:18px"> 啟用</label><button class="ghost" data-act="recDel:' + i + '">刪除</button></div></div>';
    });
    h += '</div><div class="grid2"><button data-act="recAdd">＋ 新增</button><button class="primary" data-act="recSave">儲存</button></div>';
    return h;
  };
  function catSelectT(v, act, type) { return '<select data-act="' + act + '">' + D().categories.filter(function (c) { return c.type === type && (catVisible(c) || c.name === v); }).map(function (c) { return '<option' + (c.name === v ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>'; }
  function catSelect(v, act) { return '<select data-act="' + act + '">' + D().categories.map(function (c) { return '<option' + (c.name === v ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>'; }
  function accSelect(v, act) { return '<select data-act="' + act + '">' + D().accounts.map(function (a) { return '<option' + (a.name === v ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>'; }

  /* ---------- 帳戶 ---------- */
  var ACC_TYPES = { bank: '銀行', debit: '簽帳卡', credit: '信用卡', emoney: '電子錢包', cash: '現金', foreign: '台灣／外幣', invest: '證券／投資', loan: '貸款' };
  PAGES.accounts = function () {
    var h = back('帳戶與圖示') + '<div class="sub">點圖示可以從相簿選一張圖當帳戶圖示。</div>';
    D().accounts.forEach(function (a, i) {
      if (a._orig === undefined) a._orig = a.name;
      var used = D().tx.some(function (t) { return t.account === a.name || t.toAccount === a.name; });
      h += '<div class="card"><div class="row"><label style="cursor:pointer">' + accIcon(a.name, true) + '<input type="file" accept="image/*" hidden data-act="accIcon:' + i + '"></label>' +
        '<input class="grow" value="' + esc(a.name) + '" data-act="accSet:' + i + ':name"><input type="color" value="' + esc(a.color || '#555555') + '" data-act="accSet:' + i + ':color" style="width:46px;padding:2px;height:40px"></div>' +
        '<div class="grid2" style="margin-top:8px"><select data-act="accSet:' + i + ':type">' + Object.keys(ACC_TYPES).map(function (k) { return '<option value="' + k + '"' + (a.type === k ? ' selected' : '') + '>' + ACC_TYPES[k] + '</option>'; }).join('') + '</select>' +
        '<label class="row sub"><input type="checkbox" ' + (a.active ? 'checked' : '') + ' data-act="accSet:' + i + ':active" style="width:18px;height:18px"> 記帳時顯示</label></div>' +
        '<div class="grid2" style="margin-top:8px"><select data-act="accSet:' + i + ':currency">' + currencyOptions(accCur(a.name)) + '</select>' +
        '<button class="ghost" data-act="go:assets">起始餘額 ' + (accBalance(a) === null ? '未設定' : money(a.opening, accCur(a.name))) + ' ›</button></div>' +
        (a.type === 'credit' ? '<div class="grid3" style="margin-top:8px"><input type="number" value="' + (a.closeDay || '') + '" placeholder="結帳日" data-act="accSet:' + i + ':closeDay"><input type="number" value="' + (a.payDay || '') + '" placeholder="繳款日" data-act="accSet:' + i + ':payDay">' + accSelect(a.payAccount, 'accSet:' + i + ':payAccount') + '</div><div class="sub">結帳日／繳款日（隔月）／扣款帳戶</div><label class="row sub" style="margin-top:6px"><input type="checkbox" ' + (String(a.autopay).toUpperCase() === 'TRUE' ? 'checked' : '') + ' data-act="accSet:' + i + ':autopay" style="width:18px;height:18px"> 自動扣款：繳款日自動記一筆轉帳（扣款帳戶 → 這張卡）</label>' : '') +
        (a.type === 'loan' ? '<button class="ghost" data-act="go:loans">利率、每月還款在「貸款」設定 ›</button>' : '') + (a.type === 'invest' ? '<button class="ghost" data-act="go:invest">持股、交易在「投資」 ›</button>' : '') +
        '<div class="row between" style="margin-top:4px">' + (a.icon ? '<button class="ghost" data-act="accIconDel:' + i + '">移除圖示</button>' : '<span></span>') +
        (used ? '<span class="sub">有紀錄，不能刪（可取消「記帳時顯示」）</span>' : '<button class="ghost" data-act="accDel:' + i + '">刪除</button>') + '</div></div>';
    });
    h += '<div class="grid2"><button data-act="accAdd">＋ 新增帳戶</button><button class="primary" data-act="accSave">儲存</button></div>';
    return h;
  };

  /* ---------- 資產（日幣、台幣分開算） ---------- */
  var CUR_LABEL = { JPY: '日幣', TWD: '台幣', USD: '美金' };
  function assetTotals() {
    var by = {}, any = false;
    D().accounts.forEach(function (a) {
      var b = accValue(a); if (b === null) return;
      any = true; var c = accCur(a.name); by[c] = (by[c] || 0) + b;
    });
    return { any: any, curs: Object.keys(by).sort(function (a, b) { return (CURRENCIES.indexOf(a) + 99) % 99 - (CURRENCIES.indexOf(b) + 99) % 99; }).map(function (c) { return { cur: c, label: CUR_LABEL[c] || c, total: by[c] }; }) };
  }
  PAGES.assets = function () {
    var h = back('資產') + '<div class="sub">每個帳戶填一次「起始餘額」（某一天結束時的餘額），之後的記帳、轉帳、匯款會自動加減。信用卡填目前還沒繳的金額。</div>' +
      '<button class="primary" style="width:100%;margin:10px 0" data-act="newTransfer">⇄ 轉帳／匯款</button>';
    var cursUsed = ['JPY', 'TWD', 'USD'].concat(D().accounts.map(function (a) { return accCur(a.name); })).filter(function (c, i, arr) { return arr.indexOf(c) === i; });
    cursUsed.forEach(function (cur) {
      var accs = D().accounts.filter(function (a) { return accCur(a.name) === cur && (a.active || accBalance(a) !== null); });
      if (!accs.length) return;
      var tot = accs.reduce(function (s, a) { var b = accValue(a); return s + (b === null ? 0 : b); }, 0);
      h += '<h2>' + (CUR_LABEL[cur] || cur) + '<span class="num" style="float:right">' + money(tot, cur) + '</span></h2><div class="card list">';
      accs.forEach(function (a) {
        var b = accValue(a), credit = a.type === 'credit' || a.type === 'loan', editing = S.assetEdit === a.name && a.type !== 'invest';
        h += '<div><div class="row between" data-act="assetEdit:' + esc(a.name) + '"><span class="row">' + accIcon(a.name) + ' ' + esc(a.name) + (a.type === 'credit' ? ' <span class="sub">信用卡</span>' : a.type === 'loan' ? ' <span class="sub">貸款</span>' : a.type === 'invest' ? ' <span class="sub">投資（含持股市值）</span>' : '') + '</span>' +
          (b === null ? '<span class="sub">設定起始餘額 ›</span>' : '<span class="num' + (b < 0 ? ' neg' : '') + '">' + (credit && b < 0 ? (a.type === 'loan' ? '欠 ' : '未繳 ') + money(-b, cur) : money(b, cur)) + '</span>') + '</div>';
        if (editing) {
          var val = a.opening === '' || a.opening == null ? '' : (credit ? -Number(a.opening) : Number(a.opening));
          h += '<div class="grid2" style="margin:6px 0"><div><label class="f">' + (credit ? '當天結束時未繳金額' : '當天結束時餘額') + '（' + cur + '）</label><input id="opAmt" type="number" inputmode="decimal" value="' + val + '"></div>' +
            '<div><label class="f">哪一天</label><input id="opDate" type="date" value="' + esc(a.openingDate || L.today()) + '"></div></div>' +
            '<div class="sub">這天（含）以前的紀錄不會再加減，之後的才會。</div>' +
            '<div class="grid2" style="margin:6px 0 10px"><button data-act="assetClear:' + esc(a.name) + '">清除</button><button class="primary" data-act="assetSave:' + esc(a.name) + '">儲存</button></div>';
        }
        h += '</div>';
      });
      h += '</div>';
    });
    var all = assetTotals(), totJ = 0, miss = [];
    all.curs.forEach(function (c) { var v = convert(c.total, c.cur, 'JPY'); if (v === null) miss.push(c.cur); else totJ += v; });
    if (all.any) h += '<div class="card"><div class="row between"><span>淨資產（換算日圓）</span><b class="num">' + yen(totJ) + '</b></div>' +
      (fxRate('TWD') ? '<div class="row between sub"><span>換算台幣</span><span class="num">' + money(totJ / fxRate('TWD'), 'TWD') + '</span></div>' : '') +
      '<div class="sub">匯率：' + ['TWD', 'USD'].concat(all.curs.map(function (c) { return c.cur; })).filter(function (c, i, a) { return c !== 'JPY' && a.indexOf(c) === i && fxRate(c); }).map(function (c) { return '1 ' + c + '＝' + fxRate(c).toFixed(c === 'TWD' ? 3 : 2) + ' 円'; }).join('、') + (miss.length ? '（' + miss.join('、') + ' 還沒有匯率）' : '') + '</div>' +
      '<button class="ghost" data-act="refreshPrices">↻ 更新匯率和股價</button></div>';
    var rem = sortTx(D().tx.filter(function (t) { return t.type === '轉' && t.toCurrency && t.toCurrency !== (t.currency || 'JPY'); })).slice(0, 10);
    if (rem.length) {
      h += '<h2>匯款紀錄</h2><div class="card list">' + rem.map(function (t) {
        var fee = D().tx.filter(function (x) { return x.id === t.id + '-fee'; })[0];
        var r = Number(t.toAmount) ? Number(t.amount) / Number(t.toAmount) : 0;
        return '<div data-act="editTx:' + esc(t.id) + '"><div class="row between"><span>' + t.date.slice(5).replace('-', '/') + ' ' + esc(t.account) + ' → ' + esc(t.toAccount) + '</span><span class="num">' + money(t.amount, t.currency) + ' → ' + money(t.toAmount, t.toCurrency) + '</span></div>' +
          '<div class="sub">實際匯率 1 ' + t.toCurrency + ' ＝ ' + r.toFixed(3) + ' ' + (t.currency || 'JPY') + (fee ? '・手續費 ' + money(fee.amount, fee.currency) : '') + '</div></div>';
      }).join('') + '</div>';
    }
    return h;
  };

  /* ---------- 支出／收入項目 ---------- */
  PAGES.categories = function () {
    var type = S.catType || '支';
    var h = back('支出／收入項目') + '<div class="seg" style="margin:8px 0">' + ['支', '收'].map(function (x) { return '<button data-act="catType:' + x + '" class="' + (type === x ? 'on' : '') + '">' + (x === '支' ? '支出' : '收入') + '</button>'; }).join('') + '</div>' +
      '<div class="sub">改名稱會連舊紀錄、預算、固定支出一起改。用不到的可以勾「隱藏」，記帳畫面就不會出現。</div>';
    var groups = {}, order = [];
    D().categories.forEach(function (c, i) {
      if (c.type !== type) return;
      if (c._orig === undefined) c._orig = c.name;
      if (!groups[c.group]) { groups[c.group] = []; order.push(c.group); }
      groups[c.group].push({ c: c, i: i });
    });
    var counts = {}; D().tx.forEach(function (t) { counts[t.category] = (counts[t.category] || 0) + 1; });
    h += '<datalist id="grpList">' + order.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>';
    order.forEach(function (g) {
      h += '<h2>' + esc(g || '（未分大類別）') + '</h2><div class="card">';
      groups[g].sort(function (a, b) { return Number(a.c.order) - Number(b.c.order); }).forEach(function (x) {
        var c = x.c, i = x.i, n = counts[c._orig || c.name] || 0;
        h += '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="row"><input value="' + esc(c.emoji) + '" data-act="catSet:' + i + ':emoji" style="width:52px;text-align:center"><input class="grow" value="' + esc(c.name) + '" data-act="catSet:' + i + ':name"><input value="' + esc(c.group) + '" list="grpList" data-act="catSet:' + i + ':group" style="width:84px" placeholder="大類別"></div>' +
          '<div class="row between" style="margin-top:4px"><span class="row sub">' +
          (type === '支' ? '<label class="row"><input type="checkbox" ' + (String(c.excludeBudget).toUpperCase() === 'TRUE' ? 'checked' : '') + ' data-act="catSet:' + i + ':excludeBudget" style="width:18px;height:18px"> 不算預算</label>　' : '') +
          '<label class="row"><input type="checkbox" ' + (catVisible(c) ? '' : 'checked') + ' data-act="catSet:' + i + ':hidden" style="width:18px;height:18px"> 隱藏</label>　' + n + ' 筆</span>' +
          '<span><button class="ghost" data-act="catMove:' + i + ':-1">↑</button><button class="ghost" data-act="catMove:' + i + ':1">↓</button>' + (n ? '' : '<button class="ghost" data-act="catDel:' + i + '">✕</button>') + '</span></div></div>';
      });
      h += '</div>';
    });
    h += '<div class="grid2"><button data-act="catAdd">＋ 新增項目</button><button class="primary" data-act="catSave">儲存</button></div>';
    return h;
  };
  function renameLocal(kind, from, to) {
    if (kind === 'category') {
      D().tx.forEach(function (t) { if (t.category === from) t.category = to; });
      D().budgets.forEach(function (b) { if (b.category === from) b.category = to; });
      D().recurring.forEach(function (r) { if (r.category === from) r.category = to; });
      D().rules.forEach(function (r) { if (r.category === from) r.category = to; });
    } else {
      D().tx.forEach(function (t) { if (t.account === from) t.account = to; if (t.toAccount === from) t.toAccount = to; });
      D().recurring.forEach(function (r) { if (r.account === from) r.account = to; });
      D().rules.forEach(function (r) { if (r.account === from) r.account = to; });
      D().cards.forEach(function (r) { if (r.account === from) r.account = to; });
      D().accounts.forEach(function (a) { if (a.payAccount === from) a.payAccount = to; });
    }
  }

  /* ===================== 匯率、投資、貸款、標籤、帳本、隱私鎖 ===================== */
  var CURRENCIES = ['JPY', 'TWD', 'USD', 'EUR', 'KRW', 'CNY', 'HKD', 'VND', 'THB', 'SGD', 'GBP', 'AUD', 'CAD', 'CHF', 'MYR', 'PHP', 'IDR', 'NZD', 'INR'];
  function currencyOptions(sel) { var l = CURRENCIES.slice(); if (sel && l.indexOf(sel) < 0) l.push(sel); return l.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + c + '</option>'; }).join(''); }
  function priceRow(sym) { return (D().prices || []).filter(function (p) { return p.symbol === sym; })[0]; }
  /* 1 單位外幣 ＝ 幾日圓 */
  function fxRate(cur) {
    if (!cur || cur === 'JPY') return 1;
    var p = priceRow('FX:' + cur); if (p && Number(p.price)) return Number(p.price);
    if (cur === 'TWD' && Number(setting('twdRate', 0))) return Number(setting('twdRate'));
    return 0;
  }
  function convert(n, from, to) { if ((from || 'JPY') === (to || 'JPY')) return n; var a = fxRate(from), b = fxRate(to); return a && b ? n * a / b : null; }

  function tradesOf(acc) {
    return (D().trades || []).filter(function (t) { return !acc || t.account === acc; }).slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt).localeCompare(String(b.createdAt)); });
  }
  /* 交易對證券帳戶現金的影響（帳戶幣別）；有填實際交割金額就用交割金額 */
  function tradeCash(t) {
    var settle = t.settle !== '' && t.settle != null && Number(t.settle) ? Number(t.settle) : null;
    var q = Number(t.qty) || 0, px = Number(t.price) || 0, fee = Number(t.fee) || 0, v;
    if (t.side === 'buy') v = -(q * px + fee); else if (t.side === 'sell') v = q * px - fee; else if (t.side === 'div') v = px - fee; else return 0;
    if (settle !== null) return t.side === 'buy' ? -Math.abs(settle) : Math.abs(settle);
    var c = convert(v, t.currency, accCur(t.account));
    return c === null ? v : c;
  }
  /* 持股：先進先出（FIFO）算成本與已實現損益 */
  function holdings(acc) {
    var by = {};
    tradesOf(acc).forEach(function (t) {
      var k = t.account + '|' + t.symbol;
      var h = by[k] = by[k] || { symbol: t.symbol, name: t.name, market: t.market, currency: t.currency, account: t.account, lots: [], realized: 0, dividends: 0, trades: [] };
      if (t.name) h.name = t.name;
      h.trades.push(t);
      var q = Number(t.qty) || 0, px = Number(t.price) || 0, fee = Number(t.fee) || 0;
      if (t.side === 'buy') h.lots.push({ qty: q, cost: q * px + fee });
      else if (t.side === 'sell') {
        var left = q, sold = 0;
        while (left > 1e-9 && h.lots.length) {
          var l = h.lots[0], take = Math.min(left, l.qty), c = l.cost * take / l.qty;
          sold += c; l.qty -= take; l.cost -= c; left -= take;
          if (l.qty <= 1e-9) h.lots.shift();
        }
        h.realized += q * px - fee - sold;
      } else if (t.side === 'div') h.dividends += px - fee;
      else if (t.side === 'adjust') {
        var tq = h.lots.reduce(function (s, l) { return s + l.qty; }, 0);
        h.lots.forEach(function (l) { l.cost += tq ? px * l.qty / tq : 0; });
      } else if (t.side === 'pl') h.realized += px;
    });
    return Object.keys(by).map(function (k) {
      var h = by[k], p = priceRow(h.symbol);
      h.qty = h.lots.reduce(function (s, l) { return s + l.qty; }, 0);
      h.cost = h.lots.reduce(function (s, l) { return s + l.cost; }, 0);
      h.price = p && Number(p.price) ? Number(p.price) : null;
      h.value = h.price === null ? null : h.qty * h.price;
      h.unreal = h.value === null ? null : h.value - h.cost;
      h.avg = h.qty ? h.cost / h.qty : 0;
      h.updatedAt = p ? p.updatedAt : '';
      h.manual = p ? String(p.manual).toUpperCase() === 'TRUE' : h.market === 'FUND';
      return h;
    });
  }
  function accValue(a) {
    var b = accBalance(a); if (a.type !== 'invest') return b;
    var v = b || 0;
    holdings(a.name).forEach(function (h) { if (h.value !== null && h.qty > 1e-9) { var c = convert(h.value, h.currency, accCur(a.name)); if (c !== null) v += c; } });
    return v;
  }
  function plClass(n) { var redUp = setting('plColor', 'redUp') === 'redUp'; return n > 0 ? (redUp ? 'neg' : 'pos') : n < 0 ? (redUp ? 'pos' : 'neg') : ''; }
  function addMonths(ymd, n) { var p = ymd.split('-').map(Number), d = new Date(p[0], p[1] - 1 + n, 1); return L.fmt(new Date(d.getFullYear(), d.getMonth(), Math.min(p[2], new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))); }

  /* 貸款：剩餘本金、這期利息、還要幾個月 */
  function loanInfo(a) {
    var bal = accBalance(a); if (bal === null) return null;
    var B = Math.max(0, -bal), r = Number(a.rate) || 0, P = Number(a.payment) || 0, i = r / 100 / 12, months = null;
    var interest = Math.round(B * i);
    if (P > 0 && B > 0) { if (i === 0) months = Math.ceil(B / P); else if (P > B * i) months = Math.ceil(-Math.log(1 - i * B / P) / Math.log(1 + i)); }
    var principal = Number(a.principal) || 0;
    return { remain: B, interest: interest, principalPart: Math.max(0, Math.min(B, P - interest)), months: months, payoff: months !== null ? addMonths(L.today(), months) : '',
      paidPct: principal ? Math.max(0, (principal - B) / principal * 100) : null, totalInterest: months !== null ? Math.max(0, Math.round(P * months - B)) : null };
  }

  /* 分期：第 k 期算在刷卡日加 k 個月 */
  function installParts(list, from, to) {
    var out = [];
    list.forEach(function (t) {
      var n = Math.max(1, Number(t.installments) || 1), amt = Number(t.amount);
      if (n === 1) { if (t.date > from && t.date <= to) out.push(t); return; }
      var part = Math.floor(amt / n);
      for (var k = 0; k < n; k++) {
        var d = addMonths(t.date, k);
        if (d > from && d <= to) out.push(Object.assign({}, t, { amount: k === 0 ? amt - part * (n - 1) : part, _part: (k + 1) + '/' + n }));
      }
    });
    return out;
  }

  function tagsOf(t) { return String(t.tags || '').split(/[,，\s]+/).map(function (x) { return x.replace(/^#/, '').trim(); }).filter(Boolean); }
  function allTags() {
    var order = String(setting('tagOrder', '')).split(',').filter(Boolean), seen = {};
    D().tx.forEach(function (t) { tagsOf(t).forEach(function (g) { seen[g] = (seen[g] || 0) + 1; }); });
    return order.concat(Object.keys(seen).filter(function (g) { return order.indexOf(g) < 0 && g !== '已退回'; }).sort(function (a, b) { return seen[b] - seen[a]; }));
  }
  function members() { var m = String(setting('members', '自己,公司,其他')).split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean); return m.length ? m : ['自己']; }

  function compressImage(file, max, q) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', q).split(',')[1]);
      };
      img.onerror = function () { rej(new Error('讀不到圖片')); };
      img.src = URL.createObjectURL(file);
    });
  }
  function showImage(src) {
    var el = document.createElement('div'); el.className = 'viewer';
    el.innerHTML = '<img src="' + src + '" alt=""><button class="ghost">關閉</button>';
    el.addEventListener('click', function () { el.remove(); });
    document.body.appendChild(el);
  }

  /* ---------- 隱私鎖（Face ID：用 iPhone 的通行金鑰驗證） ---------- */
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function pinHash(p) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode('wen-kk:' + p)).then(b64); }
  function lockIfNeeded() {
    var l = load('kk_lock', null); if (!l || document.querySelector('.lock')) return;
    var el = document.createElement('div'); el.className = 'lock';
    el.innerHTML = '<div class="lock-box"><div style="font-size:48px">🔒</div><h1>Wen 記帳</h1>' + (l.cred ? '<button class="primary" id="lkBio" style="width:100%">用 Face ID 解鎖</button>' : '') +
      (l.pin ? '<input id="lkPin" type="password" inputmode="numeric" maxlength="4" placeholder="輸入 4 位數密碼" style="margin-top:12px;text-align:center;font-size:22px">' : '') + '</div>';
    document.body.appendChild(el);
    var bio = el.querySelector('#lkBio'); if (bio) bio.onclick = unlockBio;
    var pi = el.querySelector('#lkPin');
    if (pi) pi.addEventListener('input', function () { if (pi.value.length === 4) pinHash(pi.value).then(function (h) { if (h === l.pin) el.remove(); else { pi.value = ''; toast('密碼錯誤'); } }); });
    if (l.cred) setTimeout(unlockBio, 250);
  }
  function unlockBio() {
    var l = load('kk_lock', null); if (!l || !l.cred || !window.PublicKeyCredential) return;
    navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: unb64(l.cred), transports: ['internal', 'hybrid'] }], userVerification: 'required', timeout: 60000 } })
      .then(function () { var el = document.querySelector('.lock'); if (el) el.remove(); }).catch(function () {});
  }

  /* ---------- 主題 ---------- */
  var ACCENTS = { green: '#4cd964', blue: '#4a9eff', pink: '#ff6b9d', orange: '#ff9f40', purple: '#a78bfa', teal: '#2dd4bf' };
  function applyTheme() {
    var t = load('kk_theme', {});
    document.documentElement.style.setProperty('--accent', ACCENTS[t.accent] || ACCENTS.green);
    document.documentElement.dataset.mode = t.mode || 'dark';
  }

  /* ---------- 加入共享帳本 ---------- */
  function checkJoin() {
    var m = location.hash.match(/^#join=(.+)$/); if (!m) return;
    try {
      var j = JSON.parse(decodeURIComponent(m[1])), id = 'j_' + j.b;
      S.cfg.joined = S.cfg.joined.filter(function (x) { return x.id !== id; }).concat([{ id: id, name: j.n, url: j.u, token: j.t, remote: j.b }]);
      S.cfg.book = id; saveCfg(); S.data = load(dataKey(id), null); S.tab = 'home'; S.page = null;
      history.replaceState(null, '', location.pathname);
      setTimeout(function () { toast('已加入共享帳本「' + j.n + '」'); }, 400);
    } catch (e) { toast('邀請連結有誤'); }
  }
  function switchBook(id) {
    S.cfg.book = id; saveCfg(); S.data = load(dataKey(id), null);
    S.tab = 'home'; S.page = null; S.cycleOffset = 0; S.filterCat = ''; S.filterAcc = ''; S.search = '';
    render(); refresh(true); toast('切換到「' + bookEntry(id).name + '」');
  }
  function inviteLink(b) {
    return location.origin + location.pathname + '#join=' + encodeURIComponent(JSON.stringify({ u: S.cfg.url, t: b.token, b: b.id, n: b.name }));
  }

  /* ---------- 帳本與共享 ---------- */
  PAGES.books = function () {
    var cur = S.cfg.book || 'main', own = !!(S.cfg.url && S.cfg.token);
    var h = back('帳本與共享') + '<div class="sub">每個帳本是一份獨立的 Google 試算表（類別、帳戶、預算分開）。共享時把邀請連結傳給對方，對方用手機打開就能一起記這本帳。</div>';
    var rows = (own ? [{ id: 'main', name: '我的帳本' }].concat(S.cfg.ownBooks) : []);
    h += '<div class="card list">' + rows.map(function (b) {
      return '<div><div class="row between"><span>' + (b.id === cur ? '✅ ' : '📒 ') + esc(b.name) + (b.shared && b.shared.length ? ' <span class="pill">共享 ' + b.shared.length + ' 人</span>' : '') + '</span>' +
        '<span>' + (b.id === cur ? '' : '<button class="ghost" data-act="bookSwitch:' + esc(b.id) + '">切換</button>') + (b.id !== 'main' ? '<button class="ghost" data-act="bookOpen:' + esc(b.id) + '">設定</button>' : '') + '</span></div>' +
        (S.bookOpen === b.id ? '<div class="card" style="background:var(--card2)">' +
          '<label class="f">名稱</label><div class="row"><input id="bkName" value="' + esc(b.name) + '"><button data-act="bookRename:' + esc(b.id) + '">改名</button></div>' +
          '<label class="f">邀請連結（傳給要一起記帳的人）</label><div class="row"><input readonly value="' + esc(inviteLink(b)) + '"><button data-act="bookCopy:' + esc(b.id) + '">複製</button></div>' +
          '<button class="ghost" data-act="bookShareNative:' + esc(b.id) + '">用 LINE／訊息傳送…</button>' +
          '<label class="f">也開放對方直接看試算表（輸入對方 Gmail，可空白）</label><div class="row"><input id="bkEmail" type="email" placeholder="xxx@gmail.com"><button data-act="bookEmail:' + esc(b.id) + '">開放</button></div>' +
          (b.shared && b.shared.length ? '<div class="sub">已開放：' + b.shared.map(esc).join('、') + '</div>' : '') +
          '<div class="grid2" style="margin-top:10px"><button data-act="bookNewToken:' + esc(b.id) + '">重設邀請連結</button><button class="danger" data-act="bookRemove:' + esc(b.id) + '">從清單移除</button></div>' +
          '<div class="sub">重設後舊連結會失效（已加入的人也要用新連結重新加入）。移除只是從 App 拿掉，試算表還在你的雲端硬碟。</div></div>' : '') + '</div>';
    }).join('') + S.cfg.joined.map(function (b) {
      return '<div class="row between"><span>' + (b.id === cur ? '✅ ' : '👥 ') + esc(b.name) + ' <span class="pill">別人共享</span></span><span>' +
        (b.id === cur ? '' : '<button class="ghost" data-act="bookSwitch:' + esc(b.id) + '">切換</button>') + '<button class="ghost" data-act="bookLeave:' + esc(b.id) + '">退出</button></span></div>';
    }).join('') + '</div>';
    if (own) h += '<h2>新增帳本</h2><div class="card"><input id="bkNew" placeholder="例如：家庭、和男友的共同帳戶、2027 台灣旅行"><label class="f">成員（逗號分隔，記帳時可選誰付的）</label><input id="bkMembers" value="自己"><button class="primary" style="width:100%;margin-top:10px" data-act="bookCreate">建立</button><div class="sub">會複製目前的類別和帳戶設定，餘額從 0 開始。</div></div>';
    return h;
  };

  /* ---------- 標籤 ---------- */
  PAGES.tags = function () {
    var tags = allTags(), y = L.today().slice(0, 4);
    var h = back('標籤') + '<div class="sub">一筆可以加很多個標籤（例如 旅行、報稅、公司、家人），用來跨類別統計。點標籤看明細；↑↓ 調整在記帳畫面的順序。</div>';
    if (!tags.length) return h + '<div class="empty">還沒有標籤，記帳時在「標籤」加就會出現在這裡。</div>';
    h += '<div class="card list">' + tags.map(function (g, i) {
      var list = D().tx.filter(function (t) { return tagsOf(t).indexOf(g) >= 0; });
      var outY = sum(list.filter(function (t) { return t.type === '支' && (t.currency || 'JPY') === 'JPY' && t.date.slice(0, 4) === y; }));
      var outAll = sum(list.filter(function (t) { return t.type === '支' && (t.currency || 'JPY') === 'JPY'; }));
      return '<div class="row between"><span data-act="tagShow:' + esc(g) + '">🔖 ' + esc(g) + ' <span class="sub">' + list.length + ' 筆</span><br><span class="sub">今年 ' + yen(outY) + '・全部 ' + yen(outAll) + '</span></span>' +
        '<span><button class="ghost" data-act="tagMove:' + i + ':-1">↑</button><button class="ghost" data-act="tagMove:' + i + ':1">↓</button><button class="ghost" data-act="tagRename:' + esc(g) + '">改名</button></span></div>';
    }).join('') + '</div>';
    return h;
  };

  /* ---------- 投資 ---------- */
  var MARKETS = { US: '美股', JP: '日股', TW: '台股', FUND: '投信／基金' };
  var MARKET_CUR = { US: 'USD', JP: 'JPY', TW: 'TWD', FUND: 'JPY' };
  var SIDES = { buy: '買進', sell: '賣出', div: '股息', adjust: '成本調整', pl: '損益調整' };
  PAGES.invest = function () {
    var accs = D().accounts.filter(function (a) { return a.type === 'invest'; });
    var h = back('投資') + '<div class="row between"><span class="sub">股價、匯率每天早上自動更新（Google 財經，約延遲 20 分鐘）。基金請手動更新淨值。</span><button class="ghost" data-act="refreshPrices">↻ 更新</button></div>';
    if (!accs.length) return h + '<div class="empty">先到「帳戶（付款方式）與圖示」新增一個種類是「證券／投資」的帳戶（例如 Moomoo NISA），再回來記交易。</div><button style="width:100%" data-act="go:accounts">前往帳戶設定</button>';
    var totJ = 0, costJ = 0;
    accs.forEach(function (a) {
      var cur = accCur(a.name), hs = holdings(a.name), cash = accBalance(a) || 0, val = accValue(a);
      var open = hs.filter(function (x) { return x.qty > 1e-9; });
      var real = hs.reduce(function (s, x) { var c = convert(x.realized, x.currency, cur); return s + (c === null ? 0 : c); }, 0);
      var divs = hs.reduce(function (s, x) { var c = convert(x.dividends, x.currency, cur); return s + (c === null ? 0 : c); }, 0);
      var unreal = open.reduce(function (s, x) { var c = x.unreal === null ? null : convert(x.unreal, x.currency, cur); return s + (c === null ? 0 : c); }, 0);
      var cost = open.reduce(function (s, x) { var c = convert(x.cost, x.currency, cur); return s + (c === null ? 0 : c); }, 0);
      var vj = convert(val, cur, 'JPY'), cj = convert(cost, cur, 'JPY'); totJ += vj || 0; costJ += cj || 0;
      h += '<div class="card"><div class="row between"><h3>' + accIcon(a.name) + ' ' + esc(a.name) + '</h3><button class="ghost" data-act="tradeNew:' + esc(a.name) + '">＋ 記交易</button></div>' +
        '<div class="big num">' + money(val, cur) + '</div>' +
        (open.some(function (x) { return convert(1, x.currency, cur) === null; }) ? '<div class="sub" style="color:var(--amber)">' + open.filter(function (x) { return convert(1, x.currency, cur) === null; }).map(function (x) { return x.currency; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).join('、') + ' 還沒有匯率，持股市值暫時沒算進總額，按右上 ↻ 更新</div>' : '') +
        '<div class="grid2 sub" style="margin-top:6px"><div>持股成本 ' + money(cost, cur) + '</div><div>未實現 <span class="' + plClass(unreal) + '">' + money(unreal, cur) + (cost ? '（' + (unreal / cost * 100).toFixed(1) + '%）' : '') + '</span></div>' +
        '<div>已實現 <span class="' + plClass(real) + '">' + money(real, cur) + '</span></div><div>股息 ' + money(divs, cur) + '</div><div>帳戶現金 ' + money(cash, cur) + '</div></div>';
      h += '<div class="list" style="margin-top:8px">' + open.map(function (x) {
        var key = esc(a.name + '|' + x.symbol);
        return '<div data-act="holdOpen:' + key + '"><div class="row between"><span><b>' + esc(x.symbol) + '</b> <span class="sub">' + esc(x.name || '') + '・' + MARKETS[x.market] + '</span></span><span class="num">' + (x.value === null ? '<span class="sub">沒有股價</span>' : money(x.value, x.currency)) + '</span></div>' +
          '<div class="row between sub"><span>' + (+x.qty.toFixed(4)) + ' 股・均價 ' + money(x.avg, x.currency) + '・現價 ' + (x.price === null ? '—' : money(x.price, x.currency)) + '</span><span class="' + plClass(x.unreal) + '">' + (x.unreal === null ? '' : money(x.unreal, x.currency) + '（' + (x.cost ? (x.unreal / x.cost * 100).toFixed(1) : '0') + '%）') + '</span></div>' +
          (S.holdOpen === a.name + '|' + x.symbol ? holdDetail(x) : '') + '</div>';
      }).join('') + (open.length ? '' : '<div class="empty">目前沒有持股</div>') + '</div>';
      var closed = hs.filter(function (x) { return x.qty <= 1e-9; });
      if (closed.length) h += '<div class="sub" style="margin-top:6px">已出清：' + closed.map(function (x) { return '<span data-act="holdOpen:' + esc(a.name + '|' + x.symbol) + '">' + esc(x.symbol) + ' <span class="' + plClass(x.realized) + '">' + money(x.realized, x.currency) + '</span></span>'; }).join('、') + '</div>' +
        closed.filter(function (x) { return S.holdOpen === a.name + '|' + x.symbol; }).map(holdDetail).join('');
      h += '</div>';
    });
    if (accs.length > 1) h += '<div class="card"><div class="row between"><span>全部投資（換算日圓）</span><b class="num">' + yen(totJ) + '</b></div></div>';
    h += '<div class="card"><label class="f">漲跌顏色</label><div class="seg">' + [['redUp', '紅漲綠跌'], ['greenUp', '綠漲紅跌']].map(function (o) { return '<button data-act="plColor:' + o[0] + '" class="' + (setting('plColor', 'redUp') === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>';
    return h;
  };
  function holdDetail(x) {
    var h = '<div class="card" style="background:var(--card2)">' +
      (x.manual || x.price === null ? '<div class="row"><input id="px_' + esc(x.symbol) + '" type="number" inputmode="decimal" placeholder="現在價格／淨值（' + x.currency + '）" value="' + (x.price || '') + '"><button data-act="priceSet:' + esc(x.symbol) + ':' + x.currency + '">更新</button></div>' : '<div class="sub">股價更新：' + esc(String(x.updatedAt).replace('T', ' ').slice(0, 16)) + '</div>') +
      '<div class="list" style="margin-top:6px">' + x.trades.slice().reverse().map(function (t) {
        var amt = t.side === 'div' || t.side === 'adjust' || t.side === 'pl' ? money(t.price, t.currency) : (+Number(t.qty)) + ' × ' + money(t.price, t.currency);
        return '<div class="row between" data-act="tradeEdit:' + esc(t.id) + '"><span>' + t.date.slice(2).replace(/-/g, '/') + ' ' + SIDES[t.side] + '</span><span class="num">' + amt + (Number(t.fee) ? ' <span class="sub">手續費 ' + money(t.fee, t.currency) + '</span>' : '') + ' ›</span></div>';
      }).join('') + '</div>' +
      '<div class="grid3" style="margin-top:6px"><button data-act="tradeNew:' + esc(x.account) + ':' + esc(x.symbol) + ':sell">賣出</button><button data-act="tradeNew:' + esc(x.account) + ':' + esc(x.symbol) + ':div">股息</button><button data-act="tradeNew:' + esc(x.account) + ':' + esc(x.symbol) + ':adjust">調整</button></div></div>';
    return h;
  }
  /* 交易表單 */
  function openTradeForm(tr) {
    var T = S.trade = tr;
    var old = document.querySelector('.sheet-bg'); if (old) old.remove();
    var bg = document.createElement('div'); bg.className = 'sheet-bg';
    var accCurr = accCur(T.account), cross = T.currency !== accCurr, qtyLess = T.side === 'div' || T.side === 'adjust' || T.side === 'pl';
    bg.innerHTML = '<div class="sheet"><div class="wrap"><div class="row between"><button class="ghost" data-t="close">取消</button><b>' + (T.id ? '編輯交易' : '記交易') + '</b><button class="ghost" data-t="save" style="font-weight:700">儲存</button></div>' +
      '<div class="seg" style="margin:8px 0">' + Object.keys(SIDES).map(function (k) { return '<button data-t="side:' + k + '" class="' + (T.side === k ? 'on' : '') + '">' + SIDES[k] + '</button>'; }).join('') + '</div>' +
      '<div class="grid2"><div><label class="f">市場</label><select id="tMarket">' + Object.keys(MARKETS).map(function (k) { return '<option value="' + k + '"' + (T.market === k ? ' selected' : '') + '>' + MARKETS[k] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="f">代號</label><input id="tSym" value="' + esc(T.symbol) + '" placeholder="VOO／7203／0050／eMAXIS"></div></div>' +
      '<label class="f">名稱（可空白）</label><input id="tName" value="' + esc(T.name || '') + '">' +
      '<div class="grid2"><div><label class="f">日期</label><input id="tDate" type="date" value="' + T.date + '"></div><div><label class="f">報價幣別</label><select id="tCur">' + currencyOptions(T.currency) + '</select></div></div>' +
      (qtyLess ? '<label class="f">' + (T.side === 'div' ? '股息金額（稅後）' : T.side === 'adjust' ? '成本增減（正數＝成本增加）' : '已實現損益增減') + '（' + T.currency + '）</label><input id="tPrice" type="text" inputmode="decimal" value="' + (T.price || '') + '">'
        : '<div class="grid2"><div><label class="f">股數／口數</label><input id="tQty" type="text" inputmode="decimal" value="' + (T.qty || '') + '"></div><div><label class="f">價格（' + T.currency + '）</label><input id="tPrice" type="text" inputmode="decimal" value="' + (T.price || '') + '"></div></div>') +
      (T.side === 'buy' || T.side === 'sell' || T.side === 'div' ? '<label class="f">手續費／稅（' + T.currency + '）</label><input id="tFee" type="text" inputmode="decimal" value="' + (T.fee || '') + '">' : '') +
      (T.side === 'buy' || T.side === 'sell' || T.side === 'div' ? '<label class="f">實際' + (T.side === 'buy' ? '扣款' : '入帳') + '金額（' + accCurr + '，' + (cross ? '換匯後的金額，必填' : '可空白，空白就用 股數×價格±手續費') + '）</label><input id="tSettle" type="text" inputmode="decimal" value="' + (T.settle || '') + '">' : '') +
      '<label class="f">備註</label><input id="tNote" value="' + esc(T.note || '') + '">' +
      (T.id ? '<button class="danger" style="width:100%;margin-top:16px" data-t="del">刪除這筆交易</button>' : '') + '</div></div>';
    document.body.appendChild(bg);
    var read = function () {
      var q = function (s) { var e = bg.querySelector(s); return e ? e.value : undefined; };
      T.market = q('#tMarket'); T.symbol = String(q('#tSym') || '').trim().toUpperCase(); T.name = q('#tName'); T.date = q('#tDate') || L.today(); T.currency = q('#tCur');
      if (q('#tQty') !== undefined) T.qty = L.num(q('#tQty')); if (q('#tPrice') !== undefined) T.price = q('#tPrice') === '' ? '' : Number(String(q('#tPrice')).replace(/,/g, ''));
      if (q('#tFee') !== undefined) T.fee = L.num(q('#tFee')) || ''; if (q('#tSettle') !== undefined) T.settle = L.num(q('#tSettle')) || ''; T.note = q('#tNote');
    };
    bg.querySelector('#tMarket').addEventListener('change', function () { read(); T.currency = MARKET_CUR[T.market]; openTradeForm(T); });
    bg.querySelector('#tCur').addEventListener('change', function () { read(); openTradeForm(T); });
    bg.addEventListener('click', function (e) {
      if (e.target === bg) { bg.remove(); return; }
      var b = e.target.closest('[data-t]'); if (!b) return;
      read();
      var a = b.dataset.t.split(':');
      if (a[0] === 'close') bg.remove();
      else if (a[0] === 'side') { T.side = a[1]; openTradeForm(T); }
      else if (a[0] === 'del') { if (!confirm('刪除這筆交易？')) return; D().trades = (D().trades || []).filter(function (x) { return x.id !== T.id; }); enqueue('removeTrade', { id: T.id }); persist(); bg.remove(); render(); }
      else if (a[0] === 'save') {
        if (!T.symbol) { toast('請輸入代號'); return; }
        var ql = T.side === 'div' || T.side === 'adjust' || T.side === 'pl';
        if (!ql && (!T.qty || T.price === '')) { toast('請輸入股數和價格'); return; }
        if (ql && (T.price === '' || isNaN(T.price))) { toast('請輸入金額'); return; }
        if (T.currency !== accCur(T.account) && (T.side === 'buy' || T.side === 'sell') && !T.settle && !fxRate(T.currency)) { toast('請輸入實際' + (T.side === 'buy' ? '扣款' : '入帳') + '金額（' + accCur(T.account) + '）'); return; }
        if (T.side === 'sell') {
          var hq = holdings(T.account).filter(function (x) { return x.symbol === T.symbol; })[0];
          var have = (hq ? hq.qty : 0) + (T.id ? Number((D().trades.filter(function (x) { return x.id === T.id; })[0] || {}).qty || 0) : 0);
          if (T.qty > have + 1e-9) { toast('持股只有 ' + (+have.toFixed(4)) + ' 股'); return; }
        }
        if (ql) T.qty = '';
        var rec = { id: T.id || uuid(), date: T.date, account: T.account, symbol: T.symbol, name: T.name, market: T.market, side: T.side, qty: T.qty, price: T.price, fee: T.fee, currency: T.currency, settle: T.settle, note: T.note, createdAt: T.createdAt || new Date().toISOString().slice(0, 19) };
        D().trades = (D().trades || []).filter(function (x) { return x.id !== rec.id; }).concat([rec]);
        if (!priceRow(rec.symbol)) { D().prices = (D().prices || []).concat([{ symbol: rec.symbol, gf: '', price: '', currency: rec.currency, manual: rec.market === 'FUND' ? 'TRUE' : '', updatedAt: '' }]); }
        enqueue('saveTrade', { trade: rec }); persist(); bg.remove(); render();
        toast('已記 ' + SIDES[rec.side] + ' ' + rec.symbol);
        if (rec.market !== 'FUND' && !Number((priceRow(rec.symbol) || {}).price)) setTimeout(function () { ACTS.refreshPrices(); }, 1500);
      }
    });
  }

  /* ---------- 貸款 ---------- */
  PAGES.loans = function () {
    var loans = D().accounts.filter(function (a) { return a.type === 'loan'; });
    var h = back('貸款') + '<div class="sub">貸款是一個負數的帳戶：剩餘本金＝欠款。每月還款＝轉帳到貸款帳戶（本金）＋一筆「貸款利息」支出，系統依利率自動拆。</div>';
    if (!loans.length) return h + '<div class="empty">還沒有貸款帳戶。按下面新增（例如「台灣學貸」、「車貸」）。</div><button class="primary" style="width:100%" data-act="loanAdd">＋ 新增貸款</button>';
    loans.forEach(function (a) {
      var i = loanInfo(a), cur = accCur(a.name), idx = D().accounts.indexOf(a);
      h += '<div class="card"><div class="row between"><h3>' + accIcon(a.name) + ' ' + esc(a.name) + '</h3><button class="ghost" data-act="loanEdit:' + idx + '">設定</button></div>';
      if (!i) h += '<div class="sub">還沒填剩餘本金，按「設定」填。</div>';
      else {
        h += '<div class="big num">' + money(i.remain, cur) + '</div><div class="sub">剩餘本金</div>' +
          (i.paidPct !== null ? '<div class="bar"><i style="width:' + Math.min(100, i.paidPct).toFixed(1) + '%;background:var(--accent)"></i></div>' + '<div class="sub">已還 ' + i.paidPct.toFixed(1) + '%（原本 ' + money(a.principal, cur) + '）</div>' : '') +
          '<div class="grid2 sub" style="margin-top:8px"><div>年利率 ' + (Number(a.rate) || 0) + '%</div><div>每月還 ' + money(a.payment || 0, cur) + (a.payDay ? '（' + a.payDay + ' 號）' : '') + '</div>' +
          '<div>這期利息 ' + money(i.interest, cur) + '</div><div>這期本金 ' + money(i.principalPart, cur) + '</div>' +
          (i.months !== null ? '<div>還要 ' + i.months + ' 個月</div><div>預計 ' + i.payoff.slice(0, 7).replace('-', '/') + ' 還完</div><div>之後利息合計約 ' + money(i.totalInterest, cur) + '</div>' : (Number(a.payment) ? '<div class="neg">每月還款低於利息，還不完</div>' : '')) + '</div>' +
          '<div class="grid2" style="margin-top:10px"><button class="primary" data-act="loanPay:' + idx + '">記一筆還款</button><button data-act="loanAuto:' + idx + '">' + (D().recurring.some(function (r) { return r.toAccount === a.name && r.active; }) ? '✓ 已設每月自動還款' : '設成每月自動還款') + '</button></div>';
      }
      if (S.loanEdit === idx) {
        h += '<div class="card" style="background:var(--card2)"><div class="grid2"><div><label class="f">名稱</label><input data-act="accSet:' + idx + ':name" value="' + esc(a.name) + '"></div><div><label class="f">幣別</label><select data-act="accSet:' + idx + ':currency">' + currencyOptions(cur) + '</select></div>' +
          '<div><label class="f">原本借款金額</label><input type="number" data-act="accSet:' + idx + ':principal" value="' + (a.principal || '') + '"></div><div><label class="f">年利率（%）</label><input type="number" step="0.001" data-act="accSet:' + idx + ':rate" value="' + (a.rate || '') + '"></div>' +
          '<div><label class="f">每月還款金額</label><input type="number" data-act="accSet:' + idx + ':payment" value="' + (a.payment || '') + '"></div><div><label class="f">每月幾號還</label><input type="number" min="1" max="31" data-act="accSet:' + idx + ':payDay" value="' + (a.payDay || '') + '"></div></div>' +
          '<label class="f">從哪個帳戶扣款</label>' + accSelect(a.payAccount, 'accSet:' + idx + ':payAccount') +
          '<div class="grid2"><div><label class="f">剩餘本金</label><input id="lnRemain" type="number" value="' + (i ? i.remain : '') + '"></div><div><label class="f">以哪一天為準</label><input id="lnDate" type="date" value="' + esc(a.openingDate || L.today()) + '"></div></div>' +
          '<button class="primary" style="width:100%;margin-top:10px" data-act="loanSave:' + idx + '">儲存</button></div>';
      }
      var pays = sortTx(D().tx.filter(function (t) { return t.type === '轉' && t.toAccount === a.name; })).slice(0, 6);
      if (pays.length) h += '<h2>最近還款</h2><div class="list">' + pays.map(txRow).join('') + '</div>';
      h += '</div>';
    });
    h += '<button style="width:100%" data-act="loanAdd">＋ 新增貸款</button>';
    return h;
  };


  /* ---------- 自動分類規則 ---------- */
  PAGES.rules = function () {
    var h = back('自動分類規則') + '<div class="sub">店名包含關鍵字就自動歸到該類別（錢包自動記帳、PayPay CSV 都用）。</div><div class="card">';
    D().rules.forEach(function (r, i) {
      h += '<div class="row" style="margin:6px 0"><input value="' + esc(r.keyword) + '" data-act="ruleSet:' + i + ':keyword">' + catSelect(r.category, 'ruleSet:' + i + ':category') + '<button class="ghost" data-act="ruleDel:' + i + '">✕</button></div>';
    });
    h += '</div><div class="grid2"><button data-act="ruleAdd">＋ 新增</button><button class="primary" data-act="ruleSave">儲存</button></div>';
    h += '<h2>錢包卡片名稱 → 帳戶</h2><div class="card">';
    D().cards.forEach(function (r, i) {
      h += '<div class="row" style="margin:6px 0"><input value="' + esc(r.keyword) + '" data-act="cardSet:' + i + ':keyword">' + accSelect(r.account, 'cardSet:' + i + ':account') + '<button class="ghost" data-act="cardDel:' + i + '">✕</button></div>';
    });
    h += '</div><div class="grid2"><button data-act="cardAdd">＋ 新增</button><button class="primary" data-act="cardSave">儲存</button></div>';
    return h;
  };

  /* ---------- 匯入 ---------- */
  PAGES.import = function () {
    return back('匯入') +
      '<div class="card"><h3>PayPay 取引履歴 CSV（每月對帳）</h3><div class="sub">PayPay App：首頁「取引履歴」→ 右上「取引履歴のダウンロード」→ 選月份申請，收到通知後下載。上傳後會自動跳過已記過的（同金額、日期差 1 天內），只補漏記的。</div><input type="file" accept=".csv,text/csv" data-act="ppFile" style="margin-top:10px"><div id="ppPreview"></div></div>' +
      '<div class="card"><h3>舊記帳 App 的 CSV</h3><div class="sub">原樣匯入（類別、帳戶、標籤、備註都照舊）。用 UUID 判斷，重複匯入不會變兩筆。</div><input type="file" accept=".csv,text/csv" data-act="legacyFile" style="margin-top:10px"><div id="lgPreview"></div></div>' +
      '<div class="card"><h3>匯出全部紀錄</h3><button data-act="exportAll" style="margin-top:6px">下載 CSV（Excel 可開）</button></div>';
  };

  /* ---------- 捷徑設定 ---------- */
  PAGES.shortcuts = function () {
    var u = esc(S.cfg.url), t = esc(S.cfg.token);
    return back('iPhone 捷徑設定') +
      '<div class="info">完整步驟在設定說明文件裡。這裡放你需要複製的內容。</div>' +
      '<div class="card"><h3>伺服器網址</h3><textarea rows="3" readonly>' + u + '</textarea><button data-act="copy:url">複製</button></div>' +
      '<div class="card"><h3>API 金鑰</h3><input readonly value="' + t + '"><button data-act="copy:token" style="margin-top:6px">複製</button></div>' +
      '<div class="card"><h3>各捷徑要送的 JSON 欄位</h3><div class="sub">「取得 URL 內容」→ 方法 POST → 要求本文 JSON：</div><table class="t">' +
      '<tr><th>捷徑</th><th>欄位</th></tr>' +
      '<tr><td>錢包刷卡</td><td style="white-space:normal;text-align:left">token、action=wallet、merchant＝商家、amount＝金額、card＝卡片名稱、text=1</td></tr>' +
      '<tr><td>PayPay 記帳</td><td style="white-space:normal;text-align:left">token、action=quick、amount、category、note、text=1</td></tr>' +
      '<tr><td>類別清單</td><td style="white-space:normal;text-align:left">token、action=categoryList</td></tr>' +
      '<tr><td>每日摘要</td><td style="white-space:normal;text-align:left">token、action=summary、period=day</td></tr>' +
      '<tr><td>每週摘要</td><td style="white-space:normal;text-align:left">token、action=summary、period=week</td></tr></table>' +
      '<button style="margin-top:10px" data-act="testSummary">測試：取得今天的摘要</button></div>';
  };

  /* ---------- 設定 ---------- */
  PAGES.settings = function () {
    var h = (hasBackend() ? back('設定') : '<h1>第一次設定</h1><div class="info">貼上 Apps Script 部署後的網址和 API 金鑰（在試算表的 Settings 分頁 apiToken）。</div>');
    h += '<div class="card"><label class="f">伺服器網址（Web App URL）</label><input id="cfgUrl" value="' + esc(S.cfg.url) + '" placeholder="https://script.google.com/macros/s/…/exec">' +
      '<label class="f">API 金鑰</label><input id="cfgToken" value="' + esc(S.cfg.token) + '">' +
      '<button class="primary" style="margin-top:12px;width:100%" data-act="saveCfg">儲存並同步</button></div>';
    if (!S.data) return h;
    var keys = [['cycleStartDay', '預算週期從每月幾號開始'], ['payDay', '發薪日'], ['alertPercent', '用到幾 % 提醒'], ['twdRate', '台幣匯率（1 台幣＝幾日圓）']];
    FUNDS.forEach(function (f) { keys.push(['fund_' + f + '_target', f + ' 目標']); keys.push(['fund_' + f + '_monthly', f + ' 每月金額']); });
    h += '<div class="card"><h3>一般</h3>' + keys.map(function (k) { return '<div class="edit-row"><span>' + k[1] + '</span><input type="number" inputmode="decimal" data-key="' + k[0] + '" value="' + esc(setting(k[0], '')) + '"></div>'; }).join('') +
      '<button class="primary" style="width:100%;margin-top:8px" data-act="saveSettings">儲存</button></div>' +
      '<div class="card"><button style="width:100%" data-act="sync">立即同步</button><div class="sub" style="margin-top:6px">待送出 ' + S.queue.length + ' 筆　上次同步 ' + esc(D().serverTime || '—') + '</div>' +
      '<button class="danger" style="width:100%;margin-top:10px" data-act="resetLocal">清除這支手機的暫存（雲端資料不受影響）</button></div>';
    var th = load('kk_theme', {}), lk = load('kk_lock', null);
    h += '<div class="card"><h3>成員</h3><div class="sub">記帳時選「誰」（逗號分隔）。「公司」是公司代墊用。</div><input id="mbList" value="' + esc(members().join(',')) + '" style="margin-top:6px"><button style="width:100%;margin-top:8px" data-act="saveMembers">儲存成員</button></div>';
    h += '<div class="card"><h3>主題</h3><div class="seg">' + [['dark', '深色'], ['light', '淺色']].map(function (m) { return '<button data-act="theme:mode:' + m[0] + '" class="' + ((th.mode || 'dark') === m[0] ? 'on' : '') + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<div class="row" style="margin-top:10px;flex-wrap:wrap">' + Object.keys(ACCENTS).map(function (k) { return '<button data-act="theme:accent:' + k + '" style="width:40px;height:40px;border-radius:50%;background:' + ACCENTS[k] + ';border:3px solid ' + ((th.accent || 'green') === k ? 'var(--text)' : 'transparent') + '"></button>'; }).join('') + '</div></div>';
    h += '<div class="card"><h3>隱私鎖</h3><div class="sub">打開 App、或離開超過 1 分鐘再回來時，要用 Face ID 解鎖。</div>' +
      (lk ? '<div class="row between" style="margin-top:8px"><span>✅ 已開啟' + (lk.pin ? '（有備用密碼）' : '') + '</span><button class="ghost" data-act="lockOff">關閉</button></div>' : '<button class="primary" style="width:100%;margin-top:8px" data-act="lockOn">開啟 Face ID 鎖</button>') + '</div>';
    return h;
  };

  /* ---------- 預算編輯 ---------- */
  PAGES.budgetEdit = function () {
    var b = {}; D().budgets.forEach(function (x) { b[x.period + '|' + x.category] = x.amount; });
    var groups = {};
    D().categories.filter(function (c) { return c.type === '支'; }).forEach(function (c) { (groups[c.group] = groups[c.group] || []).push(c); });
    var h = back('編輯預算') + '<div class="sub">月預算照發薪週期算；年預算照 1～12 月。設了年預算的類別不算進每月剩餘預算。整個大類別的年預算（例如旅遊）填在大類別那一行。</div>';
    Object.keys(groups).forEach(function (g) {
      h += '<h2>' + esc(g) + '</h2><div class="card"><div class="edit-row"><b>整類年預算</b><input type="number" data-bk="year|#' + esc(g) + '" value="' + (b['year|#' + g] || '') + '" placeholder="年"></div>';
      groups[g].forEach(function (c) {
        h += '<div class="edit-row" style="grid-template-columns:1fr 92px 92px"><span>' + c.emoji + ' ' + esc(c.name) + '</span><input type="number" data-bk="month|' + esc(c.name) + '" value="' + (b['month|' + c.name] || '') + '" placeholder="月"><input type="number" data-bk="year|' + esc(c.name) + '" value="' + (b['year|' + c.name] || '') + '" placeholder="年"></div>';
      });
      h += '</div>';
    });
    h += '<button class="primary" style="width:100%" data-act="saveBudgets">儲存預算</button>';
    return h;
  };

  /* ===================== 記帳表單 ===================== */
  var F = null;
  function openTxForm(t, type) {
    if (t) {
      F = Object.assign({}, t);
      if (t.type === '轉') { var fee = D().tx.filter(function (x) { return x.id === t.id + '-fee'; })[0], it = D().tx.filter(function (x) { return x.id === t.id + '-int'; })[0]; F.fee = fee ? fee.amount : ''; F._interest = it ? it.amount : ''; }
    } else {
      F = { id: null, type: type || '支', amount: '', category: '', account: lastAccount(), date: L.today(), note: '', member: members()[0], tags: '', currency: 'JPY', toAccount: '', toAmount: '', fee: '' };
      if (F.type === '轉') { F.account = 'ゆうちょ'; F.toAccount = 'Pay Pay'; F.currency = accCur(F.account); }
      else F.currency = accCur(F.account);
    }
    F._rule = false; F._focus = !F.id; F._new = null;
    drawForm();
  }
  function lastAccount() { var t = sortTx(D().tx.filter(function (x) { return x.source === 'manual' && x.type !== '轉'; }))[0]; return t ? t.account : 'Pay Pay'; }
  function accChips(sel, key) {
    var accs = D().accounts.filter(function (a) { return a.active || a.name === sel; });
    return '<div class="chips">' + accs.map(function (a) { return '<button data-f="' + key + ':' + esc(a.name) + '" class="' + (sel === a.name ? 'on' : '') + '">' + accIcon(a.name) + esc(a.name) + '</button>'; }).join('') +
      '<button data-f="newAcc:' + key + '">＋ 新增</button></div>';
  }
  function newBox() {
    var n = F._new; if (!n) return '';
    if (n.kind === 'cat') {
      var groups = []; D().categories.forEach(function (c) { if (c.type === F.type && groups.indexOf(c.group) < 0) groups.push(c.group); });
      return '<div class="card" style="background:var(--card2);margin-top:8px"><b>新增' + (F.type === '支' ? '支出' : '收入') + '項目</b><div class="row" style="margin-top:6px"><input id="nEmoji" value="🏷️" style="width:52px;text-align:center"><input id="nName" class="grow" placeholder="名稱"></div>' +
        '<label class="f">大類別</label><input id="nGroup" list="nGrpList" value="' + esc(groups[0] || '其他') + '"><datalist id="nGrpList">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
        '<div class="grid2" style="margin-top:8px"><button data-f="newCancel">取消</button><button class="primary" data-f="newCatOk">加入</button></div></div>';
    }
    return '<div class="card" style="background:var(--card2);margin-top:8px"><b>新增帳戶（付款方式）</b><input id="nName" placeholder="名稱，例如 楽天ペイ" style="margin-top:6px">' +
      '<div class="grid2" style="margin-top:6px"><select id="nType">' + Object.keys(ACC_TYPES).map(function (k) { return '<option value="' + k + '"' + (k === 'emoney' ? ' selected' : '') + '>' + ACC_TYPES[k] + '</option>'; }).join('') + '</select>' +
      '<select id="nCur">' + ['JPY', 'TWD', 'USD'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="sub">圖示、信用卡結帳日之後可在「帳戶（付款方式）與圖示」設定。</div>' +
      '<div class="grid2" style="margin-top:8px"><button data-f="newCancel">取消</button><button class="primary" data-f="newAccOk">加入</button></div></div>';
  }
  function extraFields() {
    var acc = accMap()[F.account] || {}, tg = tagsOf(F), all = allTags();
    tg.forEach(function (g) { if (all.indexOf(g) < 0) all.push(g); });
    var h = '<label class="f">標籤</label><div class="chips">' + all.filter(function (g) { return g !== '已退回'; }).map(function (g) { return '<button data-f="tag:' + esc(g) + '" class="' + (tg.indexOf(g) >= 0 ? 'on' : '') + '">#' + esc(g) + '</button>'; }).join('') +
      '</div><div class="row" style="margin-top:6px"><input id="fTagNew" placeholder="新標籤，例如 旅行、報稅"><button data-f="tagAdd">加入</button></div>';
    if (F.type === '支' && acc.type === 'credit') h += '<label class="f">分期</label><select id="fInst">' + [1, 2, 3, 5, 6, 10, 12, 18, 24, 36].map(function (n) { return '<option value="' + n + '"' + ((Number(F.installments) || 1) === n ? ' selected' : '') + '>' + (n === 1 ? '一次付清' : n + ' 期') + '</option>'; }).join('') + '</select>';
    h += '<label class="f">收據／發票</label>';
    if (F._receiptData) h += '<div class="row"><img src="data:image/jpeg;base64,' + F._receiptData + '" style="height:64px;border-radius:8px"><button class="ghost" data-f="rcClear">移除</button></div>';
    else if (F.receipt && !F._rcRemove) h += '<div class="row"><button data-f="rcView">📎 查看收據</button><button class="ghost" data-f="rcDel">移除</button></div>';
    else h += '<label class="btn-file">📷 拍照／選照片<input id="fReceipt" type="file" accept="image/*" style="display:none"></label>';
    return h;
  }
  function drawForm() {
    var old = document.querySelector('.sheet-bg'); if (old) old.remove();
    var since = L.fmt(new Date(Date.now() - 120 * 86400000)), freq = {};
    D().tx.forEach(function (t) { if (t.date >= since) freq[t.category] = (freq[t.category] || 0) + 1; });
    var cats = D().categories.filter(function (c) { return c.type === F.type && c.name !== '待分類' && c.name !== '水電瓦斯' && (catVisible(c) || c.name === F.category); })
      .sort(function (a, b) { return (freq[b.name] || 0) - (freq[a.name] || 0) || Number(a.order) - Number(b.order); });
    var bg = document.createElement('div'); bg.className = 'sheet-bg';
    var merchant = F.note && (F.source === 'wallet' || F.source === 'paypay-csv' || F.source === 'paypay-quick') ? F.note : '';
    var tr = F.type === '轉', h = '<div class="sheet"><div class="wrap"><div class="row between"><button class="ghost" data-f="close">取消</button><b>' + (F.id ? '編輯' : tr ? '轉帳／匯款' : '記一筆') + '</b><button class="ghost" data-f="save" style="font-weight:700">儲存</button></div>' +
      '<div class="seg" style="margin:8px 0">' + [['支', '支出'], ['收', '收入'], ['轉', '轉帳']].map(function (x) { return '<button data-f="type:' + x[0] + '" class="' + (F.type === x[0] ? 'on' : '') + '"' + (F.id && (tr || x[0] === '轉') && F.type !== x[0] ? ' disabled' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>';
    if (tr) {
      var cur = accCur(F.account), toCur = accCur(F.toAccount), cross = F.toAccount && cur !== toCur;
      var r = cross && Number(F.amount) && Number(F.toAmount) ? Number(F.amount) / Number(F.toAmount) : 0;
      h += '<label class="f">從（轉出）</label>' + accChips(F.account, 'acc') + (F._new && F._new.key === 'acc' ? newBox() : '') +
        '<label class="f">到（轉入）</label>' + accChips(F.toAccount, 'to') + (F._new && F._new.key === 'to' ? newBox() : '') +
        '<label class="f">轉出金額（' + cur + '）</label><input id="fAmt" class="amount-in" type="text" inputmode="decimal" placeholder="0" value="' + (F.amount || '') + '">' +
        (cross ? '<label class="f">實際入帳金額（' + toCur + '）</label><input id="fToAmt" class="amount-in" type="text" inputmode="decimal" placeholder="0" value="' + (F.toAmount || '') + '">' +
          '<div class="sub" id="fRate">' + (r ? '實際匯率 1 ' + toCur + ' ＝ ' + r.toFixed(3) + ' ' + cur : '輸入兩邊金額會自動算匯率') + '</div>' : '') +
        '<label class="f">手續費（' + cur + '，另記一筆「轉帳手續費」支出，沒有就空白）</label><input id="fFee" type="text" inputmode="decimal" value="' + (F.fee || '') + '">' +
        ((accMap()[F.toAccount] || {}).type === 'loan' ? '<label class="f">利息（' + cur + '，另記一筆「貸款利息」支出；轉出金額只填本金）</label><input id="fInt" type="text" inputmode="decimal" value="' + (F._interest || '') + '">' : '') +
        (cross && cur === 'JPY' && toCur === 'TWD' && !F.id && FUNDS.indexOf('台灣準備金') >= 0 ? '<label class="row" style="margin-top:10px"><input type="checkbox" id="fFund" ' + (F._fund === false ? '' : 'checked') + ' style="width:20px;height:20px"> 同時從「台灣準備金」扣除轉出金額＋手續費</label>' : '') +
        '<label class="f">日期</label><input id="fDate" type="date" value="' + F.date + '">' +
        '<label class="f">備註</label><input id="fNote" value="' + esc(F.note) + '">';
    } else {
      h += '<div class="row"><select id="fCur" style="width:90px">' + currencyOptions(F.currency) + '</select>' +
        '<input id="fAmt" class="amount-in grow" type="text" inputmode="decimal" placeholder="0" value="' + (F.amount || '') + '"></div>' +
        '<div class="cats">' + cats.map(function (c) { return '<button data-f="cat:' + esc(c.name) + '" class="' + (F.category === c.name ? 'on' : '') + '"><b>' + c.emoji + '</b>' + esc(c.name) + '</button>'; }).join('') +
        '<button data-f="newCat"><b>＋</b>新增</button></div>' + (F._new && F._new.kind === 'cat' ? newBox() : '') +
        '<label class="f">帳戶</label>' + accChips(F.account, 'acc') + (F._new && F._new.key === 'acc' ? newBox() : '') +
        '<div class="grid2"><div><label class="f">日期</label><input id="fDate" type="date" value="' + F.date + '"></div><div><label class="f">成員</label><select id="fMember">' + members().concat(members().indexOf(F.member) < 0 && F.member ? [F.member] : []).map(function (m) { return '<option' + (F.member === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div></div>' +
        '<label class="f">備註</label><input id="fNote" value="' + esc(F.note) + '">' + extraFields() +
        (merchant ? '<label class="row" style="margin-top:10px"><input type="checkbox" id="fRule" style="width:20px;height:20px"> 以後「' + esc(merchant) + '」都自動歸這個類別</label>' : '');
    }
    h += (F.id ? '<button class="danger" style="width:100%;margin-top:16px" data-f="del">刪除這筆' + (tr && F.fee ? '（連手續費）' : '') + '</button>' : '') +
      '<div id="fHint" class="sub" style="margin-top:8px"></div></div></div>';
    bg.innerHTML = h;
    document.body.appendChild(bg);
    var rcIn = bg.querySelector('#fReceipt');
    if (rcIn) rcIn.addEventListener('change', function () {
      var file = rcIn.files[0]; if (!file) return;
      readForm(bg); toast('處理照片…');
      compressImage(file, 1600, 0.72).then(function (d) { F._receiptData = d; drawForm(); }).catch(function (e) { toast(e.message); });
    });
    var amt = bg.querySelector('#fAmt');
    if (F._focus) { F._focus = false; setTimeout(function () { amt.focus(); }, 60); }
    if (F._new) setTimeout(function () { var n = bg.querySelector('#nName'); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); } }, 60);
    var rateUpd = function () {
      var el = bg.querySelector('#fRate'); if (!el) return;
      var a = L.num(bg.querySelector('#fAmt').value), b = L.num(bg.querySelector('#fToAmt').value);
      el.textContent = a && b ? '實際匯率 1 ' + accCur(F.toAccount) + ' ＝ ' + (a / b).toFixed(3) + ' ' + accCur(F.account) : '輸入兩邊金額會自動算匯率';
    };
    bg.addEventListener('input', rateUpd);
    bg.addEventListener('click', function (e) {
      if (e.target === bg) { bg.remove(); return; }
      var b = e.target.closest('[data-f]'); if (!b || b.disabled) return;
      readForm(bg);
      var a = b.dataset.f.split(':'), k = a[0], v = a.slice(1).join(':');
      if (k === 'close') bg.remove();
      else if (k === 'type') {
        if (v === F.type) return;
        F.type = v; F.category = ''; F._new = null;
        if (v === '轉') { if (!F.toAccount) F.toAccount = F.account === 'ゆうちょ' ? 'Pay Pay' : 'ゆうちょ'; } 
        drawForm();
      }
      else if (k === 'cat') { F.category = v; [].forEach.call(bg.querySelectorAll('.cats button'), function (x) { x.classList.toggle('on', x === b); }); hint(bg); }
      else if (k === 'acc' || k === 'to') {
        if (k === 'acc') F.account = v; else F.toAccount = v;
        if (F.type === '轉') drawForm();
        else { F.currency = accCur(v); var c = bg.querySelector('#fCur'); if (c) c.value = F.currency; [].forEach.call(b.parentNode.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); }); }
      }
      else if (k === 'tag') { var tg = tagsOf(F), ix = tg.indexOf(v); if (ix >= 0) tg.splice(ix, 1); else tg.push(v); F.tags = tg.join(','); b.classList.toggle('on', ix < 0); }
      else if (k === 'tagAdd') { var nt = bg.querySelector('#fTagNew').value.trim().replace(/^#/, '').replace(/[,，\s]/g, ''); if (!nt) return; var tl = tagsOf(F); if (tl.indexOf(nt) < 0) tl.push(nt); F.tags = tl.join(','); drawForm(); }
      else if (k === 'rcClear') { F._receiptData = null; drawForm(); }
      else if (k === 'rcDel') { if (confirm('移除這張收據？')) { F._rcRemove = true; drawForm(); } }
      else if (k === 'rcView') { if (F.receipt === 'pending') { toast('收據還在上傳'); return; } toast('讀取收據…'); api('getReceipt', { fileId: F.receipt }).then(function (r) { showImage('data:' + r.mimeType + ';base64,' + r.base64); }).catch(function (e) { toast(e.message); }); }
      else if (k === 'newCat') { F._new = { kind: 'cat' }; drawForm(); }
      else if (k === 'newAcc') { F._new = { kind: 'acc', key: v }; drawForm(); }
      else if (k === 'newCancel') { F._new = null; drawForm(); }
      else if (k === 'newCatOk') {
        var nm = bg.querySelector('#nName').value.trim(); if (!nm) { toast('請輸入名稱'); return; }
        if (catMap()[nm]) { var ex = catMap()[nm]; ex.hidden = ''; F.category = nm; F._new = null; drawForm(); return; }
        ensureCategory(nm, bg.querySelector('#nGroup').value.trim() || '其他', F.type, bg.querySelector('#nEmoji').value.trim() || '🏷️');
        persist(); F.category = nm; F._new = null; drawForm(); toast('已新增項目「' + nm + '」');
      }
      else if (k === 'newAccOk') {
        var an = bg.querySelector('#nName').value.trim(); if (!an) { toast('請輸入名稱'); return; }
        if (accMap()[an]) { toast('已經有「' + an + '」'); return; }
        var colors = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41'];
        D().accounts.push({ name: an, type: bg.querySelector('#nType').value, currency: bg.querySelector('#nCur').value, icon: '', color: colors[D().accounts.length % colors.length], closeDay: '', payDay: '', payAccount: '', order: D().accounts.length + 1, active: 'TRUE', opening: '', openingDate: '' });
        enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist();
        if (F._new.key === 'to') F.toAccount = an; else { F.account = an; F.currency = accCur(an); }
        F._new = null; drawForm(); toast('已新增帳戶「' + an + '」');
      }
      else if (k === 'save') saveForm(bg);
      else if (k === 'del') { if (confirm('確定刪除這筆？')) { removeTx(F.id); bg.remove(); } }
    });
  }
  function readForm(bg) {
    var q = function (s) { return bg.querySelector(s); };
    if (q('#fAmt')) F.amount = L.num(q('#fAmt').value);
    if (q('#fCur')) F.currency = q('#fCur').value;
    if (q('#fToAmt')) F.toAmount = L.num(q('#fToAmt').value);
    if (q('#fFee')) F.fee = L.num(q('#fFee').value) || '';
    if (q('#fInt')) F._interest = L.num(q('#fInt').value) || '';
    if (q('#fInst')) F.installments = Number(q('#fInst').value) || '';
    if (q('#fFund')) F._fund = q('#fFund').checked;
    if (q('#fDate')) F.date = q('#fDate').value || L.today();
    if (q('#fMember')) F.member = q('#fMember').value;
    if (q('#fNote')) F.note = q('#fNote').value.trim();
    var r = q('#fRule'); F._rule = r ? r.checked : false;
  }
  function hint(bg) {
    var el = bg.querySelector('#fHint'); if (!el || F.type !== '支') return;
    var st = budgetState(0), r = st.rows.filter(function (x) { return x.category === F.category; })[0];
    el.textContent = r ? F.category + ' 本期已用 ' + yen(r.spent) + ' / ' + yen(r.budget) + '，剩 ' + yen(r.budget - r.spent) : '';
  }
  function putTx(t, isNew) {
    if (isNew) { t.createdAt = new Date().toISOString().slice(0, 19); D().tx.push(t); enqueue('add', { tx: t }); }
    else {
      var i = D().tx.findIndex(function (x) { return x.id === t.id; });
      if (i >= 0) D().tx[i] = Object.assign(D().tx[i], t);
      enqueue('update', { tx: t });
    }
  }
  function saveTransfer(bg) {
    if (!F.amount) { toast('請輸入金額'); return; }
    if (!F.account || !F.toAccount) { toast('請選轉出和轉入帳戶'); return; }
    if (F.account === F.toAccount) { toast('轉出和轉入不能是同一個帳戶'); return; }
    var cur = accCur(F.account), toCur = accCur(F.toAccount), cross = cur !== toCur;
    if (cross && !F.toAmount) { toast('請輸入實際入帳金額（' + toCur + '）'); return; }
    var isNew = !F.id, amount = Math.abs(F.amount);
    var t = { id: F.id || uuid(), date: F.date, type: '轉', category: cross ? '匯款' : '轉帳', group: '', amount: amount, currency: cur, account: F.account, toAccount: F.toAccount, toAmount: cross ? Math.abs(F.toAmount) : amount, toCurrency: toCur, member: '自己', tags: '', note: F.note, source: F.source || 'manual', extId: '', status: 'ok' };
    putTx(t, isNew);
    var feeId = t.id + '-fee', feeOld = D().tx.filter(function (x) { return x.id === feeId; })[0], fee = Math.abs(Number(F.fee) || 0);
    if (fee) {
      ensureCategory('轉帳手續費', '其他', '支', '💸');
      putTx({ id: feeId, date: t.date, type: '支', category: '轉帳手續費', group: groupOf('轉帳手續費'), amount: fee, currency: cur, account: F.account, member: '自己', tags: '', note: (cross ? '匯款' : '轉帳') + '手續費 → ' + F.toAccount, source: 'transfer-fee', extId: t.id, status: 'ok' }, !feeOld);
    } else if (feeOld) { S.data.tx = D().tx.filter(function (x) { return x.id !== feeId; }); enqueue('remove', { id: feeId }); }
    var intId = t.id + '-int', intOld = D().tx.filter(function (x) { return x.id === intId; })[0], interest = Math.abs(Number(F._interest) || 0);
    if (interest && (accMap()[F.toAccount] || {}).type === 'loan') {
      ensureCategory('貸款利息', '其他', '支', '🏦');
      putTx({ id: intId, date: t.date, type: '支', category: '貸款利息', group: groupOf('貸款利息'), amount: interest, currency: cur, account: F.account, member: '自己', tags: '', note: F.toAccount + ' 利息', source: 'loan', extId: t.id, status: 'ok' }, !intOld);
    } else if (intOld) { S.data.tx = D().tx.filter(function (x) { return x.id !== intId; }); enqueue('remove', { id: intId }); }
    if (isNew && cross && F._fund && cur === 'JPY' && toCur === 'TWD') {
      var fund = { id: uuid(), date: t.date, fund: '台灣準備金', amount: -(amount + fee), note: '匯款 → ' + F.toAccount + ' ' + money(t.toAmount, toCur) };
      D().funds.push(fund); enqueue('addFund', { fund: fund });
    }
    persist(); bg.remove(); render();
    toast((isNew ? '已記' : '已更新') + (cross ? '匯款 ' : '轉帳 ') + money(amount, cur) + (cross ? ' → ' + money(t.toAmount, toCur) : '') + '\n' + F.account + ' → ' + F.toAccount + (fee ? '（手續費 ' + money(fee, cur) + '）' : ''), 3200);
  }
  function saveForm(bg) {
    if (F.type === '轉') return saveTransfer(bg);
    if (!F.amount) { toast('請輸入金額'); return; }
    if (!F.category) { toast('請選類別'); return; }
    var isNew = !F.id;
    var t = { id: F.id || uuid(), date: F.date, type: F.type, category: F.category, group: groupOf(F.category), amount: Math.abs(F.amount), currency: F.currency, account: F.account, member: F.member, tags: F.tags || '', note: F.note, source: F.source || 'manual', extId: F.extId || '', status: 'ok', toAccount: '', toAmount: '', toCurrency: '',
      installments: F.type === '支' && (accMap()[F.account] || {}).type === 'credit' && Number(F.installments) > 1 ? Number(F.installments) : '' };
    if (F._receiptData) t.receipt = 'pending'; else if (F._rcRemove) t.receipt = '';
    putTx(t, isNew);
    if (F._rcRemove && F.receipt && F.receipt !== 'pending') enqueue('removeReceipt', { fileId: F.receipt });
    if (F._receiptData) enqueue('uploadReceipt', { txId: t.id, base64: F._receiptData, mimeType: 'image/jpeg' });
    if (F._rule && F.note) {
      var kw = F.note.replace(/\s*(店|支店)$/, '').split(/\s+/)[0];
      D().rules.unshift({ keyword: kw, category: F.category, account: '' });
      enqueue('saveTable', { table: 'rules', rows: D().rules });
      // 同一家店其他待分類的也一起分好
      D().tx.forEach(function (x) {
        if (x.status === 'inbox' && x.id !== t.id && x.note && x.note.indexOf(kw) >= 0) { x.category = F.category; x.status = 'ok'; enqueue('update', { tx: { id: x.id, category: F.category, status: 'ok' } }); }
      });
    }
    persist(); bg.remove(); render();
    var msg = (isNew ? '已記帳 ' : '已更新 ') + money(t.amount, t.currency) + '（' + t.category + '）';
    if (t.type === '支') {
      var st = budgetState(0), r = st.rows.filter(function (x) { return x.category === t.category; })[0];
      if (r) { var p = Math.round(r.spent / r.budget * 100); msg += '\n' + t.category + ' 本期 ' + p + '%' + (p >= 100 ? ' ⚠️ 已超支' : p >= Number(setting('alertPercent', 80)) ? ' ⚠️ 快用完了' : ''); }
    }
    toast(msg, 3200);
  }
  function removeTx(id) {
    var ids = [id, id + '-fee', id + '-int'];
    S.data.tx = D().tx.filter(function (x) { if (ids.indexOf(x.id) >= 0) { enqueue('remove', { id: x.id }); return false; } return true; });
    persist(); render(); toast('已刪除');
  }

  /* ===================== 動作 ===================== */
  function tableSet(table, i, field, el) {
    var row = D()[table][Number(i)];
    row[field] = el.type === 'checkbox' ? (el.checked ? 'TRUE' : '') : el.type === 'number' ? Number(el.value) : el.value;
  }
  function readFile(el, as) {
    return new Promise(function (res, rej) {
      var f = el.files[0]; if (!f) return rej(new Error('沒有選檔案'));
      var r = new FileReader();
      r.onload = function () { res({ file: f, data: r.result }); };
      r.onerror = function () { rej(r.error); };
      if (as === 'text') r.readAsText(f, 'utf-8'); else if (as === 'url') r.readAsDataURL(f); else r.readAsArrayBuffer(f);
    });
  }
  function download(name, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function toCSV(list) {
    var head = ['日期', '類別', '大類別', '金額', '貨幣', '成員', '帳戶', '標籤', '備註', '收支區分', '來源', 'UUID', '轉入帳戶', '轉入金額', '轉入貨幣'];
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [head.join(',')].concat(list.map(function (t) {
      return [t.date.replace(/-/g, ''), t.category, t.group || groupOf(t.category), t.amount, t.currency || 'JPY', t.member, t.account, t.tags, t.note, t.type, t.source, t.id, t.toAccount || '', t.type === '轉' ? t.toAmount : '', t.type === '轉' ? t.toCurrency : ''].map(q).join(',');
    })).join('\n');
  }

  var ACTS = {
    /* ---------- 帳本 ---------- */
    bookSwitch: function (id) { switchBook(id); },
    bookOpen: function (id) { S.bookOpen = S.bookOpen === id ? null : id; render(); },
    bookCreate: function () {
      var name = document.getElementById('bkNew').value.trim(); if (!name) { toast('請輸入帳本名稱'); return; }
      toast('建立中…（約 10 秒）');
      api('createBook', { name: name, members: document.getElementById('bkMembers').value.trim() || '自己' }, 'main').then(function (r) {
        S.cfg.ownBooks.push(r.book); saveCfg(); switchBook(r.book.id);
      }).catch(function (e) { toast('建立失敗：' + e.message); });
    },
    bookRename: function (id) {
      var name = document.getElementById('bkName').value.trim(); if (!name) return;
      api('renameBook', { id: id, name: name }, 'main').then(function () { S.cfg.ownBooks.forEach(function (b) { if (b.id === id) b.name = name; }); saveCfg(); render(); toast('已改名'); }).catch(function (e) { toast(e.message); });
    },
    bookCopy: function (id) { var b = S.cfg.ownBooks.filter(function (x) { return x.id === id; })[0]; navigator.clipboard.writeText(inviteLink(b)).then(function () { toast('已複製邀請連結'); }); },
    bookShareNative: function (id) {
      var b = S.cfg.ownBooks.filter(function (x) { return x.id === id; })[0], link = inviteLink(b);
      if (navigator.share) navigator.share({ title: 'Wen 記帳', text: '一起用「' + b.name + '」記帳：用手機 Safari 打開，再「加入主畫面」', url: link }).catch(function () {});
      else navigator.clipboard.writeText(link).then(function () { toast('已複製邀請連結'); });
    },
    bookEmail: function (id) {
      var email = document.getElementById('bkEmail').value.trim(); if (!/@/.test(email)) { toast('請輸入 Gmail'); return; }
      api('shareBook', { id: id, email: email }, 'main').then(function (r) { S.cfg.ownBooks.forEach(function (b) { if (b.id === id) b.shared = r.shared; }); saveCfg(); render(); toast('已開放 ' + email); }).catch(function (e) { toast(e.message); });
    },
    bookNewToken: function (id) {
      if (!confirm('重設後舊邀請連結會失效，確定？')) return;
      api('shareBook', { id: id, newToken: true }, 'main').then(function (r) { S.cfg.ownBooks.forEach(function (b) { if (b.id === id) b.token = r.token; }); saveCfg(); render(); toast('已重設'); }).catch(function (e) { toast(e.message); });
    },
    bookRemove: function (id) {
      if (!confirm('從清單移除這個帳本？（試算表會留在雲端硬碟）')) return;
      api('removeBook', { id: id }, 'main').then(function () { S.cfg.ownBooks = S.cfg.ownBooks.filter(function (b) { return b.id !== id; }); saveCfg(); if (S.cfg.book === id) switchBook('main'); else render(); });
    },
    bookLeave: function (id) {
      if (!confirm('退出這個共享帳本？')) return;
      S.cfg.joined = S.cfg.joined.filter(function (b) { return b.id !== id; }); localStorage.removeItem(dataKey(id)); saveCfg();
      if (S.cfg.book === id) switchBook(S.cfg.url ? 'main' : (S.cfg.joined[0] || {}).id || 'main'); else render();
    },

    /* ---------- 標籤 ---------- */
    tagShow: function (g) { S.search = g; S.filterCat = ''; S.filterAcc = ''; S.tab = 'list'; S.page = null; S.listMode = 'list'; render(); },
    tagMove: function (arg) {
      var a = arg.split(':'), tags = allTags(), i = Number(a[0]), j = i + Number(a[1]);
      if (j < 0 || j >= tags.length) return;
      var t = tags[i]; tags[i] = tags[j]; tags[j] = t;
      D().settings.tagOrder = tags.join(','); enqueue('saveSettings', { settings: { tagOrder: tags.join(',') } }); persist(); render();
    },
    tagRename: function (g) {
      var n = (prompt('「' + g + '」改成：', g) || '').trim().replace(/[,，\s#]/g, ''); if (!n || n === g) return;
      var changed = [];
      D().tx.forEach(function (t) { var tg = tagsOf(t), k = tg.indexOf(g); if (k < 0) return; tg[k] = n; t.tags = tg.filter(function (x, i) { return tg.indexOf(x) === i; }).join(','); changed.push({ id: t.id, tags: t.tags }); });
      if (changed.length) enqueue('update', { txs: changed });
      var order = allTags().map(function (x) { return x === g ? n : x; }).join(','); D().settings.tagOrder = order; enqueue('saveSettings', { settings: { tagOrder: order } });
      persist(); render(); toast('已改 ' + changed.length + ' 筆');
    },

    /* ---------- 投資 ---------- */
    tradeNew: function (arg) {
      var a = arg.split(':'), acc = a[0], sym = a[1] || '', side = a[2] || 'buy';
      var prev = sym ? holdings(acc).filter(function (x) { return x.symbol === sym; })[0] : null;
      openTradeForm({ id: null, account: acc, symbol: sym, name: prev ? prev.name : '', market: prev ? prev.market : 'US', currency: prev ? prev.currency : 'USD', side: side, date: L.today(), qty: '', price: '', fee: '', settle: '', note: '' });
    },
    tradeEdit: function (id) { var t = (D().trades || []).filter(function (x) { return x.id === id; })[0]; if (t) openTradeForm(Object.assign({}, t)); },
    holdOpen: function (k) { S.holdOpen = S.holdOpen === k ? null : k; render(); },
    priceSet: function (arg) {
      var a = arg.split(':'), sym = a[0], v = L.num(document.getElementById('px_' + sym).value); if (!v) return;
      var p = priceRow(sym); if (p) { p.price = v; p.manual = 'TRUE'; p.updatedAt = new Date().toISOString().slice(0, 19); }
      enqueue('setPrice', { symbol: sym, price: v, currency: a[1] }); persist(); render(); toast('已更新 ' + sym);
    },
    refreshPrices: function () {
      toast('更新股價、匯率中…');
      flush().then(function () { return api('refreshPrices'); }).then(function () { return refresh(true); }).then(function () { toast('已更新'); }).catch(function (e) { toast('更新失敗：' + e.message); });
    },
    plColor: function (v) { D().settings.plColor = v; enqueue('saveSettings', { settings: { plColor: v } }); persist(); render(); },

    /* ---------- 貸款 ---------- */
    loanAdd: function () {
      var name = (prompt('貸款名稱（例如：台灣學貸、車貸）') || '').trim(); if (!name) return;
      if (accMap()[name]) { toast('已經有「' + name + '」'); return; }
      D().accounts.push({ name: name, type: 'loan', currency: 'TWD', icon: '', color: '#5d4037', closeDay: '', payDay: '', payAccount: '', order: D().accounts.length + 1, active: 'TRUE', opening: '', openingDate: '', rate: '', payment: '', principal: '', _orig: name });
      enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); S.loanEdit = D().accounts.length - 1; render();
    },
    loanEdit: function (i) { S.loanEdit = S.loanEdit === Number(i) ? null : Number(i); render(); },
    loanSave: function (i) {
      var a = D().accounts[Number(i)], rem = document.getElementById('lnRemain').value;
      if (rem !== '') { a.opening = -Math.abs(Number(rem)); a.openingDate = document.getElementById('lnDate').value || L.today(); }
      if (a._orig && a._orig !== a.name) { renameLocal('account', a._orig, a.name); enqueue('renameAccount', { from: a._orig, to: a.name }); a._orig = a.name; }
      enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); S.loanEdit = null; render(); toast('已儲存');
    },
    loanPay: function (i) {
      var a = D().accounts[Number(i)], info = loanInfo(a); if (!info) return;
      var from = a.payAccount || 'Line Bank';
      openTxForm(null, '轉');
      F.account = accMap()[from] ? from : F.account; F.toAccount = a.name; F.currency = accCur(F.account);
      F.amount = info.principalPart || ''; F._interest = info.interest; F.note = a.name + ' 還款'; F._focus = false;
      drawForm();
    },
    loanAuto: function (i) {
      var a = D().accounts[Number(i)];
      var ex = D().recurring.filter(function (r) { return r.toAccount === a.name; })[0];
      if (ex) { ex.active = ex.active ? '' : 'TRUE'; }
      else {
        if (!Number(a.payment) || !a.payAccount) { toast('先在「設定」填每月還款金額和扣款帳戶'); S.loanEdit = Number(i); render(); return; }
        D().recurring.push({ id: 'r' + Date.now(), name: a.name + ' 還款', category: '轉帳', amount: Number(a.payment), account: a.payAccount, day: Number(a.payDay) || 1, active: 'TRUE', note: a.name + ' 還款', type: '轉', freq: 'month', month: '', toAccount: a.name });
      }
      enqueue('saveTable', { table: 'recurring', rows: D().recurring }); persist(); render();
      toast(ex && !ex.active ? '已停用自動還款' : '每月 ' + (a.payDay || 1) + ' 號自動記還款（本金＋利息自動拆）');
    },

    /* ---------- 月曆 ---------- */
    listMode: function (m) { S.listMode = m; render(); },
    calMove: function (d) { S.calOffset = (S.calOffset || 0) + Number(d); S.calDay = null; render(); },
    calDay: function (d) { S.calDay = S.calDay === d ? null : d; render(); },

    /* ---------- 收據 ---------- */
    viewReceipt: function (id) {
      var t = D().tx.filter(function (x) { return x.id === id; })[0]; if (!t || !t.receipt) return;
      if (t.receipt === 'pending') { toast('收據還在上傳，等同步完成'); return; }
      toast('讀取收據…');
      api('getReceipt', { fileId: t.receipt }).then(function (r) { showImage('data:' + r.mimeType + ';base64,' + r.base64); }).catch(function (e) { toast('讀取失敗：' + e.message); });
    },

    /* ---------- 設定：成員、主題、隱私鎖 ---------- */
    saveMembers: function () { var v = document.getElementById('mbList').value.trim(); D().settings.members = v; enqueue('saveSettings', { settings: { members: v } }); persist(); toast('已儲存成員'); },
    theme: function (arg) { var a = arg.split(':'), t = load('kk_theme', {}); t[a[0]] = a[1]; save('kk_theme', t); applyTheme(); render(); },
    lockOn: function () {
      if (!window.PublicKeyCredential) { toast('這台裝置不支援 Face ID 鎖'); return; }
      var pin = (prompt('先設一組 4 位數備用密碼（Face ID 失敗時用，可空白）') || '').trim();
      if (pin && !/^\d{4}$/.test(pin)) { toast('密碼要 4 位數字'); return; }
      navigator.credentials.create({ publicKey: { rp: { name: 'Wen 記帳' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'wen-kakeibo', displayName: 'Wen 記帳' }, challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' }, timeout: 60000 } })
        .then(function (c) { return (pin ? pinHash(pin) : Promise.resolve('')).then(function (h) { save('kk_lock', { cred: b64(c.rawId), pin: h }); render(); toast('已開啟 Face ID 鎖'); }); })
        .catch(function (e) { toast('沒有開啟：' + (e.message || e.name)); });
    },
    lockOff: function () { if (!confirm('關閉 Face ID 鎖？')) return; localStorage.removeItem('kk_lock'); render(); toast('已關閉'); },
    go: function (p) { go(p); },
    back: function () { S.page = null; S.cycleOffset = 0; render(); },
    sync: function () { toast('同步中…'); refresh(); },
    cyc: function (d) { S.cycleOffset += Number(d); render(); },
    filterCat: function (_, el) { S.filterCat = el.value; render(); },
    filterAcc: function (_, el) { S.filterAcc = el.value; render(); },
    openInbox: function () { S.tab = 'more'; go('inbox'); },
    editTx: function (id) { var t = D().tx.filter(function (x) { return x.id === id; })[0]; if (t) openTxForm(t); },
    exportList: function () { download('記帳明細-' + L.today() + '.csv', toCSV(S._lastList || [])); },
    exportAll: function () { download('記帳全部-' + L.today() + '.csv', toCSV(sortTx(D().tx))); },
    copy: function (k) { var v = k === 'url' ? S.cfg.url : S.cfg.token; navigator.clipboard.writeText(v).then(function () { toast('已複製'); }); },

    saveCfg: function () {
      S.cfg.url = document.getElementById('cfgUrl').value.trim(); S.cfg.token = document.getElementById('cfgToken').value.trim();
      saveCfg(); toast('同步中…');
      refresh().then(function () { if (S.data) { S.tab = 'home'; S.page = null; render(); } });
    },
    saveSettings: function () {
      var o = {};
      [].forEach.call($app.querySelectorAll('[data-key]'), function (el) { o[el.dataset.key] = el.value; D().settings[el.dataset.key] = el.value; });
      enqueue('saveSettings', { settings: o }); toast('已儲存'); render();
    },
    resetLocal: function () { if (confirm('清除這支手機的暫存？之後會重新從雲端下載。')) { localStorage.removeItem(dataKey(S.cfg.book)); S.data = null; refresh(); } },
    testSummary: function () {
      fetch(S.cfg.url, { method: 'POST', body: JSON.stringify({ action: 'summary', period: 'day', token: S.cfg.token }) })
        .then(function (r) { return r.text(); }).then(function (t) { toast(t, 6000); }).catch(function (e) { toast('連線失敗：' + e.message); });
    },

    saveBudgets: function () {
      var rows = [];
      [].forEach.call($app.querySelectorAll('[data-bk]'), function (el) {
        var v = Number(el.value); if (!v) return;
        var p = el.dataset.bk.split('|'); rows.push({ category: p.slice(1).join('|'), period: p[0], amount: v });
      });
      S.data.budgets = rows; enqueue('saveTable', { table: 'budgets', rows: rows }); persist(); toast('預算已儲存'); S.page = null; S.tab = 'budget'; render();
    },

    fundAdd: function (arg) {
      var a = arg.split(':'), f = a[0], mode = a[1];
      var cur = sum(D().funds.filter(function (x) { return x.fund === f; }));
      var v = prompt(mode === 'set' ? f + ' 目前實際餘額是多少？' : f + (mode === 'in' ? ' 存入多少？' : ' 提出多少？'));
      if (v === null) return;
      var n = L.num(v); if (!n && mode !== 'set') return;
      var amount = mode === 'set' ? n - cur : mode === 'in' ? n : -n;
      if (!amount) return;
      var note = mode === 'set' ? '調整餘額' : (prompt('備註（可空白）') || '');
      var fund = { id: uuid(), date: L.today(), fund: f, amount: amount, note: note };
      D().funds.push(fund); enqueue('addFund', { fund: fund }); persist(); render();
    },
    fundDel: function (id) { if (!confirm('刪除這筆？')) return; S.data.funds = D().funds.filter(function (x) { return x.id !== id; }); enqueue('removeFund', { id: id }); persist(); render(); },

    billAmt: function (arg) {
      var a = arg.split(':'), key = 'billAmt_' + a[0] + '_' + a[1];
      var v = prompt(a[0] + ' ' + a[1] + ' 帳單實際要繳多少？（Epos App 或帳單上的金額；空白＝照刷卡紀錄計算）', setting(key, ''));
      if (v === null) return;
      v = v.trim() === '' ? '' : String(L.num(v));
      D().settings[key] = v; var o = {}; o[key] = v; enqueue('saveSettings', { settings: o }); persist(); render();
    },
    billPaid: function (arg) {
      var a = arg.split(':'), key = 'billPaid_' + a[0] + '_' + a[1], v = setting(key) === '1' ? '' : '1';
      D().settings[key] = v; var o = {}; o[key] = v; enqueue('saveSettings', { settings: o }); persist(); render();
    },

    advDone: function () {
      var ids = [].map.call($app.querySelectorAll('.advchk:checked'), function (x) { return x.value; });
      if (!ids.length) { toast('先勾選要標記的'); return; }
      markReturned(ids, document.getElementById('advIncome').checked);
    },
    advBefore: function () {
      var d = prompt('哪一天（含）以前的代墊全部標記已退回？格式 2026-11-01', L.today());
      if (!d) return;
      d = L.ymd(d); if (!d) { toast('日期格式不對'); return; }
      var ids = companyOpen().filter(function (t) { return t.date <= d; }).map(function (t) { return t.id; });
      if (!ids.length) { toast('沒有符合的'); return; }
      if (confirm('標記 ' + ids.length + ' 筆為已退回？')) markReturned(ids, false);
    },

    payslipFile: function (_, el) {
      var box = document.getElementById('psPreview'); box.innerHTML = '<div class="card">讀取中…</div>';
      readFile(el).then(function (r) { return extractPayslip(r.file, r.data); }).then(function (res) {
        S.ps = res; drawPayslipPreview();
      }).catch(function (e) { box.innerHTML = '<div class="alert red">讀取失敗：' + esc(e.message) + '</div>'; });
    },
    psSave: function () {
      var p = S.ps; readPayslipForm(p);
      var addIncome = document.getElementById('psIncome').checked;
      var rec = { id: 'payslip-' + p.month, month: p.month, payDate: p.payDate, gross: p.gross, deduction: p.deduction, net: p.net, items: JSON.stringify({ pay: p.pay, deduct: p.deduct, attendance: p.attendance }) };
      S.data.payslips = D().payslips.filter(function (x) { return x.id !== rec.id; }).concat([rec]);
      if (addIncome) D().tx.push({ id: 'salary-' + p.month, date: p.payDate, type: '收', category: '工資', amount: p.net, currency: 'JPY', account: 'ゆうちょ', member: '自己', note: p.month + ' 薪資（明細判讀）', source: 'payslip', status: 'ok' });
      enqueue('savePayslip', { payslip: rec, addIncome: addIncome }); persist(); S.ps = null; toast('薪資明細已存檔'); render();
    },
    psView: function (id) {
      var p = D().payslips.filter(function (x) { return x.id === id; })[0]; if (!p) return;
      var it = psItems(p);
      if (isGensen(p)) {
        var box = document.getElementById('psPreview'), fl = it.fields || {};
        box.innerHTML = '<div class="card"><h3>源泉徴収票 ' + esc(String(it.year || p.month)) + '</h3><div class="sub">' + esc(it.company || '') + '</div>' +
          Object.keys(fl).map(function (k) { return '<div class="row between"><span>' + esc(k) + '</span><span class="num">' + yen(fl[k]) + '</span></div>'; }).join('') +
          (it.note ? '<div class="sub" style="margin-top:6px">' + esc(it.note) + '</div>' : '') + '</div>';
        S.ps = null; window.scrollTo(0, 0); return;
      }
      S.ps = Object.assign({}, p, { pay: it.pay || {}, deduct: it.deduct || {}, attendance: it.attendance || {}, warnings: [], _saved: true });
      drawPayslipPreview(); window.scrollTo(0, 0);
    },
    psDel: function () {
      if (!confirm('刪除這份明細？（工資收入紀錄不會一起刪）')) return;
      var id = S.ps.id || ('payslip-' + S.ps.month); S.data.payslips = D().payslips.filter(function (x) { return x.id !== id; });
      enqueue('removePayslip', { id: id }); persist(); S.ps = null; render();
    },

    newTransfer: function () { openTxForm(null, '轉'); },
    assetEdit: function (name) { S.assetEdit = S.assetEdit === name ? null : name; render(); },
    assetSave: function (name) {
      var a = accMap()[name]; if (!a) return;
      var v = document.getElementById('opAmt').value, d = document.getElementById('opDate').value || L.today();
      if (v === '') { toast('請輸入金額'); return; }
      a.opening = a.type === 'credit' ? -Math.abs(Number(v)) : Number(v); a.openingDate = d;
      enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); S.assetEdit = null; render(); toast('已設定 ' + name + ' 起始餘額');
    },
    assetClear: function (name) { var a = accMap()[name]; if (!a) return; a.opening = ''; a.openingDate = ''; enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); S.assetEdit = null; render(); },
    catType: function (t) { S.catType = t; render(); },
    catSet: function (arg, el) {
      var a = arg.split(':');
      if (a[1] === 'hidden') { D().categories[Number(a[0])].hidden = el.checked ? 'TRUE' : ''; return; }
      tableSet('categories', a[0], a[1], el);
    },
    catMove: function (arg) {
      var a = arg.split(':'), c = D().categories[Number(a[0])], dir = Number(a[1]);
      var sib = D().categories.filter(function (x) { return x.type === c.type && x.group === c.group; }).sort(function (x, y) { return Number(x.order) - Number(y.order); });
      var k = sib.indexOf(c), o = sib[k + dir]; if (!o) return;
      var t = c.order; c.order = o.order; o.order = t;
      if (c.order === o.order) { o.order = Number(o.order) - dir * 0.5; }
      D().categories.slice().sort(function (x, y) { return Number(x.order) - Number(y.order); }).forEach(function (x, j) { x.order = j + 1; });
      render();
    },
    catDel: function (i) { var c = D().categories[Number(i)]; if (!c || !confirm('刪除「' + c.name + '」？')) return; D().categories.splice(Number(i), 1); D().budgets = D().budgets.filter(function (b) { return b.category !== c.name; }); enqueue('saveTable', { table: 'categories', rows: D().categories }); enqueue('saveTable', { table: 'budgets', rows: D().budgets }); persist(); render(); },
    catAdd: function () {
      var type = S.catType || '支', max = D().categories.reduce(function (m, c) { return Math.max(m, Number(c.order) || 0); }, 0);
      var last = D().categories.filter(function (c) { return c.type === type; }).slice(-1)[0];
      D().categories.push({ name: '', group: last ? last.group : '其他', type: type, emoji: '🏷️', order: max + 1, excludeBudget: '', hidden: '', _orig: '' });
      render(); var ins = $app.querySelectorAll('input.grow'); if (ins.length) ins[ins.length - 1].focus();
    },
    catSave: function () {
      var names = {}, bad = '';
      D().categories.forEach(function (c) { c.name = String(c.name).trim(); c.group = String(c.group || '').trim(); if (!c.name) bad = '名稱不能空白'; else if (names[c.name]) bad = '名稱重複：' + c.name; names[c.name] = 1; });
      if (bad) { toast(bad); return; }
      D().categories.forEach(function (c) {
        if (c._orig && c._orig !== c.name) { renameLocal('category', c._orig, c.name); enqueue('renameCategory', { from: c._orig, to: c.name }); }
        c._orig = c.name;
      });
      D().tx.forEach(function (t) { if (t.type !== '轉' && catMap()[t.category]) t.group = groupOf(t.category); });
      enqueue('saveTable', { table: 'categories', rows: D().categories }); persist(); toast('已儲存'); render();
    },
    simSet: function (k, el) { S.sim[k] = Number(el.value) || 0; render(); },

    recSet: function (arg, el) { var a = arg.split(':'); tableSet('recurring', a[0], a[1], el); },
    recDel: function (i) { D().recurring.splice(Number(i), 1); render(); },
    recType: function (arg) { var a = arg.split(':'), r = D().recurring[Number(a[0])]; r.type = a[1]; if (a[1] !== '轉') { var c = D().categories.filter(function (x) { return x.type === a[1]; })[0]; if (c && (catMap()[r.category] || {}).type !== a[1]) r.category = c.name; r.toAccount = ''; } else { r.category = '轉帳'; if (!r.toAccount) r.toAccount = 'Pay Pay'; } render(); },
    recFreq: function (i, el) { var r = D().recurring[Number(i)]; r.freq = el.value; if (el.value === 'week') r.day = 1; if (el.value === 'year' && !r.month) r.month = 1; render(); },
    recAdd: function () { D().recurring.push({ id: 'r' + Date.now(), name: '', category: '娛樂', amount: 0, account: 'ゆうちょ', day: 1, active: 'TRUE', note: '', type: '支', freq: 'month', month: '', toAccount: '' }); render(); },
    recSave: function () {
      D().recurring.forEach(function (r) { r.note = r.note || r.name; });
      enqueue('saveTable', { table: 'recurring', rows: D().recurring }); persist(); toast('固定收支已儲存');
    },

    accSet: function (arg, el) { var a = arg.split(':'); tableSet('accounts', a[0], a[1], el); if (a[1] === 'type' || a[1] === 'color') render(); },
    accAdd: function () { D().accounts.push({ name: '新帳戶', type: 'emoney', color: '#607d8b', order: D().accounts.length + 1, active: 'TRUE', icon: '', currency: 'JPY', _orig: '' }); render(); },
    accSave: function () {
      var names = {}, dup = '';
      D().accounts.forEach(function (a) { a.name = String(a.name).trim(); if (names[a.name]) dup = a.name; names[a.name] = 1; });
      if (dup) { toast('帳戶名稱重複：' + dup); return; }
      if (D().accounts.some(function (a) { return !a.name; })) { toast('帳戶名稱不能空白'); return; }
      D().accounts.forEach(function (a) {
        if (a._orig && a._orig !== a.name) { renameLocal('account', a._orig, a.name); enqueue('renameAccount', { from: a._orig, to: a.name }); }
        a._orig = a.name;
      });
      enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); toast('帳戶已儲存'); render();
    },
    accDel: function (i) { var a = D().accounts[Number(i)]; if (!a || !confirm('刪除帳戶「' + a.name + '」？')) return; D().accounts.splice(Number(i), 1); enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); render(); },
    accIcon: function (i, el) {
      readFile(el, 'url').then(function (r) { return shrinkImage(r.data, 96); }).then(function (url) {
        D().accounts[Number(i)].icon = url; render(); toast('記得按「儲存」');
      });
    },
    accIconDel: function (i) { D().accounts[Number(i)].icon = ''; render(); },

    ruleSet: function (arg, el) { var a = arg.split(':'); tableSet('rules', a[0], a[1], el); },
    ruleDel: function (i) { D().rules.splice(Number(i), 1); render(); },
    ruleAdd: function () { D().rules.unshift({ keyword: '', category: '食材', account: '' }); render(); },
    ruleSave: function () { S.data.rules = D().rules.filter(function (r) { return r.keyword; }); enqueue('saveTable', { table: 'rules', rows: D().rules }); persist(); toast('規則已儲存'); },
    cardSet: function (arg, el) { var a = arg.split(':'); tableSet('cards', a[0], a[1], el); },
    cardDel: function (i) { D().cards.splice(Number(i), 1); render(); },
    cardAdd: function () { D().cards.push({ keyword: '', account: 'Epos' }); render(); },
    cardSave: function () { S.data.cards = D().cards.filter(function (r) { return r.keyword; }); enqueue('saveTable', { table: 'cards', rows: D().cards }); persist(); toast('已儲存'); },

    ppFile: function (_, el) {
      var box = document.getElementById('ppPreview');
      readFile(el, 'text').then(function (r) {
        var p = L.parsePayPay(r.data, D().rules);
        var rec = L.reconcilePayPay(p.rows, D().tx);
        S.pp = rec;
        box.innerHTML = '<div class="info">CSV 裡 ' + p.rows.length + ' 筆（略過儲值等 ' + p.skipped + ' 筆）：<br>已經記過 ' + (rec.matched.length + rec.dup) + ' 筆，<b>漏記 ' + rec.add.length + ' 筆</b>' +
          (rec.add.filter(function (x) { return x.status === 'inbox'; }).length ? '（其中 ' + rec.add.filter(function (x) { return x.status === 'inbox'; }).length + ' 筆會放進待分類）' : '') + '</div>' +
          (rec.add.length ? '<div class="list">' + rec.add.slice(0, 50).map(txRow).join('') + '</div>' : '') +
          '<button class="primary" style="width:100%;margin-top:8px" data-act="ppCommit">補記 ' + rec.add.length + ' 筆</button>';
        bind();
      }).catch(function (e) { box.innerHTML = '<div class="alert red">' + esc(e.message) + '</div>'; });
    },
    ppCommit: function () {
      var rec = S.pp; if (!rec) return;
      rec.add.forEach(function (t) { D().tx.push(t); });
      for (var i = 0; i < rec.add.length; i += 400) enqueue('add', { txs: rec.add.slice(i, i + 400) });
      if (rec.matched.length) {
        rec.matched.forEach(function (m) { var t = D().tx.filter(function (x) { return x.id === m.id; })[0]; if (t) t.extId = m.extId; });
        enqueue('update', { txs: rec.matched.map(function (m) { return { id: m.id, extId: m.extId }; }) });
      }
      persist(); S.pp = null; toast('已補記 ' + rec.add.length + ' 筆'); render();
    },
    legacyFile: function (_, el) {
      var box = document.getElementById('lgPreview');
      readFile(el, 'text').then(function (r) {
        var rows = L.legacyToTx(r.data), have = {};
        D().tx.forEach(function (t) { have[t.id] = 1; });
        var fresh = rows.filter(function (t) { return !have[t.id]; });
        S.lg = fresh;
        box.innerHTML = '<div class="info">檔案 ' + rows.length + ' 筆，新的 ' + fresh.length + ' 筆（' + (fresh.length ? fresh[fresh.length - 1].date + '～' + fresh[0].date : '') + '）</div>' +
          (fresh.length ? '<button class="primary" style="width:100%" data-act="lgCommit">匯入 ' + fresh.length + ' 筆</button>' : '');
        bind();
      }).catch(function (e) { box.innerHTML = '<div class="alert red">' + esc(e.message) + '</div>'; });
    },
    lgCommit: function () {
      var rows = S.lg || []; if (!rows.length) return;
      toast('匯入中，請不要關閉 App…', 5000);
      var chunks = [];
      for (var i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));
      var n = 0;
      chunks.reduce(function (p, c) { return p.then(function () { return api('add', { txs: c }).then(function (j) { n += j.added; }); }); }, Promise.resolve())
        .then(function () { S.lg = null; toast('匯入完成 ' + n + ' 筆'); return refresh(true); })
        .catch(function (e) { toast('匯入中斷：' + e.message + '（已匯入 ' + n + ' 筆，再上傳一次會接著補）', 6000); });
    }
  };

  function markReturned(ids, income) {
    var txs = [];
    D().tx.forEach(function (t) {
      if (ids.indexOf(t.id) < 0) return;
      t.tags = (t.tags ? t.tags + '|' : '') + '已退回';
      txs.push({ id: t.id, tags: t.tags });
    });
    enqueue('update', { txs: txs });
    if (income) {
      var total = sum(D().tx.filter(function (t) { return ids.indexOf(t.id) >= 0; }));
      var r = { id: uuid(), date: L.today(), type: '收', category: '退費', amount: total, currency: 'JPY', account: 'ゆうちょ', member: '自己', note: '公司代墊退回 ' + ids.length + ' 筆', source: 'manual', status: 'ok' };
      D().tx.push(r); enqueue('add', { tx: r });
    }
    persist(); toast('已標記 ' + ids.length + ' 筆'); render();
  }

  function shrinkImage(dataUrl, size) {
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = size;
        var s = Math.min(img.width, img.height), ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = dataUrl;
    });
  }

  /* ===================== 薪資明細判讀 ===================== */
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; res(window.pdfjsLib); };
      s.onerror = function () { rej(new Error('PDF 讀取元件載入失敗，請確認網路')); };
      document.head.appendChild(s);
    });
  }
  function extractPayslip(file, buf) {
    var isPdf = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name);
    var textPromise = isPdf ? loadPdfJs().then(function (pdfjs) {
      return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise.then(function (doc) {
        var pages = [];
        for (var i = 1; i <= doc.numPages; i++) pages.push(doc.getPage(i).then(function (pg) { return pg.getTextContent(); }));
        return Promise.all(pages).then(function (cs) {
          var lines = [];
          cs.forEach(function (c) { lines = lines.concat(L.itemsToLines(c.items.map(function (it) { return { str: it.str, x: it.transform[4], y: it.transform[5] }; }))); });
          return lines;
        });
      });
    }) : Promise.resolve([]);
    return textPromise.then(function (lines) {
      if (lines.join('').replace(/\s/g, '').length > 30) return lines;
      // 掃描檔或照片：送到 Google Drive OCR
      var b64 = btoa(new Uint8Array(buf).reduce(function (s, b) { return s + String.fromCharCode(b); }, ''));
      return api('ocr', { base64: b64, mimeType: file.type || 'application/pdf', filename: file.name }).then(function (j) { return j.text.split(/\r?\n/); });
    }).then(function (lines) {
      var r = L.parsePayslip(lines);
      if (!r.payDate && r.month) r.payDate = r.month + '-' + ('0' + setting('payDay', 10)).slice(-2);
      if (!r.month) r.warnings.push('讀不到支払月份，請手動填');
      return r;
    });
  }
  function drawPayslipPreview() {
    var p = S.ps, box = document.getElementById('psPreview'); if (!box || !p) return;
    var existing = D().tx.filter(function (t) { return t.category === '工資' && t.type === '收' && p.payDate && Math.abs(L.dayDiff(t.date, p.payDate)) <= 5; })[0];
    var h = '<div class="card"><h3>' + (p._saved ? '已存的明細' : '判讀結果（請確認）') + '</h3>' + (p.warnings || []).map(function (w) { return '<div class="alert">' + esc(w) + '</div>'; }).join('') +
      '<div class="grid2"><div><label class="f">支払月份</label><input id="psMonth" value="' + esc(p.month) + '" placeholder="2026-11"></div><div><label class="f">入帳日</label><input id="psDate" type="date" value="' + esc(p.payDate) + '"></div></div>' +
      '<h2>支給</h2>' + Object.keys(p.pay).map(function (k) { return '<div class="edit-row"><span>' + esc(k) + '</span><input type="number" data-ps="pay|' + esc(k) + '" value="' + p.pay[k] + '"></div>'; }).join('') +
      '<h2>控除（社保・稅金）</h2>' + Object.keys(p.deduct).map(function (k) { return '<div class="edit-row"><span>' + esc(k) + '</span><input type="number" data-ps="deduct|' + esc(k) + '" value="' + p.deduct[k] + '"></div>'; }).join('') +
      '<div class="card" style="background:var(--card2)"><div class="row between"><span>總支給</span><b class="num">' + yen(p.gross) + '</b></div><div class="row between"><span>控除合計</span><b class="num">-' + yen(p.deduction).replace('¥', '') + '</b></div><div class="row between"><span>實領</span><b class="num pos">' + yen(p.net) + '</b></div></div>';
    if (!p._saved) {
      h += '<label class="row" style="margin:10px 0"><input type="checkbox" id="psIncome" ' + (existing ? '' : 'checked') + ' style="width:20px;height:20px"> 同時記一筆「工資」收入 ' + yen(p.net) + '</label>' +
        (existing ? '<div class="alert">' + existing.date + ' 已經有一筆工資 ' + yen(existing.amount) + '，所以預設不重複記。</div>' : '') +
        '<button class="primary" style="width:100%" data-act="psSave">確認存檔</button>';
    } else h += '<button class="danger" style="width:100%;margin-top:8px" data-act="psDel">刪除這份明細</button>';
    box.innerHTML = h + '</div>';
    bind();
  }
  function readPayslipForm(p) {
    p.month = document.getElementById('psMonth').value.trim();
    p.payDate = document.getElementById('psDate').value;
    [].forEach.call(document.querySelectorAll('[data-ps]'), function (el) { var a = el.dataset.ps.split('|'); p[a[0]][a.slice(1).join('|')] = Number(el.value) || 0; });
    var pay = Object.keys(p.pay).reduce(function (s, k) { return s + (k === '勤怠控除' ? -Math.abs(p.pay[k]) : p.pay[k]); }, 0);
    var ded = Object.keys(p.deduct).reduce(function (s, k) { return s + p.deduct[k]; }, 0);
    p.gross = pay; p.deduction = ded; p.net = pay - ded;
  }

  /* ===================== 啟動 ===================== */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  checkJoin();
  applyTheme();
  render();
  if (hasBackend()) refresh(true);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { S.hiddenAt = Date.now(); return; }
    if (S.hiddenAt && Date.now() - S.hiddenAt > 60000) lockIfNeeded();
    if (hasBackend()) refresh(true);
  });
  lockIfNeeded();
})();
