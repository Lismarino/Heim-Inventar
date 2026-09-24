// Erzeugt die iOS-Startbilder in icons/splash/ – hell und dunkel, je iPhone-Größe.
// Gehört nicht zur App (wird nicht ausgeliefert oder gecacht), nur bei Bedarf ausführen:
//   node tools/splash.js
// Braucht Playwright mit Chromium (CHROMIUM=/pfad/zu/chrome für ein eigenes Binary).
//
// Seit 1.6.0 wird kein eigenes Bild mehr nachgebaut: das Skript öffnet index.html direkt
// von der Platte und fotografiert die Start-Szene #splash in ihrem Ruhezustand (leeres
// Glasregal auf dem Hintergrund). Genau das ist der erste Frame der Start-Animation
// (js/intro.js) – das iOS-Startbild geht deshalb nahtlos in die Animation über. Über
// file:// laufen die Module nicht, die Szene bleibt also sicher im Ruhezustand.
// Wer die Szene in css/app.css oder index.html ändert, erzeugt die Bilder neu.
//
// Seit 1.6.1 steht im Startbild keine Schrift: Die runde Systemschrift des iPhones (SF Pro
// Rounded) gibt es hier nicht, ein Schriftzug im Bild sähe also anders aus als der, den das
// iPhone gleich danach zeichnet. Der Schriftzug „Inventar“ ist im Ruhezustand unsichtbar und
// wird erst von der Start-Szene eingeblendet – Bild und erster Frame bleiben deckungsgleich.
// Chromium läuft mit SwiftShader, damit backdrop-filter (die leichte Unschärfe im Glasbrett)
// wie auf dem Gerät gezeichnet wird – ohne GPU lässt Headless-Chromium sie sonst weg.
//
// Danach werden die PNGs, falls Python mit Pillow da ist, auf eine 256-Farben-Palette
// gebracht (die sanften Verläufe vertragen das) – Ziel: höchstens ~60 KB je Bild, denn iOS
// lädt sie beim Hinzufügen zum Home-Bildschirm alle. Ohne Pillow bleiben sie größer.
// In index.html stehen die dunklen Varianten (mit prefers-color-scheme: dark) vor den
// hellen, die ohne Farbschema-Bedingung als Standard gelten.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'icons', 'splash');
// [Breite, Höhe, Pixelverhältnis] in Punkten, hochkant
const SIZES = [
  [440, 956, 3], [420, 912, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3],
  [375, 812, 3], [360, 780, 3], [414, 896, 3], [414, 896, 2], [414, 736, 3], [375, 667, 2], [320, 568, 2],
];

// Palette statt Echtfarben: kleiner, ohne sichtbaren Unterschied. Gibt false zurück, wenn es nicht geht.
function shrink(file) {
  const py = `
import sys
from PIL import Image
p = sys.argv[1]
im = Image.open(p).convert('RGB')
im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(p, optimize=True)
`;
  const r = spawnSync('python3', ['-c', py, file], { encoding: 'utf8' });
  return r.status === 0;
}

(async () => {
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href;
  fs.mkdirSync(OUT, { recursive: true });
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM, args } : { args });
  let small = true;
  for (const scheme of ['light', 'dark']) {
    for (const [w, h, d] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: d });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // Nur die Szene: alles andere (App, Fehlerseite) ausblenden – sie liegt ohnehin darüber.
      await page.addStyleTag({ content: '#app,#boot-error,#onboarding,#toast,#update-bar,#lightbox,#sheet{display:none!important}' });
      const file = path.join(OUT, `splash-${w * d}x${h * d}-${scheme}.png`);
      await page.screenshot({ path: file });
      await page.close();
      const packed = shrink(file);
      const kb = fs.statSync(file).size / 1024;
      if (kb > 60) small = false;
      console.log(path.relative(ROOT, file), kb.toFixed(0) + ' KB', packed ? '(Palette)' : '(ohne Pillow)');
    }
  }
  await browser.close();
  if (!small) console.warn('Hinweis: mindestens ein Bild ist größer als 60 KB.');
})().catch((e) => { console.error(e); process.exit(1); });
