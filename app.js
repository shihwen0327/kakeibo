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
    tab: 'day', page: null, cycleOffset: 0, search: '', filterCat: '', filterAcc: '', syncing: false
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

  var TAB_NAME = { day: '日常', acc: '帳戶', report: '報表分析', set: '設定' };
  var PAGES = {};
  function render() {
    if (!TAB_NAME[S.tab]) S.tab = 'day';
    if (!hasBackend()) { S.tab = 'set'; S.page = 'settings'; }
    [].forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    var html;
    if (S.page) html = (PAGES[S.page] || PAGES.settings)();
    else html = ({ day: viewDay, acc: viewAccounts, report: viewReport, set: viewSettings })[S.tab]();
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
    var pg = $app.querySelector('.rp-pages');
    if (pg) {
      var w = pg.clientWidth || 1;
      pg.scrollLeft = (S.rpPage || 0) * w;
      pg.addEventListener('scroll', function () {
        var i = Math.round(pg.scrollLeft / (pg.clientWidth || 1));
        if (i === S.rpPage) return; S.rpPage = i;
        [].forEach.call($app.querySelectorAll('.dots span'), function (d, k) { d.classList.toggle('on', k === i); });
      });
    }
  }

  /* ===================== 共用元件 ===================== */
  var IC = {
    budget: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10 2h4M10 8h4M10 12h4M10 16h4"/></svg>',
    book: '<svg viewBox="0 0 24 24"><path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M6 3v18M10 3v7l2-1.5 2 1.5V3"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M15.5 4.5l4 4L8 20H4v-4z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    exp: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M14 15h4"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/></svg>',
    cat: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="M3 9.5 12 4l9 5.5M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 20h18"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/></svg>',
    cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>',
    split: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M12 9v6"/></svg>',
    piggy: '<svg viewBox="0 0 24 24"><path d="M5 11a7 6 0 0 1 13-2h2v4l-2 1v3h-3v-2h-5v2H7v-3a6 6 0 0 1-2-3z"/></svg>'
  };
  function topbar(l, c, r) { return '<div class="topbar"><div class="tb-l">' + (l || '') + '</div><div class="tb-c">' + (c || '') + '</div><div class="tb-r">' + (r || '') + '</div></div>'; }
  function pseg(items, cur, act) { return '<div class="pseg">' + items.map(function (x) { return '<button data-act="' + act + ':' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function pnav(label, act) { return '<div class="pnav"><button data-act="' + act + ':-1">‹</button><span>' + label + '</span><button data-act="' + act + ':1">›</button></div>'; }
  function back(title, right) {
    return topbar('<button class="tl" style="text-decoration:none" data-act="back">‹ ' + (TAB_NAME[S.tab] || '返回') + '</button>', esc(title), right || '');
  }
  /* 日幣顯示成純數字（Pennyworth 風格），其他幣別帶符號 */
  function nfmt(n, cur) {
    if (cur && cur !== 'JPY') return money(n, cur);
    n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('en-US');
  }
  function jdate(ymd, withWd) {
    var p = ymd.split('-').map(Number), d = L.parseYmd(ymd);
    return p[0] + '年' + p[1] + '月' + p[2] + '日' + (withWd ? '（' + '日一二三四五六'[d.getDay()] + '）' : '');
  }
  function cycLabel(c) {
    var a = c.start.split('-').map(Number), b = c.end.split('-').map(Number);
    return a[0] + '年' + a[1] + '月' + a[2] + '日～' + (a[0] !== b[0] ? b[0] + '年' : '') + b[1] + '月' + b[2] + '日';
  }
  /* 日本國定假日（行事曆標紅用） */
  var HOL = {};
  function jpHolidays(y) {
    if (HOL[y]) return HOL[y];
    var h = {}, add = function (m, d) { h[L.fmt(new Date(y, m - 1, d))] = 1; };
    var nthMon = function (m, n) { var f = new Date(y, m - 1, 1).getDay(); return 1 + ((8 - f) % 7) + (n - 1) * 7; };
    add(1, 1); add(1, nthMon(1, 2)); add(2, 11); add(2, 23);
    add(3, Math.floor(20.8431 + 0.242194 * (y - 1980)) - Math.floor((y - 1980) / 4));
    add(4, 29); add(5, 3); add(5, 4); add(5, 5); add(7, nthMon(7, 3)); add(8, 11); add(9, nthMon(9, 3));
    add(9, Math.floor(23.2488 + 0.242194 * (y - 1980)) - Math.floor((y - 1980) / 4));
    add(10, nthMon(10, 2)); add(11, 3); add(11, 23);
    Object.keys(h).forEach(function (k) {
      var d = L.parseYmd(k); if (d.getDay() !== 0) return;
      var n = new Date(d); do { n.setDate(n.getDate() + 1); } while (h[L.fmt(n)]);
      h[L.fmt(n)] = 1;
    });
    return (HOL[y] = h);
  }
  function isJpy(t) { return (t.currency || 'JPY') === 'JPY'; }
  function notices() {
    var h = '', st = budgetState(0), inbox = D().tx.filter(function (t) { return t.status === 'inbox'; });
    if (!S.data) h += '<div class="info">第一次使用：按右上角 ↻ 從 Google 試算表讀取資料。</div>';
    alertList(st).forEach(function (a) { h += '<div class="alert ' + (a.pct >= 100 ? 'red' : '') + '" data-act="go:budget">' + (a.pct >= 100 ? '⚠️ 已超支：' : '⚠️ 快用完：') + esc(a.name) + ' ' + a.pct + '%</div>'; });
    if (inbox.length) h += '<div class="alert" data-act="openInbox">❓ 待分類 ' + inbox.length + ' 筆，點這裡選類別 ›</div>';
    cardBills().filter(function (b) { return b.dueAmount > 0; }).forEach(function (b) { h += '<div class="info" data-act="go:cards">💳 ' + esc(b.account) + ' ' + b.due.slice(5).replace('-', '/') + ' 要繳 ' + yen(b.dueAmount) + '（下一期累積 ' + yen(b.openAmount) + '）</div>'; });
    return h ? '<div style="margin-top:6px">' + h + '</div>' : '';
  }

  /* ===================== 日常（行事曆／清單） ===================== */
  function viewDay() {
    var mode = S.listMode === 'list' ? 'list' : 'cal';
    var multi = S.cfg.ownBooks.length || S.cfg.joined.length;
    var h = topbar('<button class="ib" data-act="go:budget" title="預算">' + IC.budget + '</button>' + (multi ? '<button class="ib" data-act="go:books" title="帳本">' + IC.book + '</button>' : ''),
      pseg([['cal', '行事曆'], ['list', '清單']], mode, 'listMode'),
      '<button class="ib" data-act="daySearch" title="搜尋">' + IC.search + '</button><button class="ib" data-act="sync" title="同步">' + IC.sync + (S.queue.length ? '<span class="badge">' + S.queue.length + '</span>' : '') + '</button>');
    h += notices();
    return h + (mode === 'cal' ? viewCalendar() : viewList());
  }

  function txRow(t) {
    if (t.type === '轉') {
      var cross = t.toCurrency && t.toCurrency !== (t.currency || 'JPY');
      return '<div class="txr" data-act="editTx:' + esc(t.id) + '"><div class="ic">' + (cross ? '💱' : '🔁') + '</div><div class="grow"><div class="t1">' + (cross ? '匯款' : '轉帳') + '</div>' +
        '<div class="t2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.account) + ' → ' + esc(t.toAccount) + (t.note ? '・' + esc(t.note) : '') + '</div></div>' +
        '<div class="r"><div class="amt">' + nfmt(t.amount, t.currency) + '</div>' + (cross ? '<div class="t2">→ ' + money(t.toAmount, t.toCurrency) + '</div>' : '<div class="t2">轉帳</div>') + '</div></div>';
    }
    var tags = [];
    if (t.status === 'inbox') tags.push('<span class="pill amber">待分類</span>');
    if (t.member === '公司') tags.push('<span class="pill amber">' + (String(t.tags).indexOf('已退回') >= 0 ? '公司・已退回' : '公司代墊') + '</span>');
    if (t.source === 'wallet') tags.push('<span class="pill">錢包</span>');
    if (t.source === 'recurring') tags.push('<span class="pill">固定</span>');
    if (Number(t.installments) > 1) tags.push('<span class="pill">分 ' + t.installments + ' 期</span>');
    tagsOf(t).filter(function (g) { return g !== '已退回'; }).forEach(function (g) { tags.push('<span class="pill">' + esc(g) + '</span>'); });
    if (t.receipt) tags.push('<span class="pill">📎</span>');
    return '<div class="txr" data-act="editTx:' + esc(t.id) + '"><div class="ic">' + emoji(t.category) + '</div><div class="grow"><div class="t1">' + esc(t.category) + '</div>' +
      '<div class="t2" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.member || '自己') + (t.note ? '・' + esc(t.note) : '') + '</div>' + (tags.length ? '<div class="tg">' + tags.join('') + '</div>' : '') + '</div>' +
      '<div class="r"><div class="amt' + (t.type === '收' ? ' pos' : '') + '">' + (t.type === '收' ? '+' : '') + nfmt(t.amount, t.currency) + '</div><div class="t2">' + esc(t.account) + '</div></div></div>';
  }

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
    var h = '<div style="margin-top:8px"><input id="search" placeholder="搜尋：店名、備註、類別、金額…" value="' + esc(S.search) + '"></div>' +
      '<div class="grid2" style="margin-top:8px"><select data-act="filterCat"><option value="">全部類別</option>' + cats.map(function (x) { return '<option' + (x === S.filterCat ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
      '<select data-act="filterAcc"><option value="">全部帳戶</option>' + accs.map(function (x) { return '<option' + (x === S.filterAcc ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>';
    if (!searching) h += pnav(cycLabel(c), 'cyc');
    else h += '<div class="row between" style="margin-top:6px"><span class="sub">搜尋全部期間</span><button class="ghost" data-act="clearFilter">清除條件</button></div>';
    var out = sum(list.filter(function (t) { return t.type === '支' && isJpy(t); }));
    var inc = sum(list.filter(function (t) { return t.type === '收' && isJpy(t); }));
    h += '<div class="dsum"><span>支出:' + nfmt(out) + '</span><span class="pos">收入:' + nfmt(inc) + '</span><span class="sub" style="margin-left:auto">' + list.length + ' 筆</span><button class="ghost" style="padding:0" data-act="exportList">匯出 CSV</button></div>';
    var byDay = {};
    list.slice(0, 600).forEach(function (t) { (byDay[t.date] = byDay[t.date] || []).push(t); });
    var days = Object.keys(byDay).sort().reverse();
    if (!days.length) h += '<div class="empty">沒有紀錄</div>';
    days.forEach(function (d) {
      var dd = L.parseYmd(d), wd = '日一二三四五六'[dd.getDay()];
      h += '<div class="day-h"><span>' + d.slice(5).replace('-', '/') + '（' + wd + '）</span><span class="num">支出 ' + nfmt(sum(byDay[d].filter(function (t) { return t.type === '支' && isJpy(t); }))) + '</span></div><div class="lst">' + byDay[d].map(txRow).join('') + '</div>';
    });
    if (list.length > 600) h += '<div class="sub">只顯示前 600 筆，請縮小搜尋範圍</div>';
    S._lastList = list;
    return h;
  }

  function viewCalendar() {
    var t0 = L.today().split('-').map(Number), base = new Date(t0[0], t0[1] - 1 + (S.calOffset || 0), 1);
    var y = base.getFullYear(), m = base.getMonth();
    var lead = (base.getDay() + 6) % 7, start = new Date(y, m, 1 - lead);
    var cells = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7) * 7;
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + cells - 1);
    var list = txIn(L.fmt(start), L.fmt(end)), by = {};
    list.forEach(function (t) { by[t.date] = (by[t.date] || 0) + 1; });
    var today = L.today(), sel = S.calDay || today;
    var h = '<div class="pnav"><button data-act="calMove:-1">‹</button><span style="font-size:19px">' + y + '年' + (m + 1) + '月</span><button data-act="calMove:1">›</button></div>' +
      '<div class="calw">' + '一二三四五六日'.split('').map(function (w) { return '<div class="wh">週' + w + '</div>'; }).join('');
    for (var i = 0; i < cells; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), ds = L.fmt(d), n = by[ds] || 0;
      var cls = 'cd' + (d.getMonth() !== m ? ' out' : '') + (n ? ' has' : '') + (jpHolidays(d.getFullYear())[ds] ? ' hol' : '') + (ds === sel ? ' on' : '') + (ds === today ? ' today' : '');
      h += '<div class="' + cls + '" data-act="calDay:' + ds + '"><b>' + (ds === today ? '今天' : d.getDate()) + '</b><i>' + (n ? '•••'.slice(0, Math.min(3, n)) : '') + '</i></div>';
    }
    h += '</div>';
    var show = sortTx(D().tx.filter(function (t) { return t.date === sel; }));
    var out = sum(show.filter(function (t) { return t.type === '支' && isJpy(t); })), inc = sum(show.filter(function (t) { return t.type === '收' && isJpy(t); }));
    h += '<div class="dsum"><span>支出:' + nfmt(out) + '</span>' + (inc ? '<span class="pos">收入:' + nfmt(inc) + '</span>' : '') + '<span class="sub" style="margin-left:auto">' + sel.slice(5).replace('-', '/') + '</span></div>';
    h += '<div class="lst">' + (show.length ? show.map(txRow).join('') : '<div class="empty">這天沒有紀錄</div>') + '</div>';
    var st = budgetState(0), daysLeft = L.dayDiff(st.c.end, today) + 1, remain = st.total - st.spent;
    var spentToday = sum(txIn(today, today, function (t) { return isBudgetable(t) && !inYearlyOnly(t); }));
    if (st.total) h += '<div class="strip" data-act="go:budget"><div><b class="' + (remain < 0 ? 'neg' : 'pos') + '">' + nfmt(remain) + '</b><span>本期剩餘預算</span></div><div><b class="pos">' + nfmt(Math.max(0, Math.floor(remain / daysLeft))) + '</b><span>每天可用</span></div><div><b class="neg">' + nfmt(spentToday) + '</b><span>今天已花</span></div></div>';
    return h;
  }

  /* ===================== 預算（月預算／年預算） ===================== */
  function ringSvg(pct, size) {
    size = size || 104; var r = size / 2 - 8, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct)), d = c * p / 100;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#48484a" stroke-width="2"/>' +
      (d ? '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (pct < 0 ? 'var(--red)' : 'var(--green)') + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + d + ' ' + c + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' : '') +
      '<text x="' + size / 2 + '" y="' + (size / 2 + 7) + '" text-anchor="middle" fill="currentColor" font-size="20">' + Math.round(pct) + '<tspan font-size="12">%</tspan></text></svg>';
  }
  function bRow(o) {
    var pct = o.budget ? (o.budget - o.spent) / o.budget * 100 : 0;
    return '<div class="brow' + (o.grp ? ' grp' : '') + '">' + (o.grp ? '<div class="gb">' + esc(String(o.name).charAt(0)) + '</div>' : '<div class="ic">' + o.icon + '</div>') +
      '<div class="grow"><div class="l1"><span>' + esc(o.name) + '</span><span class="num' + (o.budget ? '' : ' sub') + '">' + (o.budget ? nfmt(o.budget) : o.note || '未設定') + '</span></div>' +
      (o.budget ? remBar(o.spent, o.budget) : '<div class="bar"></div>') +
      '<div class="l2"><span class="' + (o.budget && o.spent > o.budget ? 'neg' : '') + '">餘額:' + (o.budget ? nfmt(o.budget - o.spent) + '(' + Math.round(pct) + '%)' : '--') + '</span><span class="num">支出:' + nfmt(o.spent) + '</span></div></div></div>';
  }
  PAGES.budget = function () {
    var mode = S.budMode === 'year' ? 'year' : 'month';
    var h = topbar('<button class="ib" data-act="back" title="關閉">' + IC.close + '</button>', pseg([['month', '月預算'], ['year', '年預算']], mode, 'budMode'), '<button class="ib" data-act="go:budgetEdit" title="編輯預算">' + IC.edit + '</button>');
    var today = L.today(), cats = D().categories.filter(function (c) { return c.type === '支' && catVisible(c) && String(c.excludeBudget).toUpperCase() !== 'TRUE'; });
    var groups = [], gm = {};
    cats.sort(function (a, b) { return Number(a.order) - Number(b.order); }).forEach(function (c) { var g = c.group || '其他'; if (!gm[g]) { gm[g] = []; groups.push(g); } gm[g].push(c); });
    var total, spent, a, b, daysLeft, daysGone, rowsFor;
    if (mode === 'month') {
      var st = budgetState(S.cycleOffset), c = st.c, bm = {}, yb = yearBudgetCats();
      st.rows.forEach(function (r) { bm[r.category] = r.budget; });
      var cyc = txIn(c.start, c.end, isBudgetable), sp = {};
      cyc.forEach(function (t) { sp[t.category] = (sp[t.category] || 0) + Number(t.amount); });
      total = st.total; spent = st.spent; a = c.start; b = c.end;
      h += pnav(cycLabel(c), 'cyc');
      rowsFor = function (cat) { var yo = yb[cat.name] !== undefined || yb['#' + (cat.group || '其他')] !== undefined; return { icon: cat.emoji, name: cat.name, budget: bm[cat.name] || 0, spent: sp[cat.name] || 0, note: yo ? '年預算' : '' }; };
    } else {
      var yy = Number(today.slice(0, 4)) + (S.yearOffset || 0), ys = yy + '-01-01', bs = setting('budgetStart', ''); if (bs > ys && bs.slice(0, 4) === String(yy)) ys = bs;
      var yb2 = yearBudgetCats(), sp2 = {};
      txIn(ys, yy + '-12-31', isBudgetable).forEach(function (t) { sp2[t.category] = (sp2[t.category] || 0) + Number(t.amount); });
      total = Object.keys(yb2).reduce(function (s, k) { return s + yb2[k]; }, 0);
      spent = Object.keys(sp2).reduce(function (s, k) { return s + sp2[k]; }, 0);
      a = ys; b = yy + '-12-31';
      h += pnav(yy + '年1月1日～' + yy + '年12月31日', 'yearMove');
      rowsFor = function (cat) { return { icon: cat.emoji, name: cat.name, budget: yb2[cat.name] || 0, spent: sp2[cat.name] || 0 }; };
      gm.__year = yb2;
    }
    var inRange = today >= a && today <= b;
    daysLeft = inRange ? L.dayDiff(b, today) + 1 : (today < a ? L.dayDiff(b, a) + 1 : 0);
    daysGone = inRange ? L.dayDiff(today, a) + 1 : (today > b ? L.dayDiff(b, a) + 1 : 0);
    var remain = total - spent, pct = total ? remain / total * 100 : 0;
    h += '<div class="bsum">' + ringSvg(pct, 108) + '<table><tr><td>預算</td><td>' + (total ? nfmt(total) : '<span class="sub" style="font-size:16px">未設定</span>') + '</td></tr><tr><td>支出</td><td class="neg">' + nfmt(spent) + '</td></tr><tr><td>餘額</td><td class="' + (remain < 0 ? 'neg' : 'pos') + '">' + (total ? nfmt(remain) : '--') + '</td></tr></table></div>';
    h += '<div class="row between" style="padding:6px 2px 8px"><span style="font-size:16px">各類別預算</span><span>合計:' + nfmt(total) + '</span></div><div style="margin:0 -14px">';
    groups.forEach(function (g) {
      var rows = gm[g].map(rowsFor), gb = rows.reduce(function (s, r) { return s + r.budget; }, 0), gs = rows.reduce(function (s, r) { return s + r.spent; }, 0);
      if (mode === 'year' && gm.__year['#' + g]) gb = gm.__year['#' + g];
      h += bRow({ grp: true, name: g, budget: gb, spent: gs });
      rows.forEach(function (r) { h += bRow(r); });
    });
    h += '</div><div style="height:70px"></div>';
    h += '<div class="bfix"><div class="strip" style="margin-top:0"><div><b>' + daysLeft + '</b><span>剩餘天數</span></div><div><b class="pos">' + (total && daysLeft ? nfmt(Math.floor(remain / daysLeft)) : '--') + '</b><span>剩餘預算/天</span></div><div><b class="neg">' + (daysGone ? nfmt(Math.round(spent / daysGone)) : '--') + '</b><span>實際支出/天</span></div></div></div>';
    if (mode === 'month') {
      var st2 = budgetState(S.cycleOffset);
      if (st2.years.length) h = h.replace('<div style="height:70px"></div>', '<div class="sub" style="margin-top:10px">設了年預算的類別不算進每月剩餘預算，到「年預算」看。</div><div style="height:70px"></div>');
    }
    return h;
  };
  function bar(v, max) {
    var p = max ? v / max * 100 : 0, al = Number(setting('alertPercent', 80));
    return '<div class="bar ' + (p >= 100 ? 'red' : p >= al ? 'amber' : '') + '"><i style="width:' + Math.min(100, p).toFixed(1) + '%"></i></div>';
  }
  /* 預算頁：條狀顯示「剩下多少」 */
  function remBar(v, max) {
    var p = max ? v / max * 100 : 0, al = Number(setting('alertPercent', 80));
    return '<div class="bar ' + (p >= 100 ? 'red' : p >= al ? 'amber' : '') + '"><i style="width:' + Math.max(0, 100 - Math.min(100, p)).toFixed(1) + '%"></i></div>';
  }

  /* ===================== 帳戶 ===================== */
  function netTotals() {
    var tot = 0, assets = 0, debt = 0, miss = [];
    D().accounts.forEach(function (a) {
      var b = accValue(a); if (b === null || netExcluded(a.name)) return;
      var v = convert(b, accCur(a.name), 'JPY'); if (v === null) { miss.push(accCur(a.name)); return; }
      tot += v; if (v >= 0) assets += v; else debt -= v;
    });
    return { net: tot, assets: assets, debt: debt, miss: miss };
  }
  function viewAccounts() {
    var h = topbar('<button class="tl" data-act="go:accounts">編輯</button><button class="tl" data-act="newTransfer">轉帳</button>', '帳戶', '<button class="ib" data-act="go:assets" title="起始餘額、匯率、匯款紀錄">' + IC.more + '</button>');
    var n = netTotals(), c = cycle(0);
    var net = sum(txIn(c.start, c.end, function (t) { return t.type === '收' && isJpy(t); })) - sum(txIn(c.start, c.end, function (t) { return t.type === '支' && isJpy(t); }));
    h += '<div class="nethead"><b class="' + (n.net < 0 ? 'neg' : '') + '">' + yen(n.net) + '</b><div class="sub">淨資產' + (fxRate('TWD') ? '　≈ ' + money(n.net / fxRate('TWD'), 'TWD') : '') + '</div></div>';
    h += '<div class="stats3"><div><b class="pos">' + nfmt(n.assets) + '</b><span>總資產</span></div><div><b class="neg">' + nfmt(n.debt) + '</b><span>負債</span></div><div><b class="' + (net < 0 ? 'neg' : 'pos') + '">' + nfmt(net) + '</b><span>本期收支</span></div></div>';
    var at = assetTotals();
    if (at.curs.length) h += '<div class="curline">' + at.curs.map(function (x) { return '<span>' + x.label + ' <b>' + money(x.total, x.cur) + '</b></span>'; }).join('') + '</div>';
    if (n.miss.length) h += '<div class="sub" style="text-align:center">' + n.miss.join('、') + ' 還沒有匯率，沒算進淨資產</div>';
    var unset = D().accounts.filter(function (a) { return a.active && a.type !== 'invest' && accBalance(a) === null; }).length;
    if (unset) h += '<div class="info" style="margin-top:10px" data-act="go:openingBulk">' + unset + ' 個帳戶還沒設起始餘額，點這裡一次填全部 ›</div>';
    h += '<div class="sec-h dark" style="margin-top:12px">帳戶清單</div><div class="lst">';
    var accs = D().accounts.filter(function (a) { return a.active || accValue(a) !== null; });
    accs.forEach(function (a) {
      var b = accValue(a), cur = accCur(a.name), debtT = a.type === 'credit' || a.type === 'loan';
      h += '<button class="li" data-act="accOpen:' + esc(a.name) + '">' + accIcon(a.name) + '<div class="grow"><div class="t1">' + esc(a.name) + '</div><div class="t2">' + cur + (debtT ? ' <span class="pill" style="border:1px solid #636366;background:none;border-radius:3px;padding:0 3px">負債型</span>' : a.type === 'invest' ? ' <span class="pill" style="border:1px solid #636366;background:none;border-radius:3px;padding:0 3px">投資</span>' : '') + (netExcluded(a.name) ? ' <span class="pill" style="border:1px solid #636366;background:none;border-radius:3px;padding:0 3px">不計入</span>' : '') + '</div></div>' +
        '<span class="r num ' + (b === null ? '' : b < 0 ? 'neg' : 'pos') + '" style="font-size:17px">' + (b === null ? '<span class="sub">未設定</span>' : nfmt(b, cur)) + '</span><span class="chev">›</span></button>';
    });
    h += '</div>';
    if (!accs.length) h += '<div class="empty">還沒有帳戶</div>';
    return h;
  }

  /* ===================== 報表分析 ===================== */
  var PIE = ['#8e98dc', '#e8907c', '#d8c66c', '#95c792', '#c79ad8', '#7cc6d8', '#e0a96b', '#a3a3a8', '#d88fae', '#9fd4b5', '#b8a77c', '#7d8fc4'];
  function rpRange(off) {
    var mode = S.rpMode || 'month', t = L.today();
    if (mode === 'year') { var y = Number(t.slice(0, 4)) + (S.rpYear || 0) + (off || 0); return { start: y + '-01-01', end: y + '-12-31', label: y + '年' }; }
    if (mode === 'range') {
      var a = S.rpFrom || cycle(0).start, b = S.rpTo || t, len = L.dayDiff(b, a) + 1;
      if (off) { var sh = function (s) { var d = L.parseYmd(s); d.setDate(d.getDate() + off * len); return L.fmt(d); }; a = sh(a); b = sh(b); }
      return { start: a, end: b, label: a.replace(/-/g, '/') + '～' + b.replace(/-/g, '/') };
    }
    var c = cycle((S.cycleOffset || 0) + (off || 0)); return { start: c.start, end: c.end, label: cycLabel(c) };
  }
  function pieSvg(items) {
    var tot = items.reduce(function (s, x) { return s + x.v; }, 0); if (!tot) return '<svg width="170" height="170"></svg>';
    var a0 = -Math.PI / 2, cx = 85, cy = 85, r = 80, g = '';
    items.forEach(function (x, i) {
      var a1 = a0 + x.v / tot * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      if (items.length === 1) g += '<circle cx="85" cy="85" r="80" fill="' + PIE[0] + '"/>';
      else g += '<path d="M' + cx + ' ' + cy + 'L' + (cx + r * Math.cos(a0)).toFixed(2) + ' ' + (cy + r * Math.sin(a0)).toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + (cx + r * Math.cos(a1)).toFixed(2) + ' ' + (cy + r * Math.sin(a1)).toFixed(2) + 'Z" fill="' + PIE[i % PIE.length] + '" stroke="#000" stroke-width=".5"/>';
      if (x.v / tot > 0.07) { var am = (a0 + a1) / 2; g += '<text x="' + (cx + r * .6 * Math.cos(am)).toFixed(1) + '" y="' + (cy + r * .6 * Math.sin(am) + 4).toFixed(1) + '" fill="#1c1c1e" font-size="11" text-anchor="middle">' + esc(x.k) + '</text>'; }
      a0 = a1;
    });
    return '<svg width="170" height="170" viewBox="0 0 170 170">' + g + '</svg>';
  }
  function trendSvg(series, kind) {
    var W = 360, H = 200, l = 40, rgt = 40, top = 12, bot = 40, n = series.length || 1, bw = (W - l - rgt) / n;
    var g = '', vals = [];
    series.forEach(function (s) { if (kind === 'net') vals.push(s.v); else { vals.push(s.inc, s.out); } });
    var mx = Math.max.apply(null, vals.concat([1])), mn = Math.min.apply(null, vals.concat([0]));
    var line = series.map(function (s) { return kind === 'net' ? s.v : s.cum; });
    var lmx = Math.max.apply(null, line.concat([1])), lmn = Math.min.apply(null, line.concat([0]));
    var y = function (v) { return top + (H - top - bot) * (1 - (v - mn) / ((mx - mn) || 1)); };
    var y2 = function (v) { return top + (H - top - bot) * (1 - (v - lmn) / ((lmx - lmn) || 1)); };
    [0, .5, 1].forEach(function (f) { var v = mn + (mx - mn) * f; g += '<line x1="' + l + '" x2="' + (W - rgt) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#3a3a3c"/><text x="' + (l - 4) + '" y="' + (y(v) + 3) + '" fill="#8e8e93" font-size="9" text-anchor="end">' + Math.round(v / 1000) + 'k</text>'; });
    if (kind !== 'net') series.forEach(function (s, i) {
      var x = l + i * bw;
      g += '<rect x="' + (x + bw * .18) + '" y="' + y(s.inc) + '" width="' + bw * .3 + '" height="' + Math.max(0, y(0) - y(s.inc)) + '" fill="#95c792"><title>' + s.label + ' 收入 ' + nfmt(s.inc) + '</title></rect>';
      g += '<rect x="' + (x + bw * .52) + '" y="' + y(s.out) + '" width="' + bw * .3 + '" height="' + Math.max(0, y(0) - y(s.out)) + '" fill="#e8907c"><title>' + s.label + ' 支出 ' + nfmt(s.out) + '</title></rect>';
    });
    var pts = series.map(function (s, i) { return (l + i * bw + bw / 2).toFixed(1) + ',' + (kind === 'net' ? y(s.v) : y2(s.cum)).toFixed(1); });
    g += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (kind === 'net' ? '#8e98dc' : '#d8c66c') + '" stroke-width="2"/>';
    pts.forEach(function (p) { var q = p.split(','); g += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="2.6" fill="' + (kind === 'net' ? '#8e98dc' : '#d8c66c') + '"/>'; });
    series.forEach(function (s, i) { var x = l + i * bw + bw / 2; g += '<text transform="translate(' + x + ',' + (H - bot + 12) + ') rotate(-40)" fill="#8e8e93" font-size="9" text-anchor="end">' + s.label + '</text>'; });
    if (kind !== 'net') [0, 1].forEach(function (f) { var v = lmn + (lmx - lmn) * f; g += '<text x="' + (W - rgt + 4) + '" y="' + (y2(v) + 3) + '" fill="#8e8e93" font-size="9">' + Math.round(v / 1000) + 'k</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }
  /* 薪資分析用：每月兩根長條 */
  function barsChart(series) {
    var W = 340, H = 170, top = 10, bot = 22, max = Math.max.apply(null, series.map(function (s) { return Math.max(s.out, s.inc); }).concat([1]));
    var bw = Math.min(34, (W - 30) / Math.max(1, series.length)), y = function (v) { return top + (H - top - bot) * (1 - v / max); };
    var g = '';
    series.forEach(function (s, i) {
      var x = 30 + i * bw;
      g += '<rect x="' + (x + 2) + '" y="' + y(s.inc) + '" width="' + (bw / 2 - 2) + '" height="' + (H - bot - y(s.inc)) + '" fill="#8e98dc"><title>' + s.label + ' ' + yen(s.inc) + '</title></rect>';
      g += '<rect x="' + (x + bw / 2) + '" y="' + y(s.out) + '" width="' + (bw / 2 - 2) + '" height="' + (H - bot - y(s.out)) + '" fill="#95c792"><title>' + s.label + ' ' + yen(s.out) + '</title></rect>';
      if (i % 2 === 1 || i === series.length - 1) g += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" fill="#8e8e93" font-size="10" text-anchor="middle">' + s.label + '</text>';
    });
    [0, 0.5, 1].forEach(function (f) { g += '<text x="26" y="' + (y(max * f) + 4) + '" fill="#8e8e93" font-size="9" text-anchor="end">' + Math.round(max * f / 1000) + 'k</text>'; });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%">' + g + '</svg>';
  }
  function pctChange(cur, prev) { var d = cur - prev; return (d >= 0 ? '↑ ' : '↓ ') + nfmt(Math.abs(d)) + (prev ? ' (' + Math.abs(d / Math.abs(prev) * 100).toFixed(2) + '%)' : ''); }
  /* 某天結束時的淨資產（日圓）。投資帳戶的持股用目前市值估算 */
  function netAt(date) {
    var tot = 0;
    D().accounts.forEach(function (a) {
      var inv = a.type === 'invest';
      if (netExcluded(a.name)) return;
      if (!inv && (a.opening === '' || a.opening == null || !a.openingDate)) return;
      var od = a.openingDate ? String(a.openingDate).slice(0, 10) : '', bal = Number(a.opening) || 0, sign;
      var eff = function (t) {
        if (t.type === '轉') return (t.account === a.name ? -(Number(t.amount) || 0) : 0) + (t.toAccount === a.name ? Number(t.toAmount !== '' && t.toAmount != null ? t.toAmount : t.amount) || 0 : 0);
        return t.account === a.name ? (t.type === '收' ? 1 : -1) * (Number(t.amount) || 0) : 0;
      };
      D().tx.forEach(function (t) { if (t.date > od && t.date <= date) bal += eff(t); else if (t.date <= od && t.date > date) bal -= eff(t); });
      if (inv) { var now = accValue(a), cash = accBalance(a); if (now !== null && cash !== null) bal += now - cash; (D().trades || []).forEach(function (t) { if (t.account === a.name && t.date > od && t.date <= date) bal += tradeCash(t); }); }
      sign = convert(bal, accCur(a.name), 'JPY'); if (sign !== null) tot += sign;
    });
    return tot;
  }
  function viewReport() {
    var mode = S.rpMode || 'month', by = S.rpBy || 'cat';
    var h = topbar('<button class="ib" data-act="exportRange" title="匯出這段期間 CSV">' + IC.exp + '</button>', pseg([['month', '月'], ['year', '年'], ['range', '期間']], mode, 'rpMode'), '<button class="ib" data-act="go:budget" title="預算">' + IC.budget + '</button>');
    var r = rpRange(0), pr = rpRange(-1);
    if (mode === 'range') h += '<div class="grid2" style="margin:8px 0"><input type="date" value="' + r.start + '" data-act="rpFrom"><input type="date" value="' + r.end + '" data-act="rpTo"></div>';
    else h += pnav(r.label, mode === 'year' ? 'rpYear' : 'cyc');
    var days = Math.max(1, L.dayDiff(r.end, r.start) + 1);
    if (r.start <= L.today() && r.end >= L.today()) days = L.dayDiff(L.today(), r.start) + 1;
    /* --- 第 1 頁：支出比例 --- */
    var exp = txIn(r.start, r.end, by === 'mem' ? function (t) { var c = catMap()[t.category] || {}; return t.type === '支' && isJpy(t) && String(c.excludeBudget).toUpperCase() !== 'TRUE'; } : isBudgetable);
    var prevExp = txIn(pr.start, pr.end, isBudgetable), prevCat = {};
    prevExp.forEach(function (t) { prevCat[t.category] = (prevCat[t.category] || 0) + Number(t.amount); });
    var tot = sum(exp), key = by === 'acc' ? 'account' : by === 'mem' ? 'member' : 'group', agg = {};
    exp.forEach(function (t) { var k = key === 'group' ? (groupOf(t.category) || '其他') : (t[key] || '自己'); agg[k] = (agg[k] || 0) + Number(t.amount); });
    var keys = Object.keys(agg).sort(function (a, b) { return agg[b] - agg[a]; });
    var p1 = '<div class="subtabs">' + [['cat', '支出類別比'], ['acc', '支出帳戶比'], ['mem', '支出成員比']].map(function (x) { return '<button data-act="rpBy:' + x[0] + '" class="' + (by === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var pieItems = keys.map(function (k) { return { k: k, v: agg[k] }; });
    p1 += '<div class="pie-wrap">' + pieSvg(pieItems) + '<div class="legend grow">' + keys.map(function (k, i) { return '<div><i style="background:' + PIE[i % PIE.length] + '"></i>' + esc(k) + '</div>'; }).join('') + '</div></div>';
    p1 += '<div style="font-size:16px;margin:4px 0 6px">合計: ' + nfmt(tot) + '　平均每天: ' + nfmt(tot / days) + '</div>';
    p1 += '<table class="rtab"><tr><th>#</th><th>' + (by === 'cat' ? '類別' : by === 'acc' ? '帳戶' : '成員') + '</th><th>金額</th><th>比例</th></tr>';
    keys.forEach(function (k, i) {
      p1 += '<tr class="g"><td>' + (i + 1) + '</td><td>' + esc(k) + '</td><td class="num">' + nfmt(agg[k]) + '</td><td>' + (tot ? (agg[k] / tot * 100).toFixed(1) : 0) + '%</td></tr>';
      if (by !== 'cat') return;
      var sub = {}; exp.forEach(function (t) { if ((groupOf(t.category) || '其他') === k) sub[t.category] = (sub[t.category] || 0) + Number(t.amount); });
      Object.keys(sub).sort(function (a, b) { return sub[b] - sub[a]; }).forEach(function (cn, j) {
        var d = sub[cn] - (prevCat[cn] || 0);
        p1 += '<tr class="c"><td>' + (i + 1) + '-' + (j + 1) + '</td><td>' + emoji(cn) + ' ' + esc(cn) + '</td><td>' + nfmt(sub[cn]) + '<span class="d ' + (d > 0 ? 'neg' : 'pos') + '">' + (d > 0 ? '▲' : '▼') + nfmt(Math.abs(d)) + '</span></td><td>' + (tot ? (sub[cn] / tot * 100).toFixed(2) : 0) + '%</td></tr>';
      });
    });
    p1 += '</table>' + (keys.length ? '<div class="sub" style="margin-top:6px">▲▼ 和上一期比。' + (by === 'mem' ? '' : '不含公司代墊、國際匯款等不算預算的項目。') + '</div>' : '<div class="empty">這段期間沒有支出</div>');
    /* --- 第 2 頁：收支趨勢 --- */
    var periods = [];
    if (mode === 'year') { var yy = Number(r.start.slice(0, 4)); for (var m = 0; m < 12; m++) periods.push({ start: L.fmt(new Date(yy, m, 1)), end: L.fmt(new Date(yy, m + 1, 0)), label: yy + '/' + (m + 1) }); }
    else if (mode === 'range') { var d0 = L.parseYmd(r.start); while (L.fmt(d0) <= r.end && periods.length < 36) { var e0 = new Date(d0.getFullYear(), d0.getMonth() + 1, 0), ee = L.fmt(e0) > r.end ? r.end : L.fmt(e0); periods.push({ start: L.fmt(d0), end: ee, label: (d0.getMonth() + 1) + '月' }); d0 = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); } }
    else for (var i = -11; i <= 0; i++) { var cc = cycle((S.cycleOffset || 0) + i); periods.push({ start: cc.start, end: cc.end, label: cc.start.slice(2, 7).replace('-', '/') }); }
    var incF = function (t) { return t.type === '收' && isJpy(t); }, outF = function (t) { return t.type === '支' && isJpy(t); };
    var allTx = D().tx, cumBefore = function (date) { return sum(allTx.filter(function (t) { return t.date < date && incF(t); })) - sum(allTx.filter(function (t) { return t.date < date && outF(t); })); };
    var base = periods.length ? cumBefore(periods[0].start) : 0;
    periods.forEach(function (p) { p.inc = sum(txIn(p.start, p.end, incF)); p.out = sum(txIn(p.start, p.end, outF)); base += p.inc - p.out; p.cum = base; });
    var cI = sum(txIn(r.start, r.end, incF)), cO = sum(txIn(r.start, r.end, outF)), pI = sum(txIn(pr.start, pr.end, incF)), pO = sum(txIn(pr.start, pr.end, outF));
    var cumNow = cumBefore(L.fmt(new Date(L.parseYmd(r.end).getTime() + 86400000))), cumPrev = cumBefore(L.fmt(new Date(L.parseYmd(pr.end).getTime() + 86400000)));
    var p2 = '<div style="text-align:center;font-size:13px;color:var(--sub);margin-top:6px">收支趨勢</div>' + trendSvg(periods, 'flow') +
      '<div class="legend-row"><i style="background:#95c792"></i>收入<i style="background:#e8907c"></i>支出<i style="background:#d8c66c"></i>總收支</div>' +
      '<div class="tiles"><div class="tile g"><span>收入</span><b>' + nfmt(cI) + '</b><small>' + pctChange(cI, pI) + '</small></div><div class="tile r"><span>支出</span><b>' + nfmt(cO) + '</b><small>' + pctChange(cO, pO) + '</small></div>' +
      '<div class="tile b"><span>本期收支</span><b>' + nfmt(cI - cO) + '</b><small>' + pctChange(cI - cO, pI - pO) + '</small></div><div class="tile y"><span>總收支</span><b>' + nfmt(cumNow) + '</b><small>' + pctChange(cumNow, cumPrev) + '</small></div></div>';
    periods.slice().reverse().forEach(function (p) {
      p2 += '<div class="kv-h">' + jdate(p.start) + '～' + jdate(p.end) + '</div><div class="kv"><div><span>收入</span><span>' + nfmt(p.inc) + '</span></div><div><span>支出</span><span>' + nfmt(p.out) + '</span></div><div><span>本期收支</span><span class="' + (p.inc - p.out < 0 ? 'neg' : '') + '">' + nfmt(p.inc - p.out) + '</span></div><div><span>總收支</span><span>' + nfmt(p.cum) + '</span></div></div>';
    });
    p2 += '<div class="sub" style="margin-top:6px">只算日幣的收入和支出（含公司代墊）。</div>';
    /* --- 第 3 頁：淨資產趨勢 --- */
    var p3 = '';
    if (D().accounts.some(function (a) { return accValue(a) !== null; })) {
      var t0 = L.today().split('-').map(Number), months = [];
      for (var k = 11; k >= 0; k--) { var md = new Date(t0[0], t0[1] - 1 - k + 1, 0); if (k === 0) md = L.parseYmd(L.today()); months.push({ end: L.fmt(md), label: md.getFullYear() + '/' + (md.getMonth() + 1) }); }
      months.forEach(function (x) { x.v = netAt(x.end); });
      var nowV = months[months.length - 1].v, prevV = months.length > 1 ? months[months.length - 2].v : 0;
      p3 = '<div style="text-align:center;font-size:13px;color:var(--sub);margin-top:6px">淨資產趨勢</div>' + trendSvg(months, 'net') + '<div class="legend-row"><i style="background:#8e98dc"></i>淨資產</div>' +
        '<div class="tiles"><div class="tile g"><span>淨資產（日圓）</span><b>' + nfmt(nowV) + '</b><small>' + pctChange(nowV, prevV) + '</small></div><div class="tile b"><span>' + (fxRate('TWD') ? '換算台幣' : '上月底') + '</span><b>' + (fxRate('TWD') ? money(nowV / fxRate('TWD'), 'TWD') : nfmt(prevV)) + '</b><small>匯率用目前的</small></div></div>' +
        '<table class="rtab" style="margin-top:8px"><tr><th style="width:auto">年月</th><th></th><th>增減</th><th>期末淨資產</th></tr>';
      months.slice().reverse().forEach(function (x, i, arr) { var pv = arr[i + 1]; p3 += '<tr class="c"><td style="width:auto;color:var(--text)">' + x.label + (i === 0 ? '（到今天）' : '') + '</td><td></td><td style="color:var(--text)">' + (pv ? (x.v - pv.v >= 0 ? '+' : '') + nfmt(x.v - pv.v) : '—') + '</td><td style="color:var(--text)">' + nfmt(x.v) + '</td></tr>'; });
      p3 += '</table><div class="sub" style="margin-top:6px">用各帳戶的起始餘額加減紀錄算出每月底的餘額；外幣和持股用目前匯率、市值估算。</div>';
    } else p3 = '<div class="empty">帳戶還沒設定起始餘額，算不出淨資產。<br><button class="ghost" data-act="go:assets">去設定 ›</button></div>';
    var pages = [p1, p2, p3];
    S.rpPage = Math.min(S.rpPage || 0, pages.length - 1);
    h += '<div class="rp-pages">' + pages.map(function (p) { return '<div class="rp-page">' + p + '</div>'; }).join('') + '</div>';
    h += '<div class="dots" style="position:sticky;bottom:calc(var(--safe-b) + 60px);background:var(--bg)">' + pages.map(function (_, i) { return '<span class="' + (i === S.rpPage ? 'on' : '') + '">●</span>'; }).join('') + '</div>';
    S._rpRange = r;
    return h;
  }
  PAGES.report = function () { S.page = null; S.tab = 'report'; return viewReport(); };

  /* ===================== 設定 ===================== */
  function viewSettings() {
    var inbox = D().tx.filter(function (t) { return t.status === 'inbox'; }).length, adv = companyOpen(), own = isOwnerMain();
    var PERSONAL = ['funds', 'payslip', 'salary', 'jobsim', 'import', 'shortcuts'];
    var groups = [
      ['帳本', [['books', '帳本與共享', bookEntry().name]]],
      ['基本設定', [['recurring', '固定收支', ''], ['budget', '預算', ''], ['budgetEdit', '預算編制', ''], ['categories', '類別（支出／收入項目）', ''], ['accounts', '帳戶與圖示', ''], ['tags', '標籤', ''], ['rules', '自動分類規則', ''], ['inbox', '待分類', inbox ? inbox + ' 筆' : '']]],
      ['資產與帳單', [['assets', '資產與起始餘額', ''], ['invest', '投資', ''], ['loans', '貸款', ''], ['cards', '信用卡帳單', ''], ['funds', '預備金／台灣／NISA', ''], ['company', '公司代墊', adv.length ? yen(sum(adv)) : '']]],
      ['薪資', [['payslip', '薪資明細', D().payslips.length + ' 份'], ['salary', '薪資與扣款分析', ''], ['jobsim', '換工作試算', '']]],
      ['資料', [['import', '匯入（舊資料／PayPay CSV）', ''], ['@exportAll', '匯出 CSV（全部）', ''], ['shortcuts', 'iPhone 捷徑設定', ''], ['@sync', '立即同步', S.queue.length ? '待送出 ' + S.queue.length + ' 筆' : '']]],
      ['一般', [['settings', '偏好設定', '月開始日 ' + startDay() + ' 日']]]
    ];
    var h = topbar('', '設定', '');
    groups.forEach(function (g) {
      var items = g[1].filter(function (i) { return own || PERSONAL.indexOf(i[0]) < 0; });
      if (!items.length) return;
      h += '<div class="grp-h">' + g[0] + '</div><div class="menu2">' + items.map(function (i) {
        var act = i[0].charAt(0) === '@' ? i[0].slice(1) : 'go:' + i[0];
        return '<button data-act="' + act + '"><span>' + i[1] + '</span><span class="v">' + esc(i[2]) + '</span><span class="chev">›</span></button>';
      }).join('') + '</div>';
    });
    h += '<div class="sub" style="text-align:center;margin:18px 0">Wen 記帳</div>';
    return h;
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
    h += '<div class="card"><h3>每月總支給與實領</h3>' + barsChart(series) + '<div class="sub">藍：總支給　綠：實領（不含賞与，依支払月）</div></div>';
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
      var b = accValue(a); if (b === null || netExcluded(a.name)) return;
      any = true; var c = accCur(a.name); by[c] = (by[c] || 0) + b;
    });
    return { any: any, curs: Object.keys(by).sort(function (a, b) { return (CURRENCIES.indexOf(a) + 99) % 99 - (CURRENCIES.indexOf(b) + 99) % 99; }).map(function (c) { return { cur: c, label: CUR_LABEL[c] || c, total: by[c] }; }) };
  }
  /* 不算進淨資產的帳戶（存在設定 netExclude，逗號分隔） */
  function netExList() { return String(setting('netExclude', 'Line Bank,Revolut')).split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function netExcluded(name) { return netExList().indexOf(name) >= 0; }
  /* 一次填全部起始餘額：預設值是 2026/11/24 每日家計簿帳戶頁的餘額（信用卡填未繳金額，正數） */
  var OPENING_PRESET = { 'Pay Pay': 1666, 'ゆうちょデビット': 0, '日圓現金': 880, 'ゆうちょ': 173954, 'SU PAY': 452, 'Epos': 15960, 'Suica': 31, 'スターバックス': 730, 'Wise JPY': 0, 'wise': 0, '中信日幣': 0, '楽天': 0, 'Revolut': 30000, 'Moomoo日股': 0, 'MooMoo美股': 0, 'Nanaco': 208, 'Line Bank': 48314, '中信': 0, 'Wise US Dollor': 0 };
  PAGES.openingBulk = function () {
    var ex = netExList(), h = back('一次填全部起始餘額') + '<div class="sub" style="margin:8px 0">填「這一天結束時」各帳戶的餘額，這天（含）以前的紀錄不會再加減，之後的記帳、轉帳會自動加減。信用卡和貸款填還沒繳的金額（正數）。空白的帳戶不會改。</div>' +
      '<div class="frow" style="margin:0 -14px"><span class="fl">日期</span><input id="obDate" type="date" value="' + esc(S.obDate || '2026-11-24') + '" style="width:auto;margin-left:auto"></div><div class="lst" style="margin-top:12px">';
    D().accounts.forEach(function (a, i) {
      var cur = accCur(a.name), debt = a.type === 'credit' || a.type === 'loan';
      var v = OPENING_PRESET[a.name] !== undefined ? OPENING_PRESET[a.name] : (a.opening === '' || a.opening == null ? '' : (debt ? -Number(a.opening) : Number(a.opening)));
      h += '<div class="li" style="flex-wrap:wrap">' + accIcon(a.name) + '<div class="grow"><div class="t1">' + esc(a.name) + '</div><div class="t2">' + cur + (debt ? '・未繳金額' : '') + (a.type === 'invest' ? '・現金部分' : '') + '</div></div>' +
        '<input type="number" inputmode="decimal" data-ob="' + i + '" value="' + v + '" style="width:120px;text-align:right">' +
        '<label class="row t2" style="width:100%;justify-content:flex-end;gap:6px;margin-top:4px"><input type="checkbox" data-obx="' + i + '" ' + (ex.indexOf(a.name) < 0 ? 'checked' : '') + ' style="width:18px;height:18px"> 算進淨資產</label></div>';
    });
    h += '</div><div class="sub" style="margin:8px 0">預先填的是 11/24 中午每日家計簿帳戶頁的數字；Line Bank 填台幣（NT$48,314）。</div><button class="primary" style="width:100%;margin:6px 0 20px" data-act="obSave">全部儲存</button>';
    return h;
  };
  PAGES.assets = function () {
    var h = back('資產') + '<div class="sub">每個帳戶填一次「起始餘額」（某一天結束時的餘額），之後的記帳、轉帳、匯款會自動加減。信用卡填目前還沒繳的金額。</div>' +
      '<div class="grid2" style="margin:10px 0"><button data-act="go:openingBulk">一次填全部起始餘額</button><button class="primary" data-act="newTransfer">⇄ 轉帳／匯款</button></div>';
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
  var ACCENTS = { green: '#95c792', blue: '#8e98dc', pink: '#e59ac0', orange: '#e8a46c', purple: '#b59be0', teal: '#7cc6c0' };
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
      S.cfg.book = id; saveCfg(); S.data = load(dataKey(id), null); S.tab = 'day'; S.page = null;
      history.replaceState(null, '', location.pathname);
      setTimeout(function () { toast('已加入共享帳本「' + j.n + '」'); }, 400);
    } catch (e) { toast('邀請連結有誤'); }
  }
  function switchBook(id) {
    S.cfg.book = id; saveCfg(); S.data = load(dataKey(id), null);
    S.tab = 'day'; S.page = null; S.cycleOffset = 0; S.filterCat = ''; S.filterAcc = ''; S.search = '';
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
    var h = (hasBackend() ? back('偏好設定') : '<h1>第一次設定</h1><div class="info">貼上 Apps Script 部署後的網址和 API 金鑰（在試算表的 Settings 分頁 apiToken）。</div>');
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
  function openTxForm(t, type, keep) {
    if (t) {
      F = Object.assign({}, t);
      if (t.type === '轉') { var fee = D().tx.filter(function (x) { return x.id === t.id + '-fee'; })[0], it = D().tx.filter(function (x) { return x.id === t.id + '-int'; })[0]; F.fee = fee ? fee.amount : ''; F._interest = it ? it.amount : ''; }
    } else {
      F = { id: null, type: type || '支', amount: '', category: '', account: lastAccount(), date: L.today(), note: '', member: members()[0], tags: '', currency: 'JPY', toAccount: '', toAmount: '', fee: '' };
      if (F.type === '轉') { F.account = 'ゆうちょ'; F.toAccount = 'Pay Pay'; F.currency = accCur(F.account); }
      else F.currency = accCur(F.account);
      if (keep) { F.date = keep.date || F.date; if (keep.account && F.type !== '轉') { F.account = keep.account; F.currency = accCur(F.account); } }
    }
    F._rule = false; F._new = null; F._pick = null; F._pg = '全部'; F._feeOn = !!F.fee;
    F._kp = F.id ? null : { k: 'amount', ex: '' };
    drawForm();
  }
  function lastAccount() { var t = sortTx(D().tx.filter(function (x) { return x.source === 'manual' && x.type !== '轉'; }))[0]; return t ? t.account : 'Pay Pay'; }
  function newBox() {
    var n = F._new; if (!n) return '';
    if (n.kind === 'cat') {
      var groups = []; D().categories.forEach(function (c) { if (c.type === F.type && groups.indexOf(c.group) < 0) groups.push(c.group); });
      var g0 = F._pg && F._pg !== '全部' ? F._pg : (groups[0] || '其他');
      return '<div class="card" style="margin:10px 14px"><b>新增' + (F.type === '支' ? '支出' : '收入') + '類別</b><div class="row" style="margin-top:6px"><input id="nEmoji" value="🏷️" style="width:52px;text-align:center"><input id="nName" class="grow" placeholder="名稱"></div>' +
        '<label class="f">大類別</label><input id="nGroup" list="nGrpList" value="' + esc(g0) + '"><datalist id="nGrpList">' + groups.map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' +
        '<div class="grid2" style="margin-top:8px"><button data-f="newCancel">取消</button><button class="primary" data-f="newCatOk">加入</button></div></div>';
    }
    return '<div class="card" style="margin:10px 14px"><b>新增帳戶（付款方式）</b><input id="nName" placeholder="名稱，例如 楽天ペイ" style="margin-top:6px">' +
      '<div class="grid2" style="margin-top:6px"><select id="nType">' + Object.keys(ACC_TYPES).map(function (k) { return '<option value="' + k + '"' + (k === 'emoney' ? ' selected' : '') + '>' + ACC_TYPES[k] + '</option>'; }).join('') + '</select>' +
      '<select id="nCur">' + ['JPY', 'TWD', 'USD'].map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div class="sub">圖示、信用卡結帳日之後可在「帳戶與圖示」設定。</div>' +
      '<div class="grid2" style="margin-top:8px"><button data-f="newCancel">取消</button><button class="primary" data-f="newAccOk">加入</button></div></div>';
  }
  function frow(icon, label, val, attrs, ph, noChev) {
    return '<button class="frow" ' + attrs + '><span class="fi">' + icon + '</span><span class="fl">' + label + '</span><span class="fv' + (ph ? ' ph' : '') + '">' + val + '</span>' + (noChev ? '' : '<span class="chev">›</span>') + '</button>';
  }
  var KP_LABEL = { amount: '金額', toAmount: '入帳金額', fee: '手續費', _interest: '利息' };
  /* 數字鍵盤算式：支援 + − × ÷ */
  function calc(ex) {
    var s = String(ex || '').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/[+\-*/]+$/, '');
    if (!s) return 0;
    if (!/^[\d.+\-*/]+$/.test(s)) return null;
    var toks = s.match(/\d*\.?\d+|[+\-*/]/g); if (!toks) return null;
    var out = [], ops = [], pr = { '+': 1, '-': 1, '*': 2, '/': 2 };
    var apply = function () { var o = ops.pop(), b = out.pop(), a = out.pop(); if (a === undefined || b === undefined) throw 0; out.push(o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : a / b); };
    try {
      toks.forEach(function (t, i) {
        if (pr[t]) { if (i === 0 && t === '-') { out.push(0); } while (ops.length && pr[ops[ops.length - 1]] >= pr[t]) apply(); ops.push(t); }
        else out.push(parseFloat(t));
      });
      while (ops.length) apply();
    } catch (e) { return null; }
    var v = out[0]; return isFinite(v) ? Math.round(v * 100) / 100 : null;
  }
  function kpKey(k, bg) {
    var ex = F._kp.ex, last = ex.slice(-1), isOp = function (c) { return '+−×÷'.indexOf(c) >= 0 && c !== ''; };
    if (k === 'del') ex = ex.slice(0, -1);
    else if (isOp(k)) { if (!ex) return; ex = isOp(last) ? ex.slice(0, -1) + k : ex + k; }
    else if (k === '.') { var seg = ex.split(/[+−×÷]/).pop(); if (seg.indexOf('.') >= 0) return; ex += seg ? '.' : '0.'; }
    else ex += k;
    F._kp.ex = ex;
    var el = bg.querySelector('#kpEx'); if (el) el.textContent = ex || '0';
  }
  function drawForm() {
    var old = document.querySelector('.fsheet'), sc = old ? old.querySelector('.fs-body').scrollTop : 0;
    if (old) old.remove();
    var bg = document.createElement('div'); bg.className = 'fsheet';
    var merchant = F.note && (F.source === 'wallet' || F.source === 'paypay-csv' || F.source === 'paypay-quick') ? F.note : '';
    var tr = F.type === '轉';
    var h = '<div class="fs-top"><button class="x" data-f="close">✕</button><div class="pseg">' + [['支', '支出'], ['收', '收入'], ['轉', '轉帳']].map(function (x) { return '<button data-f="type:' + x[0] + '" class="' + (F.type === x[0] ? 'on' : '') + '"' + (F.id && (tr || x[0] === '轉') && F.type !== x[0] ? ' disabled' : '') + '>' + x[1] + '</button>'; }).join('') + '</div><button class="sv" data-f="save">儲存</button></div>';
    h += '<div class="fs-body"><div class="fs-date">' + jdate(F.date, true) + '<input id="fDate" type="date" value="' + F.date + '"></div>';
    var noteRow = '<div class="frow"><textarea id="fNote" placeholder="寫點備註吧' + (tr ? '（例：ATM 領錢）' : '') + '…">' + esc(F.note) + '</textarea></div>';
    var accVal = function (n) { return n ? '<span class="row" style="justify-content:flex-end;gap:6px">' + accIcon(n).replace('acc-ic', 'acc-ic" style="width:20px;height:20px;font-size:8px') + esc(n) + '</span>' : ''; };
    if (tr) {
      var cur = accCur(F.account), toCur = accCur(F.toAccount), cross = F.toAccount && cur !== toCur;
      var r = cross && Number(F.amount) && Number(F.toAmount) ? Number(F.amount) / Number(F.toAmount) : 0;
      h += frow(IC.bank, '從帳戶', F.account ? accVal(F.account) : '選擇轉出帳戶', 'data-f="pick:acc"', !F.account) +
        frow(IC.bank, '到帳戶', F.toAccount ? accVal(F.toAccount) : '選擇轉入帳戶', 'data-f="pick:to"', !F.toAccount) +
        frow(IC.coin, '金額' + (cross ? '（' + cur + '）' : ''), F.amount ? nfmt(F.amount, cur) : '金額', 'data-f="kp:amount"', !F.amount, true);
      if (cross) h += frow(IC.coin, '入帳金額（' + toCur + '）', F.toAmount ? money(F.toAmount, toCur) : '實際入帳金額', 'data-f="kp:toAmount"', !F.toAmount, true) +
        '<div class="frow"><span class="fi"></span><span class="sub">' + (r ? '實際匯率 1 ' + toCur + ' ＝ ' + r.toFixed(3) + ' ' + cur : '輸入兩邊金額會自動算匯率') + '</span></div>';
      if ((accMap()[F.toAccount] || {}).type === 'loan') h += frow(IC.coin, '利息', F._interest ? nfmt(F._interest, cur) : '另記「貸款利息」支出', 'data-f="kp:_interest"', !F._interest, true);
      h += '<div class="fgap"></div>' + noteRow + '<div class="fgap"></div>' +
        '<div class="frow"><span class="fi">' + IC.flag + '</span><span class="fl">手續費</span><button class="tog' + (F._feeOn ? ' on' : '') + '" data-f="feeTog" aria-label="手續費"></button></div>';
      if (F._feeOn) h += frow(IC.coin, '金額', F.fee ? nfmt(F.fee, cur) : '手續費金額', 'data-f="kp:fee"', !F.fee, true);
      if (cross && cur === 'JPY' && toCur === 'TWD' && !F.id && FUNDS.indexOf('台灣準備金') >= 0) h += '<label class="frow"><span class="fi">' + IC.piggy + '</span><span class="fl" style="font-size:15px">同時從「台灣準備金」扣除</span><input type="checkbox" id="fFund" ' + (F._fund === false ? '' : 'checked') + ' style="width:22px;height:22px;margin-left:auto"></label>';
    } else {
      var c = catMap()[F.category], acc = accMap()[F.account] || {}, tg = tagsOf(F).filter(function (g) { return g !== '已退回'; });
      h += '<div class="frow big" data-f="kp:amount"><span class="fi">' + IC.coin + '</span><span class="fl">金額</span><select id="fCur" class="mini">' + currencyOptions(F.currency) + '</select><span class="fv' + (F.amount ? '' : ' ph') + '">' + (F.amount ? nfmt(F.amount, F.currency) : '金額輸入') + '</span></div>' +
        frow(IC.cat, '類別', c ? c.emoji + ' ' + esc(F.category) : F.category ? esc(F.category) : '選擇類別', 'data-f="pick:cat"', !F.category) +
        frow(IC.card, '帳戶', F.account ? accVal(F.account) : '選擇帳戶', 'data-f="pick:acc"', !F.account) +
        '<div class="frow"><span class="fi">' + IC.user + '</span><span class="fl">成員</span><span class="fv">' + esc(F.member) + '</span><span class="chev">›</span><select id="fMember" class="ov">' + members().concat(members().indexOf(F.member) < 0 && F.member ? [F.member] : []).map(function (m) { return '<option' + (F.member === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></div>';
      if (F.type === '支' && acc.type === 'credit') { var ni = Number(F.installments) || 1; h += '<div class="frow"><span class="fi">' + IC.split + '</span><span class="fl">分期</span><span class="fv">' + (ni === 1 ? '一次付清' : ni + ' 期') + '</span><span class="chev">›</span><select id="fInst" class="ov">' + [1, 2, 3, 5, 6, 10, 12, 18, 24, 36].map(function (n) { return '<option value="' + n + '"' + (ni === n ? ' selected' : '') + '>' + (n === 1 ? '一次付清' : n + ' 期') + '</option>'; }).join('') + '</select></div>'; }
      h += '<div class="fgap"></div>' + frow(IC.tag, '標籤', tg.length ? '<span class="tagchips">' + tg.map(function (g) { return '<span class="pill">' + esc(g) + '</span>'; }).join('') + '</span>' : '新增標籤', 'data-f="pick:tag"', !tg.length);
      if (F._receiptData) h += '<div class="frow"><span class="fi">' + IC.cam + '</span><span class="fl">收據照片</span><img src="data:image/jpeg;base64,' + F._receiptData + '" style="height:40px;border-radius:6px;margin-left:auto"><button class="ghost" data-f="rcClear">移除</button></div>';
      else if (F.receipt && !F._rcRemove) h += '<div class="frow"><span class="fi">' + IC.cam + '</span><span class="fl">收據照片</span><button class="ghost" style="margin-left:auto" data-f="rcView">📎 查看</button><button class="ghost" data-f="rcDel">移除</button></div>';
      else h += '<label class="frow"><span class="fi">' + IC.cam + '</span><span class="fl">收據照片</span><span class="fv ph">拍照／選照片</span><input id="fReceipt" type="file" accept="image/*" style="display:none"></label>';
      h += noteRow;
      if (merchant) h += '<label class="frow"><input type="checkbox" id="fRule" ' + (F._rule ? 'checked' : '') + ' style="width:22px;height:22px;flex:none"><span style="font-size:14px">以後「' + esc(merchant) + '」都自動歸這個類別</span></label>';
    }
    h += '<div id="fHint" class="sub" style="padding:10px 16px"></div></div>';
    h += '<div class="fs-bot">' + (F.id ? '<button data-f="del" style="color:var(--red);border-color:var(--red)">刪除' + (tr && F.fee ? '（連手續費）' : '') + '</button><button class="alt" data-f="save">儲存</button>' : '<button data-f="save">儲存</button><button class="alt" data-f="again">再記一筆</button>') + '</div>';
    if (F._pick) h += drawPicker();
    if (F._kp) {
      var keys = [['÷', '1', '2', '3'], ['×', '4', '5', '6'], ['−', '7', '8', '9'], ['+', '.', '0', 'del']];
      h += '<div class="kpad"><div class="kp-top"><button data-f="kpCancel">取消</button><span class="lb">' + (KP_LABEL[F._kp.k] || '金額') + '</span><span class="ex" id="kpEx">' + esc(F._kp.ex || '0') + '</span><button data-f="kpOk">確認</button></div><div class="kp-keys">' +
        keys.map(function (row) { return row.map(function (k, i) { return '<button data-k="' + k + '" class="' + (i === 0 ? 'op' : '') + '">' + (k === 'del' ? '⌫' : k) + '</button>'; }).join(''); }).join('') + '</div></div>';
    }
    bg.innerHTML = h;
    document.body.appendChild(bg);
    var body = bg.querySelector('.fs-body'); if (body) body.scrollTop = sc;
    if (!F._pick && !F._kp) hint(bg);
    var rcIn = bg.querySelector('#fReceipt');
    if (rcIn) rcIn.addEventListener('change', function () {
      var file = rcIn.files[0]; if (!file) return;
      readForm(bg); toast('處理照片…');
      compressImage(file, 1600, 0.72).then(function (d) { F._receiptData = d; drawForm(); }).catch(function (e) { toast(e.message); });
    });
    var dIn = bg.querySelector('#fDate');
    if (dIn) dIn.addEventListener('change', function () { readForm(bg); drawForm(); });
    [].forEach.call(bg.querySelectorAll('select.ov'), function (s) { s.addEventListener('change', function () { readForm(bg); drawForm(); }); });
    if (F._new) setTimeout(function () { var n = bg.querySelector('#nName'); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); } }, 60);
    bg.addEventListener('click', function (e) {
      var kb = e.target.closest('[data-k]'); if (kb) { kpKey(kb.dataset.k, bg); return; }
      if (e.target.closest('select')) return;
      var b = e.target.closest('[data-f]'); if (!b || b.disabled) return;
      readForm(bg);
      var a = b.dataset.f.split(':'), k = a[0], v = a.slice(1).join(':');
      if (k === 'close') bg.remove();
      else if (k === 'type') {
        if (v === F.type) return;
        F.type = v; F.category = ''; F._new = null; F._pick = null;
        if (v === '轉') { if (!F.toAccount) F.toAccount = F.account === 'ゆうちょ' ? 'Pay Pay' : 'ゆうちょ'; }
        drawForm();
      }
      else if (k === 'pick') { F._pick = v; F._new = null; F._kp = null; drawForm(); }
      else if (k === 'pkBack') { F._pick = null; F._new = null; drawForm(); }
      else if (k === 'pg') { F._pg = v; F._new = null; drawForm(); }
      else if (k === 'cat') { F.category = v; F._pick = null; if (!F.amount && !F.id) F._kp = { k: 'amount', ex: '' }; drawForm(); }
      else if (k === 'acc' || k === 'to') {
        if (k === 'acc') F.account = v; else F.toAccount = v;
        if (F.type !== '轉') F.currency = accCur(v);
        F._pick = null; drawForm();
      }
      else if (k === 'kp') { F._kp = { k: v, ex: F[v] ? String(F[v]) : '' }; drawForm(); }
      else if (k === 'kpCancel') { F._kp = null; drawForm(); }
      else if (k === 'kpOk') {
        var val = calc(F._kp.ex); if (val === null) { toast('算式有誤'); return; }
        F[F._kp.k] = val ? Math.abs(val) : ''; var wasAmt = F._kp.k === 'amount'; F._kp = null;
        if (wasAmt && F.type !== '轉' && !F.category) F._pick = 'cat';
        drawForm();
      }
      else if (k === 'feeTog') { F._feeOn = !F._feeOn; if (!F._feeOn) F.fee = ''; else if (!F.fee) F._kp = { k: 'fee', ex: '' }; drawForm(); }
      else if (k === 'tag') { var tg = tagsOf(F), ix = tg.indexOf(v); if (ix >= 0) tg.splice(ix, 1); else tg.push(v); F.tags = tg.join(','); drawForm(); }
      else if (k === 'tagAdd') { var nt = bg.querySelector('#fTagNew').value.trim().replace(/^#/, '').replace(/[,，\s]/g, ''); if (!nt) return; var tl = tagsOf(F); if (tl.indexOf(nt) < 0) tl.push(nt); F.tags = tl.join(','); drawForm(); }
      else if (k === 'rcClear') { F._receiptData = null; drawForm(); }
      else if (k === 'rcDel') { if (confirm('移除這張收據？')) { F._rcRemove = true; drawForm(); } }
      else if (k === 'rcView') { if (F.receipt === 'pending') { toast('收據還在上傳'); return; } toast('讀取收據…'); api('getReceipt', { fileId: F.receipt }).then(function (r) { showImage('data:' + r.mimeType + ';base64,' + r.base64); }).catch(function (e) { toast(e.message); }); }
      else if (k === 'newCat') { F._new = { kind: 'cat' }; drawForm(); }
      else if (k === 'newAcc') { F._new = { kind: 'acc', key: v }; drawForm(); }
      else if (k === 'newCancel') { F._new = null; drawForm(); }
      else if (k === 'newCatOk') {
        var nm = bg.querySelector('#nName').value.trim(); if (!nm) { toast('請輸入名稱'); return; }
        if (catMap()[nm]) { var ex = catMap()[nm]; ex.hidden = ''; F.category = nm; F._new = null; F._pick = null; drawForm(); return; }
        ensureCategory(nm, bg.querySelector('#nGroup').value.trim() || '其他', F.type, bg.querySelector('#nEmoji').value.trim() || '🏷️');
        persist(); F.category = nm; F._new = null; F._pick = null; drawForm(); toast('已新增類別「' + nm + '」');
      }
      else if (k === 'newAccOk') {
        var an = bg.querySelector('#nName').value.trim(); if (!an) { toast('請輸入名稱'); return; }
        if (accMap()[an]) { toast('已經有「' + an + '」'); return; }
        var colors = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b', '#6d4c41'];
        D().accounts.push({ name: an, type: bg.querySelector('#nType').value, currency: bg.querySelector('#nCur').value, icon: '', color: colors[D().accounts.length % colors.length], closeDay: '', payDay: '', payAccount: '', order: D().accounts.length + 1, active: 'TRUE', opening: '', openingDate: '' });
        enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist();
        if (F._new.key === 'to') F.toAccount = an; else { F.account = an; if (F.type !== '轉') F.currency = accCur(an); }
        F._new = null; F._pick = null; drawForm(); toast('已新增帳戶「' + an + '」');
      }
      else if (k === 'save') saveForm(bg);
      else if (k === 'again') saveForm(bg, true);
      else if (k === 'del') { if (confirm('確定刪除這筆？')) { removeTx(F.id); bg.remove(); } }
    });
  }
  function drawPicker() {
    var p = F._pick, h = '<div class="picker">';
    if (p === 'cat') {
      var cats = D().categories.filter(function (c) { return c.type === F.type && c.name !== '待分類' && c.name !== '水電瓦斯' && (catVisible(c) || c.name === F.category); })
        .sort(function (a, b) { return Number(a.order) - Number(b.order); });
      var groups = ['全部']; cats.forEach(function (c) { var g = c.group || '其他'; if (groups.indexOf(g) < 0) groups.push(g); });
      var pg = groups.indexOf(F._pg) >= 0 ? F._pg : '全部';
      var show = pg === '全部' ? cats : cats.filter(function (c) { return (c.group || '其他') === pg; });
      h += '<div class="pk-top"><button data-f="pkBack">‹ 返回</button><b>類別</b><span></span></div>' +
        '<div class="pk-tabs">' + groups.map(function (g) { return '<button data-f="pg:' + esc(g) + '" class="' + (g === pg ? 'on' : '') + '">' + esc(g) + '</button>'; }).join('') + '</div>' +
        '<div class="pk-body"><div class="cgrid">' + show.map(function (c) { return '<button data-f="cat:' + esc(c.name) + '" class="' + (F.category === c.name ? 'on' : '') + '"><b>' + c.emoji + '</b>' + esc(c.name) + '</button>'; }).join('') +
        '<button class="add" data-f="newCat"><b>⊕</b>新增類別</button></div>' + (F._new ? newBox() : '') + '</div>';
    } else if (p === 'acc' || p === 'to') {
      var sel = p === 'to' ? F.toAccount : F.account;
      var accs = D().accounts.filter(function (a) { return a.active || a.name === sel; });
      h += '<div class="pk-top"><button data-f="pkBack">‹ 返回</button><b>' + (p === 'to' ? '到帳戶' : F.type === '轉' ? '從帳戶' : '帳戶') + '</b><span></span></div><div class="pk-body"><div class="lst" style="margin:0">' +
        accs.map(function (a) { return '<button class="li" data-f="' + p + ':' + esc(a.name) + '">' + accIcon(a.name) + '<div class="grow"><div class="t1">' + esc(a.name) + '</div><div class="t2">' + accCur(a.name) + '</div></div>' + (sel === a.name ? '<span class="chk">✓</span>' : '') + '</button>'; }).join('') +
        '<button class="li" data-f="newAcc:' + p + '"><span class="acc-ic" style="background:#3a3a3c">＋</span><div class="t1">新增帳戶</div></button></div>' + (F._new ? newBox() : '') + '</div>';
    } else if (p === 'tag') {
      var tg = tagsOf(F), all = allTags(); tg.forEach(function (g) { if (all.indexOf(g) < 0) all.push(g); });
      h += '<div class="pk-top"><button data-f="pkBack">‹ 返回</button><b>標籤</b><button class="r" data-f="pkBack">完成</button></div><div class="pk-body" style="padding:12px 14px">' +
        '<div class="chips">' + all.filter(function (g) { return g !== '已退回'; }).map(function (g) { return '<button data-f="tag:' + esc(g) + '" class="' + (tg.indexOf(g) >= 0 ? 'on' : '') + '">' + esc(g) + '</button>'; }).join('') + '</div>' +
        '<div class="row" style="margin-top:12px"><input id="fTagNew" placeholder="新標籤，例如 旅行、報稅"><button data-f="tagAdd">加入</button></div></div>';
    }
    return h + '</div>';
  }
  function readForm(bg) {
    var q = function (s) { return bg.querySelector(s); };
    if (q('#fCur')) F.currency = q('#fCur').value;
    if (q('#fInst')) F.installments = Number(q('#fInst').value) || '';
    if (q('#fFund')) F._fund = q('#fFund').checked;
    if (q('#fDate')) F.date = q('#fDate').value || L.today();
    if (q('#fMember')) F.member = q('#fMember').value;
    if (q('#fNote')) F.note = q('#fNote').value.trim();
    var r = q('#fRule'); if (r) F._rule = r.checked;
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
  function saveTransfer(bg, again) {
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
    if (again) openTxForm(null, '轉', { date: t.date });
    toast((isNew ? '已記' : '已更新') + (cross ? '匯款 ' : '轉帳 ') + money(amount, cur) + (cross ? ' → ' + money(t.toAmount, toCur) : '') + '\n' + F.account + ' → ' + F.toAccount + (fee ? '（手續費 ' + money(fee, cur) + '）' : ''), 3200);
  }
  function saveForm(bg, again) {
    if (F.type === '轉') return saveTransfer(bg, again);
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
    if (again) openTxForm(null, t.type, { date: t.date, account: t.account });
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
    tagShow: function (g) { S.search = g; S.filterCat = ''; S.filterAcc = ''; S.tab = 'day'; S.page = null; S.listMode = 'list'; render(); },
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
    calDay: function (d) { S.calDay = d; render(); },
    daySearch: function () { S.listMode = 'list'; render(); var n = $app.querySelector('#search'); if (n) n.focus(); },
    clearFilter: function () { S.search = ''; S.filterCat = ''; S.filterAcc = ''; render(); },
    accOpen: function (name) { S.tab = 'day'; S.page = null; S.listMode = 'list'; S.search = ''; S.filterCat = ''; S.filterAcc = name; render(); window.scrollTo(0, 0); },
    budMode: function (m) { S.budMode = m; render(); },
    yearMove: function (d) { S.yearOffset = (S.yearOffset || 0) + Number(d); render(); },
    rpMode: function (m) { S.rpMode = m; render(); },
    rpBy: function (m) { S.rpBy = m; render(); },
    rpYear: function (d) { S.rpYear = (S.rpYear || 0) + Number(d); render(); },
    rpFrom: function (_, el) { S.rpFrom = el.value; render(); },
    rpTo: function (_, el) { S.rpTo = el.value; render(); },
    exportRange: function () { var r = S._rpRange || rpRange(0); download('記帳-' + r.start + '_' + r.end + '.csv', toCSV(sortTx(txIn(r.start, r.end)))); },

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
    go: function (p) { S._fromBudget = S.page === 'budget'; go(p); },
    back: function () { var p = S.page; S.page = null; S.cycleOffset = 0; S.yearOffset = 0; if (p === 'budgetEdit' && S._fromBudget) S.page = 'budget'; render(); },
    sync: function () { toast('同步中…'); refresh(); },
    cyc: function (d) { S.cycleOffset += Number(d); render(); },
    filterCat: function (_, el) { S.filterCat = el.value; render(); },
    filterAcc: function (_, el) { S.filterAcc = el.value; render(); },
    openInbox: function () { go('inbox'); },
    editTx: function (id) { var t = D().tx.filter(function (x) { return x.id === id; })[0]; if (t) openTxForm(t); },
    exportList: function () { download('記帳明細-' + L.today() + '.csv', toCSV(S._lastList || [])); },
    exportAll: function () { download('記帳全部-' + L.today() + '.csv', toCSV(sortTx(D().tx))); },
    copy: function (k) { var v = k === 'url' ? S.cfg.url : S.cfg.token; navigator.clipboard.writeText(v).then(function () { toast('已複製'); }); },

    saveCfg: function () {
      S.cfg.url = document.getElementById('cfgUrl').value.trim(); S.cfg.token = document.getElementById('cfgToken').value.trim();
      saveCfg(); toast('同步中…');
      refresh().then(function () { if (S.data) { S.tab = 'day'; S.page = null; render(); } });
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
      S.data.budgets = rows; enqueue('saveTable', { table: 'budgets', rows: rows }); persist(); toast('預算已儲存'); S.page = 'budget'; render();
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
    obSave: function () {
      var d = document.getElementById('obDate').value || L.today(), ex = [], n = 0;
      [].forEach.call($app.querySelectorAll('[data-ob]'), function (el) {
        var a = D().accounts[Number(el.dataset.ob)]; if (!a || el.value === '') return;
        var v = Number(el.value); a.opening = a.type === 'credit' || a.type === 'loan' ? -Math.abs(v) : v; a.openingDate = d; n++;
      });
      [].forEach.call($app.querySelectorAll('[data-obx]'), function (el) { var a = D().accounts[Number(el.dataset.obx)]; if (a && !el.checked) ex.push(a.name); });
      D().settings.netExclude = ex.join(',');
      enqueue('saveTable', { table: 'accounts', rows: D().accounts }); enqueue('saveSettings', { settings: { netExclude: ex.join(',') } });
      persist(); S.page = null; S.tab = 'acc'; render(); window.scrollTo(0, 0);
      toast('已設定 ' + n + ' 個帳戶的起始餘額（' + d.slice(5).replace('-', '/') + '）' + (ex.length ? '\n不算進淨資產：' + ex.join('、') : ''), 3600);
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
