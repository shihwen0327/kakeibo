/* 純邏輯：CSV、PayPay、薪資明細、預算週期。App 和測試共用。 */
(function (root) {
  'use strict';

  /* PDF 常見的部首字形（NFKC 轉不掉的） */
  var RADICALS = { '⺠': '民', '⻑': '長', '⻄': '西', '⻘': '青', '⻝': '食', '⻣': '骨', '⺟': '母', '⻆': '角', '⻨': '麦', '⻩': '黄', '⻫': '斉', '⻭': '歯', '⻲': '亀', '⺾': '艹', '⻌': '辶', '⺅': '亻', '⺮': '竹', '⻤': '鬼' };
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFKC').replace(/　/g, ' ')
      .replace(/[⺀-⻿]/g, function (c) { return RADICALS[c] || c; });
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function toObjects(rows) {
    var head = rows[0].map(function (h) { return norm(h).trim(); });
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i] == null ? '' : r[i]; });
      return o;
    });
  }

  function ymd(s) {
    s = norm(s).trim();
    var m = s.match(/^(\d{4})[\/\-年.]?(\d{1,2})[\/\-月.]?(\d{1,2})/);
    if (!m) return '';
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  function num(s) {
    if (typeof s === 'number') return s;
    var t = norm(s).replace(/[,円¥\s]/g, '');
    var m = t.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }

  /* ---------- 舊記帳 App 的 CSV（原樣匯入） ---------- */
  function legacyToTx(text) {
    var objs = toObjects(parseCSV(text));
    var out = [];
    objs.forEach(function (o) {
      var date = ymd(o['日期']);
      var amount = num(o['金額']);
      if (!date || !amount) return;
      out.push({
        id: o['UUID'] || ('legacy-' + date + '-' + out.length),
        date: date,
        type: o['收支區分'] === '收' ? '收' : '支',
        category: o['類別'] || '待分類',
        group: o['大類別'] || '',
        amount: amount,
        currency: o['貨幣'] || 'JPY',
        account: o['帳戶'] || '',
        member: o['成員'] || '自己',
        tags: o['標籤'] || '',
        note: o['備註'] || '',
        source: 'import',
        status: 'ok'
      });
    });
    return out;
  }

  /* ---------- PayPay 取引履歴 CSV ---------- */
  function pick(o, keys) {
    var ks = Object.keys(o);
    for (var i = 0; i < keys.length; i++) {
      for (var j = 0; j < ks.length; j++) if (ks[j].indexOf(keys[i]) >= 0 && o[ks[j]] !== '' && o[ks[j]] !== '-') return o[ks[j]];
    }
    return '';
  }

  function parsePayPay(text, rules) {
    var objs = toObjects(parseCSV(text));
    var out = [], skipped = 0;
    objs.forEach(function (o, i) {
      var date = ymd(pick(o, ['取引日', '日時', '日付']));
      var outAmt = num(pick(o, ['出金金額', '出金']));
      var inAmt = num(pick(o, ['入金金額', '入金']));
      var kind = norm(pick(o, ['取引内容', '取引種別', '内容']));
      var partner = norm(pick(o, ['取引先', '加盟店', '相手'])).trim();
      var no = pick(o, ['取引番号', '決済番号', 'ID']);
      if (!date || (!outAmt && !inAmt) || /チャージ|失敗|取消|キャンセル/.test(kind)) { skipped++; return; }
      var type = outAmt ? '支' : '收';
      var category;
      if (type === '支') category = matchRule(partner, rules) || '待分類';
      else category = /ポイント|特典|還元/.test(kind) ? '點數' : '代收';
      out.push({
        id: 'paypay-' + (no || (date + '-' + (outAmt || inAmt) + '-' + i)),
        date: date, type: type, category: category, amount: outAmt || inAmt, currency: 'JPY',
        account: 'Pay Pay', member: '自己', note: partner || kind, source: 'paypay-csv',
        extId: no ? String(no) : '', status: category === '待分類' ? 'inbox' : 'ok'
      });
    });
    return { rows: out, skipped: skipped };
  }

  /* 和已記的 PayPay 紀錄對照：同金額、日期差 1 天內視為同一筆 */
  function reconcilePayPay(csvRows, existing) {
    var used = {};
    var byExt = {};
    existing.forEach(function (t) { if (t.extId) byExt[t.extId] = true; if (String(t.id).indexOf('paypay-') === 0) byExt[t.id] = true; });
    var res = { add: [], matched: [], dup: 0 };
    csvRows.forEach(function (r) {
      if ((r.extId && byExt[r.extId]) || byExt[r.id]) { res.dup++; return; }
      var hit = null;
      for (var i = 0; i < existing.length; i++) {
        var t = existing[i];
        if (used[t.id] || t.extId) continue;
        if (!/pay\s*pay/i.test(t.account)) continue;
        if (t.type !== r.type || Number(t.amount) !== Number(r.amount)) continue;
        if (Math.abs(dayDiff(t.date, r.date)) > 1) continue;
        hit = t; break;
      }
      if (hit) { used[hit.id] = true; res.matched.push({ id: hit.id, extId: r.extId || r.id, note: hit.note || r.note }); }
      else res.add.push(r);
    });
    return res;
  }

  function matchRule(merchant, rules) {
    if (!merchant || !rules) return '';
    var m = norm(merchant).toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var k = norm(rules[i].keyword).toLowerCase();
      if (k && m.indexOf(k) >= 0) return rules[i].category;
    }
    return '';
  }

  /* ---------- 日期與預算週期 ---------- */
  function parseYmd(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function fmt(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dayDiff(a, b) { return Math.round((parseYmd(a) - parseYmd(b)) / 86400000); }
  function today() { return fmt(new Date()); }

  /* 包含 dateStr 的週期；offset = -1 表示上一期 */
  function cycleOf(dateStr, startDay, offset) {
    var d = parseYmd(dateStr);
    var y = d.getFullYear(), m = d.getMonth();
    if (d.getDate() < startDay) m -= 1;
    m += offset || 0;
    var start = new Date(y, m, startDay);
    var end = new Date(y, m + 1, startDay - 1);
    return { start: fmt(start), end: fmt(end), label: (start.getMonth() + 1) + '/' + start.getDate() + '–' + (end.getMonth() + 1) + '/' + end.getDate(), key: fmt(start) };
  }

  /* ---------- 薪資明細 ---------- */
  var DEDUCT_RE = /保険|年金|税|控除合計|支援金|寮費|社宅|組合費|天引/;

  /* pdf.js 文字片段 → 依 y 座標組成行 */
  function itemsToLines(items) {
    var rows = [];
    items.forEach(function (it) {
      var s = it.str;
      if (!s || !s.trim()) return;
      var row = null;
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i].y - it.y) < 3) { row = rows[i]; break; }
      if (!row) { row = { y: it.y, parts: [] }; rows.push(row); }
      row.parts.push(it);
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      return r.parts.map(function (p) { return p.str.trim(); }).join(' ');
    });
  }

  function pairsOf(line) {
    var re = /([^\d\s,()（）\-][^\d]*?)\s*(-?\d[\d,]*)(?![\d.:\/日])/g, m, out = [];
    while ((m = re.exec(line))) {
      var label = m[1].replace(/[:：]/g, '').trim();
      if (!label) continue;
      out.push({ label: label, value: num(m[2]) });
    }
    return out;
  }

  function parsePayslip(input) {
    var lines = (Array.isArray(input) ? input : String(input).split(/\r?\n/)).map(function (l) { return norm(l).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var res = { month: '', payDate: '', pay: {}, deduct: {}, gross: 0, deduction: 0, net: 0, attendance: {}, warnings: [] };
    var all = lines.join('\n');
    var mm = all.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:\d{1,2}\s*日\s*)?(?:支払|支給)/);
    if (mm) {
      res.month = mm[1] + '-' + ('0' + mm[2]).slice(-2);
      var dd = all.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:支払|支給)/);
      res.payDate = dd ? mm[1] + '-' + ('0' + mm[2]).slice(-2) + '-' + ('0' + dd[3]).slice(-2) : '';
    }
    var state = 'head', netPending = false;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (/勤怠|備考/.test(L) && !/勤怠控除/.test(L)) state = 'tail';
      if (state === 'head') {
        if (/差引|手取|振込額|差引支給/.test(L)) {
          var p0 = pairsOf(L.replace(/.*(差引[^\d]*|手取[^\d]*|振込額)/, '$1'));
          if (p0.length) res.net = p0[p0.length - 1].value; else netPending = true;
          continue;
        }
        if (/^(支給|支給項目)\s+(控除|控除項目)$/.test(L) || (/支給/.test(L) && /控除/.test(L) && !/\d/.test(L))) { state = 'body'; continue; }
        if (netPending) {
          var big = L.match(/(?:^|[^\dA-Za-z])(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d])/);
          if (big) { res.net = num(big[1]); netPending = false; }
        }
        continue;
      }
      if (state === 'body') {
        var ps = pairsOf(L);
        if (!ps.length) continue;
        if (ps.length >= 2) {
          put(res.pay, ps[0]);
          for (var k = 1; k < ps.length; k++) put(res.deduct, ps[k]);
        } else {
          put(DEDUCT_RE.test(ps[0].label) && ps[0].label !== '勤怠控除' ? res.deduct : res.pay, ps[0]);
        }
      } else if (state === 'tail') {
        var a = L.match(/労働日数\s*([\d.]+)/); if (a) res.attendance['労働日数'] = Number(a[1]);
        var b = L.match(/有休残日数\s*([\d.]+)/); if (b) res.attendance['有休残日数'] = Number(b[1]);
        var c = L.match(/時間外労働時間\s*(\d{1,3}:\d{2})/); if (c && !res.attendance['時間外労働時間']) res.attendance['時間外労働時間'] = c[1];
      }
    }
    function put(target, p) {
      var key = /^(計|合計|支給合計|総支給額|控除合計)$/.test(p.label) ? '計' : p.label;
      target[key] = p.value;
    }
    var sumPay = sumExcept(res.pay), sumDed = sumExcept(res.deduct);
    res.gross = res.pay['計'] || sumPay;
    res.deduction = res.deduct['計'] || sumDed;
    if (!res.net) { res.net = res.gross - res.deduction; res.warnings.push('找不到差引支給額，用總支給 − 控除計算'); }
    if (res.pay['計'] && sumPay !== res.pay['計']) res.warnings.push('支給項目加總 ' + sumPay + ' ≠ 計 ' + res.pay['計']);
    if (res.deduct['計'] && sumDed !== res.deduct['計']) res.warnings.push('控除項目加總 ' + sumDed + ' ≠ 計 ' + res.deduct['計']);
    if (res.gross - res.deduction !== res.net) res.warnings.push('總支給 − 控除 ≠ 實領，請確認');
    delete res.pay['計']; delete res.deduct['計'];
    return res;
  }

  function sumExcept(o) {
    return Object.keys(o).filter(function (k) { return k !== '計'; }).reduce(function (s, k) {
      return s + (k === '勤怠控除' ? -Math.abs(o[k]) : o[k]);
    }, 0);
  }

  var Lib = {
    norm: norm, parseCSV: parseCSV, toObjects: toObjects, ymd: ymd, num: num,
    legacyToTx: legacyToTx, parsePayPay: parsePayPay, reconcilePayPay: reconcilePayPay, matchRule: matchRule,
    parseYmd: parseYmd, fmt: fmt, dayDiff: dayDiff, today: today, cycleOf: cycleOf,
    itemsToLines: itemsToLines, parsePayslip: parsePayslip
  };
  if (typeof module !== 'undefined') module.exports = Lib; else root.Lib = Lib;
})(this);
