// Small DOM + formatting helpers used across views.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function tag(name) { return (...args) => el(name, ...args); }

const div = tag('div');
const span = tag('span');
const a = tag('a');
const h1 = tag('h1'); const h2 = tag('h2'); const h3 = tag('h3');
const p = tag('p');

function table(headers, rows, opts = {}) {
  const wrap = el('div', { class: 'table-wrap' });
  const t = el('table', { class: 'f1-table' });
  const thead = el('thead');
  const trh = el('tr');
  for (const h of headers) trh.appendChild(el('th', {}, h));
  thead.appendChild(trh);
  t.appendChild(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const cell of r) {
      if (cell && cell.nodeType) tr.appendChild(el('td', {}, cell));
      else if (cell && typeof cell === 'object' && 'value' in cell)
        tr.appendChild(el('td', { class: cell.class || '' }, cell.value));
      else tr.appendChild(el('td', {}, cell == null ? '—' : String(cell)));
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  wrap.appendChild(t);
  return wrap;
}

function loading(label = 'Loading…') {
  return el('div', { class: 'loading' }, el('span', { class: 'spinner' }), label);
}

function errorBox(msg) {
  return el('div', { class: 'error' }, msg);
}

function posClass(pos) {
  if (pos === 1) return 'pos-1';
  if (pos === 2) return 'pos-2';
  if (pos === 3) return 'pos-3';
  return '';
}

function driverLink(driver, label) {
  if (!driver) return el('span', {}, label || '—');
  const txt = label || driver.name || driver.fullName || driver.id;
  return el('a', { href: `#/driver/${driver.id}` }, txt);
}

function constructorLink(c, label) {
  if (!c) return el('span', {}, label || '—');
  const txt = label || c.name || c.id;
  return el('a', { href: `#/constructor/${c.id}` }, txt);
}

function raceLink(year, round, label) {
  return el('a', { href: `#/season/${year}/race/${round}` }, label);
}

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function crumbs(...items) {
  const c = el('div', { class: 'crumbs' });
  items.forEach((it, i) => {
    if (i > 0) c.appendChild(el('span', {}, '›'));
    if (it.href) c.appendChild(el('a', { href: it.href }, it.label));
    else c.appendChild(el('span', {}, it.label));
  });
  return c;
}

function statBlock(label, value, sub) {
  return el('div', { class: 'stat' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value == null ? '—' : String(value)),
    sub ? el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px;' }, sub) : null
  );
}

function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

window.UI = { $, $$, el, div, span, a, h1, h2, h3, p, table, loading, errorBox,
              posClass, driverLink, constructorLink, raceLink, fmtDate,
              crumbs, statBlock, clearChildren };
