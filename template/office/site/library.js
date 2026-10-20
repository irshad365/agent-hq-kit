/* Agent HQ: Project Library room (plan 2026-10-17-office-v2 step C, redesigned in
   plan 2026-10-19-office-public-view: uniform books, 16-colour palette, readable DOM labels).
   index.html owns window.HQ and <div id="library">; this file owns window.Library.
   Contract: HQ = { esc, dur, ago, role(type), label(agent), openModal(html, cls), closeModal(), data }
             Library = { update(data) }, data = { state, events, projects, library, limits, public }.
   data.public = true: projects are /public books ({ slug, name, group, color, order, working }) and
   nothing else exists; the detail page only shows the title. Every string that reaches the DOM goes
   through esc() or textContent. No network requests, no timers: blinking/glow are CSS animations. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // ---------- constants ----------
  // Book colours: one fixed 16-colour pixel palette, picked by project order (or /public `color`).
  const BOOK = ['#e8483c', '#f08030', '#f8d030', '#88c838', '#38a048', '#30b8a0', '#48b8e8', '#3868d0',
    '#5038a0', '#9848c0', '#e868a8', '#a83058', '#c89060', '#606878', '#e8e0d0', '#284860'];
  // Stack colours: shown as a swatch on the detail page only.
  const PALETTE = {
    flutter: '#3b82d6', fastapi: '#2e9b6a', nextjs: '#1c1c1c', react: '#4bb8d8', node: '#5f8f3a',
    python: '#d8b638', firebase: '#f0a020', vanillajs: '#e8d040', static: '#c8683a', infra: '#34508a',
    docs: '#b8a888', plan: '#8a7aa0', other: '#707080',
  };
  const STACK_GUESS = [[/flutter|dart/i, 'flutter'], [/fastapi/i, 'fastapi'], [/next/i, 'nextjs'], [/react/i, 'react'],
    [/node|express/i, 'node'], [/python|django|flask/i, 'python'], [/firebase/i, 'firebase'],
    [/vanilla|javascript/i, 'vanillajs'], [/html|static|astro|hugo|jekyll/i, 'static']];
  const GROUPS = [
    { key: 'active', label: 'ACTIVE' },
    { key: 'maintained', label: 'MAINTAINED / IDLE' },
    { key: 'dormant', label: 'DORMANT / PLANNING' },
  ];
  const RIBBON = '#c03030', RIBBON_CRIT = '#ff3030', OUT = '#282830', GLOW = '#fff0a0', GLOW2 = '#e8c040';
  // Canvas units (1 unit = `scale` CSS px). Every book is BW x BH, whatever its title or task count.
  const BW = 46, BH = 30, HEAD = 8, PLANK = 5, BELOW = 6;
  const LABEL_H = 13, TOP = 8, FLOOR = 12, MARGIN = 4, FRAME = 5, GAP = 3, LIFT = 4, HIT = 2;

  // ---------- small helpers ----------
  const HQ = () => window.HQ || {};
  const esc = (s) => (typeof HQ().esc === 'function' ? HQ().esc(s)
    : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const str = (v, n) => (v == null ? '' : String(v).slice(0, n));
  const titleCase = (t) => String(t || 'agent').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const roleOf = (type) => (typeof HQ().role === 'function' ? HQ().role(type) : titleCase(type));
  const who = (name, type) => `${str(name, 40)} (${roleOf(type)})`;   // "Name (Role)"
  const agoTxt = (ts) => (num(ts) && typeof HQ().ago === 'function' ? HQ().ago(ts) : '');
  const shelfLabel = (k) => (GROUPS.find((g) => g.key === k) || GROUPS[2]).label;

  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function shade(h, f) {
    const c = hexRgb(h).map((v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function ink(h) { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#101018' : '#f8f8f8'; }

  function stackColor(p) {
    const k = String(p.stackColorKey || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PALETTE, k)) return PALETTE[k];
    const first = str(arr(p.stack)[0], 30);
    for (const [re, key] of STACK_GUESS) if (re.test(first)) return PALETTE[key];
    return PALETTE.other;
  }
  const bookColor = (i) => BOOK[((Math.floor(i) % 16) + 16) % 16];

  function projList(p) {
    const list = Array.isArray(p) ? p : p && typeof p === 'object' ? arr(p.projects !== undefined ? p.projects : p) : [];
    const seen = new Set();
    return list.filter((x) => x && typeof x === 'object' && typeof x.slug === 'string' && x.slug &&
      !seen.has(x.slug) && seen.add(x.slug));
  }

  function bookList(d) {
    const pub = d.public === true;
    const state = obj(d.state), act = obj(state.activity), lib = obj(d.library), sec = obj(lib.security);
    const working = new Set(arr(state.agents).filter((a) => a && a.status === 'working' && typeof a.project === 'string')
      .map((a) => a.project));
    return projList(d.projects).map((p, i) => {
      const slug = p.slug, g = GROUPS.some((x) => x.key === p.group) ? p.group : 'dormant';
      const title = str(p.name, 40) || slug;
      if (pub) {
        return { slug, p, title, group: g, color: bookColor(num(p.color)), order: num(p.order), tasks: 0,
          glow: p.working === true, rib: '' };
      }
      const a = obj(act[slug]), s = obj(sec[slug]), items = arr(s.items);
      const open = num(s.open) || items.length;
      const crit = s.critical === true || items.some((it) => it && String(it.sev).toLowerCase() === 'critical');
      return { slug, p, title, group: g, color: bookColor(i), order: i, tasks: num(a.tasks) || num(a.count),
        glow: working.has(slug), rib: open ? (crit ? 'crit' : 'open') : '' };
    });
  }

  // ---------- DOM setup (once) ----------
  let root = null, roomEl, scrollEl, cv, ctx, fx, labels, head, countEl, sr, srList, legend, styleDone = false;
  let data = {}, books = [], L = null, key = '', focusIdx = -1, spreadEl = null, lastW = -1;

  const CSS = `
#library { color: #f8f8f0; position: relative; }
#library .lib-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin: 0 0 8px; font-size: 10px; color: #f8d030; text-shadow: 2px 2px 0 #a04000; letter-spacing: 1px; }
#library .lib-head small { font-size: 7px; color: #b8b8c8; text-shadow: none; letter-spacing: 0; }
#library .lib-scroll { overflow-x: hidden; border: 4px solid #0c0c14; box-shadow: 0 0 0 4px #505070; }
#library .lib-scroll:focus-within { box-shadow: 0 0 0 4px #f8d030; }
#library .lib-room { position: relative; margin: 0 auto; }
#library canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; cursor: pointer; outline: none;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
#library .lib-fx, #library .lib-labels { position: absolute; inset: 0; pointer-events: none; }
#library .lib-fx i { position: absolute; display: block; }
#library .lib-glow { box-shadow: 0 0 6px 2px rgba(255, 224, 96, .85); animation: lib-pulse 1.6s steps(4) infinite; }
#library .lib-crit { background: ${RIBBON_CRIT}; clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 72%, 0 100%);
  animation: lib-blink 1s steps(1) infinite; }
#library .lib-labels span { position: absolute; display: flex; align-items: center; justify-content: center;
  padding: 0 1px 0 4px; box-sizing: border-box; overflow: hidden; }
#library .lib-labels b { font: 600 14px/1.15 'Pixelify Sans', ui-monospace, monospace; letter-spacing: -0.5px; text-align: center;
  overflow-wrap: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  -webkit-font-smoothing: none; }
#library .lib-labels .lib-plaque { padding: 0 6px; justify-content: flex-start; background: #e8c060; border: 2px solid ${OUT};
  font: 600 14px/1 'Pixelify Sans', ui-monospace, monospace; color: ${OUT}; white-space: nowrap; width: auto; }
#library .lib-labels .lib-none { font: 500 14px/1 'Pixelify Sans', ui-monospace, monospace; color: #c8a878; padding: 0; }
#library .lib-legend { font-size: 7px; line-height: 1.9; color: #b8b8c8; margin-top: 8px; }
#library .lib-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 1099px) {
  #library .lib-scroll { max-height: calc(40vh - 48px); min-height: 120px; overflow-y: auto; overscroll-behavior: contain; }
  #library .lib-legend { margin-top: 6px; }
}
@keyframes lib-blink { 50% { opacity: .25; } }
@keyframes lib-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { #library .lib-glow, #library .lib-crit { animation: none; } }
.card.spread, #card.spread { max-width: 760px; }
.lib-spread { color: #282830; font-size: 8px; line-height: 1.8; }
.lib-spread .lib-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.lib-spread .lib-chip { width: 10px; height: 18px; border: 2px solid #282830; flex: none; }
.lib-spread .lib-swatch { display: inline-block; width: 8px; height: 8px; border: 1px solid #282830; margin-right: 4px; vertical-align: -1px; }
.lib-spread .lib-pages { display: grid; grid-template-columns: 1fr 1fr; background: #fffaf0; border: 3px solid #282830;
  box-shadow: 4px 4px 0 #806030; }
.lib-spread .lib-pages.lib-one { grid-template-columns: 1fr; }
.lib-spread .lib-page { padding: 12px; min-width: 0; overflow-wrap: anywhere; }
.lib-spread .lib-left { border-right: 2px solid #c8b088; box-shadow: inset -10px 0 10px -10px rgba(0, 0, 0, .4); }
.lib-spread .lib-one .lib-left { border-right: 0; box-shadow: none; }
.lib-spread .lib-right { box-shadow: inset 10px 0 10px -10px rgba(0, 0, 0, .4); }
.lib-spread h2 { font-size: 11px; margin: 0 0 8px; line-height: 1.5; }
.lib-spread h3 { font-size: 8px; margin: 12px 0 4px; color: #804018; }
.lib-spread h3:first-child { margin-top: 0; }
.lib-spread p { margin: 0 0 8px; }
.lib-spread dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; margin: 0; font-size: 7px; }
.lib-spread dt { color: #806030; } .lib-spread dd { margin: 0; text-align: left; }
.lib-spread ul { list-style: none; padding: 0; margin: 0; font-size: 7px; line-height: 1.9; }
.lib-spread li { border-bottom: 2px dotted #c8a868; padding: 2px 0; }
.lib-spread li span, .lib-spread .lib-dim { color: #806030; }
.lib-spread .sev-critical { color: #fff; background: #d02020; padding: 0 3px; }
.lib-spread .sev-high { color: #c02020; } .lib-spread .sev-medium { color: #b06000; }
@media (max-width: 560px) {
  .lib-spread .lib-pages { grid-template-columns: 1fr; }
  .lib-spread .lib-left { border-right: 0; border-bottom: 2px dashed #c8b088; box-shadow: none; }
  .lib-spread .lib-right { box-shadow: none; }
}`;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function setup() {
    if (root && root.isConnected !== false) return true;
    root = document.getElementById('library');
    if (!root) return false;
    if (!styleDone) {
      const st = el('style'); st.textContent = CSS; (document.head || document.documentElement).appendChild(st); styleDone = true;
    }
    root.textContent = '';
    head = el('div', 'lib-head');
    head.appendChild(el('span', null, 'PROJECT LIBRARY'));
    countEl = el('small', 'lib-count', '');
    head.appendChild(countEl);
    scrollEl = el('div', 'lib-scroll');
    roomEl = el('div', 'lib-room');
    cv = el('canvas');
    cv.setAttribute('tabindex', '0');
    cv.setAttribute('role', 'group');
    cv.setAttribute('aria-label', 'Project library. Arrow keys choose a book, Enter opens it.');
    ctx = cv.getContext('2d');
    fx = el('div', 'lib-fx'); fx.setAttribute('aria-hidden', 'true');
    labels = el('div', 'lib-labels'); labels.setAttribute('aria-hidden', 'true');   // srList carries the same text
    sr = el('div', 'lib-sr'); sr.setAttribute('aria-live', 'polite');
    srList = el('ul', 'lib-sr');
    roomEl.appendChild(cv); roomEl.appendChild(fx); roomEl.appendChild(labels);
    scrollEl.appendChild(roomEl);
    legend = el('div', 'lib-legend', '');
    root.appendChild(head); root.appendChild(scrollEl); root.appendChild(sr); root.appendChild(srList); root.appendChild(legend);
    cv.addEventListener('click', onTap);
    cv.addEventListener('keydown', onKey);
    cv.addEventListener('focus', () => { if (focusIdx < 0 && books.length) focusIdx = 0; announce(); draw(); });
    cv.addEventListener('blur', () => draw());
    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(() => { if (root.clientWidth !== lastW) render(true); }).observe(root);
    } else {
      window.addEventListener('resize', () => render(true));
    }
    return true;
  }

  // ---------- layout ----------
  function layout() {
    const cw = Math.max(0, (scrollEl.clientWidth || root.clientWidth || 320));
    const scale = cw >= 720 ? 3 : 2;
    const W = Math.max(BW + 2 * (MARGIN + FRAME + 2), Math.floor(cw / scale));
    const x0 = MARGIN + FRAME + 2, x1 = W - MARGIN - FRAME - 2;
    const perLine = Math.max(1, Math.floor((x1 - x0 + GAP) / (BW + GAP)));
    const pad = Math.floor((x1 - x0 - (perLine * BW + (perLine - 1) * GAP)) / 2);   // centre each line
    let y = TOP;
    const shelves = [];
    for (const g of GROUPS) {
      const mine = books.filter((b) => b.group === g.key).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
      const sh = { g, y, lines: [] };
      y += LABEL_H;
      for (let i = 0; i < Math.max(1, mine.length); i += perLine) sh.lines.push(mine.slice(i, i + perLine));
      sh.bottoms = sh.lines.map((ln) => {                // fixed line height: no growth with book size
        const bottom = y + HEAD + BH;
        ln.forEach((b, i) => { b.x = x0 + pad + i * (BW + GAP); b.bottom = bottom; b.top = bottom - BH - (b.glow ? LIFT : 0); });
        y = bottom + PLANK + BELOW;
        return bottom;
      });
      sh.end = y;
      shelves.push(sh);
    }
    const order = [];
    shelves.forEach((s) => s.lines.forEach((ln) => order.push(...ln)));
    return { cw, scale, W, H: y + 2 + FLOOR, x0, x1, shelves, order };
  }

  // ---------- drawing ----------
  function px(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  function drawBook(b, focused) {                   // a face-out cover; the title is a DOM label on top
    const x = b.x, y = b.top, w = BW, h = BH;
    if (b.glow) { px(x - 2, y - 2, w + 4, h + 4, GLOW2); px(x - 1, y - 1, w + 2, h + 2, GLOW); }
    else px(x - 1, y - 1, w + 2, h + 1, OUT);
    px(x, y, w, h, b.color);
    px(x, y, 3, h, shade(b.color, -0.3)); px(x + 3, y, 1, h, shade(b.color, 0.3));            // spine edge
    px(x + 4, y, w - 4, 1, shade(b.color, 0.25)); px(x + w - 1, y, 1, h, shade(b.color, -0.25));
    px(x + 4, y + h - 1, w - 4, 1, shade(b.color, -0.35));
    if (focused) {
      for (let i = 0; i < h + 6; i += 2) { px(x - 3, y - 3 + i, 1, 1, '#ffffff'); px(x + w + 2, y - 3 + i, 1, 1, '#ffffff'); }
      for (let i = 0; i < w + 6; i += 2) { px(x - 3 + i, y - 3, 1, 1, '#ffffff'); px(x - 3 + i, y + h + 2, 1, 1, '#ffffff'); }
    }
  }
  function ribbonRect(b) { return { x: b.x + Math.floor(BW / 2) - 1, y: b.bottom - 6, w: 3, h: 6 + PLANK + 4 }; }
  function drawRibbon(b) {
    if (b.rib !== 'open') return;                   // critical ribbons are a blinking DOM overlay
    const r = ribbonRect(b);
    px(r.x, r.y, r.w, r.h, RIBBON);
    px(r.x + 1, r.y + r.h - 1, 1, 1, '#5a3818');   // notch
  }

  function draw() {
    if (!L || !ctx) return;
    const { W, H } = L;
    px(0, 0, W, H, '#f0e8c8');                                       // wall
    for (let x = 0; x < W; x += 16) px(x + 15, 0, 1, H - FLOOR, '#e4dab8');
    for (let y = H - FLOOR, i = 0; y < H; y += 8, i++)
      for (let x = (i % 2) * 8; x < W; x += 16) { px(x, y, 8, 8, '#e8d8b0'); px(x + 8, y, 8, 8, '#e0cea0'); }
    const fx0 = MARGIN, fw = W - 2 * MARGIN, fy0 = TOP - 4, fh = H - FLOOR - fy0 + 2;
    px(fx0 - 1, fy0 - 1, fw + 2, fh + 2, OUT);                        // bookcase frame
    px(fx0, fy0, fw, fh, '#8a5a30'); px(fx0, fy0, fw, 2, '#b07840');
    px(fx0 + FRAME, fy0 + 3, fw - 2 * FRAME, fh - 5, '#4a2e14');      // back panel
    for (let x = fx0 + FRAME + 6; x < fx0 + fw - FRAME; x += 12) px(x, fy0 + 3, 1, fh - 5, '#3e2610');
    const focused = cv && document.activeElement === cv ? L.order[focusIdx] : null;
    for (const s of L.shelves) {
      s.lines.forEach((ln, i) => {
        const bottom = s.bottoms[i];
        ln.forEach((b) => drawBook(b, b === focused));
        px(fx0 + FRAME - 1, bottom, fw - 2 * FRAME + 2, PLANK, '#a06a38');            // plank
        px(fx0 + FRAME - 1, bottom, fw - 2 * FRAME + 2, 1, '#c89058');
        px(fx0 + FRAME - 1, bottom + PLANK, fw - 2 * FRAME + 2, 1, '#2a1808');
        ln.forEach(drawRibbon);
      });
    }
  }

  function overlays() {
    fx.textContent = ''; labels.textContent = ''; srList.textContent = '';
    const pct = (v, t) => (v / t * 100) + '%';
    const put = (parent, tag, cls, x, y, w, h) => {
      const i = el(tag, cls);
      Object.assign(i.style, { left: pct(x, L.W), top: pct(y, L.H), height: pct(h, L.H) });
      if (w != null) i.style.width = pct(w, L.W);
      parent.appendChild(i);
      return i;
    };
    L.shelves.forEach((s) => {
      put(labels, 'span', 'lib-plaque', L.x0, s.y, null, LABEL_H - 2).textContent = s.g.label;
      if (!s.lines[0].length) put(labels, 'span', 'lib-none', L.x0 + 2, s.bottoms[0] - 14, null, 12).textContent = 'EMPTY';
    });
    L.order.forEach((b) => {
      if (b.glow) put(fx, 'i', 'lib-glow', b.x - 1, b.top - 1, BW + 2, BH + 2);
      if (b.rib === 'crit') { const r = ribbonRect(b); put(fx, 'i', 'lib-crit', r.x, r.y, r.w, r.h); }
      const lab = put(labels, 'span', null, b.x, b.top, BW, BH), t = el('b', null, b.title);
      t.style.color = ink(b.color);
      lab.appendChild(t);
      srList.appendChild(el('li', null, describe(b)));
    });
  }
  function describe(b) {                            // the same words the label shows, plus shelf and status
    return `${b.title}, ${shelfLabel(b.group).toLowerCase()}${b.glow ? ', a trainer is working on it' : ''}` +
      (b.rib ? `, ${b.rib === 'crit' ? 'critical' : 'open'} security findings` : '');
  }

  function render(force) {
    if (!setup()) return;
    books = bookList(data);
    const pub = data.public === true;
    const k = JSON.stringify([scrollEl.clientWidth, pub, books.map((b) => [b.slug, b.title, b.group, b.color, b.order, b.glow, b.rib])]);
    if (!force && k === key) return;
    key = k;
    const prev = L && L.order[focusIdx] ? L.order[focusIdx].slug : null;
    L = layout();
    lastW = root.clientWidth;
    focusIdx = prev ? L.order.findIndex((b) => b.slug === prev) : -1;
    if (cv.width !== L.W || cv.height !== L.H) { cv.width = L.W; cv.height = L.H; }
    roomEl.style.width = L.W * L.scale + 'px';
    roomEl.style.height = L.H * L.scale + 'px';
    const n = books.length;
    countEl.textContent = n ? `${n} book${n === 1 ? '' : 's'}` : 'no projects yet';
    cv.setAttribute('aria-label', `Project library, ${n} book${n === 1 ? '' : 's'}: ` +
      `${books.map((b) => b.title).join(', ') || 'none'}. Arrow keys choose a book, Enter opens it.`);
    legend.textContent = 'Tap a book to open it. Glowing = a trainer is on it now.' +
      (pub ? '' : ' Red ribbon = open security findings, blinking = critical.');
    draw();
    overlays();
  }

  // ---------- interaction ----------
  function hit(x, y) {
    for (const b of L ? L.order : []) {
      if (x >= b.x - HIT && x <= b.x + BW + HIT && y >= b.top - HIT && y <= b.bottom + HIT) return b;
    }
    return null;
  }
  function onTap(e) {
    if (!L) return;
    const r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = (e.clientX - r.left) * L.W / r.width, y = (e.clientY - r.top) * L.H / r.height;
    const b = hit(x, y);
    if (!b) return;
    focusIdx = L.order.indexOf(b);
    openSpread(b);
  }
  function announce() {
    const b = L && L.order[focusIdx];
    if (sr) sr.textContent = b ? describe(b) : '';
    if (b && scrollEl && scrollEl.scrollHeight > scrollEl.clientHeight) {   // keep the focused book in view
      const top = (b.top - LABEL_H) * L.scale, bot = (b.bottom + PLANK) * L.scale;
      if (top < scrollEl.scrollTop) scrollEl.scrollTop = top;
      else if (bot > scrollEl.scrollTop + scrollEl.clientHeight) scrollEl.scrollTop = bot - scrollEl.clientHeight;
    }
  }
  function onKey(e) {
    if (!L || !L.order.length) return;
    const n = L.order.length;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') focusIdx = (focusIdx + 1) % n;
    else if (k === 'ArrowLeft' || k === 'ArrowUp') focusIdx = (focusIdx - 1 + n) % n;
    else if (k === 'Home') focusIdx = 0;
    else if (k === 'End') focusIdx = n - 1;
    else if (k === 'Enter' || k === ' ' || k === 'Spacebar') { if (focusIdx < 0) focusIdx = 0; openSpread(L.order[focusIdx]); }
    else return;
    if (e.preventDefault) e.preventDefault();
    announce(); draw();
  }

  function trainers(slug, state) {
    const out = new Map();
    const add = (name, type) => { if (name && !out.has(String(name))) out.set(String(name), who(name, type)); };
    arr(state.agents).forEach((a) => {
      if (!a) return;
      if (a.project === slug || arr(a.history).some((h) => h && h.project === slug)) add(a.name, a.type);
    });
    arr(obj(obj(state.activity)[slug]).recent).forEach((r) => r && add(r.agent, r.type));
    return [...out.values()];
  }

  const closeBar = (b) => `<div class="lib-bar"><span class="lib-chip" style="background:${b.color}"></span>
    <button class="btn" type="button" data-lib-close aria-label="Close book">CLOSE X</button></div>`;

  function publicSpreadHtml(b) {                    // public view: title and shelf only
    return `<div class="lib-spread">
  ${closeBar(b)}
  <div class="lib-pages lib-one">
    <section class="lib-page lib-left">
      <h2>${esc(b.title)}</h2>
      <dl><dt>SHELF</dt><dd>${esc(shelfLabel(b.group))}</dd></dl>
      <p style="margin-top:10px">Sign in to see details.</p>
    </section>
  </div>
</div>`;
  }

  function spreadHtml(b) {
    const p = b.p, state = obj(data.state), lib = obj(data.library);
    const act = obj(obj(state.activity)[b.slug]), sec = obj(obj(lib.security)[b.slug]);
    const items = arr(sec.items).filter(Boolean), open = num(sec.open) || items.length;
    const lessons = num(obj(lib.lessons)[b.slug]);
    const tr = trainers(b.slug, state);
    const row = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="lib-dim">-</span>'}</dd>`;
    const stack = arr(p.stack).map((s) => str(s, 30)).filter(Boolean).join(' · ');
    const stackRow = `<dt>STACK</dt><dd><span class="lib-swatch" style="background:${stackColor(p)}"></span>` +
      `${stack ? esc(stack) : '<span class="lib-dim">-</span>'}</dd>`;
    const recent = arr(act.recent).filter(Boolean).slice(0, 5).map((r) => {
      const meta = [r.agent ? who(r.agent, r.type) : '', agoTxt(r.ts)].filter(Boolean).map(esc).join(' · ');
      return `<li>${esc(str(r.task, 90))}${meta ? ` <span>· ${meta}</span>` : ''}</li>`;
    }).join('');
    const secs = items.slice(0, 10).map((it) => {
      const sev = String(it.sev || '').toLowerCase();
      const cls = /^(low|medium|high|critical)$/.test(sev) ? ` class="sev-${sev}"` : '';
      return `<li>${esc(str(it.id, 12))} <span${cls}>${esc(str(sev, 10))}</span></li>`;
    }).join('');
    const more = open > items.length ? `<li><span>+${esc(open - items.length)} more</span></li>` : '';
    return `<div class="lib-spread">
  ${closeBar(b)}
  <div class="lib-pages">
    <section class="lib-page lib-left">
      <h2>${esc(b.title)}</h2>
      <p>${p.description ? esc(str(p.description, 160)) : '<span class="lib-dim">No description.</span>'}</p>
      <dl>${stackRow}${row('REPO', str(p.repo, 120))}${row('HOSTING', str(p.hosting, 120))}${row('STATUS', str(p.status, 60))}${row('SHELF', shelfLabel(b.group))}</dl>
      <h3>TRAINERS</h3>
      <ul>${tr.map((t) => `<li>${esc(t)}</li>`).join('') || '<li><span>Nobody yet</span></li>'}</ul>
    </section>
    <section class="lib-page lib-right">
      <h3>RECENT TASKS${b.tasks ? ` <span class="lib-dim">(${esc(b.tasks)} total)</span>` : ''}</h3>
      <ul>${recent || '<li><span>None yet</span></li>'}</ul>
      <h3>OPEN SECURITY</h3>
      <ul>${secs + more || '<li><span>None open</span></li>'}</ul>
      <h3>LESSONS</h3>
      <p>${lessons ? `${esc(lessons)} lesson${lessons === 1 ? '' : 's'} mention this project` : '<span class="lib-dim">None recorded</span>'}</p>
    </section>
  </div>
</div>`;
  }

  function openSpread(b) {
    const hq = HQ();
    if (!b || typeof hq.openModal !== 'function') return;
    hq.openModal(data.public === true ? publicSpreadHtml(b) : spreadHtml(b), 'spread');
    const btn = document.querySelector('[data-lib-close]');
    spreadEl = btn && btn.closest ? btn.closest('.lib-spread') : btn;
    if (btn) {
      btn.addEventListener('click', closeSpread);
      if (btn.focus) btn.focus();
    }
  }
  function closeSpread() {
    spreadEl = null;
    if (typeof HQ().closeModal === 'function') HQ().closeModal();
    if (cv && cv.focus) cv.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !spreadEl) return;
    const shown = spreadEl.isConnected !== false && spreadEl.offsetParent !== null;
    if (shown) closeSpread(); else spreadEl = null;
  });

  // ---------- public ----------
  window.Library = {
    update(d) {
      data = d && typeof d === 'object' ? d : {};
      render(false);
    },
  };
  if (window.HQ && window.HQ.data) window.Library.update(window.HQ.data);
})();
