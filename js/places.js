// Orte (1.7.0): die Ebene über den Räumen – „Zuhause“, „Auto“, „Betrieb“ …
// Hier nur, was ohne Datenbank auskommt: Symbole, Farben, Vorschläge aus dem Namen,
// Raumvorschläge je Art des Orts und kleine Darstellungs-Helfer (Abzeichen, Chips).
//
// Symbol und Farbe eines Orts landen in Klassennamen und in <use href="#i-pl-…">. Sie
// können aus einer fremden Sicherungsdatei stammen – deshalb nur über safeIcon/safeColor
// (feste Listen) verwenden, nie roh.
import { esc, icon } from './ui.js';

export const DEFAULT_PLACE = 'Zuhause';

/** Symbole im SVG-Sprite (index.html, #i-pl-…), in der Reihenfolge der Auswahl. */
export const PLACE_ICONS = ['haus', 'wohnung', 'ferien', 'auto', 'bus', 'firma', 'werkstatt', 'garten', 'lager'];
export const ICON_LABEL = {
  haus: 'Haus', wohnung: 'Wohnung', ferien: 'Ferienhaus', auto: 'Auto', bus: 'Transporter',
  firma: 'Firma', werkstatt: 'Werkstatt', garten: 'Garten', lager: 'Lager',
};

/** Farben aus der Palette der App (Klassen .pc-… in app.css, hell und dunkel). */
export const PLACE_COLORS = ['tanne', 'salbei', 'terrakotta', 'senf', 'tinte', 'pflaume', 'holz'];
export const COLOR_LABEL = {
  tanne: 'Tannengrün', salbei: 'Salbei', terrakotta: 'Terrakotta', senf: 'Senf',
  tinte: 'Tinte', pflaume: 'Pflaume', holz: 'Holz',
};

const COLOR_OF_ICON = {
  haus: 'tanne', wohnung: 'salbei', ferien: 'pflaume', auto: 'tinte', bus: 'tinte',
  firma: 'senf', werkstatt: 'terrakotta', garten: 'salbei', lager: 'holz',
};

export const safeIcon = (v) => (PLACE_ICONS.includes(v) ? v : 'haus');
export const safeColor = (v) => (PLACE_COLORS.includes(v) ? v : 'tanne');
export const colorFor = (ic) => COLOR_OF_ICON[safeIcon(ic)];

// Kleinschreibung ohne Akzente – „Büro“ und „buero“ treffen dieselbe Regel.
const flat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Erste passende Regel gewinnt – Spezielles vor Allgemeinem („Ferienhaus“ vor „Haus“).
const RULES = [
  [/transporter|sprinter|\bbus\b|kastenwagen|lkw|anhanger|wohnmobil|camper/, 'bus'],
  [/auto|\bpkw\b|wagen|fahrzeug|kombi|dienstwagen|firmenwagen/, 'auto'],
  [/ferien|urlaub|wochenend|hutte|datsche|bungalow|camping/, 'ferien'],
  [/betrieb|firma|arbeit|buro|office|praxis|kanzlei|laden|geschaft|baustelle|job/, 'firma'],
  [/werkstatt|schuppen|hobbyraum|garage/, 'werkstatt'],
  [/garten|schreber|parzelle|kleingarten|\bhof\b|acker/, 'garten'],
  [/lager|depot|container|abteil|storage|kiste|\bbox\b/, 'lager'],
  [/wohnung|apartment|appartement|\bwg\b|studentenwohnung|zweitwohnung/, 'wohnung'],
  [/haus|zuhause|daheim|heim|eltern|oma|opa/, 'haus'],
];

/** Symbol-Vorschlag aus dem Namen: „Auto“ → Auto, „Betrieb“ → Firma, sonst Haus. */
export function suggestIcon(name) {
  const n = flat(name);
  for (const [re, ic] of RULES) if (re.test(n)) return ic;
  return 'haus';
}

/** Reihenfolge der Orte: gespeicherte Ordnung, dann Anlagedatum. */
export const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
  || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
  || String(a.name).localeCompare(String(b.name), 'de');

/** Vorschläge in der Einführung („Wo hast du Sachen?“). */
export const PLACE_SUGGESTIONS = [
  { name: 'Zuhause', icon: 'haus' },
  { name: 'Auto', icon: 'auto' },
  { name: 'Betrieb', icon: 'firma' },
  { name: 'Garten', icon: 'garten' },
  { name: 'Ferienhaus', icon: 'ferien' },
  { name: 'Lager', icon: 'lager' },
];

