/* Wen 記帳 v3 — 共用介面元件 */
'use strict';
{
const {esc} = W;
W.$ = (s, r = document) => r.querySelector(s);
W.$$ = (s, r = document) => [...r.querySelectorAll(s)];
const sv = (d, st = '') => `<svg class="ic" viewBox="0 0 24 24" ${st}>${d}</svg>`;
W.I = {
  x: sv('<path d="M6 6l12 12M18 6 6 18"/>'), back: sv('<path d="m15 5-7 7 7 7"/>'), ok: sv('<path d="m5 12.5 4.5 4.5L19 7"/>', 'style="stroke-width:2.6"'),
  plus: sv('<path d="M12 5v14M5 12h14"/>', 'style="stroke-width:2.4"'), search: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/>', 'style="stroke-width:2.4"'),
  pen: sv('<path d="M4 20h4L19 9l-4-4L4 16z"/>'), trash: sv('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/>'),
  doc: sv('<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/>'), up: sv('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'), down: sv('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  yen: sv('<path d="M6 4l6 8 6-8M12 12v8M8 13h8M8 16.5h8"/>')
};
const I = W.I;
W.toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 2600); };
W.alert = (title, msg, btns) => {
  const m = document.createElement('div'); m.className = 'mask dim'; m.style.cssText = 'display:grid;place-items:center';
  m.innerHTML = `<div class="alert" role="dialog"><div class="at">${esc(title)}</div>${msg ? `<div class="am">${esc(msg)}</div>` : ''}<div class="ab2">${btns.map((b, i) => `<button data-i="${i}" class="${b.s || ''}">${esc(b.t)}</button>`).join('')}</div></div>`;
  m.onclick = e => { const b = e.target.closest('button'); if (!b) return; m.remove(); btns[+b.dataset.i].f?.(); };
  document.body.append(m);
};
W.confirm = (title, msg, ok, f) => W.alert(title, msg, [{t: '取消'}, {t: ok, s: 'd', f}]);
const stack = W.stack = [];
W.page = (type, build) => {
  const el = document.createElement('div'); el.className = 'page ' + type; el.innerHTML = '<div class="in"></div>'; document.body.append(el);
  const p = {el, in: el.firstChild, close() { el.remove(); const i = stack.indexOf(p); if (i >= 0) stack.splice(i, 1); p.onclose?.(); }, refresh() { const y = el.scrollTop; build(p); el.scrollTop = y; }};
  stack.push(p); queueMicrotask(() => build(p)); return p;
};
W.refreshAll = () => { for (const p of [...stack]) p.refresh(); };
W.head = (left, title, right = '') => `<div class="top">${left}<span class="sp"></span>${right}<span class="t">${esc(title)}</span></div>`;
W.bx = (id, icon, label, cls = 'cb') => `<button class="${cls}" data-${id} aria-label="${esc(label)}">${icon}</button>`;
W.popover = (anchor, items) => {
  const m = document.createElement('div'); m.className = 'mask'; const r = anchor.getBoundingClientRect(); const pop = document.createElement('div'); pop.className = 'pop';
  pop.innerHTML = items.map((it, i) => `<button class="pi ${it.d ? 'd' : ''}" data-i="${i}">${it.icon || ''}<span>${esc(it.t)}</span></button>`).join('');
  document.body.append(m, pop);
  const pw = pop.offsetWidth, ph = pop.offsetHeight; let left = r.right - pw; if (r.left + r.width / 2 < innerWidth / 2) left = r.left; left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 6; if (top + ph > innerHeight - 10) top = Math.max(10, r.top - ph - 6); pop.style.left = left + 'px'; pop.style.top = top + 'px';
  const close = () => { m.remove(); pop.remove(); }; m.onclick = close; pop.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; close(); items[+b.dataset.i].f(); };
};
W.seg = (name, opts, cur) => `<div class="cap seg">${opts.map(([v, t]) => `<button data-${name}="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>`;
W.drawFig = (el, fn) => { const go = () => { const w = el.clientWidth, h = el.clientHeight; if (w) el.innerHTML = fn(w, h); }; go(); new ResizeObserver(go).observe(el); };
W.ticks = (lo, hi, n = 4) => { if (lo === hi) hi = lo + 1; const st0 = (hi - lo) / n; const mag = 10 ** Math.floor(Math.log10(st0)); const st = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= st0); const t = []; for (let v = Math.floor(lo / st) * st; v <= Math.ceil(hi / st) * st + st / 2; v += st) t.push(v); return t; };
W.wan = v => { const a = Math.abs(v); return a >= 1e4 ? `${+(v / 1e4).toFixed(a >= 1e5 ? 0 : 1)}萬` : String(Math.round(v)); };
/* 長條圖：series=[{name,color,vals}]，line 可選 */
W.barChart = (el, labels, series, opts = {}) => W.drawFig(el, (Wd, H) => {
  const L = 44, R = opts.line ? 44 : 10, T = 12, B = 26, n = labels.length; if (!n) return '';
  const max = Math.max(1, ...series.flatMap(s => s.vals)); const tk = W.ticks(0, max); const hi = tk.at(-1); const y = v => T + (hi - v) / hi * (H - T - B);
  const bw = (Wd - L - R) / n, g = Math.max(1, bw * .16), w = Math.max(1.5, (bw - g * (series.length + 1)) / series.length);
  let s = `<svg viewBox="0 0 ${Wd} ${H}">`;
  for (const v of tk) s += `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" stroke="#2c2c2e"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#8e8e93">${W.wan(v)}</text>`;
  series.forEach((sr, j) => sr.vals.forEach((v, i) => { if (!v) return; s += `<rect x="${L + i * bw + g + j * (w + g)}" y="${y(v)}" width="${w}" height="${Math.max(0, y(0) - y(v))}" rx="1.5" fill="${sr.color}"><title>${esc(labels[i])} ${esc(sr.name)} ${W.yen(v)}</title></rect>`; }));
  if (opts.line) { const lv = opts.line.vals; const lt = W.ticks(0, Math.max(1, ...lv)); const lh = lt.at(-1); const y2 = v => T + (lh - v) / lh * (H - T - B);
    for (const v of lt) s += `<text x="${Wd - R + 6}" y="${y2(v) + 4}" font-size="10" fill="${opts.line.color}">${W.wan(v)}</text>`;
    s += `<polyline points="${lv.map((v, i) => `${(L + i * bw + bw / 2).toFixed(1)},${y2(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${opts.line.color}" stroke-width="2"/>` + lv.map((v, i) => `<circle cx="${L + i * bw + bw / 2}" cy="${y2(v)}" r="2.8" fill="${opts.line.color}"/>`).join(''); }
  const step = Math.ceil(n / (Wd < 420 ? 6 : 12));
  labels.forEach((lb, i) => { if (i % step === 0 || i === n - 1) s += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#8e8e93">${esc(lb)}</text>`; });
  return s + '</svg>';
});
W.legend = items => `<div class="lgd">${items.map(([n, c]) => `<span><i style="background:${c}"></i>${esc(n)}</span>`).join('')}</div>`;
}
