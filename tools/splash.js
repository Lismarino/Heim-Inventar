// Erzeugt die iOS-Startbilder in icons/splash/ – hell und dunkel, je iPhone-Größe.
// Gehört nicht zur App (wird nicht ausgeliefert oder gecacht), nur bei Bedarf ausführen:
//   node tools/splash.js [pfad/zu/einer-runden-schrift.woff2]
// Braucht Playwright mit Chromium. Die Schrift ist optional; ohne sie wird die
// Systemschrift verwendet. Die Aufteilung (Symbol 104 pt, darunter „Inventar“) muss
// zum Start-Logo #splash in index.html/css passen, sonst springt das Bild beim Start.
// Danach die PNGs am besten noch verlustfrei verkleinern (z. B. mit oxipng oder
// als 256-Farben-PNG) – iOS lädt sie beim Installieren alle. Ziel: höchstens ~55 KB je Bild.
// In index.html stehen die dunklen Varianten (mit prefers-color-scheme: dark) vor den
// hellen, die ohne Farbschema-Bedingung als Standard gelten.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'icons', 'splash');
// [Breite, Höhe, Pixelverhältnis] in Punkten, hochkant
const SIZES = [
  [440, 956, 3], [420, 912, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [360, 780, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
];
const THEMES = { light: { bg: '#f4eee3', fg: '#2b221c' }, dark: { bg: '#17130f', fg: '#f3eadd' } };

(async () => {
  const fontFile = process.argv[2];
  const font = fontFile ? `@font-face{font-family:Rund;font-weight:700;src:url(data:font/woff2;base64,${fs.readFileSync(fontFile).toString('base64')}) format("woff2")}` : '';
  const icon = fs.readFileSync(path.join(ROOT, 'icons', 'icon-512.png')).toString('base64');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const [name, t] of Object.entries(THEMES)) {
    for (const [w, h, d] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: d });
      await page.setContent(`<!doctype html><style>${font}
        html,body{margin:0;height:100%;background:${t.bg}}
        body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
        img{width:104px;height:104px;border-radius:24px;box-shadow:0 18px 36px -16px rgba(46,94,69,.6)}
        b{font:700 24px/1.2 Rund,ui-rounded,-apple-system,sans-serif;letter-spacing:-.01em;color:${t.fg};-webkit-font-smoothing:antialiased}
        </style><img src="data:image/png;base64,${icon}"><b>Inventar</b>`);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(OUT, `splash-${w * d}x${h * d}-${name}.png`);
      await page.screenshot({ path: file });
      await page.close();
      console.log(path.relative(ROOT, file), (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