const HOME_ROOMS = ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Bad', 'Flur', 'Keller', 'Dachboden',
  'Garage', 'Arbeitszimmer', 'Kinderzimmer', 'Abstellraum', 'Balkon'];
const ROOMS_BY_ICON = {
  haus: HOME_ROOMS,
  wohnung: ['Küche', 'Wohnzimmer', 'Schlafzimmer', 'Bad', 'Flur', 'Abstellraum', 'Balkon', 'Kellerabteil'],
  ferien: ['Küche', 'Wohnraum', 'Schlafzimmer', 'Bad', 'Schuppen', 'Terrasse'],
  auto: ['Kofferraum', 'Handschuhfach', 'Werkzeugkiste', 'Rücksitz', 'Türfach', 'Dachbox'],
  bus: ['Laderaum', 'Werkzeugkiste', 'Regal links', 'Regal rechts', 'Fahrerhaus', 'Handschuhfach'],
  firma: ['Büro', 'Lager', 'Werkstatt', 'Spind', 'Keller', 'Besprechung'],
  werkstatt: ['Werkbank', 'Werkzeugwand', 'Regal', 'Schrank', 'Materiallager'],
  garten: ['Gartenhaus', 'Geräteschuppen', 'Gewächshaus', 'Terrasse', 'Beet'],
  lager: ['Regal 1', 'Regal 2', 'Kisten', 'Abteil'],
};
/** Raumvorschläge passend zur Art des Orts (Auto: Kofferraum, Handschuhfach …). */
export const roomSuggestions = (ic) => ROOMS_BY_ICON[safeIcon(ic)];

/* ---------------- Darstellung ---------------- */

/** Runde Plakette mit dem Symbol in der Farbe des Orts. */
export function placeBadge(p, cls = '') {
  return `<span class="pbadge pc-${safeColor(p?.color)}${cls ? ' ' + cls : ''}" aria-hidden="true">${icon('pl-' + safeIcon(p?.icon))}</span>`;
}

/** Nur das Symbol, getönt in der Farbe des Orts (für Zeilen und Kacheln). */
export function placeIcon(p, cls = '') {
  return `<span class="pic pc-${safeColor(p?.color)}${cls ? ' ' + cls : ''}" aria-hidden="true">${icon('pl-' + safeIcon(p?.icon))}</span>`;
}

/**
 * Chips zur Wahl des Orts (Hinzufügen, Zuweisen, Eintrag, Aktionsblatt). Genau einer ist
 * gedrückt (aria-pressed) – oder keiner, dann ist der Ort offen. add: Chip „Neuer Ort“.
 */
export function placeChipsHTML(places, selected, { add = true, label = 'Ort' } = {}) {
  const chips = places.map(p => {
    const on = p.id === selected;
    return `<button type="button" class="pchip pc-${safeColor(p.color)}${on ? ' on' : ''}" data-place="${esc(p.id)}" aria-pressed="${on}">`
      + `${icon('pl-' + safeIcon(p.icon))}<span>${esc(p.name)}</span></button>`;
  });
  if (add) chips.push(`<button type="button" class="pchip add" data-place-new>${icon('plus')}<span>Neuer Ort</span></button>`);
  return `<div class="pchips" role="group" aria-label="${esc(label)}">${chips.join('')}</div>`;
}

/** Auswahl von Symbol und Farbe (Ort anlegen, Symbol & Farbe ändern). */
export function styleHTML(ic, color) {
  const icons = PLACE_ICONS.map(k => `<button type="button" class="pstyle-ic${k === ic ? ' on' : ''}" data-icon="${k}" aria-pressed="${k === ic}" aria-label="${ICON_LABEL[k]}">${icon('pl-' + k)}</button>`).join('');
  const colors = PLACE_COLORS.map(k => `<button type="button" class="pstyle-col pc-${k}${k === color ? ' on' : ''}" data-color="${k}" aria-pressed="${k === color}" aria-label="${COLOR_LABEL[k]}"></button>`).join('');
  return `<div class="pstyle"><p class="pstyle-lbl">Symbol</p><div class="pstyle-icons" role="group" aria-label="Symbol">${icons}</div>`
    + `<p class="pstyle-lbl">Farbe</p><div class="pstyle-colors" role="group" aria-label="Farbe">${colors}</div></div>`;
}
