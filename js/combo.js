// Vorschlagsliste mit Live-Filterung.
// Ersetzt <datalist>: das zeigt auf iOS Safari nur beim allerersten Antippen
// Vorschläge und filtert nicht nach dem, was schon getippt wurde.

const MAX = 8;

let sourceFn = null;   // (kind) => string[]
let openInput = null;
let listEl = null;
let index = -1;
let suppress = false;  // verhindert, dass die eigene Auswahl die Liste neu öffnet

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Kleinschreibung plus Akzente entfernen, damit „kuche“ auch „Küche“ findet.
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Aktiviert die Vorschläge für alle Felder mit data-combo="<kind>". */
export function initCombos(getSource) {
  sourceFn = getSource;
  document.addEventListener('focusin', (e) => {
    const input = e.target.closest?.('[data-combo]');
    if (input) show(input);
    else if (!e.target.closest?.('.combo-list')) hide();
  });
  document.addEventListener('input', (e) => {
    if (suppress) return;
    const input = e.target.closest?.('[data-combo]');
    if (input) show(input);
  });
  document.addEventListener('keydown', onKey);
  // Capture-Phase: verhindert, dass das Feld den Fokus verliert, bevor der Tipp ankommt.
  document.addEventListener('pointerdown', (e) => {
    if (listEl && e.target.closest?.('.combo-list')) {
      e.preventDefault();
      const li = e.target.closest('li[data-value]');
      if (li) choose(li.dataset.value);
      return;
    }
    if (!e.target.closest?.('[data-combo]')) hide();
  }, true);
  window.addEventListener('resize', hide);
}

export function hideCombo() { hide(); }

function show(input) {
  const all = (sourceFn ? sourceFn(input.dataset.combo) : []) || [];
  const q = norm(input.value);

  let items;
  if (!q) {
    items = all.slice(0, MAX);
  } else {
    // Was vorne passt, zuerst – dann alles, was den Text irgendwo enthält.
    const starts = all.filter(n => norm(n).startsWith(q));
    const rest = all.filter(n => !norm(n).startsWith(q) && norm(n).includes(q));
    items = starts.concat(rest).slice(0, MAX);
  }

  const isNew = q && !all.some(n => norm(n) === q);
  if (!items.length && !isNew) { hide(); return; }

  ensureList(input);
  listEl.innerHTML =
    items.map(n => `<li data-value="${esc(n)}">${mark(n, q)}</li>`).join('') +
    (isNew ? `<li class="note">„${esc(input.value.trim())}“ wird neu angelegt</li>` : '');
  index = -1;
  place(input);
}

function mark(name, q) {
  if (!q) return esc(name);
  const i = norm(name).indexOf(q);
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + q.length)) + '</mark>' + esc(name.slice(i + q.length));
}

function ensureList(input) {
  if (listEl && openInput === input) return;
  hide();
  listEl = document.createElement('ul');
  listEl.className = 'combo-list';
  input.parentElement.appendChild(listEl);
  openInput = input;
}

// Nach oben aufklappen, wenn unten kein Platz mehr ist.
function place(input) {
  const r = input.getBoundingClientRect();
  const need = Math.min(listEl.scrollHeight + 12, 228);
  listEl.classList.toggle('up', r.bottom + need > window.innerHeight && r.top > need);
}

function hide() {
  if (listEl) listEl.remove();
  listEl = null;
  openInput = null;
  index = -1;
}

function choose(value) {
  const input = openInput;
  if (!input) return;
  input.value = value;
  hide();
  suppress = true;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  suppress = false;
}

function onKey(e) {
  if (!listEl || !openInput || e.target !== openInput) return;
  if (e.key === 'Escape') { hide(); return; }

  const opts = Array.from(listEl.querySelectorAll('li[data-value]'));
  if (!opts.length) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    index = e.key === 'ArrowDown'
      ? (index + 1) % opts.length
      : (index <= 0 ? opts.length - 1 : index - 1);
    opts.forEach((li, i) => li.classList.toggle('on', i === index));
    opts[index].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && index >= 0) {
    e.preventDefault();
    choose(opts[index].dataset.value);
  }
}
