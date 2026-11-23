/* Wen 記帳 — 前端 */
(function () {
  'use strict';
  var L = window.Lib;
  var $app = document.getElementById('app');
  var FUNDS = ['緊急預備金', '台灣準備金', 'NISA'];
  var SOCIAL_RE = /保険|年金|支援金/;

  /* ===================== 狀態與儲存 ===================== */
  var S = {
    cfg: load('kk_cfg', { url: '', token: '' }),
    data: load('kk_data', null),
    queue: load('kk_queue', []),
    tab: 'home', page: null, cycleOffset: 0, search: '', filterCat: '', filterAcc: '', syncing: false
  };
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('手機儲存空間不足：' + e.message); } }
  function persist() { save('kk_data', S.data); save('kk_queue', S.queue); }

  function D() { return S.data || { tx: [], categories: [], budgets: [], accounts: [], recurring: [], rules: [], cards: [], funds: [], payslips: [], settings: {} }; }
  function setting(k, d) { var v = D().settings[k]; if (k === 'budgetStart' && v) v = String(v).slice(0, 10); return v === undefined || v === '' ? d : v; }
  function startDay() { return Number(setting('cycleStartDay', 10)) || 10; }

  /* ===================== 後端 ===================== */
  function api(action, payload) {
    if (!S.cfg.url || !S.cfg.token) return Promise.reject(new Error('還沒設定伺服器網址和 API 金鑰'));
    var body = Object.assign({}, payload || {}, { action: action, token: S.cfg.token });
    return fetch(S.cfg.url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw new Error('伺服器回應不是 JSON：' + t.slice(0, 80)); }
        if (!j.ok) throw new Error(j.error || '伺服器錯誤');
        return j;
      });
  }

  /* 寫入動作先改本機，再排進佇列送出（離線也能記） */
  function enqueue(action, payload) {
    S.queue.push({ action: action, payload: payload, at: Date.now() });
    persist();
    flush();
  }

  function flush() {
    if (S.syncing || !S.queue.length || !navigator.onLine) return Promise.resolve();
    S.syncing = true;
    var op = S.queue[0];
    return api(op.action, op.payload).then(function () {
      S.queue.shift(); persist(); S.syncing = false;
      return flush();
    }).catch(function (e) {
      S.syncing = false;
      if (/API 金鑰|未知的動作|不能覆蓋/.test(e.message)) { S.queue.shift(); persist(); toast('同步失敗並略過：' + e.message); }
    });
  }

  function refresh(quiet) {
    return flush().then(function () { return api('bootstrap'); }).then(function (j) {
      delete j.ok;
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
    if (!S.cfg.url || !S.cfg.token) { S.tab = 'more'; S.page = 'settings'; }
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
    var h = '<div class="row between"><h1>Wen 記帳</h1><button class="ghost" data-act="sync">↻ 同步' + (S.queue.length ? '（' + S.queue.length + '）' : '') + '</button></div>';
    if (!S.data) h += '<div class="info">第一次使用：按「同步」從 Google 試算表讀取資料。</div>';
    h += '<div class="card"><div class="sub">本期 ' + c.label + '（剩 ' + daysLeft + ' 天）</div><div class="ring">' + donut(pct, st.spent > st.total ? 'var(--red)' : pct > 80 ? 'var(--amber)' : 'var(--green)') +
      '<div class="grow"><div class="sub">剩餘預算</div><div class="big num ' + (remain < 0 ? 'neg' : 'pos') + '">' + yen(remain) + '</div>' +
      '<div class="sub num">已花 ' + yen(st.spent) + ' ／ 預算 ' + yen(st.total) + '</div></div></div>' +
      '<div class="grid2" style="margin-top:12px"><div><div class="sub">每天可用</div><div class="num" style="font-size:20px;font-weight:700">' + yen(perDay) + '</div></div>' +
      '<div><div class="sub">今天已花</div><div class="num" style="font-size:20px;font-weight:700;' + (spentToday > perDay ? 'color:var(--red)' : '') + '">' + yen(spentToday) + '</div></div></div>' +
      '<div class="sub" style="margin-top:8px">本期收入 ' + yen(income) + '</div></div>';
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
    var sign = t.type === '收' ? '+' : t.type === '轉' ? '' : '-';
    var cur = (t.currency || 'JPY') === 'JPY' ? yen(t.amount) : t.currency + ' ' + Number(t.amount).toLocaleString();
    var tags = [];
    if (t.status === 'inbox') tags.push('<span class="pill amber">待分類</span>');
    if (t.member === '公司') tags.push('<span class="pill">' + (String(t.tags).indexOf('已退回') >= 0 ? '公司・已退回' : '公司代墊') + '</span>');
    if (t.source === 'wallet') tags.push('<span class="pill">錢包</span>');
    if (t.source === 'recurring') tags.push('<span class="pill">固定</span>');
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
        if (S.filterAcc && t.account !== S.filterAcc) return false;
        if (!q) return true;
        return [t.category, t.account, t.note, t.tags, String(t.amount)].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    } else list = txIn(c.start, c.end);
    list = sortTx(list);
    var searching = q || S.filterCat || S.filterAcc;
    var cats = Object.keys(catMap()), accs = D().accounts.map(function (a) { return a.name; });
    var h = '<h1>明細</h1><input id="search" placeholder="搜尋：店名、備註、類別、金額…" value="' + esc(S.search) + '">' +
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
    var items = [
      ['report', '📊', '報表', ''], ['inbox', '❓', '待分類', inbox ? inbox + ' 筆' : ''],
      ['funds', '🐷', '預備金／台灣／NISA', ''], ['cards', '💳', '信用卡帳單', ''],
      ['company', '💼', '公司代墊', adv.length ? yen(sum(adv)) : ''], ['payslip', '🧾', '薪資明細', D().payslips.length + ' 份'],
      ['salary', '📈', '薪資與扣款分析', ''], ['jobsim', '🔁', '換工作試算', ''],
      ['recurring', '🔂', '固定支出', ''], ['accounts', '🏦', '帳戶與圖示', ''], ['rules', '🏷️', '自動分類規則', ''],
      ['import', '📥', '匯入（舊資料／PayPay CSV）', ''], ['shortcuts', '📲', 'iPhone 捷徑設定', ''], ['settings', '⚙️', '設定', '']
    ];
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
      var closed = all.filter(function (t) { return t.date > pc && t.date <= lc; });
      var open = all.filter(function (t) { return t.date > lc; });
      var paid = setting('billPaid_' + a.name + '_' + L.fmt(due)) === '1';
      var actual = setting('billAmt_' + a.name + '_' + L.fmt(due), '');
      var billAmount = actual !== '' ? Number(actual) : sum(closed);
      var ps = new Date(prevClose.getFullYear(), prevClose.getMonth(), prevClose.getDate() + 1);
      return { account: a.name, period: L.fmt(ps) + '～' + lc, due: L.fmt(due), nextDue: L.fmt(nextDue), dueAmount: paid ? 0 : billAmount, billAmount: billAmount, calcAmount: sum(closed), actual: actual !== '', paid: paid, openAmount: sum(open), closed: closed, open: open };
    });
  }
  PAGES.cards = function () {
    var bills = cardBills();
    var h = back('信用卡帳單') + '<div class="sub">刷卡當下已經記成支出，繳卡費時不用再記一次。這裡只是幫你看每期要繳多少。</div>';
    if (!bills.length) h += '<div class="empty">在「帳戶與圖示」把卡片種類設成信用卡，並填結帳日、繳款日。</div>';
    bills.forEach(function (b) {
      h += '<div class="card"><div class="row">' + accIcon(b.account, true) + '<div class="grow"><h3>' + esc(b.account) + '</h3><div class="sub">結帳期間 ' + b.period.replace(/\d{4}-/g, '').replace(/-/g, '/') + '</div></div></div>' +
        '<div class="grid2" style="margin-top:10px"><div><div class="sub">' + b.due.slice(5).replace('-', '/') + ' 要繳</div><div class="big num">' + yen(b.billAmount) + '</div>' + (b.paid ? '<span class="pill">已繳</span>' : '') + '</div>' +
        '<div><div class="sub">下一期累積（' + b.nextDue.slice(5).replace('-', '/') + ' 繳）</div><div class="big num">' + yen(b.openAmount) + '</div></div></div>' +
        (b.actual ? '<div class="sub">已改成帳單實際金額（照刷卡紀錄算是 ' + yen(b.calcAmount) + '）</div>' : '') +
        '<div class="grid2" style="margin-top:10px"><button data-act="billAmt:' + esc(b.account) + ':' + b.due + '">輸入帳單實際金額</button><button data-act="billPaid:' + esc(b.account) + ':' + b.due + '">' + (b.paid ? '改成未繳' : '標記這期已繳') + '</button></div>' +
        '<h2>這期明細（' + b.closed.length + ' 筆）</h2><div class="list">' + sortTx(b.closed).map(txRow).join('') + '</div></div>';
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
    var list = D().payslips.slice().sort(function (a, b) { return a.month < b.month ? 1 : -1; });
    var h = back('薪資明細') + '<div class="card"><h3>上傳薪資單 PDF</h3><div class="sub">會自動讀出各項支給、社保、稅金和實領金額，確認後存檔。</div>' +
      '<input type="file" accept="application/pdf,image/*" data-act="payslipFile" style="margin-top:10px"></div><div id="psPreview"></div>';
    h += '<h2>已存的明細</h2><div class="card list">' + (list.length ? list.map(function (p) {
      return '<div class="row between" data-act="psView:' + p.id + '"><span>' + p.month + ' 支払分</span><span class="num">實領 ' + yen(p.net) + ' ›</span></div>';
    }).join('') : '<div class="empty">還沒有</div>') + '</div>';
    return h;
  };
  function psItems(p) { try { return typeof p.items === 'string' ? JSON.parse(p.items || '{}') : (p.items || {}); } catch (e) { return {}; } }

  PAGES.salary = function () {
    var list = D().payslips.slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    var h = back('薪資與扣款分析');
    if (!list.length) return h + '<div class="empty">先到「薪資明細」上傳薪資單</div>';
    var series = list.slice(-12).map(function (p) { return { label: p.month.slice(2).replace('-', '/'), inc: Number(p.gross), out: Number(p.net) }; });
    h += '<div class="card"><h3>每月總支給與實領</h3>' + barsChart(series) + '<div class="sub">灰：總支給　綠：實領</div></div>';
    var years = {};
    list.forEach(function (p) {
      var y = p.month.slice(0, 4), it = psItems(p), d = it.deduct || {};
      var o = years[y] = years[y] || { gross: 0, social: 0, itax: 0, rtax: 0, net: 0, n: 0 };
      o.gross += Number(p.gross); o.net += Number(p.net); o.n++;
      Object.keys(d).forEach(function (k) { if (SOCIAL_RE.test(k)) o.social += d[k]; else if (/所得税/.test(k)) o.itax += d[k]; else if (/住民税/.test(k)) o.rtax += d[k]; });
    });
    h += '<div class="card scroll-x"><h3>年度統計（依支払月）</h3><table class="t"><tr><th>年</th><th>月數</th><th>總支給</th><th>社保</th><th>所得税</th><th>住民税</th><th>實領</th></tr>' +
      Object.keys(years).sort().reverse().map(function (y) { var o = years[y]; return '<tr><td>' + y + '</td><td>' + o.n + '</td><td>' + yen(o.gross) + '</td><td>' + yen(o.social) + '</td><td>' + yen(o.itax) + '</td><td>' + yen(o.rtax) + '</td><td>' + yen(o.net) + '</td></tr>'; }).join('') + '</table></div>';
    var last = list.slice(-6), keys = {};
    last.forEach(function (p) { Object.keys(psItems(p).deduct || {}).forEach(function (k) { keys[k] = 1; }); });
    h += '<div class="card scroll-x"><h3>社保與稅金繳納紀錄</h3><div class="sub">和前一個月差超過 10% 會標黃色</div><table class="t"><tr><th>項目</th>' + last.map(function (p) { return '<th>' + p.month.slice(2).replace('-', '/') + '</th>'; }).join('') + '</tr>' +
      Object.keys(keys).map(function (k) {
        return '<tr><td>' + esc(k) + '</td>' + last.map(function (p, i) {
          var v = (psItems(p).deduct || {})[k] || 0, pv = i ? ((psItems(last[i - 1]).deduct || {})[k] || 0) : v;
          var changed = i && Math.abs(v - pv) > Math.max(1, pv) * 0.1;
          return '<td class="num' + (changed ? ' warn' : '') + '">' + v.toLocaleString() + '</td>';
        }).join('') + '</tr>';
      }).join('') + '<tr><td><b>控除合計</b></td>' + last.map(function (p) { return '<td class="num"><b>' + Number(p.deduction).toLocaleString() + '</b></td>'; }).join('') + '</tr></table></div>';
    var lp = list[list.length - 1], li = psItems(lp), ld = li.deduct || {}, lpay = li.pay || {};
    var social = Object.keys(ld).filter(function (k) { return SOCIAL_RE.test(k); }).reduce(function (s, k) { return s + ld[k]; }, 0);
    var nontax = Object.keys(lpay).filter(function (k) { return /非課税/.test(k); }).reduce(function (s, k) { return s + lpay[k]; }, 0);
    h += '<div class="card"><h3>最新一期（' + lp.month + '）重點</h3><div class="sub">社保占課稅薪資 ' + (social / Math.max(1, lp.gross - nontax) * 100).toFixed(1) + '%，控除占總支給 ' + (lp.deduction / lp.gross * 100).toFixed(1) + '%。住民税 ' + yen(ld['住民税'] || 0) + ' 是從薪水扣（特別徴収），不用自己另外繳。</div></div>';
    return h;
  };

  /* ---------- 換工作試算 ---------- */
  PAGES.jobsim = function () {
    var list = D().payslips.slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; });
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
    var h = back('固定支出') + '<div class="sub">每天早上 6 點自動檢查，到了扣款日就記一筆（同月已有同類別同金額的不會重複記）。電費、瓦斯費金額每月不同，請手動記。</div><div class="card">';
    rows.forEach(function (r, i) {
      h += '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="grid2"><input value="' + esc(r.name) + '" data-act="recSet:' + i + ':name" placeholder="名稱"><input type="number" value="' + r.amount + '" data-act="recSet:' + i + ':amount" placeholder="金額"></div>' +
        '<div class="grid3" style="margin-top:6px">' + catSelect(r.category, 'recSet:' + i + ':category') + accSelect(r.account, 'recSet:' + i + ':account') + '<input type="number" min="1" max="31" value="' + r.day + '" data-act="recSet:' + i + ':day" placeholder="每月幾號"></div>' +
        '<div class="row between" style="margin-top:4px"><label class="row sub"><input type="checkbox" ' + (r.active ? 'checked' : '') + ' data-act="recSet:' + i + ':active" style="width:18px;height:18px"> 啟用</label><button class="ghost" data-act="recDel:' + i + '">刪除</button></div></div>';
    });
    h += '</div><div class="grid2"><button data-act="recAdd">＋ 新增</button><button class="primary" data-act="recSave">儲存</button></div>';
    return h;
  };
  function catSelect(v, act) { return '<select data-act="' + act + '">' + D().categories.map(function (c) { return '<option' + (c.name === v ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>'; }
  function accSelect(v, act) { return '<select data-act="' + act + '">' + D().accounts.map(function (a) { return '<option' + (a.name === v ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') + '</select>'; }

  /* ---------- 帳戶 ---------- */
  var ACC_TYPES = { bank: '銀行', debit: '簽帳卡', credit: '信用卡', emoney: '電子錢包', cash: '現金', foreign: '台灣／外幣' };
  PAGES.accounts = function () {
    var h = back('帳戶與圖示') + '<div class="sub">點圖示可以從相簿選一張圖當帳戶圖示。</div>';
    D().accounts.forEach(function (a, i) {
      h += '<div class="card"><div class="row"><label style="cursor:pointer">' + accIcon(a.name, true) + '<input type="file" accept="image/*" hidden data-act="accIcon:' + i + '"></label>' +
        '<input class="grow" value="' + esc(a.name) + '" data-act="accSet:' + i + ':name"><input type="color" value="' + esc(a.color || '#555555') + '" data-act="accSet:' + i + ':color" style="width:46px;padding:2px;height:40px"></div>' +
        '<div class="grid2" style="margin-top:8px"><select data-act="accSet:' + i + ':type">' + Object.keys(ACC_TYPES).map(function (k) { return '<option value="' + k + '"' + (a.type === k ? ' selected' : '') + '>' + ACC_TYPES[k] + '</option>'; }).join('') + '</select>' +
        '<label class="row sub"><input type="checkbox" ' + (a.active ? 'checked' : '') + ' data-act="accSet:' + i + ':active" style="width:18px;height:18px"> 記帳時顯示</label></div>' +
        (a.type === 'credit' ? '<div class="grid3" style="margin-top:8px"><input type="number" value="' + (a.closeDay || '') + '" placeholder="結帳日" data-act="accSet:' + i + ':closeDay"><input type="number" value="' + (a.payDay || '') + '" placeholder="繳款日" data-act="accSet:' + i + ':payDay">' + accSelect(a.payAccount, 'accSet:' + i + ':payAccount') + '</div><div class="sub">結帳日／繳款日（隔月）／扣款帳戶</div>' : '') +
        (a.icon ? '<button class="ghost" data-act="accIconDel:' + i + '">移除圖示</button>' : '') + '</div>';
    });
    h += '<div class="grid2"><button data-act="accAdd">＋ 新增帳戶</button><button class="primary" data-act="accSave">儲存</button></div>';
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
    var h = (S.cfg.url ? back('設定') : '<h1>第一次設定</h1><div class="info">貼上 Apps Script 部署後的網址和 API 金鑰（在試算表的 Settings 分頁 apiToken）。</div>');
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
  function openTxForm(t) {
    var accs = D().accounts.filter(function (a) { return a.active; });
    F = t ? Object.assign({}, t) : { id: null, type: '支', amount: '', category: '', account: lastAccount(), date: L.today(), note: '', member: '自己', tags: '', currency: 'JPY' };
    F._rule = false;
    drawForm(accs);
  }
  function lastAccount() { var t = sortTx(D().tx.filter(function (x) { return x.source === 'manual'; }))[0]; return t ? t.account : 'Pay Pay'; }
  function drawForm() {
    var old = document.querySelector('.sheet-bg'); if (old) old.remove();
    var accs = D().accounts.filter(function (a) { return a.active || a.name === F.account; });
    var since = L.fmt(new Date(Date.now() - 120 * 86400000)), freq = {};
    D().tx.forEach(function (t) { if (t.date >= since) freq[t.category] = (freq[t.category] || 0) + 1; });
    var cats = D().categories.filter(function (c) { return c.type === F.type && c.name !== '待分類' && c.name !== '水電瓦斯'; })
      .sort(function (a, b) { return (freq[b.name] || 0) - (freq[a.name] || 0) || Number(a.order) - Number(b.order); });
    var bg = document.createElement('div'); bg.className = 'sheet-bg';
    var merchant = F.note && (F.source === 'wallet' || F.source === 'paypay-csv' || F.source === 'paypay-quick') ? F.note : '';
    bg.innerHTML = '<div class="sheet"><div class="wrap"><div class="row between"><button class="ghost" data-f="close">取消</button><b>' + (F.id ? '編輯' : '記一筆') + '</b><button class="ghost" data-f="save" style="font-weight:700">儲存</button></div>' +
      '<div class="seg" style="margin:8px 0">' + ['支', '收'].map(function (x) { return '<button data-f="type:' + x + '" class="' + (F.type === x ? 'on' : '') + '">' + (x === '支' ? '支出' : '收入') + '</button>'; }).join('') + '</div>' +
      '<div class="row"><select id="fCur" style="width:90px">' + ['JPY', 'TWD', 'USD'].map(function (c) { return '<option' + (F.currency === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      '<input id="fAmt" class="amount-in grow" type="text" inputmode="decimal" placeholder="0" value="' + (F.amount || '') + '"></div>' +
      '<div class="cats">' + cats.map(function (c) { return '<button data-f="cat:' + esc(c.name) + '" class="' + (F.category === c.name ? 'on' : '') + '"><b>' + c.emoji + '</b>' + esc(c.name) + '</button>'; }).join('') + '</div>' +
      '<label class="f">帳戶</label><div class="chips">' + accs.map(function (a) { return '<button data-f="acc:' + esc(a.name) + '" class="' + (F.account === a.name ? 'on' : '') + '">' + accIcon(a.name) + esc(a.name) + '</button>'; }).join('') + '</div>' +
      '<div class="grid2"><div><label class="f">日期</label><input id="fDate" type="date" value="' + F.date + '"></div><div><label class="f">成員</label><select id="fMember">' + ['自己', '公司', '其他'].map(function (m) { return '<option' + (F.member === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div></div>' +
      '<label class="f">備註</label><input id="fNote" value="' + esc(F.note) + '">' +
      (merchant ? '<label class="row" style="margin-top:10px"><input type="checkbox" id="fRule" style="width:20px;height:20px"> 以後「' + esc(merchant) + '」都自動歸這個類別</label>' : '') +
      (F.id ? '<button class="danger" style="width:100%;margin-top:16px" data-f="del">刪除這筆</button>' : '') +
      '<div id="fHint" class="sub" style="margin-top:8px"></div></div></div>';
    document.body.appendChild(bg);
    var amt = bg.querySelector('#fAmt');
    if (!F.id) setTimeout(function () { amt.focus(); }, 60);
    bg.addEventListener('click', function (e) {
      if (e.target === bg) { bg.remove(); return; }
      var b = e.target.closest('[data-f]'); if (!b) return;
      readForm(bg);
      var a = b.dataset.f.split(':'), k = a[0], v = a.slice(1).join(':');
      if (k === 'close') bg.remove();
      else if (k === 'type') { F.type = v; F.category = ''; drawForm(); }
      else if (k === 'cat') { F.category = v; [].forEach.call(bg.querySelectorAll('.cats button'), function (x) { x.classList.toggle('on', x === b); }); hint(bg); }
      else if (k === 'acc') { F.account = v; [].forEach.call(bg.querySelectorAll('.chips button'), function (x) { x.classList.toggle('on', x === b); }); }
      else if (k === 'save') saveForm(bg);
      else if (k === 'del') { if (confirm('確定刪除這筆？')) { removeTx(F.id); bg.remove(); } }
    });
  }
  function readForm(bg) {
    F.amount = L.num(bg.querySelector('#fAmt').value);
    F.currency = bg.querySelector('#fCur').value;
    F.date = bg.querySelector('#fDate').value || L.today();
    F.member = bg.querySelector('#fMember').value;
    F.note = bg.querySelector('#fNote').value.trim();
    var r = bg.querySelector('#fRule'); F._rule = r ? r.checked : false;
  }
  function hint(bg) {
    var el = bg.querySelector('#fHint'); if (!el || F.type !== '支') return;
    var st = budgetState(0), r = st.rows.filter(function (x) { return x.category === F.category; })[0];
    el.textContent = r ? F.category + ' 本期已用 ' + yen(r.spent) + ' / ' + yen(r.budget) + '，剩 ' + yen(r.budget - r.spent) : '';
  }
  function saveForm(bg) {
    if (!F.amount) { toast('請輸入金額'); return; }
    if (!F.category) { toast('請選類別'); return; }
    var isNew = !F.id;
    var t = { id: F.id || uuid(), date: F.date, type: F.type, category: F.category, group: groupOf(F.category), amount: Math.abs(F.amount), currency: F.currency, account: F.account, member: F.member, tags: F.tags || '', note: F.note, source: F.source || 'manual', extId: F.extId || '', status: 'ok' };
    if (isNew) {
      t.createdAt = new Date().toISOString().slice(0, 19);
      D().tx.push(t); enqueue('add', { tx: t });
    } else {
      var i = D().tx.findIndex(function (x) { return x.id === t.id; });
      if (i >= 0) D().tx[i] = Object.assign(D().tx[i], t);
      enqueue('update', { tx: t });
    }
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
    var msg = (isNew ? '已記帳 ' : '已更新 ') + yen(t.amount) + '（' + t.category + '）';
    if (t.type === '支') {
      var st = budgetState(0), r = st.rows.filter(function (x) { return x.category === t.category; })[0];
      if (r) { var p = Math.round(r.spent / r.budget * 100); msg += '\n' + t.category + ' 本期 ' + p + '%' + (p >= 100 ? ' ⚠️ 已超支' : p >= Number(setting('alertPercent', 80)) ? ' ⚠️ 快用完了' : ''); }
    }
    toast(msg, 3200);
  }
  function removeTx(id) {
    S.data.tx = D().tx.filter(function (x) { return x.id !== id; });
    enqueue('remove', { id: id }); persist(); render(); toast('已刪除');
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
    var head = ['日期', '類別', '大類別', '金額', '貨幣', '成員', '帳戶', '標籤', '備註', '收支區分', '來源', 'UUID'];
    var q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [head.join(',')].concat(list.map(function (t) {
      return [t.date.replace(/-/g, ''), t.category, t.group || groupOf(t.category), t.amount, t.currency || 'JPY', t.member, t.account, t.tags, t.note, t.type, t.source, t.id].map(q).join(',');
    })).join('\n');
  }

  var ACTS = {
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
      S.cfg = { url: document.getElementById('cfgUrl').value.trim(), token: document.getElementById('cfgToken').value.trim() };
      save('kk_cfg', S.cfg); toast('同步中…');
      refresh().then(function () { if (S.data) { S.tab = 'home'; S.page = null; render(); } });
    },
    saveSettings: function () {
      var o = {};
      [].forEach.call($app.querySelectorAll('[data-key]'), function (el) { o[el.dataset.key] = el.value; D().settings[el.dataset.key] = el.value; });
      enqueue('saveSettings', { settings: o }); toast('已儲存'); render();
    },
    resetLocal: function () { if (confirm('清除這支手機的暫存？之後會重新從雲端下載。')) { localStorage.removeItem('kk_data'); S.data = null; refresh(); } },
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
      S.ps = Object.assign({}, p, { pay: it.pay || {}, deduct: it.deduct || {}, attendance: it.attendance || {}, warnings: [], _saved: true });
      drawPayslipPreview(); window.scrollTo(0, 0);
    },
    psDel: function () {
      if (!confirm('刪除這份明細？（工資收入紀錄不會一起刪）')) return;
      var id = 'payslip-' + S.ps.month; S.data.payslips = D().payslips.filter(function (x) { return x.id !== id; });
      enqueue('removePayslip', { id: id }); persist(); S.ps = null; render();
    },

    simSet: function (k, el) { S.sim[k] = Number(el.value) || 0; render(); },

    recSet: function (arg, el) { var a = arg.split(':'); tableSet('recurring', a[0], a[1], el); },
    recDel: function (i) { D().recurring.splice(Number(i), 1); render(); },
    recAdd: function () { D().recurring.push({ id: 'r' + Date.now(), name: '', category: '會員費', amount: 0, account: 'ゆうちょ', day: 1, active: 'TRUE', note: '' }); render(); },
    recSave: function () {
      D().recurring.forEach(function (r) { r.note = r.note || r.name; });
      enqueue('saveTable', { table: 'recurring', rows: D().recurring }); persist(); toast('固定支出已儲存');
    },

    accSet: function (arg, el) { var a = arg.split(':'); tableSet('accounts', a[0], a[1], el); if (a[1] === 'type' || a[1] === 'color') render(); },
    accAdd: function () { D().accounts.push({ name: '新帳戶', type: 'emoney', color: '#607d8b', order: D().accounts.length + 1, active: 'TRUE', icon: '' }); render(); },
    accSave: function () { enqueue('saveTable', { table: 'accounts', rows: D().accounts }); persist(); toast('帳戶已儲存'); },
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
  render();
  if (S.cfg.url && S.cfg.token) refresh(true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.cfg.url) refresh(true); });
})();
